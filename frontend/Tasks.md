# TASKS.md — Frontend Backlog

## Quickstart
```bash
cd frontend
npm install
npm run lint
npm run build
# full stack
docker compose build && docker compose up -d
open http://localhost:8080/ui
```

## 1. UX polish
- [ ] Add drag-and-drop upload (Mantine Dropzone) with progress + file validation to `RunForm`.
- [ ] Show backend error details inline in the form (currently only generic error message).
- [ ] Persist active target + filters in URL query (so deep-linking into a filtered heatmap works).
- [x] Remove SNI attempt selector; keep only Auto 421 SNI override switch.
- [x] Add "Apply blacklist" switch (default on) and wire through API/backend.
- [x] DNS switch default off; add tooltip on `*` with “Test all load balancer / reverse proxy IPs”.
- [x] Directory list normalization clarified: `test` -> `/test`, `/test` -> `//test`, blank -> `/` (per backend runner).
- [x] Directory-path SubTestCase: status switches (404/403/401/302/301/500) default on; disabling a code drops matching responses before persistence.

## 2. Heatmap enhancements
- [x] Add tooltips summarizing attempt, SNI flags, raw byte size (screenshot support entfernt).
- [x] Allow sorting/filtering the target table (by newest, most 5xx, etc.).
- [x] Remove screenshot support (UI/doc wording cleaned up; backend no longer stores/cleans screenshots).

## 3. Runner logs tab
- [x] Add level filters (info/warn/error) and free-text search.
- [ ] Provide CSV export of the currently filtered logs.
- [ ] Investigate SSE/WS streaming to replace polling once backend endpoint exists.

## 4. Theming & responsiveness
- [x] Implement docs link, light/dark toggle.

## 5. Testing & automation
- [ ] Wire CI job that runs `npm run lint && npm run build` inside Docker image.
- [ ] Snapshot testing for critical components (Mantine Testing Library or Storybook/Chromatic).

## 6. Sequence Group — Single Connection

TestCase "Sequence Group" in the RunForm dropdown, modelled after Burp Suite Repeater's
"Send group in sequence (single connection)".

### Completed
- [x] TestCase dropdown in `RunForm` ("Standard" / "Sequence Group").
- [x] Sequence mode: reuses URL and FQDN file inputs from Standard mode.
- [x] SubTestCase selector available for both Standard and Sequence modes.
- [x] Timeout slider (0.5–120s) and Verify-SSL switch shown for Sequence mode.
- [x] Frontend builds URL x FQDN combinations and sends to `POST /api/runner/sequence-group`.
- [x] `SequenceGroupResultsPanel` displays pair-grouped results:
  - Type column with "Normal" (gray) / "Injected" (orange) badges.
  - Pair separator lines between groups.
  - Diff highlighting: yellow background on injected row when status or size differs from normal.
  - Clickable rows open ProbeDrawer with full request/response dump.
- [x] Runner Logs tab now auto-fetches for Sequence Group runs (fixed `immediate: false` bug).
- [x] `SequenceTiming` type extended with `request_type: "normal" | "injected"`.
- [x] i18n keys added (EN + DE) for type column, pair labels, normal/injected badges.
- [x] Heatmap Grid/Table toggle (SegmentedControl) for standard runs.
- [x] Runs table shows "SEQ" badge for `run_type === "sequence_group"`.

### Files changed
| File | Change |
|---|---|
| `lib/types.ts` | `request_type` on `SequenceTiming` |
| `lib/api.ts` | `fetchSequenceResults()`, `createSequenceGroup()` |
| `lib/i18n.tsx` | Sequence Group keys (EN + DE), heatmap view toggle keys |
| `components/RunForm.tsx` | TestCase dropdown, sequence mode fields, timeout slider |
| `components/SequenceGroupResultsPanel.tsx` | Pair grouping, type column, diff highlighting |
| `components/HeatmapPanel.tsx` | Grid/Table toggle, table view rendering |
| `components/RunsTable.tsx` | "SEQ" badge for sequence group runs |
| `pages/index.tsx` | `onSequenceResult` callback, inline result display |
| `pages/runs/[id].tsx` | Real sequence results via API, logs auto-fetch fix |

### Open
- [ ] Add mode selector (single-connection / separate-connections / parallel) in RunForm.
- [ ] Show connection waterfall diagram per pair (DNS, TCP, TLS, TTFB breakdown).
- [ ] CSV export of sequence group results.

> Work in this file should stay synced with `frontend/Agents.md`. Update both when the spec changes.
