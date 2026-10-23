from __future__ import annotations

import re
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, ClassVar

import structlog
from litestar import Controller, Request, Response, delete, get, patch, post, put
from litestar.exceptions import ClientException, NotFoundException
from litestar.status_codes import HTTP_200_OK, HTTP_201_CREATED
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.storage import (
    decode_local_key,
    encode_local_key,
    get_object_bytes_async,
    local_storage_ready,
    presign_download,
    presign_upload,
    put_object_bytes_async,
    storage_configured,
    storage_provider,
)
from app.domain.audit.models import AuditLog
from app.domain.business.models import (
    Client,
    Expense,
    Invoice,
    Payment,
    PurchaseOrder,
    Quotation,
    Supplier,
)
from app.domain.workspace.models import Document, Project, ProjectTask
from app.domain.workspace.schemas import (
    DocumentCreate,
    DocumentPresignRequest,
    DocumentPresignResponse,
    DocumentRead,
    DocumentUpdate,
    DownloadResponse,
    ProjectActivityItem,
    ProjectCreate,
    ProjectDashboardSummary,
    ProjectExpenseItem,
    ProjectFinanceRead,
    ProjectInvoiceItem,
    ProjectPaymentItem,
    ProjectPurchaseOrderItem,
    ProjectQuotationItem,
    ProjectRead,
    ProjectUpdate,
    ProjectWorkspaceRead,
    TaskCreate,
    TaskDashboardSummary,
    TaskRead,
    TaskUpdate,
    WorkspaceSummary,
)
from app.presentation.guards.auth_guard import JWTAuthGuard

logger = structlog.get_logger("app.workspace")


def _email(request: Request) -> str:
    email = str(request.scope.get("email") or "").strip().lower()
    if not email:
        raise ClientException(detail="Authenticated email is required.", status_code=401)
    return email


