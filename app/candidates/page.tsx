"use client";

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useStore } from "@/lib/store";
import { Avatar, MatchBadge, ScoreRing } from "@/components/score-ring";
import { AtsSyncStatus } from "@/lib/ats";
import { CandidateStatus, CodeQuality, CriterionEvidence, RankedCandidate, SearchCriteria } from "@/lib/types";
import { rankCandidates } from "@/lib/ai";
import Link from "next/link";

const STATUS_CHIP: Record<CandidateStatus, { label: string; cls: string }> = {
  new:              { label: "New",             cls: "chip-muted" },
  approved:         { label: "Approved",        cls: "chip-accent" },
  saved:            { label: "Saved",           cls: "chip" },
  rejected:         { label: "Rejected",        cls: "chip-warn" },
  interested:       { label: "Interested",      cls: "chip-accent" },
  "not interested": { label: "Not interested",  cls: "chip-muted" },
  "wrong fit":      { label: "Wrong fit",       cls: "chip-warn" },
  "follow up later":{ label: "Follow up later", cls: "chip-purple" },
};

function CodeQualityBadge({ cq }: { cq: CodeQuality }) {
  if (cq.badge === "code-pass") {
    return (
      <span className="code-badge code-badge-pass"
        title={`${cq.reason}${cq.signals.length ? "\n✓ " + cq.signals.slice(0, 3).join("\n✓ ") : ""}`}>
        ✓ Code Pass{cq.topStars > 0 ? ` ★${cq.topStars}` : ""}
      </span>
    );
  }
  if (cq.badge === "poor-code") {
    return (
      <span className="code-badge code-badge-poor"
        title={`${cq.reason}${cq.concerns.length ? "\n⚠ " + cq.concerns.slice(0, 3).join("\n⚠ ") : ""}`}>
        ⚠ Poor Code Quality
      </span>
    );
  }
  return (
    <span className="code-badge code-badge-limited"
      title={`Limited public code to evaluate. ${cq.reason}`}>
      ? Limited Signal
    </span>
  );
}

