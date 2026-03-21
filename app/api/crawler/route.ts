/**
 * GET  /api/crawler        — status
 * POST /api/crawler        — { action: "start" | "stop" | "add-urls", urls?: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  startCrawler,
  stopCrawler,
  getCrawlerStatus,
  addSeedUrls,
} from "@/lib/crawler/index";
import { readState, countProfiles } from "@/lib/crawler/store";

export async function GET() {
  const [state, total] = await Promise.all([readState(), countProfiles()]);
  const status = getCrawlerStatus();
  return NextResponse.json({
    ...state,
    queueDepth: status.queueDepth,
    totalIndexed: total,
    recentFinds: status.recentFinds,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    action?: string;
    urls?: string[];
  };

  switch (body.action) {
    case "start":
      startCrawler();
      return NextResponse.json({ ok: true, running: true });

    case "stop":
      stopCrawler();
      return NextResponse.json({ ok: true, running: false });

    case "add-urls":
      if (Array.isArray(body.urls)) addSeedUrls(body.urls);
      return NextResponse.json({ ok: true, added: body.urls?.length ?? 0 });

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
