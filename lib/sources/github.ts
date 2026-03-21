/**
 * GitHub sourcing — multi-strategy search using language filters + bio search.
 *
 * Strategy 1 (tech roles): language:Go location:"United States" — most reliable
 * Strategy 2 (bio search): "golang" in:bio,name location:"United States"
 * Both run in parallel; results merged and deduplicated.
 *
 * Rate limits: 60 req/hr unauthenticated, 5000/hr with GITHUB_TOKEN.
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

// ── Language detection ────────────────────────────────────────────
// Maps keyword → GitHub language name for the language: filter

const LANG_MAP: Record<string, string> = {
  golang: "Go", go: "Go",
  python: "Python", py: "Python", django: "Python", flask: "Python",
  rust: "Rust",
  javascript: "JavaScript", js: "JavaScript", node: "JavaScript",
  nodejs: "JavaScript", "node.js": "JavaScript", react: "JavaScript",
  typescript: "TypeScript", ts: "TypeScript",
  java: "Java", spring: "Java",
  kotlin: "Kotlin",
  swift: "Swift", ios: "Swift",
  ruby: "Ruby", rails: "Ruby", "ruby on rails": "Ruby",
  scala: "Scala",
  "c++": "C++", cpp: "C++",
  elixir: "Elixir",
  clojure: "Clojure",
  haskell: "Haskell",
  php: "PHP", laravel: "PHP",
  "c#": "C#", csharp: "C#", dotnet: "C#", ".net": "C#",
  r: "R",
  matlab: "MATLAB",
  solidity: "Solidity",
  dart: "Dart", flutter: "Dart",
};

function detectGithubLanguage(keywords: string[]): string | null {
  for (const kw of keywords) {
    const lang = LANG_MAP[kw.toLowerCase()];
    if (lang) return lang;
  }
  return null;
}

// ── Location normalization ────────────────────────────────────────
// Converts any geo string into something GitHub's location filter understands.

function normalizeGeoForGithub(geo: string): string {
  if (!geo) return "";
  const lower = geo.toLowerCase().trim();

  // Explicit US patterns
  if (/\b(united states|usa|u\.s\.a?\.|america)\b/.test(lower)) return "United States";
  if (/remote\s*\(?\s*(us|usa)\s*\)?/.test(lower)) return "United States";
  if (/\bus\s*only\b/.test(lower)) return "United States";

  // "Remote" alone or with no country context → no location filter (worldwide remote)
  if (/^remote$/i.test(lower.trim())) return "";

  // Major US cities
  if (/\bnyc\b|new york city/.test(lower) && !/uk|england/.test(lower)) return "New York";
  if (/new york/.test(lower) && !/uk|england/.test(lower)) return "New York";
  if (/\b(sf|bay area|silicon valley)\b/.test(lower)) return "San Francisco";
  if (/san francisco/.test(lower)) return "San Francisco";
  if (/\bseattle\b/.test(lower)) return "Seattle";
  if (/los angeles|\bla\b|\bsocal\b/.test(lower)) return "Los Angeles";
  if (/\baustin\b/.test(lower)) return "Austin";
  if (/\bboston\b/.test(lower)) return "Boston";
  if (/\bchicago\b/.test(lower)) return "Chicago";
  if (/\bdenver\b/.test(lower)) return "Denver";
  if (/\batlanta\b/.test(lower)) return "Atlanta";
  if (/\bmiami\b/.test(lower)) return "Miami";
  if (/\bportland\b/.test(lower)) return "Portland";

  // Coast/region → use United States
  if (/west coast|east coast|midwest|pacific northwest/.test(lower)) return "United States";

  // "Remote (US)" or "Remote + any US signal"
  if (/remote/.test(lower) && /\b(us|usa|west|east|north america|american)\b/.test(lower)) {
    return "United States";
  }

  // Generic cleanup: strip "remote", qualifiers, take first clean token
  const cleaned = geo
    .replace(/\bremote\b\s*(\([^)]+\))?/gi, (_, m) => (m ? m.slice(1, -1) : ""))
    .replace(/\bwith\b.*/i, "")
    .replace(/\bpreference\b.*/i, "")
    .replace(/\bonly\b/i, "")
    .replace(/\bfriendly\b/i, "")
    .trim()
    .split(/[,(]/)[0]
    .trim();

  if (cleaned.length >= 3 && cleaned.length <= 40) return cleaned;
  return "";
}

