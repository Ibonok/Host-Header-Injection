import { Card, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import type { Run, Summary421 } from "../lib/types";
import { formatDate } from "../lib/format";
import { useTranslations } from "../lib/i18n";

type Props = {
  run: Run | null;
  summary: Summary421 | null;
};

function StatCard({ label, value, description }: { label: string; value: string | number; description?: string }) {
  return (
    <Card withBorder shadow="xs" radius="md">
      <Stack gap={4}>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text fw={600} size="xl">
          {value}
        </Text>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

export default function RunSummaryCards({ run, summary }: Props) {
  const { t } = useTranslations();
  if (!run) return null;
  const statusLabel: Record<string, string> = {
    running: t("statuses.running"),
    stopping: t("statuses.stopping"),
    stopped: t("statuses.stopped"),
    success: t("statuses.success"),
    failed: t("statuses.failed"),
  };
  return (
    <SimpleGrid cols={{ base: 1, sm: 4, md: 5 }}>
      <StatCard
        label={t("runSummary.cards.run")}
        value={run.name}
        description={run.description || t("runSummary.descriptionFallback")}
      />
      <StatCard
        label={t("runSummary.cards.status")}
        value={statusLabel[run.status] || run.status}
        description={
          `${t("runForm.labels.concurrency")} ${run.concurrency} · ${
            run.resolve_all_dns_records ? t("runSummary.dnsMode.all") : t("runSummary.dnsMode.first")
          }`
        }
      />
      <StatCard
        label={t("runSummary.cards.combinations")}
        value={`${run.processed_combinations ?? 0}/${run.total_combinations ?? 0}`}
        description={t("runSummary.combosDescription")}
      />
      <StatCard label={t("runSummary.cards.created")} value={formatDate(run.created_at)} />
      {summary ? (
        <StatCard
          label={t("runSummary.cards.summary421")}
          value={`${summary.successful_retries}/${summary.retries}`}
          description={`${summary.total_421} 421`}
        />
      ) : (
        <Card withBorder shadow="xs" radius="md">
          <Group justify="space-between">
            <Stack gap={4}>
              <Text size="xs" c="dimmed">
                {t("runSummary.cards.summary421")}
              </Text>
              <Text c="dimmed">{t("runSummary.summary421None")}</Text>
            </Stack>
          </Group>
        </Card>
      )}
    </SimpleGrid>
  );
}
