// file: lib/search/retrieveCandidates.ts
//
// Step 2 of the search pipeline.
// Pulls profiles from DynamoDB and scores them against the parsed query.
// No vector DB — pure term + domain matching, fast enough for <100k profiles.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { ParsedQuery } from "./parseQuery";
import { EnrichedProfile } from "@/lib/profiles/normalizeProfile";

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export interface ScoredProfile {
  profile: EnrichedProfile;
  termScore: number;      // 0–100, how well raw terms match
  domainScore: number;    // 0–100, domain tag overlap
  totalScore: number;     // weighted combination
  matchedTerms: string[]; // which expanded terms hit
  matchedDomains: string[];
}

// ── Retrieve all profiles from DynamoDB (paginated) ───────────────────────────

export async function fetchAllProfiles(): Promise<EnrichedProfile[]> {
  if (!TABLE) return [];

  const profiles: EnrichedProfile[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "PROFILE" },
      ExclusiveStartKey: lastKey,
    }));
    for (const item of res.Items ?? []) {
      profiles.push(item as EnrichedProfile);
    }
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return profiles;
}

// ── Score a single profile against a parsed query ────────────────────────────

function buildHaystack(p: EnrichedProfile): string {
  return [
    p.name,
    p.title,
    p.company,
    p.bio,
    p.location,
    ...(p.skills ?? []),
    ...(p.domainTags ?? []),
    ...(p.skillTags ?? []),
    p.inferredDomain ?? "",
    ...(p.priorCompanies ?? []),
  ].join(" ").toLowerCase();
}

export function scoreProfile(profile: EnrichedProfile, query: ParsedQuery): ScoredProfile {
  const hay = buildHaystack(profile);

  // Term matching
  const matchedTerms: string[] = [];
  for (const term of query.expandedTerms) {
    if (hay.includes(term.toLowerCase())) matchedTerms.push(term);
  }

  // Domain matching (higher weight — indicates real expertise area)
  const matchedDomains: string[] = [];
  const profileDomains = [...(profile.domainTags ?? []), profile.inferredDomain ?? ""];
  for (const domain of query.domainTags) {
    if (profileDomains.some((d) => d && d.includes(domain))) {
      matchedDomains.push(domain);
    }
  }

  // Seniority bonus
  let seniorityBonus = 0;
  if (query.seniority) {
    const seniorityMap: Record<string, string[]> = {
      staff:     ["staff engineer", "staff software", "l5"],
      principal: ["principal engineer", "principal software", "l6", "distinguished"],
      senior:    ["senior", "sr.", "lead"],
      executive: ["cto", "vp engineering", "director of engineering", "head of engineering"],
    };
    const tokens = seniorityMap[query.seniority] ?? [];
    if (tokens.some((t) => hay.includes(t))) seniorityBonus = 15;
  }

  // Company signal bonus (target companies)
  let companyBonus = 0;
  for (const co of query.targetCompanies) {
    if (hay.includes(co.toLowerCase())) { companyBonus = 20; break; }
  }

  // Geo filter (soft — just penalise mismatches, don't exclude)
  let geoScore = 0;
  if (query.geoPreference) {
    const geo = query.geoPreference.toLowerCase();
    if (hay.includes("remote") || hay.includes(geo)) geoScore = 5;
  }

  const totalTerms = Math.max(query.expandedTerms.length, 1);
  const totalDomains = Math.max(query.domainTags.length, 1);

  const termScore   = Math.round((matchedTerms.length / totalTerms) * 100);
  const domainScore = Math.round((matchedDomains.length / totalDomains) * 100);

  // Weighted: domains matter more (indicate genuine expertise)
  const base = domainScore * 0.45 + termScore * 0.35 + seniorityBonus + companyBonus + geoScore;
  const totalScore = Math.min(100, Math.round(base));

  return { profile, termScore, domainScore, totalScore, matchedTerms, matchedDomains };
}

// ── Main retrieval function ───────────────────────────────────────────────────

export async function retrieveCandidates(
  query: ParsedQuery,
  topN = 40
): Promise<ScoredProfile[]> {
  const profiles = await fetchAllProfiles();
  if (!profiles.length) return [];

  const scored = profiles
    .map((p) => scoreProfile(p, query))
    .filter((s) => s.totalScore > 0 || s.matchedTerms.length > 0);

  // Sort by totalScore descending, return top N
  return scored
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, topN);
}