// ── Location post-filter ──────────────────────────────────────────
// Exclude candidates who are clearly outside the target region.

const NON_US_MARKERS = [
  "london", "united kingdom", " uk", "england", "scotland", "wales",
  "germany", "berlin", "munich", "frankfurt", "hamburg",
  "france", "paris", "lyon",
  "india", "bangalore", "bengaluru", "mumbai", "delhi", "hyderabad", "pune", "chennai",
  "china", "beijing", "shanghai", "shenzhen", "hong kong",
  "canada", "toronto", "vancouver", "montreal", "ottawa",
  "australia", "sydney", "melbourne", "brisbane", "perth",
  "netherlands", "amsterdam", "rotterdam",
  "spain", "madrid", "barcelona",
  "italy", "rome", "milan",
  "japan", "tokyo", "osaka",
  "singapore",
  "brazil", "são paulo", "sao paulo", "rio de janeiro",
  "pakistan", "islamabad", "lahore", "karachi",
  "nigeria", "lagos", "abuja",
  "kenya", "nairobi",
  "south africa", "cape town", "johannesburg",
  "poland", "warsaw", "krakow",
  "ukraine", "kyiv", "kharkiv",
  "sweden", "stockholm", "gothenburg",
  "norway", "oslo",
  "denmark", "copenhagen",
  "switzerland", "zurich", "geneva",
  "finland", "helsinki",
  "austria", "vienna",
  "belgium", "brussels",
  "new zealand", "auckland",
  "israel", "tel aviv",
  "turkey", "istanbul",
  "mexico", "mexico city",
  "argentina", "buenos aires",
  "colombia", "bogota",
];

function isLocationMatch(candidateLocation: string, targetRegion: string): boolean {
  if (!targetRegion) return true;
  if (!candidateLocation) return true; // No info — don't filter out

  const cloc = candidateLocation.toLowerCase();
  const target = targetRegion.toLowerCase();

  const isUsSearch = /united states|new york|san francisco|seattle|austin|boston|chicago|denver/.test(target);
  if (isUsSearch) {
    // Explicitly exclude known non-US locations
    return !NON_US_MARKERS.some((m) => cloc.includes(m));
  }

  return true;
}

// ── GitHub API fetch ──────────────────────────────────────────────

async function githubFetch(url: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "sodacircle-recruiting/1.0",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { headers, next: { revalidate: 300 } });
}

async function runGithubQuery(q: string, maxItems: number): Promise<string[]> {
  const url = `https://api.github.com/search/users?q=${encodeURIComponent(q)}&per_page=${Math.min(maxItems, 30)}&sort=followers`;
  const res = await githubFetch(url);
  if (!res.ok) {
    const msg = await res.text();
    console.warn(`[github] query failed (${res.status}): ${msg.slice(0, 200)}`);
    return [];
  }
  const data = await res.json() as { items?: Array<{ login: string }> };
  return (data.items ?? []).map((u) => u.login);
}

// ── Keyword distillation ──────────────────────────────────────────

