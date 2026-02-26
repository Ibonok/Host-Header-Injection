"""Run management routes."""

from __future__ import annotations

from typing import List

import shutil
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_session
from ..models import Aggregate, Run, SequenceGroupResult as SequenceGroupResultModel
from ..schemas import RunCreate, RunRead, SequenceGroupRead, SequenceTimingRead
from ..security.auth import require_api_key

router = APIRouter(prefix="/api/runs", tags=["runs"])
settings = get_settings()


@router.get("/", response_model=List[RunRead])
def list_runs(session: Session = Depends(get_session)) -> List[RunRead]:
    runs = session.execute(select(Run).order_by(Run.created_at.desc())).scalars().all()
    return runs


@router.post(
    "/",
    response_model=RunRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_api_key)],
)
def create_run(payload: RunCreate, session: Session = Depends(get_session)) -> RunRead:
    run = Run(**payload.model_dump())
    session.add(run)
    session.commit()
    session.refresh(run)
    return run


@router.get("/{run_id}", response_model=RunRead)
def get_run(run_id: int, session: Session = Depends(get_session)) -> RunRead:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return run


@router.delete(
    "/{run_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_run(run_id: int, session: Session = Depends(get_session)) -> None:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    aggregate = session.execute(select(Aggregate).where(Aggregate.run_id == run_id)).scalar_one_or_none()
    if aggregate:
        session.delete(aggregate)
    _cleanup_run_artifacts(run)
    session.delete(run)
    session.commit()


@router.get("/{run_id}/sequence-results", response_model=SequenceGroupRead)
def get_sequence_results(run_id: int, session: Session = Depends(get_session)) -> SequenceGroupRead:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    if run.run_type != "sequence_group":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Run is not a sequence group")

    sgr_rows = (
        session.execute(
            select(SequenceGroupResultModel)
            .where(SequenceGroupResultModel.run_id == run_id)
            .order_by(SequenceGroupResultModel.sequence_index)
        )
        .scalars()
        .all()
    )

    timing_results = []
    for sgr in sgr_rows:
        probe = sgr.probe
        timing_results.append(
            SequenceTimingRead(
                sequence_index=sgr.sequence_index,
                probe_id=sgr.probe_id,
                connection_reused=sgr.connection_reused,
                dns_time_ms=sgr.dns_time_ms,
                tcp_connect_time_ms=sgr.tcp_connect_time_ms,
                tls_handshake_time_ms=sgr.tls_handshake_time_ms,
                time_to_first_byte_ms=sgr.time_to_first_byte_ms,
                total_time_ms=sgr.total_time_ms,
                http_status=probe.http_status if probe else None,
                status_text=probe.status_text if probe else None,
                bytes_total=probe.bytes_total if probe else 0,
                error=probe.reason if probe else None,
                request_type=sgr.request_type,
                target_url=str(probe.target_url) if probe else None,
                tested_host_header=probe.tested_host_header if probe else None,
            )
        )

    total_elapsed = sum(r.total_time_ms or 0 for r in timing_results)
    return SequenceGroupRead(
        run_id=run.id,
        run_name=run.name,
        total_requests=len(timing_results),
        results=timing_results,
        total_elapsed_ms=total_elapsed,
    )


def _cleanup_run_artifacts(run: Run) -> None:
    base = Path(settings.artifacts_dir)
    for probe in run.probes:
        if probe.raw_response_path:
            (base / probe.raw_response_path).unlink(missing_ok=True)
    import_dir = base / "imports" / f"run_{run.id}"
    shutil.rmtree(import_dir, ignore_errors=True)
