"""Reliability workflow state and inventory defaults.

Revision ID: 0016
Revises: 0015
Create Date: 2026-10-22 06:10:00 UTC
"""

import sqlalchemy as sa

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


DEFAULT_CATEGORIES = [
    ("General Supplies", "General operational stock and uncategorized supplies."),
    ("Construction Materials", "Cement, aggregates, timber, steel and site materials."),
    ("Furniture & Fixtures", "Furniture, fittings and workplace fixtures."),
    ("Office Supplies", "Stationery, paper, printing and office consumables."),
    ("IT & Electronics", "Computers, networking, electronics and accessories."),
    ("Vehicle Parts & Consumables", "Vehicle spares, tyres, batteries and consumables."),
    ("Fuel & Lubricants", "Fuel, oils, grease and related consumables."),
    ("Safety & PPE", "Personal protective equipment and safety supplies."),
    ("Tools & Equipment", "Tools, machinery and operational equipment."),
    ("Packaging & Logistics", "Packaging, handling and logistics materials."),
    ("Cleaning & Maintenance", "Cleaning products and maintenance supplies."),
    ("Other", "Items that do not fit another standard category."),
]

DEFAULT_UNITS = [
    ("PCS", "Pieces"),
    ("BOX", "Box"),
    ("PKT", "Packet"),
    ("SET", "Set"),
    ("PAIR", "Pair"),
    ("CARTON", "Carton"),
    ("BAG", "Bag"),
    ("ROLL", "Roll"),
    ("KG", "Kilogram"),
    ("G", "Gram"),
    ("TON", "Tonne"),
    ("L", "Litre"),
    ("ML", "Millilitre"),
    ("M", "Metre"),
    ("M2", "Square Metre"),
    ("M3", "Cubic Metre"),
    ("HOUR", "Hour"),
    ("DAY", "Day"),
]


def upgrade() -> None:
    op.add_column(
        "quotations", sa.Column("previewed_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.add_column("invoices", sa.Column("previewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "purchase_orders", sa.Column("previewed_at", sa.DateTime(timezone=True), nullable=True)
    )

    connection = op.get_bind()
    for name, description in DEFAULT_CATEGORIES:
        connection.execute(
            sa.text(
                """
                INSERT INTO inventory_categories (id, name, description, is_active)
                VALUES (gen_random_uuid(), :name, :description, true)
                ON CONFLICT (name) DO NOTHING
                """
            ),
            {"name": name, "description": description},
        )
    for code, name in DEFAULT_UNITS:
        connection.execute(
            sa.text(
                """
                INSERT INTO inventory_units (id, code, name, is_active)
                VALUES (gen_random_uuid(), :code, :name, true)
                ON CONFLICT (code) DO NOTHING
                """
            ),
            {"code": code, "name": name},
        )


def downgrade() -> None:
    op.drop_column("purchase_orders", "previewed_at")
    op.drop_column("invoices", "previewed_at")
    op.drop_column("quotations", "previewed_at")
