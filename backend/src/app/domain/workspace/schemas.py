from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

import msgspec


class ProjectCreate(msgspec.Struct, frozen=True):
    name: str
    client_name: str
    client_id: uuid.UUID | None = None
    description: str | None = None
    status: str = "planning"
    value_ugx: float = 0
    amount_paid_ugx: float = 0
    start_date: date | None = None
    due_date: date | None = None
    progress: int = 0
    project_manager_email: str | None = None
    team_emails: list[str] = msgspec.field(default_factory=list)
    tags: list[str] = msgspec.field(default_factory=list)
    current_milestone: str | None = None


class ProjectUpdate(msgspec.Struct, frozen=True):
    name: str | None = None
    client_name: str | None = None
    client_id: uuid.UUID | None = None
    description: str | None = None
    status: str | None = None
    value_ugx: float | None = None
    amount_paid_ugx: float | None = None
    start_date: date | None = None
    due_date: date | None = None
    progress: int | None = None
    project_manager_email: str | None = None
    team_emails: list[str] | None = None
    tags: list[str] | None = None
    current_milestone: str | None = None
    is_archived: bool | None = None


class ProjectRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    name: str
    client_name: str
    client_id: uuid.UUID | None
    description: str | None
    status: str
    value_ugx: float
    amount_paid_ugx: float
    start_date: date | None
    due_date: date | None
    progress: int
    project_manager_email: str | None
    team_emails: list[str]
    tags: list[str]
    current_milestone: str | None
    created_by_email: str
    is_archived: bool
    created_at: datetime
    updated_at: datetime


class ProjectDashboardSummary(msgspec.Struct, frozen=True):
    total_projects: int
    active_projects: int
    planning_projects: int
    overdue_projects: int
    completed_projects: int
    total_project_value_ugx: float
    amount_received_ugx: float
    outstanding_ugx: float
    tasks_due: int
    projects_needing_attention: int


class TaskCreate(msgspec.Struct, frozen=True):
    project_id: uuid.UUID
    title: str
    description: str | None = None
    assignee_email: str | None = None
    status: str = "todo"
    priority: str = "normal"
    start_date: date | None = None
    due_date: date | None = None
    related_document_id: uuid.UUID | None = None


class TaskUpdate(msgspec.Struct, frozen=True):
    project_id: uuid.UUID | None = None
    title: str | None = None
    description: str | None = None
    assignee_email: str | None = None
    status: str | None = None
    priority: str | None = None
    start_date: date | None = None
    due_date: date | None = None
    related_document_id: uuid.UUID | None = None
    clear_start_date: bool = False
    clear_due_date: bool = False
    clear_related_document: bool = False


class TaskRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    project_id: uuid.UUID
    title: str
    description: str | None
    assignee_email: str | None
    status: str
    priority: str
    start_date: date | None
    due_date: date | None
    related_document_id: uuid.UUID | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TaskDashboardSummary(msgspec.Struct, frozen=True):
    due_today: int
    overdue: int
    high_priority: int
    assigned_to_me: int
    recently_completed: int


class DocumentPresignRequest(msgspec.Struct, frozen=True):
    filename: str
    content_type: str
    project_id: uuid.UUID | None = None


class DocumentPresignResponse(msgspec.Struct, frozen=True):
    upload_url: str
    storage_key: str
    method: str = "PUT"


class DocumentCreate(msgspec.Struct, frozen=True):
    title: str
    original_filename: str
    category: str
    content_type: str
    size_bytes: int
    storage_key: str
    project_id: uuid.UUID | None = None
    client_id: uuid.UUID | None = None
    supplier_id: uuid.UUID | None = None
    ocr_status: str = "not_requested"
    review_status: str = "not_reviewed"
    related_record_type: str | None = None
    related_record_id: uuid.UUID | None = None
    ocr_text: str | None = None
    extracted_fields: dict[str, Any] = msgspec.field(default_factory=dict)


class DocumentUpdate(msgspec.Struct, frozen=True):
    title: str | None = None
    category: str | None = None
    project_id: uuid.UUID | None = None
    client_id: uuid.UUID | None = None
    supplier_id: uuid.UUID | None = None
    ocr_status: str | None = None
    review_status: str | None = None
    related_record_type: str | None = None
    related_record_id: uuid.UUID | None = None
    ocr_text: str | None = None
    extracted_fields: dict[str, Any] | None = None


class DocumentRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    project_id: uuid.UUID | None
    client_id: uuid.UUID | None
    supplier_id: uuid.UUID | None
    title: str
    original_filename: str
    category: str
    content_type: str
    size_bytes: int
    storage_key: str
    uploaded_by_email: str
    ocr_status: str
    review_status: str
    related_record_type: str | None
    related_record_id: uuid.UUID | None
    document_type: str | None
    document_number: str | None
    version: int
    is_current: bool
    is_deleted: bool
    deleted_at: datetime | None
    deleted_by_email: str | None
    supersedes_document_id: uuid.UUID | None
    content_hash: str | None
    ocr_text: str | None
    extracted_fields: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class DownloadResponse(msgspec.Struct, frozen=True):
    url: str


class ProjectQuotationItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    quotation_number: str
    amount_ugx: float
    status: str
    issue_date: date


class ProjectInvoiceItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    invoice_number: str
    amount_ugx: float
    paid_amount_ugx: float
    status: str
    issue_date: date
    due_date: date | None


class ProjectPaymentItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    invoice_id: uuid.UUID | None
    amount_ugx: float
    payment_date: date
    method: str
    reference: str | None
    notes: str | None


class ProjectPurchaseOrderItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    po_number: str
    supplier_name: str
    amount_ugx: float
    status: str
    order_date: date


class ProjectExpenseItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    description: str
    category: str
    amount_ugx: float
    expense_date: date
    reference: str | None


class ProjectFinanceRead(msgspec.Struct, frozen=True):
    project_value_ugx: float
    amount_paid_ugx: float
    project_outstanding_ugx: float
    quotation_total_ugx: float
    invoice_total_ugx: float
    invoice_paid_ugx: float
    invoice_outstanding_ugx: float
    payment_total_ugx: float
    purchase_orders_ugx: float
    expenses_ugx: float
    quotations: list[ProjectQuotationItem]
    invoices: list[ProjectInvoiceItem]
    payments: list[ProjectPaymentItem]
    purchase_orders: list[ProjectPurchaseOrderItem]
    expenses: list[ProjectExpenseItem]


class ProjectActivityItem(msgspec.Struct, frozen=True):
    id: uuid.UUID
    table_name: str
    operation: str
    record_id: uuid.UUID
    title: str
    summary: str
    changed_by: str | None
    created_at: datetime


class ProjectWorkspaceRead(msgspec.Struct, frozen=True):
    project: ProjectRead
    tasks: list[TaskRead]
    documents: list[DocumentRead]
    finance: ProjectFinanceRead
    activity: list[ProjectActivityItem]


class WorkspaceSummary(msgspec.Struct, frozen=True):
    active_projects: int
    due_tasks: int
    pending_tasks: int
    documents: int
    outstanding_ugx: float
