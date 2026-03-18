"use client";

import { useStore } from "@/lib/store";

export default function SearchPage() {
  const {
    brief, setBrief,
    criteria, setCriteria,
    handleExtractCriteria, handleCsvUpload, handleTagChange,
  } = useStore();

  return (
    <div className="page">
      <div className="page-header">
        <span className="page-eyebrow">Step 1</span>
        <h1 className="page-title">Build a search</h1>
        <p className="page-subtitle">
          Paste a plain-English job brief and extract structured criteria. The search recipe
          drives how candidates are ranked.
        </p>
      </div>

      <div className="search-layout">
        {/* Left: Brief + fields */}
        <div className="card card-pad">
          <div className="section-header">
            <div>
              <p className="section-label">Job brief</p>
              <h2 className="section-title">What are you hiring for?</h2>
            </div>
            <button className="btn btn-primary" onClick={handleExtractCriteria}>
              Extract with AI
            </button>
          </div>

          <div className="search-form">
            <textarea
              className="brief-textarea"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Describe the role in plain English — seniority, skills, background, location, comp, deal size, anything that matters..."
              rows={5}
            />

            <div className="divider" />
            <p className="section-label">Extracted criteria</p>

            <div className="field-grid-2">
              <div>
                <label className="fine" style={{ display: "block", marginBottom: 6 }}>Role title</label>
                <input
                  className="field"
                  value={criteria.roleTitle}
                  onChange={(e) => setCriteria({ ...criteria, roleTitle: e.target.value })}
                  placeholder="e.g. Enterprise Account Executive"
                />
              </div>
              <div>
                <label className="fine" style={{ display: "block", marginBottom: 6 }}>Geo preference</label>
                <input
                  className="field"
                  value={criteria.geoPreference}
                  onChange={(e) => setCriteria({ ...criteria, geoPreference: e.target.value })}
                  placeholder="e.g. Remote US, West Coast"
                />
              </div>
              <div>
                <label className="fine" style={{ display: "block", marginBottom: 6 }}>Compensation range</label>
                <input
                  className="field"
                  value={criteria.compensationRange}
                  onChange={(e) => setCriteria({ ...criteria, compensationRange: e.target.value })}
                  placeholder="e.g. $180k–$260k OTE"
                />
              </div>
              <div>
                <label className="fine" style={{ display: "block", marginBottom: 6 }}>Seniority</label>
                <input
                  className="field"
                  value={criteria.searchRecipe.seniority}
                  onChange={(e) =>
                    setCriteria({
                      ...criteria,
                      searchRecipe: { ...criteria.searchRecipe, seniority: e.target.value },
                    })
                  }
                  placeholder="e.g. Mid-senior"
                />
              </div>
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Must-haves (comma separated)</label>
              <input
                className="field"
                value={criteria.mustHaves.join(", ")}
                onChange={(e) => handleTagChange("mustHaves", e.target.value)}
                placeholder="Enterprise quota, $100k+ ACV, security background..."
              />
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Nice-to-haves (comma separated)</label>
              <input
                className="field"
                value={criteria.niceToHaves.join(", ")}
                onChange={(e) => handleTagChange("niceToHaves", e.target.value)}
                placeholder="Builder mentality, startup comfort..."
              />
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Disqualifiers (comma separated)</label>
              <input
                className="field"
                value={criteria.disqualifiers.join(", ")}
                onChange={(e) => handleTagChange("disqualifiers", e.target.value)}
                placeholder="SMB-only, no closing history..."
              />
            </div>

            <div>
              <label className="fine" style={{ display: "block", marginBottom: 6 }}>Target companies (comma separated)</label>
              <input
                className="field"
                value={criteria.targetCompanies.join(", ")}
                onChange={(e) => handleTagChange("targetCompanies", e.target.value)}
                placeholder="Okta, CrowdStrike, Palo Alto Networks..."
              />
            </div>
          </div>
        </div>

        {/* Right: Search recipe + CSV upload */}
        <div className="stack">
          <div className="card card-pad">
            <div className="section-header">
              <div>
                <p className="section-label">Structured output</p>
                <h2 className="section-title">Search recipe</h2>
              </div>
              <label className="btn btn-secondary btn-sm" style={{ cursor: "pointer" }}>
                Upload CSV
                <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: "none" }} />
              </label>
            </div>

            <div className="recipe-card">
              <div className="recipe-row">
                <strong className="fine" style={{ color: "var(--ink)", textTransform: "none", letterSpacing: 0 }}>Function</strong>
                <span className="chip chip-accent">{criteria.searchRecipe.function}</span>
              </div>
              <div className="divider" />
              <div className="recipe-row">
                <strong className="fine" style={{ color: "var(--ink)", textTransform: "none", letterSpacing: 0 }}>Segment</strong>
                <span className="chip chip-accent">{criteria.searchRecipe.segment}</span>
              </div>
              <div className="divider" />
              <div>
                <p className="section-label" style={{ marginBottom: 10 }}>Industry</p>
                <div className="chips">
                  {criteria.searchRecipe.industry.map((item) => (
                    <span key={item} className="chip chip-accent">{item}</span>
                  ))}
                </div>
              </div>
              <div className="divider" />
              <div>
                <p className="section-label" style={{ marginBottom: 10 }}>Evidence signals</p>
                <div className="chips">
                  {criteria.searchRecipe.evidenceSignals.map((item) => (
                    <span key={item} className="chip">{item}</span>
                  ))}
                </div>
              </div>
              <div className="divider" />
              <div>
                <p className="section-label" style={{ marginBottom: 10 }}>Exclusions</p>
                <div className="chips">
                  {criteria.searchRecipe.exclusions.map((item) => (
                    <span key={item} className="chip chip-warn">{item}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="card card-pad">
            <p className="section-label">Scoring model</p>
            <div className="chips" style={{ marginBottom: 12 }}>
              <span className="chip chip-accent">40% rules-based</span>
              <span className="chip chip-accent">40% fit reasoning</span>
              <span className="chip chip-muted">20% semantic match</span>
            </div>
            <p className="fine">
              The ranking engine blends keyword rules, LLM-style fit reasoning, and semantic
              overlap to keep scores explainable. Connect an OpenAI key to activate live LLM
              scoring.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
