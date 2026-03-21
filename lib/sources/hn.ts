/**
 * Hacker News sourcing — parses the monthly "Who wants to be hired?" threads
 * via the HN Algolia API (free, no key required).
 *
 * Thread format people use:
 *   Location: City | Remote: Yes/No | Technologies: X, Y | Email: x@y.com | Bio: ...
 */

import type { SourcedCandidate } from "./github";

interface AlgoliaHit {
  objectID: string;
  author: string;
  comment_text?: string;
  story_text?: string;
  title?: string;
  created_at: string;
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
}

const ALGOLIA = "https://hn.algolia.com/api/v1";

// ── Thread discovery ──────────────────────────────────────────────

async function getLatestHiringThread(): Promise<string | null> {
  const url = `${ALGOLIA}/search?tags=ask_hn&query=who+wants+to+be+hired&hitsPerPage=5`;
  const res = await fetch(url, { next: { revalidate: 3600 } });
  if (!res.ok) return null;
  const data = await res.json() as AlgoliaResponse;
  const thread = data.hits
    .filter((h) => /who wants to be hired/i.test(h.title ?? ""))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  return thread?.objectID ?? null;
}

// ── Comment fetching ──────────────────────────────────────────────

async function fetchThreadComments(storyId: string, page = 0): Promise<AlgoliaHit[]> {
  const url = `${ALGOLIA}/search?tags=comment,story_${storyId}&hitsPerPage=100&page=${page}`;
  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) return [];
  const data = await res.json() as AlgoliaResponse;
  return data.hits;
}

// ── Comment parsing ───────────────────────────────────────────────

