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
};

export type CandidateScore = {
  candidateId: string;
  ruleScore: number;
  llmScore: number;
  semanticScore: number;
  finalScore: number;
  fitSummary: string;
  risks: string[];
  outreachAngle: string;
  recommendation: "prioritize" | "review" | "reject";
  matchedSignals: string[];
};

export type RankedCandidate = Candidate & CandidateScore;

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
