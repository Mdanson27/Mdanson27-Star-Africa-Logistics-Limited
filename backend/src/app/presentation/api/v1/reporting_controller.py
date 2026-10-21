from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, ClassVar

from litestar import Controller, Request, get, post
from litestar.exceptions import ClientException
from litestar.status_codes import HTTP_201_CREATED
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.reporting.models import Account, JournalEntry, JournalLine
from app.domain.reporting.schemas import (
    AccountRead,
    BalanceSheetReport,
    CashFlowReport,
    DashboardAnalytics,
    JournalEntryRead,
    JournalLineRead,
    ManualJournalCreate,
    ProfitLossReport,
    ReceivableAgingReport,
    TrialBalanceReport,
)
from app.domain.reporting.services import (
    balance_sheet,
    cash_flow,
    dashboard_analytics,
    profit_loss,
    receivables_aging,
    trial_balance,
)
from app.presentation.guards.auth_guard import JWTAuthGuard


def _email(request: Request) -> str:
    email = str(request.scope.get("email") or "").strip().lower()
    if not email:
        raise ClientException(detail="Authenticated email is required.", status_code=401)
    return email


def _period(from_date: date | None, to_date: date | None) -> tuple[date, date]:
    today = datetime.now(UTC).date()
    start = from_date or date(today.year, 1, 1)
    end = to_date or today
    if start > end:
        raise ClientException(detail="From date cannot be after to date.", status_code=400)
    return start, end


