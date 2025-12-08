"""Utility to ingest authorised JSONL probe data into the database."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[1]))

from backend.analysis.compute import persist_aggregates
from backend.db import session_scope
from backend.models import Probe, Run


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest probe JSONL and compute aggregates.")
    parser.add_argument("jsonl", type=Path, help="Path to JSONL file containing probes.")
    parser.add_argument("--run-name", required=True, help="Name for the created run.")
    parser.add_argument("--description", default="", help="Optional run description.")
    parser.add_argument("--compute", action="store_true", help="Persist aggregates after ingest.")
    return parser.parse_args()


def load_records(path: Path) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    with path.open() as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            records.append(json.loads(line))
    return records


def main() -> None:
    args = parse_args()
    records = load_records(args.jsonl)
    with session_scope() as session:
        run = Run(name=args.run_name, description=args.description)
        session.add(run)
        session.flush()
        for record in records:
            probe = Probe(run_id=run.id, **record)
            session.add(probe)
        session.commit()
        if args.compute:
            persist_aggregates(session, run.id)
    print(f"Ingested {len(records)} probes for run '{args.run_name}'")


if __name__ == "__main__":
    main()
