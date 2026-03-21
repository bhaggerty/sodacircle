import { Candidate, CandidateScore, RankedCandidate, SearchCriteria } from "@/lib/types";

const tokenize = (input: string) =>
  input
    .toLowerCase()
    .split(/[^a-z0-9+#.$]+/)
    .filter((t) => t.length >= 2);

const hasAny = (haystack: string, needles: string[]) =>
  needles.some((needle) => haystack.toLowerCase().includes(needle.toLowerCase()));

// Generic keyword match: checks if any token from `phrase` appears in `haystack`
function phraseMatch(haystack: string, phrase: string): boolean {
  const tokens = tokenize(phrase).filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.some((t) => haystack.includes(t));
}

export function parseBriefToCriteria(brief: string, seed: SearchCriteria): SearchCriteria {
  // This is a thin regex fallback — the real extraction happens server-side via /api/criteria
  const lower = brief.toLowerCase();
  const industry: string[] = [];

  if (lower.includes("identity") || lower.includes("iam")) industry.push("Identity");
  if (lower.includes("cyber") || lower.includes("security")) industry.push("Cybersecurity");
  if (lower.includes("infrastructure") || lower.includes("infra")) industry.push("Infrastructure");
  if (lower.includes("saas")) industry.push("SaaS");
  if (lower.includes("fintech") || lower.includes("finance")) industry.push("Fintech");
  if (lower.includes("health") || lower.includes("medical")) industry.push("Healthcare");

  // Extract role title from first few words
  const roleMatch = brief.match(/\b(senior|lead|staff|principal|junior)?\s*(engineer|developer|designer|manager|director|vp|cto|ceo|analyst|scientist|architect|executive|account executive)\b/i);

  return {
    ...seed,
    roleTitle: roleMatch ? brief.split("\n")[0].slice(0, 60).trim() : seed.roleTitle,
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
  criteria: SearchCriteria
): RankedCandidate[] {
  const roleContext = [
    criteria.roleTitle,
    ...criteria.mustHaves,
    ...criteria.niceToHaves,
    ...criteria.searchRecipe.industry,
    ...criteria.searchRecipe.evidenceSignals,
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

      let score = 40; // base
      const matchedSignals: string[] = [];
      const risks: string[] = [];

      // Must-haves: +12 each (capped at 3)
      let mustHits = 0;
      for (const mh of criteria.mustHaves) {
        if (phraseMatch(combined, mh)) {
          score += 12;
          matchedSignals.push(mh);
          if (++mustHits >= 3) break;
        }
      }
      if (criteria.mustHaves.length > 0 && mustHits === 0) {
        score -= 15;
        risks.push("No clear match on must-have criteria");
      }

      // Nice-to-haves: +6 each (capped at 3)
      let niceHits = 0;
      for (const nth of criteria.niceToHaves) {
        if (phraseMatch(combined, nth)) {
          score += 6;
          if (++niceHits >= 3) break;
        }
      }

      // Industry / searchRecipe keywords: +8 if any match
      if (criteria.searchRecipe.industry.some((ind) => phraseMatch(combined, ind))) {
        score += 8;
        matchedSignals.push("Relevant industry background");
      }

      // Evidence signals: +5 each (capped at 2)
      let sigHits = 0;
      for (const sig of criteria.searchRecipe.evidenceSignals) {
        if (phraseMatch(combined, sig)) {
          score += 5;
          matchedSignals.push(sig);
          if (++sigHits >= 2) break;
        }
      }

      // Target companies: +10
      if (targetCompaniesLower.some((tc) => combined.includes(tc))) {
        score += 10;
        matchedSignals.push(`From a target company (${candidate.company})`);
      }

      // Disqualifiers: -20 each
      for (const dq of disqualifiersLower) {
        if (phraseMatch(combined, dq)) {
          score -= 20;
          risks.push(`Matches disqualifier: ${dq}`);
        }
      }

      // Avoid backgrounds: -15 each
      for (const av of avoidLower) {
        if (phraseMatch(combined, av)) {
          score -= 15;
          risks.push("Background overlaps with avoid criteria");
        }
      }

      // Location fit: +5 if matches, no penalty for unknown
      const geo = criteria.geoPreference.toLowerCase();
      const locTokens = tokenize(geo).filter((t) => t.length > 2 && !["remote", "only", "with", "preference"].includes(t));
      if (locTokens.length > 0 && locTokens.some((t) => combined.includes(t))) {
        score += 5;
      }

      // Semantic overlap (0-100 scale)
      const roleTokens = new Set(tokenize(roleContext));
      const combTokens = tokenize(combined);
      const matches = combTokens.filter((t) => roleTokens.has(t)).length;
      const semanticScore = roleTokens.size > 0
        ? Math.min(100, Math.round((matches / roleTokens.size) * 200))
        : 0;

      const finalScore = Math.max(0, Math.min(100,
        Math.round(score * 0.65 + semanticScore * 0.35)
      ));

      const recommendation: CandidateScore["recommendation"] =
        finalScore >= 75 ? "prioritize" : finalScore >= 50 ? "review" : "reject";

      const fitSummary =
        matchedSignals.length > 0
          ? `Matches ${matchedSignals.length} criteria signal${matchedSignals.length > 1 ? "s" : ""}: ${matchedSignals.slice(0, 2).join("; ")}.`
          : recommendation === "review"
          ? `Partial overlap with the search criteria — worth a closer look.`
          : `Limited signal match against the current search criteria.`;

      const outreachAngle = targetCompaniesLower.some((tc) => combined.includes(tc))
        ? `Reference their background at ${candidate.company} and connect it to this opportunity.`
        : matchedSignals.length > 0
        ? `Lead with ${matchedSignals[0]} and how it connects to what you're building.`
        : `Lead with the role's scope and connect it to their experience at ${candidate.company || "their current role"}.`;

      return {
        ...candidate,
        candidateId: candidate.id,
        ruleScore: score,
        llmScore: finalScore,
        semanticScore,
        finalScore,
        fitSummary,
        risks,
        outreachAngle,
        recommendation,
        matchedSignals,
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}

export function draftOutreach(candidate: RankedCandidate, criteria: SearchCriteria) {
  const firstName = candidate.name.split(" ")[0];
  const roleLabel = criteria.roleTitle || "this role";
  const signal = candidate.matchedSignals[0] ?? candidate.title;
  const angle = candidate.outreachAngle;

  return {
    subject: `${candidate.name} — ${roleLabel} opportunity`,
    body: `Hi ${firstName},

I came across your profile and wanted to reach out about a ${roleLabel} opportunity that seemed like a strong fit.

What caught my eye: ${signal}. ${angle}

A few details on the role:
- ${criteria.mustHaves.slice(0, 2).map((m) => m).join("\n- ")}
${criteria.compensationRange ? `- Comp range: ${criteria.compensationRange}` : ""}
${criteria.geoPreference ? `- Location: ${criteria.geoPreference}` : ""}

If the timing is right, I'd love to share more — team, context, and why this one stands out.

Best,
sodacircle`,
  };
}
