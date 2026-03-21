"use client";

import { useState, useEffect, use } from "react";
import { useStore } from "@/lib/store";
import { Candidate, OutreachStep } from "@/lib/types";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────────────────────

type GitHubStats = {
  topLanguages: string[];
  topRepos: Array<{ name: string; stars: number; description: string; topics: string[] }>;
  totalStars: number;
  identityRepos: string[];
  identitySignals: string[];
  fetchedAt: string;
};

type Profile = {
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
  githubStats?: GitHubStats;
};

const STEP_LABELS = ["Step 1 · Immediate", "Step 2 · +3 days", "Step 3 · +7 days"];

export default function ProfileDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { setCandidates } = useStore();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [added, setAdded] = useState(false);

  // Outreach state
  const [generatingOutreach, setGeneratingOutreach] = useState(false);
  const [outreachSteps, setOutreachSteps] = useState<OutreachStep[] | null>(null);
  const [activeStep, setActiveStep] = useState(0);
  const [editMode, setEditMode] = useState(false);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  useEffect(() => {
    fetch(`/api/profiles/${id}`)
      .then((r) => {
        if (r.status === 404) { setNotFound(true); return null; }
        return r.json();
      })
      .then((data) => { if (data?.profile) setProfile(data.profile); })
      .finally(() => setLoading(false));
  }, [id]);

  function addToPool() {
    if (!profile) return;
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
      sourceName:  profile.sourceName === "github" ? "github" : "web",
    };
    setCandidates((prev: Candidate[]) => prev.some((x) => x.id === c.id) ? prev : [c, ...prev]);
    setAdded(true);
  }

  async function generateOutreach() {
    if (!profile) return;
    setGeneratingOutreach(true);
    try {
      const res = await fetch("/api/outreach/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId: profile.id }),
      });
      const data = await res.json() as { steps: OutreachStep[] };
      setOutreachSteps(data.steps);
      setActiveStep(0);
      setEditMode(false);
    } finally {
      setGeneratingOutreach(false);
    }
  }

  function startEdit() {
    if (!outreachSteps) return;
    setEditSubject(outreachSteps[activeStep].subject);
    setEditBody(outreachSteps[activeStep].body);
    setEditMode(true);
  }

  function saveEdit() {
    if (!outreachSteps) return;
    const updated = outreachSteps.map((s, i) =>
      i === activeStep ? { ...s, subject: editSubject, body: editBody } : s
    );
    setOutreachSteps(updated);
    setEditMode(false);
  }

  function copyStep() {
    if (!outreachSteps) return;
    const s = outreachSteps[activeStep];
    navigator.clipboard.writeText(`Subject: ${s.subject}\n\n${s.body}`).catch(() => {});
  }

  // ── Loading / not found ────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <span className="page-eyebrow">Loading…</span>
        </div>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="page">
        <div className="page-header">
          <span className="page-eyebrow">Not found</span>
          <h1 className="page-title">Profile not found</h1>
        </div>
        <Link href="/profiles" className="btn btn-ghost btn-sm">← Back to profiles</Link>
      </div>
    );
  }

  const gh = profile.githubStats;
  const confidencePct = Math.round((profile.confidence ?? 0) * 100);

  const currentStep = outreachSteps?.[activeStep];

  return (
    <div className="page">
      {/* Back */}
      <div style={{ marginBottom: 20 }}>
        <Link href="/profiles" className="btn btn-ghost btn-sm" style={{ fontSize: "0.8rem" }}>
          ← Profiles
        </Link>
      </div>

      {/* ── Header ── */}
      <div className="card card-pad" style={{ marginBottom: 20 }}>
        <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
              <h1 style={{ fontSize: "1.35rem", fontWeight: 700, margin: 0 }}>{profile.name}</h1>
              <span
                className="chip"
                style={{
                  fontSize: "0.70rem",
                  background: profile.sourceName === "github" ? "#24292e18" : "var(--accent-tint)",
                  color: profile.sourceName === "github" ? "#24292e" : "var(--accent)",
                }}
              >
                {profile.sourceName === "github" ? "⬡ GitHub" : "⊞ Web"}
              </span>
              {confidencePct > 0 && (
                <span className="chip" style={{ fontSize: "0.70rem" }}>
                  {confidencePct}% confidence
                </span>
              )}
            </div>

            <p style={{ fontSize: "1rem", color: "var(--ink-soft)", margin: "0 0 4px" }}>
              {[profile.title, profile.company].filter(Boolean).join(" · ")}
              {profile.location && <span style={{ color: "var(--muted)" }}> · {profile.location}</span>}
            </p>

            {/* Domain tags */}
            {(profile.domainTags?.length ?? 0) > 0 && (
              <div className="chips" style={{ gap: 5, marginTop: 8 }}>
                {profile.domainTags?.map((d) => (
                  <span
                    key={d}
                    className="chip"
                    style={{ background: "var(--accent-tint)", color: "var(--accent)", fontSize: "0.72rem" }}
                  >
                    {d}
                  </span>
                ))}
                {profile.inferredDomain && (
                  <span className="chip" style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                    primary: {profile.inferredDomain}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flexShrink: 0 }}>
            <button
              className={`btn btn-sm ${added ? "btn-ghost" : "btn-primary"}`}
              onClick={addToPool}
              disabled={added}
              style={{ minWidth: 140 }}
            >
              {added ? "Added to pool ✓" : "Add to pool →"}
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={generateOutreach}
              disabled={generatingOutreach}
              style={{ minWidth: 140 }}
            >
              {generatingOutreach ? "Generating…" : outreachSteps ? "Regenerate outreach" : "Generate outreach"}
            </button>
          </div>
        </div>

        {/* Links row */}
        <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {profile.githubUrl && (
            <a href={profile.githubUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ fontSize: "0.75rem" }}>
              GitHub ↗
            </a>
          )}
          {profile.linkedinUrl && (
            <a href={profile.linkedinUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm" style={{ fontSize: "0.75rem" }}>
              LinkedIn ↗
            </a>
          )}
          {profile.email && (
            <a href={`mailto:${profile.email}`} className="btn btn-ghost btn-sm" style={{ fontSize: "0.75rem" }}>
              {profile.email}
            </a>
          )}
          <span className="fine" style={{ color: "var(--muted)", marginLeft: "auto" }}>
            Indexed {new Date(profile.indexedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      {/* ── Two-column layout ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* Bio */}
          {profile.bio && (
            <div className="card card-pad">
              <p className="section-label" style={{ marginBottom: 8 }}>Bio</p>
              <p className="fine" style={{ color: "var(--ink-soft)", margin: 0, lineHeight: 1.6 }}>{profile.bio}</p>
            </div>
          )}

          {/* Skills */}
          {(profile.skills?.length ?? 0) > 0 && (
            <div className="card card-pad">
              <p className="section-label" style={{ marginBottom: 10 }}>Skills</p>
              <div className="chips" style={{ gap: 6 }}>
                {profile.skills?.map((s) => (
                  <span key={s} className="chip" style={{ fontSize: "0.75rem" }}>{s}</span>
                ))}
              </div>
            </div>
          )}

          {/* Prior companies */}
          {(profile.priorCompanies?.length ?? 0) > 0 && (
            <div className="card card-pad">
              <p className="section-label" style={{ marginBottom: 8 }}>Prior companies</p>
              <div className="chips" style={{ gap: 6 }}>
                {profile.priorCompanies?.map((c) => (
                  <span key={c} className="chip" style={{ fontSize: "0.75rem" }}>{c}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* GitHub stats */}
          {gh ? (
            <div className="card card-pad">
              <div className="row" style={{ marginBottom: 12 }}>
                <p className="section-label" style={{ margin: 0 }}>GitHub stats</p>
                <span className="fine" style={{ color: "var(--muted)", marginLeft: "auto" }}>
                  ★ {gh.totalStars.toLocaleString()} total stars
                </span>
              </div>

              {/* Languages */}
              {gh.topLanguages.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p className="fine" style={{ color: "var(--muted)", marginBottom: 5 }}>Top languages</p>
                  <div className="chips" style={{ gap: 5 }}>
                    {gh.topLanguages.map((l) => (
                      <span key={l} className="chip" style={{ fontSize: "0.72rem", background: "#24292e14", color: "#24292e" }}>{l}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Identity signals */}
              {gh.identitySignals.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <p className="fine" style={{ color: "var(--muted)", marginBottom: 5 }}>Identity signals</p>
                  <div className="chips" style={{ gap: 5 }}>
                    {gh.identitySignals.map((s) => (
                      <span key={s} className="chip" style={{ fontSize: "0.72rem", background: "var(--accent-tint)", color: "var(--accent)" }}>{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Top repos */}
              {gh.topRepos.length > 0 && (
                <div>
                  <p className="fine" style={{ color: "var(--muted)", marginBottom: 6 }}>Top repos</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {gh.topRepos.map((r) => (
                      <div
                        key={r.name}
                        style={{
                          padding: "8px 10px",
                          background: "var(--surface-raised, rgba(0,0,0,0.03))",
                          borderRadius: 8,
                          border: "1px solid var(--line)",
                        }}
                      >
                        <div className="row" style={{ gap: 8 }}>
                          {profile.githubUrl ? (
                            <a
                              href={`${profile.githubUrl.replace(/\/$/, "")}/${r.name}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ fontWeight: 500, fontSize: "0.82rem", color: "var(--accent)" }}
                            >
                              {r.name} ↗
                            </a>
                          ) : (
                            <span style={{ fontWeight: 500, fontSize: "0.82rem" }}>{r.name}</span>
                          )}
                          <span className="fine" style={{ color: "var(--muted)", marginLeft: "auto" }}>★ {r.stars}</span>
                        </div>
                        {r.description && (
                          <p className="fine" style={{ color: "var(--ink-soft)", margin: "3px 0 0", fontSize: "0.75rem" }}>
                            {r.description}
                          </p>
                        )}
                        {r.topics.length > 0 && (
                          <div className="chips" style={{ gap: 3, marginTop: 4 }}>
                            {r.topics.slice(0, 4).map((t) => (
                              <span key={t} className="chip" style={{ fontSize: "0.65rem", padding: "1px 5px" }}>{t}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className="fine" style={{ color: "var(--muted)", marginTop: 10, fontSize: "0.68rem" }}>
                Fetched {new Date(gh.fetchedAt).toLocaleDateString()}
              </p>
            </div>
          ) : profile.githubUrl && (
            <div className="card card-pad" style={{ textAlign: "center" }}>
              <p className="section-label" style={{ marginBottom: 8 }}>GitHub stats</p>
              <p className="fine" style={{ color: "var(--muted)", margin: "0 0 12px" }}>Not yet enriched from GitHub.</p>
              <button
                className="btn btn-secondary btn-sm"
                onClick={async () => {
                  await fetch("/api/profiles/enrich", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ id: profile.id }),
                  });
                  window.location.reload();
                }}
              >
                Enrich from GitHub
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Outreach panel ── */}
      {outreachSteps && (
        <div className="card card-pad" style={{ marginTop: 20 }}>
          <div className="row" style={{ marginBottom: 16, alignItems: "center" }}>
            <p className="section-label" style={{ margin: 0 }}>Generated outreach sequence</p>
            <span className="fine" style={{ color: "var(--muted)", marginLeft: 8 }}>
              for {profile.name}
            </span>
          </div>

          {/* Step tabs */}
          <div className="row" style={{ gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
            {STEP_LABELS.map((label, i) => (
              <button
                key={i}
                className={`btn btn-sm ${i === activeStep ? "btn-primary" : "btn-ghost"}`}
                style={{ fontSize: "0.78rem" }}
                onClick={() => { setActiveStep(i); setEditMode(false); }}
              >
                {label}
              </button>
            ))}
          </div>

          {currentStep && (
            <div>
              {/* Subject */}
              <div style={{ marginBottom: 12 }}>
                <p className="fine" style={{ color: "var(--muted)", marginBottom: 4 }}>Subject</p>
                {editMode ? (
                  <input
                    className="criteria-input"
                    style={{ width: "100%" }}
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                  />
                ) : (
                  <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--ink)" }}>
                    {currentStep.subject}
                  </div>
                )}
              </div>

              {/* Body */}
              <div style={{ marginBottom: 16 }}>
                <p className="fine" style={{ color: "var(--muted)", marginBottom: 4 }}>Body</p>
                {editMode ? (
                  <textarea
                    className="email-body-edit"
                    rows={10}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    style={{ width: "100%", resize: "vertical" }}
                  />
                ) : (
                  <div
                    className="email-body"
                    style={{
                      whiteSpace: "pre-wrap",
                      background: "var(--surface-raised, rgba(0,0,0,0.02))",
                      borderRadius: 8,
                      padding: "12px 14px",
                      fontSize: "0.85rem",
                      lineHeight: 1.65,
                      color: "var(--ink-soft)",
                    }}
                  >
                    {currentStep.body}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="row" style={{ gap: 8 }}>
                {editMode ? (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditMode(false)}>Discard</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={startEdit}>Edit draft</button>
                    <button className="btn btn-ghost btn-sm" onClick={copyStep}>Copy to clipboard</button>
                  </>
                )}
                {!added && (
                  <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} onClick={addToPool}>
                    Add to pool →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
