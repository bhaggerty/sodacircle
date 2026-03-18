"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Avatar, ScoreRing } from "@/components/score-ring";
import { AtsSyncStatus } from "@/lib/ats";
import { CandidateStatus } from "@/lib/types";

const RECOMMENDATION_LABEL: Record<string, string> = {
  prioritize: "Prioritize",
  review: "Review",
  reject: "Skip",
};

const STATUS_CHIP: Record<CandidateStatus, { label: string; cls: string }> = {
  new: { label: "New", cls: "chip-muted" },
  approved: { label: "Approved", cls: "chip-accent" },
  saved: { label: "Saved", cls: "chip" },
  rejected: { label: "Rejected", cls: "chip-warn" },
  interested: { label: "Interested", cls: "chip-accent" },
  "not interested": { label: "Not interested", cls: "chip-muted" },
  "wrong fit": { label: "Wrong fit", cls: "chip-warn" },
  "follow up later": { label: "Follow up later", cls: "chip-purple" },
};

function AtsBadge({
  status,
  atsUrl,
  onSync,
}: {
  status: AtsSyncStatus | undefined;
  atsUrl: string | undefined;
  onSync: () => void;
}) {
  if (status === "synced") {
    return atsUrl ? (
      <a
        href={atsUrl}
        target="_blank"
        rel="noreferrer"
        className="chip chip-accent"
        style={{ fontSize: "0.76rem", gap: 5, textDecoration: "none" }}
        title="View in free-ats"
      >
        <span style={{ fontSize: "0.7rem" }}>●</span> In ATS
      </a>
    ) : (
      <span className="chip chip-accent" style={{ fontSize: "0.76rem", gap: 5 }}>
        <span style={{ fontSize: "0.7rem" }}>●</span> In ATS
      </span>
    );
  }

  if (status === "syncing") {
    return (
      <span className="chip chip-muted" style={{ fontSize: "0.76rem", gap: 5 }}>
        <span style={{ fontSize: "0.7rem", animation: "spin 1s linear infinite", display: "inline-block" }}>◌</span> Syncing…
      </span>
    );
  }

  if (status === "error") {
    return (
      <button
        className="chip chip-warn"
        style={{ fontSize: "0.76rem", gap: 5, cursor: "pointer", border: "none" }}
        onClick={onSync}
        title="Sync failed — click to retry"
      >
        <span style={{ fontSize: "0.7rem" }}>✕</span> Retry sync
      </button>
    );
  }

  // idle — show manual sync button
  return (
    <button
      className="chip chip-muted"
      style={{ fontSize: "0.76rem", gap: 5, cursor: "pointer", border: "none" }}
      onClick={onSync}
      title="Push to free-ats"
    >
      <span style={{ fontSize: "0.7rem" }}>○</span> Sync to ATS
    </button>
  );
}

export default function CandidatesPage() {
  const {
    shortlist, statuses, setCandidateStatus, setSelectedCandidateId,
    atsSyncStatus, atsUrls, syncCandidateToAts, syncAllToAts,
  } = useStore();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "prioritize" | "review" | "approved">("all");
  const [syncing, setSyncing] = useState(false);

  const visible = shortlist.filter((c) => {
    const matchesQuery =
      !query ||
      c.name.toLowerCase().includes(query.toLowerCase()) ||
      c.company.toLowerCase().includes(query.toLowerCase()) ||
      c.title.toLowerCase().includes(query.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "approved" ? statuses[c.id] === "approved" : c.recommendation === filter);
    return matchesQuery && matchesFilter;
  });

  const syncedCount = Object.values(atsSyncStatus).filter((s) => s === "synced").length;

  const handleSyncAll = async () => {
    setSyncing(true);
    await syncAllToAts();
    setSyncing(false);
  };

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Candidate pool</span>
        <h1 className="page-title">Ranked candidates</h1>
        <p className="page-subtitle">
          {shortlist.length} profiles scored against your search recipe.
          Approve strong matches to queue them for outreach.
          {syncedCount > 0 && ` · ${syncedCount} synced to free-ats.`}
        </p>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <input
          className="search-input"
          placeholder="Search by name, company, title..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filter-divider" />
        {(["all", "prioritize", "review", "approved"] as const).map((f) => (
          <button
            key={f}
            className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "prioritize" ? "Top picks" : f === "review" ? "Review" : "Approved"}
          </button>
        ))}
        <span className="spacer" />
        <span className="fine">{visible.length} of {shortlist.length} shown</span>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleSyncAll}
          disabled={syncing}
          title="Push all unsynced candidates to free-ats"
        >
          {syncing ? "Syncing…" : "Sync all to ATS"}
        </button>
      </div>

      {/* Candidate grid */}
      <div className="cand-grid">
        {visible.map((c) => {
          const status = statuses[c.id];
          const recChip = c.recommendation === "prioritize"
            ? "chip-accent"
            : c.recommendation === "review"
            ? "chip-warn"
            : "chip-muted";

          return (
            <article key={c.id} className="cand-card">
              <div className="cand-top">
                <Avatar name={c.name} size={44} />
                <div className="cand-info">
                  <h3 className="cand-name">{c.name}</h3>
                  <p className="cand-role">{c.title} · {c.company}</p>
                  <p className="cand-location">{c.location}</p>
                </div>
                <ScoreRing score={c.finalScore} size={54} />
              </div>

              <div className="cand-progress">
                <div className="cand-progress-fill" style={{ width: `${c.finalScore}%` }} />
              </div>

              <p className="cand-summary">{c.fitSummary}</p>

              <div className="chips">
                <span className={`chip ${recChip}`}>
                  {RECOMMENDATION_LABEL[c.recommendation]}
                </span>
                {c.matchedSignals.slice(0, 2).map((s) => (
                  <span key={s} className="chip">{s}</span>
                ))}
                {/* ATS sync status */}
                <AtsBadge
                  status={atsSyncStatus[c.id]}
                  atsUrl={atsUrls[c.id]}
                  onSync={() => syncCandidateToAts(c.id)}
                />
              </div>

              {c.risks.length > 0 && (
                <div className="chips">
                  {c.risks.slice(0, 2).map((r) => (
                    <span key={r} className="chip chip-warn">{r}</span>
                  ))}
                </div>
              )}

              <div className="cand-actions">
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setCandidateStatus(c.id, "approved");
                    setSelectedCandidateId(c.id);
                  }}
                >
                  Approve
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setCandidateStatus(c.id, "saved")}
                >
                  Save
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setCandidateStatus(c.id, "rejected")}
                >
                  Skip
                </button>
                {status && status !== "new" && (
                  <span className={`chip ${STATUS_CHIP[status]?.cls ?? "chip"}`} style={{ marginLeft: "auto" }}>
                    {STATUS_CHIP[status]?.label ?? status}
                  </span>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {visible.length === 0 && (
        <div className="card card-pad" style={{ textAlign: "center", padding: 56 }}>
          <p style={{ color: "var(--muted)", marginBottom: 16 }}>No candidates match this filter.</p>
          <button className="btn btn-secondary" onClick={() => { setQuery(""); setFilter("all"); }}>
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
