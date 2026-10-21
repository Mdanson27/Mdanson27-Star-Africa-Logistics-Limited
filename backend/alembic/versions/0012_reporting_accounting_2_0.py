"""Reporting & Analytics 2.0 accounting ledger.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-11 12:30:00 UTC
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("code", sa.String(length=24), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("account_type", sa.String(length=24), nullable=False),
        sa.Column("normal_balance", sa.String(length=8), nullable=False),
        sa.Column("system_key", sa.String(length=64), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
        sa.UniqueConstraint("system_key"),
    )
    for name, cols in [
        ("ix_accounts_code", ["code"]),
        ("ix_accounts_name", ["name"]),
        ("ix_accounts_account_type", ["account_type"]),
        ("ix_accounts_system_key", ["system_key"]),
    ]:
        op.create_index(name, "accounts", cols)

    op.create_table(
        "journal_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("reference", sa.String(length=128), nullable=True),
        sa.Column("description", sa.String(length=512), nullable=False),
        sa.Column("source_type", sa.String(length=64), nullable=True),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("posted_by_email", sa.String(length=255), nullable=False),
        sa.Column("is_posted", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_type", "source_id", name="uq_journal_entries_source"),
    )
    for name, cols in [
        ("ix_journal_entries_entry_date", ["entry_date"]),
        ("ix_journal_entries_reference", ["reference"]),
        ("ix_journal_entries_source_type", ["source_type"]),
        ("ix_journal_entries_source_id", ["source_id"]),
        ("ix_journal_entries_posted_by_email", ["posted_by_email"]),
        ("ix_journal_entries_is_posted", ["is_posted"]),
    ]:
        op.create_index(name, "journal_entries", cols)

    op.create_table(
        "journal_lines",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("journal_entry_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("account_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("client_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("debit_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("credit_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["journal_entry_id"], ["journal_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, cols in [
        ("ix_journal_lines_journal_entry_id", ["journal_entry_id"]),
        ("ix_journal_lines_account_id", ["account_id"]),
        ("ix_journal_lines_project_id", ["project_id"]),
        ("ix_journal_lines_client_id", ["client_id"]),
        ("ix_journal_lines_supplier_id", ["supplier_id"]),
    ]:
        op.create_index(name, "journal_lines", cols)

    op.execute(
        """
        INSERT INTO accounts (id, code, name, account_type, normal_balance, system_key, is_active)
        VALUES
          ('10000000-0000-0000-0000-000000000001', '1000', 'Cash & Bank', 'asset', 'debit', 'cash_bank', TRUE),
          ('10000000-0000-0000-0000-000000000002', '1100', 'Accounts Receivable', 'asset', 'debit', 'accounts_receivable', TRUE),
          ('10000000-0000-0000-0000-000000000003', '1200', 'Other Current Assets', 'asset', 'debit', 'other_current_assets', TRUE),
          ('10000000-0000-0000-0000-000000000004', '2000', 'Accounts Payable', 'liability', 'credit', 'accounts_payable', TRUE),
          ('10000000-0000-0000-0000-000000000005', '2100', 'Other Liabilities', 'liability', 'credit', 'other_liabilities', TRUE),
          ('10000000-0000-0000-0000-000000000006', '3000', 'Owner / Shareholder Equity', 'equity', 'credit', 'owner_equity', TRUE),
          ('10000000-0000-0000-0000-000000000007', '4000', 'Sales & Service Revenue', 'revenue', 'credit', 'service_revenue', TRUE),
          ('10000000-0000-0000-0000-000000000008', '4900', 'Other Income', 'revenue', 'credit', 'other_income', TRUE),
          ('10000000-0000-0000-0000-000000000009', '5000', 'Operating Expenses', 'expense', 'debit', 'operating_expense', TRUE),
          ('10000000-0000-0000-0000-000000000010', '5100', 'Direct Project Costs', 'expense', 'debit', 'direct_project_cost', TRUE),
          ('10000000-0000-0000-0000-000000000011', '5200', 'Administrative Expenses', 'expense', 'debit', 'administrative_expense', TRUE),
          ('10000000-0000-0000-0000-000000000012', '5900', 'Other Expenses', 'expense', 'debit', 'other_expense', TRUE);
        """
    )

    op.execute(
        """
        INSERT INTO journal_entries
          (id, entry_date, reference, description, source_type, source_id, posted_by_email, is_posted)
        SELECT gen_random_uuid(), i.issue_date, i.invoice_number,
               'Invoice ' || i.invoice_number || ' — ' || i.client_name,
               'invoice', i.id, i.created_by_email, TRUE
        FROM invoices i
        WHERE i.status <> 'draft' AND i.amount_ugx > 0;

        INSERT INTO journal_lines
          (id, journal_entry_id, account_id, project_id, client_id, description, debit_ugx, credit_ugx)
        SELECT gen_random_uuid(), j.id, '10000000-0000-0000-0000-000000000002', i.project_id, i.client_id,
               i.client_name, i.amount_ugx, 0
        FROM journal_entries j JOIN invoices i ON j.source_type = 'invoice' AND j.source_id = i.id;

        INSERT INTO journal_lines
          (id, journal_entry_id, account_id, project_id, client_id, description, debit_ugx, credit_ugx)
        SELECT gen_random_uuid(), j.id, '10000000-0000-0000-0000-000000000007', i.project_id, i.client_id,
               i.client_name, 0, i.amount_ugx
        FROM journal_entries j JOIN invoices i ON j.source_type = 'invoice' AND j.source_id = i.id;
        """
    )

    op.execute(
        """
        INSERT INTO journal_entries
          (id, entry_date, reference, description, source_type, source_id, posted_by_email, is_posted)
        SELECT gen_random_uuid(), p.payment_date, COALESCE(p.receipt_number, p.reference),
               'Receipt ' || COALESCE(p.receipt_number, p.reference, LEFT(p.id::text, 8)),
               'payment', p.id, p.recorded_by_email, TRUE
        FROM payments p WHERE p.amount_ugx > 0;

        INSERT INTO journal_lines
          (id, journal_entry_id, account_id, project_id, client_id, description, debit_ugx, credit_ugx)
        SELECT gen_random_uuid(), j.id, '10000000-0000-0000-0000-000000000001', p.project_id, p.client_id,
               p.notes, p.amount_ugx, 0
        FROM journal_entries j JOIN payments p ON j.source_type = 'payment' AND j.source_id = p.id;

        INSERT INTO journal_lines
          (id, journal_entry_id, account_id, project_id, client_id, description, debit_ugx, credit_ugx)
        SELECT gen_random_uuid(), j.id,
               CASE WHEN p.invoice_id IS NULL
                    THEN '10000000-0000-0000-0000-000000000007'::uuid
                    ELSE '10000000-0000-0000-0000-000000000002'::uuid END,
               p.project_id, p.client_id, p.notes, 0, p.amount_ugx
        FROM journal_entries j JOIN payments p ON j.source_type = 'payment' AND j.source_id = p.id;
        """
    )

    op.execute(
        """
        WITH paid AS (
          SELECT i.id, i.issue_date, i.invoice_number, i.client_name, i.project_id, i.client_id,
                 i.created_by_email, i.paid_amount_ugx,
                 COALESCE(SUM(p.amount_ugx), 0) AS payment_total
          FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
          WHERE i.status <> 'draft' AND i.paid_amount_ugx > 0
          GROUP BY i.id
        )
        INSERT INTO journal_entries
          (id, entry_date, reference, description, source_type, source_id, posted_by_email, is_posted)
        SELECT gen_random_uuid(), issue_date, invoice_number || '-OPENING-PAID',
               'Opening paid amount recorded on ' || invoice_number,
               'invoice_opening_payment', id, created_by_email, TRUE
        FROM paid WHERE paid_amount_ugx > payment_total;

        WITH paid AS (
          SELECT i.id, i.project_id, i.client_id, i.client_name, i.paid_amount_ugx,
                 COALESCE(SUM(p.amount_ugx), 0) AS payment_total
          FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
          GROUP BY i.id
        )
        INSERT INTO journal_lines
          (id, journal_entry_id, account_id, project_id, client_id, description, debit_ugx, credit_ugx)
        SELECT gen_random_uuid(), j.id, '10000000-0000-0000-0000-000000000001', p.project_id, p.client_id,
               p.client_name, p.paid_amount_ugx - p.payment_total, 0
        FROM journal_entries j JOIN paid p ON j.source_type = 'invoice_opening_payment' AND j.source_id = p.id;

        WITH paid AS (
          SELECT i.id, i.project_id, i.client_id, i.client_name, i.paid_amount_ugx,
                 COALESCE(SUM(p.amount_ugx), 0) AS payment_total
          FROM invoices i LEFT JOIN payments p ON p.invoice_id = i.id
          GROUP BY i.id
        )
        INSERT INTO journal_lines
          (id, journal_entry_id, account_id, project_id, client_id, description, debit_ugx, credit_ugx)
        SELECT gen_random_uuid(), j.id, '10000000-0000-0000-0000-000000000002', p.project_id, p.client_id,
               p.client_name, 0, p.paid_amount_ugx - p.payment_total
        FROM journal_entries j JOIN paid p ON j.source_type = 'invoice_opening_payment' AND j.source_id = p.id;
        """
    )

    op.execute(
        """
        INSERT INTO journal_entries
          (id, entry_date, reference, description, source_type, source_id, posted_by_email, is_posted)
        SELECT gen_random_uuid(), e.expense_date, e.reference, e.description,
               'expense', e.id, e.created_by_email, TRUE
        FROM expenses e WHERE e.amount_ugx > 0;

        INSERT INTO journal_lines
          (id, journal_entry_id, account_id, project_id, supplier_id, description, debit_ugx, credit_ugx)
        SELECT gen_random_uuid(), j.id, '10000000-0000-0000-0000-000000000009', e.project_id, e.supplier_id,
               e.category, e.amount_ugx, 0
        FROM journal_entries j JOIN expenses e ON j.source_type = 'expense' AND j.source_id = e.id;

        INSERT INTO journal_lines
          (id, journal_entry_id, account_id, project_id, supplier_id, description, debit_ugx, credit_ugx)
        SELECT gen_random_uuid(), j.id, '10000000-0000-0000-0000-000000000001', e.project_id, e.supplier_id,
               e.description, 0, e.amount_ugx
        FROM journal_entries j JOIN expenses e ON j.source_type = 'expense' AND j.source_id = e.id;
        """
    )

    for table_name in ("accounts", "journal_entries", "journal_lines"):
        op.execute(
            f"""
            DROP TRIGGER IF EXISTS trg_audit_{table_name} ON {table_name};
            CREATE TRIGGER trg_audit_{table_name}
            AFTER INSERT OR UPDATE OR DELETE ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION process_audit_log();
            """
        )


def downgrade() -> None:
    for table_name in ("journal_lines", "journal_entries", "accounts"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{table_name} ON {table_name};")
    op.drop_table("journal_lines")
    op.drop_table("journal_entries")
    op.drop_table("accounts")
