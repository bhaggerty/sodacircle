/**
 * Background crawler — GitHub API + web crawling for engineer profiles.
 *
 * Strategy:
 *   1. GitHub Search API  — query users by language/bio/location, then fetch their full profile
 *   2. GitHub Org members — enumerate members of known identity/security orgs
 *   3. Web pages          — team/about pages parsed with cheerio
 *
 * Rate limits (respected):
 *   GitHub authenticated  : 30 search reqs/min  → 2.2 s gap
 *   GitHub user/org APIs  : 5000 reqs/hr        → no throttle needed
 *   Web per domain        : 3 s minimum gap
 */

import * as cheerio from "cheerio";
import {
  appendProfile,
  loadVisited,
  saveVisited,
  writeState,
  readState,
  IndexedProfile,
} from "./store";

// ── Constants ────────────────────────────────────────────────────────────────

const GITHUB_API    = "https://api.github.com";
const SEARCH_DELAY  = 2500;  // ms between GitHub search calls (rate limit)
const WEB_DELAY     = 3000;  // ms between requests to the same domain
const SAVE_EVERY    = 30;    // persist visited set every N iterations
const MAX_QUEUE     = 3000;

// GitHub orgs whose members are likely ConductorOne-relevant
const GITHUB_ORGS = [
  "conductorone", "okta", "hashicorp", "teleport-oss", "gravitational",
  "open-policy-agent", "spiffe", "cncf", "crossplane", "cert-manager",
  "dexidp", "oauth2-proxy", "ory", "casdoor", "zitadel", "logto-io",
  "keycloak", "gluu", "supertokens-core", "infisical", "dopplerhq",
  "snyk", "bridgecrewio", "aquasecurity", "falcosecurity",
];

// GitHub search queries — Go + IAM/identity/security focus
const GITHUB_QUERIES = [
  "language:go followers:>50",
  "language:go followers:>20 repos:>10",
  "language:go bio:identity",
  "language:go bio:security",
  "language:go bio:iam",
  "language:go bio:platform",
  "language:go bio:infrastructure",
  "language:go bio:kubernetes",
  "language:go bio:cloud",
  "language:rust bio:security followers:>20",
  "language:rust followers:>30",
  "bio:\"identity governance\" followers:>5",
  "bio:\"access management\" followers:>5",
  "bio:\"zero trust\" followers:>5",
  "bio:okta followers:>5",
  "bio:iam followers:>10",
  "bio:saml followers:>5",
  "bio:scim followers:>5",
  "bio:sso followers:>10",
  "bio:\"privileged access\" followers:>5",
  "bio:\"staff engineer\" language:go",
  "bio:\"principal engineer\" language:go",
  "bio:cto language:go followers:>30",
  "language:go location:\"San Francisco\"",
  "language:go location:\"Seattle\"",
  "language:go location:\"New York\"",
  "language:go location:\"Austin\"",
  "language:go location:\"Denver\"",
  "language:go location:\"Portland\"",
];

// Web seeds — team/about pages of identity/security companies
const WEB_SEEDS = [
  "https://www.teleport.dev/about",
  "https://infisical.com/about",
  "https://workos.com/about",
  "https://stytch.com/about",
  "https://www.strongdm.com/company",
  "https://www.beyondidentity.com/about",
  "https://opal.dev/about",
  "https://www.indent.com",
  "https://github.com/trending/go?since=weekly",
  "https://github.com/trending/rust?since=weekly",
];

// ── Types ────────────────────────────────────────────────────────────────────

interface QueueItem { url: string; priority: number }

interface GHSearchResult { items: GHUserStub[]; total_count: number }
interface GHUserStub    { login: string; html_url: string; url: string }
interface GHUserDetail  {
  login: string; name: string | null; bio: string | null;
  company: string | null; location: string | null; email: string | null;
  html_url: string; blog: string | null;
  public_repos: number; followers: number;
}
interface GHOrgMember { login: string; html_url: string; url: string }

// ── Module-level state ───────────────────────────────────────────────────────

let _running        = false;
let _stopRequested  = false;
let _visited        = new Set<string>();
let _queue: QueueItem[] = [];
let _domainLastFetch    = new Map<string, number>();
let _robotsCache        = new Map<string, string[]>();

