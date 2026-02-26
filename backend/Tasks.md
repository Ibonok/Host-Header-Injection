# TASKS.md — Backend Workstream

## Quickstart via Docker
1. Copy `.env.example` → `.env`, adjust DB + ARTIFACTS paths.
2. Build & run: `docker compose build && docker compose up -d`.
3. Logs: `docker compose logs app -f`. Use `docker exec hostreport_app` for ingest/runner commands.

## 1) Runner Hardening & Logging
- [x] Abort URL when IP matches `cloudflare-ban.txt`; log decision.
- [x] Extend runner logs with duration + per-URL byte counts.
- [ ] Add endpoint to stream logs via SSE for live UI.

## 2) Runner Throughput
- [x] Parallelise per-URL execution with bounded worker pool.
- [x] Store per-host latency aggregates for quick summaries.

## 3) API Enhancements
- [x] `GET /api/runs/{id}` should embed aggregate summary + latest log snippet.
- [ ] Add `DELETE /api/runs/{id}/artifacts-only` (retain DB rows for forensic review).
- [ ] Rate-limit run creation endpoint (`/api/runner/create-from-lists`).
- [x] Persist run-level disabled status list and have runner drop matching responses (SubTestCase 2 filters from UI).

## 4) Tests
- [x] Pytest suite covering runner skip logic (Cloudflare + DNS errors).
- [ ] Integration test that creates run via file upload, asserts probes + logs exist.
- [ ] Docker-based smoke test script (`scripts/test_docker.sh`) to build image, ingest samples, curl healthz.

## 5) Docs & Tooling
- [ ] Update `backend/Agents.md` when APIs change.
- [ ] Provide `Makefile` targets (`make docker-build`, `make runner RUN_ID=...`).
- [ ] Document common runner troubleshooting (timeouts, TLS issues) in README.

## 6) Sequence Group — Single Connection

Implements Burp Suite Repeater's "Send group in sequence (single connection)" pattern.
Reference implementation: `SendingWebRequestsThroughSameConnection/main.py`.

### Completed
- [x] New `SequenceGroupRunner` using `httpx` (replaced `aiohttp`).
- [x] Two-request pattern per URL x FQDN pair over a single TCP connection:
  1. Request 1 (normal): `GET <URL>` with original Host header.
  2. Request 2 (injected): `GET <URL>` with FQDN as Host header.
- [x] Full request/response dump saved to `artifacts/sequence/run_{id}/{index}_{type}.txt`.
- [x] `request_type` field added to `SequenceGroupResult` model (`"normal"` / `"injected"`).
- [x] DB migration in `main.py` for `request_type` column on existing databases.
- [x] `SequenceTimingRead` schema extended with `request_type`.
- [x] `POST /api/runner/sequence-group` now creates `RunnerLog` entries (start, per-pair progress, completion/error).
- [x] Logger callback passed to `SequenceGroupRunner` for real-time log persistence.
- [x] `GET /api/runs/{run_id}/sequence-results` returns real timing data with `request_type`.
- [x] `SequenceGroupCreate.timeout_seconds` max raised from 30 to 120.
- [x] `SequenceGroupCreate.requests` max raised from 50 to 5000.
- [x] `httpx` added to `pyproject.toml` dependencies.
- [x] `SequenceTimingRead` extended with `target_url` and `tested_host_header` fields.
- [x] Both `POST /api/runner/sequence-group` and `GET /api/runs/{run_id}/sequence-results` now return `target_url` and `tested_host_header` per timing entry (sourced from Probe / runner result).

### Files changed
| File | Change |
|---|---|
| `pyproject.toml` | Added `httpx` dependency |
| `models.py` | `request_type` column on `SequenceGroupResult` |
| `main.py` | Migration for `request_type` column |
| `schemas.py` | `request_type`, `target_url`, `tested_host_header` in `SequenceTimingRead`; `timeout_seconds` max 120; `requests` max 5000 |
| `runners/sequence_runner.py` | Complete rewrite: httpx, two-request pattern, raw response files, logging |
| `routers/runner.py` | Logging in `create_sequence_group`, logger callback to runner; populates `target_url`/`tested_host_header` |
| `routers/runs.py` | `request_type`, `target_url`, `tested_host_header` in `get_sequence_results` endpoint |

### API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/runner/sequence-group` | Create and execute a sequence group run |
| `GET` | `/api/runs/{run_id}/sequence-results` | Fetch sequence timing results with probe data |

### Open
- [ ] Add HTTP/2 support (httpx `http2=True` + `h2` dependency).
- [ ] Add `separate-connections` and `parallel` modes (reference implementation supports all three).
- [ ] Integration test for sequence group creation + result retrieval.

> **Testing/Debugging requirement:** Always verify fixes inside Docker (`docker compose build`, `docker compose up -d`, `docker compose logs app`).
