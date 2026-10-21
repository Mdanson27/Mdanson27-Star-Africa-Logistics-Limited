"""business_2_0_foundation

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-05 10:20:00 UTC
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_projects_client_id_clients",
        "projects",
        "clients",
        ["client_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_projects_client_id", "projects", ["client_id"])

    op.add_column("documents", sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column(
        "documents", sa.Column("supplier_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_documents_client_id_clients",
        "documents",
        "clients",
        ["client_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_documents_supplier_id_suppliers",
        "documents",
        "suppliers",
        ["supplier_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_documents_client_id", "documents", ["client_id"])
    op.create_index("ix_documents_supplier_id", "documents", ["supplier_id"])

    op.add_column("payments", sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_payments_client_id_clients",
        "payments",
        "clients",
        ["client_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_payments_client_id", "payments", ["client_id"])

    op.add_column(
        "expenses",
        sa.Column("supporting_document_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_expenses_supporting_document_id_documents",
        "expenses",
        "documents",
        ["supporting_document_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_expenses_supporting_document_id", "expenses", ["supporting_document_id"])

    # Connect existing projects to an existing client when their names match exactly after trimming.
    op.execute(
        """
        UPDATE projects p
        SET client_id = c.id
        FROM clients c
        WHERE p.client_id IS NULL
          AND lower(trim(p.client_name)) = lower(trim(c.name));
        """
    )

    # Existing payments inherit the invoice client first, then the linked project's client.
    op.execute(
        """
        UPDATE payments p
        SET client_id = i.client_id
        FROM invoices i
        WHERE p.client_id IS NULL
          AND p.invoice_id = i.id
          AND i.client_id IS NOT NULL;
        """
    )
    op.execute(
        """
        UPDATE payments p
        SET client_id = pr.client_id
        FROM projects pr
        WHERE p.client_id IS NULL
          AND p.project_id = pr.id
          AND pr.client_id IS NOT NULL;
        """
    )

    # Preserve existing generic document links while adding enforced party relationships.
    op.execute(
        """
        UPDATE documents
        SET client_id = related_record_id
        WHERE client_id IS NULL
          AND related_record_type IN ('client', 'clients')
          AND related_record_id IN (SELECT id FROM clients);
        """
    )
    op.execute(
        """
        UPDATE documents
        SET supplier_id = related_record_id
        WHERE supplier_id IS NULL
          AND related_record_type IN ('supplier', 'suppliers')
          AND related_record_id IN (SELECT id FROM suppliers);
        """
    )
    op.execute(
        """
        UPDATE documents d
        SET client_id = p.client_id
        FROM projects p
        WHERE d.client_id IS NULL
          AND d.project_id = p.id
          AND p.client_id IS NOT NULL;
        """
    )

    # Business 2.0 terminology replaces the legacy shortened invoice state.
    op.execute("UPDATE invoices SET status = 'partially_paid' WHERE status = 'partial'")


def downgrade() -> None:
    op.execute("UPDATE invoices SET status = 'partial' WHERE status = 'partially_paid'")

    op.drop_index("ix_expenses_supporting_document_id", table_name="expenses")
    op.drop_constraint(
        "fk_expenses_supporting_document_id_documents", "expenses", type_="foreignkey"
    )
    op.drop_column("expenses", "supporting_document_id")

    op.drop_index("ix_payments_client_id", table_name="payments")
    op.drop_constraint("fk_payments_client_id_clients", "payments", type_="foreignkey")
    op.drop_column("payments", "client_id")

    op.drop_index("ix_documents_supplier_id", table_name="documents")
    op.drop_index("ix_documents_client_id", table_name="documents")
    op.drop_constraint("fk_documents_supplier_id_suppliers", "documents", type_="foreignkey")
    op.drop_constraint("fk_documents_client_id_clients", "documents", type_="foreignkey")
    op.drop_column("documents", "supplier_id")
    op.drop_column("documents", "client_id")

    op.drop_index("ix_projects_client_id", table_name="projects")
    op.drop_constraint("fk_projects_client_id_clients", "projects", type_="foreignkey")
    op.drop_column("projects", "client_id")
