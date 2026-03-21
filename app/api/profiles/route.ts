/**
 * GET /api/profiles?q=query&limit=50&offset=0
 */

import { NextRequest, NextResponse } from "next/server";
import { searchProfiles, readProfiles, countProfiles } from "@/lib/crawler/store";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q      = searchParams.get("q") ?? "";
  const limit  = Math.min(200, parseInt(searchParams.get("limit") ?? "50", 10));
  const offset = parseInt(searchParams.get("offset") ?? "0", 10);

  const profiles = q.trim()
    ? searchProfiles(q.trim(), limit)
    : readProfiles(limit, offset);

  return NextResponse.json({
    profiles,
    total: countProfiles(),
    query: q,
  });
}
