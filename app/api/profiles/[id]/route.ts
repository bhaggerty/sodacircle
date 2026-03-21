// file: app/api/profiles/[id]/route.ts
//
// GET /api/profiles/:id — fetch a single indexed profile from DynamoDB

import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!TABLE) {
    return NextResponse.json({ error: "No DynamoDB table configured" }, { status: 500 });
  }

  const res = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: "PROFILE", sk: id },
  }));

  if (!res.Item) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({ profile: res.Item });
}
