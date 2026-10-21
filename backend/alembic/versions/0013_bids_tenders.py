"""Bids and tenders lifecycle.

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-20 11:00:00 UTC
"""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "bids",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("tender_number", sa.String(128), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("procuring_entity", sa.String(255), nullable=False),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source", sa.String(255), nullable=True), sa.Column("category", sa.String(128), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(32), server_default="opportunity", nullable=False),
        sa.Column("publication_date", sa.Date(), nullable=True), sa.Column("closing_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("submission_method", sa.String(128), nullable=True), sa.Column("submission_location", sa.String(255), nullable=True),
        sa.Column("contact_person", sa.String(255), nullable=True), sa.Column("contact_email", sa.String(255), nullable=True), sa.Column("contact_phone", sa.String(64), nullable=True),
        sa.Column("bid_fee_ugx", sa.Numeric(18,2), server_default="0", nullable=False),
        sa.Column("bid_security_ugx", sa.Numeric(18,2), server_default="0", nullable=False),
        sa.Column("estimated_value_ugx", sa.Numeric(18,2), server_default="0", nullable=False),
        sa.Column("internal_estimated_cost_ugx", sa.Numeric(18,2), server_default="0", nullable=False),
        sa.Column("proposed_bid_price_ugx", sa.Numeric(18,2), server_default="0", nullable=False),
        sa.Column("expected_profit_ugx", sa.Numeric(18,2), server_default="0", nullable=False),
        sa.Column("currency", sa.String(8), server_default="UGX", nullable=False),
        sa.Column("bid_manager_email", sa.String(255), nullable=True),
        sa.Column("team_emails", postgresql.JSONB(), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("eligibility_notes", sa.Text(), nullable=True), sa.Column("result_notes", sa.Text(), nullable=True),
        sa.Column("award_date", sa.Date(), nullable=True), sa.Column("award_value_ugx", sa.Numeric(18,2), server_default="0", nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True), sa.Column("converted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_email", sa.String(255), nullable=False), sa.Column("is_archived", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"), sa.UniqueConstraint("tender_number"), sa.UniqueConstraint("project_id"),
    )
    for col in ("tender_number","title","procuring_entity","client_id","category","status","closing_date","bid_manager_email","project_id","created_by_email","is_archived"):
        op.create_index(f"ix_bids_{col}", "bids", [col])
    op.create_table(
        "bid_requirements",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("bid_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(255), nullable=False), sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_mandatory", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("status", sa.String(32), server_default="not_started", nullable=False),
        sa.Column("responsible_email", sa.String(255), nullable=True), sa.Column("due_date", sa.Date(), nullable=True), sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["bid_id"], ["bids.id"], ondelete="CASCADE"), sa.PrimaryKeyConstraint("id"),
    )
    for col in ("bid_id","status","responsible_email"):
        op.create_index(f"ix_bid_requirements_{col}", "bid_requirements", [col])
    for table in ("bids", "bid_requirements"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{table} ON {table}; CREATE TRIGGER trg_audit_{table} AFTER INSERT OR UPDATE OR DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION process_audit_log();")


def downgrade() -> None:
    for table in ("bid_requirements", "bids"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{table} ON {table};")
    op.drop_table("bid_requirements")
    op.drop_table("bids")
