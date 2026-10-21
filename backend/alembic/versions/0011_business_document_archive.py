"""Business Documents archive, immutable versions, and action history.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-08 08:00:00 UTC
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("documents", sa.Column("document_type", sa.String(length=32), nullable=True))
    op.add_column("documents", sa.Column("document_number", sa.String(length=96), nullable=True))
    op.add_column("documents", sa.Column("version", sa.Integer(), server_default="1", nullable=False))
    op.add_column("documents", sa.Column("is_current", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("documents", sa.Column("is_deleted", sa.Boolean(), server_default=sa.false(), nullable=False))
    op.add_column("documents", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("documents", sa.Column("deleted_by_email", sa.String(length=255), nullable=True))
    op.add_column("documents", sa.Column("supersedes_document_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("documents", sa.Column("content_hash", sa.String(length=64), nullable=True))
    op.create_foreign_key(
        "fk_documents_supersedes_document_id_documents",
        "documents", "documents", ["supersedes_document_id"], ["id"], ondelete="SET NULL"
    )
    for name, cols in [
        ("ix_documents_document_type", ["document_type"]),
        ("ix_documents_document_number", ["document_number"]),
        ("ix_documents_is_current", ["is_current"]),
        ("ix_documents_is_deleted", ["is_deleted"]),
        ("ix_documents_supersedes_document_id", ["supersedes_document_id"]),
        ("ix_documents_content_hash", ["content_hash"]),
        ("ix_documents_related_record_type", ["related_record_type"]),
        ("ix_documents_related_record_id", ["related_record_id"]),
    ]:
        op.create_index(name, "documents", cols)

    op.execute(
        """
        UPDATE documents
        SET document_type = related_record_type,
            document_number = regexp_replace(original_filename, '\\.pdf$', '', 'i'),
            version = COALESCE(version, 1),
            is_current = TRUE,
            is_deleted = FALSE
        WHERE category = 'generated_commercial';
        """
    )

    op.create_table(
        "business_document_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("document_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("actor_email", sa.String(length=255), nullable=False),
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.ForeignKeyConstraint(["document_id"], ["documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_business_document_events_document_id", "business_document_events", ["document_id"])
    op.create_index("ix_business_document_events_action", "business_document_events", ["action"])
    op.create_index("ix_business_document_events_actor_email", "business_document_events", ["actor_email"])
    op.create_index("ix_business_document_events_created_at", "business_document_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("business_document_events")
    for name in [
        "ix_documents_content_hash",
        "ix_documents_supersedes_document_id",
        "ix_documents_is_deleted",
        "ix_documents_is_current",
        "ix_documents_document_number",
        "ix_documents_document_type",
        "ix_documents_related_record_id",
        "ix_documents_related_record_type",
    ]:
        op.drop_index(name, table_name="documents")
    op.drop_constraint("fk_documents_supersedes_document_id_documents", "documents", type_="foreignkey")
    for column in [
        "content_hash", "supersedes_document_id", "deleted_by_email", "deleted_at",
        "is_deleted", "is_current", "version", "document_number", "document_type",
    ]:
        op.drop_column("documents", column)
