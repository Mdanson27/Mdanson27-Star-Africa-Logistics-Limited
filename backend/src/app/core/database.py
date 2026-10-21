"""
Database engine & session configuration for Neon Postgres.

Bertcom prefers Neon's direct endpoint when ``DATABASE_URL_UNPOOLED`` is
configured and maintains a small application-side SQLAlchemy pool. This avoids
double-pooling through the Neon pooler and removes the network pre-ping that
previously added an extra Kampala-to-US-East round trip to every checkout.

Connections are recycled every five minutes. PostgreSQL RLS context remains
transaction-local via ``set_config(..., true)``, so it is cleared automatically
on commit/rollback and remains safe for pooled application connections.
"""

from __future__ import annotations

from advanced_alchemy.config import AsyncSessionConfig, EngineConfig
from advanced_alchemy.extensions.litestar.plugins import (
    SQLAlchemyAsyncConfig,
    SQLAlchemyInitPlugin,
)
from sqlalchemy import event, text
from sqlalchemy.orm import Session

from app.core.settings import settings

# ---------------------------------------------------------------------------
# SQLAlchemy Configuration
# ---------------------------------------------------------------------------

db_config = SQLAlchemyAsyncConfig(
    connection_string=settings.database_url_async,
    session_config=AsyncSessionConfig(expire_on_commit=False),
    engine_config=EngineConfig(
        pool_pre_ping=False,
        pool_recycle=300,
        pool_size=settings.DB_POOL_SIZE,
        max_overflow=settings.DB_MAX_OVERFLOW,
        connect_args={"statement_cache_size": 0},
    ),
)

alchemy_plugin = SQLAlchemyInitPlugin(config=db_config)


# ---------------------------------------------------------------------------
# Tenant & Role Context Listener for PostgreSQL RLS
# ---------------------------------------------------------------------------


@event.listens_for(Session, "after_begin")
def set_tenant_context(session: Session, transaction: object, connection: object) -> None:
    """
    Sets transaction-local session context for PostgreSQL Row-Level Security (RLS).
    Uses PostgreSQL set_config(..., is_local=true), which is strictly transaction-local
    and therefore safe when application connections are reused.
    """
    user_id = str(session.info.get("user_id") or "")
    tenant_id = str(session.info.get("tenant_id") or "")
    is_super = session.info.get("is_superuser", False)
    role = str(session.info.get("role") or ("superadmin" if is_super else "guest"))

    # Execute parameterized set_config call on the active transaction connection
    connection.execute(  # type: ignore[attr-defined]
        text(
            "SELECT set_config('app.current_user_id', :user_id, true), "
            "set_config('app.current_tenant_id', :tenant_id, true), "
            "set_config('app.current_role', :role, true)"
        ),
        {"user_id": user_id, "tenant_id": tenant_id, "role": role},
    )
