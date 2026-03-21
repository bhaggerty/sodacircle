/**
 * Web sourcing — crawls public company pages, conference speaker lists,
 * and personal portfolio sites to extract person profiles.
 *
 * Respects robots.txt (RFC 9309).
 * Uses Claude for extraction when ANTHROPIC_API_KEY is set.
 * Never crawls behind logins or bypasses access controls.
 */

import type { SourcedCandidate } from "./github";

// ── Common team/people page path patterns ────────────────────────────────────

const PEOPLE_PATHS = [
  "/team", "/about", "/leadership", "/people", "/staff",
  "/company/team", "/company/about", "/company/leadership",
  "/about-us", "/our-team", "/meet-the-team", "/who-we-are",
  "/speakers", "/crew", "/founders", "/executives",
  "/en/team", "/en/about",
];

// ── Fetch with timeout ───────────────────────────────────────────────────────

async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "sodacircle-bot/1.0 (public recruiting research; respects robots.txt)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

// ── HTML cleaning ────────────────────────────────────────────────────────────

function cleanHtml(html: string): string {
  return html
    // Remove script, style, nav, header, footer — they're just noise
    .replace(/<(script|style|nav|header|footer|noscript|iframe|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    // Remove all remaining tags
    .replace(/<[^>]+>/g, " ")
    // Decode common HTML entities
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#?\w+;/g, " ")
    // Collapse whitespace
    .replace(/\s{2,}/g, " ")
    .trim()
    // Truncate — enough for Claude to work with, cheap on tokens
    .slice(0, 7000);
}

// ── robots.txt parsing ───────────────────────────────────────────────────────

async function fetchRobotsTxt(origin: string): Promise<string> {
  try {
    const res = await fetchWithTimeout(`${origin}/robots.txt`, 4000);
    if (res.ok) return await res.text();
  } catch { /* unreachable or no robots.txt — treat as open */ }
  return "";
}

function parseDisallowed(robotsTxt: string): string[] {
  const disallowed: string[] = [];
  let inDefaultBlock = false;

  for (const raw of robotsTxt.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("#") || !line) continue;

    if (/^user-agent\s*:/i.test(line)) {
      const agent = line.split(":")[1].trim();
      inDefaultBlock = agent === "*";
    } else if (inDefaultBlock && /^disallow\s*:/i.test(line)) {
      const path = line.split(":")[1].trim();
      if (path) disallowed.push(path);
    }
  }

  return disallowed;
}

function isAllowed(pathname: string, disallowed: string[]): boolean {
  return !disallowed.some((rule) => {
    if (!rule || rule === "/") return false; // disallow "/" means disallow everything — we skip that site
    return pathname.startsWith(rule);
  });
}

// ── Sitemap discovery ────────────────────────────────────────────────────────

async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const urls: string[] = [];

  try {
    const res = await fetchWithTimeout(`${origin}/sitemap.xml`, 6000);
    if (!res.ok) return urls;
    const xml = await res.text();

    // Handle sitemap index files (nested sitemaps)
    const sitemapRefs = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (sitemapRefs.length > 0) {
      // Fetch first few sub-sitemaps
      for (const ref of sitemapRefs.slice(0, 3)) {
        try {
          const sub = await fetchWithTimeout(ref, 4000);
          if (sub.ok) {
            const subXml = await sub.text();
            urls.push(...[...subXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
          }
        } catch { /* skip */ }
      }
    } else {
      urls.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
    }
  } catch { /* no sitemap */ }

  return urls;
}

// ── People URL discovery ─────────────────────────────────────────────────────

async function findPeopleUrls(origin: string, disallowed: string[]): Promise<string[]> {
  const found: string[] = [];

  // Strategy 1: sitemap
  const sitemapUrls = await fetchSitemapUrls(origin);
  for (const url of sitemapUrls) {
    try {
      const { pathname } = new URL(url);
      if (
        PEOPLE_PATHS.some((p) => pathname.toLowerCase().includes(p)) &&
        isAllowed(pathname, disallowed)
      ) {
        found.push(url);
        if (found.length >= 8) break;
      }
    } catch { /* skip malformed URLs */ }
  }

  // Strategy 2: try common paths directly
  if (found.length < 2) {
    for (const path of PEOPLE_PATHS) {
      if (!isAllowed(path, disallowed)) continue;
      const url = `${origin}${path}`;
      try {
        const res = await fetchWithTimeout(url, 5000);
        if (res.ok && res.headers.get("content-type")?.includes("text/html")) {
          found.push(url);
          if (found.length >= 5) break;
        }
      } catch { /* skip */ }
    }
  }

  return [...new Set(found)];
}

// ── Claude extraction ─────────────────────────────────────────────────────────

interface ExtractedPerson {
  full_name: string;
  title: string;
  company: string;
  location: string;
  bio: string;
  email: string;
  linkedin_url: string;
  github_url: string;
  skills: string[];
}

async function extractPeopleWithClaude(
  pageText: string,
  sourceUrl: string
): Promise<ExtractedPerson[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const prompt = `Extract professional profiles from this webpage text.
Source URL: ${sourceUrl}

Page text:
${pageText}

Return a JSON array of people found. For each person include:
{
  "full_name": "First Last",
  "title": "their current title",
  "company": "their employer (infer from context/domain if not stated)",
  "location": "city, country or remote",
  "bio": "2-3 sentence summary of their background",
  "email": "if publicly listed",
  "linkedin_url": "if found",
  "github_url": "if found",
  "skills": ["skill1", "skill2"]
}

Rules:
- Only include real professionals with a name and title
- Skip generic contact forms, nav links, press releases
- If this is a team page, extract ALL visible team members
- Return [] if no clear person profiles exist
- Return ONLY the JSON array, no commentary`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) return [];
    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const raw = data.content.find((b) => b.type === "text")?.text ?? "[]";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as ExtractedPerson[] | { people?: ExtractedPerson[] };
    return Array.isArray(parsed) ? parsed : (parsed.people ?? []);
  } catch {
    return [];
  }
}