let _githubQueryIdx = 0;
let _githubPageIdx  = 1;
let _orgIdx         = 0;
let _orgMemberPage  = 1;
let _iteration      = 0;

let _stats = { pages: 0, profiles: 0, errors: 0 };
let _recentFinds: Array<{ name: string; title: string; company: string; time: string }> = [];

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function domain(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

async function waitDomain(d: string, ms: number) {
  const last = _domainLastFetch.get(d) ?? 0;
  const wait = Math.max(0, last + ms - Date.now());
  if (wait > 0) await sleep(wait);
  _domainLastFetch.set(d, Date.now());
}

function enqueue(url: string, priority = 5) {
  if (_visited.has(url) || _queue.some((q) => q.url === url)) return;
  if (_queue.length >= MAX_QUEUE) return;
  _queue.push({ url, priority });
  _queue.sort((a, b) => b.priority - a.priority);
}

function recordFind(p: IndexedProfile) {
  _recentFinds.unshift({ name: p.name, title: p.title, company: p.company, time: new Date().toISOString() });
  if (_recentFinds.length > 30) _recentFinds = _recentFinds.slice(0, 30);
}

// ── GitHub fetch helpers ──────────────────────────────────────────────────────

async function ghFetch<T>(path: string): Promise<T | null> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    "User-Agent": "sodacircle-recruiter/1.0",
    Accept: "application/vnd.github+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    const res = await fetch(`${GITHUB_API}${path}`, {
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 403 || res.status === 429) {
      // Rate limited — wait 60 s
      await sleep(60000);
      return null;
    }
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

// ── Skill extraction ──────────────────────────────────────────────────────────

const SKILL_KEYWORDS = [
  // IAM / identity
  "iam","identity","access management","zero trust","sso","saml","oauth","oidc","scim",
  "okta","azure ad","active directory","ldap","sailpoint","cyberark","saviynt","ping identity",
  "identity governance","privileged access","pam","jit access","entitlements","rbac","abac","iga",
  // Security
  "security","appsec","devsecops","soc2","compliance","zero trust","penetration testing",
  // Languages
  "go","golang","rust","typescript","python","java","kotlin","swift","c++",
  // Cloud / infra
  "aws","gcp","azure","kubernetes","k8s","docker","terraform","pulumi","helm",
  "platform engineering","devops","sre","infrastructure","ci/cd",
  // Backend
  "grpc","graphql","rest","protobuf","microservices","distributed systems",
  "postgresql","redis","dynamodb","kafka","nats",
];

function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  return SKILL_KEYWORDS.filter((k) => lower.includes(k)).slice(0, 12);
}

function inferTitle(bio: string, followers: number): string {
  const b = bio.toLowerCase();
  const roles = [
    ["cto", "CTO"], ["vp of engineering", "VP Engineering"], ["vp engineering", "VP Engineering"],
    ["staff engineer", "Staff Engineer"], ["principal engineer", "Principal Engineer"],
    ["founding engineer", "Founding Engineer"], ["co-founder", "Co-Founder"], ["founder", "Founder"],
    ["platform engineer", "Platform Engineer"], ["security engineer", "Security Engineer"],
    ["identity engineer", "Identity Engineer"], ["infrastructure engineer", "Infrastructure Engineer"],
    ["backend engineer", "Backend Engineer"], ["software engineer", "Software Engineer"],
    ["developer", "Developer"], ["architect", "Architect"],
    ["engineering manager", "Engineering Manager"], ["director of engineering", "Director of Engineering"],
  ];
  for (const [key, label] of roles) {
    if (b.includes(key)) return label;
  }
  return followers > 500 ? "Software Engineer" : "Developer";
}

// ── GitHub: search users ──────────────────────────────────────────────────────

async function crawlGitHubSearch(): Promise<number> {
  const q    = GITHUB_QUERIES[_githubQueryIdx % GITHUB_QUERIES.length];
  const page = _githubPageIdx;

  await waitDomain("api.github.com", SEARCH_DELAY);

  const result = await ghFetch<GHSearchResult>(
    `/search/users?q=${encodeURIComponent(q)}&per_page=30&page=${page}&sort=followers`
  );

  if (!result?.items?.length) {
    _githubQueryIdx++;
    _githubPageIdx = 1;
    return 0;
  }

  _githubPageIdx++;
  if (_githubPageIdx > 5) { _githubQueryIdx++; _githubPageIdx = 1; }

  return await processGitHubUsers(result.items);
}

