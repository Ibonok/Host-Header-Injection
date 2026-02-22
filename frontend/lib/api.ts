import type { HeatmapPayload, Probe, Run, RunnerLog, SequenceGroupResult, SequenceRequestDef, Summary421 } from "./types";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

if (!apiBaseUrl) {
  throw new Error("NEXT_PUBLIC_API_BASE_URL is not set (required in .env)");
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!resp.ok) {
    const fallback = await resp.text();
    throw new Error(fallback || resp.statusText);
  }
  if (resp.status === 204) {
    return undefined as T;
  }
  return (await resp.json()) as T;
}

export function getRawResponseUrl(probeId: number): string {
  return `${apiBaseUrl}/api/probes/${probeId}/raw`;
}

export async function listRuns(): Promise<Run[]> {
  return apiFetch<Run[]>("/api/runs/");
}

export type CreateRunPayload = {
  name: string;
  description: string;
  attempt: number;
  subTestCase: number;
  concurrency: number;
  urlsFile: File;
  fqdnsFile: File | null;
  resolveAllDnsRecords: boolean;
  autoOverride421: boolean;
  applyBlacklist: boolean;
  statusFilters?: number[];
  directoriesFile?: File | null;
};

export async function createRunFromLists(payload: CreateRunPayload): Promise<Run> {
  const formData = new FormData();
  formData.append("name", payload.name);
  formData.append("description", payload.description);
  formData.append("attempt", payload.attempt.toString());
  formData.append("sub_test_case", payload.subTestCase.toString());
  formData.append("concurrency", payload.concurrency.toString());
  formData.append("resolve_all_dns_records", String(payload.resolveAllDnsRecords));
  formData.append("auto_override_421", String(payload.autoOverride421));
  formData.append("apply_blacklist", String(payload.applyBlacklist));
  formData.append("urls_file", payload.urlsFile);
  const activeStatusFilters = payload.statusFilters?.filter((code) => code >= 100 && code <= 599) ?? [];
  if (activeStatusFilters.length > 0) {
    formData.append("status_filters", activeStatusFilters.join(","));
  }
  if (payload.fqdnsFile) {
    formData.append("fqdns_file", payload.fqdnsFile);
  }
  if (payload.directoriesFile) {
    formData.append("directories_file", payload.directoriesFile);
  }

  const response = await fetch(`${apiBaseUrl}/api/runner/create-from-lists`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Fehler beim Erstellen des Runs");
  }
  return (await response.json()) as Run;
}

export async function fetchRun(runId: number): Promise<Run> {
  return apiFetch<Run>(`/api/runs/${runId}`);
}

export async function deleteRun(runId: number): Promise<void> {
  await apiFetch<void>(`/api/runs/${runId}`, { method: "DELETE" });
}

export async function stopRun(runId: number): Promise<Run> {
  return apiFetch<Run>(`/api/runner/${runId}/stop`, { method: "POST" });
}

export type HeatmapOptions = {
  uniqueSizeOnly?: boolean;
  targetUrl?: string;
};

export async function fetchHeatmap(runId: number, options: HeatmapOptions = {}): Promise<HeatmapPayload[]> {
  const params = new URLSearchParams();
  const uniqueFlag = options.uniqueSizeOnly ?? true;
  params.set("unique_size_only", String(uniqueFlag));
  if (options.targetUrl) {
    params.set("target_url", options.targetUrl);
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return apiFetch<HeatmapPayload[]>(`/api/runs/${runId}/aggregates/matrix${suffix}`);
}

export async function fetch421Summary(runId: number): Promise<Summary421 | null> {
  try {
    return await apiFetch<Summary421>(`/api/runs/${runId}/aggregates/421_summary`);
  } catch (error) {
    console.warn("Konnte 421-Summary nicht laden", error);
    return null;
  }
}

export type ProbeFilters = {
  only421?: boolean;
  attempt?: number;
  host?: string;
  url?: string;
  status?: number;
};

export async function fetchProbes(
  runId: number,
  filters: ProbeFilters = {},
  pagination: { limit?: number; offset?: number } = {},
): Promise<Probe[]> {
  const params = new URLSearchParams();
  if (filters.only421) params.set("only_421", "true");
  if (filters.attempt) params.set("attempt", String(filters.attempt));
  if (filters.host) params.set("host", filters.host);
  if (filters.url) params.set("url", filters.url);
  if (filters.status) params.set("status", String(filters.status));
  if (pagination.limit) params.set("limit", String(pagination.limit));
  if (pagination.offset) params.set("offset", String(pagination.offset));
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return apiFetch<Probe[]>(`/api/runs/${runId}/probes${suffix}`);
}

export async function fetchProbe(probeId: number): Promise<Probe> {
  return apiFetch<Probe>(`/api/probes/${probeId}`);
}

type LogOptions = {
  limit?: number;
  offset?: number;
};

export async function fetchRunnerLogs(runId: number, options: LogOptions = {}): Promise<RunnerLog[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set("limit", String(options.limit));
  if (options.offset) params.set("offset", String(options.offset));
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return apiFetch<RunnerLog[]>(`/api/runner/${runId}/logs${suffix}`);
}

export async function fetchRawResponse(probeId: number): Promise<string> {
  const resp = await fetch(getRawResponseUrl(probeId));
  if (!resp.ok) {
    throw new Error("Roh-Response konnte nicht geladen werden");
  }
  return resp.text();
}

export type SequenceGroupPayload = {
  name: string;
  description?: string;
  requests: SequenceRequestDef[];
  timeout_seconds?: number;
  verify_ssl?: boolean;
};

export async function createSequenceGroup(payload: SequenceGroupPayload): Promise<SequenceGroupResult> {
  return apiFetch<SequenceGroupResult>("/api/runner/sequence-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchSequenceResults(runId: number): Promise<SequenceGroupResult> {
  return apiFetch<SequenceGroupResult>(`/api/runs/${runId}/sequence-results`);
}
