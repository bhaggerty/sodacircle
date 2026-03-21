// file: lib/search/searchLog.ts
//
// Writes SEARCH_LOG items to DynamoDB.
// pk = SEARCH_LOG, sk = <timestamp>#<random>
// Used for understanding what recruiters are searching for.

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

interface SearchLogEntry {
  query: string;
  parsedIntent: string;
  domainTags: string[];
  expandedTermCount: number;
  retrievedCount: number;
  returnedCount: number;
  durationMs: number;
}

export async function writeSearchLog(entry: SearchLogEntry): Promise<void> {
  if (!TABLE) return;
  const sk = `${new Date().toISOString()}#${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: {
        pk: "SEARCH_LOG",
        sk,
        ...entry,
        loggedAt: new Date().toISOString(),
        // TTL: 90 days
        ttl: Math.floor(Date.now() / 1000) + 90 * 86400,
      },
    }));
  } catch (err) {
    console.error("[searchLog] write error", err);
  }
}
