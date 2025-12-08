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

> Work in this file should stay synced with `frontend/Agents.md`. Update both when the spec changes.
