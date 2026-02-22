import { useMemo, useState } from "react";
import { ActionIcon, Anchor, Badge, Button, Card, Group, Loader, Stack, Table, Text, Tooltip } from "@mantine/core";
import Link from "next/link";
import { deleteRun, stopRun } from "../lib/api";
import type { Run } from "../lib/types";
import { formatDate } from "../lib/format";
import { useTranslations } from "../lib/i18n";
import { IconSquareCheckFilled, IconPlayerStopFilled, IconSquareXFilled, IconDoorEnter } from '@tabler/icons-react';

type Props = {
  runs: Run[];
  loading: boolean;
  onRefresh: () => void;
};

export default function RunsTable({ runs, loading, onRefresh }: Props) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [stoppingId, setStoppingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslations();

  async function handleDelete(id: number) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteRun(id);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  async function handleStop(id: number) {
    setStoppingId(id);
    setError(null);
    try {
      await stopRun(id);
      onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStoppingId(null);
    }
  }

  const statusColor: Record<string, string> = {
    running: "yellow",
    stopping: "orange",
    stopped: "gray",
    success: "green",
    failed: "red",
  };

  const statusLabel: Record<string, string> = useMemo(
    () => ({
      running: t("statuses.running"),
      stopping: t("statuses.stopping"),
      stopped: t("statuses.stopped"),
      success: t("statuses.success"),
      failed: t("statuses.failed"),
    }),
    [t],
  );

  return (
    <Card withBorder radius="md" shadow="xs">
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600}>{t("runsTable.title")}</Text>
          <Group gap="xs">
            {error && (
              <Text size="sm" c="red">
                {error}
              </Text>
            )}
            <Button variant="light" size="xs" onClick={onRefresh} disabled={loading}>
              {t("runsTable.refresh")}
            </Button>
          </Group>
        </Group>
        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : runs.length === 0 ? (
          <Text c="dimmed">{t("runsTable.empty")}</Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("runsTable.columns.name")}</Table.Th>
                <Table.Th>{t("runsTable.columns.description")}</Table.Th>
                <Table.Th>{t("runsTable.columns.created")}</Table.Th>
                <Table.Th>{t("runsTable.columns.status")}</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {runs.map((run) => (
                <Table.Tr key={run.id}>
                  <Table.Td>
                    <Anchor size="xs" component={Link} href={`/runs/${run.id}`} fw={600}>
                      {run.name}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{run.description || "—"}</Table.Td>
                  <Table.Td>{formatDate(run.created_at)}</Table.Td>
                  <Table.Td>
                    <Stack gap={2}>
                      <Group gap={4}>
                        <Badge color={statusColor[run.status] || "gray"} variant="light">
                          {statusLabel[run.status] || run.status}
                        </Badge>
                        {run.run_type === "sequence_group" && (
                          <Badge color="indigo" variant="light" size="xs">
                            SEQ
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        {t("runsTable.concurrency", { value: run.concurrency })}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {t("runsTable.combinations", {
                          processed: run.processed_combinations ?? 0,
                          total: run.total_combinations ?? 0,
                        })}
                      </Text>
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      {(run.status === "running" || run.status === "stopping") && (
                        <Tooltip label={t("runsTable.tooltips.stop")} withArrow>
                          <ActionIcon
                            variant="light"
                            color="red"
                            disabled={stoppingId === run.id}
                            onClick={() => handleStop(run.id)}
                            aria-label={t("runsTable.tooltips.stop")}
                          >
                            <IconPlayerStopFilled color="#ff4013" size={18} stroke={1.5} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {stoppingId === run.id && <Loader size="xs" />}
                      <Tooltip
                        label={run.status === "success"
                          ? t("runsTable.tooltips.success")
                          : t("runsTable.tooltips.pending")}
                      >
                        <ActionIcon
                          variant="light"
                          loading={run.status !== "success"}
                          aria-label={
                            run.status === "success"
                              ? t("runsTable.tooltips.success")
                              : t("runsTable.tooltips.pending")
                          }
                        >
                          <IconSquareCheckFilled color="#77bb41" size={18} stroke={1.5} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t("runsTable.actions.open")}>
                        <ActionIcon
                          component={Link}
                          href={`/runs/${run.id}`}
                          variant="light"
                          color="dark"
                          aria-label={t("runsTable.actions.open")}
                        >
                          <IconDoorEnter color="#000000" size={18} stroke={1.5} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label={t("runsTable.actions.delete")}>
                        <ActionIcon
                          variant="light"
                          loading={deletingId === run.id}
                          onClick={() => handleDelete(run.id)}
                          aria-label={t("runsTable.actions.delete")}
                        >
                          <IconSquareXFilled color="#ff4013" size={18} stroke={1.5} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Card>
  );
}
