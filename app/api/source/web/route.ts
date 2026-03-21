/**
 * POST /api/source/web
 *
 * Crawls public company pages and extracts person profiles.
 * Respects robots.txt. Only fetches publicly accessible pages.
 *
 * Body: { urls: string[], geoPreference?: string, limit?: number }
 * Response: { candidates: Candidate[], errors: string[], pagesVisited: number, total: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { crawlForPeople } from "@/lib/sources/web";
import { Candidate } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    urls: string[];
    geoPreference?: string;
    limit?: number;
  };

  const { urls, geoPreference = "", limit = 30 } = body;

  if (!urls?.length) {
    return NextResponse.json({ error: "urls array is required" }, { status: 400 });
  }

  const result = await crawlForPeople(urls, geoPreference, Math.min(limit, 50));

  const candidates: Candidate[] = result.candidates.map((r) => ({
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
    sourceName: "web" as const,
  }));

  return NextResponse.json({
    candidates,
    errors: result.errors,
    pagesVisited: result.pagesVisited,
    sourceSummary: result.sourceSummary,
    total: candidates.length,
  });
}
