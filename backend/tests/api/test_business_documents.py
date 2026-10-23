"""Step 2 commercial workflow and PDF document generation coverage."""

import re
import uuid

import pytest
from httpx import AsyncClient

from app.core.settings import settings

pytestmark = pytest.mark.asyncio


@pytest.fixture
def mock_commercial_storage(monkeypatch):
    objects: dict[str, bytes] = {}

    async def put(key: str, content: bytes, _content_type: str) -> None:
        objects[key] = content

    async def exists(key: str) -> bool:
        return key in objects

    def get(key: str) -> bytes:
        return objects[key]

    def delete(key: str) -> None:
        objects.pop(key, None)

    def url(key: str, expires: int = 900) -> str:
        return f"https://storage.test/{key}?expires={expires}"

    monkeypatch.setattr("app.domain.business.services.storage_configured", lambda: True)
    monkeypatch.setattr("app.domain.business.services.put_object_bytes_async", put)
    monkeypatch.setattr("app.domain.business.services.object_exists_async", exists)
    monkeypatch.setattr("app.domain.business.services.presign_download", url)
    monkeypatch.setattr(
        "app.presentation.api.v1.commercial_documents_controller.object_exists_async", exists
    )
    monkeypatch.setattr(
        "app.presentation.api.v1.commercial_documents_controller.get_object_bytes", get
    )
    monkeypatch.setattr(
        "app.presentation.api.v1.commercial_documents_controller.delete_object", delete
    )
    return objects


