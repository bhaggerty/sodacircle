/**
 * POST /api/source
 *
 * Runs real sourcing across GitHub and HN, normalises results to the
 * sodacircle Candidate shape, and returns them.
 *
 * Body: { criteria: SearchCriteria, sources?: ("github" | "hn")[], brief?: string }
 * Response: { candidates: Candidate[], counts: Record<string, number>, keywords: string[], errors: string[], total: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { searchGithub } from "@/lib/sources/github";
import { searchHn, searchHnByKeyword } from "@/lib/sources/hn";
import { generateSearchKeywords } from "@/lib/claude";
import { SearchCriteria, Candidate } from "@/lib/types";
import { appendProfile } from "@/lib/crawler/store";

function dedup(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = c.linkedinUrl || `${c.name.toLowerCase()}|${c.company.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    criteria: SearchCriteria;
    sources?: ("github" | "hn")[];
    brief?: string;
  };

  const { criteria, brief } = body;
  const sources = body.sources ?? ["github", "hn"];

  const errors: string[] = [];
  const counts: Record<string, number> = {};
  let allCandidates: Candidate[] = [];

  // ── Build search keywords ────────────────────────────────────────
  let keywords: string[];
  try {
    keywords = await generateSearchKeywords(criteria, brief);
  } catch {
    keywords = fallbackKeywords(criteria, brief);
  }

  console.log(`[source] keywords=${JSON.stringify(keywords)} geo="${criteria.geoPreference}"`);

  // ── GitHub ───────────────────────────────────────────────────────
  if (sources.includes("github")) {
    try {
      const results = await searchGithub(keywords, criteria.geoPreference, 15);
      counts.github = results.length;
      allCandidates.push(
        ...results.map((r) => ({
          id: r.id,
          name: r.name,
          title: r.title,
          company: r.company,
          location: r.location,
          email: r.email,
          linkedinUrl: r.linkedinUrl,
          summary: r.summary,
          experience: r.experience,
          notes: r.notes,
          sourceName: r.sourceName,
          codeQuality: r.codeQuality,
        } satisfies Candidate))
      );
    } catch (err) {
      const msg = `GitHub: ${String(err)}`;
      errors.push(msg);
      console.error("[source/github]", msg);
      counts.github = 0;
    }
  }

  // ── Hacker News ──────────────────────────────────────────────────
  if (sources.includes("hn")) {
    try {
      const [threadResults, keywordResults] = await Promise.all([
        searchHn(keywords, criteria.geoPreference, 15),
        searchHnByKeyword(keywords.slice(0, 2).join(" "), criteria.geoPreference, 10),
      ]);

      const hnSeen = new Set<string>();
      const hnUnique = [...threadResults, ...keywordResults].filter((c) => {
        if (hnSeen.has(c.id)) return false;
        hnSeen.add(c.id);
        return true;
      });

      counts.hn = hnUnique.length;
      allCandidates.push(
        ...hnUnique.map((r) => ({
          id: r.id,
          name: r.name,
          title: r.title,
          company: r.company,
          location: r.location,
          email: r.email,
          linkedinUrl: r.linkedinUrl,
          summary: r.summary,
          experience: r.experience,
          notes: r.notes,
        } satisfies Candidate))
      );
    } catch (err) {
      const msg = `HN: ${String(err)}`;
      errors.push(msg);
      console.error("[source/hn]", msg);
      counts.hn = 0;
    }
  }

  const candidates = dedup(allCandidates);

  // Persist sourced candidates to DynamoDB so they appear in profile search.
  // Fire-and-forget — don't block the response.
  Promise.allSettled(
    candidates.map((c) =>
      appendProfile({
        id:          c.id,
        name:        c.name,
        title:       c.title,
        company:     c.company,
        location:    c.location,
        bio:         c.summary,
        skills:      [],
        email:       c.email,
        githubUrl:   "",
        linkedinUrl: c.linkedinUrl,
        sourceUrl:   "",
        sourceName:  c.sourceName === "github" ? "github" : "web",
        indexedAt:   new Date().toISOString(),
      })
    )
  ).catch(() => {});

  return NextResponse.json({
    candidates,
    counts,
    keywords,
    errors,
    total: candidates.length,
  });
}

/**
 * Keyword fallback when Claude is unavailable.
 * Tokenizes both criteria fields and the raw brief to extract meaningful terms.
 */
function fallbackKeywords(criteria: SearchCriteria, brief?: string): string[] {
  const stopWords = new Set([
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "as", "is", "was", "are", "be", "been",
    "that", "this", "it", "they", "we", "you", "he", "she",
    "have", "has", "had", "will", "would", "could", "should",
    "who", "what", "where", "when", "how", "why",
    "need", "want", "looking", "seeking", "hiring",
  ]);

  // Collect all text sources
  const sources = [
    brief ?? "",
    criteria.roleTitle,
    ...criteria.mustHaves,
    ...criteria.searchRecipe.industry,
    ...criteria.searchRecipe.evidenceSignals.slice(0, 3),
  ].filter(Boolean);

  // Tokenize and score: prefer short specific words (2-15 chars)
  const freq: Record<string, number> = {};
  for (const src of sources) {
    const words = src
      .toLowerCase()
      .split(/[\s,/+&()\[\]]+/)
      .map((w) => w.replace(/[^a-z0-9#.+]/g, ""))
      .filter((w) => w.length >= 2 && w.length <= 20 && !stopWords.has(w));
    for (const w of words) {
      freq[w] = (freq[w] ?? 0) + 1;
    }
  }

  // Sort by frequency, prefer shorter more specific terms
  return Object.entries(freq)
    .sort(([a, fa], [b, fb]) => fb - fa || a.length - b.length)
    .map(([w]) => w)
    .slice(0, 8);
}
