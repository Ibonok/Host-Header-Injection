"""Pydantic models used by the FastAPI routes."""

from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, computed_field


class RunBase(BaseModel):
    name: str = Field(..., max_length=255)
    description: Optional[str] = None


class RunCreate(RunBase):
    pass


class RunRead(RunBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    status: str
    concurrency: int
    total_combinations: int
    processed_combinations: int
    resolve_all_dns_records: bool
    sub_test_case: int
    auto_override_421: bool
    status_filters: List[int] = []
    run_type: str = "standard"


class ProbeBase(BaseModel):
    target_url: HttpUrl
    tested_host_header: str
    http_status: int = Field(..., ge=0, le=599)
    status_text: Optional[str] = None
    bytes_total: int = Field(..., ge=0)
    response_time_ms: Optional[int] = Field(None, ge=0)
    snippet_b64: Optional[str] = Field(None, max_length=4096)
    screenshot_path: Optional[str] = None
    raw_response_path: Optional[str] = None
    attempt: int = Field(1, ge=1, le=2)
    sni_used: bool = False
    sni_overridden: bool = False
    auto_421_override: bool = False
    hit_ip_blacklist: bool = False
    correlation_id: Optional[str] = Field(None, max_length=64)
    reason: Optional[str] = Field(None, max_length=1024)


class ProbeCreate(ProbeBase):
    pass


class ProbeRead(ProbeBase):
    id: int
    run_id: int
    created_at: datetime


class BulkProbeCreate(BaseModel):
    probes: List[ProbeCreate]


class ProbeFilters(BaseModel):
    only_421: bool = False
    attempt: Optional[int] = Field(None, ge=1, le=2)
    host: Optional[str] = None
    url: Optional[str] = None
    status: Optional[int] = Field(None, ge=100, le=599)


class HeatmapCell(BaseModel):
    tested_host_header: str
    http_status: int
    bytes_total: int
    attempt: int
    sni_overridden: bool
    sni_used: bool
    probe_id: int
    auto_421_override: bool = False
    hit_ip_blacklist: bool = False

    @computed_field  # type: ignore[misc]
    @property
    def status_bucket(self) -> str:
        status = self.http_status
        if 200 <= status < 300:
            return "success"
        if 300 <= status < 400:
            return "redirect"
        if 400 <= status < 500:
            return "client_error"
        if 500 <= status < 600:
            return "server_error"
        return "other"


class HeatmapPayload(BaseModel):
    target_url: str
    cells: List[HeatmapCell]
    status_code_totals: Dict[int, int]
    bucket_totals: Dict[str, int]
    auto_override_421: bool = False
    hit_ip_blacklist: bool = False


class RetryPair(BaseModel):
    correlation_id: str
    attempt_one: ProbeRead
    attempt_two: Optional[ProbeRead] = None

    @computed_field  # type: ignore[misc]
    @property
    def retry_success(self) -> bool:
        if not self.attempt_two:
            return False
        return 200 <= self.attempt_two.http_status < 400


class Summary421(BaseModel):
    total_421: int
    retries: int
    successful_retries: int
    failed_retries: int


class RunnerLogRead(BaseModel):
    id: int
    level: str
    message: str
    created_at: datetime


# --- Sequence Group (Send group in sequence, single connection) ---


class SequenceRequestDef(BaseModel):
    """A single request definition within a sequence group."""
    url: HttpUrl
    host_header: str = Field(..., max_length=255)
    method: str = Field("GET", pattern=r"^(GET|HEAD|POST|PUT|DELETE|OPTIONS)$")


class SequenceGroupCreate(BaseModel):
    """Payload for creating a sequence-group run."""
    name: str = Field(..., max_length=255)
    description: Optional[str] = None
    requests: List[SequenceRequestDef] = Field(..., min_length=1, max_length=5000)
    timeout_seconds: float = Field(5.0, ge=0.5, le=120.0)
    verify_ssl: bool = False


class SequenceTimingRead(BaseModel):
    """Timing breakdown for one request in the sequence."""
    model_config = ConfigDict(from_attributes=True)

    sequence_index: int
    probe_id: Optional[int] = None
    connection_reused: bool
    dns_time_ms: Optional[int] = None
    tcp_connect_time_ms: Optional[int] = None
    tls_handshake_time_ms: Optional[int] = None
    time_to_first_byte_ms: Optional[int] = None
    total_time_ms: Optional[int] = None
    http_status: Optional[int] = None
    status_text: Optional[str] = None
    bytes_total: int = 0
    error: Optional[str] = None
    request_type: str = "injected"
    target_url: Optional[str] = None
    tested_host_header: Optional[str] = None


class SequenceGroupRead(BaseModel):
    """Response model for a completed sequence group."""
    run_id: int
    run_name: str
    total_requests: int
    results: List[SequenceTimingRead]
    total_elapsed_ms: int
