// file: lib/search/rerank.ts
//
// Step 3 of the search pipeline.
// Claude Sonnet reranks the top-N term-scored candidates and adds explanation.
// Batches all candidates in one call to minimise latency + cost.

import { ScoredProfile } from "./retrieveCandidates";
import { ParsedQuery } from "./parseQuery";

export interface RankedResult {
  profile: ScoredProfile["profile"];
  finalScore: number;       // 0–100, Claude's assessment
  termScore: number;        // from retrieval
  matchTier: "strong" | "good" | "weak";
  whyMatch: string;         // 1-2 sentence human-readable explanation
  signals: string[];        // specific matched signals
  gaps: string[];           // explicit gaps or risks
  outreachHook: string;     // personalisation angle for outreach
  matchedTerms: string[];
  matchedDomains: string[];
}

interface ClaudeRankItem {
  id: string;
  score: number;
  whyMatch: string;
  signals: string[];
  gaps: string[];
  outreachHook: string;
}

async function callClaude(prompt: string, maxTokens = 2048): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const d = await res.json() as { content: Array<{ type: string; text: string }> };
  return d.content.find((b) => b.type === "text")?.text?.trim() ?? "";
}

// ── Build the ranking prompt ──────────────────────────────────────────────────

function buildPrompt(query: ParsedQuery, candidates: ScoredProfile[]): string {
  const queryDesc = [
    query.roleTitle && `Role: ${query.roleTitle}`,
    query.mustHaves.length && `Must-haves: ${query.mustHaves.join(", ")}`,
    query.domainTags.length && `Domains: ${query.domainTags.join(", ")}`,
    query.geoPreference && `Location: ${query.geoPreference}`,
    query.seniority && `Seniority: ${query.seniority}`,
    !query.roleTitle && `Query: "${query.raw}"`,
  ].filter(Boolean).join("\n");

  const candidateList = candidates.map((s, i) => {
    const p = s.profile;
    return `[${i}] id="${p.id}"
  Name: ${p.name}
  Title: ${p.title} @ ${p.company}
  Location: ${p.location || "unknown"}
  Bio: ${(p.bio || "").slice(0, 200)}
  Skills: ${[...(p.skills ?? []), ...(p.skillTags ?? [])].slice(0, 12).join(", ")}
  Domain tags: ${(p.domainTags ?? []).join(", ")}
  Prior companies: ${(p.priorCompanies ?? []).join(", ")}
  GitHub: ${p.githubUrl || "none"}`;
  }).join("\n\n");

  return `You are a senior technical recruiter specialising in identity/security/platform engineering.

SEARCH CRITERIA:
${queryDesc}

CANDIDATES TO RANK (${candidates.length} total):
${candidateList}

For each candidate, output a JSON array item:
{
  "id": "<candidate id>",
  "score": <0-100 integer — how well they match the criteria>,
  "whyMatch": "<1-2 sentences explaining the fit>",
  "signals": ["<specific thing that matched — be concrete>"],
  "gaps": ["<explicit gap or risk — omit if none>"],
  "outreachHook": "<one specific personalisation angle for a cold email>"
}

Rules:
- score 80-100 = strong match, genuine domain expertise + right seniority
- score 50-79 = good match, mostly fits but missing something
- score <50 = weak match, surface-level alignment only
- signals must reference actual profile content, not just echo the query
- outreachHook must be specific to THIS person (mention a project, company, or specific skill)

Return ONLY a valid JSON array. No markdown. No commentary.`;
}

// ── Rerank pipeline ───────────────────────────────────────────────────────────

export async function rerank(
  query: ParsedQuery,
  candidates: ScoredProfile[]
): Promise<RankedResult[]> {
  if (!candidates.length) return [];

  // Fallback if no API key: return term-scored results with minimal metadata
  if (!process.env.ANTHROPIC_API_KEY) {
    return candidates.map((s) => ({
      profile:       s.profile,
      finalScore:    s.totalScore,
      termScore:     s.termScore,
      matchTier:     s.totalScore >= 70 ? "strong" : s.totalScore >= 40 ? "good" : "weak",
      whyMatch:      s.matchedDomains.length
        ? `Matches ${s.matchedDomains.join(", ")} domain expertise.`
        : `Matched ${s.matchedTerms.slice(0, 3).join(", ")}.`,
      signals:       s.matchedTerms.slice(0, 4),
      gaps:          [],
      outreachHook:  "",
      matchedTerms:  s.matchedTerms,
      matchedDomains: s.matchedDomains,
    }));
  }

  try {
    const raw = (await callClaude(buildPrompt(query, candidates), 3000))
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const ranked = JSON.parse(raw) as ClaudeRankItem[];

    // Map Claude's scores back to profiles, filling in any missing ones
    const byId = new Map(ranked.map((r) => [r.id, r]));

    return candidates.map((s): RankedResult => {
      const r = byId.get(s.profile.id);
      const finalScore = r?.score ?? s.totalScore;
      return {
        profile:        s.profile,
        finalScore,
        termScore:      s.termScore,
        matchTier:      finalScore >= 75 ? "strong" : finalScore >= 45 ? "good" : "weak",
        whyMatch:       r?.whyMatch ?? `Matched: ${s.matchedTerms.slice(0, 3).join(", ")}`,
        signals:        r?.signals ?? s.matchedTerms.slice(0, 4),
        gaps:           r?.gaps ?? [],
        outreachHook:   r?.outreachHook ?? "",
        matchedTerms:   s.matchedTerms,
        matchedDomains: s.matchedDomains,
      };
    }).sort((a, b) => b.finalScore - a.finalScore);

  } catch (err) {
    console.error("[rerank] Claude call failed, falling back to term scores:", err);
    return candidates.map((s) => ({
      profile:        s.profile,
      finalScore:     s.totalScore,
      termScore:      s.termScore,
      matchTier:      s.totalScore >= 70 ? "strong" : s.totalScore >= 40 ? "good" : "weak",
      whyMatch:       `Matched: ${s.matchedTerms.slice(0, 3).join(", ")}`,
      signals:        s.matchedTerms.slice(0, 4),
      gaps:           [],
      outreachHook:   "",
      matchedTerms:   s.matchedTerms,
      matchedDomains: s.matchedDomains,
    }));
  }
}
