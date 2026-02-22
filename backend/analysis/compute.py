"""Compute aggregates for host-header runs."""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path
from statistics import mean
from typing import Dict, List, Optional, Tuple

if __package__ in (None, ""):
    sys.path.append(str(Path(__file__).resolve().parents[2]))

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from backend.db import session_scope
from backend.models import Aggregate, Probe


def _best_probe(existing: Optional[Probe], candidate: Probe) -> Probe:
    if not existing:
        return candidate
    if candidate.attempt > existing.attempt:
        return candidate
    if existing.attempt == candidate.attempt:
        if candidate.http_status < existing.http_status:
            return candidate
    return existing


def compute_matrix(probes: List[Probe]) -> Tuple[Dict[str, List[Dict]], Dict[str, bool], Dict[str, bool]]:
    matrix: Dict[str, Dict[str, Probe]] = defaultdict(dict)
    auto_flags: Dict[str, bool] = defaultdict(bool)
    blacklist_flags: Dict[str, bool] = defaultdict(bool)
    for probe in probes:
        matrix[probe.target_url][probe.tested_host_header] = _best_probe(
            matrix[probe.target_url].get(probe.tested_host_header),
            probe,
        )
        if probe.auto_421_override:
            auto_flags[probe.target_url] = True
        if probe.hit_ip_blacklist:
            blacklist_flags[probe.target_url] = True
    formatted: Dict[str, List[Dict]] = {}
    for target_url, host_map in matrix.items():
        target_override = bool(auto_flags.get(target_url, False))
        formatted[target_url] = [
            {
                "tested_host_header": host,
                "http_status": probe.http_status,
                "bytes_total": probe.bytes_total,
                "attempt": probe.attempt,
                "sni_overridden": target_override or probe.sni_overridden,
                "sni_used": probe.sni_used,
                "probe_id": probe.id,
                "auto_421_override": probe.auto_421_override,
                "hit_ip_blacklist": probe.hit_ip_blacklist,
            }
            for host, probe in sorted(host_map.items(), key=lambda item: item[0])
        ]
    return formatted, auto_flags, blacklist_flags


def compute_status_distribution(probes: List[Probe]) -> Dict[str, int]:
    buckets = {"success": 0, "redirect": 0, "client_error": 0, "server_error": 0, "other": 0}
    for probe in probes:
        status = probe.http_status
        if 200 <= status < 300:
            buckets["success"] += 1
        elif 300 <= status < 400:
            buckets["redirect"] += 1
        elif 400 <= status < 500:
            buckets["client_error"] += 1
        elif 500 <= status < 600:
            buckets["server_error"] += 1
        else:
            buckets["other"] += 1
    return buckets


def compute_latency_stats(probes: List[Probe]) -> Dict[str, float]:
    samples = [probe.response_time_ms for probe in probes if probe.response_time_ms]
    if not samples:
        return {"avg_ms": 0, "min_ms": 0, "max_ms": 0}
    return {"avg_ms": float(mean(samples)), "min_ms": float(min(samples)), "max_ms": float(max(samples))}


def compute_diffs(probes: List[Probe]) -> List[Dict]:
    diffs: List[Dict] = []
    grouped: Dict[str, List[Probe]] = defaultdict(list)
    for probe in probes:
        grouped[probe.correlation_id or f"{probe.target_url}|{probe.tested_host_header}"].append(probe)
    for key, group in grouped.items():
        if len(group) < 2:
            continue
        sorted_group = sorted(group, key=lambda p: (p.attempt, p.created_at))
        first, second = sorted_group[0], sorted_group[-1]
        diffs.append(
            {
                "correlation_id": key,
                "bytes_delta": second.bytes_total - first.bytes_total,
                "status_change": f"{first.http_status}->{second.http_status}",
                "probe_one": first.id,
                "probe_two": second.id,
            }
        )
    return diffs


