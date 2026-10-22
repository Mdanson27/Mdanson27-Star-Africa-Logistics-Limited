"""Atomic Sliding Window Rate Limiter powered by Valkey."""

from __future__ import annotations

import asyncio
import json
import time

import structlog
from litestar.middleware.base import AbstractMiddleware
from litestar.types import ASGIApp, Receive, Scope, Send

from app.core.cache import get_valkey_pool
from app.core.settings import settings

logger = structlog.get_logger("app.ratelimit")

LUA_SLIDING_WINDOW = """
local current_key = KEYS[1]
local prev_key = KEYS[2]
local limit = tonumber(ARGV[1])
local current_weight = tonumber(ARGV[2])

local current_count = tonumber(redis.call('get', current_key) or '0')
local prev_count = tonumber(redis.call('get', prev_key) or '0')

local estimated_count = math.floor(prev_count * (1 - current_weight) + current_count)

if estimated_count >= limit then
    return {0, limit - estimated_count, estimated_count}
else
    redis.call('incr', current_key)
    redis.call('expire', current_key, 120)
    return {1, limit - (estimated_count + 1), estimated_count + 1}
end
"""


def _request_headers(scope: Scope) -> dict[bytes, str]:
    return {
        key.lower(): value.decode("utf-8", errors="ignore").strip()
        for key, value in scope.get("headers", [])
    }


def extract_client_ip(scope: Scope) -> str:
    """Extract real client IP prioritized by Cloudflare, X-Forwarded-For, or ASGI client."""
    header_map = _request_headers(scope)

    if cf_ip := header_map.get(b"cf-connecting-ip"):
        return cf_ip

    if xff := header_map.get(b"x-forwarded-for"):
        return xff.split(",")[0].strip()

    client = scope.get("client")
    if client and len(client) > 0 and client[0]:
        return str(client[0])

    return "127.0.0.1"


def _cors_headers(scope: Scope) -> list[tuple[bytes, bytes]]:
    origin = _request_headers(scope).get(b"origin")
    if not origin or origin not in settings.cors_origins:
        return []
    return [
        (b"access-control-allow-origin", origin.encode()),
        (b"access-control-allow-credentials", b"true"),
        (b"vary", b"Origin"),
    ]


class SlidingWindowRateLimitMiddleware(AbstractMiddleware):
    """Sliding-window atomic rate limiter evaluating traffic quotas per category and IP."""

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "GET").upper()

        # CORS preflight is transport metadata, not business traffic. Counting OPTIONS
        # against the quota can create a self-amplifying 429/CORS failure loop.
        if method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        # Health probes must measure dependencies directly. Running readiness through
        # the Valkey-backed rate limiter creates a circular dependency.
        if path == "/health" or path.startswith("/health/"):
            await self.app(scope, receive, send)
            return

        if "/api/v1/auth/login" in path:
            limit = 5
            category = "auth"
        elif "/api/v1/whatsapp" in path:
            limit = 500
            category = "webhook"
        else:
            # The UI intentionally loads several independent operational datasets at
            # once. 600/min still protects the API while leaving enough room for normal
            # navigation, retries, PDF previews and background refreshes.
            limit = 600
            category = "api"

        client_ip = extract_client_ip(scope)
        now = int(time.time())
        window_size = 60
        current_window = now // window_size
        prev_window = current_window - 1
        current_weight = (now % window_size) / window_size

        key_current = f"rl:{category}:{client_ip}:{current_window}"
        key_prev = f"rl:{category}:{client_ip}:{prev_window}"

        try:
            valkey_client = get_valkey_pool()
            async with asyncio.timeout(0.75):
                result = await valkey_client.eval(
                    LUA_SLIDING_WINDOW, 2, key_current, key_prev, limit, current_weight
                )
            allowed, remaining, _total = result[0], result[1], result[2]
        except Exception as exc:  # noqa: BLE001
            logger.warning("ratelimit.valkey_error", error=str(exc))
            await self.app(scope, receive, send)
            return

        reset_time = window_size - (now % window_size)

        if not allowed:
            body = json.dumps({"error": "Too Many Requests", "retry_after": reset_time}).encode(
                "utf-8"
            )
            headers = [
                (b"content-type", b"application/json"),
                (b"ratelimit-limit", str(limit).encode()),
                (b"ratelimit-remaining", b"0"),
                (b"ratelimit-reset", str(reset_time).encode()),
                (b"retry-after", str(reset_time).encode()),
                *_cors_headers(scope),
            ]
            await send({"type": "http.response.start", "status": 429, "headers": headers})
            await send({"type": "http.response.body", "body": body})
            return

        async def send_with_ratelimit_headers(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"ratelimit-limit", str(limit).encode()))
                headers.append((b"ratelimit-remaining", str(max(0, remaining)).encode()))
                headers.append((b"ratelimit-reset", str(reset_time).encode()))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_ratelimit_headers)
