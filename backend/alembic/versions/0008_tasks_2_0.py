"""tasks_2_0

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-05 09:15:00 UTC
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_tasks",
        sa.Column("start_date", sa.Date(), nullable=True),
    )
    op.add_column(
        "project_tasks",
        sa.Column("related_document_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_project_tasks_related_document_id_documents",
        "project_tasks",
        "documents",
        ["related_document_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_project_tasks_start_date", "project_tasks", ["start_date"])
    op.create_index(
        "ix_project_tasks_related_document_id",
        "project_tasks",
        ["related_document_id"],
    )
    op.create_index("ix_project_tasks_priority", "project_tasks", ["priority"])


def downgrade() -> None:
    op.drop_index("ix_project_tasks_priority", table_name="project_tasks")
    op.drop_index("ix_project_tasks_related_document_id", table_name="project_tasks")
    op.drop_index("ix_project_tasks_start_date", table_name="project_tasks")
    op.drop_constraint(
        "fk_project_tasks_related_document_id_documents",
        "project_tasks",
        type_="foreignkey",
    )
    op.drop_column("project_tasks", "related_document_id")
    op.drop_column("project_tasks", "start_date")
