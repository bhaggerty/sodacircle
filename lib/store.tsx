"use client";

import { ChangeEvent, createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { draftOutreach, parseBriefToCriteria, rankCandidates } from "@/lib/ai";
import { defaultBrief, defaultCriteria, sampleCandidates, sampleReplies } from "@/lib/mock-data";
import { Candidate, CandidateStatus, RankedCandidate, ReplyClass, ReplyItem, SearchCriteria } from "@/lib/types";
import { AtsSyncStatus, pushCandidateToAts } from "@/lib/ats";

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

type StoreCtx = {
  brief: string;
  setBrief: (v: string) => void;
  criteria: SearchCriteria;
  setCriteria: (v: SearchCriteria) => void;
  candidates: Candidate[];
  shortlist: RankedCandidate[];
  selectedCandidateId: string;
  setSelectedCandidateId: (id: string) => void;
  statuses: Record<string, CandidateStatus>;
  replyStatuses: Record<string, ReplyClass>;
  setReplyStatus: (id: string, status: ReplyClass) => void;
  approvedCount: number;
  selectedCandidate: RankedCandidate | undefined;
  outreachDraft: { subject: string; body: string } | null;
  handleExtractCriteria: () => void;
  handleCsvUpload: (e: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleTagChange: (field: keyof SearchCriteria, value: string) => void;
  setCandidateStatus: (id: string, status: CandidateStatus) => void;
  replies: ReplyItem[];
  // ATS sync
  atsSyncStatus: Record<string, AtsSyncStatus>;
  atsUrls: Record<string, string>;
  syncCandidateToAts: (candidateId: string) => Promise<void>;
  syncAllToAts: () => Promise<void>;
};

const Store = createContext<StoreCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [brief, setBrief] = useState(defaultBrief);
  const [criteria, setCriteria] = useState<SearchCriteria>(defaultCriteria);
  const [candidates, setCandidates] = useState<Candidate[]>(sampleCandidates);
  const [shortlist, setShortlist] = useState<RankedCandidate[]>(() =>
    rankCandidates(sampleCandidates, defaultCriteria)
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>(() => shortlist[0]?.id ?? "");
  const [statuses, setStatuses] = useState<Record<string, CandidateStatus>>({});
  const [replyStatuses, setReplyStatuses] = useState<Record<string, ReplyClass>>(
    Object.fromEntries(sampleReplies.map((r) => [r.candidateId, r.classification]))
  );
  const [atsSyncStatus, setAtsSyncStatus] = useState<Record<string, AtsSyncStatus>>({});
  const [atsUrls, setAtsUrls] = useState<Record<string, string>>({});

  const approvedCount = useMemo(
    () => Object.values(statuses).filter((s) => s === "approved").length,
    [statuses]
  );

  const selectedCandidate = shortlist.find((c) => c.id === selectedCandidateId) ?? shortlist[0];
  const outreachDraft = selectedCandidate ? draftOutreach(selectedCandidate, criteria) : null;

  const refreshRanking = (nextCriteria: SearchCriteria, nextCandidates = candidates) => {
    const ranked = rankCandidates(nextCandidates, nextCriteria);
    setShortlist(ranked);
    setSelectedCandidateId(ranked[0]?.id ?? "");
  };

  // ── ATS sync ────────────────────────────────────────────────────

  const syncCandidateToAts = useCallback(async (candidateId: string) => {
    // Skip if already synced or in-progress
    setAtsSyncStatus((s) => {
      if (s[candidateId] === "syncing" || s[candidateId] === "synced") return s;
      return { ...s, [candidateId]: "syncing" };
    });

    // Find the candidate across shortlist and raw candidates
    const candidate =
      shortlist.find((c) => c.id === candidateId) ??
      candidates.find((c) => c.id === candidateId);

    if (!candidate) {
      setAtsSyncStatus((s) => ({ ...s, [candidateId]: "error" }));
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
    } else {
      setAtsSyncStatus((s) => ({ ...s, [candidateId]: "error" }));
      console.warn(`[ats] Failed to sync ${candidate.name}:`, result.error);
    }
  }, [shortlist, candidates]);

  const syncAllToAts = useCallback(async () => {
    // Push every candidate not yet synced or errored, sequentially to avoid overwhelming the ATS
    for (const c of candidates) {
      const current = atsSyncStatus[c.id];
      if (current === "synced" || current === "syncing") continue;
      await syncCandidateToAts(c.id);
    }
  }, [candidates, atsSyncStatus, syncCandidateToAts]);

  // ── Candidate actions ────────────────────────────────────────────

  const handleExtractCriteria = () => {
    const next = parseBriefToCriteria(brief, criteria);
    setCriteria(next);
    refreshRanking(next);
  };

  const handleCsvUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const csv = await file.text();
    const parsed = parseCsv(csv);
    if (!parsed.length) return;
    setCandidates(parsed);
    refreshRanking(criteria, parsed);

    // Auto-push every uploaded candidate to free-ats in the background
    for (const c of parsed) {
      pushCandidateToAts({
        id: c.id,
        name: c.name,
        title: c.title,
        company: c.company,
        location: c.location,
        linkedinUrl: c.linkedinUrl,
      }).then((result) => {
        setAtsSyncStatus((s) => ({ ...s, [c.id]: result.ok ? "synced" : "error" }));
        if (result.ok && result.atsUrl) {
          setAtsUrls((u) => ({ ...u, [c.id]: result.atsUrl }));
        }
      });
      // Mark as syncing immediately so the UI reflects it
      setAtsSyncStatus((s) => ({ ...s, [c.id]: "syncing" }));
    }
  };

  const handleTagChange = (field: keyof SearchCriteria, value: string) => {
    const next = { ...criteria, [field]: splitTags(value) };
    setCriteria(next);
    refreshRanking(next);
  };

  const setCandidateStatus = (id: string, status: CandidateStatus) => {
    setStatuses((s) => ({ ...s, [id]: status }));
    // Ensure approved candidates are always in the ATS
    if (status === "approved") {
      syncCandidateToAts(id);
    }
  };

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
      selectedCandidate, outreachDraft,
      handleExtractCriteria, handleCsvUpload, handleTagChange,
      setCandidateStatus,
      replies: sampleReplies,
      atsSyncStatus, atsUrls,
      syncCandidateToAts, syncAllToAts,
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
