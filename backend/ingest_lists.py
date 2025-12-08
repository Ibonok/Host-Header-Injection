"""Ingest probes from authorised URL/FQDN lists paired with recorded artifacts."""

from __future__ import annotations

import argparse
import base64
import re
import sys
from pathlib import Path
from typing import List, Tuple

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from backend.analysis.compute import persist_aggregates
from backend.config import get_settings
from backend.db import session_scope
from backend.models import Probe, Run

settings = get_settings()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a run from url/fqdn lists and stored responses.")
    parser.add_argument("--urls", type=Path, required=True, help="Path to file with newline-separated URLs.")
    parser.add_argument("--fqdns", type=Path, required=True, help="Path to file with newline-separated FQDN host headers.")
    parser.add_argument("--artifacts-dir", type=Path, default=Path(settings.artifacts_dir), help="Directory with responses/ subfolder.")
    parser.add_argument("--run-name", help="Display name for the created run (optional when --run-id is set).")
    parser.add_argument("--description", default="", help="Optional run description.")
    parser.add_argument("--run-id", type=int, help="Attach probes to an existing run id.")
    parser.add_argument("--attempt", type=int, default=1, choices=[1, 2], help="Attempt number for the ingested probes.")
    parser.add_argument("--compute", action="store_true", help="Trigger aggregate recompute after ingest.")
    args = parser.parse_args()
    if not args.run_id and not args.run_name:
        parser.error("--run-name is required when --run-id is not provided")
    return args


def _read_list(path: Path) -> List[str]:
    entries: List[str] = []
    with path.open() as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            entries.append(line)
    return entries


def _slug(value: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9]+", "-", value)
    clean = clean.strip("-").lower()
    return clean or "item"


def _parse_response(path: Path) -> Tuple[int, str, str, int]:
    content = path.read_text(encoding="utf-8", errors="ignore")
    first_line = content.splitlines()[0] if content else ""
    status_code = 0
    status_text = ""
    parts = first_line.split(" ", 2)
    if len(parts) >= 2 and parts[1].isdigit():
        status_code = int(parts[1])
        status_text = parts[2] if len(parts) > 2 else ""
    bytes_total = len(content.encode("utf-8"))
    snippet = base64.b64encode(content.encode("utf-8")[: settings.snippet_max_bytes]).decode()
    return status_code, status_text, snippet, bytes_total


def main() -> None:
    args = parse_args()
    urls = _read_list(args.urls)
    hosts = _read_list(args.fqdns)
    artifacts_dir = args.artifacts_dir
    response_dir = artifacts_dir / "responses" / f"attempt{args.attempt}"
    missing = []
    ingested = 0

    with session_scope() as session:
        if args.run_id:
            run = session.get(Run, args.run_id)
            if not run:
                raise SystemExit(f"Run id {args.run_id} not found")
        else:
            run = Run(name=args.run_name, description=args.description)
            session.add(run)
            session.flush()
        for url in urls:
            url_slug = _slug(url)
            for host in hosts:
                host_slug = _slug(host)
                response_path = response_dir / f"{url_slug}__{host_slug}.txt"
                if not response_path.exists():
                    missing.append(response_path)
                    continue
                status_code, status_text, snippet, bytes_total = _parse_response(response_path)
                correlation_id = f"{url_slug}__{host_slug}"
                if len(correlation_id) > 64:
                    correlation_id = correlation_id[:64]
                probe = Probe(
                    run_id=run.id,
                    target_url=url,
                    tested_host_header=host,
                    http_status=status_code,
                    status_text=status_text,
                    bytes_total=bytes_total,
                    response_time_ms=None,
                    snippet_b64=snippet,
                    screenshot_path=None,
                    raw_response_path=str(response_path.relative_to(artifacts_dir)),
                    attempt=args.attempt,
                    sni_used=False,
                    sni_overridden=args.attempt == 2,
                    correlation_id=correlation_id,
                    reason="ingest_lists",
                )
                session.add(probe)
                ingested += 1
        session.commit()
        if args.compute:
            persist_aggregates(session, run.id)

    if missing:
        print("WARNING: missing response artifacts:")
        for path in missing:
            print(f" - {path}")
    print(f"Ingested {ingested} probes for run '{run.name}' (id={run.id})")


if __name__ == "__main__":
    main()
