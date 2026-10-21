from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_bid_lifecycle_and_project_conversion(
    async_client: AsyncClient, registered_user: dict
):
    headers = {"Authorization": f"Bearer {registered_user['token']}"}
    tender_no = f"TND-{uuid.uuid4().hex[:8].upper()}"

    created = await async_client.post(
        "/api/v1/bids",
        headers=headers,
        json={
            "tender_number": tender_no,
            "title": "Regional ICT Equipment Supply",
            "procuring_entity": "Test Procuring Entity",
            "status": "opportunity",
            "estimated_value_ugx": 125000000,
            "proposed_bid_price_ugx": 118000000,
            "internal_estimated_cost_ugx": 90000000,
            "expected_profit_ugx": 28000000,
            "team_emails": [registered_user["email"]],
            "bid_manager_email": registered_user["email"],
        },
    )
    assert created.status_code == 201, created.text
    bid = created.json()
    bid_id = bid["id"]

    requirement = await async_client.post(
        f"/api/v1/bids/{bid_id}/requirements",
        headers=headers,
        json={"title": "Tax clearance certificate", "is_mandatory": True},
    )
    assert requirement.status_code == 201, requirement.text
    requirement_id = requirement.json()["id"]

    blocked_award = await async_client.patch(
        f"/api/v1/bids/{bid_id}", headers=headers, json={"status": "awarded"}
    )
    assert blocked_award.status_code == 200

    blocked_convert = await async_client.post(
        f"/api/v1/bids/{bid_id}/convert-to-project", headers=headers, json={}
    )
    assert blocked_convert.status_code == 409

    completed = await async_client.patch(
        f"/api/v1/bids/{bid_id}/requirements/{requirement_id}",
        headers=headers,
        json={"status": "complete"},
    )
    assert completed.status_code == 200, completed.text

    converted = await async_client.post(
        f"/api/v1/bids/{bid_id}/convert-to-project", headers=headers, json={}
    )
    assert converted.status_code == 201, converted.text
    project = converted.json()
    assert project["name"] == "Regional ICT Equipment Supply"
    assert project["client_name"] == "Test Procuring Entity"
    assert project["value_ugx"] == 125000000
    assert "Tender" in project["tags"]
    assert tender_no in project["tags"]

    again = await async_client.post(
        f"/api/v1/bids/{bid_id}/convert-to-project", headers=headers, json={}
    )
    assert again.status_code == 201
    assert again.json()["id"] == project["id"]

    workspace = await async_client.get(f"/api/v1/bids/{bid_id}/workspace", headers=headers)
    assert workspace.status_code == 200, workspace.text
    assert workspace.json()["bid"]["project_id"] == project["id"]
    assert workspace.json()["requirements"][0]["status"] == "complete"

    dashboard = await async_client.get("/api/v1/bids/dashboard", headers=headers)
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["awarded"] >= 1
