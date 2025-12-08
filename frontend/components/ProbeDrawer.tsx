import { useEffect, useState } from "react";
import { Badge, Code, Divider, Drawer, Group, Loader, ScrollArea, Stack, Text } from "@mantine/core";
import { fetchProbe, fetchRawResponse } from "../lib/api";
import type { Probe } from "../lib/types";
import { formatBytes, formatDate } from "../lib/format";
import { useTranslations } from "../lib/i18n";

type Props = {
  probeId: number | null;
  opened: boolean;
  onClose: () => void;
};

export default function ProbeDrawer({ probeId, opened, onClose }: Props) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawError, setRawError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened || !probeId) {
      setProbe(null);
      setRaw(null);
      setRawError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const probeData = await fetchProbe(probeId);
        let rawData: string | null = null;
        try {
          rawData = await fetchRawResponse(probeId);
          if (!cancelled) {
            setRawError(null);
          }
        } catch (rawErr) {
          if (!cancelled) {
            setRawError((rawErr as Error).message);
          }
        }
        if (cancelled) return;
        setProbe(probeData);
        setRaw(rawData);
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [opened, probeId]);

  const { t } = useTranslations();

  return (
    <Drawer opened={opened} onClose={onClose} size="40%" title={t("probeDrawer.title")}>
      {loading ? (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      ) : error ? (
        <Text c="red">{error}</Text>
      ) : !probe ? (
        <Text c="dimmed">{t("probeDrawer.none")}</Text>
      ) : (
        <ScrollArea style={{ height: "80vh" }}>
          <Stack>
            <Stack gap={4}>
              <Text fw={600}>{probe.target_url}</Text>
              <Text>{probe.tested_host_header}</Text>
              <Group gap="xs">
                <Badge>{probe.http_status}</Badge>
                {probe.sni_overridden && <Badge color="violet">SNI OVERRIDE</Badge>}
              </Group>
            </Stack>
            <Text size="sm" c="dimmed">
              {formatDate(probe.created_at)} · {formatBytes(probe.bytes_total)} · {probe.response_time_ms ?? "–"} ms
            </Text>
            {probe.reason && (
              <Text size="sm" c="dimmed">
                {t("probeDrawer.reason")}: {probe.reason}
              </Text>
            )}
            <Divider />
            <Stack gap="xs">
              <Text fw={500}>{t("probeDrawer.rawTitle")}</Text>
              {rawError && (
                <Text c="red" size="sm">
                  {rawError}
                </Text>
              )}
              {raw ? (
                <Code block>{raw}</Code>
              ) : !rawError ? (
                <Text c="dimmed">{t("probeDrawer.noRaw")}</Text>
              ) : null}
            </Stack>
          </Stack>
        </ScrollArea>
      )}
    </Drawer>
  );
}
