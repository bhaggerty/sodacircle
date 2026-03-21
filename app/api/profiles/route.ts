// file: app/api/profiles/route.ts
//
// GET /api/profiles?q=&limit=50&domain=identity&skill=go
//
// Supports:
//   q       — text search across name/title/company/bio/skills
//   domain  — filter by domainTags (e.g. identity, security, platform)
//   skill   — filter by a specific skill tag
//   source  — "github" | "web"
//   limit   — max results (default 50, max 200)

import { NextRequest, NextResponse } from "next/server";
import { fetchAllProfiles } from "@/lib/search/retrieveCandidates";
import { countProfiles } from "@/lib/crawler/store";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q      = searchParams.get("q")?.trim() ?? "";
  const domain = searchParams.get("domain")?.trim().toLowerCase() ?? "";
  const skill  = searchParams.get("skill")?.trim().toLowerCase() ?? "";
  const source = searchParams.get("source")?.trim() ?? "";
  const limit  = Math.min(200, parseInt(searchParams.get("limit") ?? "50", 10));

  const [allProfiles, total] = await Promise.all([
    fetchAllProfiles(),
    countProfiles(),
  ]);

  let profiles = allProfiles;

  // Domain filter
  if (domain) {
    profiles = profiles.filter((p) =>
      (p.domainTags ?? []).some((d) => d.includes(domain)) ||
      (p.inferredDomain ?? "").includes(domain)
    );
  }

  // Skill filter
  if (skill) {
    profiles = profiles.filter((p) =>
      [...(p.skills ?? []), ...(p.skillTags ?? [])].some((s) =>
        s.toLowerCase().includes(skill)
      )
    );
  }

  // Source filter
  if (source === "github" || source === "web") {
    profiles = profiles.filter((p) => p.sourceName === source);
  }

  // Text search
  if (q) {
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    profiles = profiles
      .map((p) => {
        const hay = [
          p.name, p.title, p.company, p.bio, p.location,
          ...(p.skills ?? []), ...(p.domainTags ?? []), ...(p.priorCompanies ?? []),
        ].join(" ").toLowerCase();
        const score = terms.filter((t) => hay.includes(t)).length;
        return { p, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ p }) => p);
  }

  return NextResponse.json({
    profiles: profiles.slice(0, limit),
    total,
    filtered: profiles.length,
    query: q,
    filters: { domain, skill, source },
  });
}