class TestBusinessDocumentsWorkflow:
    async def test_quote_to_invoice_payment_receipt_and_pdf_chain(
        self,
        async_client: AsyncClient,
        registered_user: dict,
        mock_commercial_storage: dict[str, bytes],
    ) -> None:
        suffix = uuid.uuid4().hex[:8]
        headers = {"Authorization": f"Bearer {registered_user['token']}"}

        client_res = await async_client.post(
            "/api/v1/business/clients",
            headers=headers,
            json={"name": f"Step 2 Client {suffix}", "email": f"client.{suffix}@example.com"},
        )
        assert client_res.status_code == 201, client_res.text
        client = client_res.json()

        supplier_res = await async_client.post(
            "/api/v1/business/suppliers",
            headers=headers,
            json={"name": f"Step 2 Supplier {suffix}", "email": f"supplier.{suffix}@example.com"},
        )
        assert supplier_res.status_code == 201, supplier_res.text
        supplier = supplier_res.json()

        project_res = await async_client.post(
            "/api/v1/projects",
            headers=headers,
            json={
                "name": f"Commercial Project {suffix}",
                "client_id": client["id"],
                "client_name": client["name"],
                "status": "active",
                "value_ugx": 5_000_000,
            },
        )
        assert project_res.status_code == 201, project_res.text
        project = project_res.json()

        quote_res = await async_client.post(
            "/api/v1/business/quotations",
            headers=headers,
            json={
                "quotation_number": "AUTO",
                "client_id": client["id"],
                "client_name": client["name"],
                "project_id": project["id"],
                "amount_ugx": 0,
                "status": "draft",
                "issue_date": "2026-10-06",
                "valid_until": "2026-10-20",
                "items": [
                    {
                        "description": "Supply of equipment",
                        "quantity": 2,
                        "unit_price_ugx": 750_000,
                    },
                    {
                        "description": "Installation service",
                        "quantity": 1,
                        "unit_price_ugx": 500_000,
                    },
                ],
            },
        )
        assert quote_res.status_code == 201, quote_res.text
        quote = quote_res.json()
        assert re.fullmatch(r"QTN-2026-\d{4}", quote["quotation_number"])
        assert quote["amount_ugx"] == 2_000_000

        quote_pdf = await async_client.get(
            f"/api/v1/business/quotations/{quote['id']}/pdf", headers=headers
        )
        assert quote_pdf.status_code == 200, quote_pdf.text
        assert quote_pdf.headers["content-type"].startswith("application/pdf")
        assert quote_pdf.content.startswith(b"%PDF")
        assert len(quote_pdf.content) > 1000

        blocked_approval = await async_client.patch(
            f"/api/v1/business/quotations/{quote['id']}",
            headers=headers,
            json={"status": "accepted"},
        )
        assert blocked_approval.status_code == 409
        assert "Preview" in blocked_approval.text

        quote_preview = await async_client.post(
            f"/api/v1/business/quotations/{quote['id']}/preview", headers=headers
        )
        assert quote_preview.status_code == 201 or quote_preview.status_code == 200, (
            quote_preview.text
        )
        assert quote_preview.json()["stored"] is True
        assert quote_preview.json()["download_url"].startswith("https://storage.test/")

        quotations_after_preview = await async_client.get(
            "/api/v1/business/quotations", headers=headers
        )
        assert quotations_after_preview.status_code == 200, quotations_after_preview.text
        previewed_quote = next(
            row for row in quotations_after_preview.json() if row["id"] == quote["id"]
        )
        assert previewed_quote["has_current_preview"] is True

        conversion = await async_client.post(
            f"/api/v1/business/quotations/{quote['id']}/convert-to-invoice",
            headers=headers,
            json={"issue_date": "2026-10-06", "due_date": "2026-10-31"},
        )
        assert conversion.status_code == 201, conversion.text

        quotations_after_conversion = await async_client.get(
            "/api/v1/business/quotations", headers=headers
        )
        converted_quote = next(
            row for row in quotations_after_conversion.json() if row["id"] == quote["id"]
        )
        assert converted_quote["status"] == "accepted"
        assert converted_quote["has_current_preview"] is True

        invalid_reopen = await async_client.patch(
            f"/api/v1/business/quotations/{quote['id']}", headers=headers, json={"status": "draft"}
        )
        assert invalid_reopen.status_code == 409
        invoice = conversion.json()
        assert re.fullmatch(r"INV-2026-\d{4}", invoice["invoice_number"])
        assert invoice["source_quotation_id"] == quote["id"]
        assert invoice["amount_ugx"] == quote["amount_ugx"]
        assert len(invoice["items"]) == 2
        assert invoice["items"][0]["description"] == "Supply of equipment"

        duplicate_conversion = await async_client.post(
            f"/api/v1/business/quotations/{quote['id']}/convert-to-invoice",
            headers=headers,
            json={"issue_date": "2026-10-06", "due_date": "2026-10-31"},
        )
        assert duplicate_conversion.status_code == 201
        assert duplicate_conversion.json()["id"] == invoice["id"]

        invoice_pdf = await async_client.get(
            f"/api/v1/business/invoices/{invoice['id']}/pdf", headers=headers
        )
        assert invoice_pdf.status_code == 200
        assert invoice_pdf.content.startswith(b"%PDF")

        blocked_invoice_send = await async_client.patch(
            f"/api/v1/business/invoices/{invoice['id']}", headers=headers, json={"status": "sent"}
        )
        assert blocked_invoice_send.status_code == 409
        invoice_preview = await async_client.post(
            f"/api/v1/business/invoices/{invoice['id']}/preview", headers=headers
        )
        assert invoice_preview.status_code in {200, 201}, invoice_preview.text
        sent_invoice = await async_client.patch(
            f"/api/v1/business/invoices/{invoice['id']}", headers=headers, json={"status": "sent"}
        )
        assert sent_invoice.status_code == 200, sent_invoice.text

        payment_one = await async_client.post(
            "/api/v1/business/payments",
            headers=headers,
            json={
                "invoice_id": invoice["id"],
                "amount_ugx": 750_000,
                "payment_date": "2026-10-06",
                "method": "bank",
                "reference": f"BANK-{suffix}",
            },
        )
        assert payment_one.status_code == 201, payment_one.text
        first_payment = payment_one.json()
        assert re.fullmatch(r"RCT-2026-\d{4}", first_payment["receipt_number"])

        receipt_pdf = await async_client.get(
            f"/api/v1/business/receipts/{first_payment['id']}/pdf", headers=headers
        )
        assert receipt_pdf.status_code == 200
        assert receipt_pdf.content.startswith(b"%PDF")

        invoices = await async_client.get(
            "/api/v1/business/invoices", headers=headers, params={"client_id": client["id"]}
        )
        after_partial = next(item for item in invoices.json() if item["id"] == invoice["id"])
        assert after_partial["paid_amount_ugx"] == 750_000
        assert after_partial["outstanding_amount_ugx"] == 1_250_000
        assert after_partial["status"] == "partially_paid"

        payment_two = await async_client.post(
            "/api/v1/business/payments",
            headers=headers,
            json={
                "invoice_id": invoice["id"],
                "amount_ugx": 1_250_000,
                "payment_date": "2026-10-06",
                "method": "mobile_money",
                "reference": f"MM-{suffix}",
            },
        )
        assert payment_two.status_code == 201, payment_two.text
        second_payment = payment_two.json()
        assert second_payment["receipt_number"] != first_payment["receipt_number"]

        invoices = await async_client.get(
            "/api/v1/business/invoices", headers=headers, params={"client_id": client["id"]}
        )
        paid_invoice = next(item for item in invoices.json() if item["id"] == invoice["id"])
        assert paid_invoice["paid_amount_ugx"] == 2_000_000
        assert paid_invoice["outstanding_amount_ugx"] == 0
        assert paid_invoice["status"] == "paid"

        po_res = await async_client.post(
            "/api/v1/business/purchase-orders",
            headers=headers,
            json={
                "po_number": "AUTO",
                "supplier_id": supplier["id"],
                "supplier_name": supplier["name"],
                "project_id": project["id"],
                "amount_ugx": 0,
                "status": "draft",
                "order_date": "2026-10-06",
                "items": [{"description": "Materials", "quantity": 10, "unit_price_ugx": 35_000}],
            },
        )
        assert po_res.status_code == 201, po_res.text
        po = po_res.json()
        assert re.fullmatch(r"PO-2026-\d{4}", po["po_number"])
        assert po["amount_ugx"] == 350_000
        blocked_po_issue = await async_client.patch(
            f"/api/v1/business/purchase-orders/{po['id']}",
            headers=headers,
            json={"status": "issued"},
        )
        assert blocked_po_issue.status_code == 409
        po_preview = await async_client.post(
            f"/api/v1/business/purchase-orders/{po['id']}/preview", headers=headers
        )
        assert po_preview.status_code in {200, 201}, po_preview.text
        for status in ("issued", "received", "closed"):
            status_res = await async_client.patch(
                f"/api/v1/business/purchase-orders/{po['id']}",
                headers=headers,
                json={"status": status},
            )
            assert status_res.status_code == 200, status_res.text
        po_pdf = await async_client.get(
            f"/api/v1/business/purchase-orders/{po['id']}/pdf", headers=headers
        )
        assert po_pdf.status_code == 200
        assert po_pdf.content.startswith(b"%PDF")

        client_statement_pdf = await async_client.get(
            f"/api/v1/business/clients/{client['id']}/statement/pdf", headers=headers
        )
        assert client_statement_pdf.status_code == 200
        assert client_statement_pdf.content.startswith(b"%PDF")

        supplier_statement_pdf = await async_client.get(
            f"/api/v1/business/suppliers/{supplier['id']}/statement/pdf", headers=headers
        )
        assert supplier_statement_pdf.status_code == 200
        assert supplier_statement_pdf.content.startswith(b"%PDF")
        client_statement_document = await async_client.post(
            f"/api/v1/business/clients/{client['id']}/statement/document", headers=headers
        )
        assert client_statement_document.status_code in {200, 201}, client_statement_document.text
        statement_document_id = client_statement_document.json()["document_id"]
        assert statement_document_id

        archive = await async_client.get("/api/v1/business/documents", headers=headers)
        assert archive.status_code == 200, archive.text
        archived = archive.json()
        quote_versions = [
            row
            for row in archived
            if row["related_record_type"] == "quotation" and row["related_record_id"] == quote["id"]
        ]
        # Ordinary workflow/status saves must not create extra archived PDFs.
        # Only an explicit Preview/Generate action persists a document version.
        assert len(quote_versions) == 1
        assert sum(1 for row in quote_versions if row["is_current"]) == 1
        assert quote_versions[0]["version"] == 1
        assert any(row["document_type"] == "client_statement" for row in archived)

        current_quote_doc = max(quote_versions, key=lambda row: row["version"])
        quote_history = await async_client.get(
            f"/api/v1/business/documents/{current_quote_doc['id']}/history", headers=headers
        )
        assert quote_history.status_code == 200, quote_history.text
        assert any(event["action"] == "accepted" for event in quote_history.json())

        view_action = await async_client.post(
            f"/api/v1/business/documents/{current_quote_doc['id']}/view", headers=headers
        )
        assert view_action.status_code in {200, 201}, view_action.text
        assert view_action.json()["download_url"].startswith("https://storage.test/")

        # Editing source content invalidates the old archived PDF immediately, but does
        # not regenerate during the save request. Explicit Preview creates the next
        # immutable version and marks that exact version as reviewed.
        revised = await async_client.patch(
            f"/api/v1/business/quotations/{quote['id']}",
            headers=headers,
            json={"notes": "Revised commercial terms for archive test"},
        )
        assert revised.status_code == 200, revised.text
        archive_after_revision = (
            await async_client.get("/api/v1/business/documents", headers=headers)
        ).json()
        revised_versions = [
            row
            for row in archive_after_revision
            if row["related_record_type"] == "quotation" and row["related_record_id"] == quote["id"]
        ]
        assert len(revised_versions) == 1
        assert all(not row["is_current"] for row in revised_versions)

        revised_preview = await async_client.post(
            f"/api/v1/business/quotations/{quote['id']}/preview", headers=headers
        )
        assert revised_preview.status_code in {200, 201}
        revised_document_id = revised_preview.json()["document_id"]
        assert revised_document_id
        archive_after_preview = (
            await async_client.get("/api/v1/business/documents", headers=headers)
        ).json()
        revised_versions = [
            row
            for row in archive_after_preview
            if row["related_record_type"] == "quotation" and row["related_record_id"] == quote["id"]
        ]
        assert max(row["version"] for row in revised_versions) > current_quote_doc["version"]
        revised_current = next(row for row in revised_versions if row["is_current"])
        assert revised_current["id"] == revised_document_id
        shared = await async_client.post(
            f"/api/v1/business/documents/{revised_current['id']}/share", headers=headers
        )
        assert shared.status_code in {200, 201}, shared.text
        assert shared.json()["download_url"].startswith("https://storage.test/")

        soft_delete = await async_client.delete(
            f"/api/v1/business/documents/{statement_document_id}", headers=headers
        )
        assert soft_delete.status_code == 200, soft_delete.text
        active_archive = (
            await async_client.get("/api/v1/business/documents", headers=headers)
        ).json()
        assert all(row["id"] != statement_document_id for row in active_archive)
        restored = await async_client.post(
            f"/api/v1/business/documents/{statement_document_id}/restore", headers=headers
        )
        assert restored.status_code in {200, 201}, restored.text
        assert restored.json()["document"]["is_deleted"] is False
        assert mock_commercial_storage


