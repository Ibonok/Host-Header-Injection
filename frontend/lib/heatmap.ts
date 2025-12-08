import type { HeatmapCell, HeatmapPayload } from "./types";

export const HEATMAP_BUCKETS: HeatmapCell["status_bucket"][] = [
  "success",
  "redirect",
  "client_error",
  "server_error",
  "other",
];

export function createEmptyBucketTotals(): Record<HeatmapCell["status_bucket"], number> {
  return {
    success: 0,
    redirect: 0,
    client_error: 0,
    server_error: 0,
    other: 0,
  };
}

export function normalizeHeatmapPayload(payload: HeatmapPayload): HeatmapPayload {
  const statusCodeTotals = Object.entries(payload.status_code_totals || {}).reduce(
    (acc, [code, total]) => {
      const numeric = Number(code);
      acc[numeric] = (acc[numeric] || 0) + Number(total);
      return acc;
    },
    {} as Record<number, number>,
  );

  const bucketTotals = createEmptyBucketTotals();
  HEATMAP_BUCKETS.forEach((bucket) => {
    bucketTotals[bucket] = payload.bucket_totals?.[bucket] ?? 0;
  });

  return {
    ...payload,
    status_code_totals: statusCodeTotals,
    bucket_totals: bucketTotals,
    auto_override_421: Boolean(payload.auto_override_421),
    hit_ip_blacklist: Boolean(payload.hit_ip_blacklist),
  };
}

export function mergeStatusTotals(payloads: HeatmapPayload[]): Record<number, number> {
  return payloads.reduce((acc, payload) => {
    Object.entries(payload.status_code_totals || {}).forEach(([code, total]) => {
      const numeric = Number(code);
      acc[numeric] = (acc[numeric] || 0) + Number(total);
    });
    return acc;
  }, {} as Record<number, number>);
}

export function mergeBucketTotals(payloads: HeatmapPayload[]): Record<HeatmapCell["status_bucket"], number> {
  return payloads.reduce((acc, payload) => {
    HEATMAP_BUCKETS.forEach((bucket) => {
      acc[bucket] += payload.bucket_totals?.[bucket] ?? 0;
    });
    return acc;
  }, createEmptyBucketTotals());
}

export function bucketFromStatus(status: number): HeatmapCell["status_bucket"] {
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "client_error";
  if (status >= 500 && status < 600) return "server_error";
  return "other";
}
