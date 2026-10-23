from __future__ import annotations

import hashlib
import uuid
from collections.abc import Iterable
from datetime import date
from decimal import Decimal
from typing import Any, TypeVar

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.storage import (
    local_storage_ready,
    object_exists_async,
    presign_download,
    put_object_bytes_async,
    storage_configured,
)
from app.domain.business.models import BusinessDocumentEvent, BusinessNumberCounter
from app.domain.business.schemas import CommercialLineItemRead
from app.domain.workspace.models import Document

T = TypeVar("T")

PREFIXES = {
    "quotation": "QTN",
    "invoice": "INV",
    "receipt": "RCT",
    "purchase_order": "PO",
}


def _decimal(value: float | Decimal) -> Decimal:
    return Decimal(str(value or 0))


def normalize_line_items(
    items: Iterable[Any],
    *,
    fallback_amount: float | Decimal = 0,
    fallback_description: str,
) -> tuple[list[tuple[str, Decimal, Decimal]], Decimal]:
    normalized: list[tuple[str, Decimal, Decimal]] = []
    for raw in items:
        description = str(raw.description or "").strip()
        quantity = _decimal(raw.quantity)
        unit_price = _decimal(raw.unit_price_ugx)
        if not description:
            raise ValueError("Each line item needs a description.")
        if quantity <= 0:
            raise ValueError("Line item quantity must be greater than zero.")
        if unit_price < 0:
            raise ValueError("Line item unit price cannot be negative.")
        normalized.append((description, quantity, unit_price))
    if not normalized and _decimal(fallback_amount) > 0:
        normalized.append((fallback_description, Decimal(1), _decimal(fallback_amount)))
    if not normalized:
        raise ValueError("At least one line item is required.")
    total = sum((qty * price for _, qty, price in normalized), Decimal(0))
    return normalized, total


async def replace_line_items(
    db_session: AsyncSession,
    model: type[T],
    fk_name: str,
    record_id: uuid.UUID,
    items: list[tuple[str, Decimal, Decimal]],
) -> None:
    fk_col = getattr(model, fk_name)
    await db_session.execute(delete(model).where(fk_col == record_id))
    for position, (description, quantity, unit_price) in enumerate(items, start=1):
        db_session.add(
            model(
                **{
                    fk_name: record_id,
                    "position": position,
                    "description": description,
                    "quantity": quantity,
                    "unit_price_ugx": unit_price,
                }
            )
        )


async def load_line_items(
    db_session: AsyncSession,
    model: type[T],
    fk_name: str,
    record_id: uuid.UUID,
) -> list[T]:
    fk_col = getattr(model, fk_name)
    position_col = model.position
    return list(
        (await db_session.execute(select(model).where(fk_col == record_id).order_by(position_col)))
        .scalars()
        .all()
    )


def line_items_read(items: Iterable[Any]) -> list[CommercialLineItemRead]:
    return [
        CommercialLineItemRead(
            id=item.id,
            position=item.position,
            description=item.description,
            quantity=float(item.quantity or 0),
            unit_price_ugx=float(item.unit_price_ugx or 0),
            amount_ugx=float((item.quantity or Decimal()) * (item.unit_price_ugx or Decimal())),
        )
        for item in items
    ]


async def next_business_number(
    db_session: AsyncSession,
    document_type: str,
    when: date,
) -> str:
    if document_type not in PREFIXES:
        raise ValueError(f"Unsupported business document type: {document_type}")
    year = when.year
    lock_key = f"starafrica-business-number:{document_type}:{year}"
    await db_session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": lock_key}
    )
    counter = (
        await db_session.execute(
            select(BusinessNumberCounter).where(
                BusinessNumberCounter.document_type == document_type,
                BusinessNumberCounter.year == year,
            )
        )
    ).scalar_one_or_none()
    if counter is None:
        counter = BusinessNumberCounter(document_type=document_type, year=year, last_value=0)
        db_session.add(counter)
        await db_session.flush()
    counter.last_value += 1
    await db_session.flush()
    return f"{PREFIXES[document_type]}-{year}-{counter.last_value:04d}"


async def record_document_event(
    db_session: AsyncSession,
    document: Document,
    action: str,
    actor_email: str,
    details: dict[str, Any] | None = None,
) -> BusinessDocumentEvent:
    event = BusinessDocumentEvent(
        document_id=document.id,
        action=action.strip().lower(),
        actor_email=actor_email.strip().lower(),
        details=details or {},
    )
    db_session.add(event)
    await db_session.flush()
    return event


async def current_generated_document(
    db_session: AsyncSession, related_record_type: str, related_record_id: uuid.UUID
) -> Document | None:
    return (
        (
            await db_session.execute(
                select(Document)
                .where(
                    Document.category == "generated_commercial",
                    Document.related_record_type == related_record_type,
                    Document.related_record_id == related_record_id,
                    Document.is_current.is_(True),
                    Document.is_deleted.is_(False),
                )
                .order_by(Document.version.desc(), Document.created_at.desc())
            )
        )
        .scalars()
        .first()
    )


async def latest_generated_version(
    db_session: AsyncSession, related_record_type: str, related_record_id: uuid.UUID
) -> int:
    value = await db_session.scalar(
        select(func.max(Document.version)).where(
            Document.category == "generated_commercial",
            Document.related_record_type == related_record_type,
            Document.related_record_id == related_record_id,
        )
    )
    return int(value or 0)


