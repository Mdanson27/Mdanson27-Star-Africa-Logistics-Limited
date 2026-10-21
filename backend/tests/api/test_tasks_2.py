from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_tasks_2_dashboard_filters_workflow_and_document_link(
    async_client: AsyncClient,
    registered_user: dict,
) -> None:
    suffix = uuid.uuid4().hex[:8]
    headers = {"Authorization": f"Bearer {registered_user['token']}"}
    today = datetime.now(UTC).date()

    project_response = await async_client.post(
        "/api/v1/projects",
        headers=headers,
        json={
            "name": f"Tasks 2 Project {suffix}",
            "client_name": f"Tasks Client {suffix}",
            "status": "active",
            "start_date": str(today),
            "due_date": str(today + timedelta(days=30)),
        },
    )
    assert project_response.status_code == 201, project_response.text
    project_id = project_response.json()["id"]

    document_response = await async_client.post(
        "/api/v1/documents",
        headers=headers,
        json={
            "project_id": project_id,
            "title": f"Task brief {suffix}",
            "original_filename": "task-brief.pdf",
            "category": "other",
            "content_type": "application/pdf",
            "size_bytes": 512,
            "storage_key": f"documents/{project_id}/test/task-brief-{suffix}.pdf",
        },
    )
    assert document_response.status_code == 201, document_response.text
    document_id = document_response.json()["id"]

    task_response = await async_client.post(
        "/api/v1/tasks",
        headers=headers,
        json={
            "project_id": project_id,
            "title": f"Prepare daily work {suffix}",
            "description": "Tasks 2.0 integration coverage",
            "assignee_email": registered_user["email"],
            "status": "todo",
            "priority": "high",
            "start_date": str(today),
            "due_date": str(today),
            "related_document_id": document_id,
        },
    )
    assert task_response.status_code == 201, task_response.text
    task = task_response.json()
    task_id = task["id"]
    assert task["start_date"] == str(today)
    assert task["due_date"] == str(today)
    assert task["related_document_id"] == document_id
    assert task["completed_at"] is None

    mine_response = await async_client.get(
        "/api/v1/tasks",
        headers=headers,
        params={"mine": "true", "priority": "high", "q": suffix},
    )
    assert mine_response.status_code == 200, mine_response.text
    assert any(row["id"] == task_id for row in mine_response.json())

    dashboard_response = await async_client.get("/api/v1/tasks/dashboard", headers=headers)
    assert dashboard_response.status_code == 200, dashboard_response.text
    dashboard = dashboard_response.json()
    assert dashboard["due_today"] >= 1
    assert dashboard["high_priority"] >= 1
    assert dashboard["assigned_to_me"] >= 1

    for status in ("in_progress", "review", "completed"):
        status_response = await async_client.patch(
            f"/api/v1/tasks/{task_id}",
            headers=headers,
            json={"status": status},
        )
        assert status_response.status_code == 200, status_response.text
        assert status_response.json()["status"] == status

    completed = status_response.json()
    assert completed["completed_at"] is not None

    completed_dashboard = await async_client.get("/api/v1/tasks/dashboard", headers=headers)
    assert completed_dashboard.status_code == 200
    assert completed_dashboard.json()["recently_completed"] >= 1

    reopen_response = await async_client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=headers,
        json={"status": "todo", "description": ""},
    )
    assert reopen_response.status_code == 200, reopen_response.text
    assert reopen_response.json()["completed_at"] is None
    assert reopen_response.json()["description"] is None

    invalid_date_response = await async_client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=headers,
        json={
            "start_date": str(today + timedelta(days=2)),
            "due_date": str(today + timedelta(days=1)),
        },
    )
    assert invalid_date_response.status_code == 400, invalid_date_response.text

    clear_links_response = await async_client.patch(
        f"/api/v1/tasks/{task_id}",
        headers=headers,
        json={
            "clear_start_date": True,
            "clear_due_date": True,
            "clear_related_document": True,
        },
    )
    assert clear_links_response.status_code == 200, clear_links_response.text
    assert clear_links_response.json()["start_date"] is None
    assert clear_links_response.json()["due_date"] is None
    assert clear_links_response.json()["related_document_id"] is None

    delete_response = await async_client.delete(f"/api/v1/tasks/{task_id}", headers=headers)
    assert delete_response.status_code == 200, delete_response.text

    remaining_response = await async_client.get("/api/v1/tasks", headers=headers)
    assert remaining_response.status_code == 200
    assert all(row["id"] != task_id for row in remaining_response.json())