class TestBusinessPreviewWithoutStorage:
    async def test_preview_unlocks_quotation_conversion_when_storage_is_offline(
        self,
        async_client: AsyncClient,
        registered_user: dict,
        monkeypatch,
    ) -> None:
        monkeypatch.setattr("app.domain.business.services.storage_configured", lambda: False)
        monkeypatch.setattr("app.domain.business.services.local_storage_ready", lambda: False)
        suffix = uuid.uuid4().hex[:8]
        headers = {"Authorization": f"Bearer {registered_user['token']}"}

        client_res = await async_client.post(
            "/api/v1/business/clients",
            headers=headers,
            json={"name": f"No Storage Client {suffix}"},
        )
        assert client_res.status_code == 201, client_res.text
        client = client_res.json()

        quote_res = await async_client.post(
            "/api/v1/business/quotations",
            headers=headers,
            json={
                "quotation_number": "AUTO",
                "client_id": client["id"],
                "client_name": client["name"],
                "status": "draft",
                "issue_date": "2026-10-22",
                "amount_ugx": 500000,
                "items": [
                    {
                        "description": "Resilient quotation line",
                        "quantity": 1,
                        "unit_price_ugx": 500000,
                    }
                ],
            },
        )
        assert quote_res.status_code == 201, quote_res.text
        quote = quote_res.json()

        preview = await async_client.post(
            f"/api/v1/business/quotations/{quote['id']}/preview",
            headers=headers,
        )
        assert preview.status_code in {200, 201}, preview.text
        assert preview.json()["stored"] is False
        assert preview.json()["document_id"] is None

        listing = await async_client.get("/api/v1/business/quotations", headers=headers)
        assert listing.status_code == 200, listing.text
        previewed = next(row for row in listing.json() if row["id"] == quote["id"])
        assert previewed["has_current_preview"] is True

        conversion = await async_client.post(
            f"/api/v1/business/quotations/{quote['id']}/convert-to-invoice",
            headers=headers,
            json={"issue_date": "2026-10-22", "due_date": "2026-11-22"},
        )
        assert conversion.status_code == 201, conversion.text
        assert conversion.json()["source_quotation_id"] == quote["id"]


async def test_client_statement_uses_persistent_local_storage_fallback(
    async_client: AsyncClient,
    registered_user: dict,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(settings, "DOCUMENTS_LOCAL_DIR", str(tmp_path))
    monkeypatch.setattr("app.domain.business.services.storage_configured", lambda: False)

    suffix = uuid.uuid4().hex[:8]
    headers = {"Authorization": f"Bearer {registered_user['token']}"}
    client_response = await async_client.post(
        "/api/v1/business/clients",
        headers=headers,
        json={"name": f"Local Statement Client {suffix}"},
    )
    assert client_response.status_code == 201, client_response.text
    client = client_response.json()

    generated = await async_client.post(
        f"/api/v1/business/clients/{client['id']}/statement/document",
        headers=headers,
    )
    assert generated.status_code in {200, 201}, generated.text
    payload = generated.json()
    assert payload["stored"] is True
    assert payload["document_id"]
    assert payload["download_url"] == f"/api/v1/documents/{payload['document_id']}/content"

    content = await async_client.get(payload["download_url"], headers=headers)
    assert content.status_code == 200, content.text
    assert content.headers["content-type"].startswith("application/pdf")
    assert content.content.startswith(b"%PDF")
