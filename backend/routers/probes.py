"""Probe ingestion and query endpoints."""

from __future__ import annotations

from typing import Iterable, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Probe, Run
from ..schemas import BulkProbeCreate, ProbeFilters, ProbeRead, RetryPair
from ..security.auth import require_api_key

router = APIRouter(prefix="/api", tags=["probes"])


def _apply_filters(query, filters: ProbeFilters) -> Iterable[Probe]:
    clauses = []
    if filters.only_421:
        clauses.append(Probe.http_status == 421)
    if filters.attempt:
        clauses.append(Probe.attempt == filters.attempt)
    if filters.host:
        clauses.append(Probe.tested_host_header == filters.host)
    if filters.url:
        clauses.append(Probe.target_url == filters.url)
    if filters.status:
        clauses.append(Probe.http_status == filters.status)
    if clauses:
        query = query.where(and_(*clauses))
    return query


@router.get("/runs/{run_id}/probes", response_model=List[ProbeRead])
def list_probes(
    run_id: int,
    only_421: bool = Query(False),
    attempt: Optional[int] = Query(None, ge=1, le=2),
    host: Optional[str] = None,
    url: Optional[str] = None,
    status_code: Optional[int] = Query(None, alias="status", ge=100, le=599),
    session: Session = Depends(get_session),
) -> List[ProbeRead]:
    filters = ProbeFilters(
        only_421=only_421,
        attempt=attempt,
        host=host,
        url=url,
        status=status_code,
    )
    query = select(Probe).where(Probe.run_id == run_id).order_by(Probe.target_url, Probe.tested_host_header)
    query = _apply_filters(query, filters)
    rows = session.execute(query).scalars().all()
    return rows


@router.get("/probes/{probe_id}", response_model=ProbeRead)
def get_probe(probe_id: int, session: Session = Depends(get_session)) -> ProbeRead:
    probe = session.get(Probe, probe_id)
    if not probe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Probe not found")
    return probe


@router.post(
    "/runs/{run_id}/probes/bulk",
    response_model=List[ProbeRead],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
)
def ingest_probes(run_id: int, payload: BulkProbeCreate, session: Session = Depends(get_session)) -> List[ProbeRead]:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    created: List[Probe] = []
    for probe_data in payload.probes:
        probe = Probe(run_id=run_id, **probe_data.model_dump())
        session.add(probe)
        created.append(probe)
    session.commit()
    for probe in created:
        session.refresh(probe)
    return created


@router.get("/runs/{run_id}/retries", response_model=List[RetryPair])
def list_retries(run_id: int, session: Session = Depends(get_session)) -> List[RetryPair]:
    query = (
        select(Probe)
        .where(Probe.run_id == run_id, Probe.correlation_id.is_not(None))
        .order_by(Probe.correlation_id, Probe.attempt)
    )
    probes = session.execute(query).scalars().all()
    pairs: dict[str, RetryPair] = {}
    for probe in probes:
        if not probe.correlation_id:
            continue
        pair = pairs.get(probe.correlation_id)
        if not pair:
            if probe.attempt == 2:
                pairs[probe.correlation_id] = RetryPair(
                    correlation_id=probe.correlation_id,
                    attempt_one=probe,
                    attempt_two=None,
                )
            else:
                pairs[probe.correlation_id] = RetryPair(
                    correlation_id=probe.correlation_id,
                    attempt_one=probe,
                )
            continue
        if probe.attempt == 2:
            pairs[probe.correlation_id] = RetryPair(
                correlation_id=probe.correlation_id,
                attempt_one=pair.attempt_one,
                attempt_two=probe,
            )
    return list(pairs.values())