// ── GitHub: org members ───────────────────────────────────────────────────────

async function crawlGitHubOrg(): Promise<number> {
  const org  = GITHUB_ORGS[_orgIdx % GITHUB_ORGS.length];
  const page = _orgMemberPage;

  await waitDomain("api.github.com", SEARCH_DELAY);

  const members = await ghFetch<GHOrgMember[]>(
    `/orgs/${org}/members?per_page=30&page=${page}`
  );

  if (!members?.length) {
    _orgIdx++;
    _orgMemberPage = 1;
    return 0;
  }

  _orgMemberPage++;
  if (_orgMemberPage > 3) { _orgIdx++; _orgMemberPage = 1; }

  return await processGitHubUsers(members);
}

// ── GitHub: process user stubs → fetch detail → save ─────────────────────────

async function processGitHubUsers(stubs: GHUserStub[]): Promise<number> {
  let saved = 0;
  for (const stub of stubs) {
    if (_stopRequested) break;
    if (_visited.has(stub.html_url)) continue;
    _visited.add(stub.html_url);

    await waitDomain("api.github.com", 300); // gentle per-user delay
    const u = await ghFetch<GHUserDetail>(`/users/${stub.login}`);
    if (!u) continue;

    const name    = (u.name || u.login).trim();
    const bio     = (u.bio ?? "").trim();
    const company = (u.company ?? "").replace(/^@/, "").trim();
    const title   = inferTitle(bio, u.followers);

    const profile: IndexedProfile = {
      id: `gh-${u.login}`,
      name,
      title,
      company,
      location: u.location ?? "",
      bio,
      skills: extractSkills(`${bio} ${company} ${title}`),
      email: u.email ?? "",
      githubUrl: u.html_url,
      linkedinUrl: "",
      sourceUrl: u.html_url,
      sourceName: "github",
      indexedAt: new Date().toISOString(),
    };

    if (await appendProfile(profile)) {
      saved++;
      _stats.profiles++;
      recordFind(profile);
    }
    _stats.pages++;
  }
  return saved;
}

// ── robots.txt ────────────────────────────────────────────────────────────────

async function getDisallowed(origin: string): Promise<string[]> {
  if (_robotsCache.has(origin)) return _robotsCache.get(origin)!;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": "sodacircle-recruiter/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    const disallowed: string[] = [];
    if (res.ok) {
      let inBlock = false;
      for (const line of (await res.text()).split("\n")) {
        const l = line.trim();
        if (/^user-agent:/i.test(l)) inBlock = l.toLowerCase().includes("*");
        else if (inBlock && /^disallow:/i.test(l)) {
          const p = l.replace(/^disallow:\s*/i, "").trim();
          if (p) disallowed.push(p);
        }
      }
    }
    _robotsCache.set(origin, disallowed);
    return disallowed;
  } catch {
    _robotsCache.set(origin, []);
    return [];
  }
}

function allowed(pathname: string, disallowed: string[]): boolean {
  return !disallowed.some((d) => d && pathname.startsWith(d));
}

// ── Web crawling ──────────────────────────────────────────────────────────────

async function crawlWebPage(url: string): Promise<number> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return 0; }

  const disallowed = await getDisallowed(parsed.origin);
  if (!allowed(parsed.pathname, disallowed)) return 0;

  await waitDomain(domain(url), WEB_DELAY);

  let html: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "sodacircle-recruiter/1.0", Accept: "text/html" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) { _stats.errors++; return 0; }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return 0;
    html = await res.text();
  } catch {
    _stats.errors++;
    return 0;
  }

  _stats.pages++;
  const saved = await extractPeopleFromHtml(html, url);
  discoverLinks(html, parsed.origin, disallowed);
  return saved;
}

// ── Cheerio-based people extraction ──────────────────────────────────────────

