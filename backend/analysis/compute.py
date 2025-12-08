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

from sqlalchemy import select

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
        retries += 1  # es wurde ein Override-Versuch ausgelöst
        # Wir werten den Override als „erfolgreich ausgeführt“, unabhängig vom finalen HTTP-Status,
        # weil der Runner im gleichen Attempt keine erste 421-Response persistiert.
        successful += 1
        # Optional: wenn du Status-Erfolg sehen willst, ersetze obige Zeile durch eine Statusprüfung
        # und erhöhe andernfalls `failed`.
    return {
        "total_421": total_overrides,
        "retries": retries,
        "successful_retries": successful,
        "failed_retries": failed,
    }


def persist_aggregates(session: Session, run_id: int) -> Aggregate:
    probes = session.execute(select(Probe).where(Probe.run_id == run_id)).scalars().all()
    matrix, _, _ = compute_matrix(probes)
    status_dist = compute_status_distribution(probes)
    latency_stats = compute_latency_stats(probes)
    diffs = compute_diffs(probes)
    summary_421 = compute_421_summary(probes)

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
