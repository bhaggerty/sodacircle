"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";

export default function SearchPage() {
  const {
    brief, setBrief,
    criteria, setCriteria,
    handleExtractCriteria, handleCsvUpload, handleTagChange,
    rankingCriteria, addRankingCriterion, removeRankingCriterion, updateRankingCriterion,
    savedSearches, saveCurrentSearch, loadSavedSearch, deleteSavedSearch,
  } = useStore();

  const [extracting, setExtracting] = useState(false);
  const [newCriterionText, setNewCriterionText] = useState("");
  const [saveName, setSaveName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const handleExtract = async () => {
    setExtracting(true);
    try {
      await handleExtractCriteria();
    } finally {
      setExtracting(false);
    }
  };

  const handleAddCriterion = () => {
    const text = newCriterionText.trim();
    if (!text) return;
    addRankingCriterion(text, "normal");
    setNewCriterionText("");
  };

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Step 1</span>
        <h1 className="page-title">Build a search</h1>
        <p className="page-subtitle">
          Define hard filters on the left, then add natural-language ranking criteria on the right to fine-tune who rises to the top.
        </p>
      </div>

      {/* Saved searches bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {showSaveInput ? (
          <>
            <input
              className="field"
              style={{ maxWidth: 220 }}
              placeholder="Name this search…"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && saveName.trim()) {
                  saveCurrentSearch(saveName);
                  setSaveName("");
                  setShowSaveInput(false);
                }
                if (e.key === "Escape") { setSaveName(""); setShowSaveInput(false); }
              }}
              autoFocus
            />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                if (saveName.trim()) {
                  saveCurrentSearch(saveName);
                  setSaveName("");
                  setShowSaveInput(false);
                }
              }}
            >
              Save
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setSaveName(""); setShowSaveInput(false); }}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowSaveInput(true)}>
            Save this search
          </button>
        )}

        {savedSearches.length > 0 && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowSaved((v) => !v)}
          >
            {showSaved ? "Hide saved ▲" : `Saved searches (${savedSearches.length}) ▼`}
          </button>
        )}
      </div>

      {/* Saved search list */}
      {showSaved && savedSearches.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 20 }}>
          <p className="section-label" style={{ marginBottom: 12 }}>Saved searches</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {savedSearches.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--surface-strong)", borderRadius: 10, border: "1px solid var(--line)" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{s.name}</div>
                  {s.criteria.roleTitle && (
                    <div className="fine">{s.criteria.roleTitle}{s.criteria.geoPreference ? ` · ${s.criteria.geoPreference}` : ""}</div>
                  )}
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => { loadSavedSearch(s.id); setShowSaved(false); }}>
                  Load
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: "var(--warn)" }}
                  onClick={() => deleteSavedSearch(s.id)}
                  title="Delete saved search"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="search-layout">
        {/* ── Left: Filters ── */}
        <div className="card card-pad">
          <div className="section-header">
            <div>
              <p className="section-label">Filters</p>
              <h2 className="section-title">What are you hiring for?</h2>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn btn-primary" onClick={handleExtract} disabled={extracting}>
                {extracting ? "Extracting…" : "Extract with AI"}
              </button>
              <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                Upload CSV
                <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: "none" }} />
              </label>
            </div>
          </div>

          <div className="search-form">
            <textarea
              className="brief-textarea"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Paste a job brief or describe the ideal candidate in plain English…"
              rows={4}
            />

            <div className="divider" />
            <p className="section-label">Structured criteria</p>

            <div className="field-grid-2">
              <div>
                <label className="fine" style={{ display: "block", marginBottom: 6 }}>Role title</label>
                <input
                  className="field"
                  value={criteria.roleTitle}
                  onChange={(e) => setCriteria({ ...criteria, roleTitle: e.target.value })}
                  placeholder="e.g. Senior Software Engineer"
                />
              </div>
              <div>
                <label className="fine" style={{ display: "block", marginBottom: 6 }}>Location</label>
                <input
                  className="field"
                  value={criteria.geoPreference}
                  onChange={(e) => setCriteria({ ...criteria, geoPreference: e.target.value })}
                  placeholder="e.g. San Francisco, CA or Remote US"
                />
              </div>
              <div>
                <label className="fine" style={{ display: "block", marginBottom: 6 }}>Compensation</label>
                <input
                  className="field"
                  value={criteria.compensationRange}
                  onChange={(e) => setCriteria({ ...criteria, compensationRange: e.target.value })}
                  placeholder="e.g. $180k–$260k"
                />
              </div>
              <div>
                <label className="fine" style={{ display: "block", marginBottom: 6 }}>Seniority</label>
                <input
                  className="field"
                  value={criteria.searchRecipe.seniority}
                  onChange={(e) =>
                    setCriteria({ ...criteria, searchRecipe: { ...criteria.searchRecipe, seniority: e.target.value } })
                  }
                  placeholder="e.g. Senior, Staff"
                />
              </div>
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Must-haves (comma separated)</label>
              <input
                className="field"
                value={criteria.mustHaves.join(", ")}
                onChange={(e) => handleTagChange("mustHaves", e.target.value)}
                placeholder="Skills, experience or credentials that are required…"
              />
              {criteria.mustHaves.length > 0 && (
                <div className="chips" style={{ marginTop: 8 }}>
                  {criteria.mustHaves.map((m) => (
                    <span key={m} className="chip chip-accent" style={{ fontSize: "0.78rem" }}>{m}</span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Nice-to-haves (comma separated)</label>
              <input
                className="field"
                value={criteria.niceToHaves.join(", ")}
                onChange={(e) => handleTagChange("niceToHaves", e.target.value)}
                placeholder="Preferred but not required…"
              />
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Disqualifiers (comma separated)</label>
              <input
                className="field"
                value={criteria.disqualifiers.join(", ")}
                onChange={(e) => handleTagChange("disqualifiers", e.target.value)}
                placeholder="Hard stops — anything that rules someone out…"
              />
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Target companies (comma separated)</label>
              <input
                className="field"
                value={criteria.targetCompanies.join(", ")}
                onChange={(e) => handleTagChange("targetCompanies", e.target.value)}
                placeholder="Preferred alumni companies…"
              />
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Industries (comma separated)</label>
              <input
                className="field"
                value={criteria.searchRecipe.industry.join(", ")}
                onChange={(e) =>
                  setCriteria({
                    ...criteria,
                    searchRecipe: { ...criteria.searchRecipe, industry: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) },
                  })
                }
                placeholder="e.g. SaaS, Fintech, Infrastructure…"
              />
            </div>
          </div>
        </div>

        {/* ── Right: Ranking criteria ── */}
        <div className="stack">
          <div className="card card-pad">
            <div className="section-header">
              <div>
                <p className="section-label">Ranking criteria</p>
                <h2 className="section-title">Who rises to the top?</h2>
              </div>
            </div>
            <p className="fine" style={{ marginBottom: 16 }}>
              Add natural-language instructions that boost candidates matching these signals. Unlike filters, these rank — they don't exclude.
            </p>

            <div className="criteria-panel-right">
              {rankingCriteria.map((rc) => (
                <div key={rc.id} className="criteria-criterion-row">
                  <input
                    className="criteria-criterion-text"
                    value={rc.text}
                    onChange={(e) => updateRankingCriterion(rc.id, { text: e.target.value })}
                    placeholder="e.g. Prefers candidates who have shipped production systems"
                  />
                  <select
                    className="criteria-weight-select"
                    value={rc.weight}
                    onChange={(e) => updateRankingCriterion(rc.id, { weight: e.target.value as "high" | "normal" | "low" })}
                  >
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                  <button
                    className="criteria-criterion-remove"
                    onClick={() => removeRankingCriterion(rc.id)}
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}

              {rankingCriteria.length === 0 && (
                <p className="fine" style={{ color: "var(--muted)", textAlign: "center", padding: "12px 0" }}>
                  No ranking criteria yet. Add one below.
                </p>
              )}

              {/* Add new criterion */}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <input
                  className="field"
                  style={{ flex: 1 }}
                  value={newCriterionText}
                  onChange={(e) => setNewCriterionText(e.target.value)}
                  placeholder="e.g. Has experience at a Series B or later startup"
                  onKeyDown={(e) => e.key === "Enter" && handleAddCriterion()}
                />
                <button className="btn btn-secondary btn-sm" onClick={handleAddCriterion}>
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* Search recipe preview */}
          <div className="card card-pad">
            <p className="section-label" style={{ marginBottom: 12 }}>Search recipe preview</p>
            <div className="recipe-card">
              <div className="recipe-row">
                <strong className="fine" style={{ color: "var(--ink)", textTransform: "none", letterSpacing: 0 }}>Function</strong>
                <span className="chip chip-accent">{criteria.searchRecipe.function}</span>
              </div>
              <div className="divider" />
              <div>
                <p className="section-label" style={{ marginBottom: 8 }}>Evidence signals</p>
                <div className="chips">
                  {criteria.searchRecipe.evidenceSignals.map((item) => (
                    <span key={item} className="chip" style={{ fontSize: "0.76rem" }}>{item}</span>
                  ))}
                </div>
              </div>
              {criteria.searchRecipe.exclusions.length > 0 && (
                <>
                  <div className="divider" />
                  <div>
                    <p className="section-label" style={{ marginBottom: 8 }}>Exclusions</p>
                    <div className="chips">
                      {criteria.searchRecipe.exclusions.map((item) => (
                        <span key={item} className="chip chip-warn" style={{ fontSize: "0.76rem" }}>{item}</span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
