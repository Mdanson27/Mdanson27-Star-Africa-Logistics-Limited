"""projects_2_0

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-03 11:30:00 UTC
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "projects",
        sa.Column(
            "team_emails",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "projects",
        sa.Column(
            "tags",
            postgresql.JSONB(),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "projects",
        sa.Column("current_milestone", sa.String(length=255), nullable=True),
    )
    op.create_index("ix_projects_project_manager_email", "projects", ["project_manager_email"])
    op.create_index("ix_projects_is_archived", "projects", ["is_archived"])

    op.alter_column(
        "project_tasks",
        "status",
        server_default="todo",
        existing_type=sa.String(length=32),
        existing_nullable=False,
    )
    op.execute("UPDATE project_tasks SET status = 'todo' WHERE status = 'pending'")

    op.add_column(
        "documents",
        sa.Column(
            "review_status",
            sa.String(length=32),
            server_default="not_reviewed",
            nullable=False,
        ),
    )
    op.add_column(
        "documents",
        sa.Column("related_record_type", sa.String(length=32), nullable=True),
    )
    op.add_column(
        "documents",
        sa.Column("related_record_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_documents_review_status", "documents", ["review_status"])

    op.create_table(
        "payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("amount_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("method", sa.String(length=32), server_default="bank", nullable=False),
        sa.Column("reference", sa.String(length=128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("recorded_by_email", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_payments_project_id", "payments", ["project_id"])
    op.create_index("ix_payments_invoice_id", "payments", ["invoice_id"])
    op.create_index("ix_payments_payment_date", "payments", ["payment_date"])

    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_audit_payments ON payments;
        CREATE TRIGGER trg_audit_payments
        AFTER INSERT OR UPDATE OR DELETE ON payments
        FOR EACH ROW EXECUTE FUNCTION process_audit_log();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_payments ON payments;")
    op.drop_table("payments")

    op.drop_index("ix_documents_review_status", table_name="documents")
    op.drop_column("documents", "related_record_id")
    op.drop_column("documents", "related_record_type")
    op.drop_column("documents", "review_status")

    op.execute("UPDATE project_tasks SET status = 'pending' WHERE status = 'todo'")
    op.alter_column(
        "project_tasks",
        "status",
        server_default="pending",
        existing_type=sa.String(length=32),
        existing_nullable=False,
    )

    op.drop_index("ix_projects_is_archived", table_name="projects")
    op.drop_index("ix_projects_project_manager_email", table_name="projects")
    op.drop_column("projects", "current_milestone")
    op.drop_column("projects", "tags")
    op.drop_column("projects", "team_emails")
