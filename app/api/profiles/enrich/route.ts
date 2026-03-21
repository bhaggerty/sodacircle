// file: app/api/profiles/enrich/route.ts
//
// POST /api/profiles/enrich
//
// Triggers GitHub enrichment for one profile or a batch.
//
// Single:  { id: string }
// Batch:   { batch: true, limit?: number }  — enriches up to `limit` profiles missing githubStats
//
// Response (single): { ok, enriched?, error? }
// Response (batch):  { enriched, errors, skipped }

import { NextRequest, NextResponse } from "next/server";
import { enrichProfileWithGitHub, enrichProfilesBatch } from "@/lib/profiles/enrichProfile";
import { fetchAllProfiles } from "@/lib/search/retrieveCandidates";
import { EnrichedProfile } from "@/lib/profiles/normalizeProfile";
import { GitHubStats } from "@/lib/profiles/enrichProfile";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    id?: string;
    batch?: boolean;
    limit?: number;
  };

  // ── Single enrichment ─────────────────────────────────────────────────────
  if (body.id) {
    const result = await enrichProfileWithGitHub(body.id);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  // ── Batch enrichment ──────────────────────────────────────────────────────
  if (body.batch) {
    const limit = Math.min(body.limit ?? 20, 100);
    const all = await fetchAllProfiles() as Array<EnrichedProfile & { githubStats?: GitHubStats }>;
    const result = await enrichProfilesBatch(all, limit);
    return NextResponse.json({ ...result, skipped: all.length - result.enriched - result.errors });
  }

  return NextResponse.json({ error: "Provide id or batch:true" }, { status: 400 });
}
