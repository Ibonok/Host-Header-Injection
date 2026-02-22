"""Authorized HTTP runner for host-header test cases."""

from __future__ import annotations

import asyncio
import base64
import socket
import ssl
import time
from dataclasses import dataclass
from ipaddress import IPv4Network, IPv6Network, ip_address, ip_network
from pathlib import Path
from urllib.parse import ParseResult, urlparse, urlunparse
from typing import Callable, Iterable, List, Optional, Sequence, Tuple

import aiohttp
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Probe, Run

settings = get_settings()
BAN_FILE = Path(__file__).resolve().parents[2] / "cloudflare-ban.txt"


def _load_cloudflare_networks() -> tuple[list[IPv4Network], list[IPv6Network]]:
    ipv4_networks: list[IPv4Network] = []
    ipv6_networks: list[IPv6Network] = []
    try:
        lines = BAN_FILE.read_text().splitlines()
    except FileNotFoundError:
        return ipv4_networks, ipv6_networks

    for raw_line in lines:
        entry = raw_line.split("#", 1)[0].strip()
        if not entry:
            continue
        try:
            network = ip_network(entry, strict=False)
        except ValueError:
            continue
        if network.version == 4:
            ipv4_networks.append(network)
        else:
            ipv6_networks.append(network)

    return ipv4_networks, ipv6_networks


CLOUDFLARE_IPV4_NETWORKS, CLOUDFLARE_IPV6_NETWORKS = _load_cloudflare_networks()


def _ip_in_blacklist(value: str) -> bool:
    if not value:
        return False
    if not (CLOUDFLARE_IPV4_NETWORKS or CLOUDFLARE_IPV6_NETWORKS):
        return False
    try:
        address = ip_address(value)
    except ValueError:
        return False
    networks = CLOUDFLARE_IPV4_NETWORKS if address.version == 4 else CLOUDFLARE_IPV6_NETWORKS
    return any(address in network for network in networks)


def _slug(value: str) -> str:
    safe = []
    for char in value.lower():
        if char.isalnum():
            safe.append(char)
        else:
            safe.append("-")
    slug = "".join(safe).strip("-")
    return slug or "item"


@dataclass
class RunnerCaseResult:
    url: str
    fqdn: str
    status_code: int | None
    bytes_total: int
    success: bool
    error: str | None = None


@dataclass
class ProbePayload:
    request_url: str  # tatsächlich abgefragte URL (ggf. IP-ersetzt)
    original_url: str  # vom Nutzer eingegebene URL (Hostname blieb erhalten)
    host: str
    status_code: Optional[int]
    status_text: Optional[str]
    bytes_total: int
    response_time_ms: Optional[int]
    snippet_b64: Optional[str]
    raw_response_rel: str
    error: Optional[str]
    sni_overridden: bool = False
    auto_421_override: bool = False
    hit_ip_blacklist: bool = False


