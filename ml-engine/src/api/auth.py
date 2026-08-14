"""Supabase access token verification for the API.

The React app authenticates with Supabase Auth and sends the resulting access
token as ``Authorization: Bearer <token>``. This module verifies that token with
Supabase and caches the result briefly so a busy dashboard does not trigger an
auth round trip on every poll.

If Supabase is not configured the API runs in local development mode: requests
are allowed and a warning is logged once. ``REQUIRE_AUTH=true`` plus configured
Supabase credentials is the expected production setup.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import httpx
from fastapi import Depends, Header, HTTPException, status

from ..config import settings

logger = logging.getLogger(__name__)

CACHE_TTL_SECONDS = 60.0
_cache: Dict[str, Tuple[float, "AuthenticatedUser"]] = {}
_cache_lock = threading.Lock()
_warned = False


@dataclass
class AuthenticatedUser:
    id: str
    email: Optional[str]
    role: Optional[str]
    anonymous: bool = False


DEV_USER = AuthenticatedUser(id="local-dev", email=None, role="developer", anonymous=True)


def _warn_once() -> None:
    global _warned
    if not _warned:
        _warned = True
        if not settings.require_auth:
            logger.warning(
                "REQUIRE_AUTH is false: the API is unauthenticated. Only do this on a "
                "local machine."
            )
        else:
            logger.warning(
                "SUPABASE_URL / SUPABASE_ANON_KEY are missing, so tokens cannot be "
                "verified and requests are being allowed through. Set REQUIRE_AUTH "
                "explicitly to make this instance refuse unauthenticated traffic."
            )


async def _verify_with_supabase(token: str) -> AuthenticatedUser:
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/user"
    headers = {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {token}",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as error:
        logger.error("Supabase auth request failed: %s", error)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable.",
        ) from error

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = response.json()
    metadata = payload.get("app_metadata") or {}
    return AuthenticatedUser(
        id=str(payload.get("id", "")),
        email=payload.get("email"),
        role=payload.get("role") or metadata.get("role"),
    )


async def require_user(
    authorization: Optional[str] = Header(default=None),
) -> AuthenticatedUser:
    """FastAPI dependency enforcing a valid Supabase session."""
    if settings.auth_misconfigured:
        # Fail closed. REQUIRE_AUTH was set deliberately, so letting the request
        # through because the credentials are missing would defeat the one
        # setting that was meant to protect this service.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "REQUIRE_AUTH is enabled but SUPABASE_URL / SUPABASE_ANON_KEY are "
                "not configured, so sessions cannot be verified. Set them, or set "
                "REQUIRE_AUTH=false to run this instance unauthenticated on purpose."
            ),
        )

    if not settings.auth_enabled:
        _warn_once()
        return DEV_USER

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Empty bearer token."
        )

    now = time.time()
    with _cache_lock:
        cached = _cache.get(token)
        if cached and cached[0] > now:
            return cached[1]

    user = await _verify_with_supabase(token)
    with _cache_lock:
        _cache[token] = (now + CACHE_TTL_SECONDS, user)
        if len(_cache) > 512:  # keep the cache bounded
            for key in list(_cache)[:256]:
                _cache.pop(key, None)
    return user


CurrentUser = Depends(require_user)
