// file: lib/profiles/normalizeProfile.ts
//
// Enriches a raw IndexedProfile with domain tags, skill tags, inferred domain,
// and confidence score. Called on every profile before it hits DynamoDB.
// Pure functions — no I/O.

import { IndexedProfile } from "@/lib/crawler/store";

export interface EnrichedProfile extends IndexedProfile {
  domainTags: string[];       // e.g. ["identity", "security"]
  skillTags: string[];        // normalised skill list
  inferredDomain: string;     // single primary domain
  confidence: number;         // 0-1, data completeness + signal strength
  priorCompanies: string[];   // companies inferred from bio/experience
  lastEnrichedAt: string;
}

// ── Domain taxonomy ───────────────────────────────────────────────────────────

const DOMAIN_SIGNALS: Array<{ domain: string; signals: string[] }> = [
  {
    domain: "identity",
    signals: [
      "iam", "identity", "access management", "okta", "auth0", "azure ad",
      "active directory", "ping identity", "sailpoint", "saviynt", "cyberark",
      "saml", "oidc", "oauth", "scim", "ldap", "sso", "zero trust",
      "privileged access", "pam", "jit access", "entitlements", "rbac",
      "identity governance", "iga", "provisioning", "deprovisioning",
      "baton", "conductorone", "opal", "indent", "stytch",
    ],
  },
  {
    domain: "security",
    signals: [
      "security", "appsec", "devsecops", "soc", "siem", "threat",
      "vulnerability", "pentest", "penetration", "compliance", "soc2",
      "cryptography", "pki", "secrets", "vault", "infisical",
      "zero trust", "hardening", "audit", "authorization",
    ],
  },
  {
    domain: "platform",
    signals: [
      "platform engineering", "kubernetes", "k8s", "terraform", "pulumi",
      "helm", "docker", "devops", "sre", "site reliability",
      "ci/cd", "github actions", "infrastructure as code",
    ],
  },
  {
    domain: "cloud",
    signals: ["aws", "gcp", "google cloud", "azure", "cloud infrastructure", "serverless"],
  },
  {
    domain: "go",
    signals: ["golang", " go ", "go developer", "go engineer", "language:go"],
  },
  {
    domain: "rust",
    signals: ["rust", "rustlang", "systems programming"],
  },
  {
    domain: "distributed-systems",
    signals: [
      "distributed systems", "microservices", "grpc", "protobuf",
      "kafka", "nats", "event-driven", "consensus", "raft",
    ],
  },
  {
    domain: "data",
    signals: ["data engineering", "data platform", "spark", "flink", "etl", "pipeline"],
  },
];

// ── Skill normalisation map ───────────────────────────────────────────────────

const SKILL_ALIASES: Record<string, string> = {
  golang: "go", "node.js": "nodejs", "next.js": "nextjs",
  "react.js": "react", postgres: "postgresql", k8s: "kubernetes",
  "azure active directory": "azure ad", "active directory": "active directory",
  "openid connect": "oidc",
};

function normalizeSkill(s: string): string {
  const lower = s.toLowerCase().trim();
  return SKILL_ALIASES[lower] ?? lower;
}

// ── Domain detection ──────────────────────────────────────────────────────────

function detectDomains(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];

  for (const { domain, signals } of DOMAIN_SIGNALS) {
    if (signals.some((sig) => lower.includes(sig))) {
      found.push(domain);
    }
  }

  return [...new Set(found)];
}

function inferPrimaryDomain(domains: string[]): string {
  // Priority order — identity > security > platform > cloud > language
  const priority = ["identity", "security", "platform", "cloud", "distributed-systems", "go", "rust", "data"];
  for (const d of priority) {
    if (domains.includes(d)) return d;
  }
  return domains[0] ?? "engineering";
}

// ── Prior company extraction from bio ────────────────────────────────────────

const COMPANY_PATTERNS = [
  /(?:at|@|worked\s+at|formerly\s+at|ex[- ])\s*([A-Z][A-Za-z0-9.]+(?:\s+[A-Z][A-Za-z0-9.]+)?)/g,
  /([A-Z][A-Za-z0-9.]+)\s+(?:alum|alumni|alumnus)/gi,
];

// Well-known identity/security companies for exact matching
const KNOWN_COMPANIES = [
  "Okta", "Auth0", "SailPoint", "CyberArk", "Saviynt", "Ping Identity",
  "HashiCorp", "Teleport", "ConductorOne", "Opal", "Indent", "Beyond Identity",
  "Palo Alto Networks", "CrowdStrike", "Snyk", "Infisical", "Doppler",
  "Cloudflare", "Stripe", "GitHub", "GitLab", "Datadog", "Twilio",
];

function extractPriorCompanies(bio: string, company: string): string[] {
  const found = new Set<string>();
  const text = bio + " " + company;

  // Exact match known companies
  for (const co of KNOWN_COMPANIES) {
    if (text.toLowerCase().includes(co.toLowerCase())) found.add(co);
  }

  // Regex extraction
  for (const re of COMPANY_PATTERNS) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const name = m[1].trim();
      if (name.length > 2 && name.length < 40) found.add(name);
    }
  }

  // Remove the current company
  found.delete(company);
  return [...found].slice(0, 8);
}

// ── Confidence scoring ────────────────────────────────────────────────────────

function computeConfidence(p: IndexedProfile, domainTags: string[]): number {
  let score = 0;

  if (p.name)       score += 0.15;
  if (p.title)      score += 0.15;
  if (p.company)    score += 0.10;
  if (p.bio?.length > 20) score += 0.15;
  if (p.githubUrl)  score += 0.15;
  if (p.email)      score += 0.10;
  if (p.skills?.length > 2) score += 0.10;
  if (domainTags.length > 0) score += 0.10;

  return Math.round(score * 100) / 100;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function normalizeProfile(raw: IndexedProfile): EnrichedProfile {
  const textForAnalysis = [raw.bio, raw.title, raw.company, ...(raw.skills ?? [])].join(" ");

  const domainTags    = detectDomains(textForAnalysis);
  const skillTags     = (raw.skills ?? []).map(normalizeSkill).filter(Boolean);
  const inferredDomain = inferPrimaryDomain(domainTags);
  const confidence    = computeConfidence(raw, domainTags);
  const priorCompanies = extractPriorCompanies(raw.bio ?? "", raw.company ?? "");

  return {
    ...raw,
    domainTags,
    skillTags,
    inferredDomain,
    confidence,
    priorCompanies,
    lastEnrichedAt: new Date().toISOString(),
  };
}
