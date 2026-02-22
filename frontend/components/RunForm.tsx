import { useState } from "react";
import {
  Alert,
  Button,
  Card,
  FileInput,
  Group,
  Slider,
  Switch,
  Stack,
  Text,
  TextInput,
  Textarea,
  Space,
  Select,
  Tooltip,
  SimpleGrid,
} from "@mantine/core";
import { createRunFromLists, createSequenceGroup } from "../lib/api";
import type { Run, SequenceGroupResult } from "../lib/types";
import { useTranslations } from "../lib/i18n";

const STATUS_FILTER_OPTIONS = [404, 403, 401, 302, 301, 500];

type Props = {
  onCreated: (run: Run) => void;
  onSequenceResult?: (result: SequenceGroupResult) => void;
};

export default function RunForm({ onCreated, onSequenceResult }: Props) {
  const [testCase, setTestCase] = useState<"standard" | "sequence">("standard");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attempt] = useState(1);
  const [subTestCase, setSubTestCase] = useState(1);
  const [concurrency, setConcurrency] = useState(10);
  const [resolveAllDnsRecords, setResolveAllDnsRecords] = useState(false);
  const [autoOverride421, setAutoOverride421] = useState(true);
  const [applyBlacklist, setApplyBlacklist] = useState(true);
  const [disabledStatusFilters, setDisabledStatusFilters] = useState<number[]>([]);
  const [urlsFile, setUrlsFile] = useState<File | null>(null);
  const [fqdnsFile, setFqdnsFile] = useState<File | null>(null);
  const [directoriesFile, setDirectoriesFile] = useState<File | null>(null);
  const [urlsCount, setUrlsCount] = useState(0);
  const [fqdnsCount, setFqdnsCount] = useState(0);
  const [directoriesCount, setDirectoriesCount] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sequence-specific
  const [timeout, setTimeout] = useState(10);
  const [verifySsl, setVerifySsl] = useState(false);
  const { t } = useTranslations();

  async function handleFile(file: File | null, setter: (file: File | null) => void, counter: (value: number) => void) {
    setter(file);
    if (!file) {
      counter(0);
      return;
    }
    const content = await file.text();
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    counter(lines.length);
  }

  async function readFileLines(file: File): Promise<string[]> {
    const content = await file.text();
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  const isSequence = testCase === "sequence";
  const directoriesReady = subTestCase === 1 || (directoriesFile && directoriesCount > 0);
  const requiresFqdns = subTestCase === 1;
  const fqdnsReady = !requiresFqdns || (fqdnsFile && fqdnsCount > 0);
  const ready = Boolean(name && urlsFile && fqdnsReady && directoriesReady && !loading);

  const toggleStatusFilter = (code: number) => {
    setDisabledStatusFilters((prev) => {
      if (prev.includes(code)) {
        return prev.filter((value) => value !== code);
      }
      return [...prev, code].sort((a, b) => a - b);
    });
  };

  function resetForm() {
    setName("");
    setDescription("");
    setConcurrency(10);
    setSubTestCase(1);
    setUrlsFile(null);
    setFqdnsFile(null);
    setDirectoriesFile(null);
    setUrlsCount(0);
    setFqdnsCount(0);
    setDirectoriesCount(1);
    setResolveAllDnsRecords(false);
    setAutoOverride421(true);
    setApplyBlacklist(true);
    setDisabledStatusFilters([]);
    setTimeout(10);
    setVerifySsl(false);
  }

  async function handleSubmitStandard() {
    if (!urlsFile || (requiresFqdns && !fqdnsFile)) return;
    const run = await createRunFromLists({
      name,
      description,
      attempt,
      subTestCase,
      concurrency,
      resolveAllDnsRecords,
      autoOverride421,
      applyBlacklist,
      statusFilters: subTestCase === 2 ? disabledStatusFilters : [],
      urlsFile,
      fqdnsFile: fqdnsFile ?? null,
      directoriesFile: subTestCase === 2 ? directoriesFile : null,
    });
    onCreated(run);
    resetForm();
  }

  async function handleSubmitSequence() {
    if (!urlsFile) return;

    const urls = await readFileLines(urlsFile);
    const fqdns = fqdnsFile ? await readFileLines(fqdnsFile) : [];

    // Build request combinations: each URL x each FQDN
    const requests = [];
    if (fqdns.length > 0) {
      for (const url of urls) {
        for (const fqdn of fqdns) {
          requests.push({ url, host_header: fqdn, method: "GET" });
        }
      }
    } else {
      // No FQDNs: use each URL with its own host as host_header
      for (const url of urls) {
        try {
          const parsed = new URL(url);
          requests.push({ url, host_header: parsed.hostname, method: "GET" });
        } catch {
          requests.push({ url, host_header: "", method: "GET" });
        }
      }
    }

    // Validate same host
    const hosts = new Set<string>();
    for (const req of requests) {
      try {
        const parsed = new URL(req.url);
        hosts.add(parsed.hostname);
      } catch {
        // skip
      }
    }
    if (hosts.size > 1) {
      throw new Error(t("runForm.sequenceHostMismatch"));
    }

    const result = await createSequenceGroup({
      name,
      description: description || undefined,
      requests,
      timeout_seconds: timeout,
      verify_ssl: verifySsl,
    });

    onSequenceResult?.(result);
    onCreated({
      id: result.run_id,
      name: result.run_name,
      status: "success",
      created_at: new Date().toISOString(),
      concurrency: 1,
      resolve_all_dns_records: false,
      run_type: "sequence_group",
    });
    resetForm();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (isSequence) {
        await handleSubmitSequence();
      } else {
        await handleSubmitStandard();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card component="form" withBorder radius="md" shadow="xs" onSubmit={handleSubmit}>
      <Stack>
        <TextInput
          label={t("runForm.labels.name")}
          placeholder={t("runForm.placeholders.name")}
          required
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
        <Textarea
          label={t("runForm.labels.description")}
          minRows={2}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
        <Select
          label={t("runForm.labels.testCase")}
          data={[
            { value: "standard", label: t("runForm.testCaseOptions.standard") },
            { value: "sequence", label: t("runForm.testCaseOptions.sequenceGroup") },
          ]}
          value={testCase}
          onChange={(value) => setTestCase((value as "standard" | "sequence") || "standard")}
        />
        {isSequence && (
          <Text size="xs" c="dimmed">
            {t("runForm.sequenceDescription")}
          </Text>
        )}
        <Select
          label={t("runForm.labels.subTestCase")}
          data={[
            { value: "1", label: t("runForm.subTestCaseOptions.standard") },
            { value: "2", label: t("runForm.subTestCaseOptions.directories") },
          ]}
          value={String(subTestCase)}
          onChange={(value) => {
            const next = Number(value) || 1;
            setSubTestCase(next);
            if (next === 1) {
              setDirectoriesFile(null);
              setDirectoriesCount(1);
              setDisabledStatusFilters([]);
            } else {
              setDirectoriesCount(0);
              setDirectoriesFile(null);
            }
          }}
        />
        {!isSequence && (
          <>
            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="sm">{t("runForm.labels.concurrency")}</Text>
                <Text size="sm" c="dimmed">
                  {concurrency}
                </Text>
              </Group>
              <Slider min={1} max={20} value={concurrency} onChange={setConcurrency} marks={[{ value: 1, label: "1" }, { value: 10, label: "10" }, { value: 20, label: "20" }]} />
            </Stack>
            <Space h="md" />
            <Switch
              label={
                <Tooltip label={t("runForm.dnsNoteLoadbalancer")} withArrow>
                  <Text span>
                    {t("runForm.labels.dnsSwitch")}
                  </Text>
                </Tooltip>
              }
              description={`${t("runForm.dnsDescription")}`}
              checked={resolveAllDnsRecords}
              onChange={(event) => setResolveAllDnsRecords(event.currentTarget.checked)}
            />
            <Switch
              label={t("runForm.labels.auto421Switch")}
              description={t("runForm.auto421Description")}
              checked={autoOverride421}
              onChange={(event) => setAutoOverride421(event.currentTarget.checked)}
            />
            <Switch
              label={t("runForm.labels.applyBlacklist")}
              description={t("runForm.applyBlacklistDescription")}
              checked={applyBlacklist}
              onChange={(event) => setApplyBlacklist(event.currentTarget.checked)}
            />
          </>
        )}
        {isSequence && (
          <>
            <Stack gap={4}>
              <Group justify="space-between">
                <Text size="sm">{t("runForm.labels.timeout")}</Text>
                <Text size="sm" c="dimmed">
                  {timeout}s
                </Text>
              </Group>
              <Slider
                min={0.5}
                max={120}
                step={0.5}
                value={timeout}
                onChange={setTimeout}
                marks={[
                  { value: 0.5, label: "0.5" },
                  { value: 5, label: "5" },
                  { value: 30, label: "30" },
                  { value: 60, label: "60" },
                  { value: 120, label: "120" },
                ]}
              />
            </Stack>
            <Switch
              label={t("runForm.labels.verifySsl")}
              checked={verifySsl}
              onChange={(event) => setVerifySsl(event.currentTarget.checked)}
            />
          </>
        )}
        <Group grow>
          <FileInput
            label={t("runForm.labels.urls")}
            placeholder={t("runForm.placeholders.urls")}
            required
            value={urlsFile}
            onChange={(file) => {
              handleFile(file, setUrlsFile, setUrlsCount);
            }}
          />
          <FileInput
            label={t("runForm.labels.fqdns")}
            placeholder={t("runForm.placeholders.fqdns")}
            required={subTestCase === 1}
            value={fqdnsFile}
            onChange={(file) => {
              handleFile(file, setFqdnsFile, setFqdnsCount);
            }}
          />
        </Group>
        {subTestCase === 2 && (
          <Stack gap="xs">
            <FileInput
              label={t("runForm.labels.directories")}
              placeholder={t("runForm.placeholders.directories")}
              required
              value={directoriesFile}
              onChange={(file) => {
                handleFile(file, setDirectoriesFile, setDirectoriesCount);
              }}
              description={t("runForm.directoriesDescription")}
            />
            <Stack gap={4}>
              <Text size="sm" fw={500}>
                {t("runForm.labels.statusFilters")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("runForm.statusFiltersDescription")}
              </Text>
              <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs">
                {STATUS_FILTER_OPTIONS.map((code) => (
                  <Switch
                    key={code}
                    label={t("runForm.statusFilterCode", { code })}
                    checked={!disabledStatusFilters.includes(code)}
                    onChange={() => toggleStatusFilter(code)}
                  />
                ))}
              </SimpleGrid>
            </Stack>
          </Stack>
        )}
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {(() => {
              const effectiveFqdns = subTestCase === 2 ? Math.max(1, fqdnsCount) : fqdnsCount;
              const effectiveDirectories = subTestCase === 2 ? Math.max(1, directoriesCount) : 1;
              const total = urlsCount * (effectiveFqdns || 0) * effectiveDirectories;
              return t("runForm.combinationSummary", {
                urls: urlsCount,
                fqdns: effectiveFqdns,
                directories: effectiveDirectories,
                total,
              });
            })()}
          </Text>
          <Button type="submit" loading={loading} disabled={!ready}>
            {isSequence ? t("runForm.submitSequence") : t("runForm.submit")}
          </Button>
        </Group>
        {error && (
          <Alert color="red" title={t("runForm.errorTitle")}>
            {error}
          </Alert>
        )}
      </Stack>
    </Card>
  );
}