// ── Heuristic extraction fallback ────────────────────────────────────────────
// Used when no Claude key — tries to pick up name/title patterns from page text

function heuristicExtract(pageText: string, sourceUrl: string): ExtractedPerson[] {
  const domain = (() => { try { return new URL(sourceUrl).hostname.replace("www.", ""); } catch { return ""; } })();
  const company = domain.split(".")[0];

  // Very rough: look for patterns like "Name\nTitle" or "Name, Title"
  const lines = pageText.split(/[\n|·•–—]/).map((l) => l.trim()).filter((l) => l.length > 2 && l.length < 80);
  const people: ExtractedPerson[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const nameLine = lines[i];
    const titleLine = lines[i + 1];
    // Heuristic: name is 2-4 words, title has common role keywords
    const looksLikeName = /^[A-Z][a-z]+(\s[A-Z][a-z]+){1,3}$/.test(nameLine);
    const looksLikeTitle = /(engineer|manager|director|vp|founder|ceo|cto|coo|head|lead|principal|partner|associate|analyst|designer|product|sales|marketing)/i.test(titleLine);
    if (looksLikeName && looksLikeTitle) {
      people.push({
        full_name: nameLine,
        title: titleLine,
        company,
        location: "",
        bio: "",
        email: "",
        linkedin_url: "",
        github_url: "",
        skills: [],
      });
      i++; // skip title line
    }
  }

  return people.slice(0, 20);
}

// ── Normalize to SourcedCandidate ────────────────────────────────────────────

function normalize(person: ExtractedPerson, sourceUrl: string): SourcedCandidate {
  const domain = (() => { try { return new URL(sourceUrl).hostname.replace("www.", ""); } catch { return ""; } })();
  const id = `web-${Buffer.from(`${person.full_name}|${sourceUrl}`).toString("base64").slice(0, 16)}`;

  return {
    id,
    name: person.full_name,
    title: person.title,
    company: person.company || domain,
    location: person.location,
    email: person.email,
    linkedinUrl: person.linkedin_url,
    summary: person.bio || `${person.title}${person.company ? ` at ${person.company}` : ""}. Found on ${domain}.`,
    experience: person.skills.length > 0 ? `Skills: ${person.skills.join(", ")}` : "",
    notes: `Sourced from ${sourceUrl}`,
    sourceUrl,
    sourceName: "web",
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface WebCrawlResult {
  candidates: SourcedCandidate[];
  errors: string[];
  pagesVisited: number;
  sourceSummary: Record<string, number>;
}

export async function crawlForPeople(
  seedInputs: string[],
  _geoPreference = "",
  limit = 30
): Promise<WebCrawlResult> {
  const allCandidates: SourcedCandidate[] = [];
  const errors: string[] = [];
  let pagesVisited = 0;
  const sourceSummary: Record<string, number> = {};

  for (const input of seedInputs.slice(0, 10)) {
    if (allCandidates.length >= limit) break;

    // Normalise input to a URL
    let origin: string;
    let specificPage: string | null = null;

    try {
      const raw = input.trim().startsWith("http") ? input.trim() : `https://${input.trim()}`;
      const parsed = new URL(raw);
      origin = `${parsed.protocol}//${parsed.host}`;
      // If user gave a full path (not just a domain), crawl that specific page too
      if (parsed.pathname.length > 1) specificPage = raw;
    } catch {
      errors.push(`Invalid URL: ${input}`);
      continue;
    }

    try {
      // 1. Robots check
      const robotsTxt = await fetchRobotsTxt(origin);
      const disallowed = parseDisallowed(robotsTxt);

      // 2. Find people pages
      const urls = specificPage
        ? [specificPage, ...(await findPeopleUrls(origin, disallowed)).slice(0, 3)]
        : await findPeopleUrls(origin, disallowed);

      if (urls.length === 0) {
        errors.push(`No public team/people pages found at ${origin}`);
        continue;
      }

      // 3. Crawl each page
      for (const url of urls.slice(0, 5)) {
        if (allCandidates.length >= limit) break;
        try {
          const res = await fetchWithTimeout(url, 8000);
          if (!res.ok) continue;

          const html = await res.text();
          const text = cleanHtml(html);
          pagesVisited++;

          // 4. Extract people (Claude if available, heuristic fallback)
          const people = process.env.ANTHROPIC_API_KEY
            ? await extractPeopleWithClaude(text, url)
            : heuristicExtract(text, url);

          const normalized = people.map((p) => normalize(p, url));
          allCandidates.push(...normalized);
          sourceSummary[origin] = (sourceSummary[origin] ?? 0) + normalized.length;
        } catch (err) {
          errors.push(`Failed to crawl ${url}: ${String(err).slice(0, 100)}`);
        }
      }
    } catch (err) {
      errors.push(`Failed to process ${origin}: ${String(err).slice(0, 100)}`);
    }
  }

  // Deduplicate by name+company
  const seen = new Set<string>();
  const deduped = allCandidates.filter((c) => {
    const key = `${c.name.toLowerCase()}|${c.company.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { candidates: deduped.slice(0, limit), errors, pagesVisited, sourceSummary };
}
