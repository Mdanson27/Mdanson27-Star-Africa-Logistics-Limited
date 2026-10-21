from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


async def test_inventory_completion_flow(async_client: AsyncClient, registered_user: dict):
    headers = {"Authorization": f"Bearer {registered_user['token']}"}
    suffix = uuid.uuid4().hex[:8].upper()

    project_response = await async_client.post(
        "/api/v1/projects",
        headers=headers,
        json={"name": f"Inventory Test Project {suffix}", "client_name": "Inventory Test Client"},
    )
    assert project_response.status_code == 201, project_response.text
    project_id = project_response.json()["id"]

    category_response = await async_client.post(
        "/api/v1/inventory/categories",
        headers=headers,
        json={"name": f"Electrical {suffix}"},
    )
    assert category_response.status_code == 201, category_response.text
    category_id = category_response.json()["id"]

    unit_response = await async_client.post(
        "/api/v1/inventory/units",
        headers=headers,
        json={"code": f"PC{suffix[:4]}", "name": "Pieces"},
    )
    assert unit_response.status_code == 201, unit_response.text
    unit_id = unit_response.json()["id"]

    item_response = await async_client.post(
        "/api/v1/inventory/items",
        headers=headers,
        json={
            "sku": f"CBL-{suffix}",
            "name": "Armoured Cable",
            "category_id": category_id,
            "unit_id": unit_id,
            "unit_cost_ugx": 25000,
            "minimum_stock_level": 15,
        },
    )
    assert item_response.status_code == 201, item_response.text
    item_id = item_response.json()["id"]

    warehouse_response = await async_client.post(
        "/api/v1/inventory/warehouses",
        headers=headers,
        json={"code": f"WH-{suffix}", "name": f"Main Warehouse {suffix}"},
    )
    assert warehouse_response.status_code == 201, warehouse_response.text
    warehouse_id = warehouse_response.json()["id"]

    area_response = await async_client.post(
        "/api/v1/inventory/locations",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "code": "ROOM-A",
            "name": "Room A",
            "location_type": "room",
        },
    )
    assert area_response.status_code == 201, area_response.text
    room_a = area_response.json()["id"]

    bin_response = await async_client.post(
        "/api/v1/inventory/locations",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "code": "BIN-B",
            "name": "Bin B",
            "location_type": "bin",
        },
    )
    assert bin_response.status_code == 201, bin_response.text
    bin_b = bin_response.json()["id"]

    stock_in = await async_client.post(
        "/api/v1/inventory/movements",
        headers=headers,
        json={
            "item_id": item_id,
            "movement_type": "stock_in",
            "quantity": 100,
            "to_warehouse_id": warehouse_id,
            "to_location_id": room_a,
            "unit_cost_ugx": 25000,
            "reference": f"GRN-{suffix}",
        },
    )
    assert stock_in.status_code == 201, stock_in.text

    allocation = await async_client.post(
        "/api/v1/inventory/movements",
        headers=headers,
        json={
            "item_id": item_id,
            "movement_type": "project_allocation",
            "quantity": 30,
            "from_warehouse_id": warehouse_id,
            "from_location_id": room_a,
            "to_warehouse_id": warehouse_id,
            "to_location_id": room_a,
            "to_project_id": project_id,
            "reference": f"ALLOC-{suffix}",
        },
    )
    assert allocation.status_code == 201, allocation.text

    transfer = await async_client.post(
        "/api/v1/inventory/movements",
        headers=headers,
        json={
            "item_id": item_id,
            "movement_type": "transfer",
            "quantity": 20,
            "from_warehouse_id": warehouse_id,
            "from_location_id": room_a,
            "to_warehouse_id": warehouse_id,
            "to_location_id": bin_b,
            "reference": f"TRF-{suffix}",
        },
    )
    assert transfer.status_code == 201, transfer.text

    returned = await async_client.post(
        "/api/v1/inventory/movements",
        headers=headers,
        json={
            "item_id": item_id,
            "movement_type": "project_return",
            "quantity": 10,
            "from_warehouse_id": warehouse_id,
            "from_location_id": room_a,
            "from_project_id": project_id,
            "to_warehouse_id": warehouse_id,
            "to_location_id": bin_b,
            "reference": f"RET-{suffix}",
        },
    )
    assert returned.status_code == 201, returned.text

    balances = await async_client.get(
        f"/api/v1/inventory/balances?warehouse_id={warehouse_id}", headers=headers
    )
    assert balances.status_code == 200, balances.text
    rows = balances.json()
    assert sum(row["quantity"] for row in rows) == 100
    assert sum(row["quantity"] for row in rows if row["project_id"] is None) == 80
    assert sum(row["quantity"] for row in rows if row["project_id"] == project_id) == 20

    project_stock = await async_client.get(
        f"/api/v1/inventory/projects/{project_id}", headers=headers
    )
    assert project_stock.status_code == 200, project_stock.text
    assert sum(row["quantity"] for row in project_stock.json()) == 20

    history = await async_client.get(
        f"/api/v1/inventory/movements?item_id={item_id}", headers=headers
    )
    assert history.status_code == 200, history.text
    movement_types = [row["movement_type"] for row in history.json()]
    assert movement_types[:4] == ["project_return", "transfer", "project_allocation", "stock_in"]

    dashboard = await async_client.get("/api/v1/inventory/dashboard", headers=headers)
    assert dashboard.status_code == 200, dashboard.text
    assert dashboard.json()["inventory_value_ugx"] >= 2_500_000

    request_response = await async_client.post(
        "/api/v1/inventory/requests",
        headers=headers,
        json={
            "project_id": project_id,
            "item_id": item_id,
            "requested_quantity": 5,
            "notes": "Additional cable required on site",
        },
    )
    assert request_response.status_code == 201, request_response.text
    request_id = request_response.json()["id"]

    approved = await async_client.patch(
        f"/api/v1/inventory/requests/{request_id}",
        headers=headers,
        json={"status": "approved", "approved_quantity": 5},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"

    issued = await async_client.post(
        f"/api/v1/inventory/requests/{request_id}/issue",
        headers=headers,
        json={
            "warehouse_id": warehouse_id,
            "location_id": bin_b,
            "quantity": 5,
            "reference": f"REQ-{suffix}",
        },
    )
    assert issued.status_code == 201, issued.text
    assert issued.json()["status"] == "issued"

    final_balances = await async_client.get(
        f"/api/v1/inventory/balances?warehouse_id={warehouse_id}", headers=headers
    )
    assert final_balances.status_code == 200, final_balances.text
    final_rows = final_balances.json()
    assert sum(row["quantity"] for row in final_rows) == 100
    assert sum(row["quantity"] for row in final_rows if row["project_id"] is None) == 75
    assert sum(row["quantity"] for row in final_rows if row["project_id"] == project_id) == 25
