from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, ClassVar

from litestar import Controller, Request, get, patch, post
from litestar.exceptions import ClientException, NotFoundException
from litestar.status_codes import HTTP_201_CREATED
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.people.models import Employee, PayrollPayment, PayrollRun
from app.domain.people.schemas import (
    EmployeeCreate,
    EmployeeRead,
    EmployeeUpdate,
    PayrollPaymentRead,
    PayrollPaymentUpdate,
    PayrollRunCreate,
    PayrollRunRead,
    PayrollRunUpdate,
    PeopleDashboard,
)
from app.presentation.guards.auth_guard import SuperuserGuard


def _money(value: Any) -> float:
    return float(value or 0)


def _email(request: Request) -> str:
    value = str(request.scope.get("email") or "").strip().lower()
    if not value:
        raise ClientException(detail="Authenticated email is required.", status_code=401)
    return value


def _employee_read(row: Employee) -> EmployeeRead:
    return EmployeeRead(
        id=row.id,
        employee_no=row.employee_no,
        full_name=row.full_name,
        email=row.email,
        phone=row.phone,
        job_title=row.job_title,
        department=row.department,
        employment_type=row.employment_type,
        hire_date=row.hire_date,
        base_salary_ugx=_money(row.base_salary_ugx),
        payment_method=row.payment_method,
        bank_name=row.bank_name,
        bank_account_name=row.bank_account_name,
        bank_account_number=row.bank_account_number,
        mobile_money_number=row.mobile_money_number,
        tin=row.tin,
        nssf_number=row.nssf_number,
        notes=row.notes,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _run_read(db: AsyncSession, run: PayrollRun) -> PayrollRunRead:
    payments = (
        (await db.execute(select(PayrollPayment).where(PayrollPayment.payroll_run_id == run.id)))
        .scalars()
        .all()
    )
    return PayrollRunRead(
        id=run.id,
        period_start=run.period_start,
        period_end=run.period_end,
        pay_date=run.pay_date,
        status=run.status,
        notes=run.notes,
        created_by_email=run.created_by_email,
        finalized_at=run.finalized_at,
        employee_count=len(payments),
        gross_total_ugx=sum(_money(item.gross_pay_ugx) for item in payments),
        deductions_total_ugx=sum(_money(item.deductions_ugx) for item in payments),
        net_total_ugx=sum(_money(item.net_pay_ugx) for item in payments),
        paid_total_ugx=sum(
            _money(item.net_pay_ugx) for item in payments if item.payment_status == "paid"
        ),
        created_at=run.created_at,
    )


async def _payment_read(db: AsyncSession, payment: PayrollPayment) -> PayrollPaymentRead:
    employee = await db.get(Employee, payment.employee_id)
    run = await db.get(PayrollRun, payment.payroll_run_id)
    if employee is None or run is None:
        raise NotFoundException(detail="Payroll record is incomplete.")
    return PayrollPaymentRead(
        id=payment.id,
        payroll_run_id=payment.payroll_run_id,
        employee_id=payment.employee_id,
        employee_no=employee.employee_no,
        employee_name=employee.full_name,
        employee_email=employee.email,
        basic_pay_ugx=_money(payment.basic_pay_ugx),
        allowances_ugx=_money(payment.allowances_ugx),
        deductions_ugx=_money(payment.deductions_ugx),
        gross_pay_ugx=_money(payment.gross_pay_ugx),
        net_pay_ugx=_money(payment.net_pay_ugx),
        payment_status=payment.payment_status,
        payment_method=payment.payment_method,
        payment_reference=payment.payment_reference,
        paid_at=payment.paid_at,
        notes=payment.notes,
        period_start=run.period_start,
        period_end=run.period_end,
        pay_date=run.pay_date,
    )


class PeopleController(Controller):
    path = "/people"
    guards: ClassVar[list[Any]] = [SuperuserGuard()]

    @get(path="/dashboard")
    async def dashboard(self, db_session: AsyncSession) -> PeopleDashboard:
        active = int(
            (
                await db_session.execute(
                    select(func.count()).select_from(Employee).where(Employee.is_active.is_(True))
                )
            ).scalar_one()
        )
        monthly = _money(
            (
                await db_session.execute(
                    select(func.coalesce(func.sum(Employee.base_salary_ugx), 0)).where(
                        Employee.is_active.is_(True)
                    )
                )
            ).scalar_one()
        )
        pending = int(
            (
                await db_session.execute(
                    select(func.count())
                    .select_from(PayrollPayment)
                    .where(PayrollPayment.payment_status == "pending")
                )
            ).scalar_one()
        )
        today = datetime.now(UTC).date()
        paid = _money(
            (
                await db_session.execute(
                    select(func.coalesce(func.sum(PayrollPayment.net_pay_ugx), 0)).where(
                        PayrollPayment.payment_status == "paid",
                        func.extract("year", PayrollPayment.paid_at) == today.year,
                        func.extract("month", PayrollPayment.paid_at) == today.month,
                    )
                )
            ).scalar_one()
        )
        return PeopleDashboard(
            active_employees=active,
            monthly_payroll_ugx=monthly,
            pending_payments=pending,
            paid_this_month_ugx=paid,
        )

    @get(path="/employees")
    async def employees(
        self, db_session: AsyncSession, include_inactive: bool = True
    ) -> list[EmployeeRead]:
        statement = select(Employee).order_by(Employee.full_name)
        if not include_inactive:
            statement = statement.where(Employee.is_active.is_(True))
        rows = (await db_session.execute(statement)).scalars().all()
        return [_employee_read(item) for item in rows]

    @post(path="/employees", status_code=HTTP_201_CREATED)
    async def create_employee(self, data: EmployeeCreate, db_session: AsyncSession) -> EmployeeRead:
        email = data.email.strip().lower()
        employee_no = data.employee_no.strip().upper()
        duplicate = (
            await db_session.execute(
                select(Employee).where(
                    (Employee.email == email) | (Employee.employee_no == employee_no)
                )
            )
        ).scalar_one_or_none()
        if duplicate:
            raise ClientException(
                detail="Employee number or email already exists.", status_code=409
            )
        if data.base_salary_ugx < 0:
            raise ClientException(detail="Base salary cannot be negative.", status_code=400)
        row = Employee(
            employee_no=employee_no,
            full_name=data.full_name.strip(),
            email=email,
            phone=data.phone,
            job_title=data.job_title.strip() or "Staff",
            department=data.department.strip() or "Operations",
            employment_type=data.employment_type,
            hire_date=data.hire_date,
            base_salary_ugx=Decimal(str(data.base_salary_ugx)),
            payment_method=data.payment_method,
            bank_name=data.bank_name,
            bank_account_name=data.bank_account_name,
            bank_account_number=data.bank_account_number,
            mobile_money_number=data.mobile_money_number,
            tin=data.tin,
            nssf_number=data.nssf_number,
            notes=data.notes,
            is_active=data.is_active,
        )
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)
        return _employee_read(row)

    @patch(path="/employees/{employee_id:uuid}")
    async def update_employee(
        self, employee_id: uuid.UUID, data: EmployeeUpdate, db_session: AsyncSession
    ) -> EmployeeRead:
        row = await db_session.get(Employee, employee_id)
        if row is None:
            raise NotFoundException(detail="Employee not found.")
        for field in (
            "phone",
            "job_title",
            "department",
            "employment_type",
            "hire_date",
            "payment_method",
            "bank_name",
            "bank_account_name",
            "bank_account_number",
            "mobile_money_number",
            "tin",
            "nssf_number",
            "notes",
            "is_active",
        ):
            value = getattr(data, field)
            if value is not None:
                setattr(row, field, value)
        if data.full_name is not None:
            row.full_name = data.full_name.strip()
        if data.email is not None:
            row.email = data.email.strip().lower()
        if data.employee_no is not None:
            row.employee_no = data.employee_no.strip().upper()
        if data.base_salary_ugx is not None:
            if data.base_salary_ugx < 0:
                raise ClientException(detail="Base salary cannot be negative.", status_code=400)
            row.base_salary_ugx = Decimal(str(data.base_salary_ugx))
        await db_session.commit()
        await db_session.refresh(row)
        return _employee_read(row)

    @get(path="/payroll-runs")
    async def payroll_runs(self, db_session: AsyncSession) -> list[PayrollRunRead]:
        rows = (
            (
                await db_session.execute(
                    select(PayrollRun).order_by(
                        PayrollRun.period_end.desc(), PayrollRun.created_at.desc()
                    )
                )
            )
            .scalars()
            .all()
        )
        return [await _run_read(db_session, item) for item in rows]

    @post(path="/payroll-runs", status_code=HTTP_201_CREATED)
    async def create_payroll_run(
        self, request: Request, data: PayrollRunCreate, db_session: AsyncSession
    ) -> PayrollRunRead:
        if data.period_start > data.period_end:
            raise ClientException(
                detail="Payroll period start cannot be after period end.", status_code=400
            )
        existing_run = (
            await db_session.execute(
                select(PayrollRun).where(
                    PayrollRun.period_start == data.period_start,
                    PayrollRun.period_end == data.period_end,
                )
            )
        ).scalar_one_or_none()
        if existing_run:
            raise ClientException(
                detail="A payroll run already exists for this period.", status_code=409
            )
        employees = (
            (
                await db_session.execute(
                    select(Employee)
                    .where(Employee.is_active.is_(True))
                    .order_by(Employee.full_name)
                )
            )
            .scalars()
            .all()
        )
        if not employees:
            raise ClientException(
                detail="Add at least one active employee before creating payroll.", status_code=400
            )
        run = PayrollRun(
            period_start=data.period_start,
            period_end=data.period_end,
            pay_date=data.pay_date,
            status="draft",
            notes=data.notes,
            created_by_email=_email(request),
        )
        db_session.add(run)
        await db_session.flush()
        for employee in employees:
            basic = Decimal(employee.base_salary_ugx or 0)
            db_session.add(
                PayrollPayment(
                    payroll_run_id=run.id,
                    employee_id=employee.id,
                    basic_pay_ugx=basic,
                    allowances_ugx=Decimal(0),
                    deductions_ugx=Decimal(0),
                    gross_pay_ugx=basic,
                    net_pay_ugx=basic,
                    payment_status="pending",
                    payment_method=employee.payment_method,
                )
            )
        await db_session.commit()
        await db_session.refresh(run)
        return await _run_read(db_session, run)

    @patch(path="/payroll-runs/{run_id:uuid}")
    async def update_payroll_run(
        self, run_id: uuid.UUID, data: PayrollRunUpdate, db_session: AsyncSession
    ) -> PayrollRunRead:
        run = await db_session.get(PayrollRun, run_id)
        if run is None:
            raise NotFoundException(detail="Payroll run not found.")
        if data.status is not None:
            if data.status not in {"draft", "finalized", "paid"}:
                raise ClientException(detail="Invalid payroll status.", status_code=400)
            run.status = data.status
            if data.status in {"finalized", "paid"} and run.finalized_at is None:
                run.finalized_at = datetime.now(UTC)
            if data.status == "paid":
                payments = (
                    (
                        await db_session.execute(
                            select(PayrollPayment).where(PayrollPayment.payroll_run_id == run.id)
                        )
                    )
                    .scalars()
                    .all()
                )
                now = datetime.now(UTC)
                for payment in payments:
                    payment.payment_status = "paid"
                    payment.paid_at = payment.paid_at or now
        if data.pay_date is not None:
            run.pay_date = data.pay_date
        if data.notes is not None:
            run.notes = data.notes
        await db_session.commit()
        await db_session.refresh(run)
        return await _run_read(db_session, run)

    @get(path="/payroll-payments")
    async def payroll_payments(
        self,
        db_session: AsyncSession,
        employee_id: uuid.UUID | None = None,
        payroll_run_id: uuid.UUID | None = None,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> list[PayrollPaymentRead]:
        statement = select(PayrollPayment).join(PayrollRun).order_by(PayrollRun.period_end.desc())
        if employee_id:
            statement = statement.where(PayrollPayment.employee_id == employee_id)
        if payroll_run_id:
            statement = statement.where(PayrollPayment.payroll_run_id == payroll_run_id)
        if from_date:
            statement = statement.where(PayrollRun.period_end >= from_date)
        if to_date:
            statement = statement.where(PayrollRun.period_start <= to_date)
        rows = (await db_session.execute(statement)).scalars().all()
        return [await _payment_read(db_session, item) for item in rows]

    @patch(path="/payroll-payments/{payment_id:uuid}")
    async def update_payroll_payment(
        self, payment_id: uuid.UUID, data: PayrollPaymentUpdate, db_session: AsyncSession
    ) -> PayrollPaymentRead:
        payment = await db_session.get(PayrollPayment, payment_id)
        if payment is None:
            raise NotFoundException(detail="Payroll payment not found.")
        run = await db_session.get(PayrollRun, payment.payroll_run_id)
        if run is None:
            raise NotFoundException(detail="Payroll run not found.")
        if run.status == "paid":
            raise ClientException(detail="Paid payroll runs are locked.", status_code=409)
        if run.status != "draft" and (
            data.allowances_ugx is not None or data.deductions_ugx is not None
        ):
            raise ClientException(
                detail="Allowances and deductions are locked after payroll is finalized.",
                status_code=409,
            )
        if data.allowances_ugx is not None:
            payment.allowances_ugx = Decimal(str(max(data.allowances_ugx, 0)))
        if data.deductions_ugx is not None:
            payment.deductions_ugx = Decimal(str(max(data.deductions_ugx, 0)))
        payment.gross_pay_ugx = Decimal(payment.basic_pay_ugx) + Decimal(payment.allowances_ugx)
        payment.net_pay_ugx = max(
            Decimal(0), Decimal(payment.gross_pay_ugx) - Decimal(payment.deductions_ugx)
        )
        if data.payment_status is not None:
            if data.payment_status not in {"pending", "paid"}:
                raise ClientException(detail="Invalid payment status.", status_code=400)
            payment.payment_status = data.payment_status
            payment.paid_at = datetime.now(UTC) if data.payment_status == "paid" else None
        if data.payment_method is not None:
            payment.payment_method = data.payment_method
        if data.payment_reference is not None:
            payment.payment_reference = data.payment_reference
        if data.notes is not None:
            payment.notes = data.notes
        await db_session.commit()
        await db_session.refresh(payment)
        return await _payment_read(db_session, payment)
