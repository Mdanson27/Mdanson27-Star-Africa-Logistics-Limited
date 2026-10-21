from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, ClassVar

from litestar import Controller, Request, get, patch, post
from litestar.exceptions import ClientException, NotFoundException
from litestar.status_codes import HTTP_201_CREATED
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.business.models import (
    BusinessDocumentEvent,
    Client,
    Expense,
    Invoice,
    InvoiceLineItem,
    Payment,
    PurchaseOrder,
    PurchaseOrderLineItem,
    Quotation,
    QuotationLineItem,
    Supplier,
)
from app.domain.business.schemas import (
    ActivityItem,
    BusinessSummary,
    ClientCreate,
    ClientRead,
    ClientStatementSummary,
    ClientUpdate,
    ClientWorkspace,
    ExpenseCreate,
    ExpenseRead,
    InvoiceCreate,
    InvoiceRead,
    InvoiceUpdate,
    PartyDocumentItem,
    PartyProjectItem,
    PaymentCreate,
    PaymentRead,
    PurchaseOrderCreate,
    PurchaseOrderRead,
    PurchaseOrderUpdate,
    QuotationCreate,
    QuotationRead,
    QuotationUpdate,
    ReceiptRead,
    StatementEntry,
    SupplierCreate,
    SupplierRead,
    SupplierStatementSummary,
    SupplierUpdate,
    SupplierWorkspace,
)
from app.domain.business.services import (
    current_document_has_action,
    current_generated_document,
    invalidate_current_generated_document,
    next_business_number,
    normalize_line_items,
    record_document_event,
    replace_line_items,
    require_current_preview,
    require_current_reviewed_version,
)
from app.domain.reporting.services import (
    sync_expense_ledger,
    sync_invoice_ledger,
    sync_payment_ledger,
)
from app.domain.workspace.models import Document, Project
from app.presentation.guards.auth_guard import JWTAuthGuard

QUOTATION_STATUSES = {"draft", "sent", "accepted", "rejected", "expired"}
INVOICE_STATUSES = {"draft", "sent", "partially_paid", "paid", "overdue"}
PO_STATUSES = {"draft", "issued", "received", "closed"}
QUOTATION_TRANSITIONS = {
    "draft": {"draft", "sent", "accepted"},
    "sent": {"sent", "accepted", "rejected", "expired"},
    "accepted": {"accepted"},
    "rejected": {"rejected"},
    "expired": {"expired"},
}
INVOICE_TRANSITIONS = {
    "draft": {"draft", "sent"},
    "sent": {"sent", "overdue"},
    "partially_paid": {"partially_paid", "overdue"},
    "overdue": {"overdue"},
    "paid": {"paid"},
}
PO_TRANSITIONS = {
    "draft": {"draft", "issued"},
    "issued": {"issued", "received"},
    "received": {"received", "closed"},
    "closed": {"closed"},
}


def _email(request: Request) -> str:
    email = str(request.scope.get("email") or "").strip().lower()
    if not email:
        raise ClientException(detail="Authenticated email is required.", status_code=401)
    return email


def _status(value: str, allowed: set[str], label: str) -> str:
    normalized = value.strip().lower().replace(" ", "_")
    if normalized == "partial" and label == "Invoice":
        normalized = "partially_paid"
    if normalized not in allowed:
        raise ClientException(
            detail=f"Invalid {label.lower()} status. Allowed: {', '.join(sorted(allowed))}.",
            status_code=400,
        )
    return normalized


def _transition(current: str, requested: str, transitions: dict[str, set[str]], label: str) -> str:
    target = requested.strip().lower().replace(" ", "_")
    allowed = transitions.get(current, {current})
    if target not in allowed:
        raise ClientException(
            detail=f"Invalid {label.lower()} workflow transition: {current} ? {target}.",
            status_code=409,
        )
    return target


