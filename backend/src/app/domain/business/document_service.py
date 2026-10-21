from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.business.commercial_documents import (
    money,
    render_commercial_document,
    render_statement,
)
from app.domain.business.models import (
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
from app.domain.business.services import load_line_items, upsert_generated_document


def _party_lines(party: Client | Supplier | None) -> list[str]:
    if party is None:
        return []
    return [
        line for line in [party.contact_person, party.address, party.email, party.phone] if line
    ]


def _items(rows) -> list[tuple[str, float, float]]:
    return [
        (row.description, float(row.quantity or 0), float(row.unit_price_ugx or 0)) for row in rows
    ]


async def quotation_pdf(db: AsyncSession, quotation: Quotation) -> bytes:
    client = await db.get(Client, quotation.client_id) if quotation.client_id else None
    lines = await load_line_items(db, QuotationLineItem, "quotation_id", quotation.id)
    return render_commercial_document(
        document_title="Quotation",
        document_number=quotation.quotation_number,
        party_label="Prepared for",
        party_name=client.name if client else quotation.client_name,
        party_lines=_party_lines(client),
        date_rows=[
            ("Issue date", str(quotation.issue_date)),
            ("Valid until", str(quotation.valid_until or "?")),
        ],
        items=_items(lines),
        total_ugx=float(quotation.amount_ugx or 0),
        status=quotation.status,
        notes=quotation.notes,
        footer_note="This quotation was generated from Star Africa Logistics Operating System.",
    )


async def invoice_pdf(db: AsyncSession, invoice: Invoice) -> bytes:
    client = await db.get(Client, invoice.client_id) if invoice.client_id else None
    lines = await load_line_items(db, InvoiceLineItem, "invoice_id", invoice.id)
    total = float(invoice.amount_ugx or 0)
    paid = float(invoice.paid_amount_ugx or 0)
    status = invoice.status
    if total > 0 and paid >= total:
        status = "paid"
    elif paid > 0:
        status = (
            "overdue"
            if invoice.due_date and invoice.due_date < datetime.now(UTC).date()
            else "partially_paid"
        )
    elif status != "draft" and invoice.due_date and invoice.due_date < datetime.now(UTC).date():
        status = "overdue"
    return render_commercial_document(
        document_title="Invoice",
        document_number=invoice.invoice_number,
        party_label="Bill to",
        party_name=client.name if client else invoice.client_name,
        party_lines=_party_lines(client),
        date_rows=[
            ("Issue date", str(invoice.issue_date)),
            ("Due date", str(invoice.due_date or "?")),
        ],
        items=_items(lines),
        total_ugx=total,
        status=status,
        notes=invoice.notes,
        financial_rows=[
            ("Amount paid", money(paid)),
            ("Outstanding balance", money(max(0, total - paid))),
        ],
        footer_note="Please quote the invoice number when making payment.",
    )


async def receipt_pdf(db: AsyncSession, payment: Payment) -> bytes:
    invoice = await db.get(Invoice, payment.invoice_id) if payment.invoice_id else None
    client = await db.get(Client, payment.client_id) if payment.client_id else None
    amount = float(payment.amount_ugx or 0)
    invoice_number = invoice.invoice_number if invoice else "General payment"
    outstanding = 0.0
    if invoice:
        outstanding = max(
            0.0, float((invoice.amount_ugx or Decimal()) - (invoice.paid_amount_ugx or Decimal()))
        )
    return render_commercial_document(
        document_title="Receipt",
        document_number=payment.receipt_number or f"RCT-{str(payment.id)[:8].upper()}",
        party_label="Received from",
        party_name=client.name if client else (invoice.client_name if invoice else "Client"),
        party_lines=_party_lines(client),
        date_rows=[("Payment date", str(payment.payment_date)), ("Invoice", invoice_number)],
        items=[(f"Payment received for {invoice_number}", 1.0, amount)],
        total_ugx=amount,
        status="confirmed",
        notes=payment.notes,
        financial_rows=[
            ("Payment method", payment.method.replace("_", " ").title()),
            ("Transaction / reference", payment.reference or "?"),
            ("Invoice balance remaining", money(outstanding)),
        ],
        footer_note="Payment received with thanks.",
    )


async def purchase_order_pdf(db: AsyncSession, order: PurchaseOrder) -> bytes:
    supplier = await db.get(Supplier, order.supplier_id) if order.supplier_id else None
    lines = await load_line_items(db, PurchaseOrderLineItem, "purchase_order_id", order.id)
    return render_commercial_document(
        document_title="Purchase Order",
        document_number=order.po_number,
        party_label="Supplier",
        party_name=supplier.name if supplier else order.supplier_name,
        party_lines=_party_lines(supplier),
        date_rows=[
            ("Order date", str(order.order_date)),
            ("Expected date", str(order.expected_date or "?")),
        ],
        items=_items(lines),
        total_ugx=float(order.amount_ugx or 0),
        status=order.status,
        notes=order.notes,
        footer_note="Issued by Star Africa Logistics Limited.",
    )


async def ensure_quotation_document(
    db: AsyncSession, quotation: Quotation, actor_email: str, *, force_new_version: bool = False
):
    pdf = await quotation_pdf(db, quotation)
    filename = f"{quotation.quotation_number}.pdf"
    doc, url = await upsert_generated_document(
        db,
        pdf_bytes=pdf,
        title=f"Quotation {quotation.quotation_number}",
        filename=filename,
        uploaded_by_email=actor_email,
        related_record_type="quotation",
        related_record_id=quotation.id,
        project_id=quotation.project_id,
        client_id=quotation.client_id,
        force_new_version=force_new_version,
    )
    return pdf, doc, url, filename


async def ensure_invoice_document(
    db: AsyncSession, invoice: Invoice, actor_email: str, *, force_new_version: bool = False
):
    pdf = await invoice_pdf(db, invoice)
    filename = f"{invoice.invoice_number}.pdf"
    doc, url = await upsert_generated_document(
        db,
        pdf_bytes=pdf,
        title=f"Invoice {invoice.invoice_number}",
        filename=filename,
        uploaded_by_email=actor_email,
        related_record_type="invoice",
        related_record_id=invoice.id,
        project_id=invoice.project_id,
        client_id=invoice.client_id,
        force_new_version=force_new_version,
    )
    return pdf, doc, url, filename


async def ensure_receipt_document(
    db: AsyncSession, payment: Payment, actor_email: str, *, force_new_version: bool = False
):
    pdf = await receipt_pdf(db, payment)
    number = payment.receipt_number or f"RCT-{str(payment.id)[:8].upper()}"
    filename = f"{number}.pdf"
    doc, url = await upsert_generated_document(
        db,
        pdf_bytes=pdf,
        title=f"Receipt {number}",
        filename=filename,
        uploaded_by_email=actor_email,
        related_record_type="receipt",
        related_record_id=payment.id,
        project_id=payment.project_id,
        client_id=payment.client_id,
        force_new_version=force_new_version,
    )
    return pdf, doc, url, filename


async def ensure_purchase_order_document(
    db: AsyncSession, order: PurchaseOrder, actor_email: str, *, force_new_version: bool = False
):
    pdf = await purchase_order_pdf(db, order)
    filename = f"{order.po_number}.pdf"
    doc, url = await upsert_generated_document(
        db,
        pdf_bytes=pdf,
        title=f"Purchase Order {order.po_number}",
        filename=filename,
        uploaded_by_email=actor_email,
        related_record_type="purchase_order",
        related_record_id=order.id,
        project_id=order.project_id,
        supplier_id=order.supplier_id,
        force_new_version=force_new_version,
    )
    return pdf, doc, url, filename


async def client_statement_pdf(db: AsyncSession, client: Client) -> bytes:
    invoices = list(
        (await db.execute(select(Invoice).where(Invoice.client_id == client.id))).scalars().all()
    )
    payments = list(
        (await db.execute(select(Payment).where(Payment.client_id == client.id))).scalars().all()
    )
    events: list[tuple[date, str, str, float, float]] = []
    for invoice in invoices:
        events.append(
            (
                invoice.issue_date,
                "Invoice",
                invoice.invoice_number,
                float(invoice.amount_ugx or 0),
                0.0,
            )
        )
    for payment in payments:
        events.append(
            (
                payment.payment_date,
                "Receipt",
                payment.receipt_number or "Receipt",
                0.0,
                float(payment.amount_ugx or 0),
            )
        )
    events.sort(key=lambda row: (row[0], row[1], row[2]))
    running = 0.0
    rows = []
    for event_date, kind, reference, debit, credit in events:
        running += debit - credit
        rows.append((str(event_date), kind, reference, debit, credit, running))
    invoiced = sum(float(x.amount_ugx or 0) for x in invoices)
    paid = sum(float(x.amount_ugx or 0) for x in payments)
    number = f"CLIENT-STMT-{client.id.hex[:8].upper()}"
    return render_statement(
        document_title="Client Statement",
        document_number=number,
        party_label="Client",
        party_name=client.name,
        party_lines=_party_lines(client),
        rows=rows,
        summary_rows=[
            ("Total invoiced", money(invoiced)),
            ("Total received", money(paid)),
            ("Outstanding balance", money(max(0, invoiced - paid))),
        ],
    )


async def supplier_statement_pdf(db: AsyncSession, supplier: Supplier) -> bytes:
    orders = list(
        (await db.execute(select(PurchaseOrder).where(PurchaseOrder.supplier_id == supplier.id)))
        .scalars()
        .all()
    )
    expenses = list(
        (await db.execute(select(Expense).where(Expense.supplier_id == supplier.id)))
        .scalars()
        .all()
    )
    events: list[tuple[date, str, str, float, float]] = []
    for order in orders:
        events.append(
            (order.order_date, "Purchase Order", order.po_number, float(order.amount_ugx or 0), 0.0)
        )
    for expense in expenses:
        events.append(
            (
                expense.expense_date,
                "Expense",
                expense.reference or expense.description,
                0.0,
                float(expense.amount_ugx or 0),
            )
        )
    events.sort(key=lambda row: (row[0], row[1], row[2]))
    running = 0.0
    rows = []
    for event_date, kind, reference, debit, credit in events:
        running += debit - credit
        rows.append((str(event_date), kind, reference, debit, credit, running))
    po_total = sum(float(x.amount_ugx or 0) for x in orders)
    expense_total = sum(float(x.amount_ugx or 0) for x in expenses)
    number = f"SUPPLIER-SUM-{supplier.id.hex[:8].upper()}"
    return render_statement(
        document_title="Supplier Purchase Summary",
        document_number=number,
        party_label="Supplier",
        party_name=supplier.name,
        party_lines=_party_lines(supplier),
        rows=rows,
        summary_rows=[
            ("Purchase orders", money(po_total)),
            ("Recorded supplier expenses", money(expense_total)),
        ],
    )
