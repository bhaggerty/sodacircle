// file: lib/profiles/mergeProfiles.ts
//
// Identity stitching — detects when two profiles are the same person
// and merges them into a single canonical record.
//
// Match signals (in priority order):
//   1. Exact githubUrl match      → definitive
//   2. Exact email match          → definitive
//   3. Exact linkedinUrl match    → definitive
//   4. Name + company fuzzy match → probable (score ≥ 0.85)

import { EnrichedProfile } from "./normalizeProfile";

export interface MergeResult {
  canonical: EnrichedProfile;
  mergedIds: string[];      // IDs that were merged into canonical
  confidence: number;       // 0-1
  reason: string;
}

// ── Simple character-level similarity (Dice coefficient) ─────────────────────
// Avoids pulling in a heavy string-similarity library.

function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const ba = bigrams(a.toLowerCase());
  const bb = bigrams(b.toLowerCase());
  let intersection = 0;
  for (const bg of ba) if (bb.has(bg)) intersection++;
  return (2 * intersection) / (ba.size + bb.size);
}

// ── Match two profiles ────────────────────────────────────────────────────────

export interface MatchResult {
  matched: boolean;
  confidence: number;
  reason: string;
}

export function matchProfiles(a: EnrichedProfile, b: EnrichedProfile): MatchResult {
  // Definitive matches
  if (a.githubUrl && b.githubUrl && a.githubUrl === b.githubUrl) {
    return { matched: true, confidence: 1.0, reason: "identical GitHub URL" };
  }
  if (a.email && b.email && a.email === b.email) {
    return { matched: true, confidence: 1.0, reason: "identical email" };
  }
  if (a.linkedinUrl && b.linkedinUrl && a.linkedinUrl === b.linkedinUrl) {
    return { matched: true, confidence: 1.0, reason: "identical LinkedIn URL" };
  }

  // Fuzzy: name + company
  const nameSim    = dice(a.name, b.name);
  const companySim = dice(a.company, b.company);

  if (nameSim >= 0.85 && companySim >= 0.75) {
    const confidence = (nameSim + companySim) / 2;
    return {
      matched: true,
      confidence,
      reason: `name similarity ${(nameSim * 100).toFixed(0)}%, company similarity ${(companySim * 100).toFixed(0)}%`,
    };
  }

  return { matched: false, confidence: 0, reason: "" };
}

// ── Merge two profiles into one canonical record ──────────────────────────────
// Keeps the higher-confidence field when both have data.

export function mergeIntoCanonical(
  primary: EnrichedProfile,
  secondary: EnrichedProfile,
  matchReason: string
): MergeResult {
  const pick = <T>(a: T, b: T): T => {
    if (!a) return b;
    if (!b) return a;
    if (typeof a === "string" && typeof b === "string") {
      return (a as string).length >= (b as string).length ? a : b;
    }
    return a;
  };

  const mergedSkills = [...new Set([...(primary.skills ?? []), ...(secondary.skills ?? [])])];
  const mergedDomains = [...new Set([...(primary.domainTags ?? []), ...(secondary.domainTags ?? [])])];
  const mergedPrior  = [...new Set([...(primary.priorCompanies ?? []), ...(secondary.priorCompanies ?? [])])];

  const canonical: EnrichedProfile = {
    ...primary,
    name:          pick(primary.name, secondary.name),
    title:         pick(primary.title, secondary.title),
    company:       pick(primary.company, secondary.company),
    location:      pick(primary.location, secondary.location),
    bio:           pick(primary.bio, secondary.bio),
    email:         pick(primary.email, secondary.email),
    githubUrl:     pick(primary.githubUrl, secondary.githubUrl),
    linkedinUrl:   pick(primary.linkedinUrl, secondary.linkedinUrl),
    skills:        mergedSkills,
    domainTags:    mergedDomains,
    skillTags:     mergedSkills,
    priorCompanies: mergedPrior,
    confidence:    Math.max(primary.confidence, secondary.confidence),
    lastEnrichedAt: new Date().toISOString(),
  };

  return {
    canonical,
    mergedIds: [primary.id, secondary.id].filter(Boolean),
    confidence: Math.max(primary.confidence, secondary.confidence),
    reason: matchReason,
  };
}

// ── Dedup a batch of profiles ─────────────────────────────────────────────────
// Used by the crawler and bulk-import paths.

export function dedupProfiles(profiles: EnrichedProfile[]): EnrichedProfile[] {
  const groups: EnrichedProfile[][] = [];
  const assigned = new Set<string>();

  for (const profile of profiles) {
    if (assigned.has(profile.id)) continue;

    const group = [profile];
    assigned.add(profile.id);

    for (const other of profiles) {
      if (assigned.has(other.id)) continue;
      const { matched, reason } = matchProfiles(profile, other);
      if (matched) {
        group.push(other);
        assigned.add(other.id);
      }
    }

    groups.push(group);
  }

  // For each group, merge into canonical
  return groups.map((group) => {
    if (group.length === 1) return group[0];
    // Sort by confidence desc — highest confidence is primary
    const sorted = group.sort((a, b) => b.confidence - a.confidence);
    let canonical = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const result = mergeIntoCanonical(canonical, sorted[i], "batch dedup");
      canonical = result.canonical;
    }
    return canonical;
  });
}
