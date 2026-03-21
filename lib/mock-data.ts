import { Candidate, ReplyItem, SearchCriteria } from "@/lib/types";

export const defaultBrief = "";

export const defaultCriteria: SearchCriteria = {
  roleTitle: "",
  compensationRange: "",
  geoPreference: "",
  mustHaves: [],
  niceToHaves: [],
  disqualifiers: [],
  targetCompanies: [],
  avoidBackgrounds: [],
  hiringManagerNotes: "",
  searchRecipe: {
    function: "",
    segment: "",
    industry: [],
    stageFit: [],
    seniority: "",
    evidenceSignals: [],
    exclusions: [],
  },
};

export const sampleCandidates: Candidate[] = [];

export const sampleReplies: ReplyItem[] = [];