def compute_421_summary(probes: List[Probe]) -> Dict[str, int]:
    """
    Der Runner führt den Auto-421-Override innerhalb des gleichen Attempts aus und
    persistiert nur das Ergebnis, markiert aber `auto_421_override=True` im Probe.
    Wir zählen daher Overrides anhand dieses Flags und bewerten den Erfolg am finalen Status.
    """
    total_overrides = 0
    retries = 0
    successful = 0
    failed = 0
    for probe in probes:
        if not probe.auto_421_override:
            continue
        total_overrides += 1
        retries += 1
        if probe.http_status and 200 <= probe.http_status < 400:
            successful += 1
        else:
            failed += 1
    return {
        "total_421": total_overrides,
        "retries": retries,
        "successful_retries": successful,
        "failed_retries": failed,
    }


def _compute_status_distribution_sql(session: Session, run_id: int) -> Dict[str, int]:
    """Compute status distribution via SQL aggregation instead of loading all probes."""
    row = session.execute(
        select(
            func.sum(case((Probe.http_status.between(200, 299), 1), else_=0)).label("success"),
            func.sum(case((Probe.http_status.between(300, 399), 1), else_=0)).label("redirect"),
            func.sum(case((Probe.http_status.between(400, 499), 1), else_=0)).label("client_error"),
            func.sum(case((Probe.http_status.between(500, 599), 1), else_=0)).label("server_error"),
            func.sum(case((~Probe.http_status.between(200, 599), 1), else_=0)).label("other"),
        ).where(Probe.run_id == run_id)
    ).one()
    return {
        "success": row.success or 0,
        "redirect": row.redirect or 0,
        "client_error": row.client_error or 0,
        "server_error": row.server_error or 0,
        "other": row.other or 0,
    }


def _compute_latency_stats_sql(session: Session, run_id: int) -> Dict[str, float]:
    """Compute latency stats via SQL aggregation."""
    row = session.execute(
        select(
            func.avg(Probe.response_time_ms).label("avg_ms"),
            func.min(Probe.response_time_ms).label("min_ms"),
            func.max(Probe.response_time_ms).label("max_ms"),
        ).where(
            Probe.run_id == run_id,
            Probe.response_time_ms.isnot(None),
            Probe.response_time_ms > 0,
        )
    ).one()
    return {
        "avg_ms": float(row.avg_ms or 0),
        "min_ms": float(row.min_ms or 0),
        "max_ms": float(row.max_ms or 0),
    }


def _compute_421_summary_sql(session: Session, run_id: int) -> Dict[str, int]:
    """Compute 421 summary via SQL aggregation."""
    row = session.execute(
        select(
            func.count().label("total"),
            func.sum(case(
                (Probe.http_status.between(200, 399), 1), else_=0,
            )).label("successful"),
        ).where(
            Probe.run_id == run_id,
            Probe.auto_421_override == True,  # noqa: E712
        )
    ).one()
    total = row.total or 0
    successful = row.successful or 0
    return {
        "total_421": total,
        "retries": total,
        "successful_retries": successful,
        "failed_retries": total - successful,
    }


def persist_aggregates(session: Session, run_id: int) -> Aggregate:
    # Server-side SQL aggregation for simple stats (avoids loading all probes)
    status_dist = _compute_status_distribution_sql(session, run_id)
    latency_stats = _compute_latency_stats_sql(session, run_id)
    summary_421 = _compute_421_summary_sql(session, run_id)

    # Matrix and diffs still require probe-level data
    probes = session.execute(
        select(Probe).where(Probe.run_id == run_id)
    ).scalars().all()
    matrix, _, _ = compute_matrix(probes)
    diffs = compute_diffs(probes)

    aggregate = session.execute(select(Aggregate).where(Aggregate.run_id == run_id)).scalar_one_or_none()
    payload = {
        "matrix_json": json.dumps(matrix),
        "status_distribution_json": json.dumps(status_dist),
        "latency_stats_json": json.dumps(latency_stats),
        "diffs_json": json.dumps(diffs),
        "summary_421_json": json.dumps(summary_421),
    }
    if aggregate:
        for key, value in payload.items():
            setattr(aggregate, key, value)
    else:
        aggregate = Aggregate(run_id=run_id, **payload)
        session.add(aggregate)
    session.commit()
    session.refresh(aggregate)
    return aggregate


def main(run_id: int) -> None:
    with session_scope() as session:
        aggregate = persist_aggregates(session, run_id)
        print(f"Aggregates stored for run {run_id} (aggregate id={aggregate.id})")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python backend/analysis/compute.py <run_id>")
    main(int(sys.argv[1]))
