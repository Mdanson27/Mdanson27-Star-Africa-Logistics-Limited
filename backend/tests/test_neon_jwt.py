from __future__ import annotations

import asyncio
import threading

import pytest

from app.core import neon_jwt


def test_jwks_client_is_reused(monkeypatch: pytest.MonkeyPatch) -> None:
    created = 0

    class FakeClient:
        def __init__(
            self,
            url: str,
            cache_keys: bool = True,
            timeout: int = 30,
            lifespan: int = 300,
        ) -> None:
            nonlocal created
            created += 1
            self.url = url
            self.cache_keys = cache_keys
            self.timeout = timeout
            self.lifespan = lifespan

    monkeypatch.setattr(neon_jwt.settings, "NEON_AUTH_JWKS_URL", "https://auth.example/jwks")
    monkeypatch.setattr(neon_jwt.jwt, "PyJWKClient", FakeClient)
    neon_jwt._jwks_client.cache_clear()
    try:
        first = neon_jwt._jwks_client()
        second = neon_jwt._jwks_client()
        assert first is second
        assert created == 1
        assert first.cache_keys is True
        assert first.timeout == 5
        assert first.lifespan == 300
    finally:
        neon_jwt._jwks_client.cache_clear()


@pytest.mark.asyncio
async def test_neon_decode_does_not_block_event_loop(monkeypatch: pytest.MonkeyPatch) -> None:
    event_loop_thread = threading.get_ident()
    worker_thread: int | None = None

    def fake_decode(token: str) -> dict:
        nonlocal worker_thread
        worker_thread = threading.get_ident()
        return {"sub": token}

    monkeypatch.setattr(neon_jwt, "_decode_neon_access_token_sync", fake_decode)
    result = await neon_jwt.decode_neon_access_token_async("user-123")

    assert result == {"sub": "user-123"}
    assert worker_thread is not None
    assert worker_thread != event_loop_thread
    await asyncio.sleep(0)
