# TASKS.md — Meta Overview

Task tracking is now split per subsystem:

- `backend/Tasks.md` – API, runner, compute, testing instructions (Docker-first workflow).
- `frontend/Tasks.md` – Mantine UI, dashboard features, client-side testing notes.

Use this file only as an index. Always follow the Docker-based test/debug cycle described in the respective subproject file when verifying changes.

---

## Recent Changes

### Sequence Group — Single Connection (Burp-Style)

A new TestCase **Sequence Group** was added, modelled after Burp Suite Repeater's
"Send group in sequence (single connection)" and the standalone reference tool
`SendingWebRequestsThroughSameConnection`.

For every URL x FQDN pair the runner opens **one TCP connection** and sends
two requests sequentially:

1. **Normal** — `GET <URL>` with the original Host header.
2. **Injected** — `GET <URL>` with the FQDN as Host header.

This enables testing for Client-Side Desync, HTTP Request Smuggling, and
Host-Header Injection while minimising timing jitter.

Key changes:
- Backend sequence runner rewritten with `httpx` (single-connection, two-request pattern).
- Full request/response dumps saved as artifacts (viewable in ProbeDrawer).
- Runner logs now created for Sequence Group runs.
- Frontend detail page shows pair-grouped results (Normal vs. Injected) with diff highlighting.
- Heatmap panel supports Grid/Table toggle for standard runs.
- Timeout increased to max 120s.

See `backend/Tasks.md` and `frontend/Tasks.md` for implementation details.

### Sequence Group — URL Columns & Status Code Batches

The Sequence Group results table has been enhanced:

- **URL + Host Header columns** added to the results table. The API now returns
  `target_url` and `tested_host_header` per timing entry. Host Header is rendered
  bold for injected requests to visually distinguish manipulated headers.
- **Status code batch chips** (Heatmap-style) above the table. Each chip shows an
  HTTP code with its count (e.g. `200 (12)`, `403 (4)`), colored by bucket
  (green/yellow/orange/red). Clicking chips filters pairs by status code;
  a "Reset" button clears the filter.
- Table wrapped in `ScrollArea` for horizontal scrollability.

Backend: `SequenceTimingRead` schema extended with `target_url` and `tested_host_header`.
Frontend: `SequenceGroupResultsPanel` uses `Chip.Group` + `bucketFromStatus`/`statusColor`
from the existing heatmap utilities.
