"use client";

import { useState } from "react";

type AgentStatus = "running" | "paused" | "coming-soon";

type Agent = {
  id: string;
  name: string;
  tagline: string;
  desc: string;
  status: AgentStatus;
  color: string;
  icon: string;
  stats: { value: string; label: string }[];
  sources?: string[];
  log?: { text: string; time: string }[];
};

const AGENTS: Agent[] = [
  {
    id: "sourcing",
    name: "Sourcing Agent",
    tagline: "Always on. Always finding.",
    desc: "Continuously scans LinkedIn, GitHub, blog posts, conference speaker lists, Hacker News, and smart web searches to surface matching profiles and populate the candidate pool.",
    status: "running",
    color: "#1d6b52",
    icon: "◎",
    stats: [
      { value: "47", label: "Found today" },
      { value: "12", label: "This hour" },
      { value: "312", label: "Pool total" },
    ],
    sources: ["LinkedIn", "GitHub", "HN", "Blogs", "Conferences", "Web"],
    log: [
      { text: "Found Marcus L. · CrowdStrike · match 91", time: "2m ago" },
      { text: "Scanned /r/cscareerquestions · 3 signals", time: "8m ago" },
      { text: "GitHub search: enterprise-security AE", time: "14m ago" },
      { text: "LinkedIn: 23 new profiles indexed", time: "21m ago" },
      { text: "Conference: RSA 2025 speakers scraped", time: "1h ago" },
    ],
  },
  {
    id: "scheduling",
    name: "Scheduling Agent",
    tagline: "No more calendar tennis.",
    desc: "Watches candidate stage transitions and proposes interview times automatically. Sends calendar invites, handles reschedules, and keeps candidates updated — without anyone touching a calendar.",
    status: "coming-soon",
    color: "#b95c28",
    icon: "◷",
    stats: [
      { value: "—", label: "Interviews booked" },
      { value: "—", label: "Reschedules handled" },
      { value: "—", label: "Hours saved" },
    ],
    sources: ["Google Calendar", "Outlook", "Slack"],
  },
  {
    id: "feedback",
    name: "Feedback Agent",
    tagline: "Scorecards, without the chasing.",
    desc: "Pings interviewers in Slack 30 minutes after each interview. Collects plain-English responses, extracts structured signals, fills scorecards in the ATS, and escalates if an interviewer ghosts.",
    status: "coming-soon",
    color: "#6b52a8",
    icon: "◈",
    stats: [
      { value: "—", label: "Scorecards filled" },
      { value: "—", label: "Ghosted recovered" },
      { value: "—", label: "Avg response time" },
    ],
    sources: ["Slack", "ATS"],
  },
];

export default function AgentsPage() {
  const [agentStatus, setAgentStatus] = useState<Record<string, AgentStatus>>(
    Object.fromEntries(AGENTS.map((a) => [a.id, a.status]))
  );

  const toggle = (id: string) => {
    setAgentStatus((s) => ({
      ...s,
      [id]: s[id] === "running" ? "paused" : "running",
    }));
  };

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Automation layer</span>
        <h1 className="page-title">Agents</h1>
        <p className="page-subtitle">
          Always-on workers that handle sourcing, scheduling, and feedback collection.
          You set the criteria. They do the legwork.
        </p>
      </div>

      <div className="agents-grid">
        {AGENTS.map((agent) => {
          const status = agentStatus[agent.id];
          const isComingSoon = agent.status === "coming-soon";

          return (
            <div
              key={agent.id}
              className="agent-card"
              style={{ color: agent.color } as React.CSSProperties}
            >
              <div className="agent-card-header">
                <div className="row" style={{ gap: 14 }}>
                  <div
                    className="agent-icon-wrap"
                    style={{ background: agent.color + "18", color: agent.color, fontSize: "1.5rem" }}
                  >
                    {agent.icon}
                  </div>
                  <div>
                    <h3 className="agent-title" style={{ color: "var(--ink)" }}>{agent.name}</h3>
                    <p className="fine" style={{ color: agent.color, fontWeight: 600, margin: 0 }}>
                      {agent.tagline}
                    </p>
                  </div>
                </div>
                <span className={`status-badge ${isComingSoon ? "coming-soon" : status === "running" ? "running" : "paused"}`}>
                  {isComingSoon ? "Coming soon" : status === "running" ? "Running" : "Paused"}
                </span>
              </div>

              <p className="agent-desc">{agent.desc}</p>

              <div className="agent-stats">
                {agent.stats.map((s) => (
                  <div key={s.label} className="agent-stat">
                    <span className="agent-stat-value" style={{ color: s.value !== "—" ? agent.color : "var(--muted)" }}>
                      {s.value}
                    </span>
                    <span className="agent-stat-label">{s.label}</span>
                  </div>
                ))}
              </div>

              {agent.sources && (
                <div>
                  <p className="agent-log-title">Data sources</p>
                  <div className="agent-sources">
                    {agent.sources.map((s) => (
                      <span key={s} className="chip" style={{ fontSize: "0.78rem" }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {agent.log && status === "running" && (
                <div className="agent-log">
                  <p className="agent-log-title">Activity log</p>
                  {agent.log.map((entry, i) => (
                    <div key={i} className="agent-log-item">
                      {entry.text}
                      <span className="agent-log-time">{entry.time}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="agent-card-footer">
                {!isComingSoon ? (
                  <>
                    <button
                      className={`btn btn-sm ${status === "running" ? "btn-secondary" : "btn-primary"}`}
                      style={status === "running" ? {} : { background: `linear-gradient(135deg, ${agent.color}, ${agent.color}cc)` }}
                      onClick={() => toggle(agent.id)}
                    >
                      {status === "running" ? "Pause" : "Resume"}
                    </button>
                    <button className="btn btn-ghost btn-sm">Configure</button>
                    <button className="btn btn-ghost btn-sm">View logs</button>
                  </>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
                    Not yet available
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Future agents */}
      <div className="card card-pad" style={{ marginTop: 24 }}>
        <p className="section-label" style={{ marginBottom: 14 }}>On the roadmap</p>
        <div className="chips">
          {[
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
