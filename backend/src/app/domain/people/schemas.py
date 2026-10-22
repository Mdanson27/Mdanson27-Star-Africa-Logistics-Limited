from __future__ import annotations

import uuid
from datetime import date, datetime

import msgspec


class EmployeeCreate(msgspec.Struct, frozen=True):
    employee_no: str
    full_name: str
    email: str
    phone: str | None = None
    job_title: str = "Staff"
    department: str = "Operations"
    employment_type: str = "full_time"
    hire_date: date | None = None
    base_salary_ugx: float = 0
    payment_method: str = "bank"
    bank_name: str | None = None
    bank_account_name: str | None = None
    bank_account_number: str | None = None
    mobile_money_number: str | None = None
    tin: str | None = None
    nssf_number: str | None = None
    notes: str | None = None
    is_active: bool = True


class EmployeeUpdate(msgspec.Struct, frozen=True):
    employee_no: str | None = None
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    job_title: str | None = None
    department: str | None = None
    employment_type: str | None = None
    hire_date: date | None = None
    base_salary_ugx: float | None = None
    payment_method: str | None = None
    bank_name: str | None = None
    bank_account_name: str | None = None
    bank_account_number: str | None = None
    mobile_money_number: str | None = None
    tin: str | None = None
    nssf_number: str | None = None
    notes: str | None = None
    is_active: bool | None = None


class EmployeeRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    employee_no: str
    full_name: str
    email: str
    phone: str | None
    job_title: str
    department: str
    employment_type: str
    hire_date: date | None
    base_salary_ugx: float
    payment_method: str
    bank_name: str | None
    bank_account_name: str | None
    bank_account_number: str | None
    mobile_money_number: str | None
    tin: str | None
    nssf_number: str | None
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class PayrollRunCreate(msgspec.Struct, frozen=True):
    period_start: date
    period_end: date
    pay_date: date
    notes: str | None = None


class PayrollRunUpdate(msgspec.Struct, frozen=True):
    status: str | None = None
    pay_date: date | None = None
    notes: str | None = None


class PayrollRunRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    period_start: date
    period_end: date
    pay_date: date
    status: str
    notes: str | None
    created_by_email: str
    finalized_at: datetime | None
    employee_count: int
    gross_total_ugx: float
    deductions_total_ugx: float
    net_total_ugx: float
    paid_total_ugx: float
    created_at: datetime


class PayrollPaymentUpdate(msgspec.Struct, frozen=True):
    allowances_ugx: float | None = None
    deductions_ugx: float | None = None
    payment_status: str | None = None
    payment_method: str | None = None
    payment_reference: str | None = None
    notes: str | None = None


class PayrollPaymentRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    payroll_run_id: uuid.UUID
    employee_id: uuid.UUID
    employee_no: str
    employee_name: str
    employee_email: str
    basic_pay_ugx: float
    allowances_ugx: float
    deductions_ugx: float
    gross_pay_ugx: float
    net_pay_ugx: float
    payment_status: str
    payment_method: str
    payment_reference: str | None
    paid_at: datetime | None
    notes: str | None
    period_start: date
    period_end: date
    pay_date: date


class PeopleDashboard(msgspec.Struct, frozen=True):
    active_employees: int
    monthly_payroll_ugx: float
    pending_payments: int
    paid_this_month_ugx: float
