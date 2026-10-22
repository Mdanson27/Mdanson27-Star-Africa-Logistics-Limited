from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from html import escape
from typing import Any, ClassVar

from litestar import Controller, Request, Response, delete, get, post
from litestar.exceptions import ClientException, NotFoundException, PermissionDeniedException
from litestar.status_codes import HTTP_200_OK, HTTP_201_CREATED
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.mail import EmailAttachment, EmailMessage, mail_service
from app.core.settings import settings
from app.core.storage import delete_object, get_object_bytes, object_exists_async, presign_download
from app.domain.business.document_service import (
    client_statement_pdf,
    ensure_invoice_document,
    ensure_purchase_order_document,
    ensure_quotation_document,
    ensure_receipt_document,
    invoice_pdf,
    purchase_order_pdf,
    quotation_pdf,
    receipt_pdf,
    supplier_statement_pdf,
)
from app.domain.business.models import (
    BusinessDocumentEvent,
    Client,
    Invoice,
    InvoiceLineItem,
    Payment,
    PurchaseOrder,
    Quotation,
    QuotationLineItem,
    Supplier,
)
from app.domain.business.schemas import (
    BusinessDocumentActionResponse,
    BusinessDocumentArchiveItem,
    BusinessDocumentEmailRequest,
    BusinessDocumentEventRead,
    CommercialDocumentRead,
    InvoiceRead,
    QuotationConvertRequest,
)
from app.domain.business.services import (
    current_generated_document,
    line_items_read,
    load_line_items,
    next_business_number,
    record_document_event,
    replace_line_items,
    require_current_preview,
    upsert_generated_document,
)
from app.domain.workspace.models import Document
from app.presentation.guards.auth_guard import JWTAuthGuard


def _email(request: Request) -> str:
    email = str(request.scope.get("email") or "").strip().lower()
    if not email:
        raise ClientException(detail="Authenticated email is required.", status_code=401)
    return email


def _pdf_response(pdf: bytes, filename: str) -> Response[bytes]:
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


def _archive_item(item: Document) -> BusinessDocumentArchiveItem:
    return BusinessDocumentArchiveItem(
        id=item.id,
        document_type=item.document_type or item.related_record_type,
        document_number=item.document_number,
        title=item.title,
        filename=item.original_filename,
        version=item.version,
        is_current=item.is_current,
        is_deleted=item.is_deleted,
        client_id=item.client_id,
        supplier_id=item.supplier_id,
        project_id=item.project_id,
        related_record_type=item.related_record_type,
        related_record_id=item.related_record_id,
        uploaded_by_email=item.uploaded_by_email,
        created_at=item.created_at,
        updated_at=item.updated_at,
        deleted_at=item.deleted_at,
        deleted_by_email=item.deleted_by_email,
        supersedes_document_id=item.supersedes_document_id,
    )


def _event_read(item: BusinessDocumentEvent) -> BusinessDocumentEventRead:
    return BusinessDocumentEventRead(
        id=item.id,
        document_id=item.document_id,
        action=item.action,
        actor_email=item.actor_email,
        details=dict(item.details or {}),
        occurred_at=item.created_at,
    )


def _invoice_read(item: Invoice, line_items) -> InvoiceRead:
    amount = float(item.amount_ugx or 0)
    paid = float(item.paid_amount_ugx or 0)
    status = item.status
    if amount > 0 and paid >= amount:
        status = "paid"
    elif paid > 0 and status != "overdue":
        status = "partially_paid"
    return InvoiceRead(
        id=item.id,
        invoice_number=item.invoice_number,
        client_id=item.client_id,
        project_id=item.project_id,
        client_name=item.client_name,
        amount_ugx=amount,
        paid_amount_ugx=paid,
        outstanding_amount_ugx=max(0.0, amount - paid),
        status=status,
        issue_date=item.issue_date,
        due_date=item.due_date,
        notes=item.notes,
        created_at=item.created_at,
        updated_at=item.updated_at,
        source_quotation_id=item.source_quotation_id,
        items=line_items_read(line_items),
    )


