from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.domain.base import AuditBase


class Employee(AuditBase):
    __tablename__ = "employees"

    employee_no: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    job_title: Mapped[str] = mapped_column(String(128), nullable=False, default="Staff")
    department: Mapped[str] = mapped_column(String(128), nullable=False, default="Operations")
    employment_type: Mapped[str] = mapped_column(String(32), nullable=False, default="full_time")
    hire_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    base_salary_ugx: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False, default="bank")
    bank_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    bank_account_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    bank_account_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    mobile_money_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    tin: Mapped[str | None] = mapped_column(String(64), nullable=True)
    nssf_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=text("true")
    )


class PayrollRun(AuditBase):
    __tablename__ = "payroll_runs"

    period_start: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    period_end: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    pay_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft", index=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("period_start", "period_end", name="uq_payroll_run_period"),)


class PayrollPayment(AuditBase):
    __tablename__ = "payroll_payments"

    payroll_run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("payroll_runs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    employee_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("employees.id", ondelete="RESTRICT"), index=True, nullable=False
    )
    basic_pay_ugx: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    allowances_ugx: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    deductions_ugx: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    gross_pay_ugx: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    net_pay_ugx: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=0)
    payment_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="pending", index=True
    )
    payment_method: Mapped[str] = mapped_column(String(32), nullable=False, default="bank")
    payment_reference: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        UniqueConstraint("payroll_run_id", "employee_id", name="uq_payroll_run_employee"),
    )
