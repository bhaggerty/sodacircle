/**
 * GET /api/ats/test
 * Returns a step-by-step diagnostic of the free-ats connection.
 * Hit this in your browser to see exactly where auth is failing.
 */

import { NextResponse } from "next/server";

const BASE = () => (process.env.FREE_ATS_URL ?? "").replace(/\/$/, "");
const EMAIL = () => process.env.FREE_ATS_EMAIL ?? "";
const PASS = () => process.env.FREE_ATS_PASSWORD ?? "";

function pickCookies(res: Response): string {
  try {
    const fn = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (fn) {
      const cookies = fn.call(res.headers);
      if (cookies?.length) return cookies.map((c) => c.split(";")[0]).join("; ");
    }
  } catch { /* ignore */ }
  const raw = res.headers.get("set-cookie") ?? "";
  return raw.split(/,(?=[^ ])/).map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
}

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

export async function GET() {
  const steps: Array<{ step: string; status: "ok" | "fail" | "skip"; detail: string }> = [];

  // Step 1 — env vars
  const base = BASE();
  const email = EMAIL();
  const pass = PASS();

  steps.push({
    step: "Environment variables",
    status: base && email && pass ? "ok" : "fail",
    detail: [
      `FREE_ATS_URL: ${base || "NOT SET"}`,
      `FREE_ATS_EMAIL: ${email || "NOT SET"}`,
      `FREE_ATS_PASSWORD: ${pass ? "set (" + pass.length + " chars)" : "NOT SET"}`,
    ].join(" | "),
  });

  if (!base || !email || !pass) {
    return NextResponse.json({ ok: false, steps });
  }

  // Step 2 — reach the login page
  let initCookie = "";
  let csrf = "";
  try {
    const pageRes = await fetch(`${base}/login`, {
      headers: { Accept: "text/html" },
      redirect: "follow",
    });
    initCookie = pickCookies(pageRes);
    const html = await pageRes.text();
    csrf = extractCsrf(html);

    // Detect if page redirected to Google (SSO intercept)
    const finalUrl = pageRes.url ?? "";
    const redirectedToGoogle = finalUrl.includes("google.com") || finalUrl.includes("accounts.");

    steps.push({
      step: "GET /login",
      status: pageRes.ok && !redirectedToGoogle ? "ok" : "fail",
      detail: [
        `status: ${pageRes.status}`,
        `final URL: ${finalUrl}`,
        `csrf found: ${!!csrf}`,
        `init cookie: ${initCookie ? initCookie.split(";")[0].split("=")[0] : "none"}`,
        redirectedToGoogle ? "⚠ REDIRECTED TO GOOGLE — SSO is intercepting login page" : "",
      ].filter(Boolean).join(" | "),
    });

    if (redirectedToGoogle) {
      steps.push({
        step: "Login POST",
        status: "skip",
        detail: "Skipped — login page redirects to Google SSO, email/password form not reachable",
      });
      return NextResponse.json({ ok: false, steps });
    }
  } catch (err) {
    steps.push({ step: "GET /login", status: "fail", detail: String(err) });
    return NextResponse.json({ ok: false, steps });
  }

  // Step 3 — submit credentials
  let sessionCookie = "";
  try {
    const params: Record<string, string> = { login: email, password: pass };
    if (csrf) params.authenticity_token = csrf;

    const loginRes = await fetch(`${base}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: initCookie,
        Accept: "text/html",
      },
      body: new URLSearchParams(params).toString(),
      redirect: "manual",
    });

    sessionCookie = pickCookies(loginRes);
    const location = loginRes.headers.get("location") ?? "";

    steps.push({
      step: "POST /login",
      status: sessionCookie ? "ok" : "fail",
      detail: [
        `status: ${loginRes.status}`,
        `redirect to: ${location || "none"}`,
        `session cookie: ${sessionCookie ? sessionCookie.split(";")[0].split("=")[0] : "NONE — auth failed"}`,
      ].join(" | "),
    });

    if (!sessionCookie) {
      return NextResponse.json({ ok: false, steps });
    }
  } catch (err) {
    steps.push({ step: "POST /login", status: "fail", detail: String(err) });
    return NextResponse.json({ ok: false, steps });
  }

  // Step 4 — test a candidate push
  try {
    const form = new FormData();
    form.append("url", "https://sodacircle.app/candidates/ats-test");
    form.append("full_name", "ATS Connection Test");
    form.append("headline", "sodacircle integration test — safe to delete");

    const pushRes = await fetch(`${base}/api/v1/candidates`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
      body: form,
    });

    const body = await pushRes.text();
    steps.push({
      step: "POST /api/v1/candidates",
      status: pushRes.ok ? "ok" : "fail",
      detail: `status: ${pushRes.status} | response: ${body.slice(0, 200)}`,
    });
  } catch (err) {
    steps.push({ step: "POST /api/v1/candidates", status: "fail", detail: String(err) });
  }

  const allOk = steps.every((s) => s.status === "ok");
  return NextResponse.json({ ok: allOk, steps });
}
