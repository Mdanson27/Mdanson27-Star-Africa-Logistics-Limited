from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.business.models import Expense, Invoice, Payment, Quotation
from app.domain.reporting.models import Account, JournalEntry, JournalLine
from app.domain.reporting.schemas import (
    BalanceSheetReport,
    CashFlowPoint,
    CashFlowReport,
    DashboardAnalytics,
    MonthlyFinancePoint,
    NamedCount,
    NamedValue,
    ProfitLossReport,
    ProjectPerformanceItem,
    ReceivableAgingInvoice,
    ReceivableAgingReport,
    StatementLine,
    TrialBalanceReport,
    TrialBalanceRow,
)
from app.domain.workspace.models import Document, Project, ProjectTask

ZERO = Decimal(0)


def dec(value: Decimal | float | None) -> Decimal:
    return Decimal(str(value or 0))


def month_start(value: date) -> date:
    return date(value.year, value.month, 1)


def add_months(value: date, months: int) -> date:
    total = value.year * 12 + (value.month - 1) + months
    return date(total // 12, total % 12 + 1, 1)


def month_label(value: date) -> str:
    return value.strftime("%b %Y")


async def account_map(db_session: AsyncSession) -> dict[str, Account]:
    rows = (
        (await db_session.execute(select(Account).where(Account.is_active.is_(True))))
        .scalars()
        .all()
    )
    return {item.system_key or item.code: item for item in rows}


async def replace_source_entry(
    db_session: AsyncSession,
    *,
    source_type: str,
    source_id: uuid.UUID,
    entry_date: date,
    reference: str | None,
    description: str,
    posted_by_email: str,
    lines: list[
        tuple[
            str, Decimal, Decimal, uuid.UUID | None, uuid.UUID | None, uuid.UUID | None, str | None
        ]
    ],
) -> JournalEntry:
    accounts = await account_map(db_session)
    entry = (
        await db_session.execute(
            select(JournalEntry).where(
                JournalEntry.source_type == source_type,
                JournalEntry.source_id == source_id,
            )
        )
    ).scalar_one_or_none()
    if entry is None:
        entry = JournalEntry(
            entry_date=entry_date,
            reference=reference,
            description=description,
            source_type=source_type,
            source_id=source_id,
            posted_by_email=posted_by_email,
            is_posted=True,
        )
        db_session.add(entry)
        await db_session.flush()
    else:
        entry.entry_date = entry_date
        entry.reference = reference
        entry.description = description
        entry.posted_by_email = posted_by_email
        entry.is_posted = True
        await db_session.execute(
            delete(JournalLine).where(JournalLine.journal_entry_id == entry.id)
        )

    total_debit = sum((line[1] for line in lines), ZERO)
    total_credit = sum((line[2] for line in lines), ZERO)
    if total_debit != total_credit:
        raise ValueError("Journal entry is not balanced.")
    if total_debit <= 0:
        raise ValueError("Journal entry must contain a positive amount.")

    for key, debit, credit, project_id, client_id, supplier_id, line_description in lines:
        account = accounts.get(key)
        if account is None:
            raise ValueError(f"Accounting account is missing: {key}")
        db_session.add(
            JournalLine(
                journal_entry_id=entry.id,
                account_id=account.id,
                project_id=project_id,
                client_id=client_id,
                supplier_id=supplier_id,
                description=line_description,
                debit_ugx=debit,
                credit_ugx=credit,
            )
        )
    await db_session.flush()
    return entry


async def remove_source_entry(
    db_session: AsyncSession, source_type: str, source_id: uuid.UUID
) -> None:
    entry_id = await db_session.scalar(
        select(JournalEntry.id).where(
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
        )
    )
    if entry_id is not None:
        await db_session.execute(delete(JournalEntry).where(JournalEntry.id == entry_id))


async def sync_invoice_ledger(db_session: AsyncSession, invoice: Invoice) -> None:
    if invoice.status == "draft" or dec(invoice.amount_ugx) <= 0:
        await remove_source_entry(db_session, "invoice", invoice.id)
        await remove_source_entry(db_session, "invoice_opening_payment", invoice.id)
        return
    amount = dec(invoice.amount_ugx)
    await replace_source_entry(
        db_session,
        source_type="invoice",
        source_id=invoice.id,
        entry_date=invoice.issue_date,
        reference=invoice.invoice_number,
        description=f"Invoice {invoice.invoice_number} — {invoice.client_name}",
        posted_by_email=invoice.created_by_email,
        lines=[
            (
                "accounts_receivable",
                amount,
                ZERO,
                invoice.project_id,
                invoice.client_id,
                None,
                invoice.client_name,
            ),
            (
                "service_revenue",
                ZERO,
                amount,
                invoice.project_id,
                invoice.client_id,
                None,
                invoice.client_name,
            ),
        ],
    )
    payment_total = dec(
        await db_session.scalar(
            select(func.coalesce(func.sum(Payment.amount_ugx), 0)).where(
                Payment.invoice_id == invoice.id
            )
        )
    )
    opening_paid = max(ZERO, dec(invoice.paid_amount_ugx) - payment_total)
    if opening_paid > 0:
        await replace_source_entry(
            db_session,
            source_type="invoice_opening_payment",
            source_id=invoice.id,
            entry_date=invoice.issue_date,
            reference=f"{invoice.invoice_number}-OPENING-PAID",
            description=f"Opening paid amount recorded on {invoice.invoice_number}",
            posted_by_email=invoice.created_by_email,
            lines=[
                (
                    "cash_bank",
                    opening_paid,
                    ZERO,
                    invoice.project_id,
                    invoice.client_id,
                    None,
                    invoice.client_name,
                ),
                (
                    "accounts_receivable",
                    ZERO,
                    opening_paid,
                    invoice.project_id,
                    invoice.client_id,
                    None,
                    invoice.client_name,
                ),
            ],
        )
    else:
        await remove_source_entry(db_session, "invoice_opening_payment", invoice.id)


async def sync_payment_ledger(db_session: AsyncSession, payment: Payment) -> None:
    amount = dec(payment.amount_ugx)
    if amount <= 0:
        await remove_source_entry(db_session, "payment", payment.id)
        return
    credit_key = "accounts_receivable" if payment.invoice_id else "service_revenue"
    await replace_source_entry(
        db_session,
        source_type="payment",
        source_id=payment.id,
        entry_date=payment.payment_date,
        reference=payment.receipt_number or payment.reference,
        description=f"Receipt {payment.receipt_number or payment.reference or str(payment.id)[:8]}",
        posted_by_email=payment.recorded_by_email,
        lines=[
            ("cash_bank", amount, ZERO, payment.project_id, payment.client_id, None, payment.notes),
            (credit_key, ZERO, amount, payment.project_id, payment.client_id, None, payment.notes),
        ],
    )


async def sync_expense_ledger(db_session: AsyncSession, expense: Expense) -> None:
    amount = dec(expense.amount_ugx)
    if amount <= 0:
        await remove_source_entry(db_session, "expense", expense.id)
        return
    await replace_source_entry(
        db_session,
        source_type="expense",
        source_id=expense.id,
        entry_date=expense.expense_date,
        reference=expense.reference,
        description=expense.description,
        posted_by_email=expense.created_by_email,
        lines=[
            (
                "operating_expense",
                amount,
                ZERO,
                expense.project_id,
                None,
                expense.supplier_id,
                expense.category,
            ),
            (
                "cash_bank",
                ZERO,
                amount,
                expense.project_id,
                None,
                expense.supplier_id,
                expense.description,
            ),
        ],
    )


async def trial_balance(db_session: AsyncSession, as_of: date) -> TrialBalanceReport:
    result = await db_session.execute(
        select(
            Account.code,
            Account.name,
            Account.account_type,
            Account.normal_balance,
            func.coalesce(func.sum(JournalLine.debit_ugx), 0),
            func.coalesce(func.sum(JournalLine.credit_ugx), 0),
        )
        .join(JournalLine, JournalLine.account_id == Account.id)
        .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
        .where(JournalEntry.is_posted.is_(True), JournalEntry.entry_date <= as_of)
        .group_by(Account.id)
        .order_by(Account.code)
    )
    rows: list[TrialBalanceRow] = []
    total_debits = ZERO
    total_credits = ZERO
    for code, name, account_type, normal_balance, debit, credit in result.all():
        debit_d = dec(debit)
        credit_d = dec(credit)
        total_debits += debit_d
        total_credits += credit_d
        balance = debit_d - credit_d if normal_balance == "debit" else credit_d - debit_d
        rows.append(
            TrialBalanceRow(
                account_code=code,
                account_name=name,
                account_type=account_type,
                debit_ugx=float(debit_d),
                credit_ugx=float(credit_d),
                balance_ugx=float(balance),
            )
        )
    difference = total_debits - total_credits
    return TrialBalanceReport(
        as_of=as_of,
        rows=rows,
        total_debits_ugx=float(total_debits),
        total_credits_ugx=float(total_credits),
        difference_ugx=float(difference),
        balanced=abs(difference) < Decimal("0.01"),
    )


async def profit_loss(db_session: AsyncSession, from_date: date, to_date: date) -> ProfitLossReport:
    result = await db_session.execute(
        select(
            Account.code,
            Account.name,
            Account.account_type,
            func.coalesce(func.sum(JournalLine.debit_ugx), 0),
            func.coalesce(func.sum(JournalLine.credit_ugx), 0),
        )
        .join(JournalLine, JournalLine.account_id == Account.id)
        .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
        .where(
            JournalEntry.is_posted.is_(True),
            JournalEntry.entry_date >= from_date,
            JournalEntry.entry_date <= to_date,
            Account.account_type.in_(["revenue", "expense"]),
        )
        .group_by(Account.id)
        .order_by(Account.code)
    )
    revenue: list[StatementLine] = []
    expenses: list[StatementLine] = []
    total_revenue = ZERO
    total_expenses = ZERO
    for code, name, account_type, debit, credit in result.all():
        if account_type == "revenue":
            amount = dec(credit) - dec(debit)
            total_revenue += amount
            revenue.append(StatementLine(code=code, name=name, amount_ugx=float(amount)))
        else:
            amount = dec(debit) - dec(credit)
            total_expenses += amount
            expenses.append(StatementLine(code=code, name=name, amount_ugx=float(amount)))
    net = total_revenue - total_expenses
    margin = (net / total_revenue * 100) if total_revenue else ZERO
    return ProfitLossReport(
        from_date=from_date,
        to_date=to_date,
        revenue=revenue,
        expenses=expenses,
        total_revenue_ugx=float(total_revenue),
        total_expenses_ugx=float(total_expenses),
        net_profit_ugx=float(net),
        margin_percent=float(margin),
    )


async def balance_sheet(db_session: AsyncSession, as_of: date) -> BalanceSheetReport:
    tb = await trial_balance(db_session, as_of)
    assets: list[StatementLine] = []
    liabilities: list[StatementLine] = []
    equity: list[StatementLine] = []
    total_assets = ZERO
    total_liabilities = ZERO
    total_equity = ZERO
    for row in tb.rows:
        amount = dec(row.balance_ugx)
        line = StatementLine(code=row.account_code, name=row.account_name, amount_ugx=float(amount))
        if row.account_type == "asset":
            assets.append(line)
            total_assets += amount
        elif row.account_type == "liability":
            liabilities.append(line)
            total_liabilities += amount
        elif row.account_type == "equity":
            equity.append(line)
            total_equity += amount
    lifetime_pl = await profit_loss(db_session, date(1900, 1, 1), as_of)
    current_earnings = dec(lifetime_pl.net_profit_ugx)
    equity.append(
        StatementLine(code="3999", name="Accumulated earnings", amount_ugx=float(current_earnings))
    )
    total_equity += current_earnings
    difference = total_assets - total_liabilities - total_equity
    return BalanceSheetReport(
        as_of=as_of,
        assets=assets,
        liabilities=liabilities,
        equity=equity,
        total_assets_ugx=float(total_assets),
        total_liabilities_ugx=float(total_liabilities),
        total_equity_ugx=float(total_equity),
        difference_ugx=float(difference),
        balanced=abs(difference) < Decimal("0.01"),
    )


async def cash_flow(db_session: AsyncSession, from_date: date, to_date: date) -> CashFlowReport:
    cash = await db_session.scalar(select(Account).where(Account.system_key == "cash_bank"))
    if cash is None:
        return CashFlowReport(
            from_date=from_date,
            to_date=to_date,
            inflows_ugx=0,
            outflows_ugx=0,
            net_cash_flow_ugx=0,
            monthly=[],
        )
    rows = (
        await db_session.execute(
            select(JournalEntry.entry_date, JournalLine.debit_ugx, JournalLine.credit_ugx)
            .join(JournalLine, JournalLine.journal_entry_id == JournalEntry.id)
            .where(
                JournalEntry.is_posted.is_(True),
                JournalEntry.entry_date >= from_date,
                JournalEntry.entry_date <= to_date,
                JournalLine.account_id == cash.id,
            )
            .order_by(JournalEntry.entry_date)
        )
    ).all()
    monthly_values: dict[str, list[Decimal]] = defaultdict(lambda: [ZERO, ZERO])
    inflows = ZERO
    outflows = ZERO
    for entry_date, debit, credit in rows:
        d = dec(debit)
        c = dec(credit)
        inflows += d
        outflows += c
        key = entry_date.strftime("%Y-%m")
        monthly_values[key][0] += d
        monthly_values[key][1] += c
    monthly = [
        CashFlowPoint(
            month=date.fromisoformat(f"{key}-01").strftime("%b %Y"),
            inflows_ugx=float(values[0]),
            outflows_ugx=float(values[1]),
            net_ugx=float(values[0] - values[1]),
        )
        for key, values in sorted(monthly_values.items())
    ]
    return CashFlowReport(
        from_date=from_date,
        to_date=to_date,
        inflows_ugx=float(inflows),
        outflows_ugx=float(outflows),
        net_cash_flow_ugx=float(inflows - outflows),
        monthly=monthly,
    )


async def receivables_aging(db_session: AsyncSession, as_of: date) -> ReceivableAgingReport:
    rows = (
        (
            await db_session.execute(
                select(Invoice)
                .where(Invoice.paid_amount_ugx < Invoice.amount_ugx, Invoice.status != "draft")
                .order_by(Invoice.due_date, Invoice.issue_date)
            )
        )
        .scalars()
        .all()
    )
    buckets = {"current": ZERO, "1-30": ZERO, "31-60": ZERO, "61-90": ZERO, "90+": ZERO}
    invoices: list[ReceivableAgingInvoice] = []
    for item in rows:
        outstanding = max(ZERO, dec(item.amount_ugx) - dec(item.paid_amount_ugx))
        base_date = item.due_date or item.issue_date
        days = max(0, (as_of - base_date).days)
        if base_date >= as_of:
            bucket = "current"
        elif days <= 30:
            bucket = "1-30"
        elif days <= 60:
            bucket = "31-60"
        elif days <= 90:
            bucket = "61-90"
        else:
            bucket = "90+"
        buckets[bucket] += outstanding
        invoices.append(
            ReceivableAgingInvoice(
                invoice_number=item.invoice_number,
                client_name=item.client_name,
                due_date=item.due_date,
                outstanding_ugx=float(outstanding),
                days_overdue=days,
                bucket=bucket,
            )
        )
    total = sum(buckets.values(), ZERO)
    return ReceivableAgingReport(
        as_of=as_of,
        current_ugx=float(buckets["current"]),
        days_1_30_ugx=float(buckets["1-30"]),
        days_31_60_ugx=float(buckets["31-60"]),
        days_61_90_ugx=float(buckets["61-90"]),
        days_90_plus_ugx=float(buckets["90+"]),
        total_ugx=float(total),
        invoices=invoices,
    )


async def dashboard_analytics(db_session: AsyncSession, months: int = 6) -> DashboardAnalytics:
    today = datetime.now(UTC).date()
    months = max(3, min(12, months))
    start = add_months(month_start(today), -(months - 1))
    next_month = add_months(month_start(today), 1)

    projects = list(
        (await db_session.execute(select(Project).where(Project.is_archived.is_(False))))
        .scalars()
        .all()
    )
    tasks = list((await db_session.execute(select(ProjectTask))).scalars().all())
    invoices = list((await db_session.execute(select(Invoice))).scalars().all())
    quotations = list((await db_session.execute(select(Quotation))).scalars().all())
    payments = list(
        (
            await db_session.execute(
                select(Payment).where(
                    Payment.payment_date >= start, Payment.payment_date < next_month
                )
            )
        )
        .scalars()
        .all()
    )
    expenses = list(
        (
            await db_session.execute(
                select(Expense).where(
                    Expense.expense_date >= start, Expense.expense_date < next_month
                )
            )
        )
        .scalars()
        .all()
    )
    documents = list(
        (await db_session.execute(select(Document).where(Document.is_deleted.is_(False))))
        .scalars()
        .all()
    )

    completed_statuses = {"completed", "done"}
    completed_tasks = sum(1 for item in tasks if item.status in completed_statuses)
    overdue_tasks = sum(
        1
        for item in tasks
        if item.status not in completed_statuses and item.due_date and item.due_date < today
    )
    task_completion = (completed_tasks / len(tasks) * 100) if tasks else 0.0
    active_projects = sum(1 for item in projects if item.status == "active")
    receivables = sum(
        (
            max(ZERO, dec(item.amount_ugx) - dec(item.paid_amount_ugx))
            for item in invoices
            if item.status != "draft"
        ),
        ZERO,
    )

    current_month_start = month_start(today)
    receipts_month = sum(
        (dec(item.amount_ugx) for item in payments if item.payment_date >= current_month_start),
        ZERO,
    )
    expenses_month = sum(
        (dec(item.amount_ugx) for item in expenses if item.expense_date >= current_month_start),
        ZERO,
    )

    project_status = Counter(item.status.replace("_", " ").title() for item in projects)
    task_status = Counter(item.status.replace("_", " ").title() for item in tasks)
    invoice_status = Counter(item.status.replace("_", " ").title() for item in invoices)
    quotation_status = Counter(item.status.replace("_", " ").title() for item in quotations)
    document_categories = Counter(item.category.replace("_", " ").title() for item in documents)
    expense_categories: dict[str, Decimal] = defaultdict(lambda: ZERO)
    for item in expenses:
        expense_categories[item.category.replace("_", " ").title()] += dec(item.amount_ugx)

    month_points: list[MonthlyFinancePoint] = []
    for offset in range(months):
        start_month = add_months(start, offset)
        end_month = add_months(start_month, 1)
        invoiced = sum(
            (
                dec(item.amount_ugx)
                for item in invoices
                if item.status != "draft" and start_month <= item.issue_date < end_month
            ),
            ZERO,
        )
        received = sum(
            (
                dec(item.amount_ugx)
                for item in payments
                if start_month <= item.payment_date < end_month
            ),
            ZERO,
        )
        spent = sum(
            (
                dec(item.amount_ugx)
                for item in expenses
                if start_month <= item.expense_date < end_month
            ),
            ZERO,
        )
        month_points.append(
            MonthlyFinancePoint(
                month=month_label(start_month),
                invoiced_ugx=float(invoiced),
                received_ugx=float(received),
                expenses_ugx=float(spent),
                net_cash_ugx=float(received - spent),
            )
        )

    expenses_by_project: dict[uuid.UUID, Decimal] = defaultdict(lambda: ZERO)
    for item in expenses:
        if item.project_id:
            expenses_by_project[item.project_id] += dec(item.amount_ugx)
    top_projects = sorted(projects, key=lambda item: dec(item.value_ugx), reverse=True)[:8]
    project_items = [
        ProjectPerformanceItem(
            project_id=str(item.id),
            project_name=item.name,
            client_name=item.client_name,
            status=item.status,
            progress=item.progress,
            value_ugx=float(dec(item.value_ugx)),
            received_ugx=float(dec(item.amount_paid_ugx)),
            expenses_ugx=float(expenses_by_project[item.id]),
            margin_ugx=float(dec(item.amount_paid_ugx) - expenses_by_project[item.id]),
        )
        for item in top_projects
    ]

    return DashboardAnalytics(
        active_projects=active_projects,
        open_tasks=len(tasks) - completed_tasks,
        overdue_tasks=overdue_tasks,
        task_completion_rate=round(task_completion, 1),
        receivables_ugx=float(receivables),
        receipts_month_ugx=float(receipts_month),
        expenses_month_ugx=float(expenses_month),
        net_cash_month_ugx=float(receipts_month - expenses_month),
        project_status=[
            NamedCount(name=name, count=count) for name, count in project_status.most_common()
        ],
        task_status=[
            NamedCount(name=name, count=count) for name, count in task_status.most_common()
        ],
        invoice_status=[
            NamedCount(name=name, count=count) for name, count in invoice_status.most_common()
        ],
        quotation_status=[
            NamedCount(name=name, count=count) for name, count in quotation_status.most_common()
        ],
        expense_categories=[
            NamedValue(name=name, value=float(value))
            for name, value in sorted(
                expense_categories.items(), key=lambda item: item[1], reverse=True
            )
        ],
        monthly_finance=month_points,
        top_projects=project_items,
        document_categories=[
            NamedCount(name=name, count=count) for name, count in document_categories.most_common()
        ],
    )
