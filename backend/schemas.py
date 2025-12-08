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
