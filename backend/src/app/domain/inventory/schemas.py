from __future__ import annotations

import uuid
from datetime import datetime

import msgspec


class CategoryCreate(msgspec.Struct, frozen=True):
    name: str
    description: str | None = None


class CategoryRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    name: str
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UnitCreate(msgspec.Struct, frozen=True):
    code: str
    name: str


class UnitRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    code: str
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ItemCreate(msgspec.Struct, frozen=True):
    sku: str
    name: str
    description: str | None = None
    category_id: uuid.UUID | None = None
    unit_id: uuid.UUID | None = None
    supplier_id: uuid.UUID | None = None
    unit_cost_ugx: float = 0
    minimum_stock_level: float = 0


class ItemUpdate(msgspec.Struct, frozen=True):
    sku: str | None = None
    name: str | None = None
    description: str | None = None
    category_id: uuid.UUID | None = None
    unit_id: uuid.UUID | None = None
    supplier_id: uuid.UUID | None = None
    unit_cost_ugx: float | None = None
    minimum_stock_level: float | None = None
    is_active: bool | None = None


class ItemRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    sku: str
    name: str
    description: str | None
    category_id: uuid.UUID | None
    category_name: str | None
    unit_id: uuid.UUID | None
    unit_code: str | None
    supplier_id: uuid.UUID | None
    supplier_name: str | None
    unit_cost_ugx: float
    minimum_stock_level: float
    total_quantity: float
    total_value_ugx: float
    is_low_stock: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class WarehouseCreate(msgspec.Struct, frozen=True):
    code: str
    name: str
    address: str | None = None
    notes: str | None = None


class WarehouseRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    code: str
    name: str
    address: str | None
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class LocationCreate(msgspec.Struct, frozen=True):
    warehouse_id: uuid.UUID
    code: str
    name: str
    location_type: str = "area"
    parent_location_id: uuid.UUID | None = None


class LocationRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    warehouse_id: uuid.UUID
    parent_location_id: uuid.UUID | None
    code: str
    name: str
    location_type: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class StockMovementCreate(msgspec.Struct, frozen=True):
    item_id: uuid.UUID
    movement_type: str
    quantity: float
    from_warehouse_id: uuid.UUID | None = None
    from_location_id: uuid.UUID | None = None
    from_project_id: uuid.UUID | None = None
    to_warehouse_id: uuid.UUID | None = None
    to_location_id: uuid.UUID | None = None
    to_project_id: uuid.UUID | None = None
    unit_cost_ugx: float | None = None
    reference: str | None = None
    notes: str | None = None


class StockTransactionRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    item_id: uuid.UUID
    item_sku: str
    item_name: str
    movement_type: str
    quantity: float
    unit_cost_ugx: float
    from_warehouse_id: uuid.UUID | None
    from_location_id: uuid.UUID | None
    from_project_id: uuid.UUID | None
    to_warehouse_id: uuid.UUID | None
    to_location_id: uuid.UUID | None
    to_project_id: uuid.UUID | None
    reference: str | None
    notes: str | None
    created_by_email: str
    created_at: datetime


class StockBalanceRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    item_id: uuid.UUID
    item_sku: str
    item_name: str
    warehouse_id: uuid.UUID
    warehouse_name: str
    location_id: uuid.UUID | None
    location_name: str | None
    project_id: uuid.UUID | None
    project_name: str | None
    quantity: float
    unit_cost_ugx: float
    value_ugx: float


class InventoryDashboard(msgspec.Struct, frozen=True):
    items: int
    warehouses: int
    total_quantity: float
    inventory_value_ugx: float
    low_stock_items: int
    project_stock_value_ugx: float
    recent_movements: list[StockTransactionRead]


class StockRequestCreate(msgspec.Struct, frozen=True):
    project_id: uuid.UUID
    item_id: uuid.UUID
    requested_quantity: float
    notes: str | None = None


class StockRequestUpdate(msgspec.Struct, frozen=True):
    status: str
    approved_quantity: float | None = None
    notes: str | None = None


class StockRequestIssue(msgspec.Struct, frozen=True):
    warehouse_id: uuid.UUID
    location_id: uuid.UUID | None = None
    quantity: float | None = None
    reference: str | None = None
    notes: str | None = None


class StockRequestRead(msgspec.Struct, frozen=True):
    id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    item_id: uuid.UUID
    item_sku: str
    item_name: str
    requested_quantity: float
    approved_quantity: float
    status: str
    requested_by_email: str
    approved_by_email: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime
