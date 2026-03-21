// file: lib/search/parseQuery.ts
//
// Step 1 of the search pipeline.
// Turns a raw recruiter query into a structured ParsedQuery with expanded concept terms.

import { SearchCriteria } from "@/lib/types";

export interface ParsedQuery {
  raw: string;
  roleTitle: string;
  mustHaves: string[];
  niceToHaves: string[];
  targetCompanies: string[];
  geoPreference: string;
  domainTags: string[];       // high-level domains: identity, security, platform, etc.
  expandedTerms: string[];    // all terms including concept-expanded synonyms
  seniority: "junior" | "mid" | "senior" | "staff" | "principal" | "executive" | "";
}

// ── Domain → synonym expansion map ───────────────────────────────────────────
// When a query mentions a domain concept, we expand to all known aliases.
// This is the highest-leverage single change: "identity" → 20 real search terms.

const DOMAIN_EXPANSIONS: Record<string, string[]> = {
  // Identity & Access Management
  identity: [
    "iam", "identity", "access management", "identity governance", "iga",
    "okta", "auth0", "azure ad", "active directory", "ping identity",
    "sailpoint", "saviynt", "cyberark", "beyond identity", "opal",
    "saml", "oidc", "oauth", "scim", "ldap", "sso",
    "zero trust", "privileged access", "pam", "jit access",
    "entitlements", "rbac", "abac", "provisioning", "deprovisioning",
  ],
  iam: [
    "iam", "identity", "access management", "okta", "saml", "oidc",
    "oauth", "scim", "sso", "zero trust", "rbac",
  ],
  "zero trust": [
    "zero trust", "ztna", "beyond corp", "identity-first security",
    "least privilege", "microsegmentation",
  ],
  security: [
    "security", "appsec", "application security", "devsecops",
    "soc", "siem", "threat detection", "vulnerability", "pentest",
    "compliance", "soc2", "iso27001", "cryptography", "pki",
    "secrets management", "vault", "infisical",
  ],
  platform: [
    "platform engineering", "infrastructure", "kubernetes", "k8s",
    "docker", "terraform", "pulumi", "helm", "aws", "gcp", "azure",
    "devops", "sre", "site reliability", "ci/cd", "github actions",
  ],
  infrastructure: [
    "infrastructure", "platform engineering", "kubernetes", "terraform",
    "aws", "gcp", "azure", "docker", "sre", "devops",
  ],
  golang: ["go", "golang"],
  go: ["go", "golang"],
  rust: ["rust", "systems programming"],
  distributed: [
    "distributed systems", "microservices", "grpc", "protobuf",
    "kafka", "nats", "event-driven", "consensus", "raft", "paxos",
  ],
  connector: [
    "connector", "integration", "baton", "scim", "provisioning",
    "sync", "api integration", "webhook",
  ],
};

// ── Seniority detection ───────────────────────────────────────────────────────

const SENIORITY_PATTERNS: Array<[RegExp, ParsedQuery["seniority"]]> = [
  [/\b(staff|l5|level\s?5)\b/i,              "staff"],
  [/\b(principal|l6|level\s?6|distinguished)\b/i, "principal"],
  [/\b(cto|vp\s+eng|director of eng|head of eng)\b/i, "executive"],
  [/\b(senior|sr\.?|lead)\b/i,               "senior"],
  [/\b(mid[- ]?level|mid)\b/i,               "mid"],
  [/\b(junior|jr\.?|entry)\b/i,              "junior"],
];

function detectSeniority(text: string): ParsedQuery["seniority"] {
  for (const [re, level] of SENIORITY_PATTERNS) {
    if (re.test(text)) return level;
  }
  return "";
}

// ── Role title extraction (simple heuristics) ─────────────────────────────────

const ROLE_PATTERNS = [
  /\b(software|backend|frontend|full[- ]?stack|platform|infrastructure|security|identity|staff|principal|senior|lead|founding)\s+engineer\b/i,
  /\b(engineering\s+manager|em)\b/i,
  /\b(cto|vp\s+(?:of\s+)?engineering|director\s+of\s+engineering|head\s+of\s+engineering)\b/i,
  /\b(devops|sre|site\s+reliability)\s+engineer\b/i,
];

function extractRoleTitle(text: string): string {
  for (const re of ROLE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return "";
}

// ── Main parse function (no Claude — pure heuristic for speed) ────────────────

export function parseQueryLocal(raw: string): ParsedQuery {
  const lower = raw.toLowerCase();
  const words = lower.split(/\s+/);

  const domainTags: string[] = [];
  const expandedTerms: string[] = [];

  // Detect domains and expand
  for (const [concept, synonyms] of Object.entries(DOMAIN_EXPANSIONS)) {
    if (lower.includes(concept)) {
      const domain = normalizeDomainTag(concept);
      if (!domainTags.includes(domain)) domainTags.push(domain);
      for (const s of synonyms) {
        if (!expandedTerms.includes(s)) expandedTerms.push(s);
      }
    }
  }

  // Always include the raw words themselves
  for (const w of words) {
    if (w.length >= 3 && !expandedTerms.includes(w)) expandedTerms.push(w);
  }

  return {
    raw,
    roleTitle: extractRoleTitle(raw),
    mustHaves: [],
    niceToHaves: [],
    targetCompanies: [],
    geoPreference: "",
    domainTags,
    expandedTerms,
    seniority: detectSeniority(raw),
  };
}

// ── Claude-enhanced parse (used when API key available) ───────────────────────

async function claudeChat(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}`);
  const d = await res.json() as { content: Array<{ type: string; text: string }> };
  return d.content.find((b) => b.type === "text")?.text?.trim() ?? "";
}

export async function parseQuery(raw: string): Promise<ParsedQuery> {
  // Start with fast local parse — always works
  const base = parseQueryLocal(raw);

  if (!process.env.ANTHROPIC_API_KEY) return base;

  try {
    const prompt = `A recruiter typed: "${raw}"

Extract their intent. Return ONLY valid JSON:
{
  "roleTitle": "inferred role title or empty string",
  "mustHaves": ["explicit requirements"],
  "niceToHaves": ["implicit nice-to-haves"],
  "targetCompanies": ["company names mentioned"],
  "geoPreference": "location or empty string",
  "domainTags": ["identity","security","platform","golang","distributed"] (use only these tags),
  "seniority": "junior|mid|senior|staff|principal|executive or empty string"
}`;

    const raw_json = (await claudeChat(prompt))
      .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    const parsed = JSON.parse(raw_json) as Partial<ParsedQuery>;

    // Merge Claude's parse with our local expansion
    const mergedDomains = [...new Set([...base.domainTags, ...(parsed.domainTags ?? [])])];
    const mergedTerms   = [...base.expandedTerms];

    for (const domain of mergedDomains) {
      for (const synonym of DOMAIN_EXPANSIONS[domain] ?? []) {
        if (!mergedTerms.includes(synonym)) mergedTerms.push(synonym);
      }
    }

    return {
      raw,
      roleTitle:       parsed.roleTitle       ?? base.roleTitle,
      mustHaves:       parsed.mustHaves        ?? base.mustHaves,
      niceToHaves:     parsed.niceToHaves      ?? base.niceToHaves,
      targetCompanies: parsed.targetCompanies  ?? base.targetCompanies,
      geoPreference:   parsed.geoPreference    ?? base.geoPreference,
      seniority:       (parsed.seniority as ParsedQuery["seniority"]) || base.seniority,
      domainTags:      mergedDomains,
      expandedTerms:   mergedTerms,
    };
  } catch {
    return base;
  }
}

function normalizeDomainTag(concept: string): string {
  const map: Record<string, string> = {
    golang: "go", "zero trust": "security", iam: "identity",
    distributed: "distributed-systems", connector: "integrations",
  };
  return map[concept] ?? concept;
}
