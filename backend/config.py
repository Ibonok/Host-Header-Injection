"""Configuration helpers for the host-header reporting backend."""

from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central application settings loaded from environment or .env file."""

    database_url: str = "sqlite:///./hh_injection.db"
    artifacts_dir: str = "artifacts"
    snippet_max_bytes: int = 2048
    uvicorn_host: str = "0.0.0.0"
    uvicorn_port: int = 8080

    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[1] / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    def resolve_path(self, relative: str | Path) -> Path:
        """Return a path inside the repository for local assets."""
        rel_path = Path(relative)
        if rel_path.is_absolute():
            return rel_path
        return Path.cwd() / rel_path


@lru_cache()
def get_settings(**overrides: Any) -> Settings:
    """Memoized settings accessor to avoid re-parsing env on every import."""
    return Settings(**overrides)
