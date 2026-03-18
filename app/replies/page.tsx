"use client";

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
  const { replies, replyStatuses, setReplyStatus } = useStore();

  const counts = Object.values(replyStatuses).reduce<Record<string, number>>((acc, v) => {
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});

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
        {replies.map((reply) => {
          const current = replyStatuses[reply.candidateId] ?? reply.classification;
          const meta = CLASS_META[current];

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

              <div className="row" style={{ flexWrap: "wrap" }}>
                {current === "interested" && (
                  <button className="btn btn-primary btn-sm">Create ATS record</button>
                )}
                {current === "maybe later" && (
                  <button className="btn btn-secondary btn-sm">Snooze 60 days</button>
                )}
                {current === "not interested" && (
                  <button className="btn btn-ghost btn-sm">Archive</button>
                )}
                <button className="btn btn-ghost btn-sm">Add note</button>
              </div>
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
