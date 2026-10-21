"""
timescaledb_policies_and_outbox

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-20 00:00:00.000000 UTC

Changes
-------
1. Creates outbox_events and dead_letter_events tables.
2. Converts telemetry_readings to a TimescaleDB hypertable when available.
3. Applies a 90-day retention policy. Compression is intentionally omitted on
   Neon because only Apache-2 licensed TimescaleDB features are supported there.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "outbox_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="PENDING"),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_outbox_events_status", "outbox_events", ["status"])
    op.create_index("ix_outbox_events_event_type", "outbox_events", ["event_type"])
    op.create_index("ix_outbox_events_created_at", "outbox_events", ["created_at"])

    op.create_table(
        "dead_letter_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("original_event_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=128), nullable=False),
        sa.Column("payload_json", sa.Text(), nullable=False),
        sa.Column("error_trace", sa.Text(), nullable=False),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_dead_letter_events_original_event_id", "dead_letter_events", ["original_event_id"])

    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
                PERFORM create_hypertable(
                    'telemetry_readings',
                    'recorded_at',
                    if_not_exists => TRUE,
                    migrate_data => TRUE
                );

                PERFORM add_retention_policy(
                    'telemetry_readings',
                    INTERVAL '90 days',
                    if_not_exists => TRUE
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'TimescaleDB hypertable/policy setup skipped: %', SQLERRM;
        END $$;
        """
    )


def downgrade() -> None:
    op.drop_table("dead_letter_events")
    op.drop_table("outbox_events")
