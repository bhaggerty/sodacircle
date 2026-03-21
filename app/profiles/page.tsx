"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { Candidate } from "@/lib/types";

// ── Types mirrored from server modules (no server imports in client) ──────────

type EnrichedProfile = {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  bio: string;
  skills: string[];
  skillTags?: string[];
  email: string;
  githubUrl: string;
  linkedinUrl: string;
  sourceUrl: string;
  sourceName: "github" | "web";
  indexedAt: string;
  domainTags?: string[];
  inferredDomain?: string;
  confidence?: number;
  priorCompanies?: string[];
};

type RankedResult = {
  profile: EnrichedProfile;
  finalScore: number;
  termScore: number;
  matchTier: "strong" | "good" | "weak";
  whyMatch: string;
  signals: string[];
  gaps: string[];
  outreachHook: string;
  matchedTerms: string[];
  matchedDomains: string[];
};

type SearchResponse = {
  results: RankedResult[];
  parsedIntent: string;
  expandedTerms: string[];
  domainTags: string[];
  totalRetrieved: number;
  durationMs: number;
};

type BrowseResponse = {
  profiles: EnrichedProfile[];
  total: number;
  filtered: number;
  query: string;
};

// ── Mode: browse (list) vs search (ranked) ────────────────────────────────────

type Mode = "browse" | "search";

const TIER_COLORS: Record<string, string> = {
  strong: "var(--accent)",
  good:   "#d97706",
  weak:   "var(--muted)",
};

const TIER_LABELS: Record<string, string> = {
  strong: "Strong match",
  good:   "Good match",
  weak:   "Weak match",
};

