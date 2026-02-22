import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Chip,
  Group,
  Loader,
  RangeSlider,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import type { HeatmapCell, HeatmapPayload } from "../lib/types";
import { formatBytes, statusColor } from "../lib/format";
import { useTranslations } from "../lib/i18n";
import { bucketFromStatus, createEmptyBucketTotals, mergeBucketTotals, mergeStatusTotals } from "../lib/heatmap";

export type TargetSummary = {
  base: string;
  total: number;
  counts: Record<HeatmapCell["status_bucket"], number>;
  minBytes: number;
  maxBytes: number;
  paths: Array<{ path: string; url: string }>;
  autoOverride: boolean;
  hitBlacklist: boolean;
};

export type HeatmapHeaderProps = {
  filters: string[];
  onClearFilters: () => void;
  targetsCount: number;
  onRefresh?: () => void;
  loading: boolean;
};

type Props = {
  payloads: HeatmapPayload[];
  loading: boolean;
  selectedUrl: string | null;
  onSelectUrl: (value: string | null) => void;
  onSelectCell: (cell: HeatmapCell) => void;
  onRefresh?: () => void;
  showPathTable?: boolean;
  onExpandPaths?: (summary: TargetSummary) => void;
  showHeader?: boolean;
  renderHeader?: (info: HeatmapHeaderProps) => React.ReactNode;
  onToggleUnique?: (base: string, unique: boolean) => void;
};

const STATUS_OPTIONS: Array<{ value: HeatmapCell["status_bucket"]; label: string }> = [
  { value: "success", label: "2xx" },
  { value: "redirect", label: "3xx" },
  { value: "client_error", label: "4xx" },
  { value: "server_error", label: "5xx" },
  { value: "other", label: "Other" },
];

const PATH_PREVIEW_LIMIT = 1;

type AnnotatedHeatmapCell = HeatmapCell & { __path?: string };

function annotateCells(cells: HeatmapCell[], path: string): AnnotatedHeatmapCell[] {
  const normalized = path || "/";
  return cells.map((cell) => ({ ...cell, __path: normalized }));
}

export default function HeatmapPanel({
  payloads,
  loading,
  selectedUrl,
  onSelectUrl,
  onSelectCell,
  onRefresh,
  showPathTable = true,
  onExpandPaths,
  showHeader = true,
  renderHeader,
  onToggleUnique,
}: Props) {
  const { t } = useTranslations();
  const [statusFilter, setStatusFilter] = useState<HeatmapCell["status_bucket"][]>([]);
  const [sizeRange, setSizeRange] = useState<[number, number]>([0, 0]);
  const [statusCodesFilter, setStatusCodesFilter] = useState<number[]>([]);
  const [uniqueSizeByBase, setUniqueSizeByBase] = useState<Record<string, boolean>>({});

  const parsedPayloads = useMemo(() => {
    return payloads
      .map((payload) => {
        try {
          const parsed = new URL(payload.target_url);
          const base = `${parsed.protocol}//${parsed.host}`;
          let path = parsed.pathname || "/";
          if (!path.startsWith("/")) path = `/${path}`;
          return { payload, base, path };
        } catch {
          return null;
        }
      })
      .filter(Boolean) as Array<{ payload: HeatmapPayload; base: string; path: string }>;
  }, [payloads]);

  const targetSummaries = useMemo<TargetSummary[]>(() => {
    const summaryMap = new Map<
      string,
      {
        base: string;
        total: number;
        counts: Record<HeatmapCell["status_bucket"], number>;
        minBytes: number;
        maxBytes: number;
        paths: Map<string, string>;
        autoOverride: boolean;
        hitBlacklist: boolean;
      }
    >();

    parsedPayloads.forEach(({ payload, base, path }) => {
      const existing = summaryMap.get(base) ?? {
        base,
        total: 0,
        counts: createEmptyBucketTotals(),
        minBytes: Number.MAX_SAFE_INTEGER,
        maxBytes: 0,
        paths: new Map<string, string>(),
        autoOverride: false,
        hitBlacklist: false,
      };
      const bucketTotals = payload.bucket_totals;
      const payloadTotal = Object.values(bucketTotals).reduce((acc, value) => acc + value, 0);
      existing.total += payloadTotal;
      STATUS_OPTIONS.forEach((option) => {
        const increment = bucketTotals[option.value] || 0;
        existing.counts[option.value] = (existing.counts[option.value] || 0) + increment;
      });
      payload.cells.forEach((cell) => {
        existing.maxBytes = Math.max(existing.maxBytes, cell.bytes_total);
        existing.minBytes = Math.min(existing.minBytes, cell.bytes_total);
      });
      existing.paths.set(path, payload.target_url);
      if (payload.auto_override_421) {
        existing.autoOverride = true;
      }
      if (payload.hit_ip_blacklist) {
        existing.hitBlacklist = true;
      }
      summaryMap.set(base, existing);
    });

    return Array.from(summaryMap.values()).map((item) => ({
      base: item.base,
      total: item.total,
      counts: item.counts,
      minBytes: item.total > 0 ? item.minBytes : 0,
      maxBytes: item.total > 0 ? item.maxBytes : 0,
      autoOverride: item.autoOverride,
      hitBlacklist: item.hitBlacklist,
      paths: Array.from(item.paths.entries())
        .map(([path, url]) => ({ path, url }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    }));
  }, [parsedPayloads]);

  useEffect(() => {
    setUniqueSizeByBase((current) => {
      const next: Record<string, boolean> = {};
      let changed = Object.keys(current).length !== targetSummaries.length;
      targetSummaries.forEach((summary) => {
        if (current[summary.base] === undefined) {
          changed = true;
        }
        next[summary.base] = current[summary.base] ?? true;
      });
      return changed ? next : current;
    });
  }, [targetSummaries]);

  const activeSelection = useMemo(() => {
    if (parsedPayloads.length === 0) {
      return null;
    }
    const annotatePayload = (payload: HeatmapPayload, path: string) => ({
      ...payload,
      cells: annotateCells(payload.cells, path),
    });

    const exactMatch = selectedUrl
      ? parsedPayloads.find((entry) => entry.payload.target_url === selectedUrl)
      : null;
    if (exactMatch) {
      return {
        payload: annotatePayload(exactMatch.payload, exactMatch.path),
        base: exactMatch.base,
        path: exactMatch.path,
      };
    }
    if (selectedUrl) {
      const grouped = parsedPayloads.filter((entry) => entry.base === selectedUrl);
      if (grouped.length > 0) {
        const mergedStatus = mergeStatusTotals(grouped.map((entry) => entry.payload));
        const mergedBuckets = mergeBucketTotals(grouped.map((entry) => entry.payload));
        const combinedCells = grouped.flatMap((entry) => annotateCells(entry.payload.cells, entry.path));
        const autoOverride = grouped.some((entry) => entry.payload.auto_override_421);
        const hitBlacklist = grouped.some((entry) => entry.payload.hit_ip_blacklist);
        return {
          payload: {
            ...grouped[0].payload,
            cells: combinedCells,
            status_code_totals: mergedStatus,
            bucket_totals: mergedBuckets,
            auto_override_421: autoOverride,
            hit_ip_blacklist: hitBlacklist,
          },
          base: grouped[0].base,
          path: null,
        };
      }
    }
    const fallback = parsedPayloads[0];
    return {
      payload: annotatePayload(fallback.payload, fallback.path),
      base: fallback.base,
      path: fallback.path,
    };
  }, [parsedPayloads, selectedUrl]);

  const activePayload = activeSelection?.payload ?? null;
  const activePathFilter = activeSelection?.path ?? null;
  const activeBase = activeSelection?.base ?? null;
  const activeUniqueOnly = activeBase ? uniqueSizeByBase[activeBase] ?? true : true;

  const handleToggleUniqueForBase = useCallback((base: string) => {
    setUniqueSizeByBase((current) => {
      const nextValue = !(current[base] ?? true);
      const next = { ...current, [base]: nextValue };
      if (onToggleUnique) {
        onToggleUnique(base, nextValue);
      }
      return next;
    });
  }, [onToggleUnique]);

  const maxBytes = useMemo(() => {
    if (!activePayload) return 0;
    return activePayload.cells.reduce((acc, cell) => Math.max(acc, cell.bytes_total), 0);
  }, [activePayload]);

  const sizeBounds = useMemo(() => {
    if (!activePayload || activePayload.cells.length === 0) {
      return { min: 0, max: 0 };
    }
    const bytes = activePayload.cells.map((cell) => cell.bytes_total);
    return {
      min: Math.min(...bytes),
      max: Math.max(...bytes),
    };
  }, [activePayload]);

  useEffect(() => {
    setSizeRange([sizeBounds.min, sizeBounds.max]);
  }, [sizeBounds.min, sizeBounds.max]);


  const availableBucketValues = useMemo(() => {
    if (!activePayload) return [];
    return Array.from(new Set(activePayload.cells.map((cell) => cell.status_bucket)));
  }, [activePayload]);

  const bucketOptions = useMemo(() => {
    if (availableBucketValues.length === 0) {
      return STATUS_OPTIONS;
    }
    return STATUS_OPTIONS.filter((option) => availableBucketValues.includes(option.value));
  }, [availableBucketValues]);

  const statusLabelMap = useMemo(() => {
    return STATUS_OPTIONS.reduce<Record<HeatmapCell["status_bucket"], string>>((acc, option) => {
      acc[option.value] = option.value === "other" ? t("heatmap.otherBucket") : option.label;
      return acc;
    }, {} as Record<HeatmapCell["status_bucket"], string>);
  }, [t]);

  const statusCodeOptions = useMemo(() => {
    if (!activePayload) return [];
    return Object.entries(activePayload.status_code_totals || {})
      .map(([code, total]) => {
        const numeric = Number(code);
        return { code: numeric, bucket: bucketFromStatus(numeric), total: Number(total) };
      })
      .sort((a, b) => a.code - b.code);
  }, [activePayload]);

  useEffect(() => {
    if (availableBucketValues.length === 0) {
      setStatusFilter([]);
      return;
    }
    setStatusFilter(availableBucketValues);
  }, [availableBucketValues]);

  useEffect(() => {
    setStatusCodesFilter(statusCodeOptions.map((option) => option.code));
  }, [statusCodeOptions]);

  const handleToggleStatusBucket = useCallback((bucket: HeatmapCell["status_bucket"]) => {
    setStatusFilter((current) => {
      const exists = current.includes(bucket);
      if (exists) {
        return current.filter((value) => value !== bucket);
      }
      return [...current, bucket];
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setStatusFilter(bucketOptions.map((option) => option.value));
    setStatusCodesFilter(statusCodeOptions.map((option) => option.code));
    if (activePathFilter && activeBase) {
      onSelectUrl(activeBase);
    }
  }, [bucketOptions, statusCodeOptions, activePathFilter, activeBase, onSelectUrl]);

  const activeStatusLabels = useMemo(() => {
    if (statusFilter.length === 0) return [];
    return statusFilter.map((status) => statusLabelMap[status] || status);
  }, [statusFilter, statusLabelMap]);

  const combinedActiveFilters = useMemo(() => {
    const filters = [...activeStatusLabels];
    if (activePathFilter) {
      filters.push(activePathFilter);
    }
    return filters;
  }, [activeStatusLabels, activePathFilter]);

  const headerInfo: HeatmapHeaderProps = {
    filters: combinedActiveFilters,
    onClearFilters: handleClearFilters,
    targetsCount: targetSummaries.length,
    onRefresh,
    loading,
  };

  const filteredCells = useMemo<AnnotatedHeatmapCell[]>(() => {
    if (!activePayload) return [];
    const typedCells = activePayload.cells as AnnotatedHeatmapCell[];
    return typedCells.filter(
      (cell) =>
        statusFilter.includes(cell.status_bucket) &&
        (statusCodesFilter.length === 0 || statusCodesFilter.includes(cell.http_status)) &&
        cell.bytes_total >= sizeRange[0] &&
        cell.bytes_total <= sizeRange[1],
    );
  }, [activePayload, statusFilter, statusCodesFilter, sizeRange]);

  const displayCells = useMemo(() => {
    if (!activeUniqueOnly) return filteredCells;
    const seen = new Set<number>();
    const dedup: AnnotatedHeatmapCell[] = [];
    filteredCells.forEach((cell) => {
      if (seen.has(cell.bytes_total)) {
        return;
      }
      seen.add(cell.bytes_total);
      dedup.push(cell);
    });
    return dedup;
  }, [filteredCells, activeUniqueOnly]);

  const DISPLAY_LIMIT = 200;
  const [displayLimit, setDisplayLimit] = useState(DISPLAY_LIMIT);

  useEffect(() => {
    setDisplayLimit(DISPLAY_LIMIT);
  }, [displayCells.length]);

  const visibleCells = useMemo(() => displayCells.slice(0, displayLimit), [displayCells, displayLimit]);
  const hasMore = displayCells.length > displayLimit;

  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

  const sliderMax = useMemo(() => {
    if (sizeBounds.max === sizeBounds.min) {
      return sizeBounds.max + 1;
    }
    return sizeBounds.max || 1;
  }, [sizeBounds.max, sizeBounds.min]);

  return (
    <Card withBorder shadow="xs" radius="md">
      <Stack>
        {(showHeader || renderHeader) && (
          renderHeader ? (
            renderHeader(headerInfo)
          ) : (
            <>
              <Stack gap={4}>
                <Text fw={600}>{t("heatmap.title")}</Text>
                <Text size="sm" c="dimmed">
                  {t("heatmap.hint")}
                </Text>
                <Group gap="xs" wrap="wrap">
                  <Text size="xs" fw={500}>
                    {t("heatmap.activeFiltersLabel")}
                  </Text>
                  {headerInfo.filters.length === 0 ? (
                    <Text size="xs" c="dimmed">
                      {t("heatmap.activeFiltersNone")}
                    </Text>
                  ) : (
                    <Text size="xs">{headerInfo.filters.join(", ")}</Text>
                  )}
                  {headerInfo.filters.length > 0 && (
                    <Button size="xs" variant="subtle" onClick={headerInfo.onClearFilters}>
                      {t("heatmap.clearFilters")}
                    </Button>
                  )}
                </Group>
              </Stack>
              <Group justify="space-between" align="center">
                <Text size="sm" c="dimmed">
                  {t("heatmap.targetsCount", { count: headerInfo.targetsCount })}
                </Text>
                <Group gap="xs">
                  <SegmentedControl
                    size="xs"
                    value={viewMode}
                    onChange={(value) => setViewMode(value as "grid" | "table")}
                    data={[
                      { label: t("heatmap.viewGrid"), value: "grid" },
                      { label: t("heatmap.viewTable"), value: "table" },
                    ]}
                  />
                  {headerInfo.onRefresh && (
                    <Button size="xs" variant="light" onClick={headerInfo.onRefresh} disabled={headerInfo.loading}>
                      {t("heatmap.refresh")}
                    </Button>
                  )}
                </Group>
              </Group>
            </>
          )
        )}
        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : !activePayload ? (
          <Text c="dimmed">{t("heatmap.empty")}</Text>
        ) : showPathTable ? (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Stack gap="xs">
              <Text fw={500} size="sm">
                {t("heatmap.table.targetsHeader")}
              </Text>
              <ScrollArea h={400}>
                <Table highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("heatmap.table.targetUrl")}</Table.Th>
                      <Table.Th>{t("heatmap.table.status")}</Table.Th>
                      <Table.Th>{t("heatmap.table.sizeRange")}</Table.Th>
                      <Table.Th>{t("heatmap.uniqueSizeOnly")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {targetSummaries.map((row) => {
                      const isActive =
                        selectedUrl === row.base || row.paths.some((entry) => entry.url === selectedUrl);
                      const baseUnique = uniqueSizeByBase[row.base] ?? true;
                      return (
                        <Table.Tr
                          key={row.base}
                          onClick={() => onSelectUrl(row.base)}
                          style={{
                            cursor: "pointer",
                            backgroundColor: isActive ? "var(--mantine-color-gray-7)" : undefined,
                          }}
                        >
                          <Table.Td>
                            <Stack gap={2}>
                              <Group gap={4} align="center">
                                <Text size="sm" fw={600}>{row.base}</Text>
                                {row.autoOverride && (
                                  <Tooltip label={t("heatmap.auto421Tooltip")} withArrow>
                                    <Text component="span" fw={700} c="yellow">
                                      *
                                    </Text>
                                  </Tooltip>
                                )}
                                {row.hitBlacklist && (
                                  <Tooltip label={t("heatmap.ipBlacklistTooltip")} withArrow>
                                    <Text component="span" fw={700} c="red">
                                      *
                                    </Text>
                                  </Tooltip>
                                )}
                              </Group>
                              <Text size="xs" c="dimmed">
                                {t("heatmap.table.probes", { count: row.total })}
                              </Text>
                              <Stack gap={0} pl="sm">
                                {row.paths.slice(0, PATH_PREVIEW_LIMIT).map((entry) => (
                                  <Text
                                    key={entry.path}
                                    size="xs"
                                    c="dimmed"
                                    component="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onSelectUrl(entry.url);
                                    }}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      textAlign: "left",
                                      padding: 0,
                                      cursor: "pointer",
                                    }}
                                  >
                                    - {entry.path}
                                  </Text>
                                ))}
                                {row.paths.length > PATH_PREVIEW_LIMIT && (
                                  <Text
                                    size="xs"
                                    c="blue"
                                    component="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      onExpandPaths?.(row);
                                    }}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      textAlign: "left",
                                      padding: 0,
                                      cursor: "pointer",
                                    }}
                                  >
                                    … {t("heatmap.paths.showAll")}
                                  </Text>
                                )}
                              </Stack>
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap="wrap">
                              {STATUS_OPTIONS.filter((option) => option.value !== "other" || row.counts.other > 0).map(
                                (option) => {
                                  const badgeLabel =
                                    option.value === "other" ? t("heatmap.otherBucket") : option.label;
                                  const isActiveBucket = statusFilter.includes(option.value);
                                  return (
                                    <Badge
                                      key={option.value}
                                      size="sm"
                                      color={statusColor(option.value)}
                                      variant={isActiveBucket ? "filled" : "outline"}
                                      component="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleToggleStatusBucket(option.value);
                                      }}
                                      style={{ cursor: "pointer" }}
                                    >
                                      {badgeLabel}: {row.counts[option.value] || 0}
                                    </Badge>
                                  );
                                },
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            {row.total > 0
                              ? `${formatBytes(row.minBytes)} – ${formatBytes(row.maxBytes)}`
                              : "—"}
                          </Table.Td>
                          <Table.Td>
                            <Switch
                              checked={baseUnique}
                              onChange={(event) => {
                                event.stopPropagation();
                                handleToggleUniqueForBase(row.base);
                              }}
                              aria-label={baseUnique ? t("heatmap.uniqueSizeOnly") : t("heatmap.showAllSizes")}
                              size="xs"
                            />
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Stack>
            <Stack gap="sm">
              {statusCodeOptions.length > 0 && (
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
                  <Chip.Group
                    multiple
                    value={statusCodesFilter.map(String)}
                    onChange={(values) => setStatusCodesFilter(values.map(Number))}
                  >
                    <Group gap="xs">
                      {statusCodeOptions.map((option) => (
                        <Chip key={option.code} value={String(option.code)}>
                          {option.code} ({option.total})
                        </Chip>
                      ))}
                    </Group>
                  </Chip.Group>
                </Stack>
              )}
              <Stack gap={4}>
                <Group justify="space-between">
                  <Text fw={500} size="sm">
                    {t("heatmap.sizeFilter")}
                  </Text>
                  <Text size="sm" c="dimmed">
                    {t("heatmap.sizeRange", {
                      min: formatBytes(sizeRange[0]),
                      max: formatBytes(sizeRange[1]),
                    })}
                  </Text>
                </Group>
                <RangeSlider
                  min={sizeBounds.min}
                  max={sliderMax}
                  value={sizeRange}
                  onChange={(value) => setSizeRange([Math.round(value[0]), Math.round(value[1])])}
                  disabled={sizeBounds.max === sizeBounds.min}
                />
              </Stack>
              {displayCells.length === 0 && <Text c="dimmed">{t("heatmap.noCells")}</Text>}
              {viewMode === "table" ? (
                <Table striped highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("heatmap.tableColumns.host")}</Table.Th>
                      <Table.Th>{t("heatmap.tableColumns.status")}</Table.Th>
                      <Table.Th>{t("heatmap.tableColumns.size")}</Table.Th>
                      <Table.Th>{t("heatmap.tableColumns.attempt")}</Table.Th>
                      <Table.Th>{t("heatmap.tableColumns.sni")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {visibleCells.map((cell) => (
                      <Table.Tr
                        key={`${cell.tested_host_header}-${cell.probe_id}`}
                        style={{ cursor: "pointer" }}
                        onClick={() => onSelectCell(cell)}
                      >
                        <Table.Td>
                          <Text size="sm" fw={500}>{cell.tested_host_header}</Text>
                          {cell.__path && <Text size="xs" c="dimmed">{cell.__path}</Text>}
                        </Table.Td>
                        <Table.Td>
                          <Badge color={statusColor(cell.status_bucket)} variant="light" size="sm">
                            {cell.http_status}
                          </Badge>
                        </Table.Td>
                        <Table.Td><Text size="sm">{formatBytes(cell.bytes_total)}</Text></Table.Td>
                        <Table.Td><Text size="sm">{cell.attempt}</Text></Table.Td>
                        <Table.Td>
                          {cell.sni_overridden && <Badge size="xs" color="violet">SNI</Badge>}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                  {visibleCells.map((cell) => {
                    const intensity = maxBytes ? Math.max(2, Math.round((cell.bytes_total / maxBytes) * 9)) : 2;
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
                        <Card
                          onClick={() => onSelectCell(cell)}
                          style={{ backgroundColor: bg, cursor: "pointer" }}
                          radius="md"
                          shadow="sm"
                          p="md"
                          withBorder
                        >
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
              {hasMore && (
                <Button variant="light" size="xs" onClick={() => setDisplayLimit((l) => l + DISPLAY_LIMIT)}>
                  Show {Math.min(DISPLAY_LIMIT, displayCells.length - displayLimit)} more ({displayCells.length - displayLimit} remaining)
                </Button>
              )}
            </Stack>
          </SimpleGrid>
        ) : (
          <Stack gap="sm">
            {statusCodeOptions.length > 0 && (
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
                <Chip.Group
                  multiple
                  value={statusCodesFilter.map(String)}
                  onChange={(values) => setStatusCodesFilter(values.map(Number))}
                >
                  <Group gap="xs">
                    {statusCodeOptions.map((option) => (
                      <Chip key={option.code} value={String(option.code)}>
                        {option.code} ({option.total})
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
              </Stack>
            )}
            {displayCells.length === 0 && <Text c="dimmed">{t("heatmap.noCells")}</Text>}
            {viewMode === "table" ? (
              <Table striped highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t("heatmap.tableColumns.host")}</Table.Th>
                    <Table.Th>{t("heatmap.tableColumns.status")}</Table.Th>
                    <Table.Th>{t("heatmap.tableColumns.size")}</Table.Th>
                    <Table.Th>{t("heatmap.tableColumns.attempt")}</Table.Th>
                    <Table.Th>{t("heatmap.tableColumns.sni")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {visibleCells.map((cell) => (
                    <Table.Tr
                      key={`${cell.tested_host_header}-${cell.probe_id}`}
                      style={{ cursor: "pointer" }}
                      onClick={() => onSelectCell(cell)}
                    >
                      <Table.Td>
                        <Text size="sm" fw={500}>{cell.tested_host_header}</Text>
                        {cell.__path && <Text size="xs" c="dimmed">{cell.__path}</Text>}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={statusColor(cell.status_bucket)} variant="light" size="sm">
                          {cell.http_status}
                        </Badge>
                      </Table.Td>
                      <Table.Td><Text size="sm">{formatBytes(cell.bytes_total)}</Text></Table.Td>
                      <Table.Td><Text size="sm">{cell.attempt}</Text></Table.Td>
                      <Table.Td>
                        {cell.sni_overridden && <Badge size="xs" color="violet">SNI</Badge>}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ) : (
              <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
                {visibleCells.map((cell) => {
                  const intensity = maxBytes ? Math.max(2, Math.round((cell.bytes_total / maxBytes) * 9)) : 2;
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
                      <Card
                        onClick={() => onSelectCell(cell)}
                        style={{ backgroundColor: bg, cursor: "pointer" }}
                        radius="md"
                        shadow="sm"
                        p="md"
                        withBorder
                      >
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
            {hasMore && (
              <Button variant="light" size="xs" onClick={() => setDisplayLimit((l) => l + DISPLAY_LIMIT)}>
                Show {Math.min(DISPLAY_LIMIT, displayCells.length - displayLimit)} more ({displayCells.length - displayLimit} remaining)
              </Button>
            )}
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
