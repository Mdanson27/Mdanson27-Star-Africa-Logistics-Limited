"""Business 2.0 Step 2 commercial workflows and document generation.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-06 06:00:00 UTC
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def _audit_columns() -> list[sa.Column]:
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    ]


def upgrade() -> None:
    op.add_column(
        "invoices", sa.Column("source_quotation_id", postgresql.UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key(
        "fk_invoices_source_quotation_id_quotations",
        "invoices",
        "quotations",
        ["source_quotation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_invoices_source_quotation_id", "invoices", ["source_quotation_id"], unique=True
    )

    op.add_column("payments", sa.Column("receipt_number", sa.String(length=64), nullable=True))
    op.create_index("ix_payments_receipt_number", "payments", ["receipt_number"], unique=True)

    op.create_table(
        "business_number_counters",
        *_audit_columns(),
        sa.Column("document_type", sa.String(length=32), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("last_value", sa.Integer(), server_default="0", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("document_type", "year", name="uq_business_number_type_year"),
    )
    op.create_index(
        "ix_business_number_counters_document_type", "business_number_counters", ["document_type"]
    )
    op.create_index("ix_business_number_counters_year", "business_number_counters", ["year"])

    op.create_table(
        "quotation_line_items",
        *_audit_columns(),
        sa.Column("quotation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), server_default="1", nullable=False),
        sa.Column("description", sa.String(length=512), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), server_default="1", nullable=False),
        sa.Column("unit_price_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_quotation_line_items_quotation_id", "quotation_line_items", ["quotation_id"]
    )

    op.create_table(
        "invoice_line_items",
        *_audit_columns(),
        sa.Column("invoice_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), server_default="1", nullable=False),
        sa.Column("description", sa.String(length=512), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), server_default="1", nullable=False),
        sa.Column("unit_price_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_invoice_line_items_invoice_id", "invoice_line_items", ["invoice_id"])

    op.create_table(
        "purchase_order_line_items",
        *_audit_columns(),
        sa.Column("purchase_order_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("position", sa.Integer(), server_default="1", nullable=False),
        sa.Column("description", sa.String(length=512), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 3), server_default="1", nullable=False),
        sa.Column("unit_price_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["purchase_order_id"], ["purchase_orders.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_purchase_order_line_items_purchase_order_id",
        "purchase_order_line_items",
        ["purchase_order_id"],
    )

    # Existing records become valid itemized documents without changing their totals.
    op.execute("""
        INSERT INTO quotation_line_items (id, quotation_id, position, description, quantity, unit_price_ugx)
        SELECT uuid_generate_v4(), id, 1, 'Commercial goods / services', 1, amount_ugx
        FROM quotations WHERE amount_ugx > 0;
    """)
    op.execute("""
        INSERT INTO invoice_line_items (id, invoice_id, position, description, quantity, unit_price_ugx)
        SELECT uuid_generate_v4(), id, 1, 'Commercial goods / services', 1, amount_ugx
        FROM invoices WHERE amount_ugx > 0;
    """)
    op.execute("""
        INSERT INTO purchase_order_line_items (id, purchase_order_id, position, description, quantity, unit_price_ugx)
        SELECT uuid_generate_v4(), id, 1, 'Goods / services ordered', 1, amount_ugx
        FROM purchase_orders WHERE amount_ugx > 0;
    """)

    # Every existing payment receives a stable sequential receipt number within its year.
    op.execute("""
        WITH ranked AS (
            SELECT id,
                   EXTRACT(YEAR FROM COALESCE(payment_date, created_at::date))::int AS yr,
                   ROW_NUMBER() OVER (
                       PARTITION BY EXTRACT(YEAR FROM COALESCE(payment_date, created_at::date))
                       ORDER BY payment_date, created_at, id
                   ) AS seq
            FROM payments
        )
        UPDATE payments p
        SET receipt_number = 'RCT-' || ranked.yr || '-' || LPAD(ranked.seq::text, 4, '0')
        FROM ranked
        WHERE p.id = ranked.id AND p.receipt_number IS NULL;
    """)

    # Seed numbering counters from any existing correctly formatted records.
    op.execute("""
        INSERT INTO business_number_counters (id, document_type, year, last_value)
        SELECT uuid_generate_v4(), 'quotation', yr, MAX(seq) FROM (
            SELECT substring(quotation_number from '^QTN-([0-9]{4})-[0-9]+$')::int AS yr,
                   substring(quotation_number from '^QTN-[0-9]{4}-([0-9]+)$')::int AS seq
            FROM quotations WHERE quotation_number ~ '^QTN-[0-9]{4}-[0-9]+$'
        ) x GROUP BY yr;
        INSERT INTO business_number_counters (id, document_type, year, last_value)
        SELECT uuid_generate_v4(), 'invoice', yr, MAX(seq) FROM (
            SELECT substring(invoice_number from '^INV-([0-9]{4})-[0-9]+$')::int AS yr,
                   substring(invoice_number from '^INV-[0-9]{4}-([0-9]+)$')::int AS seq
            FROM invoices WHERE invoice_number ~ '^INV-[0-9]{4}-[0-9]+$'
        ) x GROUP BY yr;
        INSERT INTO business_number_counters (id, document_type, year, last_value)
        SELECT uuid_generate_v4(), 'purchase_order', yr, MAX(seq) FROM (
            SELECT substring(po_number from '^PO-([0-9]{4})-[0-9]+$')::int AS yr,
                   substring(po_number from '^PO-[0-9]{4}-([0-9]+)$')::int AS seq
            FROM purchase_orders WHERE po_number ~ '^PO-[0-9]{4}-[0-9]+$'
        ) x GROUP BY yr;
        INSERT INTO business_number_counters (id, document_type, year, last_value)
        SELECT uuid_generate_v4(), 'receipt', yr, MAX(seq) FROM (
            SELECT substring(receipt_number from '^RCT-([0-9]{4})-[0-9]+$')::int AS yr,
                   substring(receipt_number from '^RCT-[0-9]{4}-([0-9]+)$')::int AS seq
            FROM payments WHERE receipt_number ~ '^RCT-[0-9]{4}-[0-9]+$'
        ) x GROUP BY yr;
    """)


def downgrade() -> None:
    op.drop_index(
        "ix_purchase_order_line_items_purchase_order_id", table_name="purchase_order_line_items"
    )
    op.drop_table("purchase_order_line_items")
    op.drop_index("ix_invoice_line_items_invoice_id", table_name="invoice_line_items")
    op.drop_table("invoice_line_items")
    op.drop_index("ix_quotation_line_items_quotation_id", table_name="quotation_line_items")
    op.drop_table("quotation_line_items")
    op.drop_index("ix_business_number_counters_year", table_name="business_number_counters")
    op.drop_index(
        "ix_business_number_counters_document_type", table_name="business_number_counters"
    )
    op.drop_table("business_number_counters")
    op.drop_index("ix_payments_receipt_number", table_name="payments")
    op.drop_column("payments", "receipt_number")
    op.drop_index("ix_invoices_source_quotation_id", table_name="invoices")
    op.drop_constraint("fk_invoices_source_quotation_id_quotations", "invoices", type_="foreignkey")
    op.drop_column("invoices", "source_quotation_id")
