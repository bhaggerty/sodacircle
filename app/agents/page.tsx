"use client";

import { useState, useEffect, useCallback } from "react";
import { useStore } from "@/lib/store";
import { Candidate, RankedCandidate } from "@/lib/types";

type AgentStatus = "idle" | "running" | "paused" | "coming-soon";

type SourcingResult = {
  candidates: Candidate[];
  counts: Record<string, number>;
  keywords: string[];
  errors: string[];
  total: number;
};

type AtsTestStep = { step: string; status: "ok" | "fail" | "skip"; detail: string };
type AtsTestResult = { ok: boolean; steps: AtsTestStep[] };

type LogEntry = { text: string; time: string; type: "info" | "success" | "error" };

type CrawlerStatus = {
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  pagesVisited: number;
  profilesFound: number;
  errors: number;
  queueDepth: number;
  totalIndexed: number;
  recentFinds: Array<{ name: string; title: string; company: string; time: string }>;
  lastActivity: string | null;
};

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AgentsPage() {
  const { criteria, setCriteria, brief, setBrief, handleExtractCriteria, candidates, addCandidatesToPool, shortlist } = useStore();

  const [sourcingStatus, setSourcingStatus] = useState<AgentStatus>("idle");
  const [log, setLog] = useState<LogEntry[]>([
    { text: "Agent ready. Click Run to start sourcing.", time: now(), type: "info" },
  ]);
  const [lastResult, setLastResult] = useState<SourcingResult | null>(null);
  const [atsTest, setAtsTest] = useState<AtsTestResult | null>(null);
  const [atsTestRunning, setAtsTestRunning] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [localBrief, setLocalBrief] = useState(brief);
  const [extracting, setExtracting] = useState(false);
  const [lastExtractedBrief, setLastExtractedBrief] = useState(brief);
  const [webUrls, setWebUrls] = useState("");
  const [webCrawling, setWebCrawling] = useState(false);

  // ── Background crawler ──────────────────────────────────────────
  const [crawlerStatus, setCrawlerStatus] = useState<CrawlerStatus | null>(null);
  const [crawlerSeeds, setCrawlerSeeds] = useState("");
  const [crawlerLoading, setCrawlerLoading] = useState(false);

  const refreshCrawler = useCallback(async () => {
    try {
      const res = await fetch("/api/crawler");
      if (res.ok) setCrawlerStatus(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    refreshCrawler();
    const t = setInterval(refreshCrawler, 5000);
    return () => clearInterval(t);
  }, [refreshCrawler]);

  const controlCrawler = async (action: "start" | "stop" | "add-urls") => {
    setCrawlerLoading(true);
    try {
      await fetch("/api/crawler", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "add-urls"
          ? { action, urls: crawlerSeeds.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean) }
          : { action }),
      });
      await refreshCrawler();
      if (action === "add-urls") setCrawlerSeeds("");
    } finally {
      setCrawlerLoading(false);
    }
  };

  const runAtsTest = async () => {
    setAtsTestRunning(true);
    setAtsTest(null);
    try {
      const res = await fetch("/api/ats/test");
      const data = await res.json() as AtsTestResult;
      setAtsTest(data);
    } catch (err) {
      setAtsTest({ ok: false, steps: [{ step: "Fetch", status: "fail", detail: String(err) }] });
    } finally {
      setAtsTestRunning(false);
    }
  };

  const addLog = (text: string, type: LogEntry["type"] = "info") =>
    setLog((l) => [{ text, time: now(), type }, ...l].slice(0, 100));

  const runSourcing = async (sources: ("github" | "hn")[]) => {
    setSourcingStatus("running");

    // Auto-extract criteria from brief if it changed since last extraction
    let activeCriteria = criteria;
    if (localBrief.trim() && localBrief !== lastExtractedBrief) {
      addLog("Brief changed — extracting search criteria…");
      setBrief(localBrief);
      try {
        const res = await fetch("/api/criteria", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brief: localBrief, seed: criteria }),
        });
        if (res.ok) {
          activeCriteria = await res.json();
          setCriteria(activeCriteria);
          setLastExtractedBrief(localBrief);
          addLog(`Search updated: ${activeCriteria.roleTitle}${activeCriteria.geoPreference ? ` · ${activeCriteria.geoPreference}` : ""}`, "success");
        }
      } catch { /* use existing criteria */ }
    }

    addLog(`Starting sourcing run — ${sources.join(", ")}…`);
    addLog(`Searching for: ${activeCriteria.roleTitle || localBrief.slice(0, 60)}${activeCriteria.geoPreference ? ` · ${activeCriteria.geoPreference}` : ""}`);

    try {
      const res = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria: activeCriteria, sources, brief: localBrief }),
      });

      const data = await res.json() as SourcingResult;

      if (data.keywords?.length) {
        addLog(`Keywords used: ${data.keywords.slice(0, 5).join(", ")}`);
      }

      if (data.errors?.length) {
        data.errors.forEach((e) => addLog(e, "error"));
      }

      if (data.counts) {
        Object.entries(data.counts).forEach(([src, n]) =>
          addLog(`${src}: ${n} profiles found`, n > 0 ? "success" : "info")
        );
      }

      if (data.candidates?.length) {
        addCandidatesToPool(data.candidates);
        const newCount = data.candidates.filter(
          (c) => !candidates.find((e) => e.id === c.id)
        ).length;
        addLog(`${newCount} new candidates added to pool · ${data.total - newCount} duplicates skipped`, "success");
        setLastResult(data);
        setShowLog(true);
      } else {
        addLog("No matching candidates found. Try adjusting your search criteria.", "info");
        setShowLog(true);
      }
    } catch (err) {
      addLog(`Run failed: ${String(err)}`, "error");
      setShowLog(true);
    } finally {
      setSourcingStatus("idle");
    }
  };

  const applyBrief = async () => {
    setBrief(localBrief);
    setExtracting(true);
    try {
      // Use Claude to extract structured criteria from the brief
      const res = await fetch("/api/criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: localBrief, seed: criteria }),
      });
      if (res.ok) {
        const next = await res.json();
        setCriteria(next);
        addLog(`Search updated: ${next.roleTitle}${next.geoPreference ? ` · ${next.geoPreference}` : ""}`, "success");
      } else {
        await handleExtractCriteria();
        addLog(`Search criteria updated`, "info");
      }
    } catch {
      await handleExtractCriteria();
      addLog(`Search criteria updated`, "info");
    } finally {
      setExtracting(false);
    }
  };

  const totalInPool = candidates.length;

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Automation layer</span>
        <h1 className="page-title">Agents</h1>
        <p className="page-subtitle">
          Always-on workers that source and index candidates from across the internet.
        </p>
      </div>

      <div className="agents-grid">

        {/* ── Sourcing Agent ── */}
        <div className="agent-card" style={{ color: "#1d6b52" } as React.CSSProperties}>
          <div className="agent-card-header">
            <div className="row" style={{ gap: 14 }}>
              <div className="agent-icon-wrap" style={{ background: "#1d6b5218", color: "#1d6b52", fontSize: "1.5rem" }}>
                ◎
              </div>
              <div>
                <h3 className="agent-title" style={{ color: "var(--ink)" }}>Sourcing Agent</h3>
                <p className="fine" style={{ color: "#1d6b52", fontWeight: 600, margin: 0 }}>
                  Always scanning. Always finding.
                </p>
              </div>
            </div>
            <span className={`status-badge ${sourcingStatus === "running" ? "running" : "paused"}`}>
              {sourcingStatus === "running" ? "Running" : "Idle"}
            </span>
          </div>

          {/* ── What are you looking for? ── */}
          <div className="agent-brief-box">
            <p className="agent-log-title" style={{ marginBottom: 8 }}>What are you looking for?</p>
            <textarea
              className="agent-brief-input"
              value={localBrief}
              onChange={(e) => setLocalBrief(e.target.value)}
              placeholder="Describe the role and ideal candidate — e.g. 'Senior AE with enterprise SaaS experience, quota-carrying, based in NYC or remote…'"
              rows={3}
            />
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={applyBrief}
                disabled={sourcingStatus === "running" || extracting}
              >
                {extracting ? "Parsing…" : "Update search criteria"}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowCriteria((v) => !v)}
              >
                {showCriteria ? "Hide criteria ▲" : "Edit criteria ▼"}
              </button>
            </div>
          </div>

          {/* ── Inline criteria editor ── */}
          {showCriteria && (
            <div className="agent-criteria-panel">
              <p className="agent-log-title" style={{ marginBottom: 10 }}>Search criteria</p>
              <div className="criteria-grid">
                <div className="criteria-field">
                  <label className="criteria-label">Role title</label>
                  <input
                    className="criteria-input"
                    value={criteria.roleTitle}
                    onChange={(e) => setCriteria({ ...criteria, roleTitle: e.target.value })}
                    placeholder="e.g. Senior Account Executive"
                  />
                </div>
                <div className="criteria-field">
                  <label className="criteria-label">Location</label>
                  <input
                    className="criteria-input"
                    value={criteria.geoPreference}
                    onChange={(e) => setCriteria({ ...criteria, geoPreference: e.target.value })}
                    placeholder="e.g. New York, NY or Remote (US)"
                  />
                </div>
                <div className="criteria-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="criteria-label">Must-haves (comma-separated)</label>
                  <input
                    className="criteria-input"
                    value={criteria.mustHaves.join(", ")}
                    onChange={(e) => setCriteria({ ...criteria, mustHaves: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    placeholder="e.g. quota-carrying, B2B SaaS, enterprise sales"
                  />
                </div>
                <div className="criteria-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="criteria-label">Keywords / industries (comma-separated)</label>
                  <input
                    className="criteria-input"
                    value={criteria.searchRecipe?.industry?.join(", ") ?? ""}
                    onChange={(e) => setCriteria({ ...criteria, searchRecipe: { ...criteria.searchRecipe, industry: e.target.value.split(",").map(s => s.trim()).filter(Boolean) } })}
                    placeholder="e.g. SaaS, fintech, enterprise software"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="agent-stats">
            <div className="agent-stat">
              <span className="agent-stat-value" style={{ color: totalInPool > 0 ? "#1d6b52" : "var(--muted)" }}>
                {totalInPool}
              </span>
              <span className="agent-stat-label">In pool</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value" style={{ color: lastResult?.total ? "#1d6b52" : "var(--muted)" }}>
                {lastResult?.total ?? "—"}
              </span>
              <span className="agent-stat-label">Last run</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value" style={{ color: "var(--muted)" }}>
                {lastResult ? "just now" : "—"}
              </span>
              <span className="agent-stat-label">Last sourced</span>
            </div>
          </div>

          {/* Active search context */}
          <div className="agent-log">
            <p className="agent-log-title">Current search</p>
            <div className="chips" style={{ gap: 7 }}>
              <span className="chip chip-accent" style={{ fontSize: "0.78rem" }}>{criteria.roleTitle}</span>
              {criteria.searchRecipe?.industry?.map((i) => (
                <span key={i} className="chip" style={{ fontSize: "0.78rem" }}>{i}</span>
              ))}
              {criteria.mustHaves.slice(0, 2).map((m) => (
                <span key={m} className="chip chip-muted" style={{ fontSize: "0.78rem" }}>{m}</span>
              ))}
            </div>
          </div>

          {/* Sources */}
          <div>
            <p className="agent-log-title">Built-in sources</p>
            <div className="agent-sources">
              {[
                { name: "GitHub", active: true },
                { name: "Hacker News", active: true },
                { name: "LinkedIn", active: false },
                { name: "Conferences", active: false },
              ].map((s) => (
                <span key={s.name} className={`chip ${s.active ? "chip-accent" : "chip-muted"}`} style={{ fontSize: "0.78rem" }}>
                  {s.active ? "● " : "○ "}{s.name}
                </span>
              ))}
            </div>
          </div>

          {/* Web crawl */}
          <div className="agent-brief-box" style={{ background: "var(--surface-strong)", borderColor: "var(--line)" }}>
            <p className="agent-log-title" style={{ marginBottom: 6 }}>Crawl company pages</p>
            <p className="fine" style={{ marginBottom: 10 }}>
              Paste URLs to company team pages, conference speaker pages, or GitHub orgs — one per line.
              The crawler respects robots.txt and only reads public pages.
            </p>
            <textarea
              className="agent-brief-input"
              value={webUrls}
              onChange={(e) => setWebUrls(e.target.value)}
              placeholder={"https://company.com/team\nhttps://conf.example.com/speakers\nhttps://github.com/orgs/okta"}
              rows={3}
              style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
            />
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={webCrawling || !webUrls.trim()}
                onClick={async () => {
                  const urls = webUrls.split(/[\n,]+/).map((u) => u.trim()).filter(Boolean);
                  if (!urls.length) return;
                  setWebCrawling(true);
                  addLog(`Starting web crawl — ${urls.length} seed URL${urls.length > 1 ? "s" : ""}…`);
                  try {
                    const res = await fetch("/api/source/web", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ urls, geoPreference: criteria.geoPreference }),
                    });
                    const data = await res.json() as { candidates: import("@/lib/types").Candidate[]; errors: string[]; pagesVisited: number; total: number; sourceSummary: Record<string, number> };
                    if (data.errors?.length) data.errors.forEach((e) => addLog(e, "error"));
                    addLog(`Visited ${data.pagesVisited} pages`, "info");
                    if (data.candidates?.length) {
                      addCandidatesToPool(data.candidates);
                      addLog(`${data.total} people extracted from web crawl`, "success");
                    } else {
                      addLog("No profiles extracted. Try direct team page URLs like company.com/team", "info");
                    }
                  } catch (err) {
                    addLog(`Web crawl failed: ${String(err)}`, "error");
                  } finally {
                    setWebCrawling(false);
                    setShowLog(true);
                  }
                }}
              >
                {webCrawling ? "⟳ Crawling…" : "▶ Crawl URLs"}
              </button>
              {webCrawling && <span className="fine">This can take 15–30 seconds per domain…</span>}
            </div>
          </div>

          {/* Live log */}
          <div className="agent-log">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <p className="agent-log-title" style={{ margin: 0 }}>Activity log</p>
              {log.length > 5 && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ fontSize: "0.72rem", padding: "2px 8px" }}
                  onClick={() => setShowLog((v) => !v)}
                >
                  {showLog ? "Show less ▲" : `Show all (${log.length}) ▼`}
                </button>
              )}
            </div>
            {(showLog ? log : log.slice(0, 5)).map((entry, i) => (
              <div
                key={i}
                className="agent-log-item"
                style={{
                  color: entry.type === "success"
                    ? "#1d6b52"
                    : entry.type === "error"
                    ? "#c2410c"
                    : "var(--ink-soft)",
                }}
              >
                {entry.text}
                <span className="agent-log-time">{entry.time}</span>
              </div>
            ))}
          </div>

          <div className="agent-card-footer">
            <button
              className="btn btn-primary"
              style={{ background: "linear-gradient(135deg, #1d6b52, #174c3c)", minWidth: 120 }}
              onClick={() => runSourcing(["github", "hn"])}
              disabled={sourcingStatus === "running"}
            >
              {sourcingStatus === "running" ? "⟳ Running…" : "▶ Run now"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => runSourcing(["github"])}
              disabled={sourcingStatus === "running"}
            >
              GitHub only
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => runSourcing(["hn"])}
              disabled={sourcingStatus === "running"}
            >
              HN only
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={runAtsTest}
              disabled={atsTestRunning}
              style={{ marginLeft: "auto" }}
            >
              {atsTestRunning ? "Testing…" : "Test ATS"}
            </button>
          </div>

          {/* ATS test results */}
          {atsTest && (
            <div className="agent-log" style={{ marginTop: 0 }}>
              <p className="agent-log-title">
                ATS connection test —{" "}
                <span style={{ color: atsTest.ok ? "#1d6b52" : "#c2410c", fontWeight: 700 }}>
                  {atsTest.ok ? "All good" : "Failed"}
                </span>
              </p>
              {atsTest.steps.map((s, i) => (
                <div key={i} className="agent-log-item" style={{
                  color: s.status === "ok" ? "#1d6b52" : s.status === "fail" ? "#c2410c" : "var(--muted)",
                }}>
                  <strong>{s.status === "ok" ? "✓" : s.status === "fail" ? "✕" : "—"} {s.step}</strong>
                  <br />
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{s.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Background Crawler ── */}
        <div className="agent-card" style={{ color: "#2563eb" } as React.CSSProperties}>
          <div className="agent-card-header">
            <div className="row" style={{ gap: 14 }}>
              <div className="agent-icon-wrap" style={{ background: "#2563eb18", color: "#2563eb", fontSize: "1.5rem" }}>
                ⟳
              </div>
              <div>
                <h3 className="agent-title" style={{ color: "var(--ink)" }}>Background Crawler</h3>
                <p className="fine" style={{ color: "#2563eb", fontWeight: 600, margin: 0 }}>
                  Always indexing. Finds before you search.
                </p>
              </div>
            </div>
            <span className={`status-badge ${crawlerStatus?.running ? "running" : "paused"}`}>
              {crawlerStatus?.running ? "Running" : "Stopped"}
            </span>
          </div>

          <p className="agent-desc">
            Continuously crawls GitHub and identity/security company team pages, indexing engineer profiles into a
            local database. Tuned for Go, IAM, and platform engineering talent. Respects robots.txt and rate-limits
            all domains.
          </p>

          {/* Stats row */}
          <div className="agent-stats">
            <div className="agent-stat">
              <span className="agent-stat-value" style={{ color: crawlerStatus?.totalIndexed ? "#2563eb" : "var(--muted)" }}>
                {crawlerStatus?.totalIndexed?.toLocaleString() ?? "—"}
              </span>
              <span className="agent-stat-label">Indexed</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value" style={{ color: "var(--ink-soft)" }}>
                {crawlerStatus?.pagesVisited?.toLocaleString() ?? "—"}
              </span>
              <span className="agent-stat-label">Pages visited</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value" style={{ color: "var(--muted)" }}>
                {crawlerStatus?.queueDepth?.toLocaleString() ?? "—"}
              </span>
              <span className="agent-stat-label">Queue depth</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value" style={{ color: crawlerStatus?.errors ? "#c2410c" : "var(--muted)" }}>
                {crawlerStatus?.errors ?? "—"}
              </span>
              <span className="agent-stat-label">Errors</span>
            </div>
          </div>

          {/* Recent finds */}
          {crawlerStatus?.recentFinds && crawlerStatus.recentFinds.length > 0 && (
            <div className="agent-log">
              <p className="agent-log-title">Recent finds</p>
              {crawlerStatus.recentFinds.slice(0, 6).map((f, i) => (
                <div key={i} className="agent-log-item" style={{ color: "var(--ink-soft)" }}>
                  <strong style={{ color: "var(--ink)" }}>{f.name}</strong>
                  {f.title && <span> · {f.title}</span>}
                  {f.company && <span style={{ color: "var(--muted)" }}> @ {f.company}</span>}
                  <span className="agent-log-time">
                    {new Date(f.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Add seed URLs */}
          <div className="agent-brief-box" style={{ background: "var(--surface-strong)", borderColor: "var(--line)" }}>
            <p className="agent-log-title" style={{ marginBottom: 6 }}>Add seed URLs</p>
            <textarea
              className="agent-brief-input"
              value={crawlerSeeds}
              onChange={(e) => setCrawlerSeeds(e.target.value)}
              placeholder={"https://company.com/team\nhttps://github.com/orgs/your-org\nhttps://conf.example.com/speakers"}
              rows={2}
              style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
            />
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: 8 }}
              disabled={crawlerLoading || !crawlerSeeds.trim()}
              onClick={() => controlCrawler("add-urls")}
            >
              Add to queue
            </button>
          </div>

          {crawlerStatus?.lastActivity && (
            <p className="fine" style={{ color: "var(--muted)" }}>
              Last activity: {new Date(crawlerStatus.lastActivity).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          )}

          <div className="agent-card-footer">
            {crawlerStatus?.running ? (
              <button
                className="btn btn-secondary"
                style={{ minWidth: 110 }}
                onClick={() => controlCrawler("stop")}
                disabled={crawlerLoading}
              >
                ■ Stop crawler
              </button>
            ) : (
              <button
                className="btn btn-primary"
                style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", minWidth: 120 }}
                onClick={() => controlCrawler("start")}
                disabled={crawlerLoading}
              >
                ▶ Start crawler
              </button>
            )}
            <a href="/profiles" className="btn btn-ghost btn-sm">
              Browse indexed profiles →
            </a>
          </div>
        </div>


      </div>

      {/* Talent Insights */}
      {shortlist.length > 0 && (
        <TalentInsights shortlist={shortlist} lastResult={lastResult} />
      )}

    </div>
  );
}

function TalentInsights({ shortlist, lastResult }: { shortlist: RankedCandidate[]; lastResult: SourcingResult | null }) {
  const total = shortlist.length;

  // Match quality distribution
  const goodMatches = shortlist.filter((c) => c.matchTier === "good-match").length;
  const potentialFits = shortlist.filter((c) => c.matchTier === "potential-fit").length;
  const noMatches = shortlist.filter((c) => c.matchTier === "no-match").length;

  // Source distribution
  const githubCount = shortlist.filter((c) => c.sourceName === "github").length;
  const hnCount = shortlist.filter((c) => c.sourceName === "hn").length;

  // Code quality
  const codePasses = shortlist.filter((c) => c.codeQuality?.badge === "code-pass").length;
  const poorCode = shortlist.filter((c) => c.codeQuality?.badge === "poor-code").length;

  // Top signals
  const sigFreq: Record<string, number> = {};
  for (const c of shortlist) {
    for (const s of c.matchedSignals) {
      if (!s.startsWith("Code Pass") && !s.startsWith("From a target")) {
        sigFreq[s] = (sigFreq[s] ?? 0) + 1;
      }
    }
  }
  const topSignals = Object.entries(sigFreq)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  return (
    <div className="insights-panel" style={{ marginTop: 24 }}>
      <h3>Talent Insights — {total} profiles scored</h3>
      <div className="insights-grid">
        <div className="insights-stat">
          <div className="insights-stat-label">Good matches</div>
          <div className="insights-stat-value" style={{ color: "#1d6b52" }}>{goodMatches}</div>
          <div className="insights-bar-row">
            <div className="insights-bar-fill" style={{ width: `${total ? (goodMatches / total) * 100 : 0}%`, minWidth: goodMatches ? 4 : 0 }} />
            <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>{total ? Math.round((goodMatches / total) * 100) : 0}%</span>
          </div>
        </div>
        <div className="insights-stat">
          <div className="insights-stat-label">Potential fits</div>
          <div className="insights-stat-value" style={{ color: "#b95c28" }}>{potentialFits}</div>
          <div className="insights-bar-row">
            <div className="insights-bar-fill" style={{ width: `${total ? (potentialFits / total) * 100 : 0}%`, background: "var(--warn)", minWidth: potentialFits ? 4 : 0 }} />
            <span style={{ color: "var(--muted)", fontSize: "0.72rem" }}>{total ? Math.round((potentialFits / total) * 100) : 0}%</span>
          </div>
        </div>
        <div className="insights-stat">
          <div className="insights-stat-label">Not a match</div>
          <div className="insights-stat-value" style={{ color: "var(--muted)" }}>{noMatches}</div>
        </div>
        {githubCount + hnCount > 0 && (
          <div className="insights-stat">
            <div className="insights-stat-label">Sources</div>
            <div style={{ fontSize: "0.82rem", marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
              {githubCount > 0 && <span>GitHub: {githubCount}</span>}
              {hnCount > 0 && <span>HN: {hnCount}</span>}
            </div>
          </div>
        )}
        {(codePasses + poorCode) > 0 && (
          <div className="insights-stat">
            <div className="insights-stat-label">Code quality</div>
            <div style={{ fontSize: "0.82rem", marginTop: 4, display: "flex", flexDirection: "column", gap: 3 }}>
              {codePasses > 0 && <span style={{ color: "#1d6b52" }}>✓ Code Pass: {codePasses}</span>}
              {poorCode > 0 && <span style={{ color: "#b95c28" }}>⚠ Poor quality: {poorCode}</span>}
            </div>
          </div>
        )}
        {lastResult?.keywords && lastResult.keywords.length > 0 && (
          <div className="insights-stat" style={{ gridColumn: "span 2" }}>
            <div className="insights-stat-label">Keywords used</div>
            <div className="chips" style={{ marginTop: 6, gap: 5 }}>
              {lastResult.keywords.slice(0, 6).map((k) => (
                <span key={k} className="chip" style={{ fontSize: "0.74rem" }}>{k}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {topSignals.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p className="section-label" style={{ marginBottom: 8 }}>Top matching signals</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {topSignals.map(([sig, count]) => (
              <div key={sig} className="insights-bar-row">
                <span style={{ flex: 1, fontSize: "0.82rem", color: "var(--ink)" }}>{sig}</span>
                <div className="insights-bar-fill" style={{ width: `${Math.round((count / total) * 100)}%`, maxWidth: 120 }} />
                <span style={{ fontSize: "0.72rem", color: "var(--muted)", minWidth: 24 }}>{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

