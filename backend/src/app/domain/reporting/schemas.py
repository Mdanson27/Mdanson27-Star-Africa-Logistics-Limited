from __future__ import annotations

from datetime import date

import msgspec


class NamedValue(msgspec.Struct, frozen=True):
    name: str
    value: float


class NamedCount(msgspec.Struct, frozen=True):
    name: str
    count: int


class MonthlyFinancePoint(msgspec.Struct, frozen=True):
    month: str
    invoiced_ugx: float
    received_ugx: float
    expenses_ugx: float
    net_cash_ugx: float


class ProjectPerformanceItem(msgspec.Struct, frozen=True):
    project_id: str
    project_name: str
    client_name: str
    status: str
    progress: int
    value_ugx: float
    received_ugx: float
    expenses_ugx: float
    margin_ugx: float


class DashboardAnalytics(msgspec.Struct, frozen=True):
    active_projects: int
    open_tasks: int
    overdue_tasks: int
    task_completion_rate: float
    receivables_ugx: float
    receipts_month_ugx: float
    expenses_month_ugx: float
    net_cash_month_ugx: float
    project_status: list[NamedCount]
    task_status: list[NamedCount]
    invoice_status: list[NamedCount]
    quotation_status: list[NamedCount]
    expense_categories: list[NamedValue]
    monthly_finance: list[MonthlyFinancePoint]
    top_projects: list[ProjectPerformanceItem]
    document_categories: list[NamedCount]


class TrialBalanceRow(msgspec.Struct, frozen=True):
    account_code: str
    account_name: str
    account_type: str
    debit_ugx: float
    credit_ugx: float
    balance_ugx: float


class TrialBalanceReport(msgspec.Struct, frozen=True):
    as_of: date
    rows: list[TrialBalanceRow]
    total_debits_ugx: float
    total_credits_ugx: float
    difference_ugx: float
    balanced: bool


class StatementLine(msgspec.Struct, frozen=True):
    code: str
    name: str
    amount_ugx: float


class ProfitLossReport(msgspec.Struct, frozen=True):
    from_date: date
    to_date: date
    revenue: list[StatementLine]
    expenses: list[StatementLine]
    total_revenue_ugx: float
    total_expenses_ugx: float
    net_profit_ugx: float
    margin_percent: float


class BalanceSheetReport(msgspec.Struct, frozen=True):
    as_of: date
    assets: list[StatementLine]
    liabilities: list[StatementLine]
    equity: list[StatementLine]
    total_assets_ugx: float
    total_liabilities_ugx: float
    total_equity_ugx: float
    difference_ugx: float
    balanced: bool


class CashFlowPoint(msgspec.Struct, frozen=True):
    month: str
    inflows_ugx: float
    outflows_ugx: float
    net_ugx: float


class CashFlowReport(msgspec.Struct, frozen=True):
    from_date: date
    to_date: date
    inflows_ugx: float
    outflows_ugx: float
    net_cash_flow_ugx: float
    monthly: list[CashFlowPoint]


class ReceivableAgingInvoice(msgspec.Struct, frozen=True):
    invoice_number: str
    client_name: str
    due_date: date | None
    outstanding_ugx: float
    days_overdue: int
    bucket: str


class ReceivableAgingReport(msgspec.Struct, frozen=True):
    as_of: date
    current_ugx: float
    days_1_30_ugx: float
    days_31_60_ugx: float
    days_61_90_ugx: float
    days_90_plus_ugx: float
    total_ugx: float
    invoices: list[ReceivableAgingInvoice]


class AccountRead(msgspec.Struct, frozen=True):
    code: str
    name: str
    account_type: str
    normal_balance: str
    system_key: str | None
    is_active: bool


class ManualJournalLineInput(msgspec.Struct, frozen=True):
    account_code: str
    debit_ugx: float = 0
    credit_ugx: float = 0
    description: str | None = None


class ManualJournalCreate(msgspec.Struct, frozen=True):
    entry_date: date
    description: str
    reference: str | None = None
    lines: list[ManualJournalLineInput] = msgspec.field(default_factory=list)


class JournalLineRead(msgspec.Struct, frozen=True):
    account_code: str
    account_name: str
    debit_ugx: float
    credit_ugx: float
    description: str | None


class JournalEntryRead(msgspec.Struct, frozen=True):
    id: str
    entry_date: date
    reference: str | None
    description: str
    source_type: str | None
    posted_by_email: str
    lines: list[JournalLineRead]
