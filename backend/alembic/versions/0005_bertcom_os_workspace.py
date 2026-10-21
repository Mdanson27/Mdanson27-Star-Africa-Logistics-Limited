"""bertcom_os_workspace_foundation

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-01 11:00:00 UTC
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("client_name", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="planning", nullable=False),
        sa.Column("value_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("amount_paid_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("progress", sa.Integer(), server_default="0", nullable=False),
        sa.Column("project_manager_email", sa.String(length=255), nullable=True),
        sa.Column("created_by_email", sa.String(length=255), nullable=False),
        sa.Column("is_archived", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_projects_name", "projects", ["name"])
    op.create_index("ix_projects_client_name", "projects", ["client_name"])
    op.create_index("ix_projects_status", "projects", ["status"])
    op.create_index("ix_projects_due_date", "projects", ["due_date"])

    op.create_table(
        "project_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("assignee_email", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=32), server_default="pending", nullable=False),
        sa.Column("priority", sa.String(length=16), server_default="normal", nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_tasks_project_id", "project_tasks", ["project_id"])
    op.create_index("ix_project_tasks_assignee_email", "project_tasks", ["assignee_email"])
    op.create_index("ix_project_tasks_status", "project_tasks", ["status"])
    op.create_index("ix_project_tasks_due_date", "project_tasks", ["due_date"])

    op.create_table(
        "documents",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("original_filename", sa.String(length=512), nullable=False),
        sa.Column("category", sa.String(length=64), server_default="other", nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), server_default="0", nullable=False),
        sa.Column("storage_key", sa.String(length=1024), nullable=False),
        sa.Column("uploaded_by_email", sa.String(length=255), nullable=False),
        sa.Column("ocr_status", sa.String(length=32), server_default="not_requested", nullable=False),
        sa.Column("ocr_text", sa.Text(), nullable=True),
        sa.Column("extracted_fields", postgresql.JSONB(), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_documents_project_id", "documents", ["project_id"])
    op.create_index("ix_documents_title", "documents", ["title"])
    op.create_index("ix_documents_category", "documents", ["category"])
    op.create_index("ix_documents_uploaded_by_email", "documents", ["uploaded_by_email"])
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_documents_ocr_text_trgm "
        "ON documents USING gin (ocr_text gin_trgm_ops)"
    )

    op.execute(
        """
        DROP TRIGGER IF EXISTS trg_audit_projects ON projects;
        CREATE TRIGGER trg_audit_projects
        AFTER INSERT OR UPDATE OR DELETE ON projects
        FOR EACH ROW EXECUTE FUNCTION process_audit_log();

        DROP TRIGGER IF EXISTS trg_audit_project_tasks ON project_tasks;
        CREATE TRIGGER trg_audit_project_tasks
        AFTER INSERT OR UPDATE OR DELETE ON project_tasks
        FOR EACH ROW EXECUTE FUNCTION process_audit_log();

        DROP TRIGGER IF EXISTS trg_audit_documents ON documents;
        CREATE TRIGGER trg_audit_documents
        AFTER INSERT OR UPDATE OR DELETE ON documents
        FOR EACH ROW EXECUTE FUNCTION process_audit_log();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_audit_documents ON documents;")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_project_tasks ON project_tasks;")
    op.execute("DROP TRIGGER IF EXISTS trg_audit_projects ON projects;")
    op.drop_table("documents")
    op.drop_table("project_tasks")
    op.drop_table("projects")
