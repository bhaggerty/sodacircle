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

export async function generateSearchKeywords(criteria: SearchCriteria): Promise<string[]> {
  if (!hasKey()) {
    return [
      criteria.roleTitle,
      ...criteria.mustHaves,
      ...criteria.searchRecipe.industry,
      ...criteria.searchRecipe.evidenceSignals.slice(0, 2),
    ].filter(Boolean);
  }

  const prompt = `Given this hiring criteria, generate 6-10 short search keywords (single words or short phrases)
that would help find matching candidates in GitHub bios and Hacker News profiles.
Criteria: ${JSON.stringify({
    role: criteria.roleTitle,
    mustHaves: criteria.mustHaves,
    industry: criteria.searchRecipe.industry,
  })}
Return a JSON array of strings only. Example: ["enterprise sales", "cybersecurity", "SaaS", "B2B"]`;

  try {
    const raw = await claudeChat("claude-haiku-4-5-20251001", "", prompt, 256);
    const parsed = parseJson<string[] | { keywords: string[] }>(raw);
    return Array.isArray(parsed) ? parsed : parsed.keywords ?? [];
  } catch {
    return [criteria.roleTitle, ...criteria.searchRecipe.industry];
  }
}

export { hasKey as claudeEnabled };
