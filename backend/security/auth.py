"""Simple API key auth dependency placeholder."""

from fastapi import Depends, Header, HTTPException, status

from ..config import get_settings


settings = get_settings()


def require_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    """Require API key only if configured."""
    required = getattr(settings, "api_key", None)
    if not required:
        return
    if x_api_key != required:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid API key")
