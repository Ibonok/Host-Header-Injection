# AGENTS.md — Frontend (Next.js + Mantine UI)

## Overview
This Next.js Pages app (React 19 + Mantine 8) is the UI for the Host Header Injection. It provides:
- Run management dashboard with file-upload form (URLs + FQDNs) and runs table (delete + open actions).
- Run form supports SubTestCase for directory paths (root `/` or uploaded list that multiplies URLs before execution). The SNI attempt dropdown has been removed; runs always use attempt 1, and only the Auto 421 SNI override switch remains.
- Directory-path SubTestCase offers HTTP status switches (404, 403, 401, 302, 301, 500). Switches are **on by default**; disabling one drops matching responses before they are stored (acts as a “do not persist” filter for that status).
- Directory list handling (backend): Entries ohne führenden Slash werden zu `/foo`, Einträge mit Slash werden zu `//foo`; leere Zeilen werden zu `/`. Dies wirkt sich auf die effektive URL aus (bewusste Beibehaltung des Nutzer-Inputs).
- DNS controls: "Alle DNS A/AAAA" (default **off**) determines how many resolved records we probe per host; the label carries a `*` tooltip (“Test all load balancer / reverse proxy IPs”). The Auto 421 SNI override switch retriggers misdirected (421) responses with the tested host as SNI (values are sent via the run creation API).
- Blacklist handling: new "Apply blacklist" switch (default **on**) lets users disable IP blacklist/Cloudflare skipping for a run.
- Detailed run view featuring: summary stats, new target-selection table beside the heatmap, HTTP bucket + per-code filters, RAW-size range slider, probe cards with SNI flags, probe drawer (auto-load raw), and live runner logs with filters. (Screenshot feature ist entfernt.)
- Directory tabs (DirectoryPathsCard) that open per-base heatmaps with path tables, HTTP-code chips and raw-size filters, using Tabler icons for controls.
- Static export served from FastAPI (`/ui`). Always validate through Docker (`docker compose build && docker compose up -d`) to match production.

## Non-Negotiables
- **Do not edit `package.json`, `package-lock.json`, or the Yarn version pin.**
- Stay within Mantine’s component library; avoid mixing arbitrary UI kits.
- Keep files ASCII unless we are rendering localized copy already present.
- Use `@tabler/icons-react` for action icons (Runs table buttons, dynamic tabs, etc.) to keep iconography consistent.

## Project Layout
```
frontend/
├── next.config.mjs          # `output: "export"` for static build
├── pages/                   # _app.tsx, index.tsx, runs/[id].tsx
├── components/              # AppShell + UI widgets (RunForm, RunsTable, HeatmapPanel, ProbeDrawer…)
├── lib/                     # api.ts (REST helpers), hooks.ts (SWR-lite), format.ts
├── styles/globals.css       # global overrides (paired with Mantine core styles)
├── theme.ts                 # Mantine theme + color palette
└── Agents.md / Tasks.md     # this guidance + backlog
```

## Data & API contracts
- Backend base URL: `process.env.NEXT_PUBLIC_API_BASE_URL || http://localhost:8080`. Do **not** hardcode other hosts.
- Fetch helpers in `lib/api.ts` centralize endpoints. Always add new calls there for type safety.
- `useAsyncData` handles polling/refresh. Prefer it over ad-hoc `useEffect` fetches.

## Heatmap Behavior (current spec)
1. Target selection is driven by the table (left column). Active row highlights in teal.
2. Cards represent probes: background color determined by status bucket, intensity by bytes. RAW size text is always visible.
3. Filters:
   - Bucket chips (2xx/3xx/4xx/5xx/Other) reflect only categories present in the selected target.
   - HTTP code chips are generated dynamically from that target’s responses (showing counts) and default to “all selected”.
   - Range slider filters by RAW response bytes.
4. Each base target row (and every path entry inside DirectoryPathsCard) owns its own “Unique response sizes” toggle backed by the full, non-deduplicated matrix payload returned by the backend. Toggling one row never affects another, and status/bucket counts always reflect the full dataset.
5. Targets that triggered the automatic 421 override display a `*` indicator with a tooltip beside the base URL in the heatmap table.
6. Probe drawer auto-loads both metadata and raw response.

## Build, Run & QA
```bash
cd frontend
npm install          # first time only
npm run lint
npm run build        # produces ./out/ for Docker COPY
npm run dev          # optional, expects backend on :8080
```
Docker workflow:
```bash
docker compose build
docker compose up -d
open http://localhost:8080/ui
```

Manual verification checklist:
- Upload `examples/urls` + `examples/fqdns`, ensure run completes and aggregates render.
- Use heatmap filters (bucket + HTTP code + byte range) to confirm combos hide/show cards as expected.
- Exercise the per-target “Unique response sizes” toggles (both on the main heatmap table and inside the directory tabs) to ensure only the current selection changes and status counts stay correct.
- Trigger a 421 in a test run (e.g., by feeding an example dataset) and verify that enabling the auto-421 switch causes the star indicator/tooltip to appear for the affected target.
- Toggle "Apply blacklist" off in RunForm and confirm that previously blacklisted/Cloudflare IPs are no longer skipped (probes appear); toggle on to ensure skips with blacklist payloads persist.
- Check DNS switch default is off; tooltip on the `*` shows “Test all load balancer / reverse proxy IPs”.
- Open probe drawer to verify raw response auto-appears.
- Delete a run and ensure table refresh works.
- Runner logs polling shows new entries without page reload (5s interval).

## Coding Standards
- TypeScript strict rules already enforced; keep functions typed.
- Prefer Mantine layouts (Stack, Group, SimpleGrid). For responsiveness, use Mantine breakpoint props rather than custom CSS.
- Keep components modular—avoid sprawling page files with business logic.
- When adding filters or async actions, ensure UI states (loading/error) are visible.

Refer to `frontend/Tasks.md` for the prioritized backlog tied to this spec.
