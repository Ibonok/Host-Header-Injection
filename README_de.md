# Host-Header Injection / Directory Enumeration

Dieses Repository bietet eine komplette Pipeline zur Auswertung von Host-Header-Tests und Directory-Enumeration-Tests:
- Ein FastAPI-Backend speichert Probes (HTTP-Responses pro URL/FQDN), berechnet Heatmap-Aggregate und stellt REST-Endpoints bereit.
- Ein Next.js-Frontend (Mantine UI) visualisiert Runs als Heatmaps, Tabellen und Probe-Details (inkl. Original-URLs, SNI-Override-Badges, Filter, Logs).
- Der Runner führt die HTTP-Kombinationen serverseitig aus (inkl. Auto-421-SNI-Override, DNS-Optionen, Blacklist-Handling) und persistiert Roh-Responses als Artefakte.

## Docker-Ausführung
Das komplette System lässt sich ohne Host-Node-Setup per Docker starten:
```bash
docker compose up -d --build
```
- Backend-API & Healthcheck: `http://localhost:8080/healthz` & Docs: http://localhost:8080/docs
- Frontend-UI (statisch aus dem Backend bereitgestellt): `http://localhost:8080/ui`
- Artefakte liegen im Volume `artifacts_data`; die DB in `db_data`.

## Entwicklung mit VibeCoding in Codex / Claude
Dieses Projekt wurde vollständig mit VibeCoding in Codex erstellt. Änderungen, Refactorings oder neue Features können nahtlos in derselben Umgebung fortgesetzt werden.

## Sequence Group — Single Connection

Der **Sequence Group** TestCase implementiert dasselbe Muster wie Burp Suite Repeaters
*"Send group in sequence (single connection)"*. Er dient zum Testen von
**Client-Side Desync**, **HTTP Request Smuggling** und **Host-Header Injection**
bei minimalem Timing-Jitter.

### Funktionsweise

Fuer jedes URL x FQDN Paar oeffnet der Runner **eine TCP-Verbindung** und sendet
zwei Requests hintereinander:

```
┌──────────┐        ┌──────────┐
│  Client   │───TCP──│  Server  │
└──────────┘        └──────────┘
     │                    │
     │─── GET /path ─────>│  Request 1 (Normal — Original-Host)
     │<── 200 OK ─────────│
     │                    │
     │─── GET /path ─────>│  Request 2 (Injected — FQDN als Host)
     │<── 200 OK ─────────│
     │                    │
     ╳  Verbindung Ende   ╳
```

- **Request 1 (Normal):** `GET <URL>` mit dem originalen Hostnamen der URL.
- **Request 2 (Injected):** `GET <URL>` mit dem FQDN als Host-Header.

Beide Requests laufen ueber **dieselbe TCP-Verbindung**, sodass der Server sie
als aufeinanderfolgende Requests desselben Clients sieht. Das ist entscheidend
fuer die Erkennung von Desync-Schwachstellen, bei denen der interne Serverzustand
zwischen Requests bestehen bleibt.

### Benutzung

1. **Sequence Group** im TestCase-Dropdown des Run-Formulars auswaehlen.
2. URLs-Datei und FQDNs-Datei hochladen (wie im Standard-Modus).
3. Timeout (bis 120s) und SSL-Verifizierung bei Bedarf anpassen.
4. **Sequenz senden** klicken.

Die Detail-Seite zeigt Ergebnisse paarweise gruppiert, mit **Normal**- und **Injected**-
Badges. Zeilen, bei denen sich Statuscode oder Antwortgroesse zwischen Normal und
Injected unterscheiden, werden hervorgehoben. Klick auf eine Zeile oeffnet den
Probe-Drawer mit dem vollstaendigen Request/Response-Dump.

### Technische Details

- Backend-Runner nutzt `httpx` mit `follow_redirects=False` fuer praezise Kontrolle.
- Jedes Paar verwendet einen eigenen `httpx.Client` (eine TCP-Verbindung, Keep-Alive).
- Raw-Exchanges werden unter `artifacts/sequence/run_{id}/` fuer forensische Analyse gespeichert.
- Runner-Logs werden in Echtzeit erstellt (sichtbar im Logs-Tab).
- Bis zu 5.000 URL x FQDN Kombinationen pro Run.

## Weiterentwicklung ueber Agents/Tasks
Die konkreten Arbeitsanweisungen fuer Codex finden sich in `Agents.md` und `Tasks.md` (Frontend/Backend jeweils separat). Folge diesen Dateien, um konsistente Konventionen, Backlog-Prioritaeten und Tests beizubehalten.

## 🔍 DNS- & Subdomain-Checks mit ProjectDiscovery

### 🧭 Subdomains ohne A-Record finden

Mit **dnsx** lassen sich schnell alle FQDNs identifizieren, bei denen **kein A-Record hinterlegt** ist.
Der folgende Befehl nutzt `subfinder` zur Subdomain-Erkennung und filtert anschließend alle DNS-Einträge ohne IP-Adresse:

```bash
subfinder -d hackerone.com | dnsx -a -json | jq -r 'select(.a | length == 0) | .host'
...
links.hackerone.com
websockets.hackerone.com
info.hackerone.com
go.hackerone.com
design.hackerone.com
events.hackerone.com
```

---

### 🌐 Erreichbare URLs (HTTP/HTTPS) generieren

Diese Pipeline erzeugt eine Liste aller FQDNs, die:

1. existieren,
2. einen gültigen A-Record haben,
3. und per HTTP/HTTPS erreichbar sind.

```bash
subfinder -d hackerone.com | dnsx -a -json | jq -r 'select(.a | length != 0) | .host' | httpx
...
https://mta-sts.managed.hackerone.com
https://mta-sts.hackerone.com
https://mta-sts.forwarding.hackerone.com
http://b.ns.hackerone.com
http://a.ns.hackerone.com
https://gslink.hackerone.com
https://www.hackerone.com
https://support.hackerone.com
https://api.hackerone.com
https://docs.hackerone.com
```

---

### 🚫 Hosts mit A-Record, aber nicht per HTTPS erreichbar

Der folgende Befehl listet alle Subdomains auf, die zwar eine IP besitzen, jedoch **nicht erfolgreich per HTTPS angefragt** werden können:

```bash
subfinder -d heckerone.com | dnsx -a -json | jq -r 'select(.a | length != 0) | .host' | httpx -silent -probe | grep FAILED | cut -d " " -f 1 | cut -d "/" -f 3
```

❗ Nutzen lässt sich das zum Beispiel, um fehlerhafte SSL-Konfigurationen oder blockierte Dienste zu finden.

---

### 🏠 Hinweis zu internen Domains

Auch **interne FQDNs** lassen sich mit diesen Methoden testen.
Viele Unternehmen verwenden z. B. **Let’s Encrypt** oder ähnliche CAs sogar für interne Systeme.
Wenn die interne Domain bekannt ist, können diese Subdomains ebenfalls über `dnsx` und `httpx` geprüft werden — praktisch für:

* interne Bug-Bounty-Programme
* Asset Discovery
* Schwachstellenanalysen in Unternehmensnetzen

## Images

CreateRun:

![Screenshot](images/CreateRun.png)

Heatmap:
![Screenshot](images/Heatmap.png)

DirectoryEnummerationView:
![Screenshot](images/DirectoryEnumView.png)