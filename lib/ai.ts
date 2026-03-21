import {
  Candidate, CandidateScore, CriterionEvidence, CriterionMatchStatus,
  MatchTier, OutreachStep, RankedCandidate, RankingCriterion, SearchCriteria,
} from "@/lib/types";

const tokenize = (input: string) =>
  input
    .toLowerCase()
    .split(/[^a-z0-9+#.$]+/)
    .filter((t) => t.length >= 2);

// Generic keyword match: checks if any meaningful token from `phrase` appears in `haystack`
function phraseMatch(haystack: string, phrase: string): boolean {
  const tokens = tokenize(phrase).filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.some((t) => haystack.includes(t));
}

// Partial match: some but not all tokens match
function phraseMatchPartial(haystack: string, phrase: string): CriterionMatchStatus {
  const tokens = tokenize(phrase).filter((t) => t.length >= 3);
  if (tokens.length === 0) return "not-found";
  const matched = tokens.filter((t) => haystack.includes(t));
  if (matched.length === 0) return "not-found";
  if (matched.length === tokens.length) return "matched";
  return "partial";
}

// Extract a short evidence snippet where the match occurred
function extractEvidence(combined: string, phrase: string): string {
  const tokens = tokenize(phrase).filter((t) => t.length >= 3);
  for (const token of tokens) {
    const idx = combined.indexOf(token);
    if (idx === -1) continue;
    const start = Math.max(0, idx - 40);
    const end = Math.min(combined.length, idx + token.length + 60);
    const snippet = combined.slice(start, end).replace(/\s+/g, " ").trim();
    return snippet.length > 10 ? `"…${snippet}…"` : "";
  }
  return "";
}

export function parseBriefToCriteria(brief: string, seed: SearchCriteria): SearchCriteria {
  const lower = brief.toLowerCase();
  const industry: string[] = [];

  if (lower.includes("identity") || lower.includes("iam")) industry.push("Identity");
  if (lower.includes("cyber") || lower.includes("security")) industry.push("Cybersecurity");
  if (lower.includes("infrastructure") || lower.includes("infra")) industry.push("Infrastructure");
  if (lower.includes("saas")) industry.push("SaaS");
  if (lower.includes("fintech") || lower.includes("finance")) industry.push("Fintech");
  if (lower.includes("health") || lower.includes("medical")) industry.push("Healthcare");

  return {
    ...seed,
    roleTitle: seed.roleTitle,
    geoPreference: lower.includes("west coast")
      ? "Remote (US) with West Coast preference"
      : lower.includes("remote")
      ? "Remote"
      : seed.geoPreference,
    searchRecipe: {
      ...seed.searchRecipe,
      industry: industry.length ? industry : seed.searchRecipe.industry,
    },
  };
}

export function rankCandidates(
  candidates: Candidate[],
  criteria: SearchCriteria,
  rankingCriteria: RankingCriterion[] = []
): RankedCandidate[] {
  const roleContext = [
    criteria.roleTitle,
    ...criteria.mustHaves,
    ...criteria.niceToHaves,
    ...criteria.searchRecipe.industry,
    ...criteria.searchRecipe.evidenceSignals,
    ...rankingCriteria.map((rc) => rc.text),
  ].join(" ").toLowerCase();

  const targetCompaniesLower = criteria.targetCompanies.map((c) => c.toLowerCase());
  const avoidLower = criteria.avoidBackgrounds.map((a) => a.toLowerCase());
  const disqualifiersLower = criteria.disqualifiers.map((d) => d.toLowerCase());

  return candidates
    .map((candidate): RankedCandidate => {
      const combined = [
        candidate.title,
        candidate.company,
        candidate.location,
        candidate.summary,
        candidate.experience,
        candidate.notes ?? "",
      ].join(" ").toLowerCase();

      let score = 40;
      const matchedSignals: string[] = [];
      const risks: string[] = [];
      const criteriaEvidence: CriterionEvidence[] = [];

      // ── Must-haves ────────────────────────────────────────────────
      let mustHits = 0;
      for (const mh of criteria.mustHaves) {
        const status = phraseMatchPartial(combined, mh);
        const evidence = status !== "not-found" ? extractEvidence(combined, mh) : "";
        criteriaEvidence.push({ criterion: mh, status, evidence });

        if (status === "matched") {
          score += 12;
          matchedSignals.push(mh);
          if (++mustHits >= 3) break;
        } else if (status === "partial") {
          score += 5;
        }
      }
      if (criteria.mustHaves.length > 0 && mustHits === 0) {
        score -= 15;
        risks.push("No clear match on must-have criteria");
      }

      // ── Nice-to-haves ─────────────────────────────────────────────
      let niceHits = 0;
      for (const nth of criteria.niceToHaves) {
        const status = phraseMatchPartial(combined, nth);
        criteriaEvidence.push({
          criterion: nth,
          status,
          evidence: status !== "not-found" ? extractEvidence(combined, nth) : "",
        });
        if (status === "matched") { score += 6; if (++niceHits >= 3) break; }
      }

      // ── Ranking criteria (natural-language, weighted) ─────────────
      for (const rc of rankingCriteria) {
        const status = phraseMatchPartial(combined, rc.text);
        criteriaEvidence.push({
          criterion: rc.text,
          status,
          evidence: status !== "not-found" ? extractEvidence(combined, rc.text) : "",
        });
        if (status === "matched") {
          const bonus = rc.weight === "high" ? 12 : rc.weight === "normal" ? 7 : 3;
          score += bonus;
          matchedSignals.push(rc.text);
        } else if (status === "partial") {
          const partialBonus = rc.weight === "high" ? 5 : 2;
          score += partialBonus;
        }
      }

      // ── Industry / search recipe ──────────────────────────────────
      if (criteria.searchRecipe.industry.some((ind) => phraseMatch(combined, ind))) {
        score += 8;
        matchedSignals.push("Relevant industry background");
      }

      // ── Evidence signals ──────────────────────────────────────────
      let sigHits = 0;
      for (const sig of criteria.searchRecipe.evidenceSignals) {
        if (phraseMatch(combined, sig)) {
          score += 5;
          matchedSignals.push(sig);
          if (++sigHits >= 2) break;
        }
      }

      // ── Target companies ──────────────────────────────────────────
      if (targetCompaniesLower.some((tc) => combined.includes(tc))) {
        score += 10;
        matchedSignals.push(`From a target company (${candidate.company})`);
      }

      // ── Disqualifiers ─────────────────────────────────────────────
      for (const dq of disqualifiersLower) {
        if (phraseMatch(combined, dq)) {
          score -= 20;
          risks.push(`Matches disqualifier: ${dq}`);
        }
      }

      // ── Avoid backgrounds ─────────────────────────────────────────
      for (const av of avoidLower) {
        if (phraseMatch(combined, av)) {
          score -= 15;
          risks.push("Background overlaps with avoid criteria");
        }
      }

      // ── Code quality ──────────────────────────────────────────────
      if (candidate.codeQuality) {
        const cq = candidate.codeQuality;
        if (cq.badge === "code-pass") {
          score += 12;
          matchedSignals.push(`Code Pass${cq.topStars > 0 ? ` ★${cq.topStars}` : ""}`);
        } else if (cq.badge === "poor-code") {
          score -= 15;
          risks.push(`Poor code quality: ${cq.reason}`);
        }
      }

      // ── Location fit ──────────────────────────────────────────────
      const geo = criteria.geoPreference.toLowerCase();
      const locTokens = tokenize(geo).filter((t) => t.length > 2 && !["remote", "only", "with", "preference"].includes(t));
      if (locTokens.length > 0 && locTokens.some((t) => combined.includes(t))) {
        score += 5;
      }

      // ── Semantic overlap ──────────────────────────────────────────
      const roleTokens = new Set(tokenize(roleContext));
      const combTokens = tokenize(combined);
      const overlap = combTokens.filter((t) => roleTokens.has(t)).length;
      const semanticScore = roleTokens.size > 0
        ? Math.min(100, Math.round((overlap / roleTokens.size) * 200))
        : 0;

      const finalScore = Math.max(0, Math.min(100,
        Math.round(score * 0.65 + semanticScore * 0.35)
      ));

      const matchTier: MatchTier =
        finalScore >= 75 ? "good-match" :
        finalScore >= 50 ? "potential-fit" :
        "no-match";

      const recommendation: CandidateScore["recommendation"] =
        matchTier === "good-match" ? "prioritize" :
        matchTier === "potential-fit" ? "review" :
        "reject";

      const fitSummary =
        matchedSignals.length > 0
          ? `Matches ${matchedSignals.length} criteria: ${matchedSignals.slice(0, 2).join("; ")}.`
          : matchTier === "potential-fit"
          ? "Partial overlap — may be worth a closer look."
          : "Limited signal against the current search criteria.";

      const outreachAngle = targetCompaniesLower.some((tc) => combined.includes(tc))
        ? `Reference their background at ${candidate.company} and connect it to this opportunity.`
        : matchedSignals.length > 0
        ? `Lead with ${matchedSignals[0].replace(/Code Pass.*/, "their strong technical track record")} and how it connects to what you're building.`
        : `Lead with the role's scope and connect it to their experience at ${candidate.company || "their current role"}.`;

      return {
        ...candidate,
        candidateId: candidate.id,
        ruleScore: score,
        llmScore: finalScore,
        semanticScore,
        finalScore,
        matchTier,
        fitSummary,
        risks,
        outreachAngle,
        recommendation,
        matchedSignals,
        criteriaEvidence,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}

// ── Outreach sequence generation ──────────────────────────────────────────────

export function draftOutreachSequence(
  candidate: RankedCandidate,
  criteria: SearchCriteria
): OutreachStep[] {
  const firstName = candidate.name.split(" ")[0];
  const roleLabel = criteria.roleTitle || "this role";
  const signal = candidate.matchedSignals
    .filter((s) => !s.startsWith("Code Pass") && !s.startsWith("From a target"))
    .slice(0, 1)[0] ?? candidate.title;
  const mustHaveList = criteria.mustHaves.slice(0, 2).map((m) => `- ${m}`).join("\n");
  const compLine = criteria.compensationRange ? `- Comp: ${criteria.compensationRange}` : "";
  const geoLine = criteria.geoPreference ? `- Location: ${criteria.geoPreference}` : "";

  const step1Body = `Hi ${firstName},

I came across your profile and wanted to reach out about a ${roleLabel} opportunity — it seemed like a strong fit based on your background.

What caught my eye: ${signal}. ${candidate.outreachAngle}

A few details on the role:
${mustHaveList}
${compLine}
${geoLine}

If the timing is right, I'd love to share more — team context, the problem they're solving, and why this one stands out.

Best,`;

  const step2Body = `Hi ${firstName},

Just wanted to bump this in case it got buried — still think this ${roleLabel} could be a strong fit given your background.

Happy to share more details or just hop on a quick call if that's easier. No pressure either way.

Best,`;

  const step3Body = `Hi ${firstName},

Last note from me on the ${roleLabel} role — didn't want to keep pinging if the timing isn't right.

If things change or you're ever open to a conversation, feel free to reach out. Would love to connect.

Take care,`;

  const subjectBase = `${candidate.name} — ${roleLabel} opportunity`;

  return [
    {
      id: `step-1-${candidate.id}`,
      stepNumber: 1,
      delayDays: 0,
      condition: "immediate",
      subject: subjectBase,
      body: step1Body,
    },
    {
      id: `step-2-${candidate.id}`,
      stepNumber: 2,
      delayDays: 3,
      condition: "if-no-reply",
      subject: `Re: ${subjectBase}`,
      body: step2Body,
    },
    {
      id: `step-3-${candidate.id}`,
      stepNumber: 3,
      delayDays: 7,
      condition: "if-no-reply",
      subject: `Re: ${subjectBase}`,
      body: step3Body,
    },
  ];
}

// Keep backward compat shim
export function draftOutreach(candidate: RankedCandidate, criteria: SearchCriteria) {
  const steps = draftOutreachSequence(candidate, criteria);
  return { subject: steps[0].subject, body: steps[0].body };
}
