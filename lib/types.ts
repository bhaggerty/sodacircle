export type SearchCriteria = {
  roleTitle: string;
  compensationRange: string;
  geoPreference: string;
  mustHaves: string[];
  niceToHaves: string[];
  disqualifiers: string[];
  targetCompanies: string[];
  avoidBackgrounds: string[];
  hiringManagerNotes: string;
  searchRecipe: {
    function: string;
    segment: string;
    industry: string[];
    stageFit: string[];
    seniority: string;
    evidenceSignals: string[];
    exclusions: string[];
  };
};

// ── Ranking criteria (natural-language instructions that rank, don't filter) ──
export type RankingCriterion = {
  id: string;
  text: string;
  weight: "high" | "normal" | "low";
};

// ── Match quality tiers (Juicebox-style three-tier system) ────────────────────
export type MatchTier = "good-match" | "potential-fit" | "no-match";

// ── Criterion evidence (for "Why this match" panel) ───────────────────────────
export type CriterionMatchStatus = "matched" | "partial" | "not-found";
export type CriterionEvidence = {
  criterion: string;
  status: CriterionMatchStatus;
  evidence: string;
};

// ── Code quality (GitHub candidates) ─────────────────────────────────────────
export type CodeQualityBadge = "code-pass" | "poor-code" | "limited-signal";

export type CodeQuality = {
  badge: CodeQualityBadge;
  score: number;
  reason: string;
  topStars: number;
  ownRepoCount: number;
  signals: string[];
  concerns: string[];
};

// ── Candidate ─────────────────────────────────────────────────────────────────
export type Candidate = {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  email: string;
  linkedinUrl: string;
  summary: string;
  experience: string;
  notes?: string;
  sourceName?: "github" | "hn" | "web";
  codeQuality?: CodeQuality;
};

// ── Scored candidate ──────────────────────────────────────────────────────────
export type CandidateScore = {
  candidateId: string;
  ruleScore: number;
  llmScore: number;
  semanticScore: number;
  finalScore: number;
  matchTier: MatchTier;
  fitSummary: string;
  risks: string[];
  outreachAngle: string;
  recommendation: "prioritize" | "review" | "reject";
  matchedSignals: string[];
  criteriaEvidence: CriterionEvidence[];
};

export type RankedCandidate = Candidate & CandidateScore;

// ── Outreach sequences ────────────────────────────────────────────────────────
export type OutreachStep = {
  id: string;
  stepNumber: 1 | 2 | 3;
  delayDays: 0 | 3 | 7;
  subject: string;
  body: string;
  condition: "immediate" | "if-no-reply";
};

// ── Candidate status ──────────────────────────────────────────────────────────
export type CandidateStatus =
  | "new"
  | "approved"
  | "rejected"
  | "saved"
  | "interested"
  | "not interested"
  | "wrong fit"
  | "follow up later";

export type ReplyClass =
  | "interested"
  | "maybe later"
  | "not interested"
  | "refer me"
  | "comp mismatch"
  | "location mismatch"
  | "unsubscribe";

export type ReplyItem = {
  candidateId: string;
  candidateName: string;
  classification: ReplyClass;
  replyText: string;
  action: string;
};

// ── Saved searches ────────────────────────────────────────────────────────────
export type SavedSearch = {
  id: string;
  name: string;
  brief: string;
  criteria: SearchCriteria;
  savedAt: string;
};
