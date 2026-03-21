/**
 * POST /api/criteria
 * Extracts structured SearchCriteria from a plain-English brief using Claude.
 * Falls back to the regex parser if no API key is set.
 */

import { NextRequest, NextResponse } from "next/server";
import { extractCriteria } from "@/lib/claude";
import { SearchCriteria } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { brief, seed } = await req.json() as { brief: string; seed: SearchCriteria };

  if (!brief?.trim()) {
    return NextResponse.json(seed);
  }

  const result = await extractCriteria(brief, seed);
  return NextResponse.json(result);
}
