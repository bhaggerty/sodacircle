/**
 * Claude (Anthropic) integration — criteria extraction, candidate scoring,
 * and search keyword generation.
 *
 * Activated automatically when ANTHROPIC_API_KEY is present.
 * Falls back to regex-based logic (lib/ai.ts) if no key is set.
 *
 * Models:
 *   - claude-haiku-4-5-20251001  → fast, cheap (extraction, keywords)
 *   - claude-sonnet-4-6          → stronger reasoning (candidate scoring)
 */

import { SearchCriteria } from "@/lib/types";
import { parseBriefToCriteria } from "@/lib/ai";

const hasKey = () => !!(process.env.ANTHROPIC_API_KEY);

// ── Anthropic fetch wrapper ───────────────────────────────────────

async function claudeChat(
  model: string,
  system: string,
  user: string,
  maxTokens = 1024
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content.find((b) => b.type === "text")?.text ?? "";
}

// Strips markdown code fences if Claude wraps JSON in them
function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return JSON.parse(cleaned) as T;
}

// ── Criteria extraction ───────────────────────────────────────────

const CRITERIA_SYSTEM = `You are a recruiting intelligence assistant.
Given a plain-English job brief, extract structured hiring criteria as JSON.
Return ONLY valid JSON — no markdown fences, no commentary — matching this exact shape:

{
  "roleTitle": "string",
  "compensationRange": "string",
  "geoPreference": "string",
  "mustHaves": ["string"],
  "niceToHaves": ["string"],
  "disqualifiers": ["string"],
  "targetCompanies": ["string"],
  "avoidBackgrounds": ["string"],
  "hiringManagerNotes": "string",
  "searchRecipe": {
    "function": "string",
    "segment": "string",
    "industry": ["string"],
    "stageFit": ["string"],
    "seniority": "string",
    "evidenceSignals": ["string"],
    "exclusions": ["string"]
  }
}`;

export async function extractCriteria(
  brief: string,
  seed: SearchCriteria
): Promise<SearchCriteria> {
  if (!hasKey()) {
    return parseBriefToCriteria(brief, seed);
  }

  try {
    const raw = await claudeChat("claude-haiku-4-5-20251001", CRITERIA_SYSTEM, brief, 1024);
    const parsed = parseJson<Partial<SearchCriteria>>(raw);
    return {
      ...seed,
      ...parsed,
      searchRecipe: { ...seed.searchRecipe, ...parsed.searchRecipe },
    };
  } catch (err) {
    console.warn("[claude] extractCriteria failed, falling back to regex:", err);
    return parseBriefToCriteria(brief, seed);
  }
}

// ── Candidate scoring ─────────────────────────────────────────────

export interface AiCandidateScore {
  score: number;
  summary: string;
  signals: string[];
  risks: string[];
  outreachAngle: string;
}

const SCORING_SYSTEM = `You are a recruiting analyst. Evaluate how well a candidate profile
matches the hiring criteria. Return ONLY valid JSON — no markdown, no commentary:

{
  "score": number (0-100),
  "summary": "string (1-2 sentences explaining the fit)",
  "signals": ["string (what matched)"],
  "risks": ["string (gaps or concerns)"],
  "outreachAngle": "string (suggested personalisation hook for the outreach message)"
}`;

export async function scoreCandidate(
  candidate: {
    name: string;
    title: string;
    company: string;
    summary: string;
    experience: string;
  },
  criteria: SearchCriteria
): Promise<AiCandidateScore | null> {
  if (!hasKey()) return null;

  const prompt = `CRITERIA:
Role: ${criteria.roleTitle}
Must-haves: ${criteria.mustHaves.join(", ")}
Nice-to-haves: ${criteria.niceToHaves.join(", ")}
Disqualifiers: ${criteria.disqualifiers.join(", ")}
Industry: ${criteria.searchRecipe.industry.join(", ")}
Evidence signals: ${criteria.searchRecipe.evidenceSignals.join(", ")}

CANDIDATE:
Name: ${candidate.name}
Title: ${candidate.title} at ${candidate.company}
Summary: ${candidate.summary}
Experience: ${candidate.experience}`;

  try {
    const raw = await claudeChat("claude-sonnet-4-6", SCORING_SYSTEM, prompt, 512);
    return parseJson<AiCandidateScore>(raw);
  } catch (err) {
    console.warn("[claude] scoreCandidate failed:", err);
    return null;
  }
}

