"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { Avatar, MatchBadge, ScoreRing } from "@/components/score-ring";

export default function DashboardPage() {
  const { shortlist, approvedCount, replies, statuses, criteria } = useStore();

  const goodMatches   = shortlist.filter((c) => c.matchTier === "good-match").length;
  const potentialFits = shortlist.filter((c) => c.matchTier === "potential-fit").length;
  const unreviewed    = shortlist.filter((c) => !statuses[c.id] || statuses[c.id] === "new").length;
  const repliesCount  = replies.length;

  // What should the user do next?
  const nextAction =
    shortlist.length === 0
      ? { href: "/agents",     cta: "Run your first sourcing agent →", sub: "Start with GitHub + HN — takes about 30 seconds." }
      : approvedCount === 0
      ? { href: "/candidates", cta: "Review and approve candidates →",  sub: `${goodMatches} good matches and ${potentialFits} potential fits waiting.` }
      : { href: "/outreach",   cta: "Review outreach drafts →",         sub: `${approvedCount} approved candidate${approvedCount !== 1 ? "s" : ""} ready for outreach.` };

  const metrics = [
    { value: shortlist.length,  label: "In pool",          sub: `${goodMatches} good matches` },
    { value: approvedCount,     label: "Approved",         sub: "for outreach" },
    { value: unreviewed,        label: "Awaiting review",  sub: "need a decision" },
    { value: repliesCount,      label: "Replies",          sub: "inbound messages" },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Dashboard</span>
        <h1 className="page-title">
          {criteria.roleTitle ? `Pipeline — ${criteria.roleTitle}` : "Pipeline at a glance"}
        </h1>
        <p className="page-subtitle">
          {criteria.geoPreference ? `${criteria.geoPreference} · ` : ""}
          {shortlist.length > 0
            ? `${shortlist.length} profiles sourced, ${approvedCount} approved.`
            : "No candidates sourced yet. Run an agent to get started."}
        </p>
      </div>

      {/* Next action callout */}
      <Link href={nextAction.href} className="dash-next-action">
        <div>
          <div className="dash-next-cta">{nextAction.cta}</div>
          <div className="dash-next-sub">{nextAction.sub}</div>
        </div>
        <span style={{ fontSize: "1.4rem", opacity: 0.5 }}>›</span>
      </Link>

      {/* Metrics */}
      <div className="dash-metrics">
        {metrics.map((m) => (
          <div key={m.label} className="dash-metric-card">
            <span className="dash-metric-value">{m.value}</span>
            <span className="dash-metric-label">{m.label}</span>
            <span className="dash-metric-delta neutral">{m.sub}</span>
          </div>
        ))}
      </div>

      <div className="dash-row">
        {/* Top candidates */}
        <div className="card card-pad">
          <div className="section-header">
            <div>
              <p className="section-label">Top matches</p>
              <h2 className="section-title">Best candidates</h2>
            </div>
            <Link href="/candidates" className="btn btn-ghost btn-sm">View all</Link>
          </div>

          {shortlist.length === 0 ? (
            <div style={{ padding: "32px 0", textAlign: "center" }}>
              <p className="muted" style={{ marginBottom: 14 }}>No candidates yet.</p>
              <Link href="/agents" className="btn btn-primary btn-sm">Run sourcing agent</Link>
            </div>
          ) : (
            <div className="recent-list">
              {shortlist.slice(0, 6).map((c) => {
                const st = statuses[c.id];
                return (
                  <div key={c.id} className="recent-item">
                    <Avatar name={c.name} size={38} />
                    <div className="recent-item-info">
                      <div className="recent-item-name">{c.name}</div>
                      <div className="recent-item-role">{c.title} · {c.company}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {st && st !== "new" && (
                        <span className={`chip ${st === "approved" ? "chip-accent" : st === "rejected" ? "chip-warn" : "chip-muted"}`} style={{ fontSize: "0.72rem" }}>
                          {st}
                        </span>
                      )}
                      <ScoreRing score={c.finalScore} size={40} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pipeline funnel */}
        <div className="card card-pad">
          <div className="section-header">
            <div>
              <p className="section-label">Pipeline</p>
              <h2 className="section-title">Where things stand</h2>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Sourced",          count: shortlist.length,  href: "/candidates", color: "var(--accent)",  max: Math.max(shortlist.length, 1) },
              { label: "Good matches",      count: goodMatches,       href: "/candidates", color: "#1d6b52",         max: Math.max(shortlist.length, 1) },
              { label: "Potential fits",    count: potentialFits,     href: "/candidates", color: "var(--warn)",     max: Math.max(shortlist.length, 1) },
              { label: "Approved",          count: approvedCount,     href: "/outreach",   color: "#6b52a8",         max: Math.max(shortlist.length, 1) },
              { label: "Replied",           count: repliesCount,      href: "/replies",    color: "#2563eb",         max: Math.max(shortlist.length, 1) },
            ].map(({ label, count, href, color, max }) => (
              <Link key={label} href={href} className="dash-funnel-row">
                <span className="dash-funnel-label">{label}</span>
                <div className="dash-funnel-bar-wrap">
                  <div
                    className="dash-funnel-bar"
                    style={{ width: `${Math.max(count / max * 100, count > 0 ? 4 : 0)}%`, background: color }}
                  />
                </div>
                <span className="dash-funnel-count">{count}</span>
              </Link>
            ))}
          </div>

          <div style={{ marginTop: 20 }}>
            <p className="section-label" style={{ marginBottom: 10 }}>Quick actions</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Link href="/search"     className="btn btn-secondary btn-sm">Build search</Link>
              <Link href="/agents"     className="btn btn-secondary btn-sm">Run agent</Link>
              <Link href="/outreach"   className="btn btn-secondary btn-sm">Review outreach</Link>
              <Link href="/replies"    className="btn btn-secondary btn-sm">Triage replies</Link>
            </div>
          </div>
        </div>
      </div>

      {/* Match quality breakdown */}
      {shortlist.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 20 }}>
          <p className="section-label" style={{ marginBottom: 14 }}>Match quality breakdown</p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {(["good-match", "potential-fit", "no-match"] as const).map((tier) => {
              const count = shortlist.filter((c) => c.matchTier === tier).length;
              return (
                <div key={tier} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <MatchBadge tier={tier} score={0} />
                  <span style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: "1.1rem" }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