async function extractPeopleFromHtml(html: string, sourceUrl: string): Promise<number> {
  const $ = cheerio.load(html);
  let saved = 0;

  // Remove noise
  $("script, style, nav, footer, header, aside, .cookie, .banner, .ad").remove();

  // Strategy 1: structured team cards (common on company team pages)
  // Look for repeated card-like containers with a name heading
  const cardSelectors = [
    ".team-member", ".team-card", ".person-card", ".employee", ".staff-member",
    ".speaker-card", ".contributor", "[class*='team-item']", "[class*='member-card']",
    "[class*='person-item']", "[class*='profile-card']",
    "article", ".card", ".bio", "[class*='-bio']",
  ];

  for (const sel of cardSelectors) {
    const cards = $(sel).toArray();
    if (cards.length < 2 || cards.length > 200) continue; // skip if too few or clearly not people

    const candidates: IndexedProfile[] = [];
    for (const card of cards) {
      const el = $(card);
      // Name: look for heading or strong text
      const nameEl = el.find("h1, h2, h3, h4, strong, b, .name, [class*='name']").first();
      const name = nameEl.text().trim();
      if (!name || name.length < 3 || name.length > 80) continue;
      if (!isLikelyPersonName(name)) continue;

      // Title
      const titleEl = el.find(".title, .role, .position, .job-title, [class*='title'], [class*='role'], em, small").first();
      const title = titleEl.text().trim().slice(0, 120);

      // Bio
      const bioEl = el.find("p, .bio, .description, [class*='bio']").first();
      const bio   = bioEl.text().trim().slice(0, 500);

      // Links
      const ghLink    = el.find("a[href*='github.com']").attr("href") ?? "";
      const liLink    = el.find("a[href*='linkedin.com/in']").attr("href") ?? "";
      const emailLink = el.find("a[href^='mailto:']").attr("href")?.replace("mailto:", "") ?? "";

      candidates.push({
        id: `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        title,
        company: new URL(sourceUrl).hostname.replace(/^www\./, ""),
        location: "",
        bio,
        skills: extractSkills(`${title} ${bio}`),
        email: emailLink,
        githubUrl: ghLink,
        linkedinUrl: liLink,
        sourceUrl,
        sourceName: "web",
        indexedAt: new Date().toISOString(),
      });
    }

    // Write collected profiles (async, outside cheerio callback)
    for (const profile of candidates) {
      if (await appendProfile(profile)) { saved++; _stats.profiles++; recordFind(profile); }
    }

    if (saved > 0) return saved; // found profiles with this selector, don't double-count
  }

  // Strategy 2: GitHub trending page — extract trending repos/users
  if (sourceUrl.includes("github.com/trending")) {
    $("article.Box-row").each((_, el) => {
      const link = $(el).find("h2 a").attr("href") ?? "";
      if (!link) return;
      const full = `https://github.com${link}`;
      // Queue both the user profile and org
      if (!link.includes("/")) return;
      const parts = link.split("/").filter(Boolean);
      if (parts.length >= 1) {
        enqueue(`https://github.com/${parts[0]}`, 8);
        // Will be processed as a GitHub API call next time we see it
      }
    });
    return 0; // profiles come from the API, not this page
  }

  return saved;
}

function isLikelyPersonName(s: string): boolean {
  // Must have 2+ words, each starting with a capital (or common name patterns)
  const words = s.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  // At least first word starts with capital
  if (!/^[A-Z]/.test(words[0])) return false;
  // Not all caps (would be a heading/button)
  if (s === s.toUpperCase()) return false;
  // No numbers, no special chars except hyphens/apostrophes
  if (/[0-9@#$%^&*()=+\[\]{}<>|/\\]/.test(s)) return false;
  return true;
}

function discoverLinks(html: string, origin: string, disallowed: string[]) {
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    if (_queue.length >= MAX_QUEUE) return false; // stop iterating
    try {
      const href = $(el).attr("href") ?? "";
      const resolved = href.startsWith("http") ? href : new URL(href, origin).href;
      const u = new URL(resolved);
      if (u.hostname !== new URL(origin).hostname) return; // same-origin only
      if (!allowed(u.pathname, disallowed)) return;
      if (_visited.has(resolved)) return;

      const path = u.pathname.toLowerCase();
      const isPeoplePath = /\/(team|about|people|staff|crew|founders|contributors|members|speakers|bios|directory|profiles)/.test(path);
      const isProfilePath = /\/(team|people|staff|speakers|contributors)\/[^/?#]{2,}/.test(path);

      if (isPeoplePath || isProfilePath) {
        enqueue(resolved, isProfilePath ? 8 : 6);
      }
    } catch { /* ignore */ }
  });
}

// ── GitHub profile URL handler (from queue) ───────────────────────────────────

async function processGitHubProfileUrl(url: string): Promise<number> {
  // e.g. https://github.com/someuser
  const match = url.match(/^https:\/\/github\.com\/([^/?#]+)$/);
  if (!match) return 0;
  const login = match[1];
  if (["trending", "orgs", "topics", "explore", "marketplace"].includes(login)) return 0;

  await waitDomain("api.github.com", 300);
  const u = await ghFetch<GHUserDetail>(`/users/${login}`);
  if (!u || !u.name) return 0;

  _visited.add(url);
  const bio     = (u.bio ?? "").trim();
  const company = (u.company ?? "").replace(/^@/, "").trim();

  const profile: IndexedProfile = {
    id: `gh-${u.login}`,
    name: u.name.trim(),
    title: inferTitle(bio, u.followers),
    company,
    location: u.location ?? "",
    bio,
    skills: extractSkills(`${bio} ${company}`),
    email: u.email ?? "",
    githubUrl: u.html_url,
    linkedinUrl: "",
    sourceUrl: u.html_url,
    sourceName: "github",
    indexedAt: new Date().toISOString(),
  };

  _stats.pages++;
  if (await appendProfile(profile)) { _stats.profiles++; recordFind(profile); return 1; }
  return 0;
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function crawlLoop() {
  _visited = await loadVisited();

  for (const seed of WEB_SEEDS) enqueue(seed, 9);

  const saved = await readState();
  _stats.pages    = saved.pagesVisited;
  _stats.profiles = saved.profilesFound;
  _stats.errors   = saved.errors;
  _recentFinds    = saved.recentFinds ?? [];

  // Track newly-visited URLs this session so we only write new ones to DynamoDB
  const _newVisited = new Set<string>();

  await writeState({
    running: true, startedAt: new Date().toISOString(), stoppedAt: null,
    pagesVisited: _stats.pages, profilesFound: _stats.profiles, errors: _stats.errors,
    queueDepth: _queue.length, recentFinds: _recentFinds, lastActivity: new Date().toISOString(),
  });

  while (!_stopRequested) {
    _iteration++;

    try {
      const phase = _iteration % 4;

      if (phase === 0) {
        await crawlGitHubOrg();
      } else if (phase === 1 || phase === 3) {
        await crawlGitHubSearch();
      } else {
        const item = _queue.shift();
        if (!item) {
          for (const seed of WEB_SEEDS) enqueue(seed, 9);
          await sleep(3000);
          continue;
        }
        _visited.add(item.url);
        _newVisited.add(item.url);
        if (item.url.startsWith("https://github.com/")) {
          await processGitHubProfileUrl(item.url);
        } else {
          await crawlWebPage(item.url);
        }
      }
    } catch (err) {
      _stats.errors++;
      console.error("[crawler]", err);
    }

    if (_iteration % SAVE_EVERY === 0) {
      await saveVisited(_visited, _newVisited);
      _newVisited.clear();
      await writeState({
        pagesVisited: _stats.pages, profilesFound: _stats.profiles,
        errors: _stats.errors, queueDepth: _queue.length,
        recentFinds: _recentFinds, lastActivity: new Date().toISOString(),
      });
    }

    await sleep(200);
  }

  await saveVisited(_visited, _newVisited);
  await writeState({
    running: false, stoppedAt: new Date().toISOString(),
    pagesVisited: _stats.pages, profilesFound: _stats.profiles,
    errors: _stats.errors, queueDepth: _queue.length,
    recentFinds: _recentFinds, lastActivity: new Date().toISOString(),
  });

  _running = false;
  _stopRequested = false;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startCrawler() {
  if (_running) return;
  _running = true;
  _stopRequested = false;
  crawlLoop().catch((err) => {
    console.error("[crawler] fatal", err);
    _running = false;
    writeState({ running: false, stoppedAt: new Date().toISOString() });
  });
}

export function stopCrawler() { _stopRequested = true; }
export function isCrawlerRunning(): boolean { return _running; }

export function getCrawlerStatus() {
  return { running: _running, queueDepth: _queue.length, stats: { ..._stats }, recentFinds: [..._recentFinds] };
}

export function addSeedUrls(urls: string[]) {
  for (const url of urls) {
    try { new URL(url); enqueue(url, 9); } catch { /* skip invalid */ }
  }
}
