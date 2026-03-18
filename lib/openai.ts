/**
 * OpenAI integration — criteria extraction and candidate scoring.
 *
 * Activated automatically when OPENAI_API_KEY is present in environment.
 * Falls back to the existing regex-based logic if no key is set.
 *
 * Models used:
 *   - gpt-4o-mini for criteria extraction (cheap, fast)
 *   - gpt-4o for candidate scoring (better reasoning)
 */

import { SearchCriteria } from "@/lib/types";
import { parseBriefToCriteria } from "@/lib/ai";

const hasKey = () => !!(process.env.OPENAI_API_KEY);

// ── OpenAI fetch wrapper ──────────────────────────────────────────

async function openaiChat(
  model: string,
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  jsonMode = false
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI error (${res.status}): ${err}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

// ── Criteria extraction ───────────────────────────────────────────

const CRITERIA_SYSTEM = `You are a recruiting intelligence assistant.
Given a plain-English job brief, extract structured hiring criteria as JSON.
Return ONLY valid JSON matching this exact shape — no markdown, no commentary:

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
    // Regex fallback — already implemented in lib/ai.ts
    return parseBriefToCriteria(brief, seed);
  }

  try {
    const raw = await openaiChat(
      "gpt-4o-mini",
      [
        { role: "system", content: CRITERIA_SYSTEM },
        { role: "user", content: brief },
      ],
      true
    );
    const parsed = JSON.parse(raw) as Partial<SearchCriteria>;
    // Merge with seed so no fields go missing
    return { ...seed, ...parsed, searchRecipe: { ...seed.searchRecipe, ...parsed.searchRecipe } };
  } catch (err) {
    console.warn("[openai] extractCriteria failed, falling back to regex:", err);
    return parseBriefToCriteria(brief, seed);
  }
}

// ── Candidate scoring ─────────────────────────────────────────────

export interface AiCandidateScore {
  score: number;          // 0–100
  summary: string;        // 1–2 sentence fit explanation
  signals: string[];      // what matched
  risks: string[];        // gaps or concerns
  outreachAngle: string;  // suggested personalisation hook
}

const SCORING_SYSTEM = `You are a recruiting analyst.
Evaluate how well a candidate profile matches the hiring criteria.
Return ONLY valid JSON — no markdown, no commentary:

{
  "score": number (0-100),
  "summary": "string (1-2 sentences)",
  "signals": ["string"],
  "risks": ["string"],
  "outreachAngle": "string"
}`;

export async function scoreCandidate(
  candidate: { name: string; title: string; company: string; summary: string; experience: string },
  criteria: SearchCriteria
): Promise<AiCandidateScore | null> {
  if (!hasKey()) return null;

  const prompt = `
CRITERIA:
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
Experience: ${candidate.experience}
`.trim();

  try {
    const raw = await openaiChat(
      "gpt-4o",
      [
        { role: "system", content: SCORING_SYSTEM },
        { role: "user", content: prompt },
      ],
      true
    );
    return JSON.parse(raw) as AiCandidateScore;
  } catch (err) {
    console.warn("[openai] scoreCandidate failed:", err);
    return null;
  }
}

// ── Search keyword generation ─────────────────────────────────────

export async function generateSearchKeywords(criteria: SearchCriteria): Promise<string[]> {
  if (!hasKey()) {
    // Fallback: derive keywords directly from criteria
    return [
      criteria.roleTitle,
      ...criteria.mustHaves,
      ...criteria.searchRecipe.industry,
      ...criteria.searchRecipe.evidenceSignals.slice(0, 2),
    ].filter(Boolean);
  }

  try {
    const prompt = `Given this hiring criteria, generate 6-10 short search keywords (single words or short phrases)
that would help find matching candidates on GitHub bios and HN profiles.
Criteria: ${JSON.stringify({ role: criteria.roleTitle, mustHaves: criteria.mustHaves, industry: criteria.searchRecipe.industry })}
Return a JSON array of strings. Example: ["enterprise sales", "cybersecurity", "SaaS", "B2B"]`;

    const raw = await openaiChat("gpt-4o-mini", [{ role: "user", content: prompt }], true);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.keywords ?? [];
  } catch {
    return [criteria.roleTitle, ...criteria.searchRecipe.industry];
  }
}

export { hasKey as openAiEnabled };
