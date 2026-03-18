"use client";

import Link from "next/link";
import { useStore } from "@/lib/store";
import { Avatar, ScoreRing } from "@/components/score-ring";

const agents = [
  {
    name: "Sourcing Agent",
    desc: "Scanning LinkedIn, GitHub, HN, and the web for matching profiles.",
    status: "running" as const,
    stat: "47 found today",
  },
  {
    name: "Scheduling Agent",
    desc: "Watches pipeline stages and handles calendar coordination.",
    status: "coming-soon" as const,
    stat: "Coming soon",
  },
  {
    name: "Feedback Agent",
    desc: "Pings interviewers in Slack and extracts structured scorecards.",
    status: "coming-soon" as const,
    stat: "Coming soon",
  },
];

export default function DashboardPage() {
  const { shortlist, approvedCount, replies, statuses } = useStore();

  const triaged = Object.keys(replies).length;
  const outreachSent = Object.values(statuses).filter((s) => s === "approved").length;

  const metrics = [
    { value: shortlist.length, label: "Profiles sourced", delta: "+12 today", up: true },
    { value: approvedCount, label: "Approved for outreach", delta: "this search", up: false },
    { value: outreachSent, label: "Messages sent", delta: "pending send", up: false },
    { value: triaged, label: "Replies triaged", delta: "auto-classified", up: true },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Dashboard</span>
        <h1 className="page-title">Pipeline at a glance</h1>
        <p className="page-subtitle">
          Your sourcing engine is running. Here&apos;s what&apos;s happening.
        </p>
      </div>

      {/* Metric rings */}
      <div className="dash-metrics">
        {metrics.map((m) => (
          <div key={m.label} className="dash-metric-card">
            <span className="dash-metric-value">{m.value}</span>
            <span className="dash-metric-label">{m.label}</span>
            <span className={`dash-metric-delta ${m.up ? "up" : "neutral"}`}>{m.delta}</span>
          </div>
        ))}
      </div>

      <div className="dash-row">
        {/* Recent candidates */}
        <div className="card card-pad">
          <div className="section-header">
            <div>
              <p className="section-label">Top matches</p>
              <h2 className="section-title">Recent candidates</h2>
            </div>
            <Link href="/candidates" className="btn btn-ghost btn-sm">View all</Link>
          </div>
          <div className="recent-list">
            {shortlist.slice(0, 5).map((c) => (
              <div key={c.id} className="recent-item">
                <Avatar name={c.name} size={40} />
                <div className="recent-item-info">
                  <div className="recent-item-name">{c.name}</div>
                  <div className="recent-item-role">{c.title} · {c.company}</div>
                </div>
                <ScoreRing score={c.finalScore} size={46} />
              </div>
            ))}
          </div>
        </div>

        {/* Agent status */}
        <div className="card card-pad">
          <div className="section-header">
            <div>
              <p className="section-label">Automation layer</p>
              <h2 className="section-title">Agent status</h2>
            </div>
            <Link href="/agents" className="btn btn-ghost btn-sm">Manage</Link>
          </div>
          <div className="dash-agent-cards">
            {agents.map((a) => (
              <div key={a.name} className="dash-agent-card">
                <div className="dash-agent-header">
                  <span className="dash-agent-name">{a.name}</span>
                  <span className={`status-badge ${a.status}`}>
                    {a.status === "running" ? "Running" : "Soon"}
                  </span>
                </div>
                <p className="dash-agent-meta">{a.desc}</p>
                <span className="fine">{a.stat}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="card card-pad" style={{ marginTop: 20 }}>
        <div className="section-header">
          <div>
            <p className="section-label">Jump in</p>
            <h2 className="section-title">Quick actions</h2>
          </div>
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <Link href="/search" className="btn btn-primary">Build a search</Link>
          <Link href="/candidates" className="btn btn-secondary">Browse candidates</Link>
          <Link href="/outreach" className="btn btn-secondary">Review outreach queue</Link>
          <Link href="/replies" className="btn btn-secondary">Triage replies</Link>
        </div>
      </div>
    </div>
  );
}
