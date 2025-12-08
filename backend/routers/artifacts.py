"""Artifact serving endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_session
from ..models import Probe

router = APIRouter(prefix="/api/probes", tags=["artifacts"])
settings = get_settings()


def _resolve_artifact(path_value: str | None) -> Path:
    if not path_value:
        raise HTTPException(status_code=404, detail="Artifact missing")
    base = Path(settings.artifacts_dir)
    candidate = base / path_value
    if not candidate.exists():
        raise HTTPException(status_code=404, detail="Artifact not found")
    return candidate


@router.get("/{probe_id}/raw", response_class=PlainTextResponse)
def get_raw_response(probe_id: int, session: Session = Depends(get_session)) -> PlainTextResponse:
    probe = session.get(Probe, probe_id)
    if not probe:
        raise HTTPException(status_code=404, detail="Probe not found")
    path = _resolve_artifact(probe.raw_response_path)
    return PlainTextResponse(path.read_text(encoding="utf-8", errors="ignore"))


@router.get("/{probe_id}/screenshot")
def get_screenshot(probe_id: int, session: Session = Depends(get_session)) -> PlainTextResponse:
    raise HTTPException(status_code=404, detail="Screenshot feature removed")
