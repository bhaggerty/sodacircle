// file: app/api/profiles/backfill/route.ts
//
// POST /api/profiles/backfill
//
// Re-runs normalizeProfile on every profile that is missing domainTags
// (i.e. indexed before enrichment was added) and writes the enriched
// record back to DynamoDB.
//
// Response: { processed, updated, errors }

import { NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { normalizeProfile, EnrichedProfile } from "@/lib/profiles/normalizeProfile";
import { IndexedProfile } from "@/lib/crawler/store";

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export async function POST() {
  if (!TABLE) {
    return NextResponse.json({ error: "No DynamoDB table configured" }, { status: 500 });
  }

  // Paginate through all profiles
  const all: IndexedProfile[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "PROFILE" },
      ExclusiveStartKey: lastKey,
    }));
    for (const item of res.Items ?? []) all.push(item as IndexedProfile);
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // Filter to profiles that are missing domainTags
  const needsBackfill = all.filter(
    (p) => !(p as EnrichedProfile).domainTags?.length
  );

  let updated = 0;
  let errors = 0;

  for (const raw of needsBackfill) {
    try {
      const enriched = normalizeProfile(raw);
      await db.send(new PutCommand({
        TableName: TABLE,
        Item: { pk: "PROFILE", sk: enriched.id, ...enriched },
      }));
      updated++;
    } catch {
      errors++;
    }
  }

  return NextResponse.json({
    processed: all.length,
    needsBackfill: needsBackfill.length,
    updated,
    errors,
  });
}
