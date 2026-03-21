// file: app/api/admin/stats/route.ts
//
// GET /api/admin/stats
//
// Returns DB health metrics for the admin dashboard:
//   totalProfiles, enrichedProfiles, needsBackfill, avgConfidence,
//   domainDistribution, recentSearches

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { EnrichedProfile } from "@/lib/profiles/normalizeProfile";
import { GitHubStats } from "@/lib/profiles/enrichProfile";

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export interface AdminStats {
  totalProfiles: number;
  enrichedProfiles: number;     // have githubStats
  needsBackfill: number;        // missing domainTags
  avgConfidence: number;        // 0-1
  domainDistribution: Record<string, number>;
  topSkills: Array<{ skill: string; count: number }>;
  recentSearches: Array<{
    query: string;
    parsedIntent: string;
    returnedCount: number;
    durationMs: number;
    loggedAt: string;
  }>;
}

export async function GET() {
  if (!TABLE) {
    return NextResponse.json({ error: "No DynamoDB table configured" }, { status: 500 });
  }

  // Load all profiles
  const profiles: EnrichedProfile[] = [];
  let profilesLastKey: Record<string, unknown> | undefined;
  do {
    const res = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "PROFILE" },
      ExclusiveStartKey: profilesLastKey,
    }));
    for (const item of res.Items ?? []) profiles.push(item as EnrichedProfile);
    profilesLastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (profilesLastKey);

  // Compute metrics
  const enrichedProfiles = profiles.filter(
    (p) => !!(p as EnrichedProfile & { githubStats?: GitHubStats }).githubStats
  ).length;

  const needsBackfill = profiles.filter(
    (p) => !(p.domainTags?.length)
  ).length;

  const totalConfidence = profiles.reduce((s, p) => s + (p.confidence ?? 0), 0);
  const avgConfidence = profiles.length > 0
    ? Math.round((totalConfidence / profiles.length) * 100) / 100
    : 0;

  // Domain distribution
  const domainDist: Record<string, number> = {};
  for (const p of profiles) {
    for (const d of p.domainTags ?? []) {
      domainDist[d] = (domainDist[d] ?? 0) + 1;
    }
  }

  // Top skills
  const skillCount: Record<string, number> = {};
  for (const p of profiles) {
    for (const s of [...(p.skills ?? []), ...(p.skillTags ?? [])]) {
      const norm = s.toLowerCase().trim();
      if (norm) skillCount[norm] = (skillCount[norm] ?? 0) + 1;
    }
  }
  const topSkills = Object.entries(skillCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([skill, count]) => ({ skill, count }));

  // Recent search logs
  const searchRes = await db.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "pk = :pk",
    ExpressionAttributeValues: { ":pk": "SEARCH_LOG" },
    ScanIndexForward: false,   // newest first
    Limit: 20,
  }));

  const recentSearches = (searchRes.Items ?? []).map((item) => ({
    query:         String(item.query ?? ""),
    parsedIntent:  String(item.parsedIntent ?? ""),
    returnedCount: Number(item.returnedCount ?? 0),
    durationMs:    Number(item.durationMs ?? 0),
    loggedAt:      String(item.loggedAt ?? ""),
  }));

  const stats: AdminStats = {
    totalProfiles: profiles.length,
    enrichedProfiles,
    needsBackfill,
    avgConfidence,
    domainDistribution: domainDist,
    topSkills,
    recentSearches,
  };

  return NextResponse.json(stats);
}
