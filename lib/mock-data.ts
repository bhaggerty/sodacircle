import { Candidate, ReplyItem, SearchCriteria } from "@/lib/types";

export const defaultBrief = `Need an enterprise AE in cyber, startup-ready, has closed 6-figure deals, ideally identity or adjacent. Prefer west coast or remote, avoid pure SMB backgrounds.`;

export const defaultCriteria: SearchCriteria = {
  roleTitle: "Enterprise Account Executive",
  compensationRange: "$180k - $260k OTE",
  geoPreference: "Remote (US) with West Coast preference",
  mustHaves: [
    "Enterprise quota-carrying sales",
    "Cybersecurity or identity adjacency",
    "Evidence of $100k+ ACV deals"
  ],
  niceToHaves: [
    "Seed to Series C stage comfort",
    "Builder mentality",
    "Security platform storytelling"
  ],
  disqualifiers: ["Only SMB background", "No closing history", "Frequent sub-1 year tenures"],
  targetCompanies: ["Okta", "CrowdStrike", "Palo Alto Networks", "Zscaler"],
  avoidBackgrounds: ["Pure telecom", "Channel-only roles"],
  hiringManagerNotes:
    "Need someone who can land marquee logos and help shape a repeatable enterprise motion.",
  searchRecipe: {
    function: "Sales",
    segment: "Enterprise",
    industry: ["Cybersecurity", "Identity", "SaaS infrastructure"],
    stageFit: ["Startup", "Growth"],
    seniority: "Mid-senior",
    evidenceSignals: [
      "Enterprise quota ownership",
      "Closed $100k+ ACV deals",
      "Security adjacency",
      "Multi-threaded exec selling"
    ],
    exclusions: ["SMB-only background", "No closing history", "Wrong geography"]
  }
};

export const sampleCandidates: Candidate[] = [
  {
    id: "cand-1",
    name: "Jane Doe",
    title: "Senior Account Executive",
    company: "Okta",
    location: "San Francisco, CA",
    email: "jane.doe@example.com",
    linkedinUrl: "https://linkedin.com/in/janedoe",
    summary:
      "Identity-focused enterprise AE with 6 years closing seven-figure security deals across Fortune 1000 accounts.",
    experience:
      "Okta (4y), Segment (2y), SMB seller turned enterprise specialist with strong CISO relationships.",
    notes: "Led expansion within regulated verticals."
  },
  {
    id: "cand-2",
    name: "Marcus Lee",
    title: "Enterprise Account Executive",
    company: "CrowdStrike",
    location: "Seattle, WA",
    email: "marcus.lee@example.com",
    linkedinUrl: "https://linkedin.com/in/marcuslee",
    summary:
      "Enterprise cybersecurity seller covering cloud and endpoint, strong track record with six-figure ACV and startup advisory work.",
    experience:
      "CrowdStrike (3y), Lacework (2y), early-stage advisor and former SDR manager."
  },
  {
    id: "cand-3",
    name: "Avery Patel",
    title: "Mid-Market Account Executive",
    company: "Twilio",
    location: "Denver, CO",
    email: "avery.patel@example.com",
    linkedinUrl: "https://linkedin.com/in/averypatel",
    summary:
      "API infrastructure seller with strong technical fluency, mostly mid-market and commercial success.",
    experience:
      "Twilio (2y), SendGrid (2y), primary motion focused on SMB to mid-market accounts."
  },
  {
    id: "cand-4",
    name: "Priya Raman",
    title: "Regional Vice President",
    company: "Palo Alto Networks",
    location: "Remote, US",
    email: "priya.raman@example.com",
    linkedinUrl: "https://linkedin.com/in/priyaraman",
    summary:
      "Security sales leader with prior enterprise AE tenure, deep identity and cloud security network, and zero-to-one GTM mentorship.",
    experience:
      "Palo Alto Networks (5y), Duo Security (3y), led large strategic accounts and mentored startup teams."
  },
  {
    id: "cand-5",
    name: "Noah Kim",
    title: "Account Executive",
    company: "Comcast Business",
    location: "Chicago, IL",
    email: "noah.kim@example.com",
    linkedinUrl: "https://linkedin.com/in/noahkim",
    summary:
      "Consistent quota attainment in telecom and connectivity sales with high activity volume.",
    experience:
      "Comcast Business (4y), mostly SMB and lower mid-market motion, limited security exposure."
  }
];

export const sampleReplies: ReplyItem[] = [
  {
    candidateId: "cand-1",
    candidateName: "Jane Doe",
    classification: "interested",
    replyText: "This sounds interesting. Happy to learn more next week.",
    action: "Alert the sodacircle team in Slack and draft an Ashby candidate record."
  },
  {
    candidateId: "cand-2",
    candidateName: "Marcus Lee",
    classification: "maybe later",
    replyText: "Timing is tight this quarter, but circle back in 60 days.",
    action: "Snooze and re-queue for follow-up in 60 days."
  },
  {
    candidateId: "cand-5",
    candidateName: "Noah Kim",
    classification: "not interested",
    replyText: "Appreciate it, but this isn't aligned with my next move.",
    action: "Archive and tag with low security relevance."
  }
];
