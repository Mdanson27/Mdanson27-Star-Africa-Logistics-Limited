from __future__ import annotations

import uuid
from datetime import date, datetime

import msgspec


class ClientCreate(msgspec.Struct, frozen=True):
    name: str
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    notes: str | None = None


class ClientUpdate(msgspec.Struct, frozen=True):
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    notes: str | None = None
    is_active: bool | None = None


class ClientRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    name: str
    contact_person: str | None
    phone: str | None
    email: str | None
    address: str | None
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class SupplierCreate(msgspec.Struct, frozen=True):
    name: str
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    notes: str | None = None


class SupplierUpdate(msgspec.Struct, frozen=True):
    name: str | None = None
    contact_person: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    notes: str | None = None
    is_active: bool | None = None


class SupplierRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    name: str
    contact_person: str | None
    phone: str | None
    email: str | None
    address: str | None
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class CommercialLineItemInput(msgspec.Struct, frozen=True):
    description: str
    quantity: float = 1
    unit_price_ugx: float = 0


class CommercialLineItemRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    position: int
    description: str
    quantity: float
    unit_price_ugx: float
    amount_ugx: float


class QuotationCreate(msgspec.Struct, frozen=True):
    quotation_number: str
    client_name: str
    amount_ugx: float
    issue_date: date
    client_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    status: str = "draft"
    valid_until: date | None = None
    notes: str | None = None
    items: list[CommercialLineItemInput] = msgspec.field(default_factory=list)


class QuotationUpdate(msgspec.Struct, frozen=True):
    client_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    client_name: str | None = None
    amount_ugx: float | None = None
    status: str | None = None
    issue_date: date | None = None
    valid_until: date | None = None
    notes: str | None = None
    items: list[CommercialLineItemInput] = msgspec.field(default_factory=list)


class QuotationRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    quotation_number: str
    client_id: uuid.UUID | None
    project_id: uuid.UUID | None
    client_name: str
    amount_ugx: float
    status: str
    issue_date: date
    valid_until: date | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    has_current_preview: bool = False
    items: list[CommercialLineItemRead] = msgspec.field(default_factory=list)


class InvoiceCreate(msgspec.Struct, frozen=True):
    invoice_number: str
    client_name: str
    amount_ugx: float
    issue_date: date
    client_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    paid_amount_ugx: float = 0
    status: str = "draft"
    due_date: date | None = None
    notes: str | None = None
    items: list[CommercialLineItemInput] = msgspec.field(default_factory=list)


class InvoiceUpdate(msgspec.Struct, frozen=True):
    client_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    client_name: str | None = None
    amount_ugx: float | None = None
    status: str | None = None
    issue_date: date | None = None
    due_date: date | None = None
    notes: str | None = None
    items: list[CommercialLineItemInput] = msgspec.field(default_factory=list)


class InvoiceRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    invoice_number: str
    client_id: uuid.UUID | None
    project_id: uuid.UUID | None
    client_name: str
    amount_ugx: float
    paid_amount_ugx: float
    outstanding_amount_ugx: float
    status: str
    issue_date: date
    due_date: date | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    source_quotation_id: uuid.UUID | None = None
    items: list[CommercialLineItemRead] = msgspec.field(default_factory=list)


class QuotationConvertRequest(msgspec.Struct, frozen=True):
    issue_date: date
    due_date: date | None = None
    notes: str | None = None


class PaymentCreate(msgspec.Struct, frozen=True):
    amount_ugx: float
    payment_date: date
    client_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    invoice_id: uuid.UUID | None = None
    method: str = "bank"
    reference: str | None = None
    notes: str | None = None


class PaymentRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    receipt_number: str | None
    client_id: uuid.UUID | None
    project_id: uuid.UUID | None
    invoice_id: uuid.UUID | None
    amount_ugx: float
    payment_date: date
    method: str
    reference: str | None
    notes: str | None
    recorded_by_email: str
    created_at: datetime
    updated_at: datetime


class ReceiptRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    receipt_reference: str
    client_id: uuid.UUID | None
    client_name: str | None
    project_id: uuid.UUID | None
    invoice_id: uuid.UUID | None
    invoice_number: str | None
    amount_ugx: float
    payment_date: date
    method: str
    reference: str | None
    notes: str | None
    recorded_by_email: str
    created_at: datetime


class PurchaseOrderCreate(msgspec.Struct, frozen=True):
    po_number: str
    supplier_name: str
    amount_ugx: float
    order_date: date
    supplier_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    status: str = "draft"
    expected_date: date | None = None
    notes: str | None = None
    items: list[CommercialLineItemInput] = msgspec.field(default_factory=list)


