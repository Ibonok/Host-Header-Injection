import { Button, Card, Group, Loader, ScrollArea, Select, Stack, Table, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import type { RunnerLog } from "../lib/types";
import { formatDate } from "../lib/format";
import { useTranslations } from "../lib/i18n";

type Props = {
  logs: RunnerLog[];
  loading: boolean;
  canLoadOlder: boolean;
  canLoadNewer: boolean;
  onLoadOlder: () => void;
  onLoadNewer: () => void;
  onJumpLatest: () => void;
  isLatestPage: boolean;
  onRefresh: () => void;
};

export default function RunnerLogsPanel({
  logs,
  loading,
  canLoadOlder,
  canLoadNewer,
  onLoadOlder,
  onLoadNewer,
  onJumpLatest,
  isLatestPage,
  onRefresh,
}: Props) {
  const [level, setLevel] = useState("all");
  const { t } = useTranslations();
  const levelOptions = useMemo(
    () => [
      { value: "all", label: t("runnerLogs.levels.all") },
      { value: "info", label: t("runnerLogs.levels.info") },
      { value: "warning", label: t("runnerLogs.levels.warning") },
      { value: "error", label: t("runnerLogs.levels.error") },
    ],
    [t],
  );

  const filteredLogs = useMemo(() => {
    if (level === "all") return logs;
    return logs.filter((log) => log.level === level);
  }, [logs, level]);

  return (
    <Card withBorder radius="md" shadow="xs">
      <Stack>
        <Group justify="space-between">
          <Stack gap={0} flex={1}>
            <Text fw={600}>{t("runnerLogs.title")}</Text>
            <Text size="sm" c="dimmed">
              {t("runnerLogs.subtitle")}
            </Text>
          </Stack>
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={onRefresh}>
              {t("runnerLogs.buttons.refresh")}
            </Button>
            <Button size="xs" variant="light" onClick={onLoadNewer} disabled={!canLoadNewer}>
              {t("runnerLogs.buttons.newer")}
            </Button>
            <Button size="xs" variant="light" onClick={onJumpLatest} disabled={isLatestPage}>
              {t("runnerLogs.buttons.newest")}
            </Button>
            <Button size="xs" variant="light" onClick={onLoadOlder} disabled={!canLoadOlder}>
              {t("runnerLogs.buttons.older")}
            </Button>
            <Select data={levelOptions} value={level} onChange={(value) => setLevel(value || "all")} w={150} />
          </Group>
        </Group>
        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : logs.length === 0 ? (
          <Text c="dimmed">{t("runnerLogs.empty")}</Text>
        ) : (
          <ScrollArea h={300}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t("runnerLogs.columns.time")}</Table.Th>
                  <Table.Th>{t("runnerLogs.columns.level")}</Table.Th>
                  <Table.Th>{t("runnerLogs.columns.message")}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {filteredLogs.map((log) => (
                  <Table.Tr key={log.id}>
                    <Table.Td>{formatDate(log.created_at)}</Table.Td>
                    <Table.Td>
                      <Text tt="uppercase" fw={600} size="sm">
                        {log.level}
                      </Text>
                    </Table.Td>
                    <Table.Td>{log.message}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Stack>
    </Card>
  );
}
