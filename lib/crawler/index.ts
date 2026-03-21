/**
 * Background crawler engine — singleton, runs as a persistent async loop
 * inside the Next.js dev-server process.
 *
 * Sources:
 *   1. GitHub Search API  — users by language / location / followers
 *   2. Web pages          — company team/about pages, devlists, indie directories
 *
 * Rate limits:
 *   GitHub authenticated: 30 reqs/min  → 2 s between calls
 *   Web per domain      : 3 s minimum
 *   Overall cap         : ~1 req/s
 */

import {
  appendProfile,
  loadVisited,
  saveVisited,
  writeState,
  readState,
  IndexedProfile,
} from "./store";

// ── Types ────────────────────────────────────────────────────────────────────

interface QueueItem {
  url: string;
  source: "github" | "web";
  priority: number; // higher = sooner
}

// ── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API = "https://api.github.com";
const GITHUB_DELAY = 2200; // ms between GitHub calls
const WEB_DELAY    = 3500; // ms between web calls to same domain
const MAX_QUEUE    = 5000;
const SAVE_EVERY   = 50;   // persist visited set every N iterations

// Seed web pages — tuned for identity / security / Go engineering talent
const WEB_SEEDS = [
  // IAM / identity vendor team pages
  "https://www.conductorone.com/about",
  "https://www.okta.com/company/",
  "https://www.sailpoint.com/company/",
  "https://www.saviynt.com/about-us/",
  "https://www.cyberark.com/company/about-cyberark/",
  "https://www.beyond.com/about",
  "https://www.opal.dev/about",
  "https://www.indent.com/about",
  "https://www.entitle.io/about",
  // Security / infra engineers on GitHub Trending
  "https://github.com/trending/go",
  "https://github.com/trending/rust",
  // Community hubs
  "https://news.ycombinator.com/jobs",
  "https://dev.to/t/go",
  "https://dev.to/t/security",
  // IAM / security conference speaker lists
  "https://www.identiverse.com/speakers/",
  "https://www.rsaconference.com/speakers",
];

// GitHub search queries — prioritises Go + identity/security/infra engineers
const GITHUB_QUERIES = [
  // Go engineers (core Baton SDK language)
  "language:go followers:>30",
  "language:go followers:>100",
  "language:go bio:identity followers:>10",
  "language:go bio:security followers:>10",
  "language:go bio:iam followers:>5",
  "language:go bio:platform followers:>15",
  "language:go bio:infrastructure followers:>10",
  // Rust — common for security tooling
  "language:rust bio:security followers:>15",
  "language:rust followers:>50",
  // General security / identity engineers
  "bio:identity followers:>20",
  "bio:\"access management\" followers:>10",
  "bio:iam followers:>10",
  "bio:\"zero trust\" followers:>5",
  "bio:okta followers:>5",
  "bio:saml followers:>5",
  "bio:scim followers:>5",
  "bio:\"identity governance\" followers:>5",
  "bio:sso followers:>10",
  // Platform / infra engineers
  "bio:\"platform engineer\" followers:>20",
  "bio:devops followers:>30",
  "bio:kubernetes followers:>20",
  // Senior talent signals
  "bio:cto followers:>50",
  "bio:\"staff engineer\" followers:>20",
  "bio:\"principal engineer\" followers:>15",
  // Geo clusters
  "language:go location:\"San Francisco\" followers:>10",
  "language:go location:\"New York\" followers:>10",
  "language:go location:\"Seattle\" followers:>10",
  "language:go location:\"Austin\" followers:>10",
  "language:go location:\"Remote\" followers:>10",
  "language:go location:\"Portland\" followers:>10",
  "language:go location:\"Denver\" followers:>10",
];

// ── Module-level singleton state ──────────────────────────────────────────────

