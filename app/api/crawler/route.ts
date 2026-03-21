/**
 * GET  /api/crawler        — status
 * POST /api/crawler        — start / stop / add-urls
 *   body: { action: "start" | "stop" | "add-urls", urls?: string[] }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  startCrawler,
  stopCrawler,
  isCrawlerRunning,
  getCrawlerStatus,
  addSeedUrls,
} from "@/lib/crawler/index";
import { readState, countProfiles } from "@/lib/crawler/store";

export async function GET() {
  const state  = readState();
  const status = getCrawlerStatus();
  return NextResponse.json({
    ...state,
    queueDepth: status.queueDepth,
    totalIndexed: countProfiles(),
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