function distilKeywords(keywords: string[]): string[] {
  const stopWords = new Set([
    "or", "and", "the", "a", "an", "of", "in", "at", "to", "for",
    "with", "only", "no", "not", "background", "adjacency",
    "evidence", "history", "preference", "comfort", "mentality",
    "senior", "junior", "mid", "lead", "staff", "principal",
  ]);

  const short: string[] = [];
  for (const kw of keywords) {
    if (kw.length <= 20 && !kw.includes(" ")) {
      short.push(kw.toLowerCase());
      continue;
    }
    const tokens = kw
      .toLowerCase()
      .split(/[\s,/+&-]+/)
      .map((t) => t.replace(/[^a-z0-9#.]/g, ""))
      .filter((t) => t.length >= 3 && !stopWords.has(t));
    short.push(...tokens);
  }

  return [...new Set(short)].slice(0, 6);
}

// ── Main export ───────────────────────────────────────────────────

export async function searchGithub(
  keywords: string[],
  geoPreference?: string,
  maxResults = 15
): Promise<SourcedCandidate[]> {
  const location = normalizeGeoForGithub(geoPreference ?? "");
  const lang = detectGithubLanguage(keywords);

  console.log(`[github] keywords=${JSON.stringify(keywords)} lang=${lang} location="${location}"`);

  const queries: string[] = [];

  // Strategy 1: language-based (most reliable for tech)
  if (lang) {
    const parts = [`language:${lang}`];
    if (location) parts.push(`location:"${location}"`);
    parts.push("repos:>3", "followers:>5");
    queries.push(parts.join(" "));
  }

  // Strategy 2: bio + name search for non-language keywords
  const nonLangKeywords = keywords.filter((k) => !LANG_MAP[k.toLowerCase()]);
  const bioTerms = distilKeywords(nonLangKeywords.length > 0 ? nonLangKeywords : keywords);

  if (bioTerms.length > 0) {
    // Pick the 2 most specific terms (shortest = most targeted)
    const top = bioTerms.sort((a, b) => b.length - a.length).slice(0, 2);
    const parts: string[] = [];

    if (top.length === 1) {
      parts.push(`"${top[0]}" in:bio,name`);
    } else {
      parts.push(`"${top[0]}" in:bio,name OR "${top[1]}" in:bio,name`);
    }

    if (location) parts.push(`location:"${location}"`);
    parts.push("followers:>3");
    queries.push(parts.join(" "));
  }

  // If we have no queries somehow, fallback
  if (queries.length === 0) {
    const fallback = keywords[0] ?? "developer";
    const parts = [`"${fallback}" in:bio`];
    if (location) parts.push(`location:"${location}"`);
    parts.push("followers:>5");
    queries.push(parts.join(" "));
  }

  // Run all queries in parallel, merge unique logins
  const loginSets = await Promise.all(
    queries.map((q) => runGithubQuery(q, Math.ceil(maxResults * 1.5)))
  );

  const seen = new Set<string>();
  const allLogins: string[] = [];
  for (const logins of loginSets) {
    for (const login of logins) {
      if (!seen.has(login)) {
        seen.add(login);
        allLogins.push(login);
      }
    }
  }

  // Fetch full profiles in parallel
  const profiles = await Promise.all(
    allLogins.slice(0, maxResults * 2).map(async (login) => {
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
    .filter((p): p is GithubUser => {
      if (!p || !(p.name || p.login)) return false;
      return isLocationMatch(p.location ?? "", location);
    })
    .slice(0, maxResults)
    .map((p): SourcedCandidate => ({
      id: `gh-${p.id}`,
      name: p.name || p.login,
      title: extractTitleFromBio(p.bio) || inferTitle(lang, keywords) || "Software Professional",
      company: (p.company || "").replace(/^@/, "").trim(),
      location: p.location || "",
      email: p.email || "",
      linkedinUrl: p.blog?.includes("linkedin.com") ? p.blog : "",
      summary: p.bio || "",
      experience: buildGithubExperience(p, lang),
      notes: `Sourced from GitHub · ${p.followers} followers · ${p.public_repos} repos`,
      sourceUrl: p.html_url,
      sourceName: "github",
    }));
}

function inferTitle(lang: string | null, keywords: string[]): string {
  if (lang) return `${lang} Developer`;
  const role = keywords.find((k) =>
    /engineer|developer|architect|lead|manager|designer|analyst|scientist/i.test(k)
  );
  return role ?? "";
}

function extractTitleFromBio(bio: string | null): string {
  if (!bio) return "";
  const patterns = [
    /^([^.\n|–-]{5,60})\s+at\s+/i,
    /^([^.\n|–-]{5,60})\s*@\s+/i,
    /^((?:VP|CTO|CFO|CEO|CPO|Head of|Director of|Senior|Lead|Staff|Principal|Software)[^.\n]{3,50})/i,
    /^([^.\n]{5,60})\s*[|\-–]/,
  ];
  for (const p of patterns) {
    const m = bio.match(p);
    if (m) return m[1].trim().slice(0, 80);
  }
  return bio.split("\n")[0].trim().slice(0, 80);
}

function buildGithubExperience(p: GithubUser, lang: string | null): string {
  const parts: string[] = [];
  if (p.company) parts.push(p.company.replace(/^@/, "").trim());
  if (lang) parts.push(`${lang} developer`);
  parts.push(`${p.public_repos} public repos`);
  parts.push(`${p.followers} GitHub followers`);
  if (p.hireable) parts.push("open to work");
  return parts.join(" · ");
}
