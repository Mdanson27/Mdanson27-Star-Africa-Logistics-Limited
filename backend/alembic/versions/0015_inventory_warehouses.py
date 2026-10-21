"""Inventory and warehouses.

Revision ID: 0015
Revises: 0014
Create Date: 2026-10-20 12:15:00 UTC
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inventory_categories",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("ix_inventory_categories_name", "inventory_categories", ["name"])

    op.create_table(
        "inventory_units",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(96), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_inventory_units_code", "inventory_units", ["code"])

    op.create_table(
        "warehouses",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("address", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    for col in ("code", "name", "is_active"):
        op.create_index(f"ix_warehouses_{col}", "warehouses", [col])

    op.create_table(
        "inventory_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("sku", sa.String(96), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("unit_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("supplier_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("unit_cost_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("minimum_stock_level", sa.Numeric(18, 3), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.ForeignKeyConstraint(["category_id"], ["inventory_categories.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["unit_id"], ["inventory_units.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["supplier_id"], ["suppliers.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("sku"),
    )
    for col in ("sku", "name", "category_id", "unit_id", "supplier_id", "is_active"):
        op.create_index(f"ix_inventory_items_{col}", "inventory_items", [col])

    op.create_table(
        "warehouse_locations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("warehouse_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("parent_location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("code", sa.String(64), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("location_type", sa.String(32), server_default="area", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["parent_location_id"], ["warehouse_locations.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("warehouse_id", "code", name="uq_warehouse_location_code"),
    )
    for col in ("warehouse_id", "parent_location_id", "location_type"):
        op.create_index(f"ix_warehouse_locations_{col}", "warehouse_locations", [col])

    op.create_table(
        "stock_balances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("warehouse_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("quantity", sa.Numeric(18, 3), server_default="0", nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["inventory_items.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["warehouse_id"], ["warehouses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["warehouse_locations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for col in ("item_id", "warehouse_id", "location_id", "project_id"):
        op.create_index(f"ix_stock_balances_{col}", "stock_balances", [col])
    op.execute(
        "CREATE UNIQUE INDEX uq_stock_balance_scope ON stock_balances "
        "(item_id, warehouse_id, COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid), "
        "COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid));"
    )

    op.create_table(
        "stock_transactions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("movement_type", sa.String(32), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("unit_cost_ugx", sa.Numeric(18, 2), server_default="0", nullable=False),
        sa.Column("from_warehouse_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("from_location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("from_project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("to_warehouse_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("to_location_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("to_project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("reference", sa.String(128), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_email", sa.String(255), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["inventory_items.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["from_warehouse_id"], ["warehouses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["from_location_id"], ["warehouse_locations.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["from_project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["to_warehouse_id"], ["warehouses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(
            ["to_location_id"], ["warehouse_locations.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(["to_project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("quantity > 0", name="ck_stock_transaction_positive_quantity"),
    )
    for col in (
        "item_id",
        "movement_type",
        "from_warehouse_id",
        "from_project_id",
        "to_warehouse_id",
        "to_project_id",
        "reference",
        "created_by_email",
    ):
        op.create_index(f"ix_stock_transactions_{col}", "stock_transactions", [col])

    op.create_table(
        "stock_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_quantity", sa.Numeric(18, 3), nullable=False),
        sa.Column("approved_quantity", sa.Numeric(18, 3), server_default="0", nullable=False),
        sa.Column("status", sa.String(24), server_default="pending", nullable=False),
        sa.Column("requested_by_email", sa.String(255), nullable=False),
        sa.Column("approved_by_email", sa.String(255), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["inventory_items.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint("requested_quantity > 0", name="ck_stock_request_positive_quantity"),
    )
    for col in ("project_id", "item_id", "status", "requested_by_email"):
        op.create_index(f"ix_stock_requests_{col}", "stock_requests", [col])

    for table in (
        "inventory_categories",
        "inventory_units",
        "inventory_items",
        "warehouses",
        "warehouse_locations",
        "stock_balances",
        "stock_transactions",
        "stock_requests",
    ):
        op.execute(
            f"DROP TRIGGER IF EXISTS trg_audit_{table} ON {table}; "
            f"CREATE TRIGGER trg_audit_{table} AFTER INSERT OR UPDATE OR DELETE ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION process_audit_log();"
        )


def downgrade() -> None:
    for table in (
        "stock_requests",
        "stock_transactions",
        "stock_balances",
        "warehouse_locations",
        "inventory_items",
        "warehouses",
        "inventory_units",
        "inventory_categories",
    ):
        op.execute(f"DROP TRIGGER IF EXISTS trg_audit_{table} ON {table};")
    op.drop_table("stock_requests")
    op.drop_table("stock_transactions")
    op.execute("DROP INDEX IF EXISTS uq_stock_balance_scope;")
    op.drop_table("stock_balances")
    op.drop_table("warehouse_locations")
    op.drop_table("inventory_items")
    op.drop_table("warehouses")
    op.drop_table("inventory_units")
    op.drop_table("inventory_categories")
