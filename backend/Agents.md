# AGENTS.md — Backend (FastAPI + Runner)

## Overview
The backend ingests authorised host-header probe data, persists it via FastAPI + SQLAlchemy, computes aggregates (matrix/status/latency/421 summary), and exposes APIs for the Mantine dashboard. A runner performs authorised HTTP calls, captures raw responses, and logs execution per run. All manual testing/debugging should happen inside Docker (`docker compose build`, `docker compose up -d`, `docker compose logs app`).

## Structure
backend/
├── pyproject.toml (uv-managed FastAPI deps)
├── config.py / config.yaml (paths, limits)
├── main.py (FastAPI setup, routers)
├── db.py (SQLAlchemy engine/session)
├── models.py (Run, Probe, Aggregate, RunnerLog, SequenceGroupResult)
├── routers/
│   ├── runs.py (CRUD, artifact cleanup)
│   ├── runner.py (file upload, runner execution, logs)
│   ├── probes.py, aggregates.py, artifacts.py
├── runners/authorized_runner.py (HTTP worker + Cloudflare skip)
├── analysis/compute.py (matrix/status/diffs/421 summary recompute)
├── ingest_jsonl.py / ingest_lists.py (CLI ingest helpers)
└── migrations/*.sql (schema + runner log table)

## Build & Commands
- Install deps: `cd backend && uv pip install --system .`
- Lint/type/tests: `pytest`, `ruff check` (if configured). Keep coverage ≥ 80%.
- Local run: `uvicorn backend.main:app --reload` (requires `DATABASE_URL` + `ARTIFACTS_DIR`).
- Docker test cycle:
  ```bash
  docker compose build
  docker compose up -d
  docker compose logs app -f
  ```
  Use `docker exec hostreport_app ...` to run ingest scripts or call the runner with the bundled examples.

## Conventions
- Python 3.12, `uv` for dependency management.
- FastAPI routers grouped by domain; each must guard CRUD with proper HTTP exceptions.
- SQLAlchemy ORM + Alembic-style SQL migrations (manual `.sql`).
- Runner logs go into `runner_logs` table for UI consumption.
- Cloudflare IP ban list stored in `cloudflare-ban.txt` (skip URL before HTTP call).
- Matrix endpoint (`GET /api/runs/{id}/aggregates/matrix`) can be filtered via `unique_size_only=true/false` but always returns the full per-target status/bucket totals so the UI can show accurate counts regardless of deduplication.
- Sequence Group endpoints (`POST /api/runner/sequence-group`, `GET /api/runs/{id}/sequence-results`) return `SequenceTimingRead` objects with `target_url` and `tested_host_header` per entry so the frontend can display which URL was tested and which Host header was used (original vs. injected).
- Directory list handling: `_normalize_directory` now preserves leading slashes. A line `test` wird zu `/test`, eine Zeile `/test` zu `//test`; leere/blanke Zeilen werden zu `/`.
- Run creation enforces DNS resolution unless the job is SubTestCase 2 *and* no FQDN list is provided; that is the sole scenario where `skip_dns_resolution` is enabled (directory expansion over raw URLs). All other runs still resolve DNS, switching only between "alle" vs. "erster A/AAAA" records based on `resolve_all_dns_records`.
- `auto_override_421` (exposed on run creation and stored per probe) automatically retries HTTPS combinations that return HTTP 421 with the tested host as SNI. These overrides are logged (`+ auto-421`) and propagated to the heatmap so the frontend can surface an indicator.*
- SubTestCase 2 supports **status drop-filters**: the run stores a list of disabled HTTP statuses (default empty list; UI switches default on). When a response matches a disabled code (e.g., 404/403/401/302/301/500 toggled off), the runner counts the combination but **does not persist** the probe to the database and logs the skip.

## Security & Ops
- Never commit secrets; `.env.example` documents required variables.
- Runner only targets authorised hosts; DNS failures short-circuit remaining host headers for that URL.
- HTTP runner relies on `aiohttp` (no headless browser requirement).
- Run creation accepts `sub_test_case` to control directory paths: `1` hits `/`, `2` expects an uploaded directories list that multiplies URL/FQDN combinations.
- When introducing new runner parameters, document how they impact DNS resolution and aggregation output so the frontend contract stays synchronized.

## Testing Focus
- Unit tests for schema validation, runner logging, aggregate computations.
- Integration tests: run ingest JSONL, recompute aggregates, verify API responses.
- E2E check: use Docker runner to ingest `examples/urls` + `examples/fqdns`, verify `GET /api/runs`, `/api/runner/{id}/logs`, artifact files under `/data/artifacts`.

Follow `backend/Tasks.md` for the current backlog.