let _running = false;
let _stopRequested = false;
let _visitedUrls: Set<string> = new Set();
let _queue: QueueItem[] = [];
let _domainLastFetch: Map<string, number> = new Map();
let _githubQueryIndex = 0;
let _githubPageIndex  = 1;
let _iteration = 0;
let _stats = { pages: 0, profiles: 0, errors: 0 };
let _recentFinds: Array<{ name: string; title: string; company: string; time: string }> = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

async function waitForDomain(domain: string, delayMs: number) {
  const last = _domainLastFetch.get(domain) ?? 0;
  const wait = Math.max(0, last + delayMs - Date.now());
  if (wait > 0) await sleep(wait);
  _domainLastFetch.set(domain, Date.now());
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const token = process.env.GITHUB_TOKEN;
    const h: Record<string, string> = {
      "User-Agent": "sodacircle-crawler/1.0",
      Accept: "application/json",
      ...headers,
    };
    if (token && url.startsWith(GITHUB_API)) h["Authorization"] = `Bearer ${token}`;

    const res = await fetch(url, { headers: h, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "sodacircle-crawler/1.0", Accept: "text/html" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text")) return null;
    return res.text();
  } catch {
    return null;
  }
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ")
    .replace(/\s{3,}/g, "  ")
    .trim()
    .slice(0, 8000);
}

function recordFind(p: IndexedProfile) {
  _recentFinds.unshift({ name: p.name, title: p.title, company: p.company, time: new Date().toISOString() });
  if (_recentFinds.length > 20) _recentFinds = _recentFinds.slice(0, 20);
}

function enqueue(item: QueueItem) {
  if (_visitedUrls.has(item.url)) return;
  if (_queue.length >= MAX_QUEUE) _queue = _queue.slice(0, MAX_QUEUE - 1); // drop lowest-priority tail
  // insert by priority (simple push + sort is fine at this scale)
  _queue.push(item);
  _queue.sort((a, b) => b.priority - a.priority);
}

// ── robots.txt cache ──────────────────────────────────────────────────────────

const _robotsCache = new Map<string, string[]>();

async function getDisallowed(origin: string): Promise<string[]> {
  if (_robotsCache.has(origin)) return _robotsCache.get(origin)!;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": "sodacircle-crawler/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) { _robotsCache.set(origin, []); return []; }
    const text = await res.text();
    const disallowed: string[] = [];
    let inOurBlock = false;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (line.toLowerCase().startsWith("user-agent:")) {
        const agent = line.slice(11).trim();
        inOurBlock = agent === "*";
      } else if (inOurBlock && line.toLowerCase().startsWith("disallow:")) {
        const path = line.slice(9).trim();
        if (path) disallowed.push(path);
      }
    }
    _robotsCache.set(origin, disallowed);
    return disallowed;
  } catch {
    _robotsCache.set(origin, []);
    return [];
  }
}

function isAllowed(pathname: string, disallowed: string[]): boolean {
  return !disallowed.some((d) => d && pathname.startsWith(d));
}

// ── GitHub crawling ───────────────────────────────────────────────────────────

interface GHUser {
  login: string;
  html_url: string;
  url: string;
}

interface GHUserDetail {
  login: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  email: string | null;
  html_url: string;
  blog: string | null;
  public_repos: number;
  followers: number;
}

