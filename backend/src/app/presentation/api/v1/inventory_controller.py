from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, ClassVar

from litestar import Controller, Request, get, patch, post
from litestar.exceptions import ClientException, NotFoundException
from litestar.status_codes import HTTP_201_CREATED
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.business.models import Supplier
from app.domain.inventory.models import (
    InventoryCategory,
    InventoryItem,
    InventoryUnit,
    StockBalance,
    StockRequest,
    StockTransaction,
    Warehouse,
    WarehouseLocation,
)
from app.domain.inventory.schemas import (
    CategoryCreate,
    CategoryRead,
    InventoryDashboard,
    ItemCreate,
    ItemRead,
    ItemUpdate,
    LocationCreate,
    LocationRead,
    StockBalanceRead,
    StockMovementCreate,
    StockRequestCreate,
    StockRequestIssue,
    StockRequestRead,
    StockRequestUpdate,
    StockTransactionRead,
    UnitCreate,
    UnitRead,
    WarehouseCreate,
    WarehouseRead,
)
from app.domain.workspace.models import Project
from app.presentation.guards.auth_guard import JWTAuthGuard

MOVEMENT_TYPES = {
    "stock_in",
    "stock_out",
    "transfer",
    "project_allocation",
    "project_return",
    "adjustment_in",
    "adjustment_out",
    "damaged",
    "lost",
    "write_off",
}
REQUEST_STATUSES = {"pending", "approved", "rejected", "cancelled", "issued"}
LOCATION_TYPES = {"area", "room", "shelf", "bin"}


def _email(request: Request) -> str:
    email = str(request.scope.get("email") or "").strip().lower()
    if not email:
        raise ClientException(detail="Authenticated email is required.", status_code=401)
    return email


def _positive(value: float, label: str = "Quantity") -> Decimal:
    amount = Decimal(str(value))
    if amount <= 0:
        raise ClientException(detail=f"{label} must be greater than zero.", status_code=400)
    return amount


def _category_read(row: InventoryCategory) -> CategoryRead:
    return CategoryRead(
        row.id, row.name, row.description, row.is_active, row.created_at, row.updated_at
    )


def _unit_read(row: InventoryUnit) -> UnitRead:
    return UnitRead(row.id, row.code, row.name, row.is_active, row.created_at, row.updated_at)


def _warehouse_read(row: Warehouse) -> WarehouseRead:
    return WarehouseRead(
        row.id,
        row.code,
        row.name,
        row.address,
        row.notes,
        row.is_active,
        row.created_at,
        row.updated_at,
    )


def _location_read(row: WarehouseLocation) -> LocationRead:
    return LocationRead(
        row.id,
        row.warehouse_id,
        row.parent_location_id,
        row.code,
        row.name,
        row.location_type,
        row.is_active,
        row.created_at,
        row.updated_at,
    )


async def _transaction_read(db: AsyncSession, row: StockTransaction) -> StockTransactionRead:
    item = await db.get(InventoryItem, row.item_id)
    return StockTransactionRead(
        id=row.id,
        item_id=row.item_id,
        item_sku=item.sku if item else "",
        item_name=item.name if item else "Deleted item",
        movement_type=row.movement_type,
        quantity=float(row.quantity),
        unit_cost_ugx=float(row.unit_cost_ugx),
        from_warehouse_id=row.from_warehouse_id,
        from_location_id=row.from_location_id,
        from_project_id=row.from_project_id,
        to_warehouse_id=row.to_warehouse_id,
        to_location_id=row.to_location_id,
        to_project_id=row.to_project_id,
        reference=row.reference,
        notes=row.notes,
        created_by_email=row.created_by_email,
        created_at=row.created_at,
    )


