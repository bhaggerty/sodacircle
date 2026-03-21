/**
 * GET /api/profiles?q=query&limit=50
 */

import { NextRequest, NextResponse } from "next/server";
import { searchProfiles, readProfiles, countProfiles } from "@/lib/crawler/store";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q     = searchParams.get("q") ?? "";
  const limit = Math.min(200, parseInt(searchParams.get("limit") ?? "50", 10));

  const [result, total] = await Promise.all([
    q.trim() ? searchProfiles(q.trim(), limit) : readProfiles(limit).then((r) => r.profiles),
    countProfiles(),
  ]);

  return NextResponse.json({ profiles: result, total, query: q });
}
