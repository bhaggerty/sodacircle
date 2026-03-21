/**
 * POST /api/search
 *
 * Parse a natural-language query into structured criteria.
 * The client uses those criteria to re-rank its local candidate pool.
 *
 * Body:  { query: string }
 * Response: { criteria: Partial<SearchCriteria>, parsedIntent: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { parseSearchIntent } from "@/lib/claude";
import { SearchCriteria } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { query } = await req.json() as { query: string };

  if (!query?.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const criteria = await parseSearchIntent(query.trim());

  // Build a human-readable summary of what we parsed
  const parts: string[] = [];
  if (criteria.roleTitle) parts.push(criteria.roleTitle);
  if (criteria.searchRecipe?.industry?.length) parts.push(criteria.searchRecipe.industry.join(", "));
  if (criteria.mustHaves?.length) parts.push(`needs: ${criteria.mustHaves.slice(0, 2).join(", ")}`);
  if (criteria.geoPreference) parts.push(criteria.geoPreference);
  const parsedIntent = parts.join(" · ");

  return NextResponse.json({ criteria, parsedIntent });
}
