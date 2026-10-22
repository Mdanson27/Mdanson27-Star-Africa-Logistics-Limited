"""Employees and payroll.

Revision ID: 0017
Revises: 0016
Create Date: 2026-10-23 00:10:00 UTC
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def _audit(table: str) -> None:
    op.execute(
        f"DROP TRIGGER IF EXISTS trg_audit_{table} ON {table}; "
        f"CREATE TRIGGER trg_audit_{table} AFTER INSERT OR UPDATE OR DELETE ON {table} "
        f"FOR EACH ROW EXECUTE FUNCTION process_audit_log();"
    )


def upgrade() -> None:
    op.create_table(
        "employees",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("employee_no", sa.String(64), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("job_title", sa.String(128), server_default="Staff", nullable=False),
        sa.Column("department", sa.String(128), server_default="Operations", nullable=False),
        sa.Column("employment_type", sa.String(32), server_default="full_time", nullable=False),
        sa.Column("hire_date", sa.Date(), nullable=True),
        sa.Column("base_salary_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("payment_method", sa.String(32), server_default="bank", nullable=False),
        sa.Column("bank_name", sa.String(128), nullable=True),
        sa.Column("bank_account_name", sa.String(255), nullable=True),
        sa.Column("bank_account_number", sa.String(128), nullable=True),
        sa.Column("mobile_money_number", sa.String(64), nullable=True),
        sa.Column("tin", sa.String(64), nullable=True),
        sa.Column("nssf_number", sa.String(64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("employee_no"),
        sa.UniqueConstraint("email"),
    )
    for col in ("employee_no", "full_name", "email", "department", "is_active"):
        op.create_index(f"ix_employees_{col}", "employees", [col])

    op.create_table(
        "payroll_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("pay_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(24), server_default="draft", nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_email", sa.String(255), nullable=False),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("period_start", "period_end", name="uq_payroll_run_period"),
        sa.CheckConstraint("period_start <= period_end", name="ck_payroll_run_period"),
    )
    for col in ("period_start", "period_end", "pay_date", "status", "created_by_email"):
        op.create_index(f"ix_payroll_runs_{col}", "payroll_runs", [col])

    op.create_table(
        "payroll_payments",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("payroll_run_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("employee_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("basic_pay_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("allowances_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("deductions_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("gross_pay_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("net_pay_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("payment_status", sa.String(24), server_default="pending", nullable=False),
        sa.Column("payment_method", sa.String(32), server_default="bank", nullable=False),
        sa.Column("payment_reference", sa.String(128), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["payroll_run_id"], ["payroll_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payroll_run_id", "employee_id", name="uq_payroll_run_employee"),
        sa.CheckConstraint("basic_pay_ugx >= 0", name="ck_payroll_basic_nonnegative"),
        sa.CheckConstraint("allowances_ugx >= 0", name="ck_payroll_allowances_nonnegative"),
        sa.CheckConstraint("deductions_ugx >= 0", name="ck_payroll_deductions_nonnegative"),
        sa.CheckConstraint("net_pay_ugx >= 0", name="ck_payroll_net_nonnegative"),
    )
    for col in ("payroll_run_id", "employee_id", "payment_status", "payment_reference"):
        op.create_index(f"ix_payroll_payments_{col}", "payroll_payments", [col])

    for table in ("employees", "payroll_runs", "payroll_payments"):
        _audit(table)


def downgrade() -> None:
    for table in ("payroll_payments", "payroll_runs", "employees"):
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{table} ON {table};")
    op.drop_table("payroll_payments")
    op.drop_table("payroll_runs")
    op.drop_table("employees")
