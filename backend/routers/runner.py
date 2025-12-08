"""Run creation and runner orchestration endpoints."""

from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..analysis.compute import persist_aggregates
from ..config import get_settings
from ..db import SessionLocal, get_session
from ..models import RunnerLog, Run
from ..runners import AuthorizedTestRunner
from ..schemas import RunnerLogRead, RunRead
settings = get_settings()


router = APIRouter(prefix="/api/runner", tags=["runner"])


def _store_source_files(
    run_id: int,
    urls_content: str,
    fqdns_content: str,
    directories_content: str | None = None,
) -> None:
    import_dir = Path(settings.artifacts_dir) / "imports" / f"run_{run_id}"
    import_dir.mkdir(parents=True, exist_ok=True)
    (import_dir / "urls.txt").write_text(urls_content, encoding="utf-8")
    (import_dir / "fqdns.txt").write_text(fqdns_content, encoding="utf-8")
    if directories_content is not None:
        (import_dir / "directories.txt").write_text(directories_content, encoding="utf-8")


def _append_log(session: Session, run_id: int, message: str, level: str = "info") -> None:
    session.add(RunnerLog(run_id=run_id, message=message, level=level))
    session.commit()


def _run_runner_background(
    run_id: int,
    urls: List[str],
    fqdns: List[str],
    attempt: int,
    concurrency: int,
    resolve_all_dns_records: bool,
    auto_override_421: bool,
    apply_blacklist: bool,
    sub_test_case: int,
    directories: List[str],
    skip_dns_resolution: bool,
    status_filters: List[int],
) -> None:
    session = SessionLocal()
    try:
        run = session.get(Run, run_id)
        if not run:
            return
        run.status = "running"
        session.commit()
        dns_mode = "direkt" if skip_dns_resolution else ("alle DNS-Einträge" if resolve_all_dns_records else "nur erster A/AAAA")
        subtest_label = f"SubTestCase {sub_test_case}" if sub_test_case else "SubTestCase 1"
        filters_note = f", deaktivierte Status: {status_filters}" if status_filters else ""
        _append_log(
            session,
            run_id,
            (
                f"Runner gestartet (Attempt {attempt}, SubTest {subtest_label}, {len(urls)} URLs x {max(1, len(fqdns))} FQDNs"
                f" x {len(directories)} Verzeichnisse, Concurrency {run.concurrency}, DNS {dns_mode}, Blacklist {'an' if apply_blacklist else 'aus'}{filters_note})"
            ),
        )
        runner = AuthorizedTestRunner(
            session=session,
            attempt=attempt,
            concurrency=run.concurrency,
            resolve_all_dns_records=resolve_all_dns_records,
            auto_override_421=auto_override_421,
            apply_blacklist=apply_blacklist,
            logger=lambda msg: _append_log(session, run_id, msg),
        )
        runner.run(
            run,
            urls,
            fqdns,
            directories,
            skip_dns_resolution=skip_dns_resolution,
            preserve_directory_slash=sub_test_case == 2,
        )
        session.refresh(run)
        if run.status == "running":
            run.status = "success"
        elif run.status in ("stopping", "stopped"):
            run.status = "stopped"
        session.commit()
        _append_log(session, run_id, "Runner abgeschlossen")
        persist_aggregates(session, run_id)
        session.commit()
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        run = session.get(Run, run_id)
        if run:
            run.status = "failed"
            session.commit()
        try:
            _append_log(session, run_id, f"Runner Fehler: {exc}", level="error")
        except Exception:
            session.rollback()
    finally:
        session.close()


