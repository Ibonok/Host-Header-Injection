import { useCallback, useEffect, useMemo, useState } from "react";
import { ActionIcon, Container, Loader, Stack, Tabs, Title } from "@mantine/core";
import { useRouter } from "next/router";
import RunBreadcrumbs from "../../components/RunBreadcrumbs";
import RunSummaryCards from "../../components/RunSummaryCards";
import HeatmapPanel, { TargetSummary } from "../../components/HeatmapPanel";
import RunnerLogsPanel from "../../components/RunnerLogsPanel";
import ProbeDrawer from "../../components/ProbeDrawer";
import DirectoryPathsCard from "../../components/DirectoryPathsCard";
import { IconX } from "@tabler/icons-react";
import { useAsyncData } from "../../lib/hooks";
import { fetch421Summary, fetchHeatmap, fetchRun, fetchRunnerLogs } from "../../lib/api";
import type { HeatmapCell, HeatmapPayload } from "../../lib/types";
import { useTranslations } from "../../lib/i18n";
import { normalizeHeatmapPayload } from "../../lib/heatmap";

export default function RunDetailPage() {
  const router = useRouter();
  const runId = typeof router.query.id === "string" ? Number(router.query.id) : null;
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<HeatmapCell | null>(null);
  const [logOffset, setLogOffset] = useState(0);
  const [pathTabs, setPathTabs] = useState<TargetSummary[]>([]);
  const [activeTab, setActiveTab] = useState("heatmap");
  const logLimit = 50;
  const { t } = useTranslations();

  const runQuery = useAsyncData(
    () => {
      if (!runId) return Promise.reject(new Error(t("runDetail.noRun")));
      return fetchRun(runId);
    },
    [runId, t],
    { immediate: Boolean(runId) },
  );

  const heatmapFetcher = useCallback(() => {
    if (!runId) return Promise.reject(new Error(t("runDetail.noRun")));
    return fetchHeatmap(runId, { uniqueSizeOnly: true });
  }, [runId, t]);

  const heatmapQuery = useAsyncData(heatmapFetcher, [runId, t], {
    immediate: Boolean(runId),
  });

  const [payloads, setPayloads] = useState<HeatmapPayload[]>([]);

  useEffect(() => {
    if (heatmapQuery.data) {
      setPayloads(heatmapQuery.data.map((payload) => normalizeHeatmapPayload(payload)));
    }
  }, [heatmapQuery.data]);

  const summaryQuery = useAsyncData(
    () => {
      if (!runId) return Promise.resolve(null);
      return fetch421Summary(runId);
    },
    [runId],
    { immediate: Boolean(runId) },
  );

  useEffect(() => {
    setLogOffset(0);
  }, [runId]);

  const logsQuery = useAsyncData(
    () => {
      if (!runId) return Promise.resolve([]);
      return fetchRunnerLogs(runId, { limit: logLimit, offset: logOffset });
    },
    [runId, logOffset],
    { immediate: false },
  );

  const pageReady = Boolean(runQuery.data && runId);

  const initialSelectedUrl = useMemo(() => payloads[0]?.target_url || null, [payloads]);

  const handleToggleUnique = useCallback(
    async (base: string, unique: boolean) => {
      if (!runId) return;
      const targetsForBase = payloads
        .filter((p) => {
          try {
            const parsed = new URL(p.target_url);
            const candidateBase = `${parsed.protocol}//${parsed.host}`;
            return candidateBase === base;
          } catch (err) {
            return false;
          }
        })
        .map((p) => p.target_url);

      if (targetsForBase.length === 0) return;

      try {
        const results = await Promise.all(
          targetsForBase.map(async (targetUrl) => {
            const data = await fetchHeatmap(runId, { uniqueSizeOnly: unique, targetUrl });
            const payload = data?.[0];
            return payload ? normalizeHeatmapPayload(payload) : null;
          }),
        );
        setPayloads((current) => {
          const next = [...current];
          results.forEach((payload) => {
            if (!payload) return;
            const idx = next.findIndex((p) => p.target_url === payload.target_url);
            if (idx >= 0) {
              next[idx] = payload;
            } else {
              next.push(payload);
            }
          });
          return next;
        });
      } catch (error) {
        console.error("Failed to refetch heatmap for", base, error);
      }
    },
    [payloads, runId],
  );

  useEffect(() => {
    if (!selectedUrl && initialSelectedUrl) {
      setSelectedUrl(initialSelectedUrl);
    }
  }, [initialSelectedUrl, selectedUrl]);

  useEffect(() => {
    if (selectedUrl && payloads.length > 0) {
      const existsExact = payloads.some((payload) => payload.target_url === selectedUrl);
      const existsBase = payloads.some((payload) => {
        try {
          const parsed = new URL(payload.target_url);
          const base = `${parsed.protocol}//${parsed.host}`;
          return base === selectedUrl;
        } catch (error) {
          return false;
        }
      });
      if (!existsExact && !existsBase) {
        setSelectedUrl(payloads[0]?.target_url || null);
      }
    }
  }, [payloads, selectedUrl]);

  if (!runId) {
    return (
      <Container size="xl">
        <Title order={3}>{t("runDetail.invalidId")}</Title>
      </Container>
    );
  }

  if (runQuery.loading && !runQuery.data) {
    return (
      <Container size="xl">
        <Stack align="center" py="xl">
          <Loader />
        </Stack>
      </Container>
    );
  }

  if (runQuery.error) {
    return (
      <Container size="xl">
        <Title order={3}>{t("runDetail.errorWithMessage", { message: runQuery.error.message })}</Title>
      </Container>
    );
  }

  if (!pageReady) {
    return (
      <Container size="xl">
        <Title order={3}>{t("runDetail.missing")}</Title>
      </Container>
    );
  }

  const handleExpandPaths = (summary: TargetSummary) => {
    setPathTabs((current) => {
      if (current.some((tab) => tab.base === summary.base)) return current;
      return [...current, summary];
    });
    setActiveTab(summary.base);
    setSelectedUrl(summary.base);
  };

  const handleClosePathTab = (base: string) => {
    setPathTabs((current) => current.filter((tab) => tab.base !== base));
    setActiveTab((current) => (current === base ? "heatmap" : current));
  };

  return (
    <Container size="xl">
      <Stack gap="md">
        <RunBreadcrumbs current={runQuery.data?.name || ""} />
        <RunSummaryCards run={runQuery.data} summary={summaryQuery.data || null} />
        <Tabs value={activeTab} onChange={(value) => setActiveTab(value || "heatmap")} keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="heatmap">{t("runDetail.tabs.heatmap")}</Tabs.Tab>
            {pathTabs.map((tab) => (
              <Tabs.Tab key={tab.base} value={tab.base} leftSection={
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleClosePathTab(tab.base);
                  }}
                  aria-label={t("heatmap.paths.close")}
                >
                  <IconX size={14} />
                </ActionIcon>
              }>
                {tab.base}
              </Tabs.Tab>
            ))}
            <Tabs.Tab value="logs">{t("runDetail.tabs.logs")}</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="heatmap" pt="md">
            <HeatmapPanel
              payloads={payloads}
              loading={heatmapQuery.loading}
              selectedUrl={selectedUrl}
              onSelectUrl={(url) => setSelectedUrl(url)}
              onSelectCell={(cell) => setActiveCell(cell)}
              onRefresh={() => heatmapQuery.refresh()}
              onExpandPaths={handleExpandPaths}
              onToggleUnique={handleToggleUnique}
            />
          </Tabs.Panel>
          {pathTabs.map((tab) => (
            <Tabs.Panel key={tab.base} value={tab.base} pt="md">
              <DirectoryPathsCard
                summary={tab}
                payloads={payloads.filter((payload) => tab.paths.some((entry) => entry.url === payload.target_url))}
                loading={heatmapQuery.loading}
                selectedUrl={selectedUrl}
                onSelectUrl={(url) => {
                  setSelectedUrl(url);
                  setActiveTab(tab.base);
                }}
                onSelectCell={(cell) => setActiveCell(cell)}
                onRefresh={() => heatmapQuery.refresh()}
              />
            </Tabs.Panel>
          ))}
          <Tabs.Panel value="logs" pt="md">
            <RunnerLogsPanel
              logs={logsQuery.data || []}
              loading={logsQuery.loading}
              canLoadOlder={(logsQuery.data || []).length === logLimit}
              canLoadNewer={logOffset > 0}
              onLoadOlder={() => setLogOffset((current) => current + logLimit)}
              onLoadNewer={() => setLogOffset((current) => Math.max(0, current - logLimit))}
              onJumpLatest={() => setLogOffset(0)}
              isLatestPage={logOffset === 0}
              onRefresh={() => logsQuery.refresh()}
            />
          </Tabs.Panel>
        </Tabs>
      </Stack>
      <ProbeDrawer
        probeId={activeCell?.probe_id || null}
        opened={Boolean(activeCell)}
        onClose={() => setActiveCell(null)}
      />
    </Container>
  );
}
