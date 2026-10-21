from __future__ import annotations

import asyncio
import threading
from functools import lru_cache

import jwt

from app.core.settings import settings

_jwks_lookup_lock = threading.Lock()


@lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    """Reuse the JWKS client so signing keys are cached between API requests."""
    if not settings.NEON_AUTH_JWKS_URL:
        raise ValueError("NEON_AUTH_JWKS_URL is not configured")
    return jwt.PyJWKClient(
        settings.NEON_AUTH_JWKS_URL,
        cache_keys=True,
        timeout=5,
        lifespan=300,
    )


def _decode_neon_access_token_sync(token: str) -> dict:
    # A Business dashboard can start many authenticated requests together. The
    # lock prevents the first burst from issuing duplicate JWKS downloads before
    # PyJWKClient has had a chance to warm its signing-key cache.
    with _jwks_lookup_lock:
        signing_key = _jwks_client().get_signing_key_from_jwt(token)
    algorithm = getattr(signing_key, "algorithm_name", None) or "RS256"
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=[algorithm],
        options={"verify_aud": False},
    )


async def decode_neon_access_token_async(token: str) -> dict:
    """Validate Neon JWTs without blocking Litestar's event loop on JWKS I/O."""
    return await asyncio.to_thread(_decode_neon_access_token_sync, token)
