"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Candidate } from "@/lib/types";

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

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function AgentsPage() {
  const { criteria, setCriteria, brief, setBrief, handleExtractCriteria, candidates, addCandidatesToPool } = useStore();

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
    addLog(`Starting sourcing run — ${sources.join(", ")}…`);
    addLog(`Searching for: ${criteria.roleTitle}`);

    try {
      const res = await fetch("/api/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ criteria, sources }),
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

  const applyBrief = () => {
    setBrief(localBrief);
    handleExtractCriteria();
  };

  const totalInPool = candidates.length;

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Automation layer</span>
        <h1 className="page-title">Agents</h1>
        <p className="page-subtitle">
          Always-on workers that source candidates, handle scheduling, and collect interview feedback.
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
                disabled={sourcingStatus === "running"}
              >
                Update search criteria
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
            <p className="agent-log-title">Active sources</p>
            <div className="agent-sources">
              {[
                { name: "GitHub", active: true },
                { name: "Hacker News", active: true },
                { name: "LinkedIn", active: false },
                { name: "Conferences", active: false },
                { name: "Blogs", active: false },
                { name: "Web search", active: false },
              ].map((s) => (
                <span
                  key={s.name}
                  className={`chip ${s.active ? "chip-accent" : "chip-muted"}`}
                  style={{ fontSize: "0.78rem" }}
                >
                  {s.active ? "● " : "○ "}{s.name}
                </span>
              ))}
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

        {/* ── Scheduling Agent ── */}
        <AgentStub
          icon="◷"
          color="#b95c28"
          name="Scheduling Agent"
          tagline="No more calendar tennis."
          desc="Watches candidate stage transitions and proposes interview times automatically. Sends calendar invites, handles reschedules, and keeps candidates updated — without anyone touching a calendar."
          sources={["Google Calendar", "Outlook", "Slack"]}
        />

        {/* ── Feedback Agent ── */}
        <AgentStub
          icon="◈"
          color="#6b52a8"
          name="Feedback Agent"
          tagline="Scorecards, without the chasing."
          desc="Pings interviewers in Slack 30 minutes after each interview. Collects plain-English responses, extracts structured signals, fills scorecards in free-ats, and escalates if an interviewer ghosts."
          sources={["Slack", "free-ats"]}
        />

      </div>

      {/* Roadmap */}
      <div className="card card-pad" style={{ marginTop: 24 }}>
        <p className="section-label" style={{ marginBottom: 14 }}>On the roadmap</p>
        <div className="chips">
          {[
            "LinkedIn sourcing",
            "Conference speaker scraping",
            "Smart Google search",
            "Debrief Facilitator",
            "Offer Approval Agent",
            "Candidate Comms Agent",
            "Pipeline Health Monitor",
            "Onboarding Handoff",
          ].map((name) => (
            <span key={name} className="chip chip-muted">{name}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function AgentStub({
  icon, color, name, tagline, desc, sources,
}: {
  icon: string;
  color: string;
  name: string;
  tagline: string;
  desc: string;
  sources: string[];
}) {
  return (
    <div className="agent-card" style={{ color } as React.CSSProperties}>
      <div className="agent-card-header">
        <div className="row" style={{ gap: 14 }}>
          <div className="agent-icon-wrap" style={{ background: color + "18", color, fontSize: "1.5rem" }}>
            {icon}
          </div>
          <div>
            <h3 className="agent-title" style={{ color: "var(--ink)" }}>{name}</h3>
            <p className="fine" style={{ color, fontWeight: 600, margin: 0 }}>{tagline}</p>
          </div>
        </div>
        <span className="status-badge coming-soon">Coming soon</span>
      </div>
      <p className="agent-desc">{desc}</p>
      <div className="agent-stats">
        {["Handled", "Saved (hrs)", "Last run"].map((label) => (
          <div key={label} className="agent-stat">
            <span className="agent-stat-value" style={{ color: "var(--muted)" }}>—</span>
            <span className="agent-stat-label">{label}</span>
          </div>
        ))}
      </div>
      <div>
        <p className="agent-log-title">Planned sources</p>
        <div className="agent-sources">
          {sources.map((s) => (
            <span key={s} className="chip chip-muted" style={{ fontSize: "0.78rem" }}>○ {s}</span>
          ))}
        </div>
      </div>
      <div className="agent-card-footer">
        <button className="btn btn-ghost btn-sm" disabled style={{ opacity: 0.45, cursor: "not-allowed" }}>
          Not yet available
        </button>
      </div>
    </div>
  );
}
