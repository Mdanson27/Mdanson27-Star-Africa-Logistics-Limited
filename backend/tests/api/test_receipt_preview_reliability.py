from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


@pytest.fixture
def mock_receipt_storage(monkeypatch: pytest.MonkeyPatch) -> dict[str, bytes]:
    objects: dict[str, bytes] = {}

    async def put(key: str, content: bytes, _content_type: str) -> None:
        objects[key] = content

    async def exists(key: str) -> bool:
        return key in objects

    def get(key: str) -> bytes:
        return objects[key]

    def url(key: str, expires: int = 900) -> str:
        if key not in objects:
            raise KeyError(key)
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
    return objects


async def test_receipt_preview_is_saved_and_visible_in_documents(
    async_client: AsyncClient,
    registered_user: dict,
    mock_receipt_storage: dict[str, bytes],
) -> None:
    suffix = uuid.uuid4().hex[:8]
    headers = {"Authorization": f"Bearer {registered_user['token']}"}

    client_response = await async_client.post(
        "/api/v1/business/clients",
        headers=headers,
        json={"name": f"Preview Client {suffix}", "email": f"preview.{suffix}@example.com"},
    )
    assert client_response.status_code == 201, client_response.text
    client = client_response.json()

    invoice_response = await async_client.post(
        "/api/v1/business/invoices",
        headers=headers,
        json={
            "invoice_number": "AUTO",
            "client_id": client["id"],
            "client_name": client["name"],
            "amount_ugx": 0,
            "status": "draft",
            "issue_date": "2026-10-11",
            "due_date": "2026-10-31",
            "items": [
                {"description": "Reliability service", "quantity": 1, "unit_price_ugx": 250000}
            ],
        },
    )
    assert invoice_response.status_code == 201, invoice_response.text
    invoice = invoice_response.json()

    invoice_preview = await async_client.post(
        f"/api/v1/business/invoices/{invoice['id']}/preview",
        headers=headers,
    )
    assert invoice_preview.status_code in {200, 201}, invoice_preview.text

    sent = await async_client.patch(
        f"/api/v1/business/invoices/{invoice['id']}",
        headers=headers,
        json={"status": "sent"},
    )
    assert sent.status_code == 200, sent.text

    payment_response = await async_client.post(
        "/api/v1/business/payments",
        headers=headers,
        json={
            "invoice_id": invoice["id"],
            "amount_ugx": 100000,
            "payment_date": "2026-10-11",
            "method": "bank",
            "reference": f"BANK-{suffix}",
        },
    )
    assert payment_response.status_code == 201, payment_response.text
    payment = payment_response.json()

    preview_response = await async_client.post(
        f"/api/v1/business/receipts/{payment['id']}/preview",
        headers=headers,
    )
    assert preview_response.status_code in {200, 201}, preview_response.text
    preview = preview_response.json()
    assert preview["stored"] is True
    assert preview["document_id"]
    assert preview["download_url"].startswith("https://storage.test/")
    assert preview["filename"].startswith("RCT-")

    pdf_response = await async_client.get(
        f"/api/v1/business/receipts/{payment['id']}/pdf",
        headers=headers,
    )
    assert pdf_response.status_code == 200, pdf_response.text
    assert pdf_response.headers["content-type"].startswith("application/pdf")
    assert pdf_response.content.startswith(b"%PDF")

    # This is the generic Documents request that previously surfaced as HTTP 500
    # in the live Business workspace after a receipt had been generated.
    documents_response = await async_client.get("/api/v1/documents", headers=headers)
    assert documents_response.status_code == 200, documents_response.text
    documents = documents_response.json()
    saved = next((row for row in documents if row["id"] == preview["document_id"]), None)
    assert saved is not None
    assert saved["category"] == "generated_commercial"
    assert saved["content_type"] == "application/pdf"
    assert saved["title"].startswith("Receipt RCT-")

    archive_response = await async_client.get("/api/v1/business/documents", headers=headers)
    assert archive_response.status_code == 200, archive_response.text
    archive = archive_response.json()
    archived = next((row for row in archive if row["id"] == preview["document_id"]), None)
    assert archived is not None
    assert archived["document_type"] == "receipt"
    assert archived["is_current"] is True

    view_response = await async_client.post(
        f"/api/v1/business/documents/{preview['document_id']}/view",
        headers=headers,
    )
    assert view_response.status_code in {200, 201}, view_response.text
    assert view_response.json()["download_url"].startswith("https://storage.test/")
