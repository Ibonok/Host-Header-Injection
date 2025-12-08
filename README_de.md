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

## Entwicklung mit VibeCoding in Codex
Dieses Projekt wurde vollständig mit VibeCoding in Codex erstellt. Änderungen, Refactorings oder neue Features können nahtlos in derselben Umgebung fortgesetzt werden.

## Weiterentwicklung über Agents/Tasks
Die konkreten Arbeitsanweisungen für Codex finden sich in `Agents.md` und `Tasks.md` (Frontend/Backend jeweils separat). Folge diesen Dateien, um konsistente Konventionen, Backlog-Prioritäten und Tests beizubehalten.

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