import { Card, SimpleGrid, Stack, Text, Table, Group, Tooltip } from "@mantine/core";
import type { HeatmapCell, HeatmapPayload } from "../lib/types";
import DirectoryPathsHeatmap from "./DirectoryPathsHeatmap";
import type { TargetSummary } from "./HeatmapPanel";
import { useMemo } from "react";
import { useTranslations } from "../lib/i18n";

type Props = {
  summary: TargetSummary;
  payloads: HeatmapPayload[];
  loading: boolean;
  selectedUrl: string | null;
  onSelectUrl: (url: string | null) => void;
  onSelectCell: (cell: HeatmapCell) => void;
  onRefresh?: () => void;
};

export default function DirectoryPathsCard({
  summary,
  payloads,
  loading,
  selectedUrl,
  onSelectUrl,
  onSelectCell,
  onRefresh,
}: Props) {
  const { t } = useTranslations();
  const filteredPayloads = useMemo(() => {
    const urls = new Set(summary.paths.map((entry) => entry.url));
    return payloads.filter((payload) => urls.has(payload.target_url));
  }, [payloads, summary.paths]);

  return (
    <Card withBorder shadow="xs" radius="md">
      <Stack gap="md">
        <Group gap={4} align="center">
          <Text fw={600}>{summary.base}</Text>
          {summary.hitBlacklist && (
            <Tooltip label={t("heatmap.ipBlacklistTooltip")} withArrow>
              <Text component="span" fw={700} c="red">
                *
              </Text>
            </Tooltip>
          )}
        </Group>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Stack gap="xs">
            <Table highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("heatmap.paths.pathHeader")}</Table.Th>
                  <Table.Th>{t("heatmap.paths.select")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                <Table.Tr
                  onClick={() => onSelectUrl(summary.base)}
                  style={{ cursor: "pointer", backgroundColor: selectedUrl === summary.base ? "var(--mantine-color-teal-0)" : undefined }}
                >
                  <Table.Td>{t("heatmap.paths.allPaths")}</Table.Td>
                  <Table.Td>{summary.paths.length}</Table.Td>
                </Table.Tr>
                {summary.paths.map((entry) => (
                  <Table.Tr
                    key={`${summary.base}-${entry.path}`}
                    onClick={() => onSelectUrl(entry.url)}
                    style={{ cursor: "pointer", backgroundColor: selectedUrl === entry.url ? "var(--mantine-color-teal-0)" : undefined }}
                  >
                    <Table.Td>{entry.path}</Table.Td>
                    <Table.Td>{entry.url}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
          <DirectoryPathsHeatmap
            baseUrl={summary.base}
            payloads={filteredPayloads}
            selectedUrl={selectedUrl}
            onSelectCell={onSelectCell}
            loading={loading}
            onRefresh={onRefresh}
          />
        </SimpleGrid>
      </Stack>
    </Card>
  );
}
