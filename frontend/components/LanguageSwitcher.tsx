import { SegmentedControl } from "@mantine/core";
import { Language, useTranslations } from "../lib/i18n";

export default function LanguageSwitcher() {
  const { language, setLanguage, t } = useTranslations();

  return (
    <SegmentedControl
      size="xs"
      value={language}
      aria-label={t("languageSwitcher.ariaLabel")}
      onChange={(value) => setLanguage(value as Language)}
      data={[
        { label: t("languageSwitcher.english"), value: "en" },
        { label: t("languageSwitcher.german"), value: "de" },
      ]}
    />
  );
}
