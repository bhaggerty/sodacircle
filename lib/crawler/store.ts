/**
 * Persistent profile store — JSONL-backed, append-only.
 * Fast to write, readable without full-file rewrites.
 *
 * Files (in data/ at project root):
 *   profiles.jsonl  — one profile per line
 *   state.json      — crawler state (stats, queue snapshot)
 */

import fs from "fs";
import path from "path";

const DATA_DIR   = path.join(process.cwd(), "data");
const PROFILES_F = path.join(DATA_DIR, "profiles.jsonl");
const STATE_F    = path.join(DATA_DIR, "state.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ── Profile shape ────────────────────────────────────────────────────────────

export interface IndexedProfile {
  id: string;
  name: string;
  title: string;
  company: string;
  location: string;
  bio: string;
  skills: string[];
  email: string;
  githubUrl: string;
  linkedinUrl: string;
  sourceUrl: string;
  sourceName: "github" | "web";
  indexedAt: string;
}

// ── Write ────────────────────────────────────────────────────────────────────

const _seen = new Set<string>(); // in-memory dedup cache

export function appendProfile(p: IndexedProfile): boolean {
  const key = `${p.name.toLowerCase().trim()}|${p.company.toLowerCase().trim()}`;
  const altKey = p.githubUrl || p.linkedinUrl || p.email;

  if (_seen.has(key) || (altKey && _seen.has(altKey))) return false;
  _seen.add(key);
  if (altKey) _seen.add(altKey);

  ensureDir();
  fs.appendFileSync(PROFILES_F, JSON.stringify(p) + "\n", "utf8");
  return true;
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function readProfiles(limit = 1000, offset = 0): IndexedProfile[] {
  ensureDir();
  if (!fs.existsSync(PROFILES_F)) return [];

  const lines = fs.readFileSync(PROFILES_F, "utf8")
    .split("\n")
    .filter(Boolean);

  return lines
    .slice(offset, offset + limit)
    .map((l) => { try { return JSON.parse(l) as IndexedProfile; } catch { return null; } })
    .filter((p): p is IndexedProfile => p !== null);
}

export function countProfiles(): number {
  if (!fs.existsSync(PROFILES_F)) return 0;
  let count = 0;
  const data = fs.readFileSync(PROFILES_F, "utf8");
  for (const c of data) if (c === "\n") count++;
  return count;
}

// Simple text search across name, title, company, bio, skills
export function searchProfiles(query: string, limit = 50): IndexedProfile[] {
  if (!query.trim()) return readProfiles(limit);

  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const all = readProfiles(10000); // read all for search

  return all
    .map((p) => {
      const haystack = [p.name, p.title, p.company, p.bio, p.location, ...p.skills]
        .join(" ").toLowerCase();
      const score = terms.filter((t) => haystack.includes(t)).length;
      return { p, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ p }) => p);
}

// ── State persistence ────────────────────────────────────────────────────────

export interface CrawlerState {
  running: boolean;
  startedAt: string | null;
  stoppedAt: string | null;
  pagesVisited: number;
  profilesFound: number;
  errors: number;
  queueDepth: number;
  recentFinds: Array<{ name: string; title: string; company: string; time: string }>;
  lastActivity: string | null;
}

export function readState(): CrawlerState {
  if (!fs.existsSync(STATE_F)) return {
    running: false, startedAt: null, stoppedAt: null,
    pagesVisited: 0, profilesFound: 0, errors: 0, queueDepth: 0,
    recentFinds: [], lastActivity: null,
  };
  try { return JSON.parse(fs.readFileSync(STATE_F, "utf8")) as CrawlerState; }
  catch { return { running: false, startedAt: null, stoppedAt: null, pagesVisited: 0, profilesFound: 0, errors: 0, queueDepth: 0, recentFinds: [], lastActivity: null }; }
}

export function writeState(state: Partial<CrawlerState>) {
  ensureDir();
  const current = readState();
  fs.writeFileSync(STATE_F, JSON.stringify({ ...current, ...state }, null, 2), "utf8");
}

// ── Seed cache (persist visited URLs across restarts) ────────────────────────
const VISITED_F = path.join(DATA_DIR, "visited.json");

export function loadVisited(): Set<string> {
  if (!fs.existsSync(VISITED_F)) return new Set();
  try { return new Set(JSON.parse(fs.readFileSync(VISITED_F, "utf8")) as string[]); }
  catch { return new Set(); }
}

export function saveVisited(visited: Set<string>) {
  ensureDir();
  // Save a capped snapshot (last 50k) so the file doesn't grow forever
  const arr = [...visited].slice(-50000);
  fs.writeFileSync(VISITED_F, JSON.stringify(arr), "utf8");
}
