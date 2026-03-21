/**
 * Profile store — DynamoDB-backed (single table from APP_DYNAMODB_TABLE_NAME).
 *
 * Table key schema (standard Union Station single-table):
 *   pk  (String) — partition key
 *   sk  (String) — sort key
 *
 * Key patterns:
 *   Profiles     pk="PROFILE"         sk="<id>"
 *   CrawlerState pk="CRAWLER"         sk="STATE"
 *   Visited URLs pk="VISITED"         sk="<url>"   (written in batches, TTL 30 days)
 *
 * Falls back to in-memory no-op when the table name is not configured,
 * so local dev without AWS credentials doesn't crash.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { normalizeProfile } from "@/lib/profiles/normalizeProfile";

// ── Client ────────────────────────────────────────────────────────────────────

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";

// SDK auto-discovers credentials from the instance role injected by Union Station
const raw = new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" });
const db  = DynamoDBDocumentClient.from(raw, {
  marshallOptions: { removeUndefinedValues: true },
});

const hasTable = () => !!TABLE;

// ── Profile shape ────────────────────────────────────────────────────────────

export interface IndexedProfile {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  bio: string;
  skills: string[];
  email: string;
  githubUrl: string;
  linkedinUrl: string;
  sourceUrl: string;
  sourceName: "github" | "web";
  indexedAt: string;
}

// ── In-memory dedup cache (per process) ──────────────────────────────────────

const _seen = new Set<string>();

function dedupeKey(p: IndexedProfile): string {
  return `${p.name.toLowerCase().trim()}|${p.company.toLowerCase().trim()}`;
}

// ── Write ────────────────────────────────────────────────────────────────────

export async function appendProfile(p: IndexedProfile): Promise<boolean> {
  const key    = dedupeKey(p);
  const altKey = p.githubUrl || p.linkedinUrl || p.email;

  if (_seen.has(key) || (altKey && _seen.has(altKey))) return false;
  _seen.add(key);
  if (altKey) _seen.add(altKey);

  if (!hasTable()) return true; // local dev — accept but don't persist

  // Enrich profile with domain tags, skill tags, confidence score before persisting
  const enriched = normalizeProfile(p);

  try {
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: "PROFILE", sk: enriched.id, ...enriched },
      ConditionExpression: "attribute_not_exists(sk)", // don't overwrite
    }));
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === "ConditionalCheckFailedException") return false;
    console.error("[store] appendProfile error", err);
    return false;
  }
}

// ── Read ─────────────────────────────────────────────────────────────────────

export async function readProfiles(limit = 1000, lastKey?: Record<string, unknown>): Promise<{
  profiles: IndexedProfile[];
  lastKey?: Record<string, unknown>;
}> {
  if (!hasTable()) return { profiles: [] };

  try {
    const res = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "PROFILE" },
      Limit: limit,
      ExclusiveStartKey: lastKey,
    }));

    return {
      profiles: (res.Items ?? []) as IndexedProfile[],
      lastKey: res.LastEvaluatedKey as Record<string, unknown> | undefined,
    };
  } catch (err) {
    console.error("[store] readProfiles error", err);
    return { profiles: [] };
  }
}

export async function countProfiles(): Promise<number> {
  if (!hasTable()) return 0;
  try {
    const res = await db.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "PROFILE" },
      Select: "COUNT",
    }));
    return res.Count ?? 0;
  } catch {
    return 0;
  }
}

export async function searchProfiles(query: string, limit = 50): Promise<IndexedProfile[]> {
  if (!hasTable()) return [];
  if (!query.trim()) {
    const { profiles } = await readProfiles(limit);
    return profiles;
  }

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);

  // DynamoDB doesn't support full-text search — pull all profiles and score in-process.
  // For large tables a GSI + OpenSearch would be better; fine for <50k profiles.
  const { profiles: all } = await readProfiles(10000);

  return all
    .map((p) => {
      const hay = [p.name, p.title, p.company, p.bio, p.location, ...p.skills]
        .join(" ").toLowerCase();
      const score = terms.filter((t) => hay.includes(t)).length;
      return { p, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p);
}

// ── Crawler state ────────────────────────────────────────────────────────────

export interface CrawlerState {
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  pagesVisited: number;
  profilesFound: number;
  errors: number;
  queueDepth: number;
  recentFinds: Array<{ name: string; title: string; company: string; time: string }>;
  lastActivity: string | null;
}

const _defaultState: CrawlerState = {
  running: false, startedAt: null, stoppedAt: null,
  pagesVisited: 0, profilesFound: 0, errors: 0,
  queueDepth: 0, recentFinds: [], lastActivity: null,
};

export async function readState(): Promise<CrawlerState> {
  if (!hasTable()) return { ..._defaultState };
  try {
    const res = await db.send(new GetCommand({
      TableName: TABLE,
      Key: { pk: "CRAWLER", sk: "STATE" },
    }));
    return res.Item ? (res.Item as CrawlerState) : { ..._defaultState };
  } catch {
    return { ..._defaultState };
  }
}

export async function writeState(patch: Partial<CrawlerState>): Promise<void> {
  if (!hasTable()) return;
  const current = await readState();
  try {
    await db.send(new PutCommand({
      TableName: TABLE,
      Item: { pk: "CRAWLER", sk: "STATE", ...current, ...patch },
    }));
  } catch (err) {
    console.error("[store] writeState error", err);
  }
}

// ── Visited URL cache ─────────────────────────────────────────────────────────
// Written in batches; each item has a 30-day TTL so the set self-prunes.

const VISITED_TTL_DAYS = 30;

export async function loadVisited(): Promise<Set<string>> {
  if (!hasTable()) return new Set();
  try {
    const items: string[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const res = await db.send(new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": "VISITED" },
        ProjectionExpression: "sk",
        ExclusiveStartKey: lastKey,
      }));
      for (const item of res.Items ?? []) items.push(item.sk as string);
      lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    return new Set(items);
  } catch (err) {
    console.error("[store] loadVisited error", err);
    return new Set();
  }
}

export async function saveVisited(visited: Set<string>, onlyNew: Set<string> = visited): Promise<void> {
  if (!hasTable() || onlyNew.size === 0) return;

  const ttl = Math.floor(Date.now() / 1000) + VISITED_TTL_DAYS * 86400;
  const urls = [...onlyNew].slice(-2000); // cap batch size per save

  // BatchWrite supports up to 25 items per call
  for (let i = 0; i < urls.length; i += 25) {
    const chunk = urls.slice(i, i + 25);
    try {
      await db.send(new BatchWriteCommand({
        RequestItems: {
          [TABLE]: chunk.map((url) => ({
            PutRequest: { Item: { pk: "VISITED", sk: url, ttl } },
          })),
        },
      }));
    } catch (err) {
      console.error("[store] saveVisited batch error", err);
    }
  }
}