async function crawlGitHubBatch(): Promise<number> {
  const query = GITHUB_QUERIES[_githubQueryIndex % GITHUB_QUERIES.length];
  const page  = _githubPageIndex;

  await waitForDomain("api.github.com", GITHUB_DELAY);

  const searchUrl = `${GITHUB_API}/search/users?q=${encodeURIComponent(query)}&per_page=30&page=${page}`;
  const result = await fetchJson<{ items: GHUser[]; total_count: number }>(searchUrl);

  if (!result?.items?.length) {
    // Move to next query
    _githubQueryIndex++;
    _githubPageIndex = 1;
    return 0;
  }

  // Advance page; wrap after 10 pages per query
  _githubPageIndex++;
  if (_githubPageIndex > 10) {
    _githubQueryIndex++;
    _githubPageIndex = 1;
  }

  let saved = 0;
  for (const user of result.items) {
    if (_stopRequested) break;
    if (_visitedUrls.has(user.html_url)) continue;
    _visitedUrls.add(user.html_url);

    await waitForDomain("api.github.com", GITHUB_DELAY);
    const detail = await fetchJson<GHUserDetail>(user.url);
    if (!detail) continue;

    const name = detail.name || detail.login;
    const bio  = detail.bio ?? "";

    // Heuristic title from bio
    const titleMatch = bio.match(/(?:senior\s+|lead\s+|staff\s+|principal\s+)?(?:software|fullstack|full.stack|frontend|backend|platform|infra|devops|ml|data|ai|mobile|ios|android|cloud)?\s*(?:engineer|developer|architect|scientist|researcher|cto|vp|director|founder|co-founder)/i);
    const title = titleMatch ? titleMatch[0].trim() : (detail.followers > 200 ? "Software Engineer" : "Developer");

    const company = (detail.company ?? "").replace(/^@/, "").trim();

    const profile: IndexedProfile = {
      id: `gh-${detail.login}`,
      name,
      title,
      company,
      location: detail.location ?? "",
      bio,
      skills: extractSkillsFromBio(bio),
      email: detail.email ?? "",
      githubUrl: detail.html_url,
      linkedinUrl: "",
      sourceUrl: detail.html_url,
      sourceName: "github",
      indexedAt: new Date().toISOString(),
    };

    if (appendProfile(profile)) {
      saved++;
      _stats.profiles++;
      recordFind(profile);
    }
  }

  _stats.pages++;
  return saved;
}

function extractSkillsFromBio(bio: string): string[] {
  const known = [
    // Languages — weighted toward ConductorOne's stack
    "go","golang","rust","typescript","javascript","python","java","kotlin","swift",
    // Identity & access management
    "iam","identity","access management","zero trust","sso","saml","oauth","oidc","scim",
    "okta","azure ad","active directory","ldap","ping identity","sailpoint","cyberark","saviynt",
    "identity governance","privileged access","pam","just-in-time","jit access",
    "entitlements","rbac","abac","access governance","iga",
    // Security
    "security","appsec","soc","siem","devsecops","zero trust","compliance","soc2","sox","hipaa",
    // Cloud / infra
    "aws","gcp","azure","kubernetes","k8s","docker","terraform","pulumi","helm","ci/cd",
    "platform engineering","devops","sre","infrastructure",
    // Backend / API
    "grpc","graphql","rest","protobuf","microservices","distributed systems","api",
    "postgresql","postgres","mysql","mongodb","redis","dynamodb","spanner",
    // Frameworks
    "react","nextjs","vue","angular",
    "node","nodejs","express","fastapi","django","rails",
  ];
  const lower = bio.toLowerCase();
  return known.filter((s) => lower.includes(s)).slice(0, 10);
}

// ── Web crawling ──────────────────────────────────────────────────────────────

// People-page path patterns
const PEOPLE_PATHS = [
  "/team", "/about", "/people", "/about/team", "/company/team",
  "/about-us", "/our-team", "/staff", "/crew", "/founders",
  "/contributors", "/members", "/directory",
];

