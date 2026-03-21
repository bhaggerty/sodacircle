/**
 * GitHub sourcing — searches users by keywords derived from search criteria.
 * Uses the public GitHub search API (60 req/hr unauthenticated, 5000/hr with token).
 * Set GITHUB_TOKEN in .env.local for higher rate limits.
 */

export interface SourcedCandidate {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  email: string;
  linkedinUrl: string;
  summary: string;
  experience: string;
  notes: string;
  sourceUrl: string;
  sourceName: "github" | "hn" | "web";
}

interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  bio: string | null;
  blog: string | null;
  html_url: string;
  public_repos: number;
  followers: number;
  hireable: boolean | null;
}

async function githubFetch(url: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "sodacircle-recruiting/1.0",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers, next: { revalidate: 300 } });
}

/**
 * Distil long phrases into short bio-friendly terms.
 * "Enterprise quota-carrying sales" → ["sales", "enterprise"]
 * "Cybersecurity or identity adjacency" → ["cybersecurity", "security"]
 */
function distilKeywords(keywords: string[]): string[] {
  const stopWords = new Set([
    "or", "and", "the", "a", "an", "of", "in", "at", "to", "for",
    "with", "only", "no", "not", "only", "background", "adjacency",
    "evidence", "history", "preference", "comfort", "mentality",
  ]);

  const short: string[] = [];
  for (const kw of keywords) {
    // If the keyword is already short and clean, use it directly
    if (kw.length <= 20 && !kw.includes(" ")) {
      short.push(kw.toLowerCase());
      continue;
    }
    // Split on spaces and common separators, keep meaningful tokens
    const tokens = kw
      .toLowerCase()
      .split(/[\s,/+&-]+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ""))
      .filter((t) => t.length >= 4 && !stopWords.has(t));
    short.push(...tokens);
  }

  // Deduplicate and cap at 4 terms (GitHub query length limit)
  return [...new Set(short)].slice(0, 4);
}

function buildGithubQuery(keywords: string[], location?: string): string {
  const terms = distilKeywords(keywords);
  // Use OR so we cast a wide net — requiring all terms returns almost nothing
  const bioClause = terms.map((k) => `"${k}" in:bio`).join(" OR ");
  const parts = [`(${bioClause})`];
  if (location) {
    // Extract just the region name, not "Remote (US) with West Coast preference"
    const region = location.replace(/remote.*?with\s*/i, "").replace(/preference/i, "").trim().split(/[,(]/)[0].trim();
    if (region && region.length < 30) parts.push(`location:"${region}"`);
  }
  parts.push("followers:>5");
  return parts.join(" ");
}

export async function searchGithub(
  keywords: string[],
  location?: string,
  maxResults = 12
): Promise<SourcedCandidate[]> {
  const q = buildGithubQuery(keywords, location);
  const url = `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=${Math.min(maxResults * 2, 30)}&sort=followers`;

  const searchRes = await githubFetch(url);
  if (!searchRes.ok) {
    const msg = await searchRes.text();
    throw new Error(`GitHub search failed (${searchRes.status}): ${msg}`);
  }

  const searchData = await searchRes.json() as { items: Array<{ login: string }> };
  const logins = (searchData.items ?? []).slice(0, maxResults).map((u) => u.login);

  // Fetch full profiles in parallel (capped to avoid rate limits)
  const profiles = await Promise.all(
    logins.map(async (login) => {
      try {
        const r = await githubFetch(`https://api.github.com/users/${login}`);
        if (!r.ok) return null;
        return r.json() as Promise<GithubUser>;
      } catch {
        return null;
      }
    })
  );

  return profiles
    .filter((p): p is GithubUser => p !== null && !!(p.name || p.login))
    .map((p): SourcedCandidate => ({
      id: `gh-${p.id}`,
      name: p.name || p.login,
      title: extractTitleFromBio(p.bio) || "Software Professional",
      company: (p.company || "").replace(/^@/, "").trim(),
      location: p.location || "",
      email: p.email || "",
      linkedinUrl: p.blog?.includes("linkedin.com") ? p.blog : "",
      summary: p.bio || "",
      experience: buildGithubExperience(p),
      notes: `Sourced from GitHub · ${p.followers} followers · ${p.public_repos} repos`,
      sourceUrl: p.html_url,
      sourceName: "github",
    }));
}

function extractTitleFromBio(bio: string | null): string {
  if (!bio) return "";
  // Common patterns: "Senior Engineer at X", "CTO @ Y", "Building Z"
  const titlePatterns = [
    /^([^.\n|–-]{5,60})\s+at\s+/i,
    /^([^.\n|–-]{5,60})\s*@\s+/i,
    /^((?:VP|CTO|CFO|CEO|CPO|Head of|Director of|Senior|Lead|Staff|Principal)[^.\n]{3,50})/i,
    /^([^.\n]{5,60})\s*[|\-–]/,
  ];
  for (const p of titlePatterns) {
    const m = bio.match(p);
    if (m) return m[1].trim().slice(0, 80);
  }
  return bio.split("\n")[0].trim().slice(0, 80);
}

function buildGithubExperience(p: GithubUser): string {
  const parts: string[] = [];
  if (p.company) parts.push(p.company.replace(/^@/, "").trim());
  parts.push(`${p.public_repos} public repos`);
  parts.push(`${p.followers} GitHub followers`);
  if (p.hireable) parts.push("open to work");
  return parts.join(" · ");
}