def _client_read(item: Client) -> ClientRead:
    return ClientRead(
        id=item.id,
        name=item.name,
        contact_person=item.contact_person,
        phone=item.phone,
        email=item.email,
        address=item.address,
        notes=item.notes,
        is_active=item.is_active,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _supplier_read(item: Supplier) -> SupplierRead:
    return SupplierRead(
        id=item.id,
        name=item.name,
        contact_person=item.contact_person,
        phone=item.phone,
        email=item.email,
        address=item.address,
        notes=item.notes,
        is_active=item.is_active,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _quotation_read(item: Quotation, *, has_current_preview: bool = False) -> QuotationRead:
    return QuotationRead(
        id=item.id,
        quotation_number=item.quotation_number,
        client_id=item.client_id,
        project_id=item.project_id,
        client_name=item.client_name,
        amount_ugx=float(item.amount_ugx or 0),
        status=item.status,
        issue_date=item.issue_date,
        valid_until=item.valid_until,
        notes=item.notes,
        created_at=item.created_at,
        updated_at=item.updated_at,
        has_current_preview=has_current_preview,
    )


def _effective_invoice_status(item: Invoice) -> str:
    amount = item.amount_ugx or Decimal()
    paid = item.paid_amount_ugx or Decimal()
    if amount > 0 and paid >= amount:
        return "paid"
    if paid > 0:
        return (
            "overdue"
            if item.due_date and item.due_date < datetime.now(UTC).date()
            else "partially_paid"
        )
    if item.status != "draft" and item.due_date and item.due_date < datetime.now(UTC).date():
        return "overdue"
    return "partially_paid" if item.status == "partial" else item.status


def _invoice_read(item: Invoice) -> InvoiceRead:
    amount = item.amount_ugx or Decimal()
    paid = item.paid_amount_ugx or Decimal()
    return InvoiceRead(
        id=item.id,
        invoice_number=item.invoice_number,
        client_id=item.client_id,
        project_id=item.project_id,
        client_name=item.client_name,
        amount_ugx=float(amount),
        paid_amount_ugx=float(paid),
        outstanding_amount_ugx=float(max(Decimal(), amount - paid)),
        status=_effective_invoice_status(item),
        issue_date=item.issue_date,
        due_date=item.due_date,
        notes=item.notes,
        created_at=item.created_at,
        updated_at=item.updated_at,
        source_quotation_id=item.source_quotation_id,
    )


def _payment_read(item: Payment) -> PaymentRead:
    return PaymentRead(
        id=item.id,
        receipt_number=item.receipt_number,
        client_id=item.client_id,
        project_id=item.project_id,
        invoice_id=item.invoice_id,
        amount_ugx=float(item.amount_ugx or 0),
        payment_date=item.payment_date,
        method=item.method,
        reference=item.reference,
        notes=item.notes,
        recorded_by_email=item.recorded_by_email,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _po_read(item: PurchaseOrder) -> PurchaseOrderRead:
    return PurchaseOrderRead(
        id=item.id,
        po_number=item.po_number,
        supplier_id=item.supplier_id,
        project_id=item.project_id,
        supplier_name=item.supplier_name,
        amount_ugx=float(item.amount_ugx or 0),
        status=item.status,
        order_date=item.order_date,
        expected_date=item.expected_date,
        notes=item.notes,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _expense_read(item: Expense) -> ExpenseRead:
    return ExpenseRead(
        id=item.id,
        project_id=item.project_id,
        supplier_id=item.supplier_id,
        supporting_document_id=item.supporting_document_id,
        category=item.category,
        description=item.description,
        amount_ugx=float(item.amount_ugx or 0),
        expense_date=item.expense_date,
        reference=item.reference,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _project_item(item: Project) -> PartyProjectItem:
    return PartyProjectItem(
        id=item.id,
        name=item.name,
        status=item.status,
        value_ugx=float(item.value_ugx or 0),
        amount_paid_ugx=float(item.amount_paid_ugx or 0),
        progress=item.progress,
        due_date=item.due_date,
    )


def _document_item(item: Document) -> PartyDocumentItem:
    return PartyDocumentItem(
        id=item.id,
        project_id=item.project_id,
        title=item.title,
        original_filename=item.original_filename,
        category=item.category,
        created_at=item.created_at,
    )


class BusinessController(Controller):
    path = "/business"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    async def _client_and_project(
        self,
        db_session: AsyncSession,
        client_id: uuid.UUID | None,
        project_id: uuid.UUID | None,
        client_name: str,
    ) -> tuple[Client | None, Project | None, str, uuid.UUID | None]:
        client = await db_session.get(Client, client_id) if client_id else None
        if client_id and client is None:
            raise NotFoundException(detail="Client not found.")
        project = await db_session.get(Project, project_id) if project_id else None
        if project_id and project is None:
            raise NotFoundException(detail="Project not found.")
        resolved_client_id = client_id
        if project and project.client_id:
            if resolved_client_id and resolved_client_id != project.client_id:
                raise ClientException(
                    detail="Project belongs to a different client.", status_code=409
                )
            resolved_client_id = project.client_id
            if client is None:
                client = await db_session.get(Client, project.client_id)
        resolved_name = client.name if client else client_name.strip()
        if not resolved_name:
            raise ClientException(detail="Client is required.", status_code=400)
        return client, project, resolved_name, resolved_client_id

    @get(path="/clients")
    async def clients(
        self, db_session: AsyncSession, include_inactive: bool = False
    ) -> list[ClientRead]:
        stmt = select(Client).order_by(Client.name)
        if not include_inactive:
            stmt = stmt.where(Client.is_active.is_(True))
        rows = (await db_session.execute(stmt)).scalars().all()
        return [_client_read(row) for row in rows]

    @post(path="/clients", status_code=HTTP_201_CREATED)
    async def create_client(self, data: ClientCreate, db_session: AsyncSession) -> ClientRead:
        if not data.name.strip():
            raise ClientException(detail="Client name is required.", status_code=400)
        item = Client(
            name=data.name.strip(),
            contact_person=data.contact_person,
            phone=data.phone,
            email=(data.email or "").strip().lower() or None,
            address=data.address,
            notes=data.notes,
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)
        return _client_read(item)

    @patch(path="/clients/{client_id:uuid}")
    async def update_client(
        self, client_id: uuid.UUID, data: ClientUpdate, db_session: AsyncSession
    ) -> ClientRead:
        item = await db_session.get(Client, client_id)
        if item is None:
            raise NotFoundException(detail="Client not found.")
        for field in ("contact_person", "phone", "address", "notes", "is_active"):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value)
        if data.name is not None:
            if not data.name.strip():
                raise ClientException(detail="Client name cannot be blank.", status_code=400)
            item.name = data.name.strip()
        if data.email is not None:
            item.email = data.email.strip().lower() or None
        await db_session.commit()
        await db_session.refresh(item)
        return _client_read(item)

    @get(path="/suppliers")
    async def suppliers(
        self, db_session: AsyncSession, include_inactive: bool = False
    ) -> list[SupplierRead]:
        stmt = select(Supplier).order_by(Supplier.name)
        if not include_inactive:
            stmt = stmt.where(Supplier.is_active.is_(True))
        rows = (await db_session.execute(stmt)).scalars().all()
        return [_supplier_read(row) for row in rows]

    @post(path="/suppliers", status_code=HTTP_201_CREATED)
    async def create_supplier(self, data: SupplierCreate, db_session: AsyncSession) -> SupplierRead:
        if not data.name.strip():
            raise ClientException(detail="Supplier name is required.", status_code=400)
        item = Supplier(
            name=data.name.strip(),
            contact_person=data.contact_person,
            phone=data.phone,
            email=(data.email or "").strip().lower() or None,
            address=data.address,
            notes=data.notes,
        )
        db_session.add(item)
        await db_session.commit()
        await db_session.refresh(item)
        return _supplier_read(item)

    @patch(path="/suppliers/{supplier_id:uuid}")
    async def update_supplier(
        self, supplier_id: uuid.UUID, data: SupplierUpdate, db_session: AsyncSession
    ) -> SupplierRead:
        item = await db_session.get(Supplier, supplier_id)
        if item is None:
            raise NotFoundException(detail="Supplier not found.")
        for field in ("contact_person", "phone", "address", "notes", "is_active"):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value)
        if data.name is not None:
            if not data.name.strip():
                raise ClientException(detail="Supplier name cannot be blank.", status_code=400)
            item.name = data.name.strip()
        if data.email is not None:
            item.email = data.email.strip().lower() or None
        await db_session.commit()
        await db_session.refresh(item)
        return _supplier_read(item)

    @get(path="/quotations")
    async def quotations(
        self,
        db_session: AsyncSession,
        client_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
    ) -> list[QuotationRead]:
        stmt = select(Quotation).order_by(Quotation.created_at.desc())
        if client_id:
            stmt = stmt.where(Quotation.client_id == client_id)
        if project_id:
            stmt = stmt.where(Quotation.project_id == project_id)
        rows = list((await db_session.execute(stmt)).scalars().all())
        previewed_ids = set(
            (
                await db_session.execute(
                    select(Document.related_record_id)
                    .join(
                        BusinessDocumentEvent,
                        BusinessDocumentEvent.document_id == Document.id,
                    )
                    .where(
                        Document.category == "generated_commercial",
                        Document.related_record_type == "quotation",
                        Document.is_current.is_(True),
                        Document.is_deleted.is_(False),
                        BusinessDocumentEvent.action == "previewed",
                        Document.related_record_id.is_not(None),
                    )
                    .distinct()
                )
            )
            .scalars()
            .all()
        )
        return [_quotation_read(row, has_current_preview=row.id in previewed_ids) for row in rows]

    @post(path="/quotations", status_code=HTTP_201_CREATED)
    async def create_quotation(
        self, request: Request, data: QuotationCreate, db_session: AsyncSession
    ) -> QuotationRead:
        _, _, client_name, client_id = await self._client_and_project(
            db_session, data.client_id, data.project_id, data.client_name
        )
        try:
            lines, total = normalize_line_items(
                data.items,
                fallback_amount=data.amount_ugx,
                fallback_description="Commercial goods / services",
            )
        except ValueError as exc:
            raise ClientException(detail=str(exc), status_code=400) from exc
        status = _status(data.status, QUOTATION_STATUSES, "Quotation")
        if status != "draft":
            raise ClientException(
                detail="Create the quotation as Draft, preview the generated PDF, then send it.",
                status_code=409,
            )
        number = await next_business_number(db_session, "quotation", data.issue_date)
        item = Quotation(
            quotation_number=number,
            client_id=client_id,
            project_id=data.project_id,
            client_name=client_name,
            amount_ugx=total,
            status=status,
            issue_date=data.issue_date,
            valid_until=data.valid_until,
            notes=data.notes,
            created_by_email=_email(request),
        )
        db_session.add(item)
        await db_session.flush()
        await replace_line_items(db_session, QuotationLineItem, "quotation_id", item.id, lines)
        await db_session.commit()
        await db_session.refresh(item)
        return _quotation_read(item)

    @patch(path="/quotations/{quotation_id:uuid}")
    async def update_quotation(
        self,
        request: Request,
        quotation_id: uuid.UUID,
        data: QuotationUpdate,
        db_session: AsyncSession,
    ) -> QuotationRead:
        item = await db_session.get(Quotation, quotation_id)
        if item is None:
            raise NotFoundException(detail="Quotation not found.")
        quotation_content_change = bool(
            data.items
            or data.amount_ugx is not None
            or data.issue_date is not None
            or data.valid_until is not None
            or data.notes is not None
            or data.client_id is not None
            or data.project_id is not None
            or data.client_name is not None
        )
        previous_status = item.status
        if data.status is not None:
            if data.status != item.status and quotation_content_change:
                raise ClientException(
                    detail="Save quotation edits first, preview the regenerated PDF, then change its workflow status.",
                    status_code=409,
                )
            if item.status == "draft" and data.status in {"sent", "accepted"}:
                try:
                    await require_current_preview(db_session, "quotation", item.id)
                except ValueError as exc:
                    raise ClientException(detail=str(exc), status_code=409) from exc
            elif item.status == "sent" and data.status in {"accepted", "rejected", "expired"}:
                try:
                    await require_current_reviewed_version(db_session, "quotation", item.id)
                except ValueError as exc:
                    raise ClientException(detail=str(exc), status_code=409) from exc
            item.status = _transition(item.status, data.status, QUOTATION_TRANSITIONS, "Quotation")
        if data.items:
            try:
                lines, total = normalize_line_items(
                    data.items, fallback_description="Commercial goods / services"
                )
            except ValueError as exc:
                raise ClientException(detail=str(exc), status_code=400) from exc
            item.amount_ugx = total
            await replace_line_items(db_session, QuotationLineItem, "quotation_id", item.id, lines)
        elif data.amount_ugx is not None:
            item.amount_ugx = Decimal(str(max(0, data.amount_ugx)))
        for field in ("issue_date", "valid_until", "notes"):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value)
        if (
            data.client_id is not None
            or data.project_id is not None
            or data.client_name is not None
        ):
            _, _, client_name, client_id = await self._client_and_project(
                db_session,
                data.client_id if data.client_id is not None else item.client_id,
                data.project_id if data.project_id is not None else item.project_id,
                data.client_name if data.client_name is not None else item.client_name,
            )
            item.client_id = client_id
            item.project_id = data.project_id if data.project_id is not None else item.project_id
            item.client_name = client_name
        if quotation_content_change:
            await invalidate_current_generated_document(db_session, "quotation", item.id)
        await db_session.commit()
        await db_session.refresh(item)
        if item.status != previous_status:
            document = await current_generated_document(db_session, "quotation", item.id)
            if document is not None:
                await record_document_event(
                    db_session,
                    document,
                    item.status,
                    _email(request),
                    {"from_status": previous_status},
                )
        await db_session.commit()
        has_preview = await current_document_has_action(
            db_session, "quotation", item.id, {"previewed"}
        )
        return _quotation_read(item, has_current_preview=has_preview)

    @get(path="/invoices")
    async def invoices(
        self,
        db_session: AsyncSession,
        client_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
    ) -> list[InvoiceRead]:
        stmt = select(Invoice).order_by(Invoice.created_at.desc())
        if client_id:
            stmt = stmt.where(Invoice.client_id == client_id)
        if project_id:
            stmt = stmt.where(Invoice.project_id == project_id)
        return [_invoice_read(row) for row in (await db_session.execute(stmt)).scalars().all()]

    @post(path="/invoices", status_code=HTTP_201_CREATED)
    async def create_invoice(
        self, request: Request, data: InvoiceCreate, db_session: AsyncSession
    ) -> InvoiceRead:
        _, _, client_name, client_id = await self._client_and_project(
            db_session, data.client_id, data.project_id, data.client_name
        )
        try:
            lines, amount = normalize_line_items(
                data.items,
                fallback_amount=data.amount_ugx,
                fallback_description="Commercial goods / services",
            )
        except ValueError as exc:
            raise ClientException(detail=str(exc), status_code=400) from exc
        paid = Decimal(str(max(0, data.paid_amount_ugx)))
        if paid > amount > 0:
            raise ClientException(
                detail="Paid amount cannot exceed invoice amount.", status_code=400
            )
        status = _status(data.status, INVOICE_STATUSES, "Invoice")
        if status != "draft":
            raise ClientException(
                detail="Create the invoice as Draft, preview the generated PDF, then send it.",
                status_code=409,
            )
        if amount > 0 and paid >= amount:
            status = "paid"
        elif paid > 0:
            status = "partially_paid"
        number = await next_business_number(db_session, "invoice", data.issue_date)
        item = Invoice(
            invoice_number=number,
            client_id=client_id,
            project_id=data.project_id,
            client_name=client_name,
            amount_ugx=amount,
            paid_amount_ugx=paid,
            status=status,
            issue_date=data.issue_date,
            due_date=data.due_date,
            notes=data.notes,
            created_by_email=_email(request),
        )
        db_session.add(item)
        await db_session.flush()
        await replace_line_items(db_session, InvoiceLineItem, "invoice_id", item.id, lines)
        await sync_invoice_ledger(db_session, item)
        await db_session.commit()
        await db_session.refresh(item)
        return _invoice_read(item)

    @patch(path="/invoices/{invoice_id:uuid}")
    async def update_invoice(
        self, request: Request, invoice_id: uuid.UUID, data: InvoiceUpdate, db_session: AsyncSession
    ) -> InvoiceRead:
        item = await db_session.get(Invoice, invoice_id)
        if item is None:
            raise NotFoundException(detail="Invoice not found.")
        if data.items:
            try:
                lines, new_amount = normalize_line_items(
                    data.items, fallback_description="Commercial goods / services"
                )
            except ValueError as exc:
                raise ClientException(detail=str(exc), status_code=400) from exc
            if new_amount < (item.paid_amount_ugx or Decimal()):
                raise ClientException(
                    detail="Invoice amount cannot be lower than payments received.", status_code=409
                )
            item.amount_ugx = new_amount
            await replace_line_items(db_session, InvoiceLineItem, "invoice_id", item.id, lines)
        elif data.amount_ugx is not None:
            new_amount = Decimal(str(max(0, data.amount_ugx)))
            if new_amount < (item.paid_amount_ugx or Decimal()):
                raise ClientException(
                    detail="Invoice amount cannot be lower than payments received.",
                    status_code=409,
                )
            item.amount_ugx = new_amount
        invoice_content_change = bool(
            data.items
            or data.amount_ugx is not None
            or data.issue_date is not None
            or data.due_date is not None
            or data.notes is not None
            or data.client_id is not None
            or data.project_id is not None
            or data.client_name is not None
        )
        previous_status = item.status
        if data.status is not None:
            if data.status != item.status and invoice_content_change:
                raise ClientException(
                    detail="Save invoice edits first, preview the regenerated PDF, then change its workflow status.",
                    status_code=409,
                )
            if item.status == "draft" and data.status == "sent":
                try:
                    await require_current_preview(db_session, "invoice", item.id)
                except ValueError as exc:
                    raise ClientException(detail=str(exc), status_code=409) from exc
            item.status = _transition(item.status, data.status, INVOICE_TRANSITIONS, "Invoice")
        for field in ("issue_date", "due_date", "notes"):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value)
        if (
            data.client_id is not None
            or data.project_id is not None
            or data.client_name is not None
        ):
            _, _, client_name, client_id = await self._client_and_project(
                db_session,
                data.client_id if data.client_id is not None else item.client_id,
                data.project_id if data.project_id is not None else item.project_id,
                data.client_name if data.client_name is not None else item.client_name,
            )
            item.client_id = client_id
            item.project_id = data.project_id if data.project_id is not None else item.project_id
            item.client_name = client_name
        amount = item.amount_ugx or Decimal()
        paid = item.paid_amount_ugx or Decimal()
        if amount > 0 and paid >= amount:
            item.status = "paid"
        elif paid > 0:
            item.status = "partially_paid"
        if invoice_content_change:
            await invalidate_current_generated_document(db_session, "invoice", item.id)
        await sync_invoice_ledger(db_session, item)
        await db_session.commit()
        await db_session.refresh(item)
        if item.status != previous_status:
            document = await current_generated_document(db_session, "invoice", item.id)
            if document is not None:
                await record_document_event(
                    db_session,
                    document,
                    item.status,
                    _email(request),
                    {"from_status": previous_status},
                )
        await db_session.commit()
        return _invoice_read(item)

    @get(path="/payments")
    async def payments(
        self,
        db_session: AsyncSession,
        client_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
        invoice_id: uuid.UUID | None = None,
    ) -> list[PaymentRead]:
        stmt = select(Payment).order_by(Payment.payment_date.desc(), Payment.created_at.desc())
        if client_id:
            stmt = stmt.where(Payment.client_id == client_id)
        if project_id:
            stmt = stmt.where(Payment.project_id == project_id)
        if invoice_id:
            stmt = stmt.where(Payment.invoice_id == invoice_id)
        return [_payment_read(row) for row in (await db_session.execute(stmt)).scalars().all()]

    @post(path="/payments", status_code=HTTP_201_CREATED)
    async def create_payment(
        self, request: Request, data: PaymentCreate, db_session: AsyncSession
    ) -> PaymentRead:
        amount = Decimal(str(max(0, data.amount_ugx)))
        if amount <= 0:
            raise ClientException(
                detail="Payment amount must be greater than zero.", status_code=400
            )

        invoice = await db_session.get(Invoice, data.invoice_id) if data.invoice_id else None
        if data.invoice_id and invoice is None:
            raise NotFoundException(detail="Invoice not found.")
        project_id = data.project_id or (invoice.project_id if invoice else None)
        project = await db_session.get(Project, project_id) if project_id else None
        if project_id and project is None:
            raise NotFoundException(detail="Project not found.")
        if (
            invoice
            and data.project_id
            and invoice.project_id
            and data.project_id != invoice.project_id
        ):
            raise ClientException(
                detail="Invoice does not belong to the selected project.",
                status_code=409,
            )

        client_id = (
            data.client_id
            or (invoice.client_id if invoice else None)
            or (project.client_id if project else None)
        )
        if client_id and await db_session.get(Client, client_id) is None:
            raise NotFoundException(detail="Client not found.")
        if invoice and client_id and invoice.client_id and client_id != invoice.client_id:
            raise ClientException(detail="Invoice belongs to a different client.", status_code=409)

        if invoice:
            outstanding = max(Decimal(), invoice.amount_ugx - invoice.paid_amount_ugx)
            if amount > outstanding:
                raise ClientException(
                    detail="Payment exceeds the invoice outstanding amount.",
                    status_code=409,
                )

        receipt_number = await next_business_number(db_session, "receipt", data.payment_date)
        item = Payment(
            receipt_number=receipt_number,
            client_id=client_id,
            project_id=project_id,
            invoice_id=data.invoice_id,
            amount_ugx=amount,
            payment_date=data.payment_date,
            method=data.method.strip().lower() or "bank",
            reference=data.reference.strip() if data.reference else None,
            notes=data.notes,
            recorded_by_email=_email(request),
        )
        db_session.add(item)
        if invoice:
            invoice.paid_amount_ugx = min(invoice.amount_ugx, invoice.paid_amount_ugx + amount)
            invoice.status = (
                "paid" if invoice.paid_amount_ugx >= invoice.amount_ugx else "partially_paid"
            )
        if project:
            received = (project.amount_paid_ugx or Decimal()) + amount
            project.amount_paid_ugx = (
                min(project.value_ugx, received)
                if project.value_ugx and project.value_ugx > 0
                else received
            )
        await db_session.flush()
        await sync_payment_ledger(db_session, item)
        invoice_document = None
        if invoice is not None:
            await sync_invoice_ledger(db_session, invoice)
            invoice_document = await invalidate_current_generated_document(
                db_session, "invoice", invoice.id
            )
            if invoice_document is not None:
                await record_document_event(
                    db_session,
                    invoice_document,
                    "paid" if invoice.status == "paid" else "payment_recorded",
                    _email(request),
                    {
                        "receipt_number": item.receipt_number,
                        "payment_id": str(item.id),
                        "amount_ugx": float(item.amount_ugx or 0),
                    },
                )
        await db_session.commit()
        await db_session.refresh(item)
        return _payment_read(item)

    async def _receipt_read(self, db_session: AsyncSession, item: Payment) -> ReceiptRead:
        invoice = await db_session.get(Invoice, item.invoice_id) if item.invoice_id else None
        client = await db_session.get(Client, item.client_id) if item.client_id else None
        return ReceiptRead(
            id=item.id,
            receipt_reference=item.receipt_number or f"PAY-{str(item.id).split('-')[0].upper()}",
            client_id=item.client_id,
            client_name=client.name if client else (invoice.client_name if invoice else None),
            project_id=item.project_id,
            invoice_id=item.invoice_id,
            invoice_number=invoice.invoice_number if invoice else None,
            amount_ugx=float(item.amount_ugx or 0),
            payment_date=item.payment_date,
            method=item.method,
            reference=item.reference,
            notes=item.notes,
            recorded_by_email=item.recorded_by_email,
            created_at=item.created_at,
        )

    @get(path="/receipts")
    async def receipts(
        self,
        db_session: AsyncSession,
        client_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
    ) -> list[ReceiptRead]:
        stmt = select(Payment).order_by(Payment.payment_date.desc(), Payment.created_at.desc())
        if client_id:
            stmt = stmt.where(Payment.client_id == client_id)
        if project_id:
            stmt = stmt.where(Payment.project_id == project_id)
        rows = (await db_session.execute(stmt)).scalars().all()
        return [await self._receipt_read(db_session, row) for row in rows]

    @get(path="/purchase-orders")
    async def purchase_orders(
        self,
        db_session: AsyncSession,
        supplier_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
    ) -> list[PurchaseOrderRead]:
        stmt = select(PurchaseOrder).order_by(PurchaseOrder.created_at.desc())
        if supplier_id:
            stmt = stmt.where(PurchaseOrder.supplier_id == supplier_id)
        if project_id:
            stmt = stmt.where(PurchaseOrder.project_id == project_id)
        return [_po_read(row) for row in (await db_session.execute(stmt)).scalars().all()]

    @post(path="/purchase-orders", status_code=HTTP_201_CREATED)
    async def create_purchase_order(
        self, request: Request, data: PurchaseOrderCreate, db_session: AsyncSession
    ) -> PurchaseOrderRead:
        supplier = await db_session.get(Supplier, data.supplier_id) if data.supplier_id else None
        if data.supplier_id and supplier is None:
            raise NotFoundException(detail="Supplier not found.")
        if data.project_id and await db_session.get(Project, data.project_id) is None:
            raise NotFoundException(detail="Project not found.")
        supplier_name = supplier.name if supplier else data.supplier_name.strip()
        if not supplier_name:
            raise ClientException(detail="Supplier is required.", status_code=400)
        try:
            lines, total = normalize_line_items(
                data.items,
                fallback_amount=data.amount_ugx,
                fallback_description="Goods / services ordered",
            )
        except ValueError as exc:
            raise ClientException(detail=str(exc), status_code=400) from exc
        status = _status(data.status, PO_STATUSES, "Purchase order")
        if status != "draft":
            raise ClientException(
                detail="Create the purchase order as Draft, preview the generated PDF, then issue it.",
                status_code=409,
            )
        number = await next_business_number(db_session, "purchase_order", data.order_date)
        item = PurchaseOrder(
            po_number=number,
            supplier_id=data.supplier_id,
            project_id=data.project_id,
            supplier_name=supplier_name,
            amount_ugx=total,
            status=status,
            order_date=data.order_date,
            expected_date=data.expected_date,
            notes=data.notes,
            created_by_email=_email(request),
        )
        db_session.add(item)
        await db_session.flush()
        await replace_line_items(
            db_session, PurchaseOrderLineItem, "purchase_order_id", item.id, lines
        )
        await db_session.commit()
        await db_session.refresh(item)
        return _po_read(item)

    @patch(path="/purchase-orders/{purchase_order_id:uuid}")
    async def update_purchase_order(
        self,
        request: Request,
        purchase_order_id: uuid.UUID,
        data: PurchaseOrderUpdate,
        db_session: AsyncSession,
    ) -> PurchaseOrderRead:
        item = await db_session.get(PurchaseOrder, purchase_order_id)
        if item is None:
            raise NotFoundException(detail="Purchase order not found.")
        po_content_change = bool(
            data.items
            or data.amount_ugx is not None
            or data.supplier_id is not None
            or data.supplier_name is not None
            or data.project_id is not None
            or data.order_date is not None
            or data.expected_date is not None
            or data.notes is not None
        )
        previous_status = item.status
        if data.status is not None:
            if data.status != item.status and po_content_change:
                raise ClientException(
                    detail="Save purchase-order edits first, preview the regenerated PDF, then change its workflow status.",
                    status_code=409,
                )
            if item.status == "draft" and data.status == "issued":
                try:
                    await require_current_preview(db_session, "purchase_order", item.id)
                except ValueError as exc:
                    raise ClientException(detail=str(exc), status_code=409) from exc
            item.status = _transition(item.status, data.status, PO_TRANSITIONS, "Purchase order")
        if data.items:
            try:
                lines, total = normalize_line_items(
                    data.items, fallback_description="Goods / services ordered"
                )
            except ValueError as exc:
                raise ClientException(detail=str(exc), status_code=400) from exc
            item.amount_ugx = total
            await replace_line_items(
                db_session, PurchaseOrderLineItem, "purchase_order_id", item.id, lines
            )
        elif data.amount_ugx is not None:
            item.amount_ugx = Decimal(str(max(0, data.amount_ugx)))
        if data.supplier_id is not None:
            supplier = await db_session.get(Supplier, data.supplier_id)
            if supplier is None:
                raise NotFoundException(detail="Supplier not found.")
            item.supplier_id = supplier.id
            item.supplier_name = supplier.name
        elif data.supplier_name is not None:
            item.supplier_name = data.supplier_name.strip()
        if data.project_id is not None:
            if await db_session.get(Project, data.project_id) is None:
                raise NotFoundException(detail="Project not found.")
            item.project_id = data.project_id
        for field in ("order_date", "expected_date", "notes"):
            value = getattr(data, field)
            if value is not None:
                setattr(item, field, value)
        if po_content_change:
            await invalidate_current_generated_document(db_session, "purchase_order", item.id)
        await db_session.commit()
        await db_session.refresh(item)
        if item.status != previous_status:
            document = await current_generated_document(db_session, "purchase_order", item.id)
            if document is not None:
                await record_document_event(
                    db_session,
                    document,
                    item.status,
                    _email(request),
                    {"from_status": previous_status},
                )
        await db_session.commit()
        return _po_read(item)

    @get(path="/expenses")
    async def expenses(
        self,
        db_session: AsyncSession,
        supplier_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
    ) -> list[ExpenseRead]:
        stmt = select(Expense).order_by(Expense.expense_date.desc(), Expense.created_at.desc())
        if supplier_id:
            stmt = stmt.where(Expense.supplier_id == supplier_id)
        if project_id:
            stmt = stmt.where(Expense.project_id == project_id)
        return [_expense_read(row) for row in (await db_session.execute(stmt)).scalars().all()]

    @post(path="/expenses", status_code=HTTP_201_CREATED)
    async def create_expense(
        self, request: Request, data: ExpenseCreate, db_session: AsyncSession
    ) -> ExpenseRead:
        if not data.description.strip():
            raise ClientException(detail="Expense description is required.", status_code=400)
        if data.project_id and await db_session.get(Project, data.project_id) is None:
            raise NotFoundException(detail="Project not found.")
        if data.supplier_id and await db_session.get(Supplier, data.supplier_id) is None:
            raise NotFoundException(detail="Supplier not found.")
        document = (
            await db_session.get(Document, data.supporting_document_id)
            if data.supporting_document_id
            else None
        )
        if data.supporting_document_id and document is None:
            raise NotFoundException(detail="Supporting document not found.")
        if (
            document
            and data.project_id
            and document.project_id
            and document.project_id != data.project_id
        ):
            raise ClientException(
                detail="Supporting document belongs to a different project.",
                status_code=409,
            )
        item = Expense(
            project_id=data.project_id,
            supplier_id=data.supplier_id,
            supporting_document_id=data.supporting_document_id,
            category=data.category.strip().lower() or "general",
            description=data.description.strip(),
            amount_ugx=Decimal(str(max(0, data.amount_ugx))),
            expense_date=data.expense_date,
            reference=data.reference,
            created_by_email=_email(request),
        )
        db_session.add(item)
        await db_session.flush()
        await sync_expense_ledger(db_session, item)
        await db_session.commit()
        await db_session.refresh(item)
        return _expense_read(item)

    @get(path="/clients/{client_id:uuid}/workspace")
    async def client_workspace(
        self, client_id: uuid.UUID, db_session: AsyncSession
    ) -> ClientWorkspace:
        client = await db_session.get(Client, client_id)
        if client is None:
            raise NotFoundException(detail="Client not found.")
        projects = (
            (
                await db_session.execute(
                    select(Project)
                    .where(
                        or_(
                            Project.client_id == client.id,
                            func.lower(Project.client_name) == client.name.lower(),
                        )
                    )
                    .order_by(Project.updated_at.desc())
                )
            )
            .scalars()
            .all()
        )
        project_ids = [row.id for row in projects]
        quotes = (
            (
                await db_session.execute(
                    select(Quotation)
                    .where(Quotation.client_id == client.id)
                    .order_by(Quotation.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        invoices = (
            (
                await db_session.execute(
                    select(Invoice)
                    .where(Invoice.client_id == client.id)
                    .order_by(Invoice.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        payments = (
            (
                await db_session.execute(
                    select(Payment)
                    .where(Payment.client_id == client.id)
                    .order_by(Payment.payment_date.desc())
                )
            )
            .scalars()
            .all()
        )
        doc_filter = Document.client_id == client.id
        if project_ids:
            doc_filter = or_(doc_filter, Document.project_id.in_(project_ids))
        documents = (
            (
                await db_session.execute(
                    select(Document)
                    .where(doc_filter, Document.is_deleted.is_(False))
                    .order_by(Document.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        receipts = [await self._receipt_read(db_session, row) for row in payments]
        outstanding = sum(max(Decimal(), row.amount_ugx - row.paid_amount_ugx) for row in invoices)
        activity: list[ActivityItem] = []
        activity.extend(
            ActivityItem(row.id, "project", row.name, row.status, row.updated_at)
            for row in projects
        )
        activity.extend(
            ActivityItem(row.id, "quotation", row.quotation_number, row.status, row.updated_at)
            for row in quotes
        )
        activity.extend(
            ActivityItem(
                row.id,
                "invoice",
                row.invoice_number,
                _effective_invoice_status(row),
                row.updated_at,
            )
            for row in invoices
        )
        activity.extend(
            ActivityItem(
                row.id,
                "receipt",
                f"Payment received: {float(row.amount_ugx or 0):,.0f} UGX",
                row.reference,
                row.created_at,
            )
            for row in payments
        )
        activity.extend(
            ActivityItem(row.id, "document", row.title, row.category, row.created_at)
            for row in documents
        )
        activity.sort(key=lambda item: item.occurred_at, reverse=True)
        return ClientWorkspace(
            client=_client_read(client),
            projects=[_project_item(row) for row in projects],
            quotations=[_quotation_read(row) for row in quotes],
            invoices=[_invoice_read(row) for row in invoices],
            receipts=receipts,
            documents=[_document_item(row) for row in documents],
            outstanding_balance_ugx=float(outstanding),
            activity=activity[:50],
        )

    @get(path="/suppliers/{supplier_id:uuid}/workspace")
    async def supplier_workspace(
        self, supplier_id: uuid.UUID, db_session: AsyncSession
    ) -> SupplierWorkspace:
        supplier = await db_session.get(Supplier, supplier_id)
        if supplier is None:
            raise NotFoundException(detail="Supplier not found.")
        orders = (
            (
                await db_session.execute(
                    select(PurchaseOrder)
                    .where(PurchaseOrder.supplier_id == supplier.id)
                    .order_by(PurchaseOrder.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        expenses = (
            (
                await db_session.execute(
                    select(Expense)
                    .where(Expense.supplier_id == supplier.id)
                    .order_by(Expense.expense_date.desc())
                )
            )
            .scalars()
            .all()
        )
        project_ids = {row.project_id for row in orders if row.project_id} | {
            row.project_id for row in expenses if row.project_id
        }
        projects = (
            (
                await db_session.execute(
                    select(Project)
                    .where(Project.id.in_(project_ids))
                    .order_by(Project.updated_at.desc())
                )
            )
            .scalars()
            .all()
            if project_ids
            else []
        )
        doc_filter = Document.supplier_id == supplier.id
        if project_ids:
            doc_filter = or_(doc_filter, Document.project_id.in_(project_ids))
        documents = (
            (
                await db_session.execute(
                    select(Document)
                    .where(doc_filter, Document.is_deleted.is_(False))
                    .order_by(Document.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        activity: list[ActivityItem] = []
        activity.extend(
            ActivityItem(row.id, "purchase_order", row.po_number, row.status, row.updated_at)
            for row in orders
        )
        activity.extend(
            ActivityItem(row.id, "expense", row.description, row.category, row.updated_at)
            for row in expenses
        )
        activity.extend(
            ActivityItem(row.id, "document", row.title, row.category, row.created_at)
            for row in documents
        )
        activity.sort(key=lambda item: item.occurred_at, reverse=True)
        return SupplierWorkspace(
            supplier=_supplier_read(supplier),
            projects=[_project_item(row) for row in projects],
            purchase_orders=[_po_read(row) for row in orders],
            expenses=[_expense_read(row) for row in expenses],
            documents=[_document_item(row) for row in documents],
            purchase_orders_total_ugx=float(sum(row.amount_ugx or Decimal() for row in orders)),
            expenses_total_ugx=float(sum(row.amount_ugx or Decimal() for row in expenses)),
            activity=activity[:50],
        )

    @get(path="/statements/clients")
    async def client_statement_summaries(
        self, db_session: AsyncSession
    ) -> list[ClientStatementSummary]:
        clients = (await db_session.execute(select(Client).order_by(Client.name))).scalars().all()
        result: list[ClientStatementSummary] = []
        for client in clients:
            invoices = (
                (await db_session.execute(select(Invoice).where(Invoice.client_id == client.id)))
                .scalars()
                .all()
            )
            invoiced = sum(row.amount_ugx or Decimal() for row in invoices)
            paid = sum(row.paid_amount_ugx or Decimal() for row in invoices)
            result.append(
                ClientStatementSummary(
                    client.id,
                    client.name,
                    float(invoiced),
                    float(paid),
                    float(max(Decimal(), invoiced - paid)),
                )
            )
        return result

    @get(path="/clients/{client_id:uuid}/statement")
    async def client_statement(
        self, client_id: uuid.UUID, db_session: AsyncSession
    ) -> list[StatementEntry]:
        if await db_session.get(Client, client_id) is None:
            raise NotFoundException(detail="Client not found.")
        invoices = (
            (await db_session.execute(select(Invoice).where(Invoice.client_id == client_id)))
            .scalars()
            .all()
        )
        payments = (
            (await db_session.execute(select(Payment).where(Payment.client_id == client_id)))
            .scalars()
            .all()
        )
        events: list[tuple[date, int, uuid.UUID, str, str, Decimal, Decimal, str | None]] = []
        for row in invoices:
            events.append(
                (
                    row.issue_date,
                    0,
                    row.id,
                    "invoice",
                    row.invoice_number,
                    row.amount_ugx or Decimal(),
                    Decimal(),
                    _effective_invoice_status(row),
                )
            )
        for row in payments:
            events.append(
                (
                    row.payment_date,
                    1,
                    row.id,
                    "receipt",
                    row.reference or f"PAY-{str(row.id).split('-')[0].upper()}",
                    Decimal(),
                    row.amount_ugx or Decimal(),
                    "received",
                )
            )
        events.sort(key=lambda item: (item[0], item[1]))
        balance = Decimal()
        result: list[StatementEntry] = []
        for (
            entry_date,
            _,
            record_id,
            kind,
            reference,
            debit,
            credit,
            status,
        ) in events:
            balance += debit - credit
            result.append(
                StatementEntry(
                    record_id,
                    kind,
                    reference,
                    entry_date,
                    float(debit),
                    float(credit),
                    float(balance),
                    status,
                )
            )
        return result

    @get(path="/statements/suppliers")
    async def supplier_statement_summaries(
        self, db_session: AsyncSession
    ) -> list[SupplierStatementSummary]:
        suppliers = (
            (await db_session.execute(select(Supplier).order_by(Supplier.name))).scalars().all()
        )
        result: list[SupplierStatementSummary] = []
        for supplier in suppliers:
            orders_total = await db_session.scalar(
                select(func.coalesce(func.sum(PurchaseOrder.amount_ugx), 0)).where(
                    PurchaseOrder.supplier_id == supplier.id
                )
            )
            expenses_total = await db_session.scalar(
                select(func.coalesce(func.sum(Expense.amount_ugx), 0)).where(
                    Expense.supplier_id == supplier.id
                )
            )
            result.append(
                SupplierStatementSummary(
                    supplier.id,
                    supplier.name,
                    float(orders_total or 0),
                    float(expenses_total or 0),
                )
            )
        return result

    @get(path="/summary")
    async def summary(self, db_session: AsyncSession) -> BusinessSummary:
        today = datetime.now(UTC).date()
        month_start = date(today.year, today.month, 1)
        month_end = date(
            today.year + (1 if today.month == 12 else 0),
            1 if today.month == 12 else today.month + 1,
            1,
        )
        total_clients = int(await db_session.scalar(select(func.count()).select_from(Client)) or 0)
        active_clients = int(
            await db_session.scalar(
                select(func.count()).select_from(Client).where(Client.is_active.is_(True))
            )
            or 0
        )
        total_suppliers = int(
            await db_session.scalar(select(func.count()).select_from(Supplier)) or 0
        )
        active_suppliers = int(
            await db_session.scalar(
                select(func.count()).select_from(Supplier).where(Supplier.is_active.is_(True))
            )
            or 0
        )
        open_quotes = int(
            await db_session.scalar(
                select(func.count())
                .select_from(Quotation)
                .where(Quotation.status.in_(["draft", "sent"]))
            )
            or 0
        )
        outstanding_invoices = int(
            await db_session.scalar(
                select(func.count())
                .select_from(Invoice)
                .where(Invoice.paid_amount_ugx < Invoice.amount_ugx)
            )
            or 0
        )
        receivables = await db_session.scalar(
            select(func.coalesce(func.sum(Invoice.amount_ugx - Invoice.paid_amount_ugx), 0)).where(
                Invoice.paid_amount_ugx < Invoice.amount_ugx
            )
        )
        open_pos = int(
            await db_session.scalar(
                select(func.count())
                .select_from(PurchaseOrder)
                .where(PurchaseOrder.status.in_(["draft", "issued"]))
            )
            or 0
        )
        month_expenses = await db_session.scalar(
            select(func.coalesce(func.sum(Expense.amount_ugx), 0)).where(
                Expense.expense_date >= month_start,
                Expense.expense_date < month_end,
            )
        )
        month_receipts = await db_session.scalar(
            select(func.coalesce(func.sum(Payment.amount_ugx), 0)).where(
                Payment.payment_date >= month_start,
                Payment.payment_date < month_end,
            )
        )
        all_expenses = await db_session.scalar(
            select(func.coalesce(func.sum(Expense.amount_ugx), 0))
        )
        return BusinessSummary(
            total_clients=total_clients,
            active_clients=active_clients,
            total_suppliers=total_suppliers,
            active_suppliers=active_suppliers,
            quotations_open=open_quotes,
            outstanding_invoices=outstanding_invoices,
            receivables_ugx=float(receivables or 0),
            purchase_orders_open=open_pos,
            expenses_month_ugx=float(month_expenses or 0),
            receipts_month_ugx=float(month_receipts or 0),
            clients=active_clients,
            suppliers=active_suppliers,
            invoice_outstanding_ugx=float(receivables or 0),
            expenses_ugx=float(all_expenses or 0),
        )
