import { Breadcrumbs, Anchor } from "@mantine/core";
import Link from "next/link";
import { useTranslations } from "../lib/i18n";

type Props = {
  current: string;
};

export default function RunBreadcrumbs({ current }: Props) {
  const { t } = useTranslations();
  return (
    <Breadcrumbs>
      <Anchor component={Link} href="/">
        {t("breadcrumbs.runs")}
      </Anchor>
      <span>{current}</span>
    </Breadcrumbs>
  );
}
