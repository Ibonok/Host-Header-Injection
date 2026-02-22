import { Badge, Card, Group, Loader, Stack, Table, Text } from "@mantine/core";
import type { SequenceGroupResult, SequenceTiming } from "../lib/types";
import { useTranslations } from "../lib/i18n";

type Props = {
  result: SequenceGroupResult | null;
  loading: boolean;
  onSelectProbe?: (probeId: number) => void;
};

function statusBadgeColor(status: number | null | undefined): string {
  if (!status) return "gray";
  if (status >= 200 && status < 300) return "green";
  if (status >= 300 && status < 400) return "yellow";
  if (status >= 400 && status < 500) return "orange";
  if (status >= 500) return "red";
  return "gray";
}

function typeBadgeColor(requestType: string): string {
  return requestType === "normal" ? "gray" : "orange";
}

/** Group results into pairs (normal + injected). */
function groupIntoPairs(results: SequenceTiming[]): SequenceTiming[][] {
  const pairs: SequenceTiming[][] = [];
  let current: SequenceTiming[] = [];

  for (const r of results) {
    current.push(r);
    if (r.request_type === "injected") {
      pairs.push(current);
      current = [];
    }
  }
  // Leftover (shouldn't happen but handle gracefully)
  if (current.length > 0) {
    pairs.push(current);
  }
  return pairs;
}

/** Check if normal and injected responses differ significantly. */
function pairHasDiff(pair: SequenceTiming[]): boolean {
  if (pair.length < 2) return false;
  const normal = pair.find((r) => r.request_type === "normal");
  const injected = pair.find((r) => r.request_type === "injected");
  if (!normal || !injected) return false;
  if (normal.http_status !== injected.http_status) return true;
  if (normal.bytes_total !== injected.bytes_total) return true;
  return false;
}

export default function SequenceGroupResultsPanel({ result, loading, onSelectProbe }: Props) {
  const { t } = useTranslations();

  if (loading) {
    return (
      <Card withBorder radius="md" shadow="xs">
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      </Card>
    );
  }

  if (!result) {
    return null;
  }

  const pairs = groupIntoPairs(result.results);
  const reusedCount = result.results.filter((r) => r.connection_reused).length;
  const reuseRate = result.total_requests > 0 ? Math.round((reusedCount / result.total_requests) * 100) : 0;
  const maxTime = Math.max(...result.results.map((r) => r.total_time_ms || 0), 1);

  return (
    <Card withBorder radius="md" shadow="xs">
      <Stack gap="md">
        <Text fw={600}>{t("sequenceGroup.resultTitle")}</Text>

        <Group gap="xl">
          <div>
            <Text size="xs" c="dimmed">
              {t("sequenceGroup.totalTime")}
            </Text>
            <Text fw={600}>{result.total_elapsed_ms} ms</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              {t("sequenceGroup.requestCount")}
            </Text>
            <Text fw={600}>{pairs.length} {pairs.length === 1 ? "pair" : "pairs"} ({result.total_requests} requests)</Text>
          </div>
          <div>
            <Text size="xs" c="dimmed">
              {t("sequenceGroup.reuseRate")}
            </Text>
            <Text fw={600}>{reuseRate}%</Text>
          </div>
        </Group>

        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t("sequenceGroup.columns.index")}</Table.Th>
              <Table.Th>{t("sequenceGroup.columns.type")}</Table.Th>
              <Table.Th>{t("sequenceGroup.columns.status")}</Table.Th>
              <Table.Th>{t("sequenceGroup.columns.time")}</Table.Th>
              <Table.Th>{t("sequenceGroup.columns.connection")}</Table.Th>
              <Table.Th>{t("sequenceGroup.columns.size")}</Table.Th>
              <Table.Th>{t("sequenceGroup.columns.error")}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pairs.map((pair, pairIdx) => {
              const hasDiff = pairHasDiff(pair);
              return pair.map((timing, idxInPair) => {
                const isLastInPair = idxInPair === pair.length - 1;
                return (
                  <Table.Tr
                    key={timing.sequence_index}
                    style={{
                      cursor: onSelectProbe && timing.probe_id ? "pointer" : undefined,
                      borderBottom: isLastInPair && pairIdx < pairs.length - 1
                        ? "2px solid var(--mantine-color-dark-4)"
                        : undefined,
                      backgroundColor: hasDiff && timing.request_type === "injected"
                        ? "var(--mantine-color-yellow-light)"
                        : undefined,
                    }}
                    onClick={() => {
                      if (onSelectProbe && timing.probe_id) {
                        onSelectProbe(timing.probe_id);
                      }
                    }}
                  >
                    <Table.Td>
                      {timing.request_type === "normal" ? (
                        <Text size="xs" c="dimmed">{t("sequenceGroup.pairLabel", { index: pairIdx + 1 })}</Text>
                      ) : null}
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={typeBadgeColor(timing.request_type)}
                        variant="light"
                        size="sm"
                      >
                        {timing.request_type === "normal"
                          ? t("sequenceGroup.requestNormal")
                          : t("sequenceGroup.requestInjected")}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={statusBadgeColor(timing.http_status)} variant="light" size="sm">
                        {timing.http_status ?? "—"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Text size="sm">{timing.total_time_ms ?? "—"}</Text>
                        <div
                          style={{
                            height: 6,
                            borderRadius: 3,
                            backgroundColor: "var(--mantine-color-blue-5)",
                            width: `${Math.max(4, ((timing.total_time_ms || 0) / maxTime) * 80)}px`,
                            flexShrink: 0,
                          }}
                        />
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        color={timing.connection_reused ? "teal" : "gray"}
                        variant="light"
                        size="sm"
                      >
                        {timing.connection_reused
                          ? t("sequenceGroup.connectionReused")
                          : t("sequenceGroup.connectionNew")}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{timing.bytes_total} B</Text>
                    </Table.Td>
                    <Table.Td>
                      {timing.error && (
                        <Text size="xs" c="red">
                          {timing.error}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              });
            })}
          </Table.Tbody>
        </Table>
      </Stack>
    </Card>
  );
}