// Link patterns that suggest a personal profile page
const PROFILE_URL_RE = /\/(people|team|about|profile|user|u|@)\/[^/?#]{2,}/i;

async function crawlWebUrl(url: string): Promise<number> {
  const { origin, pathname } = new URL(url);
  const domain = getDomain(url);

  const disallowed = await getDisallowed(origin);
  if (!isAllowed(pathname, disallowed)) return 0;

  await waitForDomain(domain, WEB_DELAY);

  const html = await fetchHtml(url);
  if (!html) { _stats.errors++; return 0; }

  const text = cleanHtml(html);
  _stats.pages++;

  // Extract profiles with Claude if API key available
  let saved = 0;
  if (process.env.ANTHROPIC_API_KEY) {
    saved = await extractAndSaveWithClaude(text, url);
  } else {
    saved = extractAndSaveHeuristic(text, url);
  }

  // Discover more URLs from this page
  discoverLinks(html, origin, disallowed);

  return saved;
}

async function callClaude(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  return data.content[0]?.text?.trim() ?? "";
}

async function extractAndSaveWithClaude(text: string, sourceUrl: string): Promise<number> {
  try {
    const raw = await callClaude(`Extract people profiles from this page. Return JSON array of objects with fields:
name, title, company, location, bio, skills (array), email, githubUrl, linkedinUrl.
Only include real people with at least a name and title/role. Return [] if none found.
Return ONLY the JSON array, no markdown.

Page URL: ${sourceUrl}
Page content:
${text}`);

    const clean = raw.replace(/^```json?\s*/i, "").replace(/```\s*$/i, "");
    const people = JSON.parse(clean) as Array<Partial<IndexedProfile>>;
    if (!Array.isArray(people)) return 0;

    let saved = 0;
    for (const p of people) {
      if (!p.name?.trim()) continue;
      const profile: IndexedProfile = {
        id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: p.name.trim(),
        title: p.title ?? "",
        company: p.company ?? getDomain(sourceUrl),
        location: p.location ?? "",
        bio: p.bio ?? "",
        skills: Array.isArray(p.skills) ? p.skills : [],
        email: p.email ?? "",
        githubUrl: p.githubUrl ?? "",
        linkedinUrl: p.linkedinUrl ?? "",
        sourceUrl,
        sourceName: "web",
        indexedAt: new Date().toISOString(),
      };
      if (appendProfile(profile)) { saved++; _stats.profiles++; recordFind(profile); }
    }
    return saved;
  } catch {
    return 0;
  }
}

function extractAndSaveHeuristic(text: string, sourceUrl: string): number {
  // Very basic: look for "Name — Title at Company" patterns
  const patterns = [
    /([A-Z][a-z]+ [A-Z][a-z]+)\s*[—–-]\s*([^,\n]{5,60})/g,
    /([A-Z][a-z]+ [A-Z][a-z]+),\s*((?:Senior|Lead|Staff|Principal|Head of|VP|Director|CTO|CEO|Founder)[^,\n]{0,60})/g,
  ];

  let saved = 0;
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      const titleRaw = m[2].trim();
      // quick noise filter
      if (name.split(" ").length < 2) continue;
      if (titleRaw.length < 3) continue;

      const profile: IndexedProfile = {
        id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        title: titleRaw.split(" at ")[0].trim(),
        company: titleRaw.includes(" at ") ? titleRaw.split(" at ")[1].trim() : getDomain(sourceUrl),
        location: "",
        bio: "",
        skills: [],
        email: "",
        githubUrl: "",
        linkedinUrl: "",
        sourceUrl,
        sourceName: "web",
        indexedAt: new Date().toISOString(),
      };
      if (appendProfile(profile)) { saved++; _stats.profiles++; recordFind(profile); }
    }
  }
  return saved;
}

function discoverLinks(html: string, origin: string, disallowed: string[]) {
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  let added = 0;
  while ((m = hrefRe.exec(html)) !== null && added < 30) {
    try {
      const raw = m[1];
      const resolved = raw.startsWith("http") ? raw : new URL(raw, origin).href;
      const u = new URL(resolved);
      if (u.hostname !== new URL(origin).hostname) continue; // same-origin only for now
      if (!isAllowed(u.pathname, disallowed)) continue;
      if (_visitedUrls.has(resolved)) continue;
      if (PROFILE_URL_RE.test(u.pathname) || PEOPLE_PATHS.some((p) => u.pathname === p || u.pathname.startsWith(p + "/"))) {
        enqueue({ url: resolved, source: "web", priority: 5 });
        added++;
      }
    } catch { /* ignore malformed URLs */ }
  }
}

// ── Crawler loop ──────────────────────────────────────────────────────────────

