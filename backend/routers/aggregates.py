"""Aggregate endpoints for heatmaps and summaries."""

from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, DefaultDict, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..analysis.compute import persist_aggregates
from ..db import get_session
from ..models import Aggregate
from ..schemas import HeatmapPayload, Summary421
from ..security.auth import require_api_key

router = APIRouter(prefix="/api/runs", tags=["aggregates"])


def _ensure_aggregate(session: Session, run_id: int) -> Aggregate:
    aggregate = session.execute(select(Aggregate).where(Aggregate.run_id == run_id)).scalar_one_or_none()
    if not aggregate:
        aggregate = persist_aggregates(session, run_id)
    return aggregate


def _deserialize(aggregate: Aggregate) -> Dict[str, Any]:
    return {
        "matrix": json.loads(aggregate.matrix_json or "{}"),
        "status_distribution": json.loads(aggregate.status_distribution_json or "{}"),
        "latency_stats": json.loads(aggregate.latency_stats_json or "{}"),
        "diffs": json.loads(aggregate.diffs_json or "[]"),
        "summary_421": json.loads(aggregate.summary_421_json or "{}"),
    }


BUCKET_KEYS = ["success", "redirect", "client_error", "server_error", "other"]


def _status_bucket(value: int) -> str:
    if 200 <= value < 300:
        return "success"
    if 300 <= value < 400:
        return "redirect"
    if 400 <= value < 500:
        return "client_error"
    if 500 <= value < 600:
        return "server_error"
    return "other"


def _unique_by_size(cells: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[int] = set()
    filtered: List[Dict[str, Any]] = []
    for cell in cells:
        bytes_total = cell.get("bytes_total")
        if bytes_total is None:
            filtered.append(cell)
            continue
        if bytes_total in seen:
            continue
        seen.add(bytes_total)
        filtered.append(cell)
    return filtered


def _load_matrix(session: Session, run_id: int) -> Dict[str, Any]:
    """
    Return the persisted matrix for a run. If it does not exist yet, compute and store it.
    This avoids repeatedly scanning the probes table (which is very slow for Directory List runs).
    """
    aggregate = session.execute(select(Aggregate).where(Aggregate.run_id == run_id)).scalar_one_or_none()
    if not aggregate or not aggregate.matrix_json:
        aggregate = persist_aggregates(session, run_id)
    return json.loads(aggregate.matrix_json or "{}")


def _totals_from_matrix(matrix: Dict[str, List[Dict[str, Any]]]):
    status_code_totals: DefaultDict[str, DefaultDict[int, int]] = defaultdict(lambda: defaultdict(int))
    bucket_totals: DefaultDict[str, DefaultDict[str, int]] = defaultdict(lambda: defaultdict(int))
    auto_override_flags: DefaultDict[str, bool] = defaultdict(bool)
    blacklist_flags: DefaultDict[str, bool] = defaultdict(bool)

    for target_url, cells in matrix.items():
        for cell in cells:
            status = cell.get("http_status")
            if status is not None:
                status_code_totals[target_url][int(status)] += 1
                bucket_totals[target_url][_status_bucket(int(status))] += 1
            if cell.get("auto_421_override"):
                auto_override_flags[target_url] = True
            if cell.get("hit_ip_blacklist"):
                blacklist_flags[target_url] = True

    return status_code_totals, bucket_totals, auto_override_flags, blacklist_flags


def _build_payload(
    url: str,
    cells: List[Dict[str, Any]],
    status_code_totals: DefaultDict[str, DefaultDict[int, int]],
    bucket_totals: DefaultDict[str, DefaultDict[str, int]],
    auto_override_flags: DefaultDict[str, bool],
    blacklist_flags: DefaultDict[str, bool],
) -> HeatmapPayload:
    totals_for_target = status_code_totals.get(url)
    buckets_for_target = bucket_totals.get(url)
    return HeatmapPayload(
        target_url=url,
        cells=cells,
        status_code_totals=dict(totals_for_target or {}),
        bucket_totals={bucket: (buckets_for_target.get(bucket, 0) if buckets_for_target else 0) for bucket in BUCKET_KEYS},
        auto_override_421=bool(auto_override_flags.get(url, False)),
        hit_ip_blacklist=bool(blacklist_flags.get(url, False)),
    )


@router.get("/{run_id}/aggregates")
def get_aggregates(run_id: int, session: Session = Depends(get_session)) -> Dict[str, Any]:
    aggregate = _ensure_aggregate(session, run_id)
    return _deserialize(aggregate)


@router.get("/{run_id}/aggregates/matrix", response_model=List[HeatmapPayload])
def get_matrix(
    run_id: int,
    target_url: Optional[str] = Query(None),
    unique_size_only: bool = Query(True),
    session: Session = Depends(get_session),
) -> List[HeatmapPayload]:
    matrix = _load_matrix(session, run_id)
    status_code_totals, bucket_totals, auto_override_flags, blacklist_flags = _totals_from_matrix(matrix)

    response_matrix: Dict[str, Any]
    if unique_size_only:
        response_matrix = {url: _unique_by_size(cells) for url, cells in matrix.items()}
    else:
        response_matrix = matrix

    data: Dict[str, Any] = response_matrix
    if target_url:
        cells = data.get(target_url, [])
        if not cells:
            raise HTTPException(status_code=404, detail="No matrix data for target")
        return [_build_payload(target_url, cells, status_code_totals, bucket_totals, auto_override_flags, blacklist_flags)]
    payloads: List[HeatmapPayload] = []
    for url, cells in data.items():
        payloads.append(_build_payload(url, cells, status_code_totals, bucket_totals, auto_override_flags, blacklist_flags))
    return payloads


@router.post(
    "/{run_id}/aggregates/recompute",
    dependencies=[Depends(require_api_key)],
)
def recompute(run_id: int, session: Session = Depends(get_session)) -> Dict[str, Any]:
    aggregate = persist_aggregates(session, run_id)
    return {"aggregate_id": aggregate.id}


@router.get("/{run_id}/aggregates/421_summary", response_model=Summary421)
def get_421_summary(run_id: int, session: Session = Depends(get_session)) -> Summary421:
    aggregate = _ensure_aggregate(session, run_id)
    summary = json.loads(aggregate.summary_421_json or "{}")
    return Summary421(**summary)