export default function ProfilesPage() {
  const { candidates, setCandidates } = useStore();

  const [mode, setMode] = useState<Mode>("browse");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // browse state
  const [browseData, setBrowseData] = useState<BrowseResponse | null>(null);
  const [browseOffset, setBrowseOffset] = useState(0);
  const PAGE_SIZE = 50;

  // search state
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);

  const [loading, setLoading] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Debounce
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query);
      setBrowseOffset(0);
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  // Switch mode based on query length
  useEffect(() => {
    if (debouncedQuery.length >= 3) {
      setMode("search");
    } else {
      setMode("browse");
    }
  }, [debouncedQuery]);

  // Browse fetch
  const fetchBrowse = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: debouncedQuery,
        limit: String(PAGE_SIZE),
      });
      const res = await fetch(`/api/profiles?${params}`);
      if (res.ok) setBrowseData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, browseOffset]);

  // Search fetch
  const fetchSearch = useCallback(async () => {
    if (debouncedQuery.length < 3) return;
    setSearching(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: debouncedQuery, limit: 20 }),
      });
      if (res.ok) setSearchData(await res.json());
    } finally {
      setSearching(false);
    }
  }, [debouncedQuery]);

  useEffect(() => {
    if (mode === "browse") fetchBrowse();
  }, [mode, fetchBrowse]);

  useEffect(() => {
    if (mode === "search") fetchSearch();
  }, [mode, fetchSearch]);

  // Add profile to candidate pool
  function addToPool(profile: EnrichedProfile) {
    const c: Candidate = {
      id:          profile.id,
      name:        profile.name,
      title:       profile.title,
      company:     profile.company,
      location:    profile.location,
      email:       profile.email,
      linkedinUrl: profile.linkedinUrl,
      summary:     profile.bio,
      experience:  profile.priorCompanies?.join(", ") ?? "",
      sourceName:  profile.sourceName === "web" ? "web" : "github",
    };
    setCandidates((prev: Candidate[]) => {
      if (prev.some((x) => x.id === c.id)) return prev;
      return [c, ...prev];
    });
    setAddedIds((s) => new Set([...s, profile.id]));
  }

  const total = browseData?.total ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Talent database</span>
        <h1 className="page-title">Indexed Profiles</h1>
        <p className="page-subtitle">
          {total > 0
            ? `${total.toLocaleString()} profiles indexed. Search to rank by fit, or browse.`
            : "No profiles indexed yet. Start the background crawler on the Agents page."}
        </p>
      </div>

      {/* Search bar */}
      <div className="nl-search-bar" style={{ marginBottom: 8 }}>
        <input
          className="nl-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search: "senior identity engineer golang" or browse by name, skill…'
        />
        {(loading || searching) && (
          <span className="fine" style={{ color: "var(--muted)", paddingRight: 12 }}>⟳</span>
        )}
      </div>

      {/* Search metadata bar */}
      {mode === "search" && searchData && !searching && (
        <div className="fine" style={{ color: "var(--muted)", marginBottom: 20, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span style={{ color: "var(--ink-soft)" }}>Intent: <strong style={{ color: "var(--ink)", fontWeight: 500 }}>{searchData.parsedIntent}</strong></span>
          <span>·</span>
          <span>{searchData.totalRetrieved} retrieved · {searchData.results.length} ranked · {searchData.durationMs}ms</span>
          {searchData.expandedTerms.length > 0 && (
            <>
              <span>·</span>
              <span>Expanded: {searchData.expandedTerms.slice(0, 8).join(", ")}</span>
            </>
          )}
        </div>
      )}

      {mode === "browse" && !loading && !debouncedQuery && total === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">◎</div>
          <h3>No profiles indexed yet</h3>
          <p className="fine">Start the background crawler on the Agents page to begin building your profile database.</p>
          <a href="/agents" className="btn btn-primary" style={{ marginTop: 16 }}>Go to Agents →</a>
        </div>
      )}

      {/* ── Search results ── */}
      {mode === "search" && !searching && searchData && (
        searchData.results.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">◎</div>
            <h3>No matches for &ldquo;{debouncedQuery}&rdquo;</h3>
            <p className="fine">Try different terms — skills, companies, or job titles. Or broaden the query.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {searchData.results.map((r) => (
              <RankedCard
                key={r.profile.id}
                result={r}
                added={addedIds.has(r.profile.id)}
                onAddToPool={() => addToPool(r.profile)}
              />
            ))}
          </div>
        )
      )}

      {/* ── Browse results ── */}
      {mode === "browse" && (
        <>
          {browseData && browseData.profiles.length > 0 && (
            <>
              <div className="profiles-grid">
                {browseData.profiles.map((p) => (
                  <BrowseCard
                    key={p.id}
                    profile={p}
                    added={addedIds.has(p.id)}
                    onAddToPool={() => addToPool(p)}
                  />
                ))}
              </div>

              {total > PAGE_SIZE && (
                <div className="row" style={{ justifyContent: "center", gap: 12, marginTop: 24 }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={browseOffset === 0}
                    onClick={() => setBrowseOffset(Math.max(0, browseOffset - PAGE_SIZE))}
                  >
                    ← Previous
                  </button>
                  <span className="fine" style={{ color: "var(--muted)", lineHeight: "2rem" }}>
                    {browseOffset + 1}–{Math.min(browseOffset + PAGE_SIZE, total)} of {total.toLocaleString()}
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={browseOffset + PAGE_SIZE >= total}
                    onClick={() => setBrowseOffset(browseOffset + PAGE_SIZE)}
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          )}

          {browseData && browseData.profiles.length === 0 && debouncedQuery && !loading && (
            <div className="empty-state">
              <div className="empty-state-icon">◎</div>
              <h3>No results for &ldquo;{debouncedQuery}&rdquo;</h3>
              <p className="fine">Try 3+ words for AI-ranked search, or different keywords.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Ranked result card (search mode) ─────────────────────────────────────────

function RankedCard({
  result: r,
  added,
  onAddToPool,
}: {
  result: RankedResult;
  added: boolean;
  onAddToPool: () => void;
}) {
  const p = r.profile;
  const [expanded, setExpanded] = useState(false);
  const tierColor = TIER_COLORS[r.matchTier];

  return (
    <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header row */}
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        {/* Score badge */}
        <div
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: `${tierColor}18`,
            border: `2px solid ${tierColor}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: "0.9rem",
            color: tierColor,
          }}
        >
          {r.finalScore}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Link href={`/profiles/${p.id}`} style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--accent)" }}>
              {p.name} ↗
            </Link>
            <span
              className="chip"
              style={{
                fontSize: "0.68rem",
                padding: "1px 6px",
                background: `${tierColor}18`,
                color: tierColor,
              }}
            >
              {TIER_LABELS[r.matchTier]}
            </span>
            <span
              className="chip"
              style={{
                fontSize: "0.68rem",
                padding: "1px 6px",
                background: p.sourceName === "github" ? "#24292e18" : "var(--accent-tint)",
                color: p.sourceName === "github" ? "#24292e" : "var(--accent)",
              }}
            >
              {p.sourceName === "github" ? "⬡ GitHub" : "⊞ Web"}
            </span>
          </div>
          <div className="fine" style={{ color: "var(--ink-soft)", marginTop: 2 }}>
            {[p.title, p.company].filter(Boolean).join(" · ")}
            {p.location && <span style={{ color: "var(--muted)" }}> · {p.location}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          {p.githubUrl && (
            <a
              href={p.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: "0.72rem", padding: "3px 10px" }}
              onClick={(e) => e.stopPropagation()}
            >
              GitHub ↗
            </a>
          )}
          <button
            className={`btn btn-sm ${added ? "btn-ghost" : "btn-primary"}`}
            style={{ fontSize: "0.72rem", padding: "3px 12px" }}
            onClick={onAddToPool}
            disabled={added}
          >
            {added ? "Added ✓" : "Add to pool →"}
          </button>
        </div>
      </div>

      {/* Why match */}
      {r.whyMatch && (
        <p className="fine" style={{ color: "var(--ink-soft)", margin: 0 }}>
          {r.whyMatch}
        </p>
      )}

      {/* Signals */}
      {r.signals.length > 0 && (
        <div className="row" style={{ gap: 5, flexWrap: "wrap" }}>
          {r.signals.map((s) => (
            <span
              key={s}
              className="chip"
              style={{ fontSize: "0.70rem", background: "var(--accent-tint)", color: "var(--accent)" }}
            >
              ✓ {s}
            </span>
          ))}
          {r.gaps.map((g) => (
            <span
              key={g}
              className="chip"
              style={{ fontSize: "0.70rem", background: "#fef3c7", color: "#92400e" }}
            >
              △ {g}
            </span>
          ))}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {r.outreachHook && (
            <div
              className="fine"
              style={{
                background: "var(--surface-raised)",
                borderRadius: 6,
                padding: "8px 12px",
                color: "var(--ink-soft)",
                borderLeft: "3px solid var(--accent)",
              }}
            >
              <strong style={{ color: "var(--ink)", fontWeight: 500 }}>Outreach hook:</strong>{" "}
              {r.outreachHook}
            </div>
          )}

          {/* Skills */}
          {(p.skills?.length ?? 0) > 0 && (
            <div className="chips" style={{ gap: 5 }}>
              {p.skills?.map((s) => (
                <span key={s} className="chip" style={{ fontSize: "0.72rem" }}>{s}</span>
              ))}
            </div>
          )}

          {p.bio && (
            <p className="fine" style={{ color: "var(--ink-soft)", margin: 0 }}>{p.bio}</p>
          )}

          {p.priorCompanies && p.priorCompanies.length > 0 && (
            <p className="fine" style={{ color: "var(--muted)", margin: 0 }}>
              Prior: {p.priorCompanies.join(", ")}
            </p>
          )}

          <div className="row" style={{ gap: 8, marginTop: 2 }}>
            {p.email && (
              <a href={`mailto:${p.email}`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.72rem" }}>
                {p.email}
              </a>
            )}
            {p.linkedinUrl && (
              <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ fontSize: "0.72rem" }}>
                LinkedIn ↗
              </a>
            )}
            <span className="fine" style={{ color: "var(--muted)", marginLeft: "auto", fontSize: "0.68rem" }}>
              Indexed {new Date(p.indexedAt).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}

      {/* Toggle */}
      <button
        className="btn btn-ghost btn-sm"
        style={{ fontSize: "0.72rem", padding: "2px 8px", alignSelf: "flex-start" }}
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "Show less ▲" : "Show details ▼"}
      </button>
    </div>
  );
}

// ── Browse card (browse mode) ─────────────────────────────────────────────────

function BrowseCard({
  profile: p,
  added,
  onAddToPool,
}: {
  profile: EnrichedProfile;
  added: boolean;
  onAddToPool: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="card card-pad" style={{ cursor: "default", display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Header */}
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Link href={`/profiles/${p.id}`} style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--accent)" }}>
              {p.name} ↗
            </Link>
            <span
              className="chip"
              style={{
                fontSize: "0.68rem",
                padding: "1px 6px",
                background: p.sourceName === "github" ? "#24292e18" : "var(--accent-tint)",
                color: p.sourceName === "github" ? "#24292e" : "var(--accent)",
              }}
            >
              {p.sourceName === "github" ? "⬡ GitHub" : "⊞ Web"}
            </span>
            {p.domainTags?.slice(0, 2).map((d) => (
              <span key={d} className="chip" style={{ fontSize: "0.68rem", padding: "1px 6px" }}>{d}</span>
            ))}
          </div>
          <div className="fine" style={{ color: "var(--ink-soft)", marginTop: 2 }}>
            {[p.title, p.company].filter(Boolean).join(" · ")}
            {p.location && <span style={{ color: "var(--muted)" }}> · {p.location}</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexShrink: 0 }}>
          {p.githubUrl && (
            <a
              href={p.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: "0.72rem", padding: "3px 10px" }}
              onClick={(e) => e.stopPropagation()}
            >
              GitHub ↗
            </a>
          )}
          <button
            className={`btn btn-sm ${added ? "btn-ghost" : "btn-primary"}`}
            style={{ fontSize: "0.72rem", padding: "3px 12px" }}
            onClick={onAddToPool}
            disabled={added}
          >
            {added ? "Added ✓" : "Add →"}
          </button>
        </div>
      </div>

      {/* Skills */}
      {p.skills.length > 0 && (
        <div className="chips" style={{ gap: 5 }}>
          {p.skills.slice(0, expanded ? 20 : 6).map((s) => (
            <span key={s} className="chip" style={{ fontSize: "0.72rem" }}>{s}</span>
          ))}
          {!expanded && p.skills.length > 6 && (
            <button
              className="chip chip-muted"
              style={{ fontSize: "0.72rem", cursor: "pointer", border: "none", background: "none" }}
              onClick={() => setExpanded(true)}
            >
              +{p.skills.length - 6} more
            </button>
          )}
        </div>
      )}

      {/* Bio */}
      {p.bio && (
        <p
          className="fine"
          style={{
            color: "var(--ink-soft)",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: expanded ? undefined : 2,
            WebkitBoxOrient: "vertical",
            margin: 0,
          }}
        >
          {p.bio}
        </p>
      )}

      {/* Footer */}
      <div className="row" style={{ gap: 8, marginTop: 2 }}>
        {p.bio && p.bio.length > 120 && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: "0.72rem", padding: "2px 8px" }}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "Show less ▲" : "Show more ▼"}
          </button>
        )}
        {p.email && (
          <a href={`mailto:${p.email}`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.72rem", padding: "2px 8px" }}>
            {p.email}
          </a>
        )}
        {p.linkedinUrl && (
          <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ fontSize: "0.72rem", padding: "2px 8px" }}>
            LinkedIn ↗
          </a>
        )}
        <span className="fine" style={{ color: "var(--muted)", marginLeft: "auto", fontSize: "0.68rem" }}>
          {new Date(p.indexedAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}