async function crawlLoop() {
  // Hydrate visited set from disk
  _visitedUrls = loadVisited();

  // Seed the web queue
  for (const seed of WEB_SEEDS) {
    enqueue({ url: seed, source: "web", priority: 10 });
  }

  // Also enqueue common team/about pages for known tech companies
  // Identity / security / infra companies whose team pages often list engineers
  const techCompanies = [
    "https://www.hashicorp.com/company",
    "https://www.paloaltonetworks.com/about-us",
    "https://www.crowdstrike.com/about-us/",
    "https://snyk.io/about/",
    "https://auth0.com/about",
    "https://www.teleport.dev/about",
    "https://infisical.com/about",
    "https://www.doppler.com/about",
    "https://goteleport.com/about",
    "https://boundary.hashicorp.com",
    "https://www.beyondidentity.com/about",
    "https://workos.com/about",
    "https://stytch.com/about",
    "https://clerk.com/about",
    "https://www.strongdm.com/company",
    "https://www.trustvault.io/about",
  ];
  for (const u of techCompanies) enqueue({ url: u, source: "web", priority: 8 });

  writeState({
    running: true,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    pagesVisited: 0,
    profilesFound: 0,
    errors: 0,
    queueDepth: _queue.length,
    recentFinds: [],
    lastActivity: new Date().toISOString(),
  });

  while (!_stopRequested) {
    _iteration++;

    // Alternate: every 3 iterations do GitHub, otherwise web
    const doGitHub = _iteration % 3 !== 0 && GITHUB_QUERIES.length > 0;

    try {
      if (doGitHub) {
        await crawlGitHubBatch();
      } else {
        const item = _queue.shift();
        if (!item) {
          // Queue empty — re-seed
          for (const seed of WEB_SEEDS) enqueue({ url: seed, source: "web", priority: 10 });
          await sleep(5000);
          continue;
        }
        if (!_visitedUrls.has(item.url)) {
          _visitedUrls.add(item.url);
          await crawlWebUrl(item.url);
        }
      }
    } catch (err) {
      _stats.errors++;
    }

    // Persist state periodically
    if (_iteration % SAVE_EVERY === 0) {
      saveVisited(_visitedUrls);
      writeState({
        pagesVisited: _stats.pages,
        profilesFound: _stats.profiles,
        errors: _stats.errors,
        queueDepth: _queue.length,
        recentFinds: _recentFinds,
        lastActivity: new Date().toISOString(),
      });
    }

    // Small gap between iterations
    await sleep(500);
  }

  // Clean shutdown
  saveVisited(_visitedUrls);
  writeState({
    running: false,
    stoppedAt: new Date().toISOString(),
    pagesVisited: _stats.pages,
    profilesFound: _stats.profiles,
    errors: _stats.errors,
    queueDepth: _queue.length,
    recentFinds: _recentFinds,
    lastActivity: new Date().toISOString(),
  });

  _running = false;
  _stopRequested = false;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startCrawler() {
  if (_running) return;
  _running = true;
  _stopRequested = false;
  _stats = { pages: 0, profiles: 0, errors: 0 };

  // Restore stats from persisted state so they accumulate across restarts
  const saved = readState();
  _stats.pages    = saved.pagesVisited;
  _stats.profiles = saved.profilesFound;
  _stats.errors   = saved.errors;
  _recentFinds    = saved.recentFinds ?? [];

  crawlLoop().catch(() => {
    _running = false;
    writeState({ running: false, stoppedAt: new Date().toISOString() });
  });
}

export function stopCrawler() {
  _stopRequested = true;
}

export function isCrawlerRunning(): boolean {
  return _running;
}

export function getCrawlerStatus() {
  return {
    running: _running,
    queueDepth: _queue.length,
    stats: { ..._stats },
    recentFinds: [..._recentFinds],
  };
}

export function addSeedUrls(urls: string[]) {
  for (const url of urls) {
    try {
      new URL(url); // validate
      enqueue({ url, source: "web", priority: 9 });
    } catch { /* skip invalid */ }
  }
}
