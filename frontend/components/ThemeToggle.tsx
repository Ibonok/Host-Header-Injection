import { ActionIcon, useMantineColorScheme } from "@mantine/core";
import { useTranslations } from "../lib/i18n";

export default function ThemeToggle() {
  const { setColorScheme, colorScheme } = useMantineColorScheme();
  const next = colorScheme === "dark" ? "light" : "dark";
  const { t } = useTranslations();

  return (
    <ActionIcon
      variant="subtle"
      aria-label={t("themeToggle.ariaLabel")}
      onClick={() => setColorScheme(next)}
      title={t("themeToggle.title")}
    >
      {colorScheme === "dark" ? "🌙" : "☀️"}
    </ActionIcon>
  );
}
