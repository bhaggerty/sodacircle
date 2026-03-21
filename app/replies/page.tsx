"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/score-ring";
import { ReplyClass } from "@/lib/types";

const CLASS_META: Record<ReplyClass, { label: string; cls: string; emoji: string }> = {
  interested: { label: "Interested", cls: "chip-accent", emoji: "●" },
  "maybe later": { label: "Maybe later", cls: "chip-purple", emoji: "◐" },
  "not interested": { label: "Not interested", cls: "chip-muted", emoji: "○" },
  "refer me": { label: "Refer me", cls: "chip", emoji: "↗" },
  "comp mismatch": { label: "Comp mismatch", cls: "chip-warn", emoji: "⚡" },
  "location mismatch": { label: "Location mismatch", cls: "chip-warn", emoji: "◌" },
  unsubscribe: { label: "Unsubscribe", cls: "chip-warn", emoji: "✕" },
};

const replyOptions: ReplyClass[] = [
  "interested",
  "maybe later",
  "not interested",
  "refer me",
  "comp mismatch",
  "location mismatch",
  "unsubscribe",
];

export default function RepliesPage() {
  const { replies, replyStatuses, setReplyStatus, syncCandidateToAts, atsSyncStatus, atsUrls } = useStore();

  const [notes, setNotes] = useState<Record<string, string>>({});
  const [showNote, setShowNote] = useState<Record<string, boolean>>({});
  const [snoozed, setSnoozed] = useState<Record<string, string>>({});
  const [archived, setArchived] = useState<Record<string, boolean>>({});

  const counts = Object.values(replyStatuses).reduce<Record<string, number>>((acc, v) => {
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});

  const snoozeUntil = () => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Step 4</span>
        <h1 className="page-title">Reply triage</h1>
        <p className="page-subtitle">
          Classify inbound responses. Interested candidates get routed to your ATS.
          Everything else gets the right follow-up action.
        </p>
      </div>

      {/* Summary row */}
      <div className="filter-bar" style={{ marginBottom: 28 }}>
        {Object.entries(counts).map(([cls, count]) => {
          const meta = CLASS_META[cls as ReplyClass];
          return meta ? (
            <span key={cls} className={`chip ${meta.cls}`} style={{ gap: 6 }}>
              {meta.emoji} {count} {meta.label}
            </span>
          ) : null;
        })}
      </div>

      <div className="replies-grid">
        {replies.filter((r) => !archived[r.candidateId]).map((reply) => {
          const current = replyStatuses[reply.candidateId] ?? reply.classification;
          const meta = CLASS_META[current];
          const syncStatus = atsSyncStatus[reply.candidateId];
          const atsUrl = atsUrls[reply.candidateId];
          const isSnoozed = !!snoozed[reply.candidateId];

          return (
            <article key={reply.candidateId} className="reply-card">
              <div className="reply-card-header">
                <div className="row" style={{ gap: 12 }}>
                  <Avatar name={reply.candidateName} size={38} />
                  <div>
                    <h3 className="reply-name">{reply.candidateName}</h3>
                    <div className="fine">inbound reply</div>
                  </div>
                </div>
                {meta && (
                  <span className={`chip ${meta.cls}`}>
                    {meta.emoji} {meta.label}
                  </span>
                )}
              </div>

              <p className="reply-text">&ldquo;{reply.replyText}&rdquo;</p>

              <div>
                <p className="section-label" style={{ marginBottom: 8 }}>Classification</p>
                <select
                  className="reply-select"
                  value={current}
                  onChange={(e) => setReplyStatus(reply.candidateId, e.target.value as ReplyClass)}
                >
                  {replyOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {CLASS_META[opt].label}
                    </option>
                  ))}
                </select>
              </div>

              <p className="reply-action-note">{reply.action}</p>

              {/* Snooze notice */}
              {isSnoozed && (
                <div className="agent-log-item" style={{ color: "#b95c28", fontSize: "0.8rem" }}>
                  ◷ Snoozed until {snoozed[reply.candidateId]}
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: "0.72rem", padding: "1px 6px", marginLeft: 8 }}
                    onClick={() => setSnoozed((s) => { const n = { ...s }; delete n[reply.candidateId]; return n; })}
                  >
                    Unsnooze
                  </button>
                </div>
              )}

              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {current === "interested" && (
                  <>
                    {syncStatus === "synced" ? (
                      <span className="chip chip-accent" style={{ fontSize: "0.78rem" }}>
                        ✓ In ATS
                        {atsUrl && (
                          <a href={atsUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, color: "inherit", textDecoration: "underline" }}>
                            view
                          </a>
                        )}
                      </span>
                    ) : syncStatus === "syncing" ? (
                      <span className="chip chip-muted btn-sm" style={{ fontSize: "0.78rem" }}>Syncing…</span>
                    ) : syncStatus === "error" ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => syncCandidateToAts(reply.candidateId)}
                      >
                        Retry ATS sync
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => syncCandidateToAts(reply.candidateId)}
                      >
                        Create ATS record
                      </button>
                    )}
                  </>
                )}

                {current === "maybe later" && !isSnoozed && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setSnoozed((s) => ({ ...s, [reply.candidateId]: snoozeUntil() }))}
                  >
                    Snooze 60 days
                  </button>
                )}

                {current === "not interested" && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setArchived((a) => ({ ...a, [reply.candidateId]: true }))}
                  >
                    Archive
                  </button>
                )}

                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setShowNote((n) => ({ ...n, [reply.candidateId]: !n[reply.candidateId] }))}
                >
                  {showNote[reply.candidateId] ? "Hide note" : "Add note"}
                </button>
              </div>

              {/* Inline note editor */}
              {showNote[reply.candidateId] && (
                <div style={{ marginTop: 10 }}>
                  <textarea
                    className="agent-brief-input"
                    style={{ minHeight: 64, fontSize: "0.82rem" }}
                    value={notes[reply.candidateId] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [reply.candidateId]: e.target.value }))}
                    placeholder="Add a note about this candidate…"
                    rows={3}
                  />
                  {notes[reply.candidateId] && (
                    <p className="fine" style={{ marginTop: 4, color: "#1d6b52" }}>Note saved locally.</p>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {replies.length === 0 && (
        <div className="card card-pad" style={{ textAlign: "center", padding: 64 }}>
          <p className="muted">No replies yet. Check back once outreach has been sent.</p>
        </div>
      )}
    </div>
  );
}