// ── Search keyword generation ─────────────────────────────────────

export async function generateSearchKeywords(
  criteria: SearchCriteria,
  brief?: string
): Promise<string[]> {
  if (!hasKey()) {
    // Caller provides its own fallback via fallbackKeywords() in route.ts
    throw new Error("No API key");
  }

  const input = brief
    ? `Brief: "${brief}"\n\nCriteria: ${JSON.stringify({ role: criteria.roleTitle, mustHaves: criteria.mustHaves, industry: criteria.searchRecipe.industry })}`
    : `Criteria: ${JSON.stringify({ role: criteria.roleTitle, mustHaves: criteria.mustHaves, industry: criteria.searchRecipe.industry })}`;

  const prompt = `You are a technical sourcing expert. Generate 6-10 concise search keywords to find matching candidates in GitHub profiles and Hacker News posts.

RULES:
- If the role involves a programming language (Go, Python, Rust, TypeScript, etc.), include the language name exactly as it appears in GitHub (e.g. "golang", "python", "rust")
- Prefer specific technical terms over generic ones ("golang" not "software engineering")
- Include short skill/tool names (1-2 words max each)
- Do NOT include stop words, generic terms like "software", "developer", "engineer" alone
- Return ONLY a JSON array of strings

${input}

Example output for "senior golang backend engineer": ["golang", "go", "backend", "distributed systems", "microservices"]`;

  try {
    const raw = await claudeChat("claude-haiku-4-5-20251001", "", prompt, 256);
    const parsed = parseJson<string[] | { keywords: string[] }>(raw);
    const result = Array.isArray(parsed) ? parsed : parsed.keywords ?? [];
    return result.filter((k): k is string => typeof k === "string" && k.length > 0);
  } catch {
    throw new Error("Claude keyword generation failed");
  }
}

// ── Search intent parsing ─────────────────────────────────────────

/**
 * Turn a short natural-language recruiter query ("founding AE sold identity security")
 * into a structured SearchCriteria that can be fed to rankCandidates().
 */
export async function parseSearchIntent(query: string): Promise<Partial<SearchCriteria>> {
  if (!hasKey()) {
    // Minimal regex fallback
    return { roleTitle: query, mustHaves: [query] };
  }

  const prompt = `A recruiter typed this search query: "${query}"

Extract their intent as a structured hiring criteria object. Return ONLY valid JSON:
{
  "roleTitle": "inferred role title",
  "mustHaves": ["specific skills, experiences, or credentials they clearly need"],
  "niceToHaves": ["things they'd probably want but didn't explicitly state"],
  "targetCompanies": ["specific companies mentioned or strongly implied"],
  "geoPreference": "location if mentioned",
  "searchRecipe": {
    "industry": ["industry or domain"],
    "seniority": "seniority level if implied",
    "evidenceSignals": ["things that would prove fit — e.g. 'closed 7-figure deals', 'worked at Series B startup'"]
  }
}

Be specific. If they say "AE who sold identity security" → mustHaves: ["identity security sales", "account executive"].
If they mention a company name, add it to targetCompanies.
Return only the JSON, no commentary.`;

  try {
    const raw = await claudeChat("claude-haiku-4-5-20251001", "", prompt, 512);
    return parseJson<Partial<SearchCriteria>>(raw);
  } catch {
    return { roleTitle: query, mustHaves: [query] };
  }
}

export { hasKey as claudeEnabled };
