"use client";

import { ChangeEvent, createContext, ReactNode, useCallback, useContext, useMemo, useState, useEffect } from "react";
import { draftOutreachSequence, parseBriefToCriteria, rankCandidates } from "@/lib/ai";
import { defaultBrief, defaultCriteria, sampleCandidates, sampleReplies } from "@/lib/mock-data";
import { Candidate, CandidateStatus, OutreachStep, RankedCandidate, RankingCriterion, ReplyClass, ReplyItem, SavedSearch, SearchCriteria } from "@/lib/types";
import { AtsSyncStatus, pushCandidateToAts } from "@/lib/ats";

// ── localStorage helpers ─────────────────────────────────────────────────────

// Bump this when the data shape changes — wipes all sc_* keys on first load
const LS_VERSION = "2";

function lsClearIfStale() {
  if (typeof window === "undefined") return;
  try {
    if (localStorage.getItem("sc_version") !== LS_VERSION) {
      Object.keys(localStorage)
        .filter((k) => k.startsWith("sc_"))
        .forEach((k) => localStorage.removeItem(k));
      localStorage.setItem("sc_version", LS_VERSION);
    }
  } catch { /* ignore */ }
}

// Run once at module load time (client-only)
if (typeof window !== "undefined") lsClearIfStale();

function lsGet<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function lsSet(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota exceeded, ignore */ }
}

// ── CSV parser ───────────────────────────────────────────────────────────────

function parseCsv(text: string): Candidate[] {
  const [headerLine, ...rows] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((cell) => cell.trim().toLowerCase());
  return rows
    .filter(Boolean)
    .map((row, index) => {
      const values = row.split(",").map((cell) => cell.trim());
      const get = (name: string) => values[headers.indexOf(name)] ?? "";
      return {
        id: `upload-${index + 1}`,
        name: get("name"),
        title: get("title"),
        company: get("company"),
        location: get("location"),
        email: get("email"),
        linkedinUrl: get("linkedin_url"),
        summary: get("summary"),
        experience: get("experience"),
        notes: get("notes"),
      };
    })
    .filter((c) => c.name && c.title);
}

