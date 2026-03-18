export type AtsSyncStatus = "idle" | "syncing" | "synced" | "error";

export type AtsPushResult =
  | { ok: true; atsUrl: string }
  | { ok: false; error: string };

export async function pushCandidateToAts(candidate: {
  id: string;
  name: string;
  title?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
}): Promise<AtsPushResult> {
  try {
    const res = await fetch("/api/ats/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidate),
    });

    const data = await res.json() as { atsUrl?: string; error?: string };

    if (!res.ok || data.error) {
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
    }

    return { ok: true, atsUrl: data.atsUrl ?? "" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