function strip(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function extract(text: string, ...labels: string[]): string {
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:|]\\s*([^\\n|<]{2,120})`, "i");
    const m = text.match(pattern);
    if (m) return m[1].trim();
  }
  return "";
}

function parseComment(hit: AlgoliaHit): SourcedCandidate | null {
  const raw = hit.comment_text || hit.story_text || "";
  if (!raw || raw.length < 80) return null;

  const text = strip(raw);

  const hasMarkers =
    /\b(seeking|location|remote|technologies|skills|email|resume|available)\b/i.test(text);
  if (!hasMarkers) return null;

  const location = extract(text, "Location", "Loc");
  const remote = extract(text, "Remote", "Remote only");
  const technologies = extract(text, "Technologies", "Tech", "Skills", "Stack");
  const email = text.match(/[\w.+%-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? "";
  const resumeUrl = text.match(/(?:Resume|CV|Portfolio|LinkedIn)\s*[:|]\s*(https?:\/\/[^\s|<\n]{5,})/i)?.[1] ?? "";
  const linkedinUrl = resumeUrl.includes("linkedin.com")
    ? resumeUrl
    : text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s|<\n]+/i)?.[0] ?? "";

  const summary = text.replace(/\n+/g, " ").slice(0, 400);
  const firstLine = text.split(/\n/)[0].trim().slice(0, 100);
  const title = technologies
    ? `${technologies.split(",")[0].trim()} Professional`
    : firstLine.length > 10
    ? firstLine
    : "HN Community Member";

  const locationStr = [location, remote && /yes/i.test(remote) ? "Remote OK" : ""].filter(Boolean).join(" · ");

  return {
    id: `hn-${hit.objectID}`,
    name: hit.author,
    title: title.slice(0, 80),
    company: "",
    location: locationStr,
    email,
    linkedinUrl,
    summary,
    experience: technologies ? `Skills: ${technologies}` : "See HN profile",
    notes: `Sourced from HN "Who wants to be hired" · ${new Date(hit.created_at).toLocaleDateString()}`,
    sourceUrl: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    sourceName: "hn",
  };
}

// ── Relevance filtering ───────────────────────────────────────────

function isRelevant(candidate: SourcedCandidate, keywords: string[]): boolean {
  const haystack = [candidate.title, candidate.summary, candidate.experience]
    .join(" ")
    .toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

// ── Location filtering ────────────────────────────────────────────

const NON_US_MARKERS = [
  "london", "united kingdom", " uk", "england", "scotland", "wales",
  "germany", "berlin", "munich",
  "france", "paris",
  "india", "bangalore", "bengaluru", "mumbai", "delhi", "hyderabad", "pune",
  "china", "beijing", "shanghai",
  "canada", "toronto", "vancouver", "montreal",
  "australia", "sydney", "melbourne",
  "netherlands", "amsterdam",
  "spain", "madrid", "barcelona",
  "italy", "rome", "milan",
  "japan", "tokyo",
  "singapore",
  "brazil", "são paulo", "sao paulo",
  "pakistan", "nigeria", "kenya", "south africa",
  "poland", "warsaw", "ukraine", "kyiv",
  "sweden", "stockholm", "norway", "oslo",
  "denmark", "copenhagen",
  "switzerland", "zurich",
  "finland", "helsinki",
  "new zealand", "auckland",
  "israel", "tel aviv",
  "turkey", "istanbul",
  "mexico", "mexico city",
];

const US_MARKERS = [
  "united states", "usa", "u.s.", "us ", " us", "america",
  "new york", "nyc", "san francisco", "sf", "bay area", "silicon valley",
  "seattle", "los angeles", "austin", "boston", "chicago", "denver",
  "atlanta", "miami", "portland", "remote us", "us remote",
  "east coast", "west coast", "midwest",
];

function isLocationMatch(candidate: SourcedCandidate, geoPreference: string): boolean {
  if (!geoPreference) return true;

  const geo = geoPreference.toLowerCase();

  const isUsSearch =
    /\b(united states|usa|u\.s\.|new york|san francisco|seattle|austin|boston|chicago|denver|atlanta|los angeles)\b/.test(geo) ||
    /remote\s*\(?\s*(us|usa)\s*\)?/.test(geo) ||
    /\b(west coast|east coast|midwest|us only)\b/.test(geo);

  if (!isUsSearch) return true;

  // Only check the location field — never the summary.
  // If a London developer mentions "San Francisco" in their bio they should NOT pass.
  const loc = candidate.location.toLowerCase().trim();

  // No location set → keep (benefit of the doubt)
  if (!loc) return true;

  // Clearly non-US → exclude
  if (NON_US_MARKERS.some((m) => loc.includes(m))) return false;

  // Clearly US or remote-friendly → include
  if (US_MARKERS.some((m) => loc.includes(m))) return true;
  if (/worldwide|anywhere|nomad/i.test(loc)) return true;

  // Unrecognized location string → keep
  return true;
}

// ── Public API ────────────────────────────────────────────────────

export async function searchHn(
  keywords: string[],
  geoPreference?: string,
  maxResults = 15
): Promise<SourcedCandidate[]> {
  const threadId = await getLatestHiringThread();
  if (!threadId) return [];

  // Fetch up to 3 pages of comments for better coverage
  const pages = await Promise.all([
    fetchThreadComments(threadId, 0),
    fetchThreadComments(threadId, 1),
    fetchThreadComments(threadId, 2),
  ]);

  const allComments = pages.flat();

  const parsed = allComments
    .map(parseComment)
    .filter((c): c is SourcedCandidate => c !== null);

  // Filter by keyword relevance
  const relevant = keywords.length > 0
    ? parsed.filter((c) => isRelevant(c, keywords))
    : parsed;

  // Filter by location
  const locationFiltered = geoPreference
    ? relevant.filter((c) => isLocationMatch(c, geoPreference))
    : relevant;

  return locationFiltered.slice(0, maxResults);
}

export async function searchHnByKeyword(
  query: string,
  geoPreference?: string,
  maxResults = 10
): Promise<SourcedCandidate[]> {
  const url = `${ALGOLIA}/search?tags=comment&query=${encodeURIComponent(query + " SEEKING")}&hitsPerPage=${maxResults * 2}`;
  const res = await fetch(url, { next: { revalidate: 900 } });
  if (!res.ok) return [];

  const data = await res.json() as AlgoliaResponse;
  const candidates = data.hits
    .map(parseComment)
    .filter((c): c is SourcedCandidate => c !== null);

  return (geoPreference
    ? candidates.filter((c) => isLocationMatch(c, geoPreference))
    : candidates
  ).slice(0, maxResults);
}
