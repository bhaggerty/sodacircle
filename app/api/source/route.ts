/**
 * POST /api/source
 *
 * Runs real sourcing across GitHub and HN, normalises results to the
 * sodacircle Candidate shape, and returns them.
 *
 * Body: { criteria: SearchCriteria, sources?: ("github" | "hn")[] }
 * Response: { candidates: Candidate[], counts: Record<string, number>, errors: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { searchGithub } from "@/lib/sources/github";
import { searchHn, searchHnByKeyword } from "@/lib/sources/hn";
import { generateSearchKeywords } from "@/lib/openai";
import { SearchCriteria, Candidate } from "@/lib/types";

function dedup(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    // Dedup by LinkedIn URL (if present) or by name+company
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
  };

  const { criteria } = body;
  const sources = body.sources ?? ["github", "hn"];

  const errors: string[] = [];
  const counts: Record<string, number> = {};
  let allCandidates: Candidate[] = [];

  // ── Build search keywords ────────────────────────────────────────
  let keywords: string[];
  try {
    keywords = await generateSearchKeywords(criteria);
  } catch {
    // Fallback if OpenAI is unavailable
    keywords = [
      criteria.roleTitle,
      ...criteria.mustHaves.slice(0, 2),
      ...criteria.searchRecipe.industry.slice(0, 2),
    ].filter(Boolean);
  }

  // ── GitHub ───────────────────────────────────────────────────────
  if (sources.includes("github")) {
    try {
      const results = await searchGithub(
        keywords,
        criteria.geoPreference,
        12
      );
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
        searchHn(keywords, 12),
        searchHnByKeyword(keywords.slice(0, 2).join(" "), 8),
      ]);

      // Merge and dedup HN results
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

  // ── Dedup across all sources ─────────────────────────────────────
  const candidates = dedup(allCandidates);

  return NextResponse.json({
    candidates,
    counts,
    keywords,
    errors,
    total: candidates.length,
  });
}
