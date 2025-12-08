import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Chip, Checkbox, Group, Loader, RangeSlider, SimpleGrid, Stack, Text, Tooltip } from "@mantine/core";
import type { HeatmapCell, HeatmapPayload } from "../lib/types";
import { formatBytes, statusColor } from "../lib/format";
import { useTranslations } from "../lib/i18n";
import { bucketFromStatus, mergeStatusTotals } from "../lib/heatmap";

const STATUS_OPTIONS: Array<{ value: HeatmapCell["status_bucket"]; label: string }> = [
  { value: "success", label: "2xx" },
  { value: "redirect", label: "3xx" },
  { value: "client_error", label: "4xx" },
  { value: "server_error", label: "5xx" },
  { value: "other", label: "Other" },
];

type AnnotatedCell = HeatmapCell & { __path?: string };

type Props = {
  baseUrl: string;
  payloads: HeatmapPayload[];
  selectedUrl: string | null;
  onSelectCell: (cell: HeatmapCell) => void;
  loading: boolean;
  onRefresh?: () => void;
};

export default function DirectoryPathsHeatmap({ baseUrl, payloads, selectedUrl, onSelectCell, loading, onRefresh }: Props) {
  const { t } = useTranslations();
  const [statusFilter, setStatusFilter] = useState<HeatmapCell["status_bucket"][]>([]);
  const [statusCodesFilter, setStatusCodesFilter] = useState<number[]>([]);
  const [uniqueSizeOnly, setUniqueSizeOnly] = useState(true);
  const [sizeRange, setSizeRange] = useState<[number, number]>([0, 0]);

  const annotatedCells = useMemo(() => {
    const annotate = (payload: HeatmapPayload): AnnotatedCell[] => {
      try {
        const parsed = new URL(payload.target_url);
        return payload.cells.map((cell) => ({ ...cell, __path: parsed.pathname || "/" }));
      } catch (error) {
        return payload.cells as AnnotatedCell[];
      }
    };
    if (!selectedUrl || selectedUrl === baseUrl) {
      return payloads.flatMap(annotate);
    }
    const match = payloads.find((payload) => payload.target_url === selectedUrl);
    return match ? annotate(match) : payloads.flatMap(annotate);
  }, [payloads, selectedUrl, baseUrl]);

  const relevantPayloads = useMemo(() => {
    if (!selectedUrl || selectedUrl === baseUrl) {
      return payloads;
    }
    const match = payloads.find((payload) => payload.target_url === selectedUrl);
    return match ? [match] : payloads;
  }, [payloads, selectedUrl, baseUrl]);

  const availableBuckets = useMemo(() => Array.from(new Set(annotatedCells.map((cell) => cell.status_bucket))), [annotatedCells]);

  useEffect(() => {
    if (availableBuckets.length === 0) {
      setStatusFilter([]);
    } else {
      setStatusFilter(availableBuckets);
    }
  }, [availableBuckets]);

  const statusLabelMap = useMemo(() => {
    return STATUS_OPTIONS.reduce<Record<HeatmapCell["status_bucket"], string>>((acc, option) => {
      acc[option.value] = option.value === "other" ? t("heatmap.otherBucket") : option.label;
      return acc;
    }, {} as Record<HeatmapCell["status_bucket"], string>);
  }, [t]);

  const statusCodeOptions = useMemo(() => {
    if (relevantPayloads.length === 0) return [];
    const merged = mergeStatusTotals(relevantPayloads);
    return Object.entries(merged)
      .map(([code, total]) => ({ code: Number(code), bucket: bucketFromStatus(Number(code)), total: Number(total) }))
      .sort((a, b) => a.code - b.code);
  }, [relevantPayloads]);

  useEffect(() => {
    setStatusCodesFilter(statusCodeOptions.map((option) => option.code));
  }, [statusCodeOptions]);

  const sizeBounds = useMemo(() => {
    if (annotatedCells.length === 0) return { min: 0, max: 0 };
    const bytes = annotatedCells.map((cell) => cell.bytes_total);
    return { min: Math.min(...bytes), max: Math.max(...bytes) };
  }, [annotatedCells]);

  useEffect(() => {
    setSizeRange([sizeBounds.min, sizeBounds.max]);
  }, [sizeBounds.min, sizeBounds.max]);

  const filteredCells = useMemo(() => {
    return annotatedCells.filter(
      (cell) =>
        statusFilter.includes(cell.status_bucket) &&
        (statusCodesFilter.length === 0 || statusCodesFilter.includes(cell.http_status)) &&
        cell.bytes_total >= sizeRange[0] &&
        cell.bytes_total <= sizeRange[1],
    );
  }, [annotatedCells, statusFilter, statusCodesFilter, sizeRange]);

  const displayCells = useMemo(() => {
    if (!uniqueSizeOnly) return filteredCells;
    const seen = new Set<number>();
    const dedup: AnnotatedCell[] = [];
    filteredCells.forEach((cell) => {
      if (seen.has(cell.bytes_total)) return;
      seen.add(cell.bytes_total);
      dedup.push(cell);
    });
    return dedup;
  }, [filteredCells, uniqueSizeOnly]);

  const activeFilters = useMemo(() => {
    const labels = statusFilter.map((bucket) => statusLabelMap[bucket] || bucket);
    const pathLabel = selectedUrl && selectedUrl !== baseUrl ? new URL(selectedUrl).pathname : t("heatmap.paths.allPaths");
    return [...labels, pathLabel];
  }, [statusFilter, statusLabelMap, selectedUrl, baseUrl, t]);

  const sliderMax = useMemo(() => {
    if (sizeBounds.max === sizeBounds.min) return sizeBounds.max + 1;
    return sizeBounds.max || 1;
  }, [sizeBounds.max, sizeBounds.min]);

  return (
    <Card withBorder shadow="xs" radius="md">
      <Stack>
        <Group gap="xs" wrap="wrap">
          <Text size="xs" fw={500}>
            {t("heatmap.activeFiltersLabel")}
          </Text>
          {activeFilters.length === 0 ? (
            <Text size="xs" c="dimmed">
              {t("heatmap.activeFiltersNone")}
            </Text>
          ) : (
            <Text size="xs">{activeFilters.join(", ")}</Text>
          )}
          <Button size="xs" variant="subtle" onClick={() => {
            setStatusFilter(availableBuckets);
            setStatusCodesFilter(statusCodeOptions.map((option) => option.code));
          }}>
            {t("heatmap.clearFilters")}
          </Button>
          <Checkbox
            size="xs"
            label={t("heatmap.uniqueSizeOnly")}
            checked={uniqueSizeOnly}
            onChange={(event) => setUniqueSizeOnly(event.currentTarget.checked)}
          />
        </Group>
        <Stack gap={4}>
          <Group justify="space-between" align="center">
            <Text size="sm" fw={500}>
              {t("heatmap.httpCodes")}
            </Text>
            <Text
              component="button"
              size="xs"
              c="blue"
              style={{ background: "none", border: "none", cursor: "pointer" }}
              onClick={() =>
                setStatusCodesFilter((current) =>
                  current.length === statusCodeOptions.length
                    ? []
                    : statusCodeOptions.map((option) => option.code),
                )
              }
            >
            </Text>
          </Group>
          <Chip.Group multiple value={statusCodesFilter.map(String)} onChange={(values) => setStatusCodesFilter(values.map(Number))}>
            <Group gap="xs">
              {statusCodeOptions.map((option) => (
                <Chip key={option.code} value={String(option.code)}>
                  {option.code} ({option.total})
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </Stack>
        <Stack gap={4}>
          <Group justify="space-between">
            <Text fw={500} size="sm">
              {t("heatmap.sizeFilter")}
            </Text>
            <Text size="sm" c="dimmed">
              {formatBytes(sizeRange[0])} – {formatBytes(sizeRange[1])}
            </Text>
          </Group>
          <RangeSlider min={sizeBounds.min} max={sliderMax} value={sizeRange} onChange={(value) => setSizeRange([Math.round(value[0]), Math.round(value[1])])} disabled={sizeBounds.max === sizeBounds.min} />
        </Stack>
        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : displayCells.length === 0 ? (
          <Text c="dimmed">{t("heatmap.noCells")}</Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
            {displayCells.map((cell) => {
              const intensity = sizeBounds.max ? Math.max(2, Math.round((cell.bytes_total / sizeBounds.max) * 9)) : 2;
              const color = statusColor(cell.status_bucket);
              const bg = `var(--mantine-color-${color}-${intensity})`;
              return (
                <Tooltip
                  key={`${cell.tested_host_header}-${cell.probe_id}`}
                  label={t("heatmap.tooltip", {
                    status: cell.http_status,
                    attempt: cell.attempt,
                    size: formatBytes(cell.bytes_total),
                  })}
                  withArrow
                >
                  <Card onClick={() => onSelectCell(cell)} style={{ backgroundColor: bg, cursor: "pointer" }} radius="md" shadow="sm" p="md" withBorder>
                    <Stack gap={4}>
                      <Text fw={600}>{cell.tested_host_header}</Text>
                      {cell.__path && (
                        <Text size="xs" c="dimmed">
                          {cell.__path}
                        </Text>
                      )}
                      <Text size="sm">{cell.http_status}</Text>
                      <Text size="sm" c="dimmed">
                        {t("heatmap.rawLabel")}: {formatBytes(cell.bytes_total)}
                      </Text>
                        {cell.sni_overridden && (
                          <Badge size="xs" color="violet">
                            SNI OVERRIDE
                          </Badge>
                        )}
                    </Stack>
                  </Card>
                </Tooltip>
              );
            })}
          </SimpleGrid>
        )}
      </Stack>
    </Card>
  );
}
