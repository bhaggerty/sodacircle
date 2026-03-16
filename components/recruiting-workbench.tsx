"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { draftOutreach, parseBriefToCriteria, rankCandidates } from "@/lib/ai";
import { defaultBrief, defaultCriteria, sampleCandidates, sampleReplies } from "@/lib/mock-data";
import {
  Candidate,
  CandidateStatus,
  RankedCandidate,
  ReplyClass,
  SearchCriteria
} from "@/lib/types";

const outcomeOptions: CandidateStatus[] = [
  "interested",
  "not interested",
  "wrong fit",
  "follow up later"
];

const recommendationTone = {
  prioritize: "Prioritize now",
  review: "sodacircle review",
  reject: "Likely reject"
} as const;

function parseCsv(text: string): Candidate[] {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((cell) => cell.trim().toLowerCase());

  return rows
    .filter(Boolean)
    .map((row, index) => {
      const values = row.split(",").map((cell) => cell.trim());
      const get = (name: string) => values[headers.indexOf(name)] ?? "";

      return {
        id: `upload-${index + 1}`,
        name: get("name"),
        title: get("title"),
        company: get("company"),
        location: get("location"),
        email: get("email"),
        linkedinUrl: get("linkedin_url"),
        summary: get("summary"),
        experience: get("experience"),
        notes: get("notes")
      };
    })
    .filter((candidate) => candidate.name && candidate.title);
}

