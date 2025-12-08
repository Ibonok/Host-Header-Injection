import { ReactNode, useMemo } from "react";
import { AppShell, Box, Burger, Group, NavLink, ScrollArea, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import Link from "next/link";
import { useRouter } from "next/router";
import ThemeToggle from "./ThemeToggle";
import { useTranslations } from "../lib/i18n";
import LanguageSwitcher from "./LanguageSwitcher";

type Props = {
  children: ReactNode;
};

export default function AppLayout({ children }: Props) {
  const router = useRouter();
  const [opened, { toggle, close }] = useDisclosure(false);
  const { t } = useTranslations();

  const links = useMemo(
    () => [
      {
        label: t("layout.nav.runs"),
        href: "/",
        description: t("layout.nav.runsDescription"),
      },
    ],
    [t],
  );

  const items = useMemo(
    () =>
      links.map((item) => {
        const active =
          router.pathname === item.href || (item.href === "/" && router.pathname.startsWith("/runs"));
        return (
          <NavLink
            component={Link}
            href={item.href}
            key={item.href}
            label={item.label}
            description={item.description}
            active={active}
            onClick={close}
          />
        );
      }),
    [router.pathname, close, links],
  );

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: 260,
        breakpoint: "sm",
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger
              opened={opened}
              onClick={toggle}
              hiddenFrom="sm"
              size="sm"
              aria-label={t("layout.openNavigation")}
            />
            <Text fw={600}>{t("layout.title")}</Text>
          </Group>
          <Group gap="sm">
            <LanguageSwitcher />
            <ThemeToggle />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        <AppShell.Section grow component={ScrollArea}>
          {items}
        </AppShell.Section>
        <AppShell.Section>
          <Box p="sm">
            <Text size="xs" c="dimmed">
              {t("layout.docsNote")}
            </Text>
          </Box>
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
