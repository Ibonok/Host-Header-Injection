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
from ..models import Aggregate, Run
from ..schemas import RunCreate, RunRead
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


def _cleanup_run_artifacts(run: Run) -> None:
    base = Path(settings.artifacts_dir)
    for probe in run.probes:
        if probe.raw_response_path:
            (base / probe.raw_response_path).unlink(missing_ok=True)
    import_dir = base / "imports" / f"run_{run.id}"
    shutil.rmtree(import_dir, ignore_errors=True)
