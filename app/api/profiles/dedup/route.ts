// file: app/api/profiles/dedup/route.ts
//
// POST /api/profiles/dedup
//
// Runs identity stitching across all profiles in DynamoDB.
// Merged duplicates are written back as a single canonical record;
// the secondary records are deleted.
//
// Response: { scanned, groups, merges, deleted, errors }

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { EnrichedProfile } from "@/lib/profiles/normalizeProfile";
import { dedupProfiles, matchProfiles, mergeIntoCanonical } from "@/lib/profiles/mergeProfiles";

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export async function POST() {
  if (!TABLE) {
    return NextResponse.json({ error: "No DynamoDB table configured" }, { status: 500 });
  }

  // Load all profiles
  const all: EnrichedProfile[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "PROFILE" },
      ExclusiveStartKey: lastKey,
    }));
    for (const item of res.Items ?? []) all.push(item as EnrichedProfile);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // Find duplicate groups (O(n²) — acceptable for <50k profiles)
  const assigned = new Set<string>();
  const groups: { canonical: EnrichedProfile; secondaries: EnrichedProfile[] }[] = [];

  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    if (assigned.has(a.id)) continue;
    assigned.add(a.id);

    const secondaries: EnrichedProfile[] = [];
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j];
      if (assigned.has(b.id)) continue;
      const { matched, reason } = matchProfiles(a, b);
      if (matched) {
        secondaries.push(b);
        assigned.add(b.id);
      }
    }

    if (secondaries.length > 0) {
      groups.push({ canonical: a, secondaries });
    }
  }

  let merges = 0;
  let deleted = 0;
  let errors = 0;

  for (const { canonical, secondaries } of groups) {
    try {
      // Merge all secondaries into canonical
      let merged = canonical;
      for (const sec of secondaries) {
        const result = mergeIntoCanonical(merged, sec, "dedup run");
        merged = result.canonical;
      }

      // Write merged canonical
      await db.send(new PutCommand({
        TableName: TABLE,
        Item: { pk: "PROFILE", sk: merged.id, ...merged },
      }));
      merges++;

      // Delete secondary records (keep canonical ID, drop the rest)
      for (const sec of secondaries) {
        if (sec.id !== merged.id) {
          await db.send(new DeleteCommand({
            TableName: TABLE,
            Key: { pk: "PROFILE", sk: sec.id },
          }));
          deleted++;
        }
      }
    } catch {
      errors++;
    }
  }

  return NextResponse.json({
    scanned: all.length,
    groups: groups.length,
    merges,
    deleted,
    errors,
  });
}