async def has_current_preview(
    db_session: AsyncSession, related_record_type: str, related_record_id: uuid.UUID
) -> bool:
    document = await current_generated_document(db_session, related_record_type, related_record_id)
    if document is None:
        return False
    event_id = await db_session.scalar(
        select(BusinessDocumentEvent.id)
        .where(
            BusinessDocumentEvent.document_id == document.id,
            BusinessDocumentEvent.action == "previewed",
        )
        .limit(1)
    )
    return event_id is not None


async def current_document_has_action(
    db_session: AsyncSession,
    related_record_type: str,
    related_record_id: uuid.UUID,
    actions: set[str],
) -> bool:
    document = await current_generated_document(db_session, related_record_type, related_record_id)
    if document is None:
        return False
    event_id = await db_session.scalar(
        select(BusinessDocumentEvent.id)
        .where(
            BusinessDocumentEvent.document_id == document.id,
            BusinessDocumentEvent.action.in_(sorted(actions)),
        )
        .limit(1)
    )
    return event_id is not None


async def require_current_preview(
    db_session: AsyncSession, related_record_type: str, related_record_id: uuid.UUID
) -> None:
    if not await current_document_has_action(
        db_session, related_record_type, related_record_id, {"previewed"}
    ):
        raise ValueError("Preview the current document version before issuing or sending it.")


async def require_current_reviewed_version(
    db_session: AsyncSession, related_record_type: str, related_record_id: uuid.UUID
) -> None:
    if not await current_document_has_action(
        db_session, related_record_type, related_record_id, {"previewed", "sent", "issued"}
    ):
        raise ValueError(
            "Preview the revised current document version before continuing its workflow."
        )


async def invalidate_current_generated_document(
    db_session: AsyncSession, related_record_type: str, related_record_id: uuid.UUID
) -> Document | None:
    """Mark the current generated PDF stale when its source record changes.

    The business record remains authoritative. A fresh PDF is created only when
    the user explicitly previews/generates it, preventing storage failures from
    breaking ordinary business saves and preventing stale PDFs from being sent.
    """
    current = await current_generated_document(db_session, related_record_type, related_record_id)
    if current is not None:
        current.is_current = False
        await db_session.flush()
    return current


def document_download_url(document: Document, *, expires: int = 900) -> str:
    if document.storage_key.startswith("documents/local/"):
        return f"/api/v1/documents/{document.id}/content"
    return presign_download(document.storage_key, expires=expires)


async def upsert_generated_document(
    db_session: AsyncSession,
    *,
    pdf_bytes: bytes,
    title: str,
    filename: str,
    uploaded_by_email: str,
    related_record_type: str,
    related_record_id: uuid.UUID,
    project_id: uuid.UUID | None = None,
    client_id: uuid.UUID | None = None,
    supplier_id: uuid.UUID | None = None,
    force_new_version: bool = False,
) -> tuple[Document | None, str | None]:
    use_primary_storage = storage_configured()
    if not use_primary_storage and not local_storage_ready():
        return None, None

    actor = uploaded_by_email.strip().lower()
    content_hash = hashlib.sha256(pdf_bytes).hexdigest()
    current = await current_generated_document(db_session, related_record_type, related_record_id)

    if current is not None and current.content_hash == content_hash and not force_new_version:
        current.project_id = project_id
        current.client_id = client_id
        current.supplier_id = supplier_id
        current.title = title
        current.original_filename = filename
        current.uploaded_by_email = actor

        if not use_primary_storage and not current.storage_key.startswith("documents/local/"):
            safe_filename = filename.replace("/", "-").replace("\\", "-")
            current.storage_key = (
                f"documents/local/generated/{related_record_type}/{related_record_id}/"
                f"v{current.version}/{safe_filename}"
            )
            await put_object_bytes_async(current.storage_key, pdf_bytes, "application/pdf")
        elif not await object_exists_async(current.storage_key):
            await put_object_bytes_async(current.storage_key, pdf_bytes, "application/pdf")

        await db_session.flush()
        return current, document_download_url(current)

    next_version = (
        await latest_generated_version(db_session, related_record_type, related_record_id) + 1
    )
    if current is not None:
        current.is_current = False

    safe_filename = filename.replace("/", "-").replace("\\", "-")
    storage_root = "documents/generated" if use_primary_storage else "documents/local/generated"
    storage_key = (
        f"{storage_root}/{related_record_type}/{related_record_id}/v{next_version}/{safe_filename}"
    )
    await put_object_bytes_async(storage_key, pdf_bytes, "application/pdf")

    document_number = filename.removesuffix(".pdf")
    document = Document(
        project_id=project_id,
        client_id=client_id,
        supplier_id=supplier_id,
        title=title,
        original_filename=filename,
        category="generated_commercial",
        content_type="application/pdf",
        size_bytes=len(pdf_bytes),
        storage_key=storage_key,
        uploaded_by_email=actor,
        ocr_status="not_requested",
        review_status="not_reviewed",
        related_record_type=related_record_type,
        related_record_id=related_record_id,
        document_type=related_record_type,
        document_number=document_number,
        version=next_version,
        is_current=True,
        is_deleted=False,
        supersedes_document_id=current.id if current else None,
        content_hash=content_hash,
    )
    db_session.add(document)
    await db_session.flush()
    await record_document_event(
        db_session,
        document,
        "generated" if current is None else "revised",
        actor,
        {
            "version": next_version,
            "supersedes_document_id": str(current.id) if current else None,
        },
    )
    return document, document_download_url(document)