def _project_read(item: Project) -> ProjectRead:
    return ProjectRead(
        id=item.id,
        name=item.name,
        client_name=item.client_name,
        client_id=item.client_id,
        description=item.description,
        status=item.status,
        value_ugx=float(item.value_ugx or 0),
        amount_paid_ugx=float(item.amount_paid_ugx or 0),
        start_date=item.start_date,
        due_date=item.due_date,
        progress=item.progress,
        project_manager_email=item.project_manager_email,
        team_emails=list(item.team_emails or []),
        tags=list(item.tags or []),
        current_milestone=item.current_milestone,
        created_by_email=item.created_by_email,
        is_archived=item.is_archived,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _task_read(item: ProjectTask) -> TaskRead:
    return TaskRead(
        id=item.id,
        project_id=item.project_id,
        title=item.title,
        description=item.description,
        assignee_email=item.assignee_email,
        status=item.status,
        priority=item.priority,
        start_date=item.start_date,
        due_date=item.due_date,
        related_document_id=item.related_document_id,
        completed_at=item.completed_at,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _document_read(item: Document) -> DocumentRead:
    return DocumentRead(
        id=item.id,
        project_id=item.project_id,
        client_id=item.client_id,
        supplier_id=item.supplier_id,
        title=item.title,
        original_filename=item.original_filename,
        category=item.category,
        content_type=item.content_type,
        size_bytes=item.size_bytes,
        storage_key=item.storage_key,
        uploaded_by_email=item.uploaded_by_email,
        ocr_status=item.ocr_status,
        review_status=item.review_status,
        related_record_type=item.related_record_type,
        related_record_id=item.related_record_id,
        document_type=item.document_type,
        document_number=item.document_number,
        version=item.version,
        is_current=item.is_current,
        is_deleted=item.is_deleted,
        deleted_at=item.deleted_at,
        deleted_by_email=item.deleted_by_email,
        supersedes_document_id=item.supersedes_document_id,
        content_hash=item.content_hash,
        ocr_text=item.ocr_text,
        extracted_fields=dict(item.extracted_fields or {}),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _activity_title(item: AuditLog) -> str:
    payload = dict(item.new_data or item.old_data or {})
    key_by_table = {
        "projects": "name",
        "project_tasks": "title",
        "documents": "title",
        "quotations": "quotation_number",
        "invoices": "invoice_number",
        "payments": "reference",
        "purchase_orders": "po_number",
        "expenses": "description",
    }
    field = key_by_table.get(item.table_name)
    value = str(payload.get(field) or "").strip() if field else ""
    return value or item.table_name.replace("_", " ").title()


def _activity_summary(item: AuditLog) -> str:
    table_labels = {
        "projects": "Project",
        "project_tasks": "Task",
        "documents": "Document",
        "quotations": "Quotation",
        "invoices": "Invoice",
        "payments": "Payment",
        "purchase_orders": "Purchase order",
        "expenses": "Expense",
    }
    label = table_labels.get(item.table_name, item.table_name.replace("_", " ").title())
    title = _activity_title(item)
    operation = item.operation.upper()

    if operation == "INSERT":
        return f"{label} created: {title}"
    if operation == "DELETE":
        return f"{label} removed: {title}"

    old_data = dict(item.old_data or {})
    new_data = dict(item.new_data or {})
    changed: list[str] = []
    human_fields = {
        "status": "status",
        "progress": "progress",
        "project_manager_email": "manager",
        "current_milestone": "milestone",
        "amount_paid_ugx": "amount received",
        "review_status": "review status",
        "ocr_status": "OCR status",
        "assignee_email": "assignee",
        "priority": "priority",
    }
    for field, label_name in human_fields.items():
        if field in new_data and old_data.get(field) != new_data.get(field):
            before = old_data.get(field)
            after = new_data.get(field)
            if before in (None, ""):
                changed.append(f"{label_name} set to {after}")
            else:
                changed.append(f"{label_name} changed from {before} to {after}")

    if changed:
        return f"{label} updated: {title} — " + "; ".join(changed[:3])
    return f"{label} updated: {title}"


def _clean_emails(values: list[str] | None) -> list[str]:
    result: list[str] = []
    for value in values or []:
        email = value.strip().lower()
        if email and email not in result:
            result.append(email)
    return result


def _clean_tags(values: list[str] | None) -> list[str]:
    result: list[str] = []
    for value in values or []:
        tag = value.strip()
        if tag and tag.lower() not in {existing.lower() for existing in result}:
            result.append(tag)
    return result


class ProjectsController(Controller):
    path = "/projects"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    @get()
    async def list_projects(
        self,
        db_session: AsyncSession,
        q: str | None = None,
        include_archived: bool = False,
        status: str | None = None,
        client: str | None = None,
        manager: str | None = None,
        start_from: date | None = None,
        start_to: date | None = None,
        deadline_from: date | None = None,
        deadline_to: date | None = None,
        progress_min: int | None = None,
        progress_max: int | None = None,
        value_min: float | None = None,
        value_max: float | None = None,
        tag: str | None = None,
    ) -> list[ProjectRead]:
        stmt = select(Project).order_by(Project.updated_at.desc())
        if not include_archived:
            stmt = stmt.where(Project.is_archived.is_(False))
        if status:
            stmt = stmt.where(Project.status == status)
        if client:
            stmt = stmt.where(Project.client_name.ilike(f"%{client.strip()}%"))
        if manager:
            stmt = stmt.where(Project.project_manager_email.ilike(f"%{manager.strip()}%"))
        if start_from:
            stmt = stmt.where(Project.start_date >= start_from)
        if start_to:
            stmt = stmt.where(Project.start_date <= start_to)
        if deadline_from:
            stmt = stmt.where(Project.due_date >= deadline_from)
        if deadline_to:
            stmt = stmt.where(Project.due_date <= deadline_to)
        if progress_min is not None:
            stmt = stmt.where(Project.progress >= max(0, progress_min))
        if progress_max is not None:
            stmt = stmt.where(Project.progress <= min(100, progress_max))
        if value_min is not None:
            stmt = stmt.where(Project.value_ugx >= Decimal(str(max(0, value_min))))
        if value_max is not None:
            stmt = stmt.where(Project.value_ugx <= Decimal(str(max(0, value_max))))
        if tag:
            stmt = stmt.where(Project.tags.contains([tag.strip()]))
        if q:
            term = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    Project.name.ilike(term),
                    Project.client_name.ilike(term),
                    Project.description.ilike(term),
                    Project.current_milestone.ilike(term),
                )
            )
        rows = (await db_session.execute(stmt)).scalars().all()
        return [_project_read(row) for row in rows]

    @get(path="/dashboard")
    async def dashboard(self, db_session: AsyncSession) -> ProjectDashboardSummary:
        today = datetime.now(UTC).date()
        current = Project.is_archived.is_(False)
        unfinished = Project.status.notin_(["completed", "cancelled"])

        total_projects = int(
            (await db_session.scalar(select(func.count()).select_from(Project).where(current))) or 0
        )
        active_projects = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(Project)
                    .where(current, Project.status == "active")
                )
            )
            or 0
        )
        planning_projects = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(Project)
                    .where(current, Project.status == "planning")
                )
            )
            or 0
        )
        overdue_projects = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(Project)
                    .where(
                        current,
                        unfinished,
                        Project.due_date.is_not(None),
                        Project.due_date < today,
                    )
                )
            )
            or 0
        )
        completed_projects = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(Project)
                    .where(current, Project.status == "completed")
                )
            )
            or 0
        )
        total_value = await db_session.scalar(
            select(func.coalesce(func.sum(Project.value_ugx), 0)).where(current)
        )
        received = await db_session.scalar(
            select(func.coalesce(func.sum(Project.amount_paid_ugx), 0)).where(current)
        )
        outstanding = await db_session.scalar(
            select(
                func.coalesce(
                    func.sum(func.greatest(Project.value_ugx - Project.amount_paid_ugx, 0)),
                    0,
                )
            ).where(current)
        )
        tasks_due = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(ProjectTask)
                    .join(Project, Project.id == ProjectTask.project_id)
                    .where(
                        current,
                        ProjectTask.status != "completed",
                        ProjectTask.due_date.is_not(None),
                        ProjectTask.due_date <= today,
                    )
                )
            )
            or 0
        )
        attention = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(Project)
                    .where(
                        current,
                        unfinished,
                        or_(
                            and_(Project.due_date.is_not(None), Project.due_date < today),
                            Project.project_manager_email.is_(None),
                            and_(Project.progress < 25, Project.status == "active"),
                        ),
                    )
                )
            )
            or 0
        )

        return ProjectDashboardSummary(
            total_projects=total_projects,
            active_projects=active_projects,
            planning_projects=planning_projects,
            overdue_projects=overdue_projects,
            completed_projects=completed_projects,
            total_project_value_ugx=float(total_value or 0),
            amount_received_ugx=float(received or 0),
            outstanding_ugx=float(outstanding or 0),
            tasks_due=tasks_due,
            projects_needing_attention=attention,
        )

    @post(status_code=HTTP_201_CREATED)
    async def create_project(
        self,
        request: Request,
        data: ProjectCreate,
        db_session: AsyncSession,
    ) -> ProjectRead:
        client = await db_session.get(Client, data.client_id) if data.client_id else None
        if data.client_id and client is None:
            raise NotFoundException(detail="Client not found.")
        client_name = client.name if client else data.client_name.strip()
        if not data.name.strip() or not client_name:
            raise ClientException(detail="Project name and client are required.", status_code=400)
        progress = max(0, min(100, data.progress))
        item = Project(
            name=data.name.strip(),
            client_id=client.id if client else None,
            client_name=client_name,
            description=data.description,
            status=data.status,
            value_ugx=Decimal(str(max(0, data.value_ugx))),
            amount_paid_ugx=Decimal(str(max(0, data.amount_paid_ugx))),
            start_date=data.start_date,
            due_date=data.due_date,
            progress=progress,
            project_manager_email=_email(request),
            team_emails=_clean_emails(data.team_emails),
            tags=_clean_tags(data.tags),
            current_milestone=(
                data.current_milestone.strip()
                if data.current_milestone and data.current_milestone.strip()
                else None
            ),
            created_by_email=_email(request),
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)
        return _project_read(item)

    @get(path="/{project_id:uuid}")
    async def get_project(self, project_id: uuid.UUID, db_session: AsyncSession) -> ProjectRead:
        item = await db_session.get(Project, project_id)
        if item is None:
            raise NotFoundException(detail="Project not found.")
        return _project_read(item)

    @get(path="/{project_id:uuid}/workspace")
    async def get_project_workspace(
        self,
        project_id: uuid.UUID,
        db_session: AsyncSession,
    ) -> ProjectWorkspaceRead:
        project = await db_session.get(Project, project_id)
        if project is None:
            raise NotFoundException(detail="Project not found.")

        tasks = (
            (
                await db_session.execute(
                    select(ProjectTask)
                    .where(ProjectTask.project_id == project_id)
                    .order_by(ProjectTask.due_date.asc().nullslast(), ProjectTask.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        documents = (
            (
                await db_session.execute(
                    select(Document)
                    .where(Document.project_id == project_id, Document.is_deleted.is_(False))
                    .order_by(Document.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        quotations = (
            (
                await db_session.execute(
                    select(Quotation)
                    .where(Quotation.project_id == project_id)
                    .order_by(Quotation.issue_date.desc())
                )
            )
            .scalars()
            .all()
        )
        invoices = (
            (
                await db_session.execute(
                    select(Invoice)
                    .where(Invoice.project_id == project_id)
                    .order_by(Invoice.issue_date.desc())
                )
            )
            .scalars()
            .all()
        )
        payments = (
            (
                await db_session.execute(
                    select(Payment)
                    .where(Payment.project_id == project_id)
                    .order_by(Payment.payment_date.desc(), Payment.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        purchase_orders = (
            (
                await db_session.execute(
                    select(PurchaseOrder)
                    .where(PurchaseOrder.project_id == project_id)
                    .order_by(PurchaseOrder.order_date.desc())
                )
            )
            .scalars()
            .all()
        )
        expenses = (
            (
                await db_session.execute(
                    select(Expense)
                    .where(Expense.project_id == project_id)
                    .order_by(Expense.expense_date.desc())
                )
            )
            .scalars()
            .all()
        )

        project_key = str(project_id)

        def linked_project(table: str):
            return and_(
                AuditLog.table_name == table,
                or_(
                    AuditLog.new_data["project_id"].astext == project_key,
                    AuditLog.old_data["project_id"].astext == project_key,
                ),
            )

        activity_rows = (
            (
                await db_session.execute(
                    select(AuditLog)
                    .where(
                        or_(
                            and_(
                                AuditLog.table_name == "projects",
                                AuditLog.record_id == project_id,
                            ),
                            linked_project("project_tasks"),
                            linked_project("documents"),
                            linked_project("quotations"),
                            linked_project("invoices"),
                            linked_project("payments"),
                            linked_project("purchase_orders"),
                            linked_project("expenses"),
                        )
                    )
                    .order_by(AuditLog.created_at.desc())
                    .limit(60)
                )
            )
            .scalars()
            .all()
        )

        quotation_total = sum((row.amount_ugx or Decimal(0)) for row in quotations)
        invoice_total = sum((row.amount_ugx or Decimal(0)) for row in invoices)
        invoice_paid = sum((row.paid_amount_ugx or Decimal(0)) for row in invoices)
        payment_total = sum((row.amount_ugx or Decimal(0)) for row in payments)
        purchase_total = sum((row.amount_ugx or Decimal(0)) for row in purchase_orders)
        expense_total = sum((row.amount_ugx or Decimal(0)) for row in expenses)

        finance = ProjectFinanceRead(
            project_value_ugx=float(project.value_ugx or 0),
            amount_paid_ugx=float(project.amount_paid_ugx or 0),
            project_outstanding_ugx=float(
                max(Decimal(0), (project.value_ugx or 0) - (project.amount_paid_ugx or 0))
            ),
            quotation_total_ugx=float(quotation_total),
            invoice_total_ugx=float(invoice_total),
            invoice_paid_ugx=float(invoice_paid),
            invoice_outstanding_ugx=float(max(Decimal(0), invoice_total - invoice_paid)),
            payment_total_ugx=float(payment_total),
            purchase_orders_ugx=float(purchase_total),
            expenses_ugx=float(expense_total),
            quotations=[
                ProjectQuotationItem(
                    id=row.id,
                    quotation_number=row.quotation_number,
                    amount_ugx=float(row.amount_ugx or 0),
                    status=row.status,
                    issue_date=row.issue_date,
                )
                for row in quotations
            ],
            invoices=[
                ProjectInvoiceItem(
                    id=row.id,
                    invoice_number=row.invoice_number,
                    amount_ugx=float(row.amount_ugx or 0),
                    paid_amount_ugx=float(row.paid_amount_ugx or 0),
                    status=row.status,
                    issue_date=row.issue_date,
                    due_date=row.due_date,
                )
                for row in invoices
            ],
            payments=[
                ProjectPaymentItem(
                    id=row.id,
                    invoice_id=row.invoice_id,
                    amount_ugx=float(row.amount_ugx or 0),
                    payment_date=row.payment_date,
                    method=row.method,
                    reference=row.reference,
                    notes=row.notes,
                )
                for row in payments
            ],
            purchase_orders=[
                ProjectPurchaseOrderItem(
                    id=row.id,
                    po_number=row.po_number,
                    supplier_name=row.supplier_name,
                    amount_ugx=float(row.amount_ugx or 0),
                    status=row.status,
                    order_date=row.order_date,
                )
                for row in purchase_orders
            ],
            expenses=[
                ProjectExpenseItem(
                    id=row.id,
                    description=row.description,
                    category=row.category,
                    amount_ugx=float(row.amount_ugx or 0),
                    expense_date=row.expense_date,
                    reference=row.reference,
                )
                for row in expenses
            ],
        )

        return ProjectWorkspaceRead(
            project=_project_read(project),
            tasks=[_task_read(row) for row in tasks],
            documents=[_document_read(row) for row in documents],
            finance=finance,
            activity=[
                ProjectActivityItem(
                    id=row.id,
                    table_name=row.table_name,
                    operation=row.operation,
                    record_id=row.record_id,
                    title=_activity_title(row),
                    summary=_activity_summary(row),
                    changed_by=row.changed_by,
                    created_at=row.created_at,
                )
                for row in activity_rows
            ],
        )

    @patch(path="/{project_id:uuid}")
    async def update_project(
        self,
        project_id: uuid.UUID,
        data: ProjectUpdate,
        db_session: AsyncSession,
    ) -> ProjectRead:
        item = await db_session.get(Project, project_id)
        if item is None:
            raise NotFoundException(detail="Project not found.")
        if data.client_id is not None:
            client = await db_session.get(Client, data.client_id)
            if client is None:
                raise NotFoundException(detail="Client not found.")
            item.client_id = client.id
            item.client_name = client.name
        for field in (
            "name",
            "client_name",
            "description",
            "status",
            "start_date",
            "due_date",
            "is_archived",
        ):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value)
        if data.project_manager_email is not None:
            item.project_manager_email = data.project_manager_email.strip().lower() or None
        if data.team_emails is not None:
            item.team_emails = _clean_emails(data.team_emails)
        if data.tags is not None:
            item.tags = _clean_tags(data.tags)
        if data.current_milestone is not None:
            item.current_milestone = data.current_milestone.strip() or None
        if data.progress is not None:
            item.progress = max(0, min(100, data.progress))
        if data.value_ugx is not None:
            item.value_ugx = Decimal(str(max(0, data.value_ugx)))
        if data.amount_paid_ugx is not None:
            item.amount_paid_ugx = Decimal(str(max(0, data.amount_paid_ugx)))
        await db_session.commit()
        await db_session.refresh(item)
        return _project_read(item)

    @delete(path="/{project_id:uuid}", status_code=HTTP_200_OK)
    async def archive_project(self, project_id: uuid.UUID, db_session: AsyncSession) -> dict:
        item = await db_session.get(Project, project_id)
        if item is None:
            raise NotFoundException(detail="Project not found.")
        item.is_archived = True
        await db_session.commit()
        return {"message": "Project archived."}

    @post(path="/{project_id:uuid}/restore", status_code=HTTP_200_OK)
    async def restore_project(self, project_id: uuid.UUID, db_session: AsyncSession) -> ProjectRead:
        item = await db_session.get(Project, project_id)
        if item is None:
            raise NotFoundException(detail="Project not found.")
        item.is_archived = False
        await db_session.commit()
        await db_session.refresh(item)
        return _project_read(item)

    @post(path="/{project_id:uuid}/duplicate", status_code=HTTP_201_CREATED)
    async def duplicate_project(
        self,
        request: Request,
        project_id: uuid.UUID,
        db_session: AsyncSession,
    ) -> ProjectRead:
        source = await db_session.get(Project, project_id)
        if source is None:
            raise NotFoundException(detail="Project not found.")

        item = Project(
            name=f"{source.name} — Copy",
            client_id=source.client_id,
            client_name=source.client_name,
            description=source.description,
            status="planning",
            value_ugx=source.value_ugx,
            amount_paid_ugx=Decimal(),
            start_date=None,
            due_date=source.due_date,
            progress=0,
            project_manager_email=source.project_manager_email,
            team_emails=list(source.team_emails or []),
            tags=list(source.tags or []),
            current_milestone=None,
            created_by_email=_email(request),
            is_archived=False,
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)
        return _project_read(item)


class TasksController(Controller):
    path = "/tasks"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    _statuses: ClassVar[set[str]] = {"todo", "in_progress", "review", "completed"}
    _priorities: ClassVar[set[str]] = {"low", "normal", "high", "urgent"}

    @staticmethod
    def _status(value: str) -> str:
        normalized = "todo" if value == "pending" else value.strip().lower()
        if normalized not in TasksController._statuses:
            raise ClientException(detail="Invalid task status.", status_code=400)
        return normalized

    @staticmethod
    def _priority(value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in TasksController._priorities:
            raise ClientException(detail="Invalid task priority.", status_code=400)
        return normalized

    @staticmethod
    async def _project(db_session: AsyncSession, project_id: uuid.UUID) -> Project:
        project = await db_session.get(Project, project_id)
        if project is None:
            raise NotFoundException(detail="Project not found.")
        if project.is_archived:
            raise ClientException(
                detail="Tasks cannot be added to an archived project.", status_code=400
            )
        return project

    @staticmethod
    async def _document(
        db_session: AsyncSession,
        document_id: uuid.UUID | None,
        project_id: uuid.UUID,
    ) -> Document | None:
        if document_id is None:
            return None
        document = await db_session.get(Document, document_id)
        if document is None:
            raise NotFoundException(detail="Related document not found.")
        if document.project_id is not None and document.project_id != project_id:
            raise ClientException(
                detail="Related document belongs to a different project.",
                status_code=400,
            )
        return document

    @get(path="/dashboard")
    async def dashboard(self, request: Request, db_session: AsyncSession) -> TaskDashboardSummary:
        today = datetime.now(UTC).date()
        recent_cutoff = datetime.now(UTC) - timedelta(days=7)
        active_project = Project.is_archived.is_(False)
        open_task = ProjectTask.status != "completed"
        mine = ProjectTask.assignee_email == _email(request)

        async def count(*conditions: Any) -> int:
            value = await db_session.scalar(
                select(func.count())
                .select_from(ProjectTask)
                .join(Project, Project.id == ProjectTask.project_id)
                .where(active_project, *conditions)
            )
            return int(value or 0)

        return TaskDashboardSummary(
            due_today=await count(open_task, ProjectTask.due_date == today),
            overdue=await count(
                open_task,
                ProjectTask.due_date.is_not(None),
                ProjectTask.due_date < today,
            ),
            high_priority=await count(
                open_task,
                ProjectTask.priority.in_(["high", "urgent"]),
            ),
            assigned_to_me=await count(open_task, mine),
            recently_completed=await count(
                ProjectTask.status == "completed",
                ProjectTask.completed_at.is_not(None),
                ProjectTask.completed_at >= recent_cutoff,
            ),
        )

    @get()
    async def list_tasks(
        self,
        request: Request,
        db_session: AsyncSession,
        project_id: uuid.UUID | None = None,
        status: str | None = None,
        priority: str | None = None,
        assignee: str | None = None,
        mine: bool = False,
        q: str | None = None,
        start_from: date | None = None,
        start_to: date | None = None,
        due_from: date | None = None,
        due_to: date | None = None,
        include_archived_projects: bool = False,
    ) -> list[TaskRead]:
        stmt = (
            select(ProjectTask)
            .join(Project, Project.id == ProjectTask.project_id)
            .order_by(ProjectTask.due_date.asc().nullslast(), ProjectTask.created_at.desc())
        )
        if not include_archived_projects:
            stmt = stmt.where(Project.is_archived.is_(False))
        if project_id:
            stmt = stmt.where(ProjectTask.project_id == project_id)
        if status:
            stmt = stmt.where(ProjectTask.status == self._status(status))
        if priority:
            stmt = stmt.where(ProjectTask.priority == self._priority(priority))
        if mine:
            stmt = stmt.where(ProjectTask.assignee_email == _email(request))
        elif assignee:
            stmt = stmt.where(ProjectTask.assignee_email == assignee.strip().lower())
        if start_from:
            stmt = stmt.where(ProjectTask.start_date >= start_from)
        if start_to:
            stmt = stmt.where(ProjectTask.start_date <= start_to)
        if due_from:
            stmt = stmt.where(ProjectTask.due_date >= due_from)
        if due_to:
            stmt = stmt.where(ProjectTask.due_date <= due_to)
        if q:
            term = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    ProjectTask.title.ilike(term),
                    ProjectTask.description.ilike(term),
                    ProjectTask.assignee_email.ilike(term),
                    Project.name.ilike(term),
                )
            )
        rows = (await db_session.execute(stmt)).scalars().all()
        return [_task_read(row) for row in rows]

    @post(status_code=HTTP_201_CREATED)
    async def create_task(self, data: TaskCreate, db_session: AsyncSession) -> TaskRead:
        project = await self._project(db_session, data.project_id)
        title = data.title.strip()
        if not title:
            raise ClientException(detail="Task title is required.", status_code=400)
        status = self._status(data.status)
        priority = self._priority(data.priority)
        if data.start_date and data.due_date and data.start_date > data.due_date:
            raise ClientException(
                detail="Task start date cannot be after the due date.", status_code=400
            )
        await self._document(db_session, data.related_document_id, project.id)

        item = ProjectTask(
            project_id=project.id,
            title=title,
            description=data.description,
            assignee_email=(data.assignee_email or "").strip().lower() or None,
            status=status,
            priority=priority,
            start_date=data.start_date,
            due_date=data.due_date,
            related_document_id=data.related_document_id,
            completed_at=datetime.now(UTC) if status == "completed" else None,
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)
        return _task_read(item)

    @patch(path="/{task_id:uuid}")
    async def update_task(
        self,
        task_id: uuid.UUID,
        data: TaskUpdate,
        db_session: AsyncSession,
    ) -> TaskRead:
        item = await db_session.get(ProjectTask, task_id)
        if item is None:
            raise NotFoundException(detail="Task not found.")

        target_project_id = data.project_id or item.project_id
        await self._project(db_session, target_project_id)

        if data.title is not None:
            title = data.title.strip()
            if not title:
                raise ClientException(detail="Task title is required.", status_code=400)
            item.title = title
        if data.description is not None:
            item.description = data.description.strip() or None
        if data.assignee_email is not None:
            item.assignee_email = data.assignee_email.strip().lower() or None
        if data.priority is not None:
            item.priority = self._priority(data.priority)
        if data.project_id is not None:
            item.project_id = data.project_id

        if data.clear_start_date:
            item.start_date = None
        elif data.start_date is not None:
            item.start_date = data.start_date
        if data.clear_due_date:
            item.due_date = None
        elif data.due_date is not None:
            item.due_date = data.due_date

        target_document_id = item.related_document_id
        if data.clear_related_document:
            target_document_id = None
        elif data.related_document_id is not None:
            target_document_id = data.related_document_id
        await self._document(db_session, target_document_id, item.project_id)
        item.related_document_id = target_document_id

        if item.start_date and item.due_date and item.start_date > item.due_date:
            raise ClientException(
                detail="Task start date cannot be after the due date.", status_code=400
            )

        if data.status is not None:
            next_status = self._status(data.status)
            if next_status == "completed" and item.status != "completed":
                item.completed_at = datetime.now(UTC)
            elif next_status != "completed":
                item.completed_at = None
            item.status = next_status

        await db_session.commit()
        await db_session.refresh(item)
        return _task_read(item)

    @delete(path="/{task_id:uuid}", status_code=HTTP_200_OK)
    async def delete_task(self, task_id: uuid.UUID, db_session: AsyncSession) -> dict:
        item = await db_session.get(ProjectTask, task_id)
        if item is None:
            raise NotFoundException(detail="Task not found.")
        await db_session.delete(item)
        await db_session.commit()
        return {"message": "Task deleted."}


class DocumentsController(Controller):
    path = "/documents"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    @get()
    async def list_documents(
        self,
        db_session: AsyncSession,
        project_id: uuid.UUID | None = None,
        client_id: uuid.UUID | None = None,
        supplier_id: uuid.UUID | None = None,
        q: str | None = None,
    ) -> list[DocumentRead]:
        stmt = (
            select(Document)
            .where(Document.is_deleted.is_(False))
            .order_by(Document.created_at.desc())
        )
        if project_id:
            stmt = stmt.where(Document.project_id == project_id)
        if client_id:
            stmt = stmt.where(Document.client_id == client_id)
        if supplier_id:
            stmt = stmt.where(Document.supplier_id == supplier_id)
        if q:
            term = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    Document.title.ilike(term),
                    Document.original_filename.ilike(term),
                    Document.ocr_text.ilike(term),
                )
            )
        rows = (await db_session.execute(stmt)).scalars().all()
        return [_document_read(row) for row in rows]

    @get(path="/storage-status")
    async def document_storage_status(self) -> dict[str, object]:
        local_ready = local_storage_ready()
        return {
            "configured": storage_configured() or local_ready,
            "provider": storage_provider()
            if storage_configured() or local_ready
            else "Unavailable",
            "primary": storage_configured(),
            "fallback": local_ready,
        }

    @post(path="/presign")
    async def create_upload_url(
        self,
        request: Request,
        data: DocumentPresignRequest,
    ) -> DocumentPresignResponse:
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", data.filename).strip("-") or "document"
        owner = re.sub(r"[^A-Za-z0-9._-]+", "-", _email(request))
        project_part = str(data.project_id) if data.project_id else "general"
        if storage_configured():
            storage_key = f"documents/{project_part}/{owner}/{uuid.uuid4()}-{safe_name}"
            upload_url = presign_upload(storage_key, data.content_type)
        elif local_storage_ready():
            storage_key = f"documents/local/{project_part}/{owner}/{uuid.uuid4()}-{safe_name}"
            upload_url = f"/api/v1/documents/local-upload/{encode_local_key(storage_key)}"
        else:
            raise ClientException(detail="Document storage is unavailable.", status_code=503)
        return DocumentPresignResponse(upload_url=upload_url, storage_key=storage_key)

    @put(path="/local-upload/{token:str}", status_code=HTTP_200_OK)
    async def upload_local_document(
        self,
        token: str,
        request: Request,
    ) -> dict[str, object]:
        try:
            storage_key = decode_local_key(token)
        except (ValueError, UnicodeDecodeError) as exc:
            raise ClientException(detail="Invalid upload target.", status_code=400) from exc
        content = await request.body()
        if not content:
            raise ClientException(detail="The uploaded file is empty.", status_code=400)
        await put_object_bytes_async(
            storage_key,
            content,
            request.headers.get("content-type", "application/octet-stream"),
        )
        return {"ok": True, "size_bytes": len(content)}

    @post(status_code=HTTP_201_CREATED)
    async def create_document(
        self,
        request: Request,
        data: DocumentCreate,
        db_session: AsyncSession,
    ) -> DocumentRead:
        project = await db_session.get(Project, data.project_id) if data.project_id else None
        if data.project_id and project is None:
            raise NotFoundException(detail="Project not found.")
        if data.client_id and await db_session.get(Client, data.client_id) is None:
            raise NotFoundException(detail="Client not found.")
        if data.supplier_id and await db_session.get(Supplier, data.supplier_id) is None:
            raise NotFoundException(detail="Supplier not found.")
        if project and data.client_id and project.client_id and project.client_id != data.client_id:
            raise ClientException(
                detail="Document client does not match project client.", status_code=409
            )
        if not data.storage_key.startswith("documents/"):
            raise ClientException(detail="Invalid document storage key.", status_code=400)
        item = Document(
            project_id=data.project_id,
            client_id=data.client_id or (project.client_id if project else None),
            supplier_id=data.supplier_id,
            title=data.title.strip() or data.original_filename,
            original_filename=data.original_filename,
            category=data.category,
            content_type=data.content_type,
            size_bytes=max(0, data.size_bytes),
            storage_key=data.storage_key,
            uploaded_by_email=_email(request),
            ocr_status=data.ocr_status,
            review_status=data.review_status,
            related_record_type=data.related_record_type,
            related_record_id=data.related_record_id,
            ocr_text=data.ocr_text,
            extracted_fields=data.extracted_fields,
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)
        return _document_read(item)

    @patch(path="/{document_id:uuid}")
    async def update_document(
        self,
        document_id: uuid.UUID,
        data: DocumentUpdate,
        db_session: AsyncSession,
    ) -> DocumentRead:
        item = await db_session.get(Document, document_id)
        if item is None:
            raise NotFoundException(detail="Document not found.")
        if data.client_id is not None and await db_session.get(Client, data.client_id) is None:
            raise NotFoundException(detail="Client not found.")
        if (
            data.supplier_id is not None
            and await db_session.get(Supplier, data.supplier_id) is None
        ):
            raise NotFoundException(detail="Supplier not found.")
        if data.project_id is not None and await db_session.get(Project, data.project_id) is None:
            raise NotFoundException(detail="Project not found.")
        for field in (
            "title",
            "category",
            "project_id",
            "client_id",
            "supplier_id",
            "ocr_status",
            "review_status",
            "ocr_text",
            "extracted_fields",
        ):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value)

        if data.related_record_type is not None:
            related_type = data.related_record_type.strip()
            if not related_type:
                item.related_record_type = None
                item.related_record_id = None
            else:
                item.related_record_type = related_type
                if data.related_record_id is not None:
                    item.related_record_id = data.related_record_id
        elif data.related_record_id is not None:
            item.related_record_id = data.related_record_id

        await db_session.commit()
        await db_session.refresh(item)
        return _document_read(item)

    @get(path="/{document_id:uuid}/content")
    async def get_document_content(
        self,
        document_id: uuid.UUID,
        db_session: AsyncSession,
    ) -> Response[bytes]:
        item = await db_session.get(Document, document_id)
        if item is None or item.is_deleted:
            raise NotFoundException(detail="Document not found.")
        try:
            content = await get_object_bytes_async(item.storage_key)
        except (FileNotFoundError, ClientException) as exc:
            raise NotFoundException(detail="Stored document file was not found.") from exc
        return Response(
            content=content,
            media_type=item.content_type or "application/octet-stream",
            headers={"Content-Disposition": f'inline; filename="{item.original_filename}"'},
        )

    @get(path="/{document_id:uuid}/download")
    async def get_download_url(
        self,
        document_id: uuid.UUID,
        db_session: AsyncSession,
    ) -> DownloadResponse:
        item = await db_session.get(Document, document_id)
        if item is None or item.is_deleted:
            raise NotFoundException(detail="Document not found.")
        if item.storage_key.startswith("documents/local/"):
            return DownloadResponse(url=f"/api/v1/documents/{document_id}/content")
        return DownloadResponse(url=presign_download(item.storage_key))

    @delete(path="/{document_id:uuid}", status_code=HTTP_200_OK)
    async def delete_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> dict:
        item = await db_session.get(Document, document_id)
        if item is None or item.is_deleted:
            raise NotFoundException(detail="Document not found.")
        item.is_deleted = True
        item.is_current = False
        item.deleted_at = datetime.now(UTC)
        item.deleted_by_email = _email(request)
        await db_session.commit()
        return {"message": "Document moved out of active use and retained for recovery/audit."}


class WorkspaceController(Controller):
    path = "/workspace"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    @get(path="/summary")
    async def summary(self, db_session: AsyncSession) -> WorkspaceSummary:
        today = datetime.now(UTC).date()
        active_projects = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(Project)
                    .where(
                        Project.is_archived.is_(False),
                        Project.status.notin_(["completed", "cancelled"]),
                    )
                )
            )
            or 0
        )
        due_tasks = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(ProjectTask)
                    .where(
                        Project.status.notin_(["completed", "cancelled"]),
                        ProjectTask.status != "completed",
                        ProjectTask.due_date.is_not(None),
                        ProjectTask.due_date <= today,
                    )
                    .join(Project, Project.id == ProjectTask.project_id)
                )
            )
            or 0
        )
        pending_tasks = int(
            (
                await db_session.scalar(
                    select(func.count())
                    .select_from(ProjectTask)
                    .where(ProjectTask.status != "completed")
                )
            )
            or 0
        )
        documents = int((await db_session.scalar(select(func.count()).select_from(Document))) or 0)
        outstanding = await db_session.scalar(
            select(func.coalesce(func.sum(Project.value_ugx - Project.amount_paid_ugx), 0)).where(
                Project.is_archived.is_(False)
            )
        )
        return WorkspaceSummary(
            active_projects=active_projects,
            due_tasks=due_tasks,
            pending_tasks=pending_tasks,
            documents=documents,
            outstanding_ugx=float(outstanding or 0),
        )
