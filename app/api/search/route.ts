// file: app/api/search/route.ts
//
// POST /api/search
//
// Full pipeline: parse → expand → retrieve → rerank → return results + metadata.
//
// Body:  { query: string, limit?: number }
// Response: { results: RankedResult[], parsedIntent: string, expandedTerms: string[], totalRetrieved: number }

import { NextRequest, NextResponse } from "next/server";
import { parseQuery } from "@/lib/search/parseQuery";
import { retrieveCandidates } from "@/lib/search/retrieveCandidates";
import { rerank, RankedResult } from "@/lib/search/rerank";
import { writeSearchLog } from "@/lib/search/searchLog";

export interface SearchResponse {
  results: RankedResult[];
  parsedIntent: string;
  expandedTerms: string[];
  domainTags: string[];
  totalRetrieved: number;
  durationMs: number;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const body = await req.json().catch(() => ({})) as { query?: string; limit?: number };

  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const limit = Math.min(body.limit ?? 20, 50);

  // Step 1: Parse + expand
  const parsed = await parseQuery(query);

  // Step 2: Retrieve from DynamoDB
  const retrieved = await retrieveCandidates(parsed, 40);

  // Step 3: Rerank with Claude Sonnet
  const ranked = await rerank(parsed, retrieved);

  // Step 4: Return top N
  const results = ranked.slice(0, limit);

  // Build human-readable intent summary
  const intentParts: string[] = [];
  if (parsed.roleTitle) intentParts.push(parsed.roleTitle);
  if (parsed.domainTags.length) intentParts.push(parsed.domainTags.join(", "));
  if (parsed.seniority) intentParts.push(parsed.seniority);
  if (parsed.geoPreference) intentParts.push(parsed.geoPreference);
  const parsedIntent = intentParts.join(" · ") || query;

  const durationMs = Date.now() - t0;

  // Log search (fire-and-forget, don't block response)
  writeSearchLog({
    query,
    parsedIntent,
    domainTags: parsed.domainTags,
    expandedTermCount: parsed.expandedTerms.length,
    retrievedCount: retrieved.length,
    returnedCount: results.length,
    durationMs,
  }).catch(() => {});

  return NextResponse.json({
    results,
    parsedIntent,
    expandedTerms: parsed.expandedTerms.slice(0, 15),
    domainTags: parsed.domainTags,
    totalRetrieved: retrieved.length,
    durationMs,
  } satisfies SearchResponse);
}