function AtsBadge({ status, atsUrl, error, onSync }: {
  status: AtsSyncStatus | undefined;
  atsUrl: string | undefined;
  error: string | undefined;
  onSync: () => void;
}) {
  if (status === "synced") {
    return atsUrl ? (
      <a href={atsUrl} target="_blank" rel="noreferrer"
        className="chip chip-accent" style={{ fontSize: "0.76rem", gap: 5, textDecoration: "none" }}>
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
    const isConfigError = error?.includes("must be set") || error?.includes("FREE_ATS");
    return (
      <button className="chip chip-warn" style={{ fontSize: "0.76rem", gap: 5, cursor: "pointer", border: "none" }}
        onClick={onSync}
        title={isConfigError ? "ATS not configured — add FREE_ATS_URL, FREE_ATS_EMAIL, FREE_ATS_PASSWORD to .env.local" : (error ?? "Sync failed")}>
        <span style={{ fontSize: "0.7rem" }}>✕</span> {isConfigError ? "ATS not configured" : "Retry sync"}
      </button>
    );
  }
  return (
    <button className="chip chip-muted" style={{ fontSize: "0.76rem", gap: 5, cursor: "pointer", border: "none" }}
      onClick={onSync} title="Push to free-ats">
      <span style={{ fontSize: "0.7rem" }}>○</span> Sync to ATS
    </button>
  );
}

function EvidencePanel({ evidence }: { evidence: CriterionEvidence[] }) {
  const statusIcon = { matched: "✓", partial: "~", "not-found": "—" };
  const statusCls  = { matched: "evidence-status-matched", partial: "evidence-status-partial", "not-found": "evidence-status-notfound" };
  return (
    <div className="evidence-panel">
      <p className="section-label" style={{ marginBottom: 8 }}>Why this match</p>
      {evidence.map((ev) => (
        <div key={ev.criterion} className="evidence-row">
          <span className={`evidence-status ${statusCls[ev.status]}`}>{statusIcon[ev.status]}</span>
          <div>
            <div className="evidence-criterion">{ev.criterion}</div>
            {ev.evidence && <div className="evidence-snippet">{ev.evidence}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Export helpers ────────────────────────────────────────────────────────────

function exportCsv(candidates: RankedCandidate[], statuses: Record<string, CandidateStatus>) {
  const headers = ["Name", "Title", "Company", "Location", "Email", "LinkedIn", "Score", "Tier", "Status", "Fit Summary"];
  const rows = candidates.map((c) => [
    c.name, c.title, c.company, c.location, c.email,
    c.linkedinUrl, c.finalScore, c.matchTier,
    statuses[c.id] ?? "new", c.fitSummary,
  ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`));
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `candidates-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main page ─────────────────────────────────────────────────────────────────

type SortKey = "score" | "name" | "company" | "tier";

export default function CandidatesPage() {
  const {
    shortlist, statuses, setCandidateStatus, setSelectedCandidateId,
    atsSyncStatus, atsErrors, atsUrls, syncCandidateToAts, syncAllToAts,
    prefillBriefFromCandidate, clearCandidates, criteria,
  } = useStore();

  const [query,            setQuery]           = useState("");
  const [filter,           setFilter]          = useState<"all" | "good-match" | "potential-fit" | "approved">("all");
  const [sort,             setSort]            = useState<SortKey>("score");
  const [syncing,          setSyncing]         = useState(false);
  const [expandedEvidence, setExpandedEvidence]= useState<string | null>(null);
  const [confirmClear,     setConfirmClear]    = useState(false);
  const [focusedIdx,       setFocusedIdx]      = useState(0);
  const [nlQuery,          setNlQuery]         = useState("");
  const [nlSearching,      setNlSearching]     = useState(false);
  const [nlIntent,         setNlIntent]        = useState("");
  const [overrideCriteria, setOverrideCriteria]= useState<Partial<SearchCriteria> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // When overrideCriteria is set (from NL search), re-rank the pool against it
  const activeShortlist = overrideCriteria
    ? rankCandidates(
        shortlist, // use existing shortlist as base candidates
        { ...criteria, ...(overrideCriteria as SearchCriteria) },
      )
    : shortlist;

  const handleNlSearch = async () => {
    if (!nlQuery.trim()) { setOverrideCriteria(null); setNlIntent(""); return; }
    setNlSearching(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: nlQuery }),
      });
      const data = await res.json() as { criteria: Partial<SearchCriteria>; parsedIntent: string };
      setOverrideCriteria(data.criteria);
      setNlIntent(data.parsedIntent);
      setFilter("all");
      setSort("score");
    } catch {
      setNlIntent("Search failed — using keyword filter instead");
      setQuery(nlQuery);
    } finally {
      setNlSearching(false);
    }
  };

  // Filter
  const filtered = activeShortlist.filter((c) => {
    const q = query.toLowerCase();
    const matchesQuery = !q ||
      c.name.toLowerCase().includes(q) ||
      c.company.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.location.toLowerCase().includes(q);
    const matchesFilter =
      filter === "all" ||
      (filter === "approved"    ? statuses[c.id] === "approved"        : false) ||
      (filter === "good-match"  ? c.matchTier === "good-match"         : false) ||
      (filter === "potential-fit"? c.matchTier === "potential-fit"     : false);
    return matchesQuery && matchesFilter;
  });

  // Sort
  const tierOrder = { "good-match": 0, "potential-fit": 1, "no-match": 2 };
  const visible = [...filtered].sort((a, b) => {
    if (sort === "score")   return b.finalScore - a.finalScore;
    if (sort === "name")    return a.name.localeCompare(b.name);
    if (sort === "company") return a.company.localeCompare(b.company);
    if (sort === "tier")    return tierOrder[a.matchTier] - tierOrder[b.matchTier];
    return 0;
  });

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't fire when typing in an input
    if (["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName)) return;
    if (!visible[focusedIdx]) return;
    const c = visible[focusedIdx];
    if (e.key === "a" || e.key === "A") { setCandidateStatus(c.id, "approved"); setSelectedCandidateId(c.id); }
    if (e.key === "s" || e.key === "S") setCandidateStatus(c.id, "saved");
    if (e.key === "x" || e.key === "X") setCandidateStatus(c.id, "rejected");
    if (e.key === "w" || e.key === "W") setExpandedEvidence((prev) => prev === c.id ? null : c.id);
    if (e.key === "ArrowDown") { e.preventDefault(); setFocusedIdx((i) => Math.min(i + 1, visible.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setFocusedIdx((i) => Math.max(i - 1, 0)); }
  }, [visible, focusedIdx, setCandidateStatus, setSelectedCandidateId]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Reset focus when filter/sort changes
  useEffect(() => { setFocusedIdx(0); }, [filter, sort, query]);

  const syncedCount = Object.values(atsSyncStatus).filter((s) => s === "synced").length;
  const goodCount   = shortlist.filter((c) => c.matchTier === "good-match").length;
  const fitCount    = shortlist.filter((c) => c.matchTier === "potential-fit").length;

  const handleSyncAll = async () => { setSyncing(true); await syncAllToAts(); setSyncing(false); };

  if (shortlist.length === 0) {
    return (
      <div className="page">
        <div className="page-header">
          <span className="page-eyebrow">Candidate pool</span>
          <h1 className="page-title">No candidates yet</h1>
          <p className="page-subtitle">Source candidates first, then come back here to review and approve them.</p>
        </div>
        <div className="card card-pad" style={{ textAlign: "center", padding: 56 }}>
          <div style={{ fontSize: "2.5rem", marginBottom: 16, opacity: 0.3 }}>○</div>
          <p className="muted" style={{ marginBottom: 20 }}>Your candidate pool is empty.</p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <Link href="/agents" className="btn btn-primary">Run sourcing agent</Link>
            <Link href="/search" className="btn btn-secondary">Build a search first</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page" ref={gridRef}>
      <div className="page-header">
        <span className="page-eyebrow">Candidate pool</span>
        <h1 className="page-title">Ranked candidates</h1>
        <p className="page-subtitle">
          {shortlist.length} profiles · {goodCount} good matches · {fitCount} potential fits.
          {syncedCount > 0 && ` ${syncedCount} synced to ATS.`}
          <span className="fine" style={{ marginLeft: 12 }}>
            Shortcuts: <kbd>A</kbd> approve · <kbd>X</kbd> skip · <kbd>W</kbd> why · <kbd>↑↓</kbd> navigate
          </span>
        </p>
      </div>

      {/* Natural language search */}
      <div className="nl-search-bar">
        <input
          className="nl-search-input"
          placeholder='Search in plain English — e.g. "founding AE who sold identity security" or "senior Go engineer at a Series B"'
          value={nlQuery}
          onChange={(e) => {
            setNlQuery(e.target.value);
            if (!e.target.value.trim()) { setOverrideCriteria(null); setNlIntent(""); }
          }}
          onKeyDown={(e) => e.key === "Enter" && handleNlSearch()}
        />
        <button
          className="btn btn-primary"
          onClick={handleNlSearch}
          disabled={nlSearching}
        >
          {nlSearching ? "Searching…" : "Search"}
        </button>
        {overrideCriteria && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setOverrideCriteria(null); setNlIntent(""); setNlQuery(""); }}>
            × Clear
          </button>
        )}
      </div>
      {nlIntent && (
        <p className="fine" style={{ margin: "-8px 0 14px", color: "var(--accent)" }}>
          Searching for: {nlIntent}
        </p>
      )}

      {/* Filter + sort bar */}
      <div className="filter-bar">
        <input
          className="search-input"
          placeholder="Search name, company, title, location…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); }}
        />
        <div className="filter-divider" />
        {([
          { key: "all",          label: "All" },
          { key: "good-match",   label: `Top picks (${goodCount})` },
          { key: "potential-fit",label: `Review (${fitCount})` },
          { key: "approved",     label: "Approved" },
        ] as const).map(({ key, label }) => (
          <button key={key}
            className={`btn btn-sm ${filter === key ? "btn-primary" : "btn-ghost"}`}
            onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
        <div className="filter-divider" />
        <select
          className="criteria-weight-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          style={{ padding: "6px 10px" }}
        >
          <option value="score">Sort: Score</option>
          <option value="tier">Sort: Tier</option>
          <option value="name">Sort: Name</option>
          <option value="company">Sort: Company</option>
        </select>
        <span className="spacer" />
        <span className="fine">{visible.length} of {shortlist.length}</span>
        <button className="btn btn-secondary btn-sm" onClick={() => exportCsv(visible, statuses)} title="Download as CSV">
          Export CSV
        </button>
        <button className="btn btn-secondary btn-sm" onClick={handleSyncAll} disabled={syncing}>
          {syncing ? "Syncing…" : "Sync all to ATS"}
        </button>
        {confirmClear ? (
          <>
            <button className="btn btn-danger btn-sm" onClick={() => { clearCandidates(); setConfirmClear(false); }}>
              Confirm clear
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmClear(true)} title="Remove all candidates from pool">
            Clear pool
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="cand-grid">
        {visible.map((c, idx) => {
          const status = statuses[c.id];
          const isFocused = idx === focusedIdx;

          return (
            <article
              key={c.id}
              className={`cand-card${isFocused ? " cand-card-focused" : ""}`}
              onClick={() => setFocusedIdx(idx)}
            >
              <div className="cand-top">
                <Avatar name={c.name} size={44} />
                <div className="cand-info">
                  <h3 className="cand-name">{c.name}</h3>
                  <p className="cand-role">{c.title} · {c.company}</p>
                  <p className="cand-location">{c.location}</p>
                </div>
                <ScoreRing
                  score={c.finalScore}
                  size={54}
                  title={`Score: ${c.finalScore} (rule: ${c.ruleScore}, semantic: ${c.semanticScore})`}
                />
              </div>

              <div className="cand-progress">
                <div className="cand-progress-fill" style={{ width: `${c.finalScore}%` }} />
              </div>

              <p className="cand-summary">{c.fitSummary}</p>

              <div className="chips">
                <MatchBadge tier={c.matchTier} score={c.finalScore} />
                {c.codeQuality && <CodeQualityBadge cq={c.codeQuality} />}
                {c.matchedSignals
                  .filter((s) => !s.startsWith("Code Pass") && !s.startsWith("From a target"))
                  .slice(0, 2)
                  .map((s) => <span key={s} className="chip">{s}</span>)
                }
                <AtsBadge
                  status={atsSyncStatus[c.id]}
                  atsUrl={atsUrls[c.id]}
                  error={atsErrors[c.id]}
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

              {expandedEvidence === c.id && c.criteriaEvidence.length > 0 && (
                <EvidencePanel evidence={c.criteriaEvidence} />
              )}

              <div className="cand-actions">
                <button className="btn btn-primary btn-sm"
                  onClick={() => { setCandidateStatus(c.id, "approved"); setSelectedCandidateId(c.id); }}>
                  Approve
                </button>
                <button className="btn btn-secondary btn-sm"
                  onClick={() => setCandidateStatus(c.id, "saved")}>
                  Save
                </button>
                <button className="btn btn-danger btn-sm"
                  onClick={() => setCandidateStatus(c.id, "rejected")}>
                  Skip
                </button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => setExpandedEvidence(expandedEvidence === c.id ? null : c.id)}
                  title="See why this candidate matched (W)">
                  {expandedEvidence === c.id ? "Hide" : "Why?"}
                </button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => prefillBriefFromCandidate(c)}
                  title="Pre-fill brief to find similar candidates">
                  Find Similar
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
