# AGENTS.md — Meta Overview

This repository is split into two guided workstreams:

- `backend/Agents.md`, `backend/Tasks.md` – FastAPI + SQLAlchemy ingestion, compute, HTTP runner.
- `frontend/Agents.md`, `frontend/Tasks.md` – Next.js (Mantine UI) dashboard, heatmaps, run management.

Use this file only as a pointer. For day-to-day implementation details, coding standards, and verification steps, always consult the respective subproject files. Both subsystems are tested and debugged through the Docker workflow described in their dedicated instructions (build via `docker compose build`, run via `docker compose up -d`, inspect logs with `docker compose logs`).
