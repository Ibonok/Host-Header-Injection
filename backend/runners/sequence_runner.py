"""Sequence group runner -- sends request pairs sequentially through single TCP connections.

Inspired by Burp Suite Repeater's "Send group in sequence (single connection)" feature
and the reference implementation in SendingWebRequestsThroughSameConnection.

For each URL + FQDN pair:
  1. Open a single httpx.Client (one TCP connection)
  2. Request 1 (normal): GET url with original Host header
  3. Request 2 (injected): GET url with injected Host header (FQDN)
  4. Close connection

This tests Client-Side Desync, Request Smuggling and minimises timing jitter.
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, List, Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Probe, Run, SequenceGroupResult
from ..schemas import SequenceRequestDef

settings = get_settings()


@dataclass
class SequenceRequestResult:
    """Result of one request within the sequence."""

    sequence_index: int
    url: str
    host_header: str
    method: str
    request_type: str = "injected"  # "normal" or "injected"
    http_status: Optional[int] = None
    status_text: Optional[str] = None
    bytes_total: int = 0
    response_time_ms: Optional[int] = None
    snippet_b64: Optional[str] = None
    raw_response_path: Optional[str] = None
    error: Optional[str] = None
    connection_reused: bool = False
    total_time_ms: Optional[int] = None
    probe_id: Optional[int] = None
    # Raw dump for logging
    request_dump: str = ""
    response_dump: str = ""


class SequenceGroupRunner:
    """Execute HTTP request pairs sequentially, each pair over a single TCP connection."""

    def __init__(
        self,
        db_session: Session,
        *,
        timeout: float = 15.0,
        verify_ssl: bool = False,
        snippet_limit: int = 2048,
        logger: Optional[Callable[[str], None]] = None,
    ) -> None:
        self.db_session = db_session
        self.timeout = timeout
        self.verify_ssl = verify_ssl
        self.snippet_limit = snippet_limit
        self.logger = logger or (lambda _msg: None)

    def execute(
        self,
        run: Run,
        requests: List[SequenceRequestDef],
    ) -> List[SequenceRequestResult]:
        """Run all request pairs synchronously."""
        results: List[SequenceRequestResult] = []

        for idx, req_def in enumerate(requests):
            url = str(req_def.url)
            original_host = urlparse(url).hostname or ""
            injected_host = req_def.host_header

            self.logger(
                f"Pair {idx + 1}/{len(requests)}: {url} | "
                f"Host: {original_host} -> {injected_host}"
            )

            pair_results = self._execute_pair(
                run, idx, url, original_host, injected_host, req_def.method
            )
            results.extend(pair_results)

            # Update progress
            run.processed_combinations = idx + 1
            self.db_session.commit()

        return results

    def _execute_pair(
        self,
        run: Run,
        pair_index: int,
        url: str,
        original_host: str,
        injected_host: str,
        method: str,
    ) -> List[SequenceRequestResult]:
        """Send two requests over a single TCP connection."""
        pair_results: List[SequenceRequestResult] = []
        seq_base = pair_index * 2

        with httpx.Client(
            verify=self.verify_ssl,
            timeout=self.timeout,
            follow_redirects=False,
        ) as client:
            # --- Request 1: Normal (original Host) ---
            result_normal = self._send_single(
                client,
                seq_index=seq_base,
                url=url,
                host_header=original_host,
                method=method,
                request_type="normal",
                is_first=True,
            )
            self._persist_result(run, result_normal)
            pair_results.append(result_normal)

            # --- Request 2: Injected Host ---
            if result_normal.error:
                # If normal request failed, skip injected (connection broken)
                result_injected = SequenceRequestResult(
                    sequence_index=seq_base + 1,
                    url=url,
                    host_header=injected_host,
                    method=method,
                    request_type="injected",
                    error="SKIPPED (normal request failed)",
                )
                self._persist_result(run, result_injected)
                pair_results.append(result_injected)
            else:
                result_injected = self._send_single(
                    client,
                    seq_index=seq_base + 1,
                    url=url,
                    host_header=injected_host,
                    method=method,
                    request_type="injected",
                    is_first=False,
                )
                self._persist_result(run, result_injected)
                pair_results.append(result_injected)

        # Log pair summary
        r1 = pair_results[0]
        r2 = pair_results[1]
        self.logger(
            f"  -> Normal: {r1.http_status or r1.error} ({r1.bytes_total}B, {r1.total_time_ms}ms) | "
            f"Injected: {r2.http_status or r2.error} ({r2.bytes_total}B, {r2.total_time_ms}ms)"
        )

        return pair_results

    def _send_single(
        self,
        client: httpx.Client,
        *,
        seq_index: int,
        url: str,
        host_header: str,
        method: str,
        request_type: str,
        is_first: bool,
    ) -> SequenceRequestResult:
        """Execute a single HTTP request and capture full details."""
        headers = {
            "Host": host_header,
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/132.0.0.0 Safari/537.36"
            ),
        }

        result = SequenceRequestResult(
            sequence_index=seq_index,
            url=url,
            host_header=host_header,
            method=method,
            request_type=request_type,
        )

        start = time.perf_counter()
        try:
            resp = client.request(method, url, headers=headers)
            elapsed = time.perf_counter() - start

            result.http_status = resp.status_code
            result.status_text = resp.reason_phrase
            result.bytes_total = len(resp.content)
            result.response_time_ms = int(elapsed * 1000)
            result.total_time_ms = int(elapsed * 1000)
            result.connection_reused = not is_first

            # Capture snippet
            raw_body = resp.content[: self.snippet_limit]
            result.snippet_b64 = base64.b64encode(raw_body).decode()

            # Build full request/response dump
            result.request_dump = self._format_request(resp)
            result.response_dump = self._format_response(resp)

        except httpx.ConnectError as exc:
            elapsed = time.perf_counter() - start
            result.error = f"Connection failed: {exc}"
            result.total_time_ms = int(elapsed * 1000)
            result.response_time_ms = int(elapsed * 1000)
        except httpx.TimeoutException:
            elapsed = time.perf_counter() - start
            result.error = "Timeout"
            result.total_time_ms = int(elapsed * 1000)
            result.response_time_ms = int(elapsed * 1000)
        except httpx.HTTPError as exc:
            elapsed = time.perf_counter() - start
            result.error = f"HTTP error: {exc}"
            result.total_time_ms = int(elapsed * 1000)
            result.response_time_ms = int(elapsed * 1000)

        return result

    @staticmethod
    def _format_request(resp: httpx.Response) -> str:
        """Format the request portion of the exchange."""
        req = resp.request
        lines = [f"{req.method} {req.url} {resp.http_version}"]
        for key, value in req.headers.items():
            lines.append(f"{key}: {value}")
        lines.append("")
        body = req.content.decode("utf-8", errors="replace") if req.content else ""
        if body:
            lines.append(body)
        return "\n".join(lines)

    @staticmethod
    def _format_response(resp: httpx.Response) -> str:
        """Format the response portion of the exchange."""
        lines = [f"{resp.http_version} {resp.status_code} {resp.reason_phrase}"]
        for key, value in resp.headers.items():
            lines.append(f"{key}: {value}")
        lines.append("")
        lines.append(resp.text[:4096])
        return "\n".join(lines)

    def _save_raw_exchange(self, run: Run, result: SequenceRequestResult) -> Optional[str]:
        """Save the full request/response exchange to a file, return relative path."""
        if not result.request_dump and not result.response_dump and not result.error:
            return None

        base = Path(settings.artifacts_dir) / "sequence" / f"run_{run.id}"
        base.mkdir(parents=True, exist_ok=True)
        filename = f"{result.sequence_index}_{result.request_type}.txt"

        content_parts = [
            "=" * 60,
            f"Request Type: {result.request_type}",
            f"Sequence Index: {result.sequence_index}",
            f"URL: {result.url}",
            f"Host Header: {result.host_header}",
            "=" * 60,
            "",
        ]

        if result.error:
            content_parts.extend([
                f"ERROR: {result.error}",
                "",
            ])

        if result.request_dump:
            content_parts.extend([
                ">>> REQUEST",
                "-" * 40,
                result.request_dump,
                "",
            ])

        if result.response_dump:
            content_parts.extend([
                "<<< RESPONSE",
                "-" * 40,
                result.response_dump,
                "",
            ])

        content = "\n".join(content_parts)
        filepath = base / filename
        filepath.write_text(content, encoding="utf-8")

        # Return path relative to artifacts_dir
        return f"sequence/run_{run.id}/{filename}"

    def _persist_result(self, run: Run, result: SequenceRequestResult) -> None:
        """Create Probe + SequenceGroupResult records and save raw response."""
        # Save raw exchange file
        raw_path = self._save_raw_exchange(run, result)

        probe = Probe(
            run_id=run.id,
            target_url=result.url,
            tested_host_header=result.host_header,
            http_status=result.http_status or 0,
            status_text=result.status_text,
            bytes_total=result.bytes_total,
            response_time_ms=result.response_time_ms,
            snippet_b64=result.snippet_b64,
            raw_response_path=raw_path,
            attempt=1,
            sni_used=result.url.lower().startswith("https"),
            reason=result.error,
        )
        self.db_session.add(probe)
        self.db_session.flush()

        result.probe_id = probe.id

        sgr = SequenceGroupResult(
            run_id=run.id,
            probe_id=probe.id,
            sequence_index=result.sequence_index,
            connection_reused=result.connection_reused,
            total_time_ms=result.total_time_ms,
            request_type=result.request_type,
        )
        self.db_session.add(sgr)
        self.db_session.commit()