class PurchaseOrderUpdate(msgspec.Struct, frozen=True):
    supplier_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    supplier_name: str | None = None
    amount_ugx: float | None = None
    status: str | None = None
    order_date: date | None = None
    expected_date: date | None = None
    notes: str | None = None
    items: list[CommercialLineItemInput] = msgspec.field(default_factory=list)


class PurchaseOrderRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    po_number: str
    supplier_id: uuid.UUID | None
    project_id: uuid.UUID | None
    supplier_name: str
    amount_ugx: float
    status: str
    order_date: date
    expected_date: date | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
    items: list[CommercialLineItemRead] = msgspec.field(default_factory=list)


class CommercialDocumentRead(msgspec.Struct, frozen=True):
    document_id: uuid.UUID | None
    document_number: str
    filename: str
    download_url: str | None
    stored: bool


class ExpenseCreate(msgspec.Struct, frozen=True):
    description: str
    amount_ugx: float
    expense_date: date
    project_id: uuid.UUID | None = None
    supplier_id: uuid.UUID | None = None
    supporting_document_id: uuid.UUID | None = None
    category: str = "general"
    reference: str | None = None


class ExpenseRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    project_id: uuid.UUID | None
    supplier_id: uuid.UUID | None
    supporting_document_id: uuid.UUID | None
    category: str
    description: str
    amount_ugx: float
    expense_date: date
    reference: str | None
    created_at: datetime
    updated_at: datetime


class BusinessSummary(msgspec.Struct, frozen=True):
    total_clients: int
    active_clients: int
    total_suppliers: int
    active_suppliers: int
    quotations_open: int
    outstanding_invoices: int
    receivables_ugx: float
    purchase_orders_open: int
    expenses_month_ugx: float
    receipts_month_ugx: float
    clients: int
    suppliers: int
    invoice_outstanding_ugx: float
    expenses_ugx: float


class PartyProjectItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    name: str
    status: str
    value_ugx: float
    amount_paid_ugx: float
    progress: int
    due_date: date | None


class PartyDocumentItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    project_id: uuid.UUID | None
    title: str
    original_filename: str
    category: str
    created_at: datetime


class ActivityItem(msgspec.Struct, frozen=True):
    record_id: uuid.UUID
    kind: str
    label: str
    detail: str | None
    occurred_at: datetime


class ClientWorkspace(msgspec.Struct, frozen=True):
    client: ClientRead
    projects: list[PartyProjectItem]
    quotations: list[QuotationRead]
    invoices: list[InvoiceRead]
    receipts: list[ReceiptRead]
    documents: list[PartyDocumentItem]
    outstanding_balance_ugx: float
    activity: list[ActivityItem]


class SupplierWorkspace(msgspec.Struct, frozen=True):
    supplier: SupplierRead
    projects: list[PartyProjectItem]
    purchase_orders: list[PurchaseOrderRead]
    expenses: list[ExpenseRead]
    documents: list[PartyDocumentItem]
    purchase_orders_total_ugx: float
    expenses_total_ugx: float
    activity: list[ActivityItem]


class ClientStatementSummary(msgspec.Struct, frozen=True):
    client_id: uuid.UUID
    client_name: str
    invoiced_ugx: float
    paid_ugx: float
    outstanding_ugx: float


class SupplierStatementSummary(msgspec.Struct, frozen=True):
    supplier_id: uuid.UUID
    supplier_name: str
    purchase_orders_ugx: float
    expenses_ugx: float


class StatementEntry(msgspec.Struct, frozen=True):
    record_id: uuid.UUID
    kind: str
    reference: str
    entry_date: date
    debit_ugx: float
    credit_ugx: float
    running_balance_ugx: float
    status: str | None = None


class BusinessDocumentArchiveItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    document_type: str | None
    document_number: str | None
    title: str
    filename: str
    version: int
    is_current: bool
    is_deleted: bool
    client_id: uuid.UUID | None
    supplier_id: uuid.UUID | None
    project_id: uuid.UUID | None
    related_record_type: str | None
    related_record_id: uuid.UUID | None
    uploaded_by_email: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None
    deleted_by_email: str | None
    supersedes_document_id: uuid.UUID | None


class BusinessDocumentEventRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    document_id: uuid.UUID
    action: str
    actor_email: str
    details: dict
    occurred_at: datetime


class BusinessDocumentEmailRequest(msgspec.Struct, frozen=True):
    to_address: str
    subject: str | None = None
    message: str | None = None


class BusinessDocumentActionResponse(msgspec.Struct, frozen=True):
    document: BusinessDocumentArchiveItem
    download_url: str | None = None
    message: str | None = None
