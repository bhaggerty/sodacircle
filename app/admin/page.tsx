"use client";

import { useState, useEffect, useCallback } from "react";
import type { AdminStats } from "@/app/api/admin/stats/route";

type ActionResult = {
  ok: boolean;
  label: string;
  data: Record<string, unknown>;
};

const DOMAIN_COLORS: Record<string, string> = {
  identity:           "var(--accent)",
  security:           "#d97706",
  platform:           "#7c3aed",
  cloud:              "#0369a1",
  "distributed-systems": "#b45309",
  go:                 "#00acd7",
  rust:               "#ce4a18",
  data:               "#0d9488",
};

export default function AdminPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<ActionResult[]>([]);
  const [running, setRunning] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) setStats(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  async function runAction(
    label: string,
    url: string,
    body?: Record<string, unknown>
  ) {
    setRunning(label);
    const start = Date.now();
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json() as Record<string, unknown>;
      setResults((prev) => [{ ok: res.ok, label, data }, ...prev]);
      if (res.ok) await fetchStats();
    } catch (err) {
      setResults((prev) => [{ ok: false, label, data: { error: String(err) } }, ...prev]);
    } finally {
      setRunning(null);
      void start; // suppress unused warning
    }
  }

  // ── Domain distribution bar chart ─────────────────────────────────────────

  const domainEntries = stats
    ? Object.entries(stats.domainDistribution).sort(([, a], [, b]) => b - a)
    : [];
  const maxDomainCount = domainEntries[0]?.[1] ?? 1;

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Operations</span>
        <h1 className="page-title">Admin dashboard</h1>
        <p className="page-subtitle">
          Database health, enrichment status, and one-click maintenance operations.
        </p>
      </div>

      {/* ── Stats cards ── */}
      {loading ? (
        <p className="fine" style={{ color: "var(--muted)" }}>Loading stats…</p>
      ) : stats && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14, marginBottom: 24 }}>
            <StatCard label="Total profiles" value={stats.totalProfiles.toLocaleString()} />
            <StatCard
              label="GitHub enriched"
              value={stats.enrichedProfiles.toLocaleString()}
              sub={`${stats.totalProfiles > 0 ? Math.round(stats.enrichedProfiles / stats.totalProfiles * 100) : 0}% of total`}
            />
            <StatCard
              label="Needs backfill"
              value={stats.needsBackfill.toLocaleString()}
              warn={stats.needsBackfill > 0}
              sub="missing domainTags"
            />
            <StatCard
              label="Avg confidence"
              value={`${Math.round(stats.avgConfidence * 100)}%`}
              sub="data completeness score"
            />
          </div>

          {/* Domain distribution */}
          {domainEntries.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 24 }}>
              <p className="section-label" style={{ marginBottom: 14 }}>Domain distribution</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {domainEntries.map(([domain, count]) => (
                  <div key={domain} className="row" style={{ gap: 10, alignItems: "center" }}>
                    <span
                      style={{
                        width: 100,
                        fontSize: "0.78rem",
                        fontWeight: 500,
                        color: DOMAIN_COLORS[domain] ?? "var(--ink)",
                        flexShrink: 0,
                      }}
                    >
                      {domain}
                    </span>
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        background: "var(--line)",
                        borderRadius: 4,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${(count / maxDomainCount) * 100}%`,
                          height: "100%",
                          background: DOMAIN_COLORS[domain] ?? "var(--accent)",
                          borderRadius: 4,
                          transition: "width 0.5s ease",
                        }}
                      />
                    </div>
                    <span className="fine" style={{ color: "var(--muted)", width: 36, textAlign: "right", flexShrink: 0 }}>
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top skills */}
          {stats.topSkills.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 24 }}>
              <p className="section-label" style={{ marginBottom: 10 }}>Top skills in database</p>
              <div className="chips" style={{ gap: 6 }}>
                {stats.topSkills.slice(0, 30).map(({ skill, count }) => (
                  <span
                    key={skill}
                    className="chip"
                    style={{ fontSize: "0.75rem" }}
                    title={`${count} profiles`}
                  >
                    {skill}
                    <span style={{ marginLeft: 4, opacity: 0.5, fontSize: "0.65rem" }}>{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Maintenance operations ── */}
      <div className="card card-pad" style={{ marginBottom: 24 }}>
        <p className="section-label" style={{ marginBottom: 14 }}>Maintenance operations</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          <OpCard
            title="Run backfill"
            description="Re-enrich all profiles missing domainTags. Safe to run at any time — idempotent."
            buttonLabel="Run backfill"
            running={running === "Backfill"}
            disabled={!!running}
            onClick={() => runAction("Backfill", "/api/profiles/backfill")}
          />
          <OpCard
            title="Run dedup"
            description="Identity-stitch the full database. Merges duplicate profiles and removes secondary records."
            buttonLabel="Run dedup"
            running={running === "Dedup"}
            disabled={!!running}
            warn
            onClick={() => runAction("Dedup", "/api/profiles/dedup")}
          />
          <OpCard
            title="Batch GitHub enrich"
            description="Fetch GitHub repos for up to 20 profiles that have a githubUrl but no githubStats yet."
            buttonLabel="Enrich batch"
            running={running === "Batch enrich"}
            disabled={!!running}
            onClick={() => runAction("Batch enrich", "/api/profiles/enrich", { batch: true, limit: 20 })}
          />
          <OpCard
            title="Large batch enrich"
            description="Same as above but processes up to 100 profiles. May take 1–2 minutes."
            buttonLabel="Enrich 100"
            running={running === "Large enrich"}
            disabled={!!running}
            onClick={() => runAction("Large enrich", "/api/profiles/enrich", { batch: true, limit: 100 })}
          />
        </div>
      </div>

      {/* ── Operation results ── */}
      {results.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 24 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>Operation results</p>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: "auto", fontSize: "0.72rem" }}
              onClick={() => setResults([])}
            >
              Clear
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {results.map((r, i) => (
              <div
                key={i}
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: r.ok ? "rgba(29,107,82,0.06)" : "var(--warn-soft)",
                  border: `1px solid ${r.ok ? "rgba(29,107,82,0.15)" : "var(--warn)"}`,
                  fontSize: "0.82rem",
                }}
              >
                <span style={{ fontWeight: 600, color: r.ok ? "var(--accent)" : "var(--warn)" }}>
                  {r.ok ? "✓" : "✕"} {r.label}
                </span>
                <span style={{ marginLeft: 10, color: "var(--ink-soft)" }}>
                  {Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join("  ·  ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent searches ── */}
      {stats && stats.recentSearches.length > 0 && (
        <div className="card card-pad">
          <p className="section-label" style={{ marginBottom: 14 }}>Recent searches</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {stats.recentSearches.map((s, i) => (
              <div
                key={i}
                className="row"
                style={{
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: i < stats.recentSearches.length - 1 ? "1px solid var(--line)" : "none",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 500, fontSize: "0.82rem", flex: 1, minWidth: 200 }}>{s.query}</span>
                {s.parsedIntent && s.parsedIntent !== s.query && (
                  <span className="fine" style={{ color: "var(--accent)", fontSize: "0.75rem" }}>
                    → {s.parsedIntent}
                  </span>
                )}
                <span className="fine" style={{ color: "var(--muted)", fontSize: "0.72rem" }}>
                  {s.returnedCount} results · {s.durationMs}ms
                </span>
                <span className="fine" style={{ color: "var(--muted)", fontSize: "0.68rem" }}>
                  {new Date(s.loggedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  warn,
}: {
  label: string;
  value: string;
  sub?: string;
  warn?: boolean;
}) {
  return (
    <div
      className="card card-pad"
      style={{ border: warn ? "1px solid var(--warn)" : undefined }}
    >
      <p className="section-label" style={{ marginBottom: 4 }}>{label}</p>
      <div
        style={{
          fontSize: "1.8rem",
          fontWeight: 700,
          fontFamily: "var(--font-heading)",
          color: warn ? "var(--warn)" : "var(--ink)",
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <p className="fine" style={{ color: "var(--muted)", marginTop: 4 }}>{sub}</p>
      )}
    </div>
  );
}

function OpCard({
  title,
  description,
  buttonLabel,
  running,
  disabled,
  warn,
  onClick,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  running: boolean;
  disabled: boolean;
  warn?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className="card card-pad"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        border: warn ? "1px solid rgba(185,92,40,0.25)" : undefined,
      }}
    >
      <div>
        <p style={{ fontWeight: 600, fontSize: "0.88rem", margin: "0 0 4px" }}>{title}</p>
        <p className="fine" style={{ color: "var(--ink-soft)", margin: 0 }}>{description}</p>
      </div>
      <button
        className={`btn btn-sm ${warn ? "btn-danger" : "btn-secondary"}`}
        style={{ alignSelf: "flex-start" }}
        onClick={onClick}
        disabled={disabled}
      >
        {running ? "Running…" : buttonLabel}
      </button>
    </div>
  );
}
