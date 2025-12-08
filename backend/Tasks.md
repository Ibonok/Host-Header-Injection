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

> **Testing/Debugging requirement:** Always verify fixes inside Docker (`docker compose build`, `docker compose up -d`, `docker compose logs app`).
