"""Valkey connection client factory, isolated per asyncio event loop."""

from __future__ import annotations

import asyncio
from typing import Any
from weakref import WeakKeyDictionary

import structlog

from app.core.settings import settings

logger = structlog.get_logger("app.cache")
_valkey_pools: WeakKeyDictionary[Any, Any] = WeakKeyDictionary()


def get_valkey_pool() -> Any:
    """Return an async Valkey client owned by the current event loop.

    Async Redis/Valkey clients must not be shared across Granian runtime
    threads/event loops. Doing so can attach Futures to the wrong loop and
    cause intermittent timeouts under dashboard request bursts.
    """
    loop = asyncio.get_running_loop()
    client = _valkey_pools.get(loop)
    if client is None:
        try:
            import valkey.asyncio as valkey

            client = valkey.from_url(
                settings.valkey_url,
                decode_responses=False,
                socket_connect_timeout=0.75,
                socket_timeout=0.75,
            )
        except ImportError:
            import redis.asyncio as redis

            client = redis.from_url(
                settings.valkey_url,
                decode_responses=False,
                socket_connect_timeout=0.75,
                socket_timeout=0.75,
            )
        _valkey_pools[loop] = client
    return client
