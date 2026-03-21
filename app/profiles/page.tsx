"use client";

import { useState, useEffect, useCallback } from "react";
// Mirror of lib/crawler/store.ts IndexedProfile — kept here to avoid
// importing the fs-dependent server module from a client component.
type IndexedProfile = {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  bio: string;
  skills: string[];
  email: string;
  githubUrl: string;
  linkedinUrl: string;
  sourceUrl: string;
  sourceName: "github" | "web";
  indexedAt: string;
};

type ProfilesResponse = {
  profiles: IndexedProfile[];
  total: number;
  query: string;
};

const PAGE_SIZE = 50;

export default function ProfilesPage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ProfilesResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQuery(query); setOffset(0); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: debouncedQuery,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`/api/profiles?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, offset]);

  useEffect(() => { fetchProfiles(); }, [fetchProfiles]);

  const profiles = data?.profiles ?? [];
  const total    = data?.total ?? 0;

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Crawler database</span>
        <h1 className="page-title">Indexed Profiles</h1>
        <p className="page-subtitle">
          {total > 0
            ? `${total.toLocaleString()} profiles indexed from GitHub and the web.`
            : "No profiles indexed yet. Start the background crawler on the Agents page."}
        </p>
      </div>

      {/* Search bar */}
      <div className="nl-search-bar" style={{ marginBottom: 24 }}>
        <input
          className="nl-search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, title, skills, company…"
        />
        {loading && <span className="fine" style={{ color: "var(--muted)", paddingRight: 12 }}>⟳</span>}
      </div>

      {profiles.length === 0 && !loading && (
        <div className="empty-state">
          <div className="empty-state-icon">◎</div>
          <h3>
            {debouncedQuery ? `No results for "${debouncedQuery}"` : "No profiles indexed yet"}
          </h3>
          <p className="fine">
            {debouncedQuery
              ? "Try different keywords — skills, company names, or job titles."
              : "Start the background crawler on the Agents page to begin building your profile database."}
          </p>
          {!debouncedQuery && (
            <a href="/agents" className="btn btn-primary" style={{ marginTop: 16 }}>
              Go to Agents →
            </a>
          )}
        </div>
      )}

      {profiles.length > 0 && (
        <>
          <div className="profiles-grid">
            {profiles.map((p) => (
              <ProfileCard key={p.id} profile={p} />
            ))}
          </div>

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="row" style={{ justifyContent: "center", gap: 12, marginTop: 24 }}>
              <button
                className="btn btn-ghost btn-sm"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                ← Previous
              </button>
              <span className="fine" style={{ color: "var(--muted)", lineHeight: "2rem" }}>
                {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString()}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProfileCard({ profile: p }: { profile: IndexedProfile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="card card-pad"
      style={{ cursor: "default", display: "flex", flexDirection: "column", gap: 10 }}
    >
      {/* Header */}
      <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ fontSize: "0.95rem", color: "var(--ink)" }}>{p.name}</strong>
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
        {p.githubUrl && (
          <a
            href={p.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: "0.72rem", padding: "3px 10px", flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            GitHub ↗
          </a>
        )}
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
          }}
        >
          {p.bio}
        </p>
      )}

      {/* Expand / links */}
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
          <a
            href={`mailto:${p.email}`}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: "0.72rem", padding: "2px 8px" }}
          >
            {p.email}
          </a>
        )}
        {p.linkedinUrl && (
          <a
            href={p.linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost btn-sm"
            style={{ fontSize: "0.72rem", padding: "2px 8px" }}
          >
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