class CommercialDocumentsController(Controller):
    path = "/business"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    @post(path="/quotations/{quotation_id:uuid}/convert-to-invoice", status_code=HTTP_201_CREATED)
    async def convert_quotation_to_invoice(
        self,
        request: Request,
        quotation_id: uuid.UUID,
        data: QuotationConvertRequest,
        db_session: AsyncSession,
    ) -> InvoiceRead:
        quotation = await db_session.get(Quotation, quotation_id)
        if quotation is None:
            raise NotFoundException(detail="Quotation not found.")
        if quotation.status in {"rejected", "expired"}:
            raise ClientException(
                detail="Rejected or expired quotations cannot be converted to invoices.",
                status_code=409,
            )
        if quotation.status != "accepted":
            if quotation.previewed_at is None:
                try:
                    await require_current_preview(db_session, "quotation", quotation.id)
                except ValueError as exc:
                    raise ClientException(detail=str(exc), status_code=409) from exc
            previous_status = quotation.status
            quotation.status = "accepted"
            document = await current_generated_document(db_session, "quotation", quotation.id)
            if document is not None:
                await record_document_event(
                    db_session,
                    document,
                    "accepted",
                    _email(request),
                    {"from_status": previous_status, "via": "convert_to_invoice"},
                )
        existing = (
            await db_session.execute(
                select(Invoice).where(Invoice.source_quotation_id == quotation.id)
            )
        ).scalar_one_or_none()
        if existing is not None:
            lines = await load_line_items(db_session, InvoiceLineItem, "invoice_id", existing.id)
            return _invoice_read(existing, lines)
        quote_lines = await load_line_items(
            db_session, QuotationLineItem, "quotation_id", quotation.id
        )
        if not quote_lines:
            raise ClientException(detail="Quotation has no billable line items.", status_code=409)
        invoice_number = await next_business_number(db_session, "invoice", data.issue_date)
        invoice = Invoice(
            invoice_number=invoice_number,
            client_id=quotation.client_id,
            project_id=quotation.project_id,
            source_quotation_id=quotation.id,
            client_name=quotation.client_name,
            amount_ugx=quotation.amount_ugx,
            paid_amount_ugx=0,
            status="draft",
            issue_date=data.issue_date,
            due_date=data.due_date,
            notes=data.notes or quotation.notes,
            created_by_email=_email(request),
        )
        db_session.add(invoice)
        await db_session.flush()
        normalized = [(x.description, x.quantity, x.unit_price_ugx) for x in quote_lines]
        await replace_line_items(db_session, InvoiceLineItem, "invoice_id", invoice.id, normalized)
        await db_session.commit()
        await db_session.refresh(invoice)
        lines = await load_line_items(db_session, InvoiceLineItem, "invoice_id", invoice.id)
        return _invoice_read(invoice, lines)

    async def _quotation_document(
        self, request: Request, quotation_id: uuid.UUID, db_session: AsyncSession
    ):
        item = await db_session.get(Quotation, quotation_id)
        if item is None:
            raise NotFoundException(detail="Quotation not found.")
        result = await ensure_quotation_document(db_session, item, _email(request))
        await db_session.commit()
        return item, result

    @post(path="/quotations/{quotation_id:uuid}/document")
    async def generate_quotation_document(
        self, request: Request, quotation_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        item, (_, doc, url, filename) = await self._quotation_document(
            request, quotation_id, db_session
        )
        return CommercialDocumentRead(
            document_id=doc.id if doc else None,
            document_number=item.quotation_number,
            filename=filename,
            download_url=url,
            stored=doc is not None,
        )

    @get(path="/quotations/{quotation_id:uuid}/pdf")
    async def quotation_pdf_download(
        self, request: Request, quotation_id: uuid.UUID, db_session: AsyncSession
    ) -> Response[bytes]:
        item = await db_session.get(Quotation, quotation_id)
        if item is None:
            raise NotFoundException(detail="Quotation not found.")
        return _pdf_response(await quotation_pdf(db_session, item), f"{item.quotation_number}.pdf")

    async def _invoice_document(
        self, request: Request, invoice_id: uuid.UUID, db_session: AsyncSession
    ):
        item = await db_session.get(Invoice, invoice_id)
        if item is None:
            raise NotFoundException(detail="Invoice not found.")
        result = await ensure_invoice_document(db_session, item, _email(request))
        await db_session.commit()
        return item, result

    @post(path="/invoices/{invoice_id:uuid}/document")
    async def generate_invoice_document(
        self, request: Request, invoice_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        item, (_, doc, url, filename) = await self._invoice_document(
            request, invoice_id, db_session
        )
        return CommercialDocumentRead(
            document_id=doc.id if doc else None,
            document_number=item.invoice_number,
            filename=filename,
            download_url=url,
            stored=doc is not None,
        )

    @get(path="/invoices/{invoice_id:uuid}/pdf")
    async def invoice_pdf_download(
        self, request: Request, invoice_id: uuid.UUID, db_session: AsyncSession
    ) -> Response[bytes]:
        item = await db_session.get(Invoice, invoice_id)
        if item is None:
            raise NotFoundException(detail="Invoice not found.")
        return _pdf_response(await invoice_pdf(db_session, item), f"{item.invoice_number}.pdf")

    async def _receipt_document(
        self, request: Request, payment_id: uuid.UUID, db_session: AsyncSession
    ):
        item = await db_session.get(Payment, payment_id)
        if item is None:
            raise NotFoundException(detail="Receipt/payment not found.")
        result = await ensure_receipt_document(db_session, item, _email(request))
        await db_session.commit()
        return item, result

    @post(path="/receipts/{payment_id:uuid}/document")
    async def generate_receipt_document(
        self, request: Request, payment_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        item, (_, doc, url, filename) = await self._receipt_document(
            request, payment_id, db_session
        )
        number = item.receipt_number or filename.removesuffix(".pdf")
        return CommercialDocumentRead(
            document_id=doc.id if doc else None,
            document_number=number,
            filename=filename,
            download_url=url,
            stored=doc is not None,
        )

    @get(path="/receipts/{payment_id:uuid}/pdf")
    async def receipt_pdf_download(
        self, request: Request, payment_id: uuid.UUID, db_session: AsyncSession
    ) -> Response[bytes]:
        item = await db_session.get(Payment, payment_id)
        if item is None:
            raise NotFoundException(detail="Receipt/payment not found.")
        number = item.receipt_number or f"RCT-{str(item.id)[:8].upper()}"
        return _pdf_response(await receipt_pdf(db_session, item), f"{number}.pdf")

    async def _po_document(
        self, request: Request, purchase_order_id: uuid.UUID, db_session: AsyncSession
    ):
        item = await db_session.get(PurchaseOrder, purchase_order_id)
        if item is None:
            raise NotFoundException(detail="Purchase order not found.")
        result = await ensure_purchase_order_document(db_session, item, _email(request))
        await db_session.commit()
        return item, result

    @post(path="/purchase-orders/{purchase_order_id:uuid}/document")
    async def generate_purchase_order_document(
        self, request: Request, purchase_order_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        item, (_, doc, url, filename) = await self._po_document(
            request, purchase_order_id, db_session
        )
        return CommercialDocumentRead(
            document_id=doc.id if doc else None,
            document_number=item.po_number,
            filename=filename,
            download_url=url,
            stored=doc is not None,
        )

    @get(path="/purchase-orders/{purchase_order_id:uuid}/pdf")
    async def purchase_order_pdf_download(
        self, request: Request, purchase_order_id: uuid.UUID, db_session: AsyncSession
    ) -> Response[bytes]:
        item = await db_session.get(PurchaseOrder, purchase_order_id)
        if item is None:
            raise NotFoundException(detail="Purchase order not found.")
        return _pdf_response(await purchase_order_pdf(db_session, item), f"{item.po_number}.pdf")

    @post(path="/clients/{client_id:uuid}/statement/document")
    async def generate_client_statement_document(
        self, request: Request, client_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        client = await db_session.get(Client, client_id)
        if client is None:
            raise NotFoundException(detail="Client not found.")
        pdf = await client_statement_pdf(db_session, client)
        number = f"CLIENT-STMT-{client.id.hex[:8].upper()}"
        filename = f"{number}.pdf"
        doc, url = await upsert_generated_document(
            db_session,
            pdf_bytes=pdf,
            title=f"Client Statement - {client.name}",
            filename=filename,
            uploaded_by_email=_email(request),
            related_record_type="client_statement",
            related_record_id=client.id,
            client_id=client.id,
        )
        await db_session.commit()
        return CommercialDocumentRead(
            document_id=doc.id if doc else None,
            document_number=number,
            filename=filename,
            download_url=url,
            stored=doc is not None,
        )

    @get(path="/clients/{client_id:uuid}/statement/pdf")
    async def client_statement_pdf_download(
        self, client_id: uuid.UUID, db_session: AsyncSession
    ) -> Response[bytes]:
        client = await db_session.get(Client, client_id)
        if client is None:
            raise NotFoundException(detail="Client not found.")
        pdf = await client_statement_pdf(db_session, client)
        return _pdf_response(pdf, f"CLIENT-STMT-{client.id.hex[:8].upper()}.pdf")

    @post(path="/suppliers/{supplier_id:uuid}/statement/document")
    async def generate_supplier_statement_document(
        self, request: Request, supplier_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        supplier = await db_session.get(Supplier, supplier_id)
        if supplier is None:
            raise NotFoundException(detail="Supplier not found.")
        pdf = await supplier_statement_pdf(db_session, supplier)
        number = f"SUPPLIER-SUM-{supplier.id.hex[:8].upper()}"
        filename = f"{number}.pdf"
        doc, url = await upsert_generated_document(
            db_session,
            pdf_bytes=pdf,
            title=f"Supplier Purchase Summary - {supplier.name}",
            filename=filename,
            uploaded_by_email=_email(request),
            related_record_type="supplier_statement",
            related_record_id=supplier.id,
            supplier_id=supplier.id,
        )
        await db_session.commit()
        return CommercialDocumentRead(
            document_id=doc.id if doc else None,
            document_number=number,
            filename=filename,
            download_url=url,
            stored=doc is not None,
        )

    @get(path="/suppliers/{supplier_id:uuid}/statement/pdf")
    async def supplier_statement_pdf_download(
        self, supplier_id: uuid.UUID, db_session: AsyncSession
    ) -> Response[bytes]:
        supplier = await db_session.get(Supplier, supplier_id)
        if supplier is None:
            raise NotFoundException(detail="Supplier not found.")
        pdf = await supplier_statement_pdf(db_session, supplier)
        return _pdf_response(pdf, f"SUPPLIER-SUM-{supplier.id.hex[:8].upper()}.pdf")

    async def _preview_document_result(
        self,
        request: Request,
        doc: Document | None,
        number: str,
        filename: str,
        db_session: AsyncSession,
    ) -> CommercialDocumentRead:
        if doc is None:
            # PDF generation and workflow preview must remain usable even when object
            # storage is temporarily unavailable. The caller records previewed_at on
            # the commercial record, while archival storage can recover independently.
            await db_session.commit()
            return CommercialDocumentRead(
                document_id=None,
                document_number=number,
                filename=filename,
                download_url=None,
                stored=False,
            )
        await record_document_event(
            db_session, doc, "previewed", _email(request), {"version": doc.version}
        )
        await db_session.commit()
        return CommercialDocumentRead(
            document_id=doc.id,
            document_number=number,
            filename=filename,
            download_url=presign_download(doc.storage_key),
            stored=True,
        )

    @post(path="/quotations/{quotation_id:uuid}/preview")
    async def preview_quotation_document(
        self, request: Request, quotation_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        item, (_, doc, _, filename) = await self._quotation_document(
            request, quotation_id, db_session
        )
        item.previewed_at = datetime.now(UTC)
        await db_session.commit()
        return await self._preview_document_result(
            request, doc, item.quotation_number, filename, db_session
        )

    @post(path="/invoices/{invoice_id:uuid}/preview")
    async def preview_invoice_document(
        self, request: Request, invoice_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        item, (_, doc, _, filename) = await self._invoice_document(request, invoice_id, db_session)
        item.previewed_at = datetime.now(UTC)
        await db_session.commit()
        return await self._preview_document_result(
            request, doc, item.invoice_number, filename, db_session
        )

    @post(path="/receipts/{payment_id:uuid}/preview")
    async def preview_receipt_document(
        self, request: Request, payment_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        item, (_, doc, _, filename) = await self._receipt_document(request, payment_id, db_session)
        number = item.receipt_number or filename.removesuffix(".pdf")
        return await self._preview_document_result(request, doc, number, filename, db_session)

    @post(path="/purchase-orders/{purchase_order_id:uuid}/preview")
    async def preview_purchase_order_document(
        self, request: Request, purchase_order_id: uuid.UUID, db_session: AsyncSession
    ) -> CommercialDocumentRead:
        item, (_, doc, _, filename) = await self._po_document(
            request, purchase_order_id, db_session
        )
        item.previewed_at = datetime.now(UTC)
        await db_session.commit()
        return await self._preview_document_result(
            request, doc, item.po_number, filename, db_session
        )

    @get(path="/documents")
    async def business_documents_archive(
        self,
        request: Request,
        db_session: AsyncSession,
        document_type: str | None = None,
        client_id: uuid.UUID | None = None,
        supplier_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
        q: str | None = None,
        include_deleted: bool = False,
    ) -> list[BusinessDocumentArchiveItem]:
        if include_deleted and not bool(request.scope.get("is_superuser", False)):
            raise PermissionDeniedException(
                "Administrator privileges are required to view deleted documents."
            )
        stmt = select(Document).where(Document.category == "generated_commercial")
        if not include_deleted:
            stmt = stmt.where(Document.is_deleted.is_(False))
        if document_type:
            stmt = stmt.where(Document.document_type == document_type)
        if client_id:
            stmt = stmt.where(Document.client_id == client_id)
        if supplier_id:
            stmt = stmt.where(Document.supplier_id == supplier_id)
        if project_id:
            stmt = stmt.where(Document.project_id == project_id)
        if q and q.strip():
            term = f"%{q.strip()}%"
            stmt = stmt.where(
                or_(
                    Document.title.ilike(term),
                    Document.original_filename.ilike(term),
                    Document.document_number.ilike(term),
                )
            )
        stmt = stmt.order_by(Document.created_at.desc(), Document.version.desc())
        rows = (await db_session.execute(stmt)).scalars().all()
        return [_archive_item(row) for row in rows]

    @get(path="/documents/{document_id:uuid}/history")
    async def document_history(
        self, document_id: uuid.UUID, db_session: AsyncSession
    ) -> list[BusinessDocumentEventRead]:
        item = await db_session.get(Document, document_id)
        if item is None:
            raise NotFoundException(detail="Document not found.")
        rows = (
            (
                await db_session.execute(
                    select(BusinessDocumentEvent)
                    .where(BusinessDocumentEvent.document_id == document_id)
                    .order_by(BusinessDocumentEvent.created_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return [_event_read(row) for row in rows]

    async def _require_document_preview_or_issue(
        self, document: Document, db_session: AsyncSession
    ) -> None:
        event_id = await db_session.scalar(
            select(BusinessDocumentEvent.id)
            .where(
                BusinessDocumentEvent.document_id == document.id,
                BusinessDocumentEvent.action.in_(["previewed", "sent", "issued"]),
            )
            .limit(1)
        )
        if event_id is None:
            raise ClientException(
                detail="Preview this exact document version before sending or sharing it.",
                status_code=409,
            )

    async def _repair_current_archive_object(
        self, request: Request, item: Document, db_session: AsyncSession
    ) -> Document:
        if not item.is_current or not item.related_record_type or not item.related_record_id:
            raise ClientException(
                detail="This archived PDF is no longer available in storage.", status_code=410
            )

        actor = _email(request)
        record_type = item.related_record_type
        record_id = item.related_record_id
        repaired: Document | None = None

        if record_type == "quotation":
            source = await db_session.get(Quotation, record_id)
            if source is not None:
                _, repaired, _, _ = await ensure_quotation_document(db_session, source, actor)
        elif record_type == "invoice":
            source = await db_session.get(Invoice, record_id)
            if source is not None:
                _, repaired, _, _ = await ensure_invoice_document(db_session, source, actor)
        elif record_type == "receipt":
            source = await db_session.get(Payment, record_id)
            if source is not None:
                _, repaired, _, _ = await ensure_receipt_document(db_session, source, actor)
        elif record_type == "purchase_order":
            source = await db_session.get(PurchaseOrder, record_id)
            if source is not None:
                _, repaired, _, _ = await ensure_purchase_order_document(db_session, source, actor)
        elif record_type == "client_statement":
            source = await db_session.get(Client, record_id)
            if source is not None:
                pdf = await client_statement_pdf(db_session, source)
                repaired, _ = await upsert_generated_document(
                    db_session,
                    pdf_bytes=pdf,
                    title=item.title,
                    filename=item.original_filename,
                    uploaded_by_email=actor,
                    related_record_type=record_type,
                    related_record_id=record_id,
                    client_id=source.id,
                )
        elif record_type == "supplier_statement":
            source = await db_session.get(Supplier, record_id)
            if source is not None:
                pdf = await supplier_statement_pdf(db_session, source)
                repaired, _ = await upsert_generated_document(
                    db_session,
                    pdf_bytes=pdf,
                    title=item.title,
                    filename=item.original_filename,
                    uploaded_by_email=actor,
                    related_record_type=record_type,
                    related_record_id=record_id,
                    supplier_id=source.id,
                )

        if repaired is None or not await object_exists_async(repaired.storage_key):
            raise ClientException(
                detail="The current PDF could not be restored from its source record.",
                status_code=502,
            )
        await db_session.commit()
        return repaired

    async def _archive_link_action(
        self,
        request: Request,
        document_id: uuid.UUID,
        db_session: AsyncSession,
        action: str,
        *,
        expires: int = 900,
    ) -> BusinessDocumentActionResponse:
        item = await db_session.get(Document, document_id)
        if item is None or item.is_deleted:
            raise NotFoundException(detail="Document not found.")
        if not await object_exists_async(item.storage_key):
            item = await self._repair_current_archive_object(request, item, db_session)
        await record_document_event(
            db_session, item, action, _email(request), {"version": item.version}
        )
        await db_session.commit()
        return BusinessDocumentActionResponse(
            document=_archive_item(item),
            download_url=presign_download(item.storage_key, expires=expires),
            message=f"Document {action} recorded.",
        )

    @post(path="/documents/{document_id:uuid}/view")
    async def view_archived_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> BusinessDocumentActionResponse:
        return await self._archive_link_action(request, document_id, db_session, "previewed")

    @post(path="/documents/{document_id:uuid}/download")
    async def download_archived_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> BusinessDocumentActionResponse:
        return await self._archive_link_action(request, document_id, db_session, "downloaded")

    @post(path="/documents/{document_id:uuid}/print")
    async def print_archived_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> BusinessDocumentActionResponse:
        return await self._archive_link_action(request, document_id, db_session, "printed")

    @post(path="/documents/{document_id:uuid}/share")
    async def share_archived_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> BusinessDocumentActionResponse:
        item = await db_session.get(Document, document_id)
        if item is None or item.is_deleted:
            raise NotFoundException(detail="Document not found.")
        await self._require_document_preview_or_issue(item, db_session)
        return await self._archive_link_action(
            request, document_id, db_session, "shared", expires=86400
        )

    @post(path="/documents/{document_id:uuid}/email")
    async def email_archived_document(
        self,
        request: Request,
        document_id: uuid.UUID,
        data: BusinessDocumentEmailRequest,
        db_session: AsyncSession,
    ) -> BusinessDocumentActionResponse:
        item = await db_session.get(Document, document_id)
        if item is None or item.is_deleted:
            raise NotFoundException(detail="Document not found.")
        await self._require_document_preview_or_issue(item, db_session)
        recipient = data.to_address.strip().lower()
        if "@" not in recipient:
            raise ClientException(detail="A valid recipient email is required.", status_code=400)
        if not settings.smtp_configured:
            raise ClientException(
                detail="Email sending is not configured on the Star Africa Logistics server.",
                status_code=503,
            )
        pdf_bytes = await asyncio.to_thread(get_object_bytes, item.storage_key)
        subject = (data.subject or f"{item.title} - Star Africa Logistics Limited").strip()
        note = (
            data.message or "Please find the requested Star Africa Logistics document attached."
        ).strip()
        await mail_service.send_message(
            EmailMessage(
                to_address=recipient,
                subject=subject,
                html_body=(
                    f"<p>{escape(note)}</p>"
                    f"<p><strong>{escape(item.title)}</strong> · Version {item.version}</p>"
                    "<p>Regards,<br/>Star Africa Logistics Limited</p>"
                ),
                attachments=[
                    EmailAttachment(
                        filename=item.original_filename,
                        content=pdf_bytes,
                        content_type="application/pdf",
                    )
                ],
            )
        )
        await record_document_event(
            db_session,
            item,
            "sent",
            _email(request),
            {"recipient": recipient, "subject": subject, "version": item.version},
        )
        await db_session.commit()
        return BusinessDocumentActionResponse(
            document=_archive_item(item), message=f"Email sent to {recipient}."
        )

    @post(path="/documents/{document_id:uuid}/regenerate")
    async def regenerate_archived_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> BusinessDocumentActionResponse:
        item = await db_session.get(Document, document_id)
        if item is None or item.is_deleted:
            raise NotFoundException(detail="Document not found.")
        source_type = item.related_record_type or item.document_type
        source_id = item.related_record_id
        if source_id is None or not source_type:
            raise ClientException(
                detail="This document has no regeneratable source record.", status_code=409
            )
        actor = _email(request)
        new_doc = None
        url = None
        if source_type == "quotation":
            source = await db_session.get(Quotation, source_id)
            if source is None:
                raise NotFoundException(detail="Source quotation not found.")
            _, new_doc, url, _ = await ensure_quotation_document(
                db_session, source, actor, force_new_version=True
            )
        elif source_type == "invoice":
            source = await db_session.get(Invoice, source_id)
            if source is None:
                raise NotFoundException(detail="Source invoice not found.")
            _, new_doc, url, _ = await ensure_invoice_document(
                db_session, source, actor, force_new_version=True
            )
        elif source_type == "receipt":
            source = await db_session.get(Payment, source_id)
            if source is None:
                raise NotFoundException(detail="Source receipt/payment not found.")
            _, new_doc, url, _ = await ensure_receipt_document(
                db_session, source, actor, force_new_version=True
            )
        elif source_type == "purchase_order":
            source = await db_session.get(PurchaseOrder, source_id)
            if source is None:
                raise NotFoundException(detail="Source purchase order not found.")
            _, new_doc, url, _ = await ensure_purchase_order_document(
                db_session, source, actor, force_new_version=True
            )
        elif source_type == "client_statement":
            source = await db_session.get(Client, source_id)
            if source is None:
                raise NotFoundException(detail="Source client not found.")
            pdf = await client_statement_pdf(db_session, source)
            number = f"CLIENT-STMT-{source.id.hex[:8].upper()}"
            new_doc, url = await upsert_generated_document(
                db_session,
                pdf_bytes=pdf,
                title=f"Client Statement - {source.name}",
                filename=f"{number}.pdf",
                uploaded_by_email=actor,
                related_record_type="client_statement",
                related_record_id=source.id,
                client_id=source.id,
                force_new_version=True,
            )
        elif source_type == "supplier_statement":
            source = await db_session.get(Supplier, source_id)
            if source is None:
                raise NotFoundException(detail="Source supplier not found.")
            pdf = await supplier_statement_pdf(db_session, source)
            number = f"SUPPLIER-SUM-{source.id.hex[:8].upper()}"
            new_doc, url = await upsert_generated_document(
                db_session,
                pdf_bytes=pdf,
                title=f"Supplier Purchase Summary - {source.name}",
                filename=f"{number}.pdf",
                uploaded_by_email=actor,
                related_record_type="supplier_statement",
                related_record_id=source.id,
                supplier_id=source.id,
                force_new_version=True,
            )
        else:
            raise ClientException(detail="Unsupported document source type.", status_code=409)
        if new_doc is None:
            raise ClientException(detail="Document storage is not configured.", status_code=503)
        await db_session.commit()
        return BusinessDocumentActionResponse(
            document=_archive_item(new_doc),
            download_url=url,
            message=f"Version {new_doc.version} generated.",
        )

    @delete(path="/documents/{document_id:uuid}", status_code=HTTP_200_OK)
    async def soft_delete_archived_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> BusinessDocumentActionResponse:
        item = await db_session.get(Document, document_id)
        if item is None or item.is_deleted:
            raise NotFoundException(detail="Document not found.")
        actor = _email(request)
        await record_document_event(
            db_session, item, "deleted", actor, {"version": item.version, "recoverable": True}
        )
        item.is_deleted = True
        item.is_current = False
        item.deleted_at = datetime.now(UTC)
        item.deleted_by_email = actor
        await db_session.commit()
        return BusinessDocumentActionResponse(
            document=_archive_item(item),
            message="Document removed from active use and retained for recovery.",
        )

    @post(path="/documents/{document_id:uuid}/restore")
    async def restore_archived_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> BusinessDocumentActionResponse:
        item = await db_session.get(Document, document_id)
        if item is None:
            raise NotFoundException(detail="Document not found.")
        if not item.is_deleted:
            return BusinessDocumentActionResponse(
                document=_archive_item(item), message="Document is already active."
            )
        current = None
        if item.related_record_type and item.related_record_id:
            current = await current_generated_document(
                db_session, item.related_record_type, item.related_record_id
            )
        item.is_deleted = False
        item.deleted_at = None
        item.deleted_by_email = None
        item.is_current = current is None
        await record_document_event(
            db_session, item, "restored", _email(request), {"became_current": item.is_current}
        )
        await db_session.commit()
        return BusinessDocumentActionResponse(
            document=_archive_item(item), message="Document restored."
        )

    @delete(path="/documents/{document_id:uuid}/purge", status_code=HTTP_200_OK)
    async def purge_archived_document(
        self, request: Request, document_id: uuid.UUID, db_session: AsyncSession
    ) -> dict[str, str]:
        if not bool(request.scope.get("is_superuser", False)):
            raise PermissionDeniedException(
                "Platform administrator privileges required for permanent deletion."
            )
        item = await db_session.get(Document, document_id)
        if item is None:
            raise NotFoundException(detail="Document not found.")
        try:
            await asyncio.to_thread(delete_object, item.storage_key)
        except Exception as exc:
            raise ClientException(
                detail="The stored PDF could not be purged; the archive record was left intact.",
                status_code=502,
            ) from exc
        await db_session.delete(item)
        await db_session.commit()
        return {"message": "Document permanently deleted from storage and archive."}