class AuthorizedTestRunner:
    """Executes authorized HTTP requests for URL/FQDN combinations."""

    def __init__(
        self,
        session: Session,
        *,
        attempt: int = 1,
        logger: Optional[Callable[[str], None]] = None,
        concurrency: int = 5,
        resolve_all_dns_records: bool = True,
        auto_override_421: bool = False,
        apply_blacklist: bool = True,
        status_filters: Optional[List[int]] = None,
    ) -> None:
        self.session = session
        self.attempt = attempt
        self.responses_dir = Path(settings.artifacts_dir) / "responses" / f"attempt{attempt}"
        self.responses_dir.mkdir(parents=True, exist_ok=True)
        self.snippet_limit = settings.snippet_max_bytes
        self.logger = logger
        self.concurrency = max(1, min(concurrency, 20))
        self.resolve_all_dns_records = resolve_all_dns_records
        self.auto_override_421 = auto_override_421
        self.apply_blacklist = apply_blacklist
        self._disabled_statuses: frozenset[int] = frozenset(status_filters or [])
        self.ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self.ssl_context.check_hostname = False
        self.ssl_context.verify_mode = ssl.CERT_NONE

    def run(
        self,
        run: Run,
        urls: Iterable[str],
        fqdns: Optional[Iterable[str]] = None,
        directories: Optional[Iterable[str]] = None,
        *,
        skip_dns_resolution: bool = False,
        preserve_directory_slash: bool = False,
    ) -> List[RunnerCaseResult]:
        combos: List[tuple[str, str, str, str]] = []  # (request_url, host_header, original_hostname, original_url)
        combo_keys: set[tuple[str, str]] = set()
        global_seen_ips: set[str] = set()
        directory_list = self._prepare_directories(directories, preserve_slash=preserve_directory_slash)
        host_headers = [value.strip() for value in (fqdns or []) if value and value.strip()]
        blacklist_payloads: List[ProbePayload] = []
        blacklist_keys: set[tuple[str, str]] = set()

        # 1) Alle DNS-Abfragen / Cloudflare-Checks und Kombinationsbildung vorab
        for candidate in urls:
            original_url = candidate.strip()
            if not original_url:
                continue

            parsed = urlparse(original_url)
            hostname = parsed.hostname
            if not hostname or not parsed.scheme:
                if self.logger:
                    self.logger(f"Überspringe {original_url}, ungültige URL ohne Hostname/Scheme.")
                continue

            if skip_dns_resolution:
                expanded_urls = self._expand_with_directories([original_url], directory_list)
                target_hosts = host_headers or ([hostname] if hostname else [])
                if not target_hosts:
                    target_hosts = [hostname or ""]
                for final_url in expanded_urls:
                    parsed_final = urlparse(final_url)
                    effective_host = parsed_final.hostname or hostname or ""
                    if self.apply_blacklist and self._host_matches_blacklist(effective_host):
                        if self.logger:
                            self.logger(f"Überspringe {final_url}, Host {effective_host} ist auf der Blacklist.")
                        for host in target_hosts:
                            host_value = host or effective_host
                            key = (final_url, host_value)
                            if key in blacklist_keys:
                                continue
                            blacklist_keys.add(key)
                            blacklist_payloads.append(self._create_blacklist_payload(final_url, host_value, original_url=original_url))
                        continue
                    for host in target_hosts:
                        host_value = host or effective_host
                        key = (final_url, host_value)
                        if key in combo_keys:
                            continue
                        combo_keys.add(key)
                        combos.append((final_url, host_value, hostname or "", original_url))
                continue

            resolved_ips = self._resolve_host_ips(hostname)
            # global dedup über alle Hostnamen: jede IP nur einmal pro Run anfragen
            filtered_ips: List[str] = []
            for ip in resolved_ips:
                if ip in global_seen_ips:
                    continue
                global_seen_ips.add(ip)
                filtered_ips.append(ip)
            resolved_ips = filtered_ips
            if not resolved_ips:
                if self.logger:
                    self.logger(f"Überspringe {original_url}, keine DNS-Einträge (nach globalem Dedupe) gefunden.")
                continue

            if self.logger:
                mode = "alle" if self.resolve_all_dns_records else "erster A/AAAA"
                self.logger(f"DNS-Auflösung für {hostname}: {', '.join(resolved_ips)} (DNS-Modus: {mode})")

            if self.apply_blacklist and self._is_cloudflare_url(original_url, resolved_ips):
                if self.logger:
                    self.logger(f"Überspringe {original_url}, da IP in Cloudflare-Liste ist.")
                blacklist_payloads.extend(
                    self._build_blacklist_payloads(
                        parsed=parsed,
                        resolved_ips=resolved_ips,
                        directories=directory_list,
                        host_headers=host_headers,
                        original_hostname=hostname or "",
                        original_url=original_url,
                    )
                )
                continue

            resolved_urls = self._build_resolved_urls(parsed, resolved_ips)
            expanded_urls = self._expand_with_directories(resolved_urls, directory_list)
            target_hosts = host_headers or ([hostname] if hostname else [])
            if not target_hosts:
                target_hosts = [hostname or ""]
            for resolved_url in expanded_urls:
                for host in target_hosts:
                    host_value = host or (urlparse(resolved_url).hostname or "")
                    key = (resolved_url, host_value)
                    if key in combo_keys:
                        continue
                    combo_keys.add(key)
                    combos.append((resolved_url, host_value, hostname or "", original_url))

        total_cases = len(combos) + len(blacklist_payloads)
        if total_cases == 0:
            if self.logger:
                self.logger("Keine gültigen URL/Host-Kombinationen gefunden, breche Run ab.")
            return []

        run.total_combinations = total_cases
        run.processed_combinations = 0
        self.session.commit()

        if self.logger:
            self.logger(
                f"Insgesamt {total_cases} Kombinationen "
                f"({len(combos)} HTTP + {len(blacklist_payloads)} Blacklist)."
            )

        results: List[RunnerCaseResult] = []
        if blacklist_payloads:
            if self.logger:
                self.logger(f"Persistiere {len(blacklist_payloads)} Blacklist-Kombinationen ohne HTTP-Request.")
            for payload in blacklist_payloads:
                results.append(self._persist_probe(run, payload, commit=False))
            try:
                self.session.commit()
            except Exception as exc:  # noqa: BLE001
                self.session.rollback()
                if self.logger:
                    self.logger(f"Commit-Fehler für Blacklist-Payloads: {exc}")

        if not combos:
            return results

        batch_size = 500
        stop_requested = False
        total = len(combos)

        # 2) HTTP/HTTPS-Requests in 500er-Batches abarbeiten
        for start in range(0, total, batch_size):
            if self._should_stop(run):
                if self.logger:
                    self.logger("Stop-Signal vor Batch-Verarbeitung empfangen, breche Run ab.")
                break

            batch = combos[start:start + batch_size]
            batch_index = start // batch_size + 1

            if self.logger:
                self.logger(
                    f"Verarbeite HTTP-Batch {batch_index}: "
                    f"Kombinationen {start + 1}–{start + len(batch)} von {total}"
                )

            payloads: List[ProbePayload] = asyncio.run(self._gather_payloads(run, batch))

            dns_failed_hosts: set[str] = set()

            for payload in payloads:
                if self._should_stop(run):
                    if self.logger:
                        self.logger("Stop-Signal während Batch-Verarbeitung empfangen, breche Run ab.")
                    stop_requested = True
                    break

                # Probes für Hosts mit DNS-Fehler überspringen
                parsed_host = urlparse(payload.request_url).hostname or ""
                if parsed_host in dns_failed_hosts:
                    continue

                result = self._persist_probe(run, payload, commit=False)
                results.append(result)

                if payload.error and self._is_dns_error(payload.error):
                    if self.logger:
                        self.logger(
                            f"DNS-Fehler bei {payload.request_url} ({parsed_host}), "
                            f"weitere Requests an diesen Host werden übersprungen."
                        )
                    dns_failed_hosts.add(parsed_host)

            # DB-Commit für diesen 500er-Block von Probes
            try:
                self.session.commit()
            except Exception as exc:  # noqa: BLE001
                self.session.rollback()
                if self.logger:
                    self.logger(f"Commit-Fehler für HTTP-Batch {batch_index}: {exc}")

            if self.logger:
                self.logger("Batch abgeschlossen – 2 Sekunden Pause bevor der nächste startet.")
            time.sleep(2)

            if stop_requested:
                break

        return results

    async def _gather_payloads(self, run: Run, combos: List[tuple[str, str, str, str]]) -> List[ProbePayload]:
        semaphore = asyncio.Semaphore(self.concurrency)
        timeout = aiohttp.ClientTimeout(total=5.0)
        connector = aiohttp.TCPConnector(ssl=self.ssl_context)
        async with aiohttp.ClientSession(timeout=timeout, connector=connector) as client:
            tasks = []
            for url, host, original_hostname, original_url in combos:
                if self._should_stop(run):
                    break
                tasks.append(
                    asyncio.create_task(
                        self._fetch_case_async(
                            run,
                            url,
                            host,
                            original_hostname,
                            original_url,
                            client,
                            semaphore,
                        )
                    )
                )
            if self.logger:
                self.logger(f"Erzeuge {len(tasks)} asynchrone Requests.")
            payloads: List[ProbePayload] = []
            for task in asyncio.as_completed(tasks):
                payload = await task
                if payload:
                    payloads.append(payload)
            if self.logger:
                self.logger(f"_gather_payloads abgeschlossen, {len(payloads)} Antworten erhalten.")
            return payloads

    async def _fetch_case_async(
        self,
        run: Run,
        url: str,
        host: str,
        original_hostname: str,
        original_url: str,
        client: aiohttp.ClientSession,
        semaphore: asyncio.Semaphore,
    ) -> Optional[ProbePayload]:
        slug = _slug(url.replace("://", "-").replace("/", "-"))
        host_slug = _slug(host)
        response_path = self.responses_dir / f"{slug}__{host_slug}.txt"
        headers = {
            "Host": host,
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/132.0.0.0 Safari/537.36"
            ),
        }
        if self.logger:
            self.logger(f"Starte Request: {url} mit Host {host}")

        async def perform_request(server_hostname: Optional[str]) -> tuple[
            Optional[int],
            Optional[str],
            Optional[int],
            Optional[str],
            int,
            Optional[str],
        ]:
            ssl_kwargs: dict[str, object] = {}
            https = url.lower().startswith("https")
            if https:
                ssl_kwargs["ssl"] = self.ssl_context
                if server_hostname:
                    ssl_kwargs["server_hostname"] = server_hostname
            start = time.perf_counter()
            status_code: Optional[int] = None
            status_text: Optional[str] = None
            response_time_ms: Optional[int] = None
            snippet_b64: Optional[str] = None
            bytes_total = 0
            error: Optional[str] = None
            try:
                async with client.get(
                    url,
                    headers=headers,
                    allow_redirects=False,
                    **ssl_kwargs,
                ) as resp:
                    body_text = await resp.text()
                    response_time_ms = int((time.perf_counter() - start) * 1000)
                    status_code = resp.status
                    status_text = resp.reason
                    http_version = self._format_http_version(resp.version)
                    combined = self._compose_raw_payload(
                        status_code=status_code,
                        status_text=status_text,
                        headers=list(resp.headers.items()),
                        body_text=body_text,
                        http_version=http_version,
                    )
                    await asyncio.to_thread(
                        response_path.write_text,
                        combined,
                        encoding="utf-8",
                        errors="ignore",
                    )
                    raw_bytes = combined.encode("utf-8", errors="ignore")
                    bytes_total = len(raw_bytes)
                    snippet_b64 = base64.b64encode(raw_bytes[: self.snippet_limit]).decode()
            except Exception as exc:  # noqa: BLE001
                response_time_ms = int((time.perf_counter() - start) * 1000)
                error = str(exc)
                await asyncio.to_thread(
                    response_path.write_text,
                    f"ERROR: {error}",
                    encoding="utf-8",
                    errors="ignore",
                )
                bytes_total = len(error.encode("utf-8"))
            return status_code, status_text, response_time_ms, snippet_b64, bytes_total, error

        async with semaphore:
            https = url.lower().startswith("https")
            default_sni = original_hostname or host
            current_sni = host if self.attempt == 2 else default_sni
            override_attempted = False

            while True:
                (
                    status_code,
                    status_text,
                    response_time_ms,
                    snippet_b64,
                    bytes_total,
                    error,
                ) = await perform_request(current_sni)

                should_override = (
                    self.auto_override_421
                    and https
                    and not override_attempted
                    and error is None
                    and status_code == 421
                    and host
                    and current_sni is not None and current_sni != host
                )
                if should_override:
                    override_attempted = True
                    current_sni = host
                    if self.logger:
                        self.logger(
                            f"421 erkannt für {url} ({host}), erzwinge automatischen SNI-Override."
                        )
                    continue
                break

            sni_overridden = bool(https and (current_sni or "") and (current_sni or "") != (default_sni or ""))
            return ProbePayload(
                request_url=url,
                original_url=original_url,
                host=host,
                status_code=status_code,
                status_text=status_text,
                bytes_total=bytes_total,
                response_time_ms=response_time_ms,
                snippet_b64=snippet_b64,
                raw_response_rel=str(response_path.relative_to(settings.artifacts_dir)),
                error=error,
                sni_overridden=sni_overridden,
                auto_421_override=override_attempted,
            )

    def _persist_probe(self, run: Run, payload: ProbePayload, *, commit: bool = True) -> RunnerCaseResult:
        disabled_statuses = self._disabled_statuses
        if (
            run.sub_test_case == 2
            and payload.status_code is not None
            and payload.status_code in disabled_statuses
        ):
            # Ergebnis wird bewusst nicht persistiert, zählt aber als verarbeitet.
            new_count = (run.processed_combinations or 0) + 1
            if run.total_combinations and run.total_combinations > 0:
                new_count = min(new_count, run.total_combinations)
            run.processed_combinations = new_count
            if commit:
                try:
                    self.session.commit()
                except Exception as exc:  # noqa: BLE001
                    self.session.rollback()
                    if self.logger:
                        self.logger(f"Commit-Fehler (gefilterter Status {payload.status_code}): {exc}")
            if self.logger:
                self.logger(
                    f"Ignoriere Antwort mit Status {payload.status_code} für {payload.request_url} ({payload.host}) "
                    "aufgrund deaktiviertem Statusfilter."
                )
            return RunnerCaseResult(
                url=payload.request_url,
                fqdn=payload.host,
                status_code=payload.status_code,
                bytes_total=payload.bytes_total,
                success=False,
                error="Filtered by status",
            )

        slug = _slug(payload.request_url.replace("://", "-").replace("/", "-"))
        host_slug = _slug(payload.host)
        correlation_id = f"{slug}__{host_slug}"
        if len(correlation_id) > 64:
            correlation_id = correlation_id[:64]

        probe = Probe(
            run_id=run.id,
            target_url=payload.request_url,
            tested_host_header=payload.host,
            http_status=payload.status_code or 0,
            status_text=payload.status_text,
            bytes_total=payload.bytes_total,
            response_time_ms=payload.response_time_ms,
            snippet_b64=payload.snippet_b64,
            raw_response_path=payload.raw_response_rel,
            attempt=self.attempt,
            sni_used=payload.request_url.lower().startswith("https"),
            sni_overridden=payload.sni_overridden,
            auto_421_override=payload.auto_421_override,
            hit_ip_blacklist=payload.hit_ip_blacklist,
            correlation_id=correlation_id,
            reason=payload.error,
        )
        self.session.add(probe)

        new_count = (run.processed_combinations or 0) + 1
        if run.total_combinations and run.total_combinations > 0:
            new_count = min(new_count, run.total_combinations)
        run.processed_combinations = new_count

        if commit:
            try:
                self.session.commit()
            except Exception as exc:  # noqa: BLE001
                self.session.rollback()
                if self.logger:
                    self.logger(
                        f"Commit-Fehler für {payload.request_url} ({payload.host}): {exc}"
                    )

        success = payload.status_code is not None and 200 <= payload.status_code < 600

        if self.logger:
            if payload.error:
                self.logger(f"Fehler bei {payload.request_url} ({payload.host}): {payload.error}")
            else:
                self.logger(
                    f"Erfolg {payload.request_url} ({payload.host}) mit Status {payload.status_code}"
                )

        return RunnerCaseResult(
            url=payload.request_url,
            fqdn=payload.host,
            status_code=payload.status_code,
            bytes_total=payload.bytes_total,
            success=success,
            error=payload.error,
        )

    def _should_stop(self, run: Run) -> bool:
        self.session.refresh(run)
        if run.status == "stopping":
            run.status = "stopped"
            self.session.commit()
            return True
        return run.status == "stopped"

    @staticmethod
    def _format_http_version(version: aiohttp.HttpVersion | None) -> str:
        if not version:
            return "1.1"
        try:
            return f"{version.major}.{version.minor}"
        except AttributeError:
            return "1.1"

    @staticmethod
    def _compose_raw_payload(
        *,
        status_code: int,
        status_text: Optional[str],
        headers: Sequence[Tuple[str, str]],
        body_text: str,
        http_version: str,
    ) -> str:
        status_line = f"HTTP/{http_version} {status_code} {status_text or ''}".strip()
        header_text = "\n".join(f"{k}: {v}" for k, v in headers)
        return f"{status_line}\n{header_text}\n\n{body_text}"

    def _resolve_host_ips(self, host: str) -> List[str]:
        try:
            infos = socket.getaddrinfo(
                host,
                None,
                family=socket.AF_UNSPEC,
                type=socket.SOCK_STREAM,
            )
        except socket.gaierror as exc:
            if self.logger:
                self.logger(f"DNS-Auflösung fehlgeschlagen für {host}: {exc}")
            return []
        except Exception as exc:  # noqa: BLE001
            if self.logger:
                self.logger(f"Unerwarteter DNS-Fehler für {host}: {exc}")
            return []
        ordered_ips: List[str] = []
        seen: set[str] = set()
        for info in infos:
            if (
                not info
                or len(info) < 5
                or info[0] not in (socket.AF_INET, socket.AF_INET6)
                or not info[4]
            ):
                continue
            ip = info[4][0]
            if ip in seen:
                continue
            ordered_ips.append(ip)
            seen.add(ip)

        if self.resolve_all_dns_records or not ordered_ips:
            return ordered_ips

        first_ipv4: Optional[str] = None
        first_ipv6: Optional[str] = None
        for ip in ordered_ips:
            if ":" in ip:
                if first_ipv6 is None:
                    first_ipv6 = ip
            else:
                if first_ipv4 is None:
                    first_ipv4 = ip
            if first_ipv4 and first_ipv6:
                break

        limited = [ip for ip in (first_ipv4, first_ipv6) if ip]
        if limited:
            return limited
        return ordered_ips[:1]

    def _build_resolved_urls(self, parsed: ParseResult, ips: Iterable[str]) -> List[str]:
        resolved_urls: List[str] = []
        for ip in ips:
            netloc = self._compose_netloc(parsed, ip)
            replaced = parsed._replace(netloc=netloc)
            resolved_urls.append(urlunparse(replaced))
        return resolved_urls

    def _expand_with_directories(self, urls: Iterable[str], directories: List[str]) -> List[str]:
        expanded: List[str] = []
        for url in urls:
            parsed = urlparse(url)
            for directory in directories:
                expanded.append(
                    urlunparse(
                        parsed._replace(
                            path=directory,
                            params="",
                            query="",
                            fragment="",
                        )
                    )
                )
        return expanded

    def _build_blacklist_payloads(
        self,
        *,
        parsed: ParseResult,
        resolved_ips: Iterable[str],
        directories: List[str],
        host_headers: List[str],
        original_hostname: str,
        original_url: str,
    ) -> List[ProbePayload]:
        resolved_urls = self._build_resolved_urls(parsed, resolved_ips)
        expanded_urls = self._expand_with_directories(resolved_urls, directories)
        target_hosts = host_headers or ([original_hostname] if original_hostname else [])
        if not target_hosts:
            target_hosts = [original_hostname or ""]
        payloads: List[ProbePayload] = []
        for resolved_url in expanded_urls:
            effective_host = urlparse(resolved_url).hostname or original_hostname or ""
            for host in target_hosts:
                host_value = host or effective_host
                payloads.append(self._create_blacklist_payload(resolved_url, host_value, original_url=original_url))
        return payloads

    def _create_blacklist_payload(self, url: str, host: str, *, original_url: Optional[str] = None) -> ProbePayload:
        blacklist_dir = self.responses_dir / "blacklist"
        blacklist_dir.mkdir(parents=True, exist_ok=True)
        slug = _slug(url.replace("://", "-").replace("/", "-"))
        host_slug = _slug(host or "host")
        response_path = blacklist_dir / f"{slug}__{host_slug}.txt"
        message = (
            "Skipped request because the resolved IP hit the configured blacklist "
            f"(URL: {url}, Host header: {host})."
        )
        response_path.write_text(message, encoding="utf-8", errors="ignore")
        raw_bytes = message.encode("utf-8")
        snippet = base64.b64encode(raw_bytes[: self.snippet_limit]).decode()
        return ProbePayload(
            request_url=url,
            original_url=original_url or url,
            host=host,
            status_code=0,
            status_text="BLACKLISTED",
            bytes_total=len(raw_bytes),
            response_time_ms=0,
            snippet_b64=snippet,
            raw_response_rel=str(response_path.relative_to(settings.artifacts_dir)),
            error="IP matched blacklist",
            sni_overridden=False,
            auto_421_override=False,
            hit_ip_blacklist=True,
        )

    @staticmethod
    def _prepare_directories(directories: Optional[Iterable[str]], *, preserve_slash: bool = False) -> List[str]:
        if not directories:
            return ["/"]
        prepared = [directory for directory in (AuthorizedTestRunner._normalize_directory(value, preserve_slash) for value in directories) if directory]
        return prepared or ["/"]

    @staticmethod
    def _normalize_directory(value: Optional[str], preserve_slash: bool) -> str:
        if not value:
            return "/"
        directory = value.strip()
        if not directory:
            return "/"
        if preserve_slash:
            if directory.startswith("/"):
                return directory
            return f"/{directory}"
        if directory.startswith("/"):
            return directory
        return f"/{directory}"

    @staticmethod
    def _compose_netloc(parsed: ParseResult, ip: str) -> str:
        userinfo = ""
        if parsed.username:
            userinfo = parsed.username
            if parsed.password:
                userinfo += f":{parsed.password}"
            userinfo += "@"
        host_part = ip if ":" not in ip else f"[{ip}]"
        try:
            port = parsed.port
        except ValueError:
            port = None
        if port:
            host_part = f"{host_part}:{port}"
        return f"{userinfo}{host_part}"

    @staticmethod
    def _is_dns_error(message: Optional[str]) -> bool:
        if not message:
            return False
        lowered = message.lower()
        dns_signatures = [
            "name or service not known",
            "temporary failure in name resolution",
            "nodename nor servname provided",
            "failed to resolve hostname",
        ]
        return any(sig in lowered for sig in dns_signatures)

    def _is_cloudflare_url(self, url: str, resolved_ips: Optional[Iterable[str]] = None) -> bool:
        if not (CLOUDFLARE_IPV4_NETWORKS or CLOUDFLARE_IPV6_NETWORKS):
            return False
        try:
            parsed = urlparse(url)
            host = parsed.hostname
            if not host:
                return False
            if resolved_ips is None:
                infos = socket.getaddrinfo(host, None)
                ips = [info[4][0] for info in infos if info and len(info) >= 5]
            else:
                ips = list(resolved_ips)
            for ip in ips:
                if _ip_in_blacklist(ip):
                    return True
        except Exception:
            return False
        return False

    @staticmethod
    def _host_matches_blacklist(host: str) -> bool:
        return _ip_in_blacklist(host)