async def _item_read(db: AsyncSession, row: InventoryItem) -> ItemRead:
    category = await db.get(InventoryCategory, row.category_id) if row.category_id else None
    unit = await db.get(InventoryUnit, row.unit_id) if row.unit_id else None
    supplier = await db.get(Supplier, row.supplier_id) if row.supplier_id else None
    qty = Decimal(
        str(
            (
                await db.scalar(
                    select(func.coalesce(func.sum(StockBalance.quantity), 0)).where(
                        StockBalance.item_id == row.id
                    )
                )
            )
            or 0
        )
    )
    cost = Decimal(str(row.unit_cost_ugx or 0))
    minimum = Decimal(str(row.minimum_stock_level or 0))
    return ItemRead(
        id=row.id,
        sku=row.sku,
        name=row.name,
        description=row.description,
        category_id=row.category_id,
        category_name=category.name if category else None,
        unit_id=row.unit_id,
        unit_code=unit.code if unit else None,
        supplier_id=row.supplier_id,
        supplier_name=supplier.name if supplier else None,
        unit_cost_ugx=float(cost),
        minimum_stock_level=float(minimum),
        total_quantity=float(qty),
        total_value_ugx=float(qty * cost),
        is_low_stock=minimum > 0 and qty <= minimum,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _validate_scope(
    db: AsyncSession,
    warehouse_id: uuid.UUID | None,
    location_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
) -> None:
    if warehouse_id is not None and await db.get(Warehouse, warehouse_id) is None:
        raise NotFoundException(detail="Warehouse not found.")
    if location_id is not None:
        location = await db.get(WarehouseLocation, location_id)
        if location is None:
            raise NotFoundException(detail="Warehouse location not found.")
        if warehouse_id is None or location.warehouse_id != warehouse_id:
            raise ClientException(
                detail="The location does not belong to the selected warehouse.", status_code=400
            )
    if project_id is not None and await db.get(Project, project_id) is None:
        raise NotFoundException(detail="Project not found.")


async def _balance(
    db: AsyncSession,
    item_id: uuid.UUID,
    warehouse_id: uuid.UUID,
    location_id: uuid.UUID | None,
    project_id: uuid.UUID | None,
    create: bool,
) -> StockBalance | None:
    stmt = select(StockBalance).where(
        StockBalance.item_id == item_id, StockBalance.warehouse_id == warehouse_id
    )
    stmt = (
        stmt.where(StockBalance.location_id == location_id)
        if location_id
        else stmt.where(StockBalance.location_id.is_(None))
    )
    stmt = (
        stmt.where(StockBalance.project_id == project_id)
        if project_id
        else stmt.where(StockBalance.project_id.is_(None))
    )
    row = (await db.execute(stmt.with_for_update())).scalar_one_or_none()
    if row is None and create:
        row = StockBalance(
            item_id=item_id,
            warehouse_id=warehouse_id,
            location_id=location_id,
            project_id=project_id,
            quantity=Decimal(0),
        )
        db.add(row)
        await db.flush()
    return row


async def _apply_movement(
    db: AsyncSession,
    request: Request,
    data: StockMovementCreate,
    *,
    commit: bool = True,
) -> StockTransaction:
    movement = data.movement_type.strip().lower()
    if movement not in MOVEMENT_TYPES:
        raise ClientException(detail="Invalid stock movement type.", status_code=400)
    item = await db.get(InventoryItem, data.item_id)
    if item is None:
        raise NotFoundException(detail="Inventory item not found.")
    qty = _positive(data.quantity)
    await _validate_scope(db, data.from_warehouse_id, data.from_location_id, data.from_project_id)
    await _validate_scope(db, data.to_warehouse_id, data.to_location_id, data.to_project_id)

    needs_source = movement in {
        "stock_out",
        "transfer",
        "project_allocation",
        "project_return",
        "adjustment_out",
        "damaged",
        "lost",
        "write_off",
    }
    needs_destination = movement in {
        "stock_in",
        "transfer",
        "project_allocation",
        "project_return",
        "adjustment_in",
    }
    if needs_source and data.from_warehouse_id is None:
        raise ClientException(detail="This movement requires a source warehouse.", status_code=400)
    if needs_destination and data.to_warehouse_id is None:
        raise ClientException(
            detail="This movement requires a destination warehouse.", status_code=400
        )
    if movement == "project_allocation" and data.to_project_id is None:
        raise ClientException(
            detail="Project allocation requires a destination project.", status_code=400
        )
    if movement == "project_return" and data.from_project_id is None:
        raise ClientException(detail="Project return requires a source project.", status_code=400)
    if (
        movement == "transfer"
        and data.from_warehouse_id == data.to_warehouse_id
        and data.from_location_id == data.to_location_id
        and data.from_project_id == data.to_project_id
    ):
        raise ClientException(
            detail="Transfer destination must differ from its source.", status_code=400
        )

    if needs_source:
        source = await _balance(
            db,
            data.item_id,
            data.from_warehouse_id,
            data.from_location_id,
            data.from_project_id,
            False,
        )  # type: ignore[arg-type]
        if source is None or Decimal(str(source.quantity)) < qty:
            available = float(source.quantity) if source else 0
            raise ClientException(
                detail=f"Insufficient stock. Available quantity is {available:g}.", status_code=409
            )
        source.quantity = Decimal(str(source.quantity)) - qty

    if needs_destination:
        destination = await _balance(
            db, data.item_id, data.to_warehouse_id, data.to_location_id, data.to_project_id, True
        )  # type: ignore[arg-type]
        assert destination is not None
        destination.quantity = Decimal(str(destination.quantity)) + qty

    unit_cost = Decimal(
        str(data.unit_cost_ugx if data.unit_cost_ugx is not None else item.unit_cost_ugx or 0)
    )
    if movement == "stock_in" and data.unit_cost_ugx is not None and data.unit_cost_ugx >= 0:
        item.unit_cost_ugx = unit_cost

    tx = StockTransaction(
        item_id=data.item_id,
        movement_type=movement,
        quantity=qty,
        unit_cost_ugx=unit_cost,
        from_warehouse_id=data.from_warehouse_id,
        from_location_id=data.from_location_id,
        from_project_id=data.from_project_id,
        to_warehouse_id=data.to_warehouse_id,
        to_location_id=data.to_location_id,
        to_project_id=data.to_project_id,
        reference=(data.reference or "").strip() or None,
        notes=(data.notes or "").strip() or None,
        created_by_email=_email(request),
    )
    db.add(tx)
    if commit:
        await db.commit()
        await db.refresh(tx)
    else:
        await db.flush()
    return tx


async def _balance_reads(
    db: AsyncSession,
    *,
    project_id: uuid.UUID | None = None,
    warehouse_id: uuid.UUID | None = None,
) -> list[StockBalanceRead]:
    stmt = (
        select(StockBalance)
        .where(StockBalance.quantity != 0)
        .order_by(StockBalance.updated_at.desc())
    )
    if project_id:
        stmt = stmt.where(StockBalance.project_id == project_id)
    if warehouse_id:
        stmt = stmt.where(StockBalance.warehouse_id == warehouse_id)
    rows = (await db.execute(stmt)).scalars().all()
    result: list[StockBalanceRead] = []
    for row in rows:
        item = await db.get(InventoryItem, row.item_id)
        warehouse = await db.get(Warehouse, row.warehouse_id)
        location = await db.get(WarehouseLocation, row.location_id) if row.location_id else None
        project = await db.get(Project, row.project_id) if row.project_id else None
        cost = Decimal(str(item.unit_cost_ugx if item else 0))
        result.append(
            StockBalanceRead(
                row.id,
                row.item_id,
                item.sku if item else "",
                item.name if item else "Deleted item",
                row.warehouse_id,
                warehouse.name if warehouse else "Deleted warehouse",
                row.location_id,
                location.name if location else None,
                row.project_id,
                project.name if project else None,
                float(row.quantity),
                float(cost),
                float(Decimal(str(row.quantity)) * cost),
            )
        )
    return result


async def _request_reads(
    db: AsyncSession, *, project_id: uuid.UUID | None = None
) -> list[StockRequestRead]:
    stmt = select(StockRequest).order_by(StockRequest.created_at.desc())
    if project_id:
        stmt = stmt.where(StockRequest.project_id == project_id)
    rows = (await db.execute(stmt)).scalars().all()
    result: list[StockRequestRead] = []
    for row in rows:
        project = await db.get(Project, row.project_id)
        item = await db.get(InventoryItem, row.item_id)
        result.append(
            StockRequestRead(
                row.id,
                row.project_id,
                project.name if project else "Deleted project",
                row.item_id,
                item.sku if item else "",
                item.name if item else "Deleted item",
                float(row.requested_quantity),
                float(row.approved_quantity),
                row.status,
                row.requested_by_email,
                row.approved_by_email,
                row.notes,
                row.created_at,
                row.updated_at,
            )
        )
    return result


class InventoryController(Controller):
    path = "/inventory"
    guards: ClassVar[list[Any]] = [JWTAuthGuard()]

    @get(path="/dashboard")
    async def dashboard(self, db_session: AsyncSession) -> InventoryDashboard:
        items = (
            (
                await db_session.execute(
                    select(InventoryItem).where(InventoryItem.is_active.is_(True))
                )
            )
            .scalars()
            .all()
        )
        warehouses = int(
            (
                await db_session.scalar(
                    select(func.count()).select_from(Warehouse).where(Warehouse.is_active.is_(True))
                )
            )
            or 0
        )
        total_qty = Decimal(
            str(
                (await db_session.scalar(select(func.coalesce(func.sum(StockBalance.quantity), 0))))
                or 0
            )
        )
        value = Decimal(0)
        project_value = Decimal(0)
        low = 0
        for item in items:
            qty = Decimal(
                str(
                    (
                        await db_session.scalar(
                            select(func.coalesce(func.sum(StockBalance.quantity), 0)).where(
                                StockBalance.item_id == item.id
                            )
                        )
                    )
                    or 0
                )
            )
            cost = Decimal(str(item.unit_cost_ugx or 0))
            value += qty * cost
            minimum = Decimal(str(item.minimum_stock_level or 0))
            if minimum > 0 and qty <= minimum:
                low += 1
            pqty = Decimal(
                str(
                    (
                        await db_session.scalar(
                            select(func.coalesce(func.sum(StockBalance.quantity), 0)).where(
                                StockBalance.item_id == item.id,
                                StockBalance.project_id.is_not(None),
                            )
                        )
                    )
                    or 0
                )
            )
            project_value += pqty * cost
        recent_rows = (
            (
                await db_session.execute(
                    select(StockTransaction).order_by(StockTransaction.created_at.desc()).limit(8)
                )
            )
            .scalars()
            .all()
        )
        recent = [await _transaction_read(db_session, row) for row in recent_rows]
        return InventoryDashboard(
            len(items),
            warehouses,
            float(total_qty),
            float(value),
            low,
            float(project_value),
            recent,
        )

    @get(path="/categories")
    async def categories(self, db_session: AsyncSession) -> list[CategoryRead]:
        rows = (
            (await db_session.execute(select(InventoryCategory).order_by(InventoryCategory.name)))
            .scalars()
            .all()
        )
        return [_category_read(r) for r in rows]

    @post(path="/categories", status_code=HTTP_201_CREATED)
    async def create_category(self, data: CategoryCreate, db_session: AsyncSession) -> CategoryRead:
        if not data.name.strip():
            raise ClientException(detail="Category name is required.", status_code=400)
        row = InventoryCategory(
            name=data.name.strip(), description=(data.description or "").strip() or None
        )
        db_session.add(row)
        try:
            await db_session.commit()
        except IntegrityError as exc:
            await db_session.rollback()
            raise ClientException(detail="This category already exists.", status_code=409) from exc
        await db_session.refresh(row)
        return _category_read(row)

    @get(path="/units")
    async def units(self, db_session: AsyncSession) -> list[UnitRead]:
        rows = (
            (await db_session.execute(select(InventoryUnit).order_by(InventoryUnit.code)))
            .scalars()
            .all()
        )
        return [_unit_read(r) for r in rows]

    @post(path="/units", status_code=HTTP_201_CREATED)
    async def create_unit(self, data: UnitCreate, db_session: AsyncSession) -> UnitRead:
        if not data.code.strip() or not data.name.strip():
            raise ClientException(detail="Unit code and name are required.", status_code=400)
        row = InventoryUnit(code=data.code.strip().upper(), name=data.name.strip())
        db_session.add(row)
        try:
            await db_session.commit()
        except IntegrityError as exc:
            await db_session.rollback()
            raise ClientException(detail="This unit code already exists.", status_code=409) from exc
        await db_session.refresh(row)
        return _unit_read(row)

    @get(path="/items")
    async def items(
        self,
        db_session: AsyncSession,
        q: str | None = None,
        low_stock: bool = False,
        include_inactive: bool = False,
    ) -> list[ItemRead]:
        stmt = select(InventoryItem).order_by(InventoryItem.name)
        if not include_inactive:
            stmt = stmt.where(InventoryItem.is_active.is_(True))
        if q:
            term = f"%{q.strip()}%"
            stmt = stmt.where(or_(InventoryItem.name.ilike(term), InventoryItem.sku.ilike(term)))
        rows = (await db_session.execute(stmt)).scalars().all()
        result = [await _item_read(db_session, r) for r in rows]
        return [r for r in result if r.is_low_stock] if low_stock else result

    @post(path="/items", status_code=HTTP_201_CREATED)
    async def create_item(self, data: ItemCreate, db_session: AsyncSession) -> ItemRead:
        if not data.sku.strip() or not data.name.strip():
            raise ClientException(detail="SKU and item name are required.", status_code=400)
        row = InventoryItem(
            sku=data.sku.strip().upper(),
            name=data.name.strip(),
            description=(data.description or "").strip() or None,
            category_id=data.category_id,
            unit_id=data.unit_id,
            supplier_id=data.supplier_id,
            unit_cost_ugx=Decimal(str(max(0, data.unit_cost_ugx))),
            minimum_stock_level=Decimal(str(max(0, data.minimum_stock_level))),
        )
        db_session.add(row)
        try:
            await db_session.commit()
        except IntegrityError as exc:
            await db_session.rollback()
            raise ClientException(
                detail="SKU must be unique and all master-data references must be valid.",
                status_code=409,
            ) from exc
        await db_session.refresh(row)
        return await _item_read(db_session, row)

    @patch(path="/items/{item_id:uuid}")
    async def update_item(
        self, item_id: uuid.UUID, data: ItemUpdate, db_session: AsyncSession
    ) -> ItemRead:
        row = await db_session.get(InventoryItem, item_id)
        if row is None:
            raise NotFoundException(detail="Inventory item not found.")
        for field in (
            "sku",
            "name",
            "description",
            "category_id",
            "unit_id",
            "supplier_id",
            "is_active",
        ):
            value = getattr(data, field)
            if value is not None:
                setattr(
                    row,
                    field,
                    value.strip().upper()
                    if field == "sku" and isinstance(value, str)
                    else value.strip()
                    if isinstance(value, str)
                    else value,
                )
        if data.unit_cost_ugx is not None:
            row.unit_cost_ugx = Decimal(str(max(0, data.unit_cost_ugx)))
        if data.minimum_stock_level is not None:
            row.minimum_stock_level = Decimal(str(max(0, data.minimum_stock_level)))
        await db_session.commit()
        await db_session.refresh(row)
        return await _item_read(db_session, row)

    @get(path="/warehouses")
    async def warehouses(self, db_session: AsyncSession) -> list[WarehouseRead]:
        rows = (
            (await db_session.execute(select(Warehouse).order_by(Warehouse.name))).scalars().all()
        )
        return [_warehouse_read(r) for r in rows]

    @post(path="/warehouses", status_code=HTTP_201_CREATED)
    async def create_warehouse(
        self, data: WarehouseCreate, db_session: AsyncSession
    ) -> WarehouseRead:
        if not data.code.strip() or not data.name.strip():
            raise ClientException(detail="Warehouse code and name are required.", status_code=400)
        row = Warehouse(
            code=data.code.strip().upper(),
            name=data.name.strip(),
            address=(data.address or "").strip() or None,
            notes=(data.notes or "").strip() or None,
        )
        db_session.add(row)
        try:
            await db_session.commit()
        except IntegrityError as exc:
            await db_session.rollback()
            raise ClientException(detail="Warehouse code must be unique.", status_code=409) from exc
        await db_session.refresh(row)
        return _warehouse_read(row)

    @get(path="/locations")
    async def locations(
        self, db_session: AsyncSession, warehouse_id: uuid.UUID | None = None
    ) -> list[LocationRead]:
        stmt = select(WarehouseLocation).order_by(
            WarehouseLocation.warehouse_id, WarehouseLocation.code
        )
        if warehouse_id:
            stmt = stmt.where(WarehouseLocation.warehouse_id == warehouse_id)
        rows = (await db_session.execute(stmt)).scalars().all()
        return [_location_read(r) for r in rows]

    @post(path="/locations", status_code=HTTP_201_CREATED)
    async def create_location(self, data: LocationCreate, db_session: AsyncSession) -> LocationRead:
        if await db_session.get(Warehouse, data.warehouse_id) is None:
            raise NotFoundException(detail="Warehouse not found.")
        location_type = data.location_type.strip().lower()
        if location_type not in LOCATION_TYPES:
            raise ClientException(
                detail="Location type must be area, room, shelf or bin.", status_code=400
            )
        if data.parent_location_id:
            parent = await db_session.get(WarehouseLocation, data.parent_location_id)
            if parent is None or parent.warehouse_id != data.warehouse_id:
                raise ClientException(
                    detail="Parent location must belong to the same warehouse.", status_code=400
                )
        row = WarehouseLocation(
            warehouse_id=data.warehouse_id,
            parent_location_id=data.parent_location_id,
            code=data.code.strip().upper(),
            name=data.name.strip(),
            location_type=location_type,
        )
        db_session.add(row)
        try:
            await db_session.commit()
        except IntegrityError as exc:
            await db_session.rollback()
            raise ClientException(
                detail="Location code must be unique within this warehouse.", status_code=409
            ) from exc
        await db_session.refresh(row)
        return _location_read(row)

    @get(path="/balances")
    async def balances(
        self,
        db_session: AsyncSession,
        project_id: uuid.UUID | None = None,
        warehouse_id: uuid.UUID | None = None,
    ) -> list[StockBalanceRead]:
        return await _balance_reads(db_session, project_id=project_id, warehouse_id=warehouse_id)

    @get(path="/projects/{project_id:uuid}")
    async def project_inventory(
        self, project_id: uuid.UUID, db_session: AsyncSession
    ) -> list[StockBalanceRead]:
        if await db_session.get(Project, project_id) is None:
            raise NotFoundException(detail="Project not found.")
        return await _balance_reads(db_session, project_id=project_id)

    @get(path="/movements")
    async def movements(
        self,
        db_session: AsyncSession,
        item_id: uuid.UUID | None = None,
        project_id: uuid.UUID | None = None,
        limit: int = 100,
    ) -> list[StockTransactionRead]:
        stmt = (
            select(StockTransaction)
            .order_by(StockTransaction.created_at.desc())
            .limit(min(max(limit, 1), 500))
        )
        if item_id:
            stmt = stmt.where(StockTransaction.item_id == item_id)
        if project_id:
            stmt = stmt.where(
                or_(
                    StockTransaction.from_project_id == project_id,
                    StockTransaction.to_project_id == project_id,
                )
            )
        rows = (await db_session.execute(stmt)).scalars().all()
        return [await _transaction_read(db_session, r) for r in rows]

    @post(path="/movements", status_code=HTTP_201_CREATED)
    async def create_movement(
        self, request: Request, data: StockMovementCreate, db_session: AsyncSession
    ) -> StockTransactionRead:
        tx = await _apply_movement(db_session, request, data)
        return await _transaction_read(db_session, tx)

    @get(path="/requests")
    async def requests(
        self, db_session: AsyncSession, project_id: uuid.UUID | None = None
    ) -> list[StockRequestRead]:
        return await _request_reads(db_session, project_id=project_id)

    @post(path="/requests", status_code=HTTP_201_CREATED)
    async def create_request(
        self, request: Request, data: StockRequestCreate, db_session: AsyncSession
    ) -> StockRequestRead:
        if (
            await db_session.get(Project, data.project_id) is None
            or await db_session.get(InventoryItem, data.item_id) is None
        ):
            raise ClientException(detail="Project and inventory item must exist.", status_code=400)
        row = StockRequest(
            project_id=data.project_id,
            item_id=data.item_id,
            requested_quantity=_positive(data.requested_quantity),
            approved_quantity=Decimal(0),
            status="pending",
            requested_by_email=_email(request),
            notes=(data.notes or "").strip() or None,
        )
        db_session.add(row)
        await db_session.commit()
        await db_session.refresh(row)
        return (await _request_reads(db_session, project_id=row.project_id))[0]

    @patch(path="/requests/{request_id:uuid}")
    async def update_request(
        self,
        request: Request,
        request_id: uuid.UUID,
        data: StockRequestUpdate,
        db_session: AsyncSession,
    ) -> StockRequestRead:
        row = await db_session.get(StockRequest, request_id)
        if row is None:
            raise NotFoundException(detail="Stock request not found.")
        status = data.status.strip().lower()
        if status not in REQUEST_STATUSES:
            raise ClientException(detail="Invalid stock request status.", status_code=400)
        if status == "issued":
            raise ClientException(
                detail="Issue stock through a Project Allocation movement, then mark the request issued.",
                status_code=409,
            )
        row.status = status
        if data.approved_quantity is not None:
            approved = Decimal(str(max(0, data.approved_quantity)))
            if approved > Decimal(str(row.requested_quantity)):
                raise ClientException(
                    detail="Approved quantity cannot exceed the requested quantity.",
                    status_code=400,
                )
            row.approved_quantity = approved
        if status in {"approved", "rejected"}:
            row.approved_by_email = _email(request)
        if data.notes is not None:
            row.notes = data.notes.strip() or None
        await db_session.commit()
        await db_session.refresh(row)
        matches = [
            r for r in await _request_reads(db_session, project_id=row.project_id) if r.id == row.id
        ]
        return matches[0]

    @post(path="/requests/{request_id:uuid}/issue", status_code=HTTP_201_CREATED)
    async def issue_request(
        self,
        request: Request,
        request_id: uuid.UUID,
        data: StockRequestIssue,
        db_session: AsyncSession,
    ) -> StockRequestRead:
        row = await db_session.get(StockRequest, request_id)
        if row is None:
            raise NotFoundException(detail="Stock request not found.")
        if row.status != "approved":
            raise ClientException(
                detail="Only an approved stock request can be issued.", status_code=409
            )

        approved = Decimal(str(row.approved_quantity or 0))
        if approved <= 0:
            raise ClientException(
                detail="Approve a quantity greater than zero before issuing stock.", status_code=409
            )
        issue_quantity = _positive(data.quantity) if data.quantity is not None else approved
        if issue_quantity > approved:
            raise ClientException(
                detail="Issued quantity cannot exceed the approved quantity.", status_code=400
            )

        await _apply_movement(
            db_session,
            request,
            StockMovementCreate(
                item_id=row.item_id,
                movement_type="project_allocation",
                quantity=float(issue_quantity),
                from_warehouse_id=data.warehouse_id,
                from_location_id=data.location_id,
                to_warehouse_id=data.warehouse_id,
                to_location_id=data.location_id,
                to_project_id=row.project_id,
                reference=(data.reference or "").strip() or f"STOCK-REQUEST-{row.id}",
                notes=(data.notes or "").strip() or row.notes,
            ),
            commit=False,
        )
        row.status = "issued"
        row.approved_by_email = row.approved_by_email or _email(request)
        await db_session.commit()
        await db_session.refresh(row)
        matches = [
            r for r in await _request_reads(db_session, project_id=row.project_id) if r.id == row.id
        ]
        return matches[0]
