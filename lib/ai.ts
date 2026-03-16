import { Candidate, CandidateScore, RankedCandidate, SearchCriteria } from "@/lib/types";

const tokenize = (input: string) =>
  input
    .toLowerCase()
    .split(/[^a-z0-9+$]+/)
    .filter(Boolean);

const overlapScore = (a: string, b: string) => {
  const aTerms = new Set(tokenize(a));
  const bTerms = tokenize(b);
  if (!aTerms.size || !bTerms.length) {
    return 0;
  }

  const shared = bTerms.filter((term) => aTerms.has(term)).length;
  return Math.min(100, Math.round((shared / bTerms.length) * 100));
};

const hasAny = (haystack: string, needles: string[]) =>
  needles.some((needle) => haystack.toLowerCase().includes(needle.toLowerCase()));

export function parseBriefToCriteria(brief: string, seed: SearchCriteria): SearchCriteria {
  const lowerBrief = brief.toLowerCase();
  const industry = [
    lowerBrief.includes("identity") ? "Identity" : null,
    lowerBrief.includes("cyber") || lowerBrief.includes("security") ? "Cybersecurity" : null,
    lowerBrief.includes("infrastructure") ? "SaaS infrastructure" : null
  ].filter(Boolean) as string[];

  const mustHaves = [...seed.mustHaves];
  if (lowerBrief.includes("startup")) {
    mustHaves.push("Startup-ready operating style");
  }
  if (lowerBrief.includes("remote")) {
    mustHaves.push("Can work remote-first");
  }

  return {
    ...seed,
    roleTitle: lowerBrief.includes("ae") ? "Enterprise Account Executive" : seed.roleTitle,
    geoPreference: lowerBrief.includes("west coast")
      ? "Remote (US) with West Coast preference"
      : seed.geoPreference,
    mustHaves: Array.from(new Set(mustHaves)),
    searchRecipe: {
      ...seed.searchRecipe,
      industry: industry.length ? industry : seed.searchRecipe.industry,
      evidenceSignals: Array.from(
        new Set([
          ...seed.searchRecipe.evidenceSignals,
          lowerBrief.includes("6-figure") ? "Closed $100k+ ACV deals" : ""
        ].filter(Boolean))
      )
    }
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
    ...criteria.searchRecipe.evidenceSignals
  ].join(" ");

  return candidates
    .map((candidate): RankedCandidate => {
      const combined = `${candidate.title} ${candidate.company} ${candidate.location} ${candidate.summary} ${candidate.experience} ${candidate.notes ?? ""}`;
      let ruleScore = 42;
      const matchedSignals: string[] = [];
      const risks: string[] = [];

      if (hasAny(combined, criteria.searchRecipe.industry)) {
        ruleScore += 20;
        matchedSignals.push("Relevant security or identity background");
      } else {
        risks.push("Limited direct security adjacency");
      }

      if (/\benterprise\b/i.test(combined)) {
        ruleScore += 15;
        matchedSignals.push("Enterprise selling motion");
      } else if (/\bmid-market|smb|commercial\b/i.test(combined)) {
        ruleScore -= 15;
        risks.push("Primary motion skews SMB or mid-market");
      }

      if (/\$100k|six-figure|seven-figure|strategic accounts/i.test(combined)) {
        ruleScore += 12;
        matchedSignals.push("Evidence of large deal experience");
      } else {
        risks.push("Large ACV evidence is thin");
      }

      if (/\bstartup|series [abc]|zero-to-one|builder\b/i.test(combined)) {
        ruleScore += 10;
        matchedSignals.push("Looks comfortable in startup or build-mode settings");
      }

      if (hasAny(candidate.company, criteria.targetCompanies)) {
        ruleScore += 8;
        matchedSignals.push("Comes from a sodacircle priority company");
      }

      if (hasAny(combined, criteria.avoidBackgrounds) || /\btelecom\b/i.test(combined)) {
        ruleScore -= 20;
        risks.push("Background overlaps with avoid criteria");
      }

      if (!candidate.location.toLowerCase().includes("remote") && !/(ca|wa|west)/i.test(candidate.location)) {
        ruleScore -= 10;
        risks.push("Location may not match current search bias");
      }

      const semanticScore = overlapScore(roleContext, combined);
      const llmScore = Math.max(
        20,
        Math.min(96, Math.round(ruleScore * 0.72 + semanticScore * 0.48 + matchedSignals.length * 4))
      );
      const finalScore = Math.max(
        0,
        Math.min(100, Math.round(ruleScore * 0.4 + llmScore * 0.4 + semanticScore * 0.2))
      );

      const recommendation: CandidateScore["recommendation"] =
        finalScore >= 80 ? "prioritize" : finalScore >= 60 ? "review" : "reject";

      const fitSummary =
        recommendation === "prioritize"
          ? `${candidate.name} aligns strongly on enterprise selling, security relevance, and likely startup transition readiness.`
          : recommendation === "review"
            ? `${candidate.name} has partial signal overlap and may work if the sodacircle team wants a slightly broader profile.`
            : `${candidate.name} misses enough of the must-have pattern that they should likely be deprioritized.`;

      const outreachAngle = hasAny(candidate.company, criteria.targetCompanies)
        ? `Reference ${candidate.company} credibility, then position the role as a chance to shape a more builder-led enterprise motion.`
        : `Lead with the company narrative and connect their background to the security story plus the chance to own greenfield enterprise growth.`;

      return {
        ...candidate,
        candidateId: candidate.id,
        ruleScore,
        llmScore,
        semanticScore,
        finalScore,
        fitSummary,
        risks,
        outreachAngle,
        recommendation,
        matchedSignals
      };
    })
    .sort((a, b) => b.finalScore - a.finalScore);
}

export function draftOutreach(candidate: RankedCandidate, criteria: SearchCriteria) {
  return {
    subject: `${candidate.name}, a high-context enterprise role in ${criteria.searchRecipe.industry[0] ?? "security"}`,
    body: `Hi ${candidate.name.split(" ")[0]},

I'm reaching out about an ${criteria.roleTitle} opening that maps closely to your work at ${candidate.company}. We're looking for someone who can carry complex enterprise cycles, translate a strong security narrative, and help shape the next phase of go-to-market rather than just inherit a mature patch.

What stood out:
- ${candidate.matchedSignals[0] ?? "You have clear enterprise selling signal"}
- ${candidate.matchedSignals[1] ?? "Your background suggests strong buyer credibility"}
- ${candidate.outreachAngle}

If the timing is right, I'd love to share the team, market story, and why this role matters now.

Best,
sodacircle`
  };
}