@router.post("/create-from-lists", response_model=RunRead)
async def create_run_from_lists(
    background_tasks: BackgroundTasks,
    name: str = Form(...),
    description: str = Form(""),
    attempt: int = Form(1),
    sub_test_case: int = Form(1),
    concurrency: int = Form(5),
    resolve_all_dns_records: bool = Form(True),
    auto_override_421: bool = Form(False),
    apply_blacklist: bool = Form(True),
    urls_file: UploadFile = File(...),
    fqdns_file: UploadFile | None = File(None),
    directories_file: UploadFile | None = File(None),
    status_filters: str | None = Form(None),
    session: Session = Depends(get_session),
) -> RunRead:
    if attempt not in (1, 2):
        raise HTTPException(status_code=400, detail="Attempt muss 1 oder 2 sein")
    if concurrency < 1 or concurrency > 20:
        raise HTTPException(status_code=400, detail="Concurrency muss zwischen 1 und 20 liegen")

    if sub_test_case not in (1, 2):
        raise HTTPException(status_code=400, detail="SubTestCase muss 1 oder 2 sein")

    urls_bytes = await urls_file.read()
    urls_content = urls_bytes.decode("utf-8", errors="ignore")
    urls = [line.strip() for line in urls_content.splitlines() if line.strip()]
    if not urls:
        raise HTTPException(status_code=400, detail="URLs dürfen nicht leer sein")

    fqdns_content = ""
    fqdns: List[str] = []
    if fqdns_file:
        fqdns_bytes = await fqdns_file.read()
        fqdns_content = fqdns_bytes.decode("utf-8", errors="ignore")
        fqdns = [line.strip() for line in fqdns_content.splitlines() if line.strip()]
    elif sub_test_case == 1:
        raise HTTPException(status_code=400, detail="FQDNs sind für SubTestCase 1 erforderlich")

    directories: List[str]
    directories_content: str | None = None
    if sub_test_case == 1:
        directories = ["/"]
    else:
        if not directories_file:
            raise HTTPException(status_code=400, detail="SubTestCase 2 erfordert eine Verzeichnisliste")
        dirs_bytes = await directories_file.read()
        directories_content = dirs_bytes.decode("utf-8", errors="ignore")
        directories = [line.strip() for line in directories_content.splitlines() if line.strip()]
        if not directories:
            raise HTTPException(status_code=400, detail="Verzeichnispfade dürfen nicht leer sein")

    status_filter_codes: List[int] = []
    if status_filters:
        for token in status_filters.split(","):
            token = token.strip()
            if not token:
                continue
            try:
                code = int(token)
            except ValueError:
                continue
            if 100 <= code <= 599:
                status_filter_codes.append(code)
        status_filter_codes = sorted(set(status_filter_codes))

    effective_fqdns = len(fqdns) if fqdns else 1
    total_combinations = len(urls) * effective_fqdns * (len(directories) if directories else 1)
    run = Run(
        name=name,
        description=description,
        concurrency=concurrency,
        total_combinations=total_combinations,
        processed_combinations=0,
        resolve_all_dns_records=resolve_all_dns_records,
        sub_test_case=sub_test_case,
        auto_override_421=auto_override_421,
    )
    if sub_test_case == 2:
        run.set_status_filters(status_filter_codes)
    session.add(run)
    session.commit()
    session.refresh(run)

    _store_source_files(run.id, urls_content, fqdns_content, directories_content)
    skip_dns_resolution = sub_test_case == 2 and not fqdns
    dns_mode = (
        "direkt"
        if skip_dns_resolution
        else ("alle DNS-Einträge" if resolve_all_dns_records else "nur erster A/AAAA")
    )
    if auto_override_421:
        dns_mode = f"{dns_mode} + auto-421"
    filters_note = f", deaktivierte Status: {status_filter_codes}" if status_filter_codes else ""
    _append_log(
        session,
        run.id,
        (
            f"Runner wird im Hintergrund gestartet (Attempt {attempt}, SubTest {sub_test_case}, "
            f"{len(urls)} URLs x {effective_fqdns} FQDNs x {len(directories)} Verzeichnisse, "
            f"Concurrency {concurrency}, DNS {dns_mode}{filters_note})"
        ),
    )
    background_tasks.add_task(
        _run_runner_background,
        run.id,
        urls,
        fqdns,
        attempt,
        concurrency,
        resolve_all_dns_records,
        auto_override_421,
        apply_blacklist,
        sub_test_case,
        directories,
        skip_dns_resolution,
        status_filter_codes,
    )
    return run


@router.post("/{run_id}/stop", response_model=RunRead)
def stop_run(run_id: int, session: Session = Depends(get_session)) -> RunRead:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    if run.status not in ("running", "stopping"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Run kann nicht gestoppt werden")
    run.status = "stopping"
    session.commit()
    _append_log(session, run.id, "Stop angefordert", level="warning")
    session.refresh(run)
    return run


@router.get("/{run_id}/logs", response_model=List[RunnerLogRead])
def list_runner_logs(
    run_id: int,
    limit: int = 50,
    offset: int = 0,
    session: Session = Depends(get_session),
) -> List[RunnerLogRead]:
    run = session.get(Run, run_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    logs = (
        session.execute(
            select(RunnerLog)
            .where(RunnerLog.run_id == run_id)
            .order_by(RunnerLog.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        .scalars()
        .all()
    )
    return logs
