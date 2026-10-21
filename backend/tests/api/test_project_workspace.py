import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_project_workspace_aggregates_project_folder(
    async_client: AsyncClient,
    registered_user: dict,
) -> None:
    suffix = uuid.uuid4().hex[:8]
    headers = {"Authorization": f"Bearer {registered_user['token']}"}

    project_response = await async_client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "name": f"Workspace Project {suffix}",
            "client_name": f"Client {suffix}",
            "description": "Complete working project folder",
            "value_ugx": 5_000_000,
            "amount_paid_ugx": 1_000_000,
            "status": "active",
            "progress": 35,
        },
    )
    assert project_response.status_code == 201, project_response.text
    project_id = project_response.json()["id"]

    task_response = await async_client.post(
        "/api/v1/tasks",
        headers=headers,
        json={
            "project_id": project_id,
            "title": "Prepare delivery plan",
            "status": "pending",
            "priority": "high",
        },
    )
    assert task_response.status_code == 201, task_response.text

    document_response = await async_client.post(
        "/api/v1/documents",
        headers=headers,
        json={
            "project_id": project_id,
            "title": "Signed contract",
            "original_filename": "contract.pdf",
            "category": "contract",
            "content_type": "application/pdf",
            "size_bytes": 2048,
            "storage_key": f"documents/{project_id}/test/contract.pdf",
        },
    )
    assert document_response.status_code == 201, document_response.text

    finance_payloads = (
        (
            "/api/v1/business/quotations",
            {
                "quotation_number": f"Q-{suffix}",
                "client_name": f"Client {suffix}",
                "project_id": project_id,
                "amount_ugx": 2_000_000,
                "issue_date": "2026-10-02",
            },
        ),
        (
            "/api/v1/business/invoices",
            {
                "invoice_number": f"INV-{suffix}",
                "client_name": f"Client {suffix}",
                "project_id": project_id,
                "amount_ugx": 1_500_000,
                "paid_amount_ugx": 500_000,
                "issue_date": "2026-10-02",
            },
        ),
        (
            "/api/v1/business/purchase-orders",
            {
                "po_number": f"PO-{suffix}",
                "supplier_name": f"Supplier {suffix}",
                "project_id": project_id,
                "amount_ugx": 700_000,
                "order_date": "2026-10-02",
            },
        ),
        (
            "/api/v1/business/expenses",
            {
                "description": "Project transport",
                "project_id": project_id,
                "amount_ugx": 250_000,
                "expense_date": "2026-10-02",
                "category": "transport",
            },
        ),
    )

    for endpoint, payload in finance_payloads:
        response = await async_client.post(endpoint, headers=headers, json=payload)
        assert response.status_code == 201, (endpoint, response.text)

    workspace_response = await async_client.get(
        f"/api/v1/projects/{project_id}/workspace",
        headers=headers,
    )
    assert workspace_response.status_code == 200, workspace_response.text
    workspace = workspace_response.json()

    assert workspace["project"]["id"] == project_id
    assert workspace["project"]["progress"] == 35
    assert len(workspace["tasks"]) == 1
    assert workspace["tasks"][0]["title"] == "Prepare delivery plan"
    assert len(workspace["documents"]) == 1
    assert workspace["documents"][0]["title"] == "Signed contract"

    finance = workspace["finance"]
    assert finance["project_value_ugx"] == 5_000_000
    assert finance["project_outstanding_ugx"] == 4_000_000
    assert finance["quotation_total_ugx"] == 2_000_000
    assert finance["invoice_total_ugx"] == 1_500_000
    assert finance["invoice_paid_ugx"] == 500_000
    assert finance["invoice_outstanding_ugx"] == 1_000_000
    assert finance["purchase_orders_ugx"] == 700_000
    assert finance["expenses_ugx"] == 250_000

    activity_tables = {item["table_name"] for item in workspace["activity"]}
    assert {
        "projects",
        "project_tasks",
        "documents",
        "quotations",
        "invoices",
        "purchase_orders",
        "expenses",
    }.issubset(activity_tables)
