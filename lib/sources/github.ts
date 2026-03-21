/**
 * GitHub sourcing — multi-strategy user search + code quality evaluation.
 *
 * Search strategies:
 *   1. language:Go location:"United States" repos:>3   (tech roles)
 *   2. "golang" in:bio,name location:"United States"   (bio fallback)
 *
 * Code quality evaluation (per candidate):
 *   - Fetches original (non-fork) repos only
 *   - Fetches recent events for commit messages and PR activity
 *   - Fetches README of top repo (for Claude analysis)
 *   - Scores heuristically; Claude re-scores if ANTHROPIC_API_KEY is set
 */

import { CodeQuality, CodeQualityBadge } from "@/lib/types";

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
  codeQuality?: CodeQuality;
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

interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  topics: string[];
  pushed_at: string;
  fork: boolean;
  size: number;
}

interface GithubEvent {
  type: string;
  payload: {
    commits?: Array<{ message: string; sha: string }>;
    pull_request?: {
      title: string;
      merged: boolean;
      base: { repo: { full_name: string; owner: { login: string } } };
    };
    action?: string;
  };
  created_at: string;
}

// ── Language detection ────────────────────────────────────────────

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
  dart: "Dart", flutter: "Dart",
  solidity: "Solidity",
};

function detectGithubLanguage(keywords: string[]): string | null {
  for (const kw of keywords) {
    const lang = LANG_MAP[kw.toLowerCase()];
    if (lang) return lang;
  }
  return null;
}

// ── Location normalization ────────────────────────────────────────