class ReportingController(Controller):
    path = "/reports"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    @get(path="/dashboard")
    async def dashboard(self, db_session: AsyncSession, months: int = 6) -> DashboardAnalytics:
        return await dashboard_analytics(db_session, months)

    @get(path="/accounts")
    async def accounts(self, db_session: AsyncSession) -> list[AccountRead]:
        rows = (await db_session.execute(select(Account).order_by(Account.code))).scalars().all()
        return [
            AccountRead(
                code=item.code,
                name=item.name,
                account_type=item.account_type,
                normal_balance=item.normal_balance,
                system_key=item.system_key,
                is_active=item.is_active,
            )
            for item in rows
        ]

    @get(path="/trial-balance")
    async def trial_balance_report(
        self, db_session: AsyncSession, as_of: date | None = None
    ) -> TrialBalanceReport:
        return await trial_balance(db_session, as_of or datetime.now(UTC).date())

    @get(path="/profit-loss")
    async def profit_loss_report(
        self,
        db_session: AsyncSession,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> ProfitLossReport:
        start, end = _period(from_date, to_date)
        return await profit_loss(db_session, start, end)

    @get(path="/balance-sheet")
    async def balance_sheet_report(
        self, db_session: AsyncSession, as_of: date | None = None
    ) -> BalanceSheetReport:
        return await balance_sheet(db_session, as_of or datetime.now(UTC).date())

    @get(path="/cash-flow")
    async def cash_flow_report(
        self,
        db_session: AsyncSession,
        from_date: date | None = None,
        to_date: date | None = None,
    ) -> CashFlowReport:
        start, end = _period(from_date, to_date)
        return await cash_flow(db_session, start, end)

    @get(path="/receivables-aging")
    async def receivables_aging_report(
        self, db_session: AsyncSession, as_of: date | None = None
    ) -> ReceivableAgingReport:
        return await receivables_aging(db_session, as_of or datetime.now(UTC).date())

    @get(path="/journal-entries")
    async def journal_entries(
        self,
        db_session: AsyncSession,
        limit: int = 100,
    ) -> list[JournalEntryRead]:
        limit = max(1, min(limit, 500))
        entries = list(
            (
                await db_session.execute(
                    select(JournalEntry)
                    .where(JournalEntry.is_posted.is_(True))
                    .order_by(JournalEntry.entry_date.desc(), JournalEntry.created_at.desc())
                    .limit(limit)
                )
            )
            .scalars()
            .all()
        )
        if not entries:
            return []
        entry_ids = [item.id for item in entries]
        line_rows = (
            await db_session.execute(
                select(JournalLine, Account)
                .join(Account, Account.id == JournalLine.account_id)
                .where(JournalLine.journal_entry_id.in_(entry_ids))
                .order_by(Account.code)
            )
        ).all()
        by_entry: dict[str, list[JournalLineRead]] = {}
        for line, account in line_rows:
            by_entry.setdefault(str(line.journal_entry_id), []).append(
                JournalLineRead(
                    account_code=account.code,
                    account_name=account.name,
                    debit_ugx=float(line.debit_ugx or 0),
                    credit_ugx=float(line.credit_ugx or 0),
                    description=line.description,
                )
            )
        return [
            JournalEntryRead(
                id=str(item.id),
                entry_date=item.entry_date,
                reference=item.reference,
                description=item.description,
                source_type=item.source_type,
                posted_by_email=item.posted_by_email,
                lines=by_entry.get(str(item.id), []),
            )
            for item in entries
        ]

    @post(path="/journal-entries", status_code=HTTP_201_CREATED)
    async def create_manual_journal(
        self,
        request: Request,
        data: ManualJournalCreate,
        db_session: AsyncSession,
    ) -> JournalEntryRead:
        if not data.description.strip():
            raise ClientException(detail="Journal description is required.", status_code=400)
        if len(data.lines) < 2:
            raise ClientException(detail="A journal needs at least two lines.", status_code=400)

        account_rows = (
            (
                await db_session.execute(
                    select(Account).where(
                        Account.code.in_([line.account_code for line in data.lines])
                    )
                )
            )
            .scalars()
            .all()
        )
        accounts = {item.code: item for item in account_rows}
        debit_total = Decimal(0)
        credit_total = Decimal(0)
        normalized: list[tuple[Account, Decimal, Decimal, str | None]] = []
        for raw in data.lines:
            account = accounts.get(raw.account_code)
            if account is None or not account.is_active:
                raise ClientException(
                    detail=f"Unknown or inactive account: {raw.account_code}", status_code=400
                )
            debit = Decimal(str(raw.debit_ugx or 0))
            credit = Decimal(str(raw.credit_ugx or 0))
            if (
                debit < 0
                or credit < 0
                or (debit > 0 and credit > 0)
                or (debit == 0 and credit == 0)
            ):
                raise ClientException(
                    detail="Each journal line must contain one positive debit or credit.",
                    status_code=400,
                )
            debit_total += debit
            credit_total += credit
            normalized.append((account, debit, credit, raw.description))
        if debit_total <= 0 or debit_total != credit_total:
            raise ClientException(
                detail="Journal debits and credits must be equal and greater than zero.",
                status_code=400,
            )

        entry = JournalEntry(
            entry_date=data.entry_date,
            reference=data.reference.strip() if data.reference else None,
            description=data.description.strip(),
            source_type="manual",
            source_id=None,
            posted_by_email=_email(request),
            is_posted=True,
        )
        db_session.add(entry)
        await db_session.flush()
        result_lines: list[JournalLineRead] = []
        for account, debit, credit, description in normalized:
            db_session.add(
                JournalLine(
                    journal_entry_id=entry.id,
                    account_id=account.id,
                    description=description,
                    debit_ugx=debit,
                    credit_ugx=credit,
                )
            )
            result_lines.append(
                JournalLineRead(
                    account_code=account.code,
                    account_name=account.name,
                    debit_ugx=float(debit),
                    credit_ugx=float(credit),
                    description=description,
                )
            )
        await db_session.commit()
        await db_session.refresh(entry)
        return JournalEntryRead(
            id=str(entry.id),
            entry_date=entry.entry_date,
            reference=entry.reference,
            description=entry.description,
            source_type=entry.source_type,
            posted_by_email=entry.posted_by_email,
            lines=result_lines,
        )
