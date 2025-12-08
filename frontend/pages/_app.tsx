import "@mantine/core/styles.css";
import "../styles/globals.css";
import Head from "next/head";
import type { AppProps } from "next/app";
import { MantineProvider, localStorageColorSchemeManager } from "@mantine/core";
import AppLayout from "../components/AppLayout";
import { theme } from "../theme";
import { LanguageProvider } from "../lib/i18n";

const colorSchemeManager = localStorageColorSchemeManager({ key: "hh-color-scheme" });

export default function App({ Component, pageProps }: AppProps) {
  return (
    <LanguageProvider>
      <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}>
        <Head>
          <title>Host Header Injection</title>
          <meta
            name="viewport"
            content="minimum-scale=1, initial-scale=1, width=device-width, user-scalable=no"
          />
          <link rel="shortcut icon" href="/favicon.svg" />
        </Head>
        <AppLayout>
          <Component {...pageProps} />
        </AppLayout>
      </MantineProvider>
    </LanguageProvider>
  );
}
