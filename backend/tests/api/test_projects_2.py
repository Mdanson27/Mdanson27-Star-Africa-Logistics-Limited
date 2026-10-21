from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_projects_2_dashboard_filters_actions_and_workspace(
    async_client: AsyncClient,
    registered_user: dict,
) -> None:
    suffix = uuid.uuid4().hex[:8]
    headers = {"Authorization": f"Bearer {registered_user['token']}"}
    today = datetime.now(UTC).date()
    due_date = today + timedelta(days=10)

    create_response = await async_client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "name": f"Projects 2 Project {suffix}",
            "client_name": f"Client {suffix}",
            "description": "Projects 2.0 validation",
            "status": "active",
            "value_ugx": 8_000_000,
            "amount_paid_ugx": 1_000_000,
            "start_date": str(today),
            "due_date": str(due_date),
            "progress": 30,
            "project_manager_email": "manager@bertcom.test",
            "team_emails": ["tech@bertcom.test", "ops@bertcom.test"],
            "tags": ["Priority", "Installation"],
            "current_milestone": "Site preparation",
        },
    )
    assert create_response.status_code == 201, create_response.text
    project = create_response.json()
    project_id = project["id"]
    assert project["project_manager_email"] == registered_user["email"]
    assert project["team_emails"] == ["tech@bertcom.test", "ops@bertcom.test"]
    assert project["tags"] == ["Priority", "Installation"]
    assert project["current_milestone"] == "Site preparation"

    filtered = await async_client.get(
        "/api/v1/projects",
        headers=headers,
        params={
            "manager": registered_user["email"],
            "client": f"Client {suffix}",
            "tag": "Priority",
            "progress_min": 20,
            "progress_max": 40,
            "value_min": 7_000_000,
            "value_max": 9_000_000,
        },
    )
    assert filtered.status_code == 200, filtered.text
    assert any(row["id"] == project_id for row in filtered.json())

    task_response = await async_client.post(
        "/api/v1/tasks",
        headers=headers,
        json={
            "project_id": project_id,
            "title": "Prepare site",
            "status": "todo",
            "priority": "high",
            "assignee_email": "tech@bertcom.test",
            "due_date": str(today),
        },
    )
    assert task_response.status_code == 201, task_response.text
    task = task_response.json()
    assert task["status"] == "todo"

    review_response = await async_client.patch(
        f"/api/v1/tasks/{task['id']}",
        headers=headers,
        json={"status": "review"},
    )
    assert review_response.status_code == 200, review_response.text
    assert review_response.json()["status"] == "review"

    document_response = await async_client.post(
        "/api/v1/documents",
        headers=headers,
        json={
            "project_id": project_id,
            "title": "Approved quotation",
            "original_filename": "quote.pdf",
            "category": "quotation",
            "content_type": "application/pdf",
            "size_bytes": 2048,
            "storage_key": f"documents/{project_id}/test/quote.pdf",
            "ocr_status": "completed",
            "review_status": "reviewed",
            "related_record_type": "quotation",
        },
    )
    assert document_response.status_code == 201, document_response.text
    assert document_response.json()["review_status"] == "reviewed"
    assert document_response.json()["related_record_type"] == "quotation"

    invoice_response = await async_client.post(
        "/api/v1/business/invoices",
        headers=headers,
        json={
            "invoice_number": f"INV-P2-{suffix}",
            "client_name": f"Client {suffix}",
            "project_id": project_id,
            "amount_ugx": 3_000_000,
            "issue_date": str(today),
            "due_date": str(due_date),
        },
    )
    assert invoice_response.status_code == 201, invoice_response.text
    invoice_id = invoice_response.json()["id"]

    link_document_response = await async_client.patch(
        f"/api/v1/documents/{document_response.json()['id']}",
        headers=headers,
        json={
            "related_record_type": "invoice",
            "related_record_id": invoice_id,
        },
    )
    assert link_document_response.status_code == 200, link_document_response.text
    assert link_document_response.json()["related_record_type"] == "invoice"
    assert link_document_response.json()["related_record_id"] == invoice_id

    unlink_document_response = await async_client.patch(
        f"/api/v1/documents/{document_response.json()['id']}",
        headers=headers,
        json={"related_record_type": ""},
    )
    assert unlink_document_response.status_code == 200, unlink_document_response.text
    assert unlink_document_response.json()["related_record_type"] is None
    assert unlink_document_response.json()["related_record_id"] is None

    payment_response = await async_client.post(
        "/api/v1/business/payments",
        headers=headers,
        json={
            "project_id": project_id,
            "invoice_id": invoice_id,
            "amount_ugx": 750_000,
            "payment_date": str(today),
            "method": "bank",
            "reference": f"PAY-{suffix}",
        },
    )
    assert payment_response.status_code == 201, payment_response.text
    assert payment_response.json()["amount_ugx"] == 750_000

    workspace_response = await async_client.get(
        f"/api/v1/projects/{project_id}/workspace",
        headers=headers,
    )
    assert workspace_response.status_code == 200, workspace_response.text
    workspace = workspace_response.json()
    assert workspace["finance"]["payment_total_ugx"] == 750_000
    assert len(workspace["finance"]["payments"]) == 1
    assert workspace["finance"]["payments"][0]["reference"] == f"PAY-{suffix}"
    assert workspace["project"]["amount_paid_ugx"] == 1_750_000
    assert any("Payment created" in activity["summary"] for activity in workspace["activity"])

    dashboard_response = await async_client.get("/api/v1/projects/dashboard", headers=headers)
    assert dashboard_response.status_code == 200, dashboard_response.text
    dashboard = dashboard_response.json()
    assert dashboard["total_projects"] >= 1
    assert dashboard["active_projects"] >= 1
    assert dashboard["total_project_value_ugx"] >= 8_000_000
    assert dashboard["amount_received_ugx"] >= 1_750_000
    assert dashboard["tasks_due"] >= 1

    duplicate_response = await async_client.post(
        f"/api/v1/projects/{project_id}/duplicate",
        headers=headers,
    )
    assert duplicate_response.status_code == 201, duplicate_response.text
    duplicate = duplicate_response.json()
    assert duplicate["name"].endswith("— Copy")
    assert duplicate["status"] == "planning"
    assert duplicate["progress"] == 0
    assert duplicate["amount_paid_ugx"] == 0
    assert duplicate["team_emails"] == ["tech@bertcom.test", "ops@bertcom.test"]
    assert duplicate["tags"] == ["Priority", "Installation"]

    archive_response = await async_client.delete(
        f"/api/v1/projects/{project_id}",
        headers=headers,
    )
    assert archive_response.status_code == 200, archive_response.text

    default_list = await async_client.get("/api/v1/projects", headers=headers)
    assert default_list.status_code == 200
    assert all(row["id"] != project_id for row in default_list.json())

    archived_list = await async_client.get(
        "/api/v1/projects",
        headers=headers,
        params={"include_archived": "true"},
    )
    assert archived_list.status_code == 200
    assert any(row["id"] == project_id and row["is_archived"] for row in archived_list.json())

    restore_response = await async_client.post(
        f"/api/v1/projects/{project_id}/restore",
        headers=headers,
    )
    assert restore_response.status_code == 200, restore_response.text
    assert restore_response.json()["is_archived"] is False
