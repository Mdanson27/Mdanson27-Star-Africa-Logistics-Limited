"""Regression coverage for Bertcom Business workflows."""

import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


class TestBusinessWorkflows:
    async def test_authenticated_user_can_create_business_records(
        self,
        async_client: AsyncClient,
        registered_user: dict,
    ) -> None:
        suffix = uuid.uuid4().hex[:8]
        headers = {"Authorization": f"Bearer {registered_user['token']}"}

        client = await async_client.post(
            "/api/v1/business/clients",
            headers=headers,
            json={"name": f"Client {suffix}", "email": f"client.{suffix}@example.com"},
        )
        assert client.status_code == 201, client.text
        client_id = client.json()["id"]
        supplier = await async_client.post(
            "/api/v1/business/suppliers",
            headers=headers,
            json={"name": f"Supplier {suffix}", "phone": "0700000000"},
        )
        assert supplier.status_code == 201, supplier.text
        supplier_id = supplier.json()["id"]

        records = (
            (
                "quotations",
                {
                    "quotation_number": f"Q-{suffix}",
                    "client_name": f"Client {suffix}",
                    "client_id": client_id,
                    "amount_ugx": 1500000,
                    "issue_date": "2026-10-01",
                },
            ),
            (
                "invoices",
                {
                    "invoice_number": f"INV-{suffix}",
                    "client_name": f"Client {suffix}",
                    "client_id": client_id,
                    "amount_ugx": 1200000,
                    "paid_amount_ugx": 200000,
                    "issue_date": "2026-10-01",
                },
            ),
            (
                "purchase-orders",
                {
                    "po_number": f"PO-{suffix}",
                    "supplier_name": f"Supplier {suffix}",
                    "supplier_id": supplier_id,
                    "amount_ugx": 600000,
                    "order_date": "2026-10-01",
                },
            ),
            (
                "expenses",
                {
                    "description": f"Expense {suffix}",
                    "supplier_id": supplier_id,
                    "amount_ugx": 100000,
                    "expense_date": "2026-10-01",
                    "category": "testing",
                },
            ),
        )
        for endpoint, payload in records:
            response = await async_client.post(
                f"/api/v1/business/{endpoint}",
                headers=headers,
                json=payload,
            )
            assert response.status_code == 201, (endpoint, response.text)

        summary = await async_client.get("/api/v1/business/summary", headers=headers)
        assert summary.status_code == 200, summary.text
        body = summary.json()
        assert body["clients"] >= 1
        assert body["suppliers"] >= 1
        assert body["invoice_outstanding_ugx"] >= 1000000
        assert body["expenses_ugx"] >= 100000