function splitTags(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

export function SodacircleWorkbench() {
  const [brief, setBrief] = useState(defaultBrief);
  const [criteria, setCriteria] = useState<SearchCriteria>(defaultCriteria);
  const [candidates, setCandidates] = useState<Candidate[]>(sampleCandidates);
  const [shortlist, setShortlist] = useState<RankedCandidate[]>(() =>
    rankCandidates(sampleCandidates, defaultCriteria)
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(() => shortlist[0]?.id ?? "");
  const [statuses, setStatuses] = useState<Record<string, CandidateStatus>>({});
  const [replyStatuses, setReplyStatuses] = useState<Record<string, ReplyClass>>(
    Object.fromEntries(sampleReplies.map((reply) => [reply.candidateId, reply.classification]))
  );

  const approvedCount = useMemo(
    () => Object.values(statuses).filter((status) => status === "approved").length,
    [statuses]
  );

  const selectedCandidate = shortlist.find((candidate) => candidate.id === selectedCandidateId) ?? shortlist[0];
  const outreachDraft = selectedCandidate ? draftOutreach(selectedCandidate, criteria) : null;

  const refreshRanking = (nextCriteria: SearchCriteria, nextCandidates = candidates) => {
    const ranked = rankCandidates(nextCandidates, nextCriteria);
    setShortlist(ranked);
    setSelectedCandidateId(ranked[0]?.id ?? "");
  };

  const handleExtractCriteria = () => {
    const nextCriteria = parseBriefToCriteria(brief, criteria);
    setCriteria(nextCriteria);
    refreshRanking(nextCriteria);
  };

  const handleCsvUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const csv = await file.text();
    const parsed = parseCsv(csv);
    if (!parsed.length) {
      return;
    }

    setCandidates(parsed);
    refreshRanking(criteria, parsed);
  };

  const handleTagChange = (field: keyof SearchCriteria, value: string) => {
    const nextCriteria = {
      ...criteria,
      [field]: splitTags(value)
    };
    setCriteria(nextCriteria);
    refreshRanking(nextCriteria);
  };

  const setCandidateStatus = (candidateId: string, status: CandidateStatus) => {
    setStatuses((current) => ({ ...current, [candidateId]: status }));
  };

  return (
    <main className="app-shell">
      <div className="frame">
        <section className="hero">
          <div className="hero-grid">
            <div className="stack">
              <span className="eyebrow">sodacircle</span>
              <h1 className="title">Who should I contact, why, and what should I say?</h1>
              <p className="subtle">
                sodacircle turns a hiring brief into structured criteria, scores uploaded talent
                pools, drafts outreach, and tracks reply outcomes in one flow.
              </p>
              <div className="metric-strip">
                <Stat value={`${shortlist.length}`} label="Profiles in current search" />
                <Stat value={`${approvedCount}`} label="Approved for outreach" />
                <Stat
                  value={`${Object.keys(replyStatuses).length}`}
                  label="Replies triaged automatically"
                />
              </div>
            </div>
            <div className="campaign-card stack">
              <div className="section-header">
                <div>
                  <p className="muted-label">Suggested first use case</p>
                  <h2 className="section-title">Enterprise AE in cyber / identity</h2>
                </div>
                <span className="ghost-chip">Phase 1 + 2 ready</span>
              </div>
              <div className="mini-list">
                <div className="timeline-card">
                  <div>
                    <strong>Intake to shortlist</strong>
                    <p className="small-copy">Paste req, refine must-haves, import CSV, rank instantly.</p>
                  </div>
                  <span className="status-pill active">Live</span>
                </div>
                <div className="timeline-card">
                  <div>
                    <strong>Outreach drafting</strong>
                    <p className="small-copy">Human-approved outbound with a role-specific angle.</p>
                  </div>
                  <span className="status-pill active">Live</span>
                </div>
                <div className="timeline-card">
                  <div>
                    <strong>Reply intelligence</strong>
                    <p className="small-copy">Classify inbound responses and trigger workflow actions.</p>
                  </div>
                  <span className="ghost-chip">Stubbed</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-grid">
            <div className="span-5 stack">
              <div className="section-header">
                <div>
                  <p className="muted-label">Workflow 1</p>
                  <h2 className="section-title">Job Intake + Search Recipe</h2>
                </div>
                <button className="button" onClick={handleExtractCriteria}>
                  Extract criteria with AI
                </button>
              </div>
              <textarea
                className="textarea"
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
              />
              <div className="grid-2">
                <input
                  className="field"
                  value={criteria.roleTitle}
                  onChange={(event) => setCriteria((current) => ({ ...current, roleTitle: event.target.value }))}
                  placeholder="Role title"
                />
                <input
                  className="field"
                  value={criteria.geoPreference}
                  onChange={(event) =>
                    setCriteria((current) => ({ ...current, geoPreference: event.target.value }))
                  }
                  placeholder="Geo preference"
                />
                <input
                  className="field"
                  value={criteria.compensationRange}
                  onChange={(event) =>
                    setCriteria((current) => ({ ...current, compensationRange: event.target.value }))
                  }
                  placeholder="Comp range"
                />
                <input
                  className="field"
                  value={criteria.searchRecipe.seniority}
                  onChange={(event) =>
                    setCriteria((current) => ({
                      ...current,
                      searchRecipe: { ...current.searchRecipe, seniority: event.target.value }
                    }))
                  }
                  placeholder="Seniority"
                />
              </div>
              <input
                className="field"
                value={criteria.mustHaves.join(", ")}
                onChange={(event) => handleTagChange("mustHaves", event.target.value)}
                placeholder="Must-haves, comma separated"
              />
              <input
                className="field"
                value={criteria.niceToHaves.join(", ")}
                onChange={(event) => handleTagChange("niceToHaves", event.target.value)}
                placeholder="Nice-to-haves, comma separated"
              />
              <input
                className="field"
                value={criteria.disqualifiers.join(", ")}
                onChange={(event) => handleTagChange("disqualifiers", event.target.value)}
                placeholder="Disqualifiers, comma separated"
              />
            </div>

            <div className="span-7 stack">
              <div className="section-header">
                <div>
                  <p className="muted-label">Structured output</p>
                  <h2 className="section-title">Search Recipe</h2>
                </div>
                <label className="button-secondary">
                  Upload candidate CSV
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleCsvUpload}
                    style={{ display: "none" }}
                  />
                </label>
              </div>

              <div className="recipe-card stack">
                <div className="label-row">
                  <strong>Function</strong>
                  <span className="ghost-chip">{criteria.searchRecipe.function}</span>
                </div>
                <div className="label-row">
                  <strong>Segment</strong>
                  <span className="ghost-chip">{criteria.searchRecipe.segment}</span>
                </div>
                <div className="stack">
                  <strong>Industry</strong>
                  <div className="chip-wrap">
                    {criteria.searchRecipe.industry.map((item) => (
                      <span key={item} className="chip">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="stack">
                  <strong>Evidence signals</strong>
                  <div className="chip-wrap">
                    {criteria.searchRecipe.evidenceSignals.map((item) => (
                      <span key={item} className="chip">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="stack">
                  <strong>Exclusions</strong>
                  <div className="chip-wrap">
                    {criteria.searchRecipe.exclusions.map((item) => (
                      <span key={item} className="ghost-chip">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <p className="fine-print">
                  The ranking engine blends rules, LLM-style fit reasoning, and semantic overlap to keep
                  the shortlist explainable.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-grid">
            <div className="span-7 stack">
              <div className="section-header">
                <div>
                  <p className="muted-label">Workflow 2 + 3</p>
                  <h2 className="section-title">Ranked Shortlist</h2>
                </div>
                <div className="legend-row">
                  <span className="ghost-chip">40% rules</span>
                  <span className="ghost-chip">40% fit reasoning</span>
                  <span className="ghost-chip">20% semantic match</span>
                </div>
              </div>

              <div className="stack">
                {shortlist.map((candidate) => (
                  <article
                    key={candidate.id}
                    className="candidate-card"
                    style={{
                      outline: candidate.id === selectedCandidate?.id ? "2px solid rgba(29, 107, 82, 0.28)" : "none"
                    }}
                  >
                    <div className="candidate-top">
                      <div>
                        <h3 className="candidate-name">{candidate.name}</h3>
                        <p className="candidate-role">
                          {candidate.title} at {candidate.company} - {candidate.location}
                        </p>
                        <p className="small-copy">{candidate.fitSummary}</p>
                      </div>
                      <button className="score-badge button-minimal" onClick={() => setSelectedCandidateId(candidate.id)}>
                        <strong>{candidate.finalScore}</strong>
                        Fit score
                      </button>
                    </div>

                    <div className="progress">
                      <span style={{ width: `${candidate.finalScore}%` }} />
                    </div>

                    <div className="chip-wrap">
                      <span className="status-pill active">{recommendationTone[candidate.recommendation]}</span>
                      {candidate.matchedSignals.map((signal) => (
                        <span key={signal} className="chip">
                          {signal}
                        </span>
                      ))}
                    </div>

                    <div className="stack">
                      <strong>Risks / gaps</strong>
                      <div className="chip-wrap">
                        {candidate.risks.length ? (
                          candidate.risks.map((risk) => (
                            <span key={risk} className="ghost-chip">
                              {risk}
                            </span>
                          ))
                        ) : (
                          <span className="chip">No major risks flagged</span>
                        )}
                      </div>
                    </div>

                    <div className="action-row">
                      <button className="button" onClick={() => setCandidateStatus(candidate.id, "approved")}>
                        Approve
                      </button>
                      <button className="button-secondary" onClick={() => setCandidateStatus(candidate.id, "saved")}>
                        Save
                      </button>
                      <button className="button-minimal" onClick={() => setCandidateStatus(candidate.id, "rejected")}>
                        Reject
                      </button>
                      {statuses[candidate.id] ? (
                        <span className="status-pill active">Status: {statuses[candidate.id]}</span>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="span-5 stack">
              <div className="section-header">
                <div>
                  <p className="muted-label">Workflow 4</p>
                  <h2 className="section-title">Outreach Generator</h2>
                </div>
                <span className="ghost-chip">
                  {selectedCandidate ? `Drafting for ${selectedCandidate.name}` : "Select a candidate"}
                </span>
              </div>

              {outreachDraft && selectedCandidate ? (
                <div className="stack">
                  <div className="recipe-card stack">
                    <div>
                      <strong>Suggested angle</strong>
                      <p className="small-copy">{selectedCandidate.outreachAngle}</p>
                    </div>
                    <div className="divider" />
                    <div>
                      <strong>Subject</strong>
                      <p className="small-copy">{outreachDraft.subject}</p>
                    </div>
                    <div className="mail-box">{outreachDraft.body}</div>
                  </div>

                  <div className="action-row">
                    <button className="button" onClick={() => setCandidateStatus(selectedCandidate.id, "approved")}>
                      Approve for send
                    </button>
                    <button className="button-secondary">Edit draft</button>
                  </div>
                </div>
              ) : (
                <div className="recipe-card">
                  <p className="small-copy">Pick a ranked profile to generate a personalized email draft.</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-grid">
            <div className="span-4 stack">
              <div className="section-header">
                <div>
                  <p className="muted-label">Workflow 5</p>
                  <h2 className="section-title">Reply Triage</h2>
                </div>
                <span className="ghost-chip">Slack / ATS hooks next</span>
              </div>
              {sampleReplies.map((reply) => (
                <article key={reply.candidateId} className="reply-card stack">
                  <div className="label-row">
                    <strong>{reply.candidateName}</strong>
                    <span className="status-pill active">{replyStatuses[reply.candidateId]}</span>
                  </div>
                  <p className="small-copy">{reply.replyText}</p>
                  <select
                    className="select"
                    value={replyStatuses[reply.candidateId]}
                    onChange={(event) =>
                      setReplyStatuses((current) => ({
                        ...current,
                        [reply.candidateId]: event.target.value as ReplyClass
                      }))
                    }
                  >
                    <option value="interested">interested</option>
                    <option value="maybe later">maybe later</option>
                    <option value="not interested">not interested</option>
                    <option value="refer me">refer me to someone else</option>
                    <option value="comp mismatch">compensation mismatch</option>
                    <option value="location mismatch">location mismatch</option>
                    <option value="unsubscribe">unsubscribe</option>
                  </select>
                  <p className="fine-print">{reply.action}</p>
                </article>
              ))}
            </div>

            <div className="span-8 stack">
              <div className="section-header">
                <div>
                  <p className="muted-label">sodacircle control layer</p>
                  <h2 className="section-title">Decision Memory + Outcome Marking</h2>
                </div>
                <span className="ghost-chip">Fast correction loop</span>
              </div>
              <div className="recipe-card stack">
                <p className="subtle">
                  The sodacircle team should be able to correct the system in seconds. In production, each
                  approval, rejection reason, and outcome would feed back into ranking calibration for the
                  next search.
                </p>
                <div className="status-row">
                  {shortlist.slice(0, 3).map((candidate) => (
                    <div key={candidate.id} className="timeline-card">
                      <div>
                        <strong>{candidate.name}</strong>
                        <p className="small-copy">
                          Current status: {statuses[candidate.id] ?? "awaiting sodacircle decision"}
                        </p>
                      </div>
                      <select
                        className="select"
                        value={statuses[candidate.id] ?? ""}
                        onChange={(event) =>
                          setCandidateStatus(candidate.id, event.target.value as CandidateStatus)
                        }
                      >
                        <option value="">Set outcome</option>
                        <option value="approved">approved</option>
                        <option value="saved">saved</option>
                        {outcomeOptions.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid-2">
                <div className="recipe-card stack">
                  <strong>Why this MVP is useful</strong>
                  <p className="small-copy">
                    It answers the four core questions on one screen: who to contact, why they fit, what to
                    say, and what happened next.
                  </p>
                </div>
                <div className="recipe-card stack">
                  <strong>Natural next steps</strong>
                  <p className="small-copy">
                    Replace mocks with Prisma models, persist uploads in Supabase storage, and run scoring,
                    outreach, and reply jobs in Inngest or Trigger.dev.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
