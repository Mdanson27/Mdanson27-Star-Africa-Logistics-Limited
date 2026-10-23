"""
Authentication and Role-Based Access Control (RBAC) guards.

Guards
------
1. JWTAuthGuard / jwt_auth_guard
   • Validates Authorization: Bearer <token>
   • Checks Valkey revocation blocklist
   • Populates connection.scope with user_id, tenant_id, role, is_superuser, token_jti

2. SuperuserGuard / SuperAdminGuard / superuser_guard
   • Validates superadmin privileges (is_superuser=True or role='superadmin')
   • Raises 401 if unauthenticated, 403 Forbidden if not superuser
"""

from __future__ import annotations

import jwt
import structlog
from litestar.connection import ASGIConnection
from litestar.exceptions import NotAuthorizedException, PermissionDeniedException
from litestar.types import RouteHandlerType

from app.core.neon_jwt import decode_neon_access_token_async, decode_neon_session_token_async
from app.core.security import decode_access_token, is_token_revoked
from app.core.settings import settings

logger = structlog.get_logger()


class JWTAuthGuard:
    """
    Bearer-token guard with Valkey-backed revocation check.
    """

    async def __call__(
        self,
        connection: ASGIConnection,
        handler: RouteHandlerType,
    ) -> None:
        # Extract Authorization header
        auth_header = connection.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise NotAuthorizedException(
                "Authorization header missing or malformed. "
                "Expected: 'Authorization: Bearer <token>'"
            )

        token = auth_header[len("Bearer ") :]

        # Decode & validate JWT. Production is Neon-only when managed auth is
        # configured. Development/test may also accept Bertcom's locally-issued
        # HS256 token so the built-in local login and API test harness remain
        # usable without weakening the production trust boundary.
        token_is_neon = False
        try:
            if settings.NEON_AUTH_JWKS_URL:
                environment = settings.ENVIRONMENT.lower()
                looks_like_jwt = token.count(".") == 2

                if looks_like_jwt:
                    algorithm = str(jwt.get_unverified_header(token).get("alg") or "").upper()
                    if environment != "production" and algorithm == "HS256":
                        payload = decode_access_token(token)
                    else:
                        payload = await decode_neon_access_token_async(token)
                        token_is_neon = True
                else:
                    payload = await decode_neon_session_token_async(token)
                    token_is_neon = True
            else:
                payload = decode_access_token(token)
        except Exception as exc:
            logger.warning(
                "auth_token_rejected",
                token_length=len(token),
                dot_count=token.count("."),
                token_kind="jwt" if token.count(".") == 2 else "opaque_session",
                error_type=type(exc).__name__,
                error_message=str(exc)[:240],
                path=connection.url.path,
            )
            raise NotAuthorizedException("Invalid or expired session token.") from exc

        user_id: str | None = payload.get("sub")
        jti: str | None = payload.get("jti")
        email = str(payload.get("email") or "").lower()
        token_role = payload.get("role")
        role: str = str(token_role or "authenticated")
        # Managed Neon Auth is intentionally email-locked to the configured
        # AutoMinds platform administrator. Local HS256 tokens are accepted only
        # outside production and honor their explicit is_superuser claim.
        is_super: bool = (
            bool(email and email in settings.admin_emails)
            if token_is_neon
            else bool(payload.get("is_superuser", False))
        )
        tenant_id: str | None = payload.get("tenant_id") or payload.get("organization_id")

        if not user_id:
            raise NotAuthorizedException("Token is missing 'sub' claim.")

        # Revocation check via Valkey
        if jti and await is_token_revoked(jti):
            raise NotAuthorizedException("This session has been revoked. Please log in again.")

        # Inject identity into scope and connection
        connection.scope["user_id"] = user_id
        connection.scope["token_jti"] = jti or ""
        connection.scope["is_superuser"] = is_super
        connection.scope["tenant_id"] = tenant_id or ""
        connection.scope["role"] = "superadmin" if is_super else role
        connection.scope["email"] = email


jwt_auth_guard = JWTAuthGuard()


def superuser_guard(connection: ASGIConnection, _: RouteHandlerType) -> None:
    """
    Asserts that the current authenticated user is the configured platform administrator.
    """
    user_id = connection.scope.get("user_id")
    if not user_id:
        raise NotAuthorizedException("Authentication required.")
    is_super = bool(connection.scope.get("is_superuser", False))
    if not is_super:
        raise PermissionDeniedException("Platform administrator privileges required.")


class SuperuserGuard:
    """
    Composite guard that verifies JWT authentication and enforces superuser privileges.
    """

    def __init__(self) -> None:
        self._auth = JWTAuthGuard()

    async def __call__(
        self,
        connection: ASGIConnection,
        handler: RouteHandlerType,
    ) -> None:
        await self._auth(connection, handler)
        superuser_guard(connection, handler)


# Standardized SuperAdminGuard alias
SuperAdminGuard = SuperuserGuard

__all__ = [
    "JWTAuthGuard",
    "SuperAdminGuard",
    "SuperuserGuard",
    "jwt_auth_guard",
    "superuser_guard",
]
