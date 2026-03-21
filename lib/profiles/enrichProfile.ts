// file: lib/profiles/enrichProfile.ts
//
// Fetches GitHub repo data for a profile and adds:
//   githubStats.topLanguages    — ranked by bytes of code
//   githubStats.topRepos        — top 5 by stars
//   githubStats.totalStars      — sum of stars across public repos
//   githubStats.identityRepos   — repos with identity/auth/access topics
//   githubStats.identitySignals — specific signals (repo names, topics)
//
// Only called for profiles with a githubUrl. Safe to call repeatedly — idempotent.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { EnrichedProfile } from "./normalizeProfile";
import { normalizeProfile } from "./normalizeProfile";

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";
const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export interface GitHubStats {
  topLanguages: string[];
  topRepos: Array<{ name: string; stars: number; description: string; topics: string[] }>;
  totalStars: number;
  identityRepos: string[];       // repo names that look identity-related
  identitySignals: string[];     // topics/names that prove identity expertise
  fetchedAt: string;
}

interface GHRepo {
  name: string;
  stargazers_count: number;
  description: string | null;
  language: string | null;
  fork: boolean;
  topics: string[];
  size: number;
}

// Keywords that indicate a repo is identity/auth/access-related
const IDENTITY_REPO_SIGNALS = [
  "auth", "oauth", "oidc", "saml", "sso", "identity", "iam",
  "access", "rbac", "permission", "entitlement", "scim", "ldap",
  "okta", "cognito", "keycloak", "zitadel", "casdoor", "baton",
  "provisioning", "token", "jwt", "session", "credential",
];

function isIdentityRepo(repo: GHRepo): boolean {
  const text = [repo.name, repo.description ?? "", ...(repo.topics ?? [])].join(" ").toLowerCase();
  return IDENTITY_REPO_SIGNALS.some((sig) => text.includes(sig));
}

async function fetchGitHubRepos(login: string): Promise<GHRepo[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    "User-Agent": "sodacircle-enricher/1.0",
    Accept: "application/vnd.github+json",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(
    `https://api.github.com/users/${login}/repos?sort=stars&per_page=30&type=owner`,
    { headers, signal: AbortSignal.timeout(10000) }
  );
  if (!res.ok) return [];
  return res.json() as Promise<GHRepo[]>;
}

function computeGitHubStats(repos: GHRepo[]): GitHubStats {
  const ownRepos = repos.filter((r) => !r.fork);

  // Language frequency (by repo count, not bytes — close enough without language API)
  const langCount: Record<string, number> = {};
  for (const r of ownRepos) {
    if (r.language) langCount[r.language] = (langCount[r.language] ?? 0) + 1;
  }
  const topLanguages = Object.entries(langCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([lang]) => lang.toLowerCase());

  // Top repos by stars
  const topRepos = ownRepos
    .sort((a, b) => b.stargazers_count - a.stargazers_count)
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      stars: r.stargazers_count,
      description: r.description ?? "",
      topics: r.topics ?? [],
    }));

  const totalStars = ownRepos.reduce((sum, r) => sum + r.stargazers_count, 0);

  // Identity signals
  const identityRepos = ownRepos.filter(isIdentityRepo).map((r) => r.name);
  const identitySignals = [
    ...new Set([
      ...ownRepos.flatMap((r) => r.topics ?? []).filter((t) =>
        IDENTITY_REPO_SIGNALS.some((sig) => t.includes(sig))
      ),
      ...identityRepos,
    ]),
  ].slice(0, 10);

  return {
    topLanguages,
    topRepos,
    totalStars,
    identityRepos,
    identitySignals,
    fetchedAt: new Date().toISOString(),
  };
}

function loginFromGitHubUrl(url: string): string | null {
  const m = url.match(/github\.com\/([^/?#]+)/);
  return m?.[1] ?? null;
}

// ── Main enrichment function ──────────────────────────────────────────────────

export async function enrichProfileWithGitHub(
  profileId: string
): Promise<{ ok: boolean; enriched?: EnrichedProfile; error?: string }> {
  if (!TABLE) return { ok: false, error: "No DynamoDB table configured" };

  // Fetch profile from DynamoDB
  const res = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: "PROFILE", sk: profileId },
  }));

  if (!res.Item) return { ok: false, error: `Profile ${profileId} not found` };

  const profile = res.Item as EnrichedProfile;

  if (!profile.githubUrl) return { ok: false, error: "No GitHub URL on profile" };

  const login = loginFromGitHubUrl(profile.githubUrl);
  if (!login) return { ok: false, error: "Could not parse GitHub login" };

  // Fetch repos
  const repos = await fetchGitHubRepos(login);
  if (!repos.length) return { ok: false, error: "No repos found or GitHub API error" };

  const githubStats = computeGitHubStats(repos);

  // Merge GitHub languages into skills
  const mergedSkills = [
    ...new Set([
      ...(profile.skills ?? []),
      ...githubStats.topLanguages,
    ]),
  ].slice(0, 20);

  // Re-run normalization with enriched data
  const enrichedBase = {
    ...profile,
    skills: mergedSkills,
    bio: profile.bio || githubStats.topRepos.map((r) => r.description).filter(Boolean).join(". "),
  };
  const enriched: EnrichedProfile = {
    ...normalizeProfile(enrichedBase),
    githubStats,
    // Boost identity domain tag if we found identity repos
    domainTags: githubStats.identitySignals.length > 0
      ? [...new Set([...normalizeProfile(enrichedBase).domainTags, "identity"])]
      : normalizeProfile(enrichedBase).domainTags,
  } as EnrichedProfile & { githubStats: GitHubStats };

  // Write back to DynamoDB (overwrite — no condition check)
  await db.send(new PutCommand({
    TableName: TABLE,
    Item: { pk: "PROFILE", sk: profileId, ...enriched },
  }));

  return { ok: true, enriched };
}

// ── Batch enrich: all profiles with githubUrl but no githubStats ──────────────

export async function enrichProfilesBatch(
  profiles: EnrichedProfile[],
  maxBatch = 20
): Promise<{ enriched: number; errors: number }> {
  const toEnrich = profiles
    .filter((p) => p.githubUrl && !(p as EnrichedProfile & { githubStats?: GitHubStats }).githubStats)
    .slice(0, maxBatch);

  let enriched = 0;
  let errors = 0;

  for (const p of toEnrich) {
    const result = await enrichProfileWithGitHub(p.id);
    if (result.ok) enriched++;
    else errors++;
    // Gentle rate limit
    await new Promise((r) => setTimeout(r, 400));
  }

  return { enriched, errors };
}
