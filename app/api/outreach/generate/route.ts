// file: app/api/outreach/generate/route.ts
//
// POST /api/outreach/generate
//
// Generates a personalized 3-step cold outreach sequence for an indexed profile.
// Uses Claude Haiku (fast + cheap). Falls back to template if no API key.
//
// Body:  { profileId: string, context?: string }
// Response: { steps: OutreachStep[] }

import { NextRequest, NextResponse } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { OutreachStep } from "@/lib/types";
import { GitHubStats } from "@/lib/profiles/enrichProfile";

const TABLE = process.env.APP_DYNAMODB_TABLE_NAME ?? "";

const db = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION ?? "us-east-1" }),
  { marshallOptions: { removeUndefinedValues: true } }
);

async function callHaiku(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const d = await res.json() as { content: Array<{ type: string; text: string }> };
  return d.content.find((b) => b.type === "text")?.text?.trim() ?? "";
}

function buildPrompt(profile: Record<string, unknown>, context?: string): string {
  const gh = profile.githubStats as GitHubStats | undefined;
  const topRepo = gh?.topRepos?.[0];
  const githubLine = topRepo
    ? `Top GitHub repo: ${topRepo.name} (★${topRepo.stars}) — ${topRepo.description}`
    : "";
  const identityLine = gh?.identitySignals?.length
    ? `Identity/auth signals: ${gh.identitySignals.slice(0, 5).join(", ")}`
    : "";

  return `You are a senior technical recruiter writing cold outreach for an identity/security/platform engineering role.

CANDIDATE:
Name: ${profile.name}
Title: ${profile.title ?? ""} @ ${profile.company ?? ""}
Location: ${profile.location ?? "unknown"}
Bio: ${String(profile.bio ?? "").slice(0, 300)}
Skills: ${(profile.skills as string[] ?? []).slice(0, 12).join(", ")}
Domain expertise: ${(profile.domainTags as string[] ?? []).join(", ")}
Prior companies: ${(profile.priorCompanies as string[] ?? []).join(", ")}
${githubLine}
${identityLine}
${context ? `\nAdditional context: ${context}` : ""}

Write a 3-step cold outreach email sequence. Be specific — reference THIS person's actual work, repos, or background. Do not use generic templates.

Return ONLY a JSON array with exactly 3 items:
[
  {
    "stepNumber": 1,
    "delayDays": 0,
    "condition": "immediate",
    "subject": "<subject line>",
    "body": "<email body, 3-5 short paragraphs, no sign-off name>"
  },
  {
    "stepNumber": 2,
    "delayDays": 3,
    "condition": "if-no-reply",
    "subject": "<follow-up subject, shorter>",
    "body": "<follow-up, 2-3 sentences, references step 1>"
  },
  {
    "stepNumber": 3,
    "delayDays": 7,
    "condition": "if-no-reply",
    "subject": "<final nudge subject>",
    "body": "<final short note, 1-2 sentences, low pressure close>"
  }
]

No markdown, no commentary. Valid JSON only.`;
}

function fallbackSteps(profile: Record<string, unknown>): OutreachStep[] {
  const firstName = String(profile.name ?? "there").split(" ")[0];
  const title = String(profile.title ?? "engineer");
  const company = String(profile.company ?? "");
  const topRepo = (profile.githubStats as GitHubStats | undefined)?.topRepos?.[0];
  const repoLine = topRepo ? ` I came across your work on ${topRepo.name} —` : "";

  return [
    {
      id: "step-1",
      stepNumber: 1,
      delayDays: 0,
      condition: "immediate",
      subject: `${firstName} — quick note from sodacircle`,
      body: `Hi ${firstName},\n\nI'm reaching out because your background as a ${title}${company ? ` at ${company}` : ""} caught my attention.${repoLine} I think you'd be a great fit for a role I'm working on in the identity/access management space.\n\nWould you be open to a quick 20-minute call to hear more?`,
    },
    {
      id: "step-2",
      stepNumber: 2,
      delayDays: 3,
      condition: "if-no-reply",
      subject: `Re: quick note`,
      body: `Hi ${firstName}, just following up on my note from a few days ago. Happy to share more details if you're curious — no pressure either way.`,
    },
    {
      id: "step-3",
      stepNumber: 3,
      delayDays: 7,
      condition: "if-no-reply",
      subject: `Last note — ${firstName}`,
      body: `Hi ${firstName}, I'll leave it here. If the timing ever changes, feel free to reach out directly. Good luck with everything.`,
    },
  ];
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { profileId?: string; context?: string };

  if (!body.profileId) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  if (!TABLE) {
    return NextResponse.json({ error: "No DynamoDB table configured" }, { status: 500 });
  }

  // Fetch profile
  const res = await db.send(new GetCommand({
    TableName: TABLE,
    Key: { pk: "PROFILE", sk: body.profileId },
  }));

  if (!res.Item) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  const profile = res.Item as Record<string, unknown>;

  // No API key — return template
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ steps: fallbackSteps(profile) });
  }

  try {
    const raw = (await callHaiku(buildPrompt(profile, body.context)))
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    const parsed = JSON.parse(raw) as Array<{
      stepNumber: 1 | 2 | 3;
      delayDays: 0 | 3 | 7;
      condition: "immediate" | "if-no-reply";
      subject: string;
      body: string;
    }>;

    const steps: OutreachStep[] = parsed.map((s, i) => ({
      id: `step-${i + 1}`,
      stepNumber: s.stepNumber,
      delayDays: s.delayDays,
      condition: s.condition,
      subject: s.subject,
      body: s.body,
    }));

    return NextResponse.json({ steps });
  } catch (err) {
    console.error("[outreach/generate] Claude call failed:", err);
    return NextResponse.json({ steps: fallbackSteps(profile) });
  }
}
