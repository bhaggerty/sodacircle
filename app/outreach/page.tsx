"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import { Avatar, ScoreRing } from "@/components/score-ring";

export default function OutreachPage() {
  const {
    shortlist,
    selectedCandidateId,
    setSelectedCandidateId,
    selectedCandidate,
    outreachDraft,
    setCandidateStatus,
    statuses,
    criteria,
  } = useStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editedSubject, setEditedSubject] = useState("");
  const [editedBody, setEditedBody] = useState("");

  // Reset edit state when selected candidate changes
  useEffect(() => {
    setIsEditing(false);
    setEditedSubject(outreachDraft?.subject ?? "");
    setEditedBody(outreachDraft?.body ?? "");
  }, [selectedCandidateId, outreachDraft?.subject, outreachDraft?.body]);

  const queue = shortlist.filter(
    (c) => !statuses[c.id] || statuses[c.id] === "approved" || statuses[c.id] === "new"
  );

  const displaySubject = isEditing ? editedSubject : outreachDraft?.subject;
  const displayBody = isEditing ? editedBody : outreachDraft?.body;

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Step 3</span>
        <h1 className="page-title">Outreach queue</h1>
        <p className="page-subtitle">
          Review personalized drafts for each candidate. Approve to send or edit before queuing.
        </p>
      </div>

      <div className="outreach-layout">
        {/* Left: candidate queue */}
        <div>
          <p className="section-label" style={{ marginBottom: 12 }}>
            {queue.length} candidate{queue.length !== 1 ? "s" : ""} in queue
          </p>
          <div className="outreach-queue">
            {queue.map((c) => (
              <button
                key={c.id}
                className={`queue-item ${c.id === selectedCandidateId ? "queue-item-active" : ""}`}
                onClick={() => setSelectedCandidateId(c.id)}
              >
                <Avatar name={c.name} size={36} />
                <div className="queue-item-info">
                  <div className="queue-item-name">{c.name}</div>
                  <div className="queue-item-role">{c.title} · {c.company}</div>
                </div>
                <ScoreRing score={c.finalScore} size={38} />
              </button>
            ))}

            {queue.length === 0 && (
              <div className="card card-pad" style={{ textAlign: "center" }}>
                <p className="fine">No candidates in queue. Approve candidates on the Candidates page.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: email composer */}
        {selectedCandidate && outreachDraft ? (
          <div className="email-composer">
            <div className="email-header">
              <div className="row">
                <Avatar name={selectedCandidate.name} size={40} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.95rem", fontFamily: "var(--font-heading)" }}>
                    {selectedCandidate.name}
                  </div>
                  <div className="fine">{selectedCandidate.email || "email pending"}</div>
                </div>
                <span className="spacer" />
                <ScoreRing score={selectedCandidate.finalScore} size={44} />
              </div>

              <div>
                <div className="email-subject-label">Subject line</div>
                {isEditing ? (
                  <input
                    className="criteria-input"
                    style={{ width: "100%", marginTop: 4 }}
                    value={editedSubject}
                    onChange={(e) => setEditedSubject(e.target.value)}
                  />
                ) : (
                  <div className="email-subject">{displaySubject}</div>
                )}
              </div>

              <div className="email-angle">
                <strong>Suggested angle</strong> — {selectedCandidate.outreachAngle}
              </div>
            </div>

            {isEditing ? (
              <textarea
                className="email-body-edit"
                value={editedBody}
                onChange={(e) => setEditedBody(e.target.value)}
                rows={14}
              />
            ) : (
              <div className="email-body">{displayBody}</div>
            )}

            <div className="email-footer">
              <button
                className="btn btn-primary"
                onClick={() => setCandidateStatus(selectedCandidate.id, "approved")}
              >
                Approve for send
              </button>

              {isEditing ? (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setIsEditing(false)}
                  >
                    Save changes
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setEditedSubject(outreachDraft.subject);
                      setEditedBody(outreachDraft.body);
                      setIsEditing(false);
                    }}
                  >
                    Discard
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setEditedSubject(outreachDraft.subject);
                    setEditedBody(outreachDraft.body);
                    setIsEditing(true);
                  }}
                >
                  Edit draft
                </button>
              )}

              <span className="spacer" />
              {statuses[selectedCandidate.id] === "approved" && (
                <span className="chip chip-accent">Approved</span>
              )}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setCandidateStatus(selectedCandidate.id, "rejected")}
              >
                Skip candidate
              </button>
            </div>
          </div>
        ) : (
          <div className="card card-pad" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 320 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "2rem", marginBottom: 12 }}>○</div>
              <p className="muted">Select a candidate to see their personalized draft.</p>
            </div>
          </div>
        )}
      </div>

      {/* Scoring context */}
      <div className="card card-pad" style={{ marginTop: 24 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 16 }}>
          <div>
            <p className="section-label">Current search</p>
            <span style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}>
              {criteria.roleTitle}
            </span>
          </div>
          <div className="filter-divider" />
          <div>
            <p className="section-label">Target companies</p>
            <div className="chips">
              {criteria.targetCompanies.slice(0, 4).map((c) => (
                <span key={c} className="chip chip-accent">{c}</span>
              ))}
            </div>
          </div>
          <div className="filter-divider" />
          <div>
            <p className="section-label">Comp range</p>
            <span className="fine" style={{ color: "var(--ink)" }}>{criteria.compensationRange}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
