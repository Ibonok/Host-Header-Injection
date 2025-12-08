"""FastAPI entrypoint for the host-header reporting backend."""

from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import inspect, text

from .db import Base, engine
from .routers import aggregates, artifacts, probes, runner, runs

app = FastAPI(title="Host Header Reporting API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(runs.router)
app.include_router(probes.router)
app.include_router(aggregates.router)
app.include_router(artifacts.router)
app.include_router(runner.router)

STATIC_DIR = Path(__file__).resolve().parents[1] / "frontend-static"
if STATIC_DIR.exists():
    app.mount("/ui", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
    next_dir = STATIC_DIR / "_next"
    if next_dir.exists():
        app.mount("/_next", StaticFiles(directory=next_dir), name="next-static")


@app.on_event("startup")
def init_schema() -> None:
    Base.metadata.create_all(bind=engine)
    _apply_post_schema_migrations()


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def serve_root() -> Response:
    if STATIC_DIR.exists():
        index_file = STATIC_DIR / "index.html"
        if index_file.exists():
            return FileResponse(index_file)
    return JSONResponse({"message": "Frontend static build missing. Run `npm run build` first."})


def _apply_post_schema_migrations() -> None:
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    if "runs" in tables:
        run_columns = {column["name"] for column in inspector.get_columns("runs")}
        if "status" not in run_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE runs ADD COLUMN status TEXT NOT NULL DEFAULT 'running'"))
        if "concurrency" not in run_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE runs ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 5"))
        if "total_combinations" not in run_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE runs ADD COLUMN total_combinations INTEGER NOT NULL DEFAULT 0"))
        if "processed_combinations" not in run_columns:
            with engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE runs ADD COLUMN processed_combinations INTEGER NOT NULL DEFAULT 0")
                )
        if "resolve_all_dns_records" not in run_columns:
            with engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE runs ADD COLUMN resolve_all_dns_records BOOLEAN NOT NULL DEFAULT TRUE")
                )
        if "sub_test_case" not in run_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE runs ADD COLUMN sub_test_case INTEGER NOT NULL DEFAULT 1"))
        if "auto_override_421" not in run_columns:
            with engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE runs ADD COLUMN auto_override_421 BOOLEAN NOT NULL DEFAULT FALSE")
                )
        if "status_filters_json" not in run_columns:
            with engine.begin() as connection:
                connection.execute(text("ALTER TABLE runs ADD COLUMN status_filters_json TEXT"))
    if "probes" in tables:
        probe_columns = {column["name"] for column in inspector.get_columns("probes")}
        if "auto_421_override" not in probe_columns:
            with engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE probes ADD COLUMN auto_421_override BOOLEAN NOT NULL DEFAULT FALSE")
                )
        if "hit_ip_blacklist" not in probe_columns:
            with engine.begin() as connection:
                connection.execute(
                    text("ALTER TABLE probes ADD COLUMN hit_ip_blacklist BOOLEAN NOT NULL DEFAULT FALSE")
                )
