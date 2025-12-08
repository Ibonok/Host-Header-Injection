"""SQLAlchemy ORM models."""

from __future__ import annotations

import json
from datetime import datetime
from typing import List, Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Run(Base):
    """Represents a single host-header probe run."""

    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[str] = mapped_column(String(32), default="running")
    concurrency: Mapped[int] = mapped_column(Integer, default=5)
    total_combinations: Mapped[int] = mapped_column(Integer, default=0)
    processed_combinations: Mapped[int] = mapped_column(Integer, default=0)
    resolve_all_dns_records: Mapped[bool] = mapped_column(Boolean, default=True)
    sub_test_case: Mapped[int] = mapped_column(Integer, default=1)
    auto_override_421: Mapped[bool] = mapped_column(Boolean, default=False)
    status_filters_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    probes: Mapped[List["Probe"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    aggregate: Mapped[Optional["Aggregate"]] = relationship(back_populates="run", uselist=False)
    logs: Mapped[List["RunnerLog"]] = relationship(back_populates="run", cascade="all, delete-orphan")

    @property
    def status_filters(self) -> List[int]:
        """Return parsed HTTP status filters as a sorted list."""
        if not self.status_filters_json:
            return []
        try:
            data = json.loads(self.status_filters_json)
        except json.JSONDecodeError:
            return []
        filters: List[int] = []
        for entry in data:
            try:
                code = int(entry)
            except (TypeError, ValueError):
                continue
            if 100 <= code <= 599:
                filters.append(code)
        return sorted(set(filters))

    def set_status_filters(self, codes: List[int]) -> None:
        """Store unique HTTP status filters as JSON or clear the field."""
        unique_codes = sorted({int(code) for code in codes if 100 <= int(code) <= 599})
        self.status_filters_json = json.dumps(unique_codes) if unique_codes else None


class Probe(Base):
    """Individual probe result for a URL + Host header combination."""

    __tablename__ = "probes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    target_url: Mapped[str] = mapped_column(Text)
    tested_host_header: Mapped[str] = mapped_column(Text)
    http_status: Mapped[int] = mapped_column(Integer)
    status_text: Mapped[Optional[str]] = mapped_column(String(255))
    bytes_total: Mapped[int] = mapped_column(Integer)
    response_time_ms: Mapped[Optional[int]] = mapped_column(Integer)
    snippet_b64: Mapped[Optional[str]] = mapped_column(Text)
    screenshot_path: Mapped[Optional[str]] = mapped_column(Text)
    raw_response_path: Mapped[Optional[str]] = mapped_column(Text)
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    sni_used: Mapped[bool] = mapped_column(Boolean, default=False)
    sni_overridden: Mapped[bool] = mapped_column(Boolean, default=False)
    auto_421_override: Mapped[bool] = mapped_column(Boolean, default=False)
    hit_ip_blacklist: Mapped[bool] = mapped_column(Boolean, default=False)
    correlation_id: Mapped[Optional[str]] = mapped_column(String(64))
    reason: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    run: Mapped[Run] = relationship(back_populates="probes")


class Aggregate(Base):
    """Cached aggregate data per run."""

    __tablename__ = "aggregates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"), unique=True)
    matrix_json: Mapped[Optional[str]] = mapped_column(Text)
    status_distribution_json: Mapped[Optional[str]] = mapped_column(Text)
    latency_stats_json: Mapped[Optional[str]] = mapped_column(Text)
    diffs_json: Mapped[Optional[str]] = mapped_column(Text)
    summary_421_json: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    run: Mapped[Run] = relationship(back_populates="aggregate")


class RunnerLog(Base):
    """Log entries produced by the authorized runner."""

    __tablename__ = "runner_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    level: Mapped[str] = mapped_column(String(32), default="info")
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    run: Mapped[Run] = relationship(back_populates="logs")