function splitTags(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

// ── Context type ─────────────────────────────────────────────────────────────

type StoreCtx = {
  brief: string;
  setBrief: (v: string) => void;
  criteria: SearchCriteria;
  setCriteria: (v: SearchCriteria) => void;
  candidates: Candidate[];
  shortlist: RankedCandidate[];
  addCandidatesToPool: (incoming: Candidate[]) => void;
  selectedCandidateId: string;
  setSelectedCandidateId: (id: string) => void;
  statuses: Record<string, CandidateStatus>;
  replyStatuses: Record<string, ReplyClass>;
  setReplyStatus: (id: string, status: ReplyClass) => void;
  approvedCount: number;
  selectedCandidate: RankedCandidate | undefined;
  outreachSequence: OutreachStep[] | null;
  activeStepIndex: number;
  setActiveStep: (index: number) => void;
  rankingCriteria: RankingCriterion[];
  addRankingCriterion: (text: string, weight?: RankingCriterion["weight"]) => void;
  removeRankingCriterion: (id: string) => void;
  updateRankingCriterion: (id: string, patch: Partial<Omit<RankingCriterion, "id">>) => void;
  prefillBriefFromCandidate: (c: RankedCandidate) => void;
  handleExtractCriteria: () => Promise<void>;
  handleCsvUpload: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleTagChange: (field: keyof SearchCriteria, value: string) => void;
  setCandidateStatus: (id: string, status: CandidateStatus) => void;
  replies: ReplyItem[];
  // ATS sync
  atsSyncStatus: Record<string, AtsSyncStatus>;
  atsErrors: Record<string, string>;
  atsUrls: Record<string, string>;
  syncCandidateToAts: (candidateId: string) => Promise<void>;
  syncAllToAts: () => Promise<void>;
  // Pool management
  clearCandidates: () => void;
  // Saved searches
  savedSearches: SavedSearch[];
  saveCurrentSearch: (name: string) => void;
  loadSavedSearch: (id: string) => void;
  deleteSavedSearch: (id: string) => void;
};

const Store = createContext<StoreCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [brief, setBriefRaw] = useState<string>(() => lsGet("sc_brief", defaultBrief));
  const [criteria, setCriteriaRaw] = useState<SearchCriteria>(() => lsGet("sc_criteria", defaultCriteria));
  const [candidates, setCandidatesRaw] = useState<Candidate[]>(() => lsGet("sc_candidates", sampleCandidates));
  const [shortlist, setShortlist] = useState<RankedCandidate[]>(() =>
    rankCandidates(lsGet<Candidate[]>("sc_candidates", sampleCandidates), lsGet("sc_criteria", defaultCriteria))
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>("");
  const [statuses, setStatusesRaw] = useState<Record<string, CandidateStatus>>(() => lsGet("sc_statuses", {}));
  const [replyStatuses, setReplyStatuses] = useState<Record<string, ReplyClass>>(
    Object.fromEntries(sampleReplies.map((r) => [r.candidateId, r.classification]))
  );
  const [atsSyncStatus, setAtsSyncStatus] = useState<Record<string, AtsSyncStatus>>({});
  const [atsErrors, setAtsErrors] = useState<Record<string, string>>({});
  const [atsUrls, setAtsUrls] = useState<Record<string, string>>({});
  const [rankingCriteria, setRankingCriteria] = useState<RankingCriterion[]>([]);
  const [activeStepIndex, setActiveStep] = useState(0);
  const [savedSearches, setSavedSearchesRaw] = useState<SavedSearch[]>(() => lsGet("sc_saved_searches", []));

  // ── Persist to localStorage on change ────────────────────────────
  const setBrief = useCallback((v: string) => { setBriefRaw(v); lsSet("sc_brief", v); }, []);
  const setCriteria = useCallback((v: SearchCriteria) => { setCriteriaRaw(v); lsSet("sc_criteria", v); }, []);
  const setSavedSearches = useCallback((updater: SavedSearch[] | ((prev: SavedSearch[]) => SavedSearch[])) => {
    setSavedSearchesRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      lsSet("sc_saved_searches", next);
      return next;
    });
  }, []);

  const setCandidates = useCallback((updater: ((prev: Candidate[]) => Candidate[]) | Candidate[]) => {
    setCandidatesRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      lsSet("sc_candidates", next);
      return next;
    });
  }, []);

  const setStatuses = useCallback((updater: ((prev: Record<string, CandidateStatus>) => Record<string, CandidateStatus>) | Record<string, CandidateStatus>) => {
    setStatusesRaw((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      lsSet("sc_statuses", next);
      return next;
    });
  }, []);

  // ── Derived state ────────────────────────────────────────────────
  const approvedCount = useMemo(
    () => Object.values(statuses).filter((s) => s === "approved").length,
    [statuses]
  );

  const selectedCandidate = shortlist.find((c) => c.id === selectedCandidateId) ?? shortlist[0];
  const outreachSequence = selectedCandidate ? draftOutreachSequence(selectedCandidate, criteria) : null;

  const refreshRanking = (nextCriteria: SearchCriteria, nextCandidates = candidates, nextRankingCriteria = rankingCriteria) => {
    const ranked = rankCandidates(nextCandidates, nextCriteria, nextRankingCriteria);
    setShortlist(ranked);
  };

  // ── Ranking criteria ─────────────────────────────────────────────
  const addRankingCriterion = useCallback((text: string, weight: RankingCriterion["weight"] = "normal") => {
    const criterion: RankingCriterion = { id: `rc-${Date.now()}`, text, weight };
    setRankingCriteria((prev) => {
      const next = [...prev, criterion];
      setShortlist(rankCandidates(candidates, criteria, next));
      return next;
    });
  }, [candidates, criteria]);

  const removeRankingCriterion = useCallback((id: string) => {
    setRankingCriteria((prev) => {
      const next = prev.filter((rc) => rc.id !== id);
      setShortlist(rankCandidates(candidates, criteria, next));
      return next;
    });
  }, [candidates, criteria]);

  const updateRankingCriterion = useCallback((id: string, patch: Partial<Omit<RankingCriterion, "id">>) => {
    setRankingCriteria((prev) => {
      const next = prev.map((rc) => rc.id === id ? { ...rc, ...patch } : rc);
      setShortlist(rankCandidates(candidates, criteria, next));
      return next;
    });
  }, [candidates, criteria]);

  const prefillBriefFromCandidate = useCallback((c: RankedCandidate) => {
    const signals = c.matchedSignals
      .filter((s) => !s.startsWith("Code Pass") && !s.startsWith("From a target"))
      .slice(0, 3);
    const newBrief = [
      `Looking for someone like ${c.name} — ${c.title} at ${c.company}.`,
      signals.length ? `Key strengths: ${signals.join(", ")}.` : "",
      c.location ? `Location: ${c.location}.` : "",
    ].filter(Boolean).join(" ");
    setBrief(newBrief);
  }, [setBrief]);

  // ── Saved searches ────────────────────────────────────────────────
  const saveCurrentSearch = useCallback((name: string) => {
    const search: SavedSearch = {
      id: `ss-${Date.now()}`,
      name: name.trim(),
      brief,
      criteria,
      savedAt: new Date().toISOString(),
    };
    setSavedSearches((prev) => [search, ...prev]);
  }, [brief, criteria, setSavedSearches]);

  const loadSavedSearch = useCallback((id: string) => {
    const search = savedSearches.find((s) => s.id === id);
    if (!search) return;
    setBrief(search.brief);
    setCriteria(search.criteria);
    refreshRanking(search.criteria, candidates);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSearches, candidates, setBrief, setCriteria]);

  const deleteSavedSearch = useCallback((id: string) => {
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
  }, [setSavedSearches]);

  // ── ATS sync ─────────────────────────────────────────────────────
  const syncCandidateToAts = useCallback(async (candidateId: string) => {
    setAtsSyncStatus((s) => {
      if (s[candidateId] === "syncing" || s[candidateId] === "synced") return s;
      return { ...s, [candidateId]: "syncing" };
    });

    const candidate =
      shortlist.find((c) => c.id === candidateId) ??
      candidates.find((c) => c.id === candidateId);

    if (!candidate) {
      setAtsSyncStatus((s) => ({ ...s, [candidateId]: "error" }));
      setAtsErrors((e) => ({ ...e, [candidateId]: "Candidate not found" }));
      return;
    }

    const result = await pushCandidateToAts({
      id: candidate.id,
      name: candidate.name,
      title: candidate.title,
      company: candidate.company,
      location: candidate.location,
      linkedinUrl: candidate.linkedinUrl,
    });

    if (result.ok) {
      setAtsSyncStatus((s) => ({ ...s, [candidateId]: "synced" }));
      if (result.atsUrl) setAtsUrls((u) => ({ ...u, [candidateId]: result.atsUrl }));
      setAtsErrors((e) => { const next = { ...e }; delete next[candidateId]; return next; });
    } else {
      setAtsSyncStatus((s) => ({ ...s, [candidateId]: "error" }));
      setAtsErrors((e) => ({ ...e, [candidateId]: result.error }));
      console.warn(`[ats] Failed to sync ${candidate.name}:`, result.error);
    }
  }, [shortlist, candidates]);

  const syncAllToAts = useCallback(async () => {
    for (const c of candidates) {
      const current = atsSyncStatus[c.id];
      if (current === "synced" || current === "syncing") continue;
      await syncCandidateToAts(c.id);
    }
  }, [candidates, atsSyncStatus, syncCandidateToAts]);

  // ── Candidate actions ────────────────────────────────────────────
  const handleExtractCriteria = useCallback(async () => {
    try {
      const res = await fetch("/api/criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief, seed: criteria }),
      });
      if (res.ok) {
        const next = await res.json() as SearchCriteria;
        setCriteria(next);
        refreshRanking(next);
        return;
      }
    } catch {
      // fall through to regex fallback
    }
    const next = parseBriefToCriteria(brief, criteria);
    setCriteria(next);
    refreshRanking(next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, criteria]);

  const handleCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const csv = await file.text();
    const parsed = parseCsv(csv);
    if (!parsed.length) return;
    setCandidates(parsed);
    refreshRanking(criteria, parsed);

    for (const c of parsed) {
      pushCandidateToAts({
        id: c.id, name: c.name, title: c.title, company: c.company,
        location: c.location, linkedinUrl: c.linkedinUrl,
      }).then((result) => {
        setAtsSyncStatus((s) => ({ ...s, [c.id]: result.ok ? "synced" : "error" }));
        if (result.ok && result.atsUrl) setAtsUrls((u) => ({ ...u, [c.id]: result.atsUrl }));
        if (!result.ok) setAtsErrors((err) => ({ ...err, [c.id]: result.error }));
      });
      setAtsSyncStatus((s) => ({ ...s, [c.id]: "syncing" }));
    }
  };

  const handleTagChange = (field: keyof SearchCriteria, value: string) => {
    const next = { ...criteria, [field]: splitTags(value) };
    setCriteria(next);
    refreshRanking(next);
  };

  const addCandidatesToPool = useCallback((incoming: Candidate[]) => {
    setCandidates((current) => {
      const existingIds = new Set(current.map((c) => c.id));
      const existingLinks = new Set(current.map((c) => c.linkedinUrl).filter(Boolean));
      const fresh = incoming.filter(
        (c) => !existingIds.has(c.id) && (!c.linkedinUrl || !existingLinks.has(c.linkedinUrl))
      );
      if (!fresh.length) return current;
      const merged = [...current, ...fresh];
      const ranked = rankCandidates(merged, criteria, rankingCriteria);
      setShortlist(ranked);
      fresh.forEach((c) => {
        pushCandidateToAts(c).then((result) => {
          setAtsSyncStatus((s) => ({ ...s, [c.id]: result.ok ? "synced" : "error" }));
          if (result.ok && result.atsUrl) setAtsUrls((u) => ({ ...u, [c.id]: result.atsUrl }));
          if (!result.ok) setAtsErrors((err) => ({ ...err, [c.id]: result.error }));
        });
        setAtsSyncStatus((s) => ({ ...s, [c.id]: "syncing" }));
      });
      return merged;
    });
  }, [criteria, rankingCriteria]);

  const setCandidateStatus = (id: string, status: CandidateStatus) => {
    setStatuses((s) => ({ ...s, [id]: status }));
    if (status === "approved") syncCandidateToAts(id);
  };

  const clearCandidates = useCallback(() => {
    setCandidates([]);
    setShortlist([]);
    setStatusesRaw({});
    lsSet("sc_candidates", []);
    lsSet("sc_statuses", {});
    setAtsSyncStatus({});
    setAtsErrors({});
    setAtsUrls({});
  }, [setCandidates]);

  const setReplyStatus = (id: string, status: ReplyClass) => {
    setReplyStatuses((s) => ({ ...s, [id]: status }));
  };

  return (
    <Store.Provider value={{
      brief, setBrief,
      criteria, setCriteria,
      candidates, shortlist,
      selectedCandidateId, setSelectedCandidateId,
      statuses, replyStatuses, setReplyStatus,
      approvedCount,
      selectedCandidate,
      outreachSequence, activeStepIndex, setActiveStep,
      rankingCriteria, addRankingCriterion, removeRankingCriterion, updateRankingCriterion,
      prefillBriefFromCandidate,
      handleExtractCriteria, handleCsvUpload, handleTagChange,
      setCandidateStatus,
      addCandidatesToPool,
      replies: sampleReplies,
      atsSyncStatus, atsErrors, atsUrls,
      syncCandidateToAts, syncAllToAts,
      clearCandidates,
      savedSearches, saveCurrentSearch, loadSavedSearch, deleteSavedSearch,
    }}>
      {children}
    </Store.Provider>
  );
}

export function useStore() {
  const ctx = useContext(Store);
  if (!ctx) throw new Error("useStore must be used within AppProvider");
  return ctx;
}