function normalizeGeoForGithub(geo: string): string {
  if (!geo) return "";
  const lower = geo.toLowerCase().trim();

  if (/\b(united states|usa|u\.s\.a?\.|america)\b/.test(lower)) return "United States";
  if (/remote\s*\(?\s*(us|usa)\s*\)?/.test(lower)) return "United States";
  if (/\bus\s*only\b/.test(lower)) return "United States";
  if (/^remote$/i.test(lower.trim())) return "";

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
  if (/west coast|east coast|midwest|pacific northwest/.test(lower)) return "United States";
  if (/remote/.test(lower) && /\b(us|usa|west|east|north america|american)\b/.test(lower)) return "United States";

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
  if (!candidateLocation) return true;

  const cloc = candidateLocation.toLowerCase();
  const target = targetRegion.toLowerCase();

  const isUsSearch = /united states|new york|san francisco|seattle|austin|boston|chicago|denver|los angeles|atlanta/.test(target);
  if (isUsSearch && NON_US_MARKERS.some((m) => cloc.includes(m))) {
    return false;
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

// ── Code quality evaluation ───────────────────────────────────────

async function fetchOwnRepos(login: string): Promise<GithubRepo[]> {
  // type=owner excludes repos forked from others — we only want original work
  const res = await githubFetch(
    `https://api.github.com/users/${login}/repos?type=owner&sort=stars&per_page=10`
  );
  if (!res.ok) return [];
  const all = await res.json() as GithubRepo[];
  // Extra safety: filter out forks (type=owner should already do this, belt+suspenders)
  return all.filter((r) => !r.fork);
}

async function fetchRecentEvents(login: string): Promise<GithubEvent[]> {
  const res = await githubFetch(
    `https://api.github.com/users/${login}/events/public?per_page=30`
  );
  if (!res.ok) return [];
  return res.json() as Promise<GithubEvent[]>;
}

async function fetchReadme(fullName: string): Promise<string> {
  const res = await githubFetch(`https://api.github.com/repos/${fullName}/readme`);
  if (!res.ok) return "";
  const data = await res.json() as { content?: string; encoding?: string };
  if (!data.content || data.encoding !== "base64") return "";
  // Decode base64
  try {
    return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf-8").slice(0, 800);
  } catch {
    return "";
  }
}

async function scoreWithClaude(
  login: string,
  repos: GithubRepo[],
  commitMessages: string[],
  prTitles: string[],
  readmeExcerpt: string
): Promise<{ score: number; reason: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const repoLines = repos.slice(0, 4).map((r) =>
    `  • ${r.name} [${r.language ?? "?"}] ★${r.stargazers_count}${r.description ? ` — ${r.description}` : ""}${r.topics?.length ? ` [${r.topics.slice(0, 3).join(", ")}]` : ""}`
  ).join("\n");

  const commitSample = commitMessages.slice(0, 10).map((m) => `  "${m.split("\n")[0].trim().slice(0, 80)}"`).join("\n");
  const prSample = prTitles.slice(0, 5).map((t) => `  "${t.slice(0, 80)}"`).join("\n");

  const prompt = `You are evaluating a software developer's GitHub profile for recruiting purposes.
Assess code quality, engineering craft, and professionalism based on their public work.

GitHub username: ${login}

ORIGINAL REPOS (${repos.length} total, sorted by stars):
${repoLines || "  (none found)"}

${readmeExcerpt ? `TOP REPO README (excerpt):\n${readmeExcerpt.slice(0, 600)}\n` : ""}
RECENT COMMIT MESSAGES:
${commitSample || "  (none available)"}

${prSample ? `OPEN SOURCE PR CONTRIBUTIONS:\n${prSample}\n` : ""}
Score 0–100 for code quality. Strong signals: maintained original projects, good documentation, descriptive commits, open source contributions, community recognition (stars). Poor signals: no descriptions, no commits, only toy projects, commit messages like "fix", "wip", "asdf".

Return ONLY valid JSON: { "score": number, "reason": "one clear sentence explaining the score" }`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 128,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content.find((b) => b.type === "text")?.text ?? "";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as { score: number; reason: string };
    return { score: Math.max(0, Math.min(100, parsed.score)), reason: parsed.reason };
  } catch {
    return null;
  }
}

function scoreReposHeuristic(
  repos: GithubRepo[],
  events: GithubEvent[]
): { score: number; signals: string[]; concerns: string[] } {
  const signals: string[] = [];
  const concerns: string[] = [];

  if (repos.length === 0) {
    return { score: 20, signals: [], concerns: ["No original repositories found — may keep all work private"] };
  }

  let score = 40;

  // ── Stars on original repos ───────────────────────────────────
  const totalStars = repos.reduce((s, r) => s + r.stargazers_count, 0);
  const topStars = repos[0]?.stargazers_count ?? 0;

  if (totalStars >= 1000) { score += 28; signals.push(`${totalStars.toLocaleString()} total stars on original repos`); }
  else if (totalStars >= 200) { score += 20; signals.push(`${totalStars} stars on original repos`); }
  else if (totalStars >= 50) { score += 12; signals.push(`${totalStars} stars on original repos`); }
  else if (totalStars >= 10) { score += 5; }
  else { concerns.push("Low community recognition (< 10 stars total on original work)"); }

  // ── Documentation quality ─────────────────────────────────────
  const described = repos.filter((r) => (r.description ?? "").length > 15).length;
  const topicTagged = repos.filter((r) => r.topics?.length > 0).length;

  if (described >= Math.ceil(repos.length * 0.7)) {
    score += 8;
    signals.push("Repos are well-described");
  } else if (described === 0) {
    score -= 10;
    concerns.push("Repos have no descriptions");
  }

  if (topicTagged > 0) score += 4;

  // ── Recency ────────────────────────────────────────────────────
  const sixMonthsAgo = Date.now() - 6 * 30 * 24 * 60 * 60 * 1000;
  const recentRepos = repos.filter((r) => new Date(r.pushed_at).getTime() > sixMonthsAgo);
  if (recentRepos.length > 0) {
    score += 5;
    signals.push("Active in the past 6 months");
  } else {
    concerns.push("No recent commit activity in 6+ months");
  }

  // ── Commit message quality ────────────────────────────────────
  const pushEvents = events.filter((e) => e.type === "PushEvent");
  const allCommits = pushEvents.flatMap((e) => e.payload.commits ?? []);
  const messages = allCommits.map((c) => c.message.split("\n")[0].trim()).slice(0, 25);

  if (messages.length > 0) {
    const lazy = messages.filter((m) =>
      /^(fix|update|wip|test|commit|changes?|misc|todo|temp|asdf|asd|ok|done|.)$/i.test(m.trim())
    ).length;
    const descriptive = messages.filter((m) => m.length >= 20).length;

    if (lazy >= messages.length * 0.5) {
      score -= 12;
      concerns.push(`Commit messages are low quality ("fix", "wip", "update")`);
    } else if (descriptive >= messages.length * 0.6) {
      score += 10;
      signals.push("Descriptive, professional commit messages");
    }
  }

  // ── Open-source PR contributions (external repos) ─────────────
  const externalPRs = events.filter(
    (e) =>
      e.type === "PullRequestEvent" &&
      (e.payload.action === "opened" || e.payload.action === "closed") &&
      e.payload.pull_request?.base.repo.owner.login !== (repos[0]?.full_name?.split("/")[0] ?? "")
  );

  if (externalPRs.length >= 3) {
    score += 10;
    signals.push(`${externalPRs.length} contributions to external open-source projects`);
  } else if (externalPRs.length > 0) {
    score += 5;
    signals.push("Contributes to open source");
  }

  // ── Repo diversity ─────────────────────────────────────────────
  const langs = new Set(repos.map((r) => r.language).filter(Boolean));
  if (langs.size >= 3) {
    signals.push(`Works across ${langs.size} languages`);
  }

  return { score: Math.max(0, Math.min(100, score)), signals, concerns };
}

export async function evaluateCodeQuality(login: string): Promise<CodeQuality> {
  // Parallel: fetch original repos + recent events
  const [repos, events] = await Promise.all([
    fetchOwnRepos(login).catch(() => [] as GithubRepo[]),
    fetchRecentEvents(login).catch(() => [] as GithubEvent[]),
  ]);

  const { score: hScore, signals, concerns } = scoreReposHeuristic(repos, events);

  // Collect data for Claude
  const commitMessages = events
    .filter((e) => e.type === "PushEvent")
    .flatMap((e) => e.payload.commits ?? [])
    .map((c) => c.message.split("\n")[0].trim())
    .filter((m) => m.length > 2)
    .slice(0, 15);

  const prTitles = events
    .filter((e) => e.type === "PullRequestEvent" && e.payload.pull_request)
    .map((e) => e.payload.pull_request!.title)
    .slice(0, 8);

  // Fetch README of top original repo for Claude context
  let readmeExcerpt = "";
  if (repos.length > 0 && process.env.ANTHROPIC_API_KEY) {
    readmeExcerpt = await fetchReadme(repos[0].full_name).catch(() => "");
  }

  // Try Claude scoring; fall back to heuristic
  const claudeResult = await scoreWithClaude(login, repos, commitMessages, prTitles, readmeExcerpt).catch(() => null);

  const finalScore = claudeResult ? claudeResult.score : hScore;
  const reason = claudeResult?.reason ?? (
    signals.length > 0 ? signals[0] : concerns[0] ?? "Insufficient public data to assess code quality"
  );

  const badge: CodeQualityBadge =
    finalScore >= 70 ? "code-pass" :
    finalScore >= 40 ? "limited-signal" :
    "poor-code";

  const topStars = repos.length > 0 ? repos[0].stargazers_count : 0;

  return {
    badge,
    score: finalScore,
    reason,
    topStars,
    ownRepoCount: repos.length,
    signals,
    concerns,
  };
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

  if (lang) {
    const parts = [`language:${lang}`];
    if (location) parts.push(`location:"${location}"`);
    parts.push("repos:>3", "followers:>5");
    queries.push(parts.join(" "));
  }

  const nonLangKeywords = keywords.filter((k) => !LANG_MAP[k.toLowerCase()]);
  const bioTerms = distilKeywords(nonLangKeywords.length > 0 ? nonLangKeywords : keywords);

  if (bioTerms.length > 0) {
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

  if (queries.length === 0) {
    const fallback = keywords[0] ?? "developer";
    const parts = [`"${fallback}" in:bio`];
    if (location) parts.push(`location:"${location}"`);
    parts.push("followers:>5");
    queries.push(parts.join(" "));
  }

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

  // Fetch full profiles
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

  const filtered = profiles.filter((p): p is GithubUser => {
    if (!p || !(p.name || p.login)) return false;
    return isLocationMatch(p.location ?? "", location);
  }).slice(0, maxResults);

  // Evaluate code quality for each candidate in parallel
  const codeQualities = await Promise.all(
    filtered.map((p) =>
      evaluateCodeQuality(p.login).catch((): CodeQuality => ({
        badge: "limited-signal",
        score: 50,
        reason: "Could not evaluate — profile may be private or rate limited",
        topStars: 0,
        ownRepoCount: 0,
        signals: [],
        concerns: [],
      }))
    )
  );

  return filtered.map((p, i): SourcedCandidate => ({
    id: `gh-${p.id}`,
    name: p.name || p.login,
    title: extractTitleFromBio(p.bio) || inferTitle(lang, keywords) || "Software Professional",
    company: (p.company || "").replace(/^@/, "").trim(),
    location: p.location || "",
    email: p.email || "",
    linkedinUrl: p.blog?.includes("linkedin.com") ? p.blog : "",
    summary: p.bio || "",
    experience: buildGithubExperience(p, lang, codeQualities[i]),
    notes: `Sourced from GitHub · ${p.followers} followers · ${p.public_repos} repos`,
    sourceUrl: p.html_url,
    sourceName: "github",
    codeQuality: codeQualities[i],
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

function buildGithubExperience(p: GithubUser, lang: string | null, cq?: CodeQuality): string {
  const parts: string[] = [];
  if (p.company) parts.push(p.company.replace(/^@/, "").trim());
  if (lang) parts.push(`${lang} developer`);
  parts.push(`${p.public_repos} public repos`);
  parts.push(`${p.followers} GitHub followers`);
  if (cq && cq.topStars > 0) parts.push(`★${cq.topStars} top repo stars`);
  if (p.hireable) parts.push("open to work");
  return parts.join(" · ");
}
