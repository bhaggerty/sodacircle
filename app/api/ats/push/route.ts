import { NextRequest, NextResponse } from "next/server";

// ── Module-level session cache (one per process) ──────────────────
let _session: string | null = null;
let _sessionExpiry = 0;

const BASE = () => (process.env.FREE_ATS_URL ?? "").replace(/\/$/, "");
const EMAIL = () => process.env.FREE_ATS_EMAIL ?? "";
const PASS = () => process.env.FREE_ATS_PASSWORD ?? "";

// ── Cookie helpers ────────────────────────────────────────────────
function pickCookies(res: Response): string {
  // Node 18+ exposes getSetCookie(); fall back to header parsing
  try {
    const fn = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (fn) {
      const cookies = fn.call(res.headers);
      if (cookies?.length) return cookies.map((c) => c.split(";")[0]).join("; ");
    }
  } catch { /* ignore */ }

  const raw = res.headers.get("set-cookie") ?? "";
  return raw
    .split(/,(?=[^ ])/)
    .map((c) => c.split(";")[0].trim())
    .filter(Boolean)
    .join("; ");
}

// ── CSRF extraction ───────────────────────────────────────────────
function extractCsrf(html: string): string {
  const patterns = [
    /name="csrf-token"\s+content="([^"]+)"/,
    /content="([^"]+)"\s+name="csrf-token"/,
    /name="authenticity_token"[^>]+value="([^"]+)"/,
    /value="([^"]+)"[^>]+name="authenticity_token"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return "";
}

// ── Authentication ────────────────────────────────────────────────
async function authenticate(): Promise<string> {
  const base = BASE();

  // Step 1 — load login page to get initial session cookie + CSRF token
  const pageRes = await fetch(`${base}/login`, {
    headers: { Accept: "text/html" },
  });
  const html = await pageRes.text();
  const initCookie = pickCookies(pageRes);
  const csrf = extractCsrf(html);

  // Step 2 — submit credentials
  const params: Record<string, string> = {
    login: EMAIL(),
    password: PASS(),
  };
  if (csrf) params.authenticity_token = csrf;

  const loginRes = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: initCookie,
      Accept: "text/html",
    },
    body: new URLSearchParams(params).toString(),
    redirect: "manual", // capture the redirect, not follow it
  });

  // The authenticated session cookie is on the redirect response
  const cookie = pickCookies(loginRes);
  if (!cookie) {
    throw new Error(
      `ATS authentication failed (status ${loginRes.status}) — check FREE_ATS_EMAIL and FREE_ATS_PASSWORD`
    );
  }

  _session = cookie;
  _sessionExpiry = Date.now() + 18 * 60 * 1000; // 18-minute TTL
  return cookie;
}

// ── Candidate push ────────────────────────────────────────────────
async function callPush(body: FormData, cookie: string): Promise<Response> {
  return fetch(`${BASE()}/api/v1/candidates`, {
    method: "POST",
    headers: { Cookie: cookie },
    body,
  });
}

// ── Route handler ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const base = BASE();

  if (!base || !EMAIL() || !PASS()) {
    return NextResponse.json(
      {
        error:
          "FREE_ATS_URL, FREE_ATS_EMAIL, and FREE_ATS_PASSWORD must be set. " +
          "Add them to .env.local to enable ATS sync.",
      },
      { status: 503 }
    );
  }

  const candidate = await req.json() as {
    id: string;
    name: string;
    title?: string;
    company?: string;
    location?: string;
    linkedinUrl?: string;
  };

  const buildForm = () => {
    const form = new FormData();
    // url is required by free-ats; fall back to a sodacircle-namespaced identifier
    form.append(
      "url",
      candidate.linkedinUrl?.trim() ||
        `https://sodacircle.app/candidates/${candidate.id}`
    );
    form.append("full_name", candidate.name);
    if (candidate.location) form.append("location", candidate.location);
    const headline = [candidate.title, candidate.company].filter(Boolean).join(" at ");
    if (headline) form.append("headline", headline);
    return form;
  };

  try {
    // Ensure we have a live session
    if (!_session || Date.now() > _sessionExpiry) {
      _session = await authenticate();
    }

    let res = await callPush(buildForm(), _session);

    // Session may have expired server-side — re-auth once and retry
    if (res.status === 401 || res.status === 302 || res.status === 303) {
      _session = await authenticate();
      res = await callPush(buildForm(), _session);
    }

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const data = await res.json() as { url: string };
    return NextResponse.json({ atsUrl: data.url });
  } catch (err) {
    _session = null; // force re-auth next time
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
