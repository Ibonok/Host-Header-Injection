export type RunStatus = "running" | "stopping" | "stopped" | "success" | "failed";

export type Run = {
  id: number;
  name: string;
  description?: string | null;
  created_at: string;
  status: RunStatus;
  concurrency: number;
  total_combinations?: number;
  processed_combinations?: number;
  resolve_all_dns_records: boolean;
  sub_test_case?: number;
  auto_override_421?: boolean;
  status_filters?: number[];
  run_type?: string;
};

export type RunnerLog = {
  id: number;
  level: string;
  message: string;
  created_at: string;
};

export type HeatmapCell = {
  tested_host_header: string;
  http_status: number;
  bytes_total: number;
  attempt: number;
  sni_overridden: boolean;
  sni_used: boolean;
  probe_id: number;
  auto_421_override: boolean;
  hit_ip_blacklist?: boolean;
  status_bucket: "success" | "redirect" | "client_error" | "server_error" | "other";
};

export type HeatmapPayload = {
  target_url: string;
  cells: HeatmapCell[];
  status_code_totals: Record<number, number>;
  bucket_totals: Record<HeatmapCell["status_bucket"], number>;
  auto_override_421: boolean;
  hit_ip_blacklist?: boolean;
};

export type Summary421 = {
  total_421: number;
  retries: number;
  successful_retries: number;
  failed_retries: number;
};

export type Probe = {
  id: number;
  run_id: number;
  target_url: string;
  tested_host_header: string;
  http_status: number;
  status_text?: string | null;
  bytes_total: number;
  response_time_ms?: number | null;
  snippet_b64?: string | null;
  raw_response_path?: string | null;
  attempt: number;
  sni_used: boolean;
  sni_overridden: boolean;
  auto_421_override?: boolean;
  hit_ip_blacklist?: boolean;
  correlation_id?: string | null;
  reason?: string | null;
  created_at: string;
};

export type SequenceRequestDef = {
  url: string;
  host_header: string;
  method: string;
};

export type SequenceTiming = {
  sequence_index: number;
  probe_id?: number | null;
  connection_reused: boolean;
  dns_time_ms?: number | null;
  tcp_connect_time_ms?: number | null;
  tls_handshake_time_ms?: number | null;
  time_to_first_byte_ms?: number | null;
  total_time_ms?: number | null;
  http_status?: number | null;
  status_text?: string | null;
  bytes_total: number;
  error?: string | null;
  request_type: "normal" | "injected";
};

export type SequenceGroupResult = {
  run_id: number;
  run_name: string;
  total_requests: number;
  results: SequenceTiming[];
  total_elapsed_ms: number;
};
