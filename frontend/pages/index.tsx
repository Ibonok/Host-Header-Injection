import { Alert, Container, Grid, Stack, Title } from "@mantine/core";
import RunForm from "../components/RunForm";
import RunsTable from "../components/RunsTable";
import { useAsyncData } from "../lib/hooks";
import { listRuns } from "../lib/api";
import { useTranslations } from "../lib/i18n";

export default function IndexPage() {
  const { data: runs, loading, error, refresh } = useAsyncData(listRuns, [], { autoRefreshMs: 5000 });
  const { t } = useTranslations();

  return (
    <Container size="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>{t("runsPage.title")}</Title>
        </div>
        {error && (
          <Alert color="red" title={t("runsPage.loadError")}>
            {error.message}
          </Alert>
        )}
        <Grid>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <RunForm
              onCreated={() => {
                refresh();
              }}
            />
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 7 }}>
            <RunsTable runs={runs || []} loading={loading} onRefresh={refresh} />
          </Grid.Col>
        </Grid>
      </Stack>
    </Container>
  );
}
