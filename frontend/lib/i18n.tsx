import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Language = "en" | "de";

type TranslationValue = string | { [key: string]: TranslationValue };

type TranslationVariables = Record<string, string | number>;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (path: string, vars?: TranslationVariables) => string;
};

const LANGUAGE_STORAGE_KEY = "hh-language";
const DEFAULT_LANGUAGE: Language = "en";

const translations: Record<Language, TranslationValue> = {
  en: {
    layout: {
      title: "Host Header Injection",
      nav: {
        runs: "Runs",
        runsDescription: "Overview & creation",
      },
      docsNote: "Docs: see README + Agents.",
      openNavigation: "Open navigation",
    },
    themeToggle: {
      ariaLabel: "Toggle color scheme",
      title: "Light/Dark",
    },
    languageSwitcher: {
      ariaLabel: "Change language",
      english: "English",
      german: "Deutsch",
    },
    runForm: {
      labels: {
        name: "Name",
        description: "Description",
        testCase: "TestCase",
        attempt: "Test case",
        subTestCase: "SubTestCase",
        concurrency: "Concurrency",
        dnsSwitch: "Check all DNS A/AAAA records",
        auto421Switch: "Auto 421 SNI override",
        applyBlacklist: "Apply blacklist",
        urls: "URLs",
        fqdns: "FQDNs",
        directories: "Directory paths",
        statusFilters: "HTTP status filters",
        timeout: "Timeout per request (s)",
        verifySsl: "Verify SSL",
      },
      placeholders: {
        name: "e.g. Attempt 1 Production",
        urls: "Select urls.txt",
        fqdns: "Select fqdns.txt",
        directories: "Select directories.txt",
      },
      testCaseOptions: {
        standard: "Standard",
        sequenceGroup: "Sequence Group",
      },
      attemptOptions: {
        attempt1: "No SNI override",
        attempt2: "SNI override",
      },
      subTestCaseOptions: {
        standard: "Standard path '/'",
        directories: "Directory list",
      },
      dnsDescription: "Disable to test only the first A and AAAA record per host",
      dnsNoteLoadbalancer: "Test all load balancer / reverse proxy IPs",
      auto421Description: "Automatically retry 421 Misdirected responses with the tested host as SNI",
      applyBlacklistDescription: "Skip targets whose resolved IPs are on the configured blacklist",
      directoriesDescription: "Upload newline separated paths (e.g. /admin (becomes //admin), or admin (becomes /admin))",
      statusFiltersDescription: "Switches are on by default. Disable a status to drop matching responses (they will not be stored).",
      statusFilterCode: "Status {{code}}",
      combinationSummary: "URLs × FQDNs × Directories: {{urls}} × {{fqdns}} × {{directories}} = {{total}} combinations",
      submit: "Start run",
      submitSequence: "Send sequence",
      errorTitle: "Error",
      tooManySequenceRequests: "Max 50 requests for Sequence Group ({{count}} combinations)",
      sequenceHostMismatch: "All URLs must target the same host for Sequence Group",
      sequenceDescription: "Send all URL × FQDN combinations sequentially over a single TCP connection",
    },
    runsPage: {
      title: "Manage runs",
      loadError: "Error while loading",
    },
    runDetail: {
      invalidId: "Invalid run ID.",
      missing: "Run not found.",
      errorWithMessage: "Error: {{message}}",
      noRun: "No run",
      tabs: {
        heatmap: "Heatmap",
        logs: "Runner logs",
      },
    },
    runsTable: {
      title: "Runs",
      refresh: "Refresh",
      empty: "No runs yet.",
      columns: {
        name: "Name",
        description: "Description",
        created: "Created",
        status: "Status",
      },
      concurrency: "Concurrency {{value}}",
      combinations: "{{processed}}/{{total}} combinations",
      tooltips: {
        stop: "Stop run",
        success: "Run successful",
        pending: "Not finished yet",
      },
      actions: {
        open: "Open",
        delete: "Delete",
      },
    },
    runSummary: {
      cards: {
        run: "Run",
        status: "Status",
        combinations: "Combinations",
        created: "Created",
        summary421: "421 summary",
      },
      descriptionFallback: "No description",
      combosDescription: "completed / total",
      summary421None: "No data",
      dnsMode: {
        all: "DNS all records",
        first: "DNS first A/AAAA only",
      },
    },
    statuses: {
      running: "Running",
      stopping: "Stopping",
      stopped: "Stopped",
      success: "Finished",
      failed: "Failed",
    },
    runnerLogs: {
      title: "Runner logs",
      subtitle: "Realtime status from the worker.",
      buttons: {
        refresh: "Refresh",
        newer: "Newer",
        newest: "Latest",
        older: "Older",
      },
      empty: "No logs yet.",
      columns: {
        time: "Timestamp",
        level: "Level",
        message: "Message",
      },
      levels: {
        all: "All levels",
        info: "Info",
        warning: "Warning",
        error: "Error",
      },
    },
    heatmap: {
      title: "Heatmap",
      hint: "Select a target in the list and filter by status or raw size.",
      refresh: "Refresh",
      targetsCount: "{{count}} targets",
      empty: "No heatmap data yet.",
      activeFiltersLabel: "Active filters:",
      activeFiltersNone: "none",
      clearFilters: "Clear",
      uniqueSizeOnly: "Unique response sizes",
      showAllSizes: "Show all response sizes",
      paths: {
        showAll: "show all",
        title: "Paths",
        close: "Close",
        allPaths: "All paths",
        pathHeader: "Path",
        select: "Selection",
      },
      table: {
        targetsHeader: "Targets",
        targetUrl: "Target URL",
        status: "Status",
        sizeRange: "Response size (min – max)",
        probes: "{{count}} probes",
      },
      statusFilter: "Status filter",
      httpCodes: "HTTP codes",
      sizeFilter: "Raw size filter",
      sizeRange: "{{min}} – {{max}}",
      noCells: "No cells match the filters.",
      tooltip: "Status {{status}} – Attempt {{attempt}} – {{size}}",
      rawLabel: "RAW",
      otherBucket: "Other",
      badges: {
        override: "Override",
      },
      auto421Tooltip: "421 auto override applied",
      ipBlacklistTooltip: "Hit IP Blacklist",
      viewGrid: "Grid",
      viewTable: "Table",
      tableColumns: {
        host: "Host Header",
        status: "Status",
        size: "Size",
        attempt: "Attempt",
        sni: "SNI",
      },
    },
    probeDrawer: {
      title: "Probe details",
      none: "No probe selected.",
      reason: "Reason",
      rawTitle: "Raw response",
      noRaw: "No raw response available.",
    },
    sequenceGroup: {
      formTitle: "Sequence Group",
      formHint: "Send requests sequentially over a single TCP connection",
      labels: {
        name: "Name",
        description: "Description",
        timeout: "Timeout per request (s)",
        verifySsl: "Verify SSL",
        url: "URL",
        hostHeader: "Host Header",
        method: "Method",
      },
      addRequest: "Add request",
      removeRequest: "Remove",
      submit: "Send sequence",
      errorTitle: "Error",
      hostMismatch: "All requests must target the same host",
      resultTitle: "Sequence Group Result",
      totalTime: "Total time",
      requestCount: "Requests",
      reuseRate: "Connection reuse rate",
      columns: {
        index: "#",
        type: "Type",
        status: "Status",
        time: "Time (ms)",
        connection: "Connection",
        size: "Size",
        error: "Error",
      },
      connectionNew: "New",
      connectionReused: "Reused",
      requestNormal: "Normal",
      requestInjected: "Injected",
      pairLabel: "Pair {{index}}",
      tabs: {
        standard: "Standard Run",
        sequence: "Sequence Group",
      },
    },
    breadcrumbs: {
      runs: "Runs",
    },
  },
  de: {
    layout: {
      title: "Host Header Injection",
      nav: {
        runs: "Runs",
        runsDescription: "Übersicht & Erstellung",
      },
      docsNote: "Docs: siehe README + Agents.",
      openNavigation: "Navigation öffnen",
    },
    themeToggle: {
      ariaLabel: "Farbschema wechseln",
      title: "Light/Dark",
    },
    languageSwitcher: {
      ariaLabel: "Sprache wechseln",
      english: "English",
      german: "Deutsch",
    },
    runForm: {
      labels: {
        name: "Name",
        description: "Beschreibung",
        testCase: "TestCase",
        attempt: "Testfall",
        subTestCase: "SubTestCase",
        concurrency: "Concurrency",
        dnsSwitch: "Alle DNS A/AAAA Records pruefen",
        auto421Switch: "421 Misdirect automatisch ueberschreiben",
        applyBlacklist: "Blacklist anwenden",
        urls: "URLs",
        fqdns: "FQDNs",
        directories: "Verzeichnispfade",
        statusFilters: "HTTP-Status-Filter",
        timeout: "Timeout pro Request (s)",
        verifySsl: "SSL verifizieren",
      },
      placeholders: {
        name: "z.B. Attempt 1 Production",
        urls: "urls.txt auswählen",
        fqdns: "fqdns.txt auswählen",
        directories: "directories.txt auswählen",
      },
      testCaseOptions: {
        standard: "Standard",
        sequenceGroup: "Sequence Group",
      },
      attemptOptions: {
        attempt1: "Kein SNI-Override",
        attempt2: "SNI-Override",
      },
      subTestCaseOptions: {
        standard: "Standardpfad '/'",
        directories: "Verzeichnisse aus Datei",
      },
      dnsDescription: "Deaktivieren, um nur den ersten A- und AAAA-Record pro Host zu testen",
      dnsNoteLoadbalancer: "Alle Loadbalancer- / Reverse-Proxy-IPs testen",
      auto421Description: "421-Antworten automatisch erneut mit Host-SNI senden",
      applyBlacklistDescription: "Ziele ueberspringen, deren IP auf der Blacklist steht",
      directoriesDescription: "Datei mit Zeilen wie /admin (wird //admin), or admin (wird /admin)",
      statusFiltersDescription: "Schalter sind standardmaessig an. Deaktiviere einen Status, um passende Antworten zu verwerfen (werden nicht gespeichert).",
      statusFilterCode: "Status {{code}}",
      combinationSummary: "URLs x FQDNs x Verzeichnisse: {{urls}} x {{fqdns}} x {{directories}} = {{total}} Kombinationen",
      submit: "Run starten",
      submitSequence: "Sequenz senden",
      errorTitle: "Fehler",
      tooManySequenceRequests: "Max 50 Requests fuer Sequence Group ({{count}} Kombinationen)",
      sequenceHostMismatch: "Alle URLs muessen denselben Host haben fuer Sequence Group",
      sequenceDescription: "Alle URL x FQDN Kombinationen sequenziell ueber eine einzige TCP-Verbindung senden",
    },
    runsPage: {
      title: "Runs verwalten",
      loadError: "Fehler beim Laden",
    },
    runDetail: {
      invalidId: "Ungültige Run-ID.",
      missing: "Run nicht gefunden.",
      errorWithMessage: "Fehler: {{message}}",
      noRun: "Kein Run",
      tabs: {
        heatmap: "Heatmap",
        logs: "Runner Logs",
      },
    },
    runsTable: {
      title: "Runs",
      refresh: "Aktualisieren",
      empty: "Noch keine Runs vorhanden.",
      columns: {
        name: "Name",
        description: "Beschreibung",
        created: "Erstellt",
        status: "Status",
      },
      concurrency: "Concurrency {{value}}",
      combinations: "{{processed}}/{{total}} Kombinationen",
      tooltips: {
        stop: "Run stoppen",
        success: "Run erfolgreich",
        pending: "Noch nicht abgeschlossen",
      },
      actions: {
        open: "Öffnen",
        delete: "Löschen",
      },
    },
    runSummary: {
      cards: {
        run: "Run",
        status: "Status",
        combinations: "Kombinationen",
        created: "Erstellt",
        summary421: "421 Übersicht",
      },
      descriptionFallback: "Keine Beschreibung",
      combosDescription: "abgeschlossen / gesamt",
      summary421None: "Keine Daten",
      dnsMode: {
        all: "DNS alle Records",
        first: "DNS erster A/AAAA",
      },
    },
    statuses: {
      running: "Läuft",
      stopping: "Stoppt",
      stopped: "Gestoppt",
      success: "Fertig",
      failed: "Fehlgeschlagen",
    },
    runnerLogs: {
      title: "Runner Logs",
      subtitle: "Echtzeit-Status aus dem Worker.",
      buttons: {
        refresh: "Aktualisieren",
        newer: "Neuere",
        newest: "Neueste",
        older: "Ältere",
      },
      empty: "Noch keine Logs.",
      columns: {
        time: "Zeitpunkt",
        level: "Level",
        message: "Nachricht",
      },
      levels: {
        all: "Alle Level",
        info: "Info",
        warning: "Warnung",
        error: "Error",
      },
    },
    heatmap: {
      title: "Heatmap",
      hint: "Wähle ein Ziel in der Liste und filtere nach Status oder Rohgröße.",
      refresh: "Aktualisieren",
      targetsCount: "{{count}} Targets",
      empty: "Noch keine Heatmap-Daten vorhanden.",
      activeFiltersLabel: "Aktive Filter:",
      activeFiltersNone: "keine",
      clearFilters: "Zurücksetzen",
      uniqueSizeOnly: "Nur eindeutige Größen",
      showAllSizes: "Alle Größen anzeigen",
      paths: {
        showAll: "alle anzeigen",
        title: "Pfade",
        close: "Schließen",
        allPaths: "Alle Pfade",
        pathHeader: "Pfad",
        select: "Auswahl",
      },
      table: {
        targetsHeader: "Targets",
        targetUrl: "Target URL",
        status: "Status",
        sizeRange: "Antwortgröße (min – max)",
        probes: "{{count}} Probes",
      },
      statusFilter: "Statusfilter",
      httpCodes: "HTTP-Codes",
      sizeFilter: "RAW-Size Filter",
      sizeRange: "{{min}} – {{max}}",
      noCells: "Keine Zellen passend zu den Filtern.",
      tooltip: "Status {{status}} – Attempt {{attempt}} – {{size}}",
      rawLabel: "RAW",
      otherBucket: "Andere",
      badges: {
        override: "Override",
      },
      auto421Tooltip: "421 wurde automatisch mit Host-SNI ueberschrieben",
      ipBlacklistTooltip: "IP-Blacklist getroffen",
      viewGrid: "Grid",
      viewTable: "Tabelle",
      tableColumns: {
        host: "Host Header",
        status: "Status",
        size: "Groesse",
        attempt: "Attempt",
        sni: "SNI",
      },
    },
    probeDrawer: {
      title: "Probe Details",
      none: "Kein Probe ausgewählt.",
      reason: "Grund",
      rawTitle: "Raw Response",
      noRaw: "Kein Raw Response verfügbar.",
    },
    sequenceGroup: {
      formTitle: "Sequence Group",
      formHint: "Requests sequenziell ueber eine einzige TCP-Verbindung senden",
      labels: {
        name: "Name",
        description: "Beschreibung",
        timeout: "Timeout pro Request (s)",
        verifySsl: "SSL verifizieren",
        url: "URL",
        hostHeader: "Host Header",
        method: "Methode",
      },
      addRequest: "Request hinzufuegen",
      removeRequest: "Entfernen",
      submit: "Sequenz senden",
      errorTitle: "Fehler",
      hostMismatch: "Alle Requests muessen denselben Host haben",
      resultTitle: "Sequence Group Ergebnis",
      totalTime: "Gesamtzeit",
      requestCount: "Requests",
      reuseRate: "Connection-Reuse-Rate",
      columns: {
        index: "#",
        type: "Typ",
        status: "Status",
        time: "Zeit (ms)",
        connection: "Verbindung",
        size: "Groesse",
        error: "Fehler",
      },
      connectionNew: "Neu",
      connectionReused: "Wiederverwendet",
      requestNormal: "Normal",
      requestInjected: "Injected",
      pairLabel: "Paar {{index}}",
      tabs: {
        standard: "Standard Run",
        sequence: "Sequence Group",
      },
    },
    breadcrumbs: {
      runs: "Runs",
    },
  },
};

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function resolveTranslation(value: TranslationValue, path: string[]): string | undefined {
  return path.reduce<TranslationValue | undefined>((acc, key) => {
    if (typeof acc === "string" || acc === undefined) {
      return acc;
    }
    return acc[key];
  }, value) as string | undefined;
}

function formatValue(template: string, vars?: TranslationVariables): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(.*?)\}\}/g, (_, token: string) => {
    const key = token.trim();
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return String(vars[key]);
    }
    return `{{${key}}}`;
  });
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored === "en" || stored === "de") {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    }
  }, []);

  const t = useCallback(
    (path: string, vars?: TranslationVariables) => {
      const segments = path.split(".");
      const value =
        resolveTranslation(translations[language], segments) ??
        resolveTranslation(translations[DEFAULT_LANGUAGE], segments) ??
        path;
      if (typeof value !== "string") {
        return path;
      }
      return formatValue(value, vars);
    },
    [language],
  );

  const contextValue = useMemo<LanguageContextValue>(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return <LanguageContext.Provider value={contextValue}>{children}</LanguageContext.Provider>;
}

export function useTranslations(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useTranslations must be used within a LanguageProvider");
  }
  return ctx;
}
