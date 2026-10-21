"""Make the generic audit trigger portable across PostgreSQL versions.

Revision ID: 0014
Revises: 0013
Create Date: 2026-10-20 12:00:00 UTC
"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Some PostgreSQL versions cannot infer the polymorphic input type for
    # to_jsonb(NEW/OLD) inside a generic trigger function. row_to_json accepts
    # trigger records directly, so keep the audit semantics but avoid that
    # cross-version ambiguity.
    op.execute(
        r"""
        CREATE OR REPLACE FUNCTION process_audit_log()
        RETURNS TRIGGER AS $$
        DECLARE
            record_uuid uuid;
            actor_id text;
        BEGIN
            actor_id := NULLIF(current_setting('app.current_user_id', true), '');

            IF TG_OP = 'DELETE' THEN
                record_uuid := OLD.id;
                INSERT INTO audit_logs (
                    id, table_name, operation, record_id,
                    old_data, new_data, changed_by, created_at
                ) VALUES (
                    gen_random_uuid(), TG_TABLE_NAME, TG_OP, record_uuid,
                    row_to_json(OLD)::jsonb, NULL, actor_id, NOW()
                );
                RETURN OLD;
            ELSIF TG_OP = 'UPDATE' THEN
                record_uuid := NEW.id;
                INSERT INTO audit_logs (
                    id, table_name, operation, record_id,
                    old_data, new_data, changed_by, created_at
                ) VALUES (
                    gen_random_uuid(), TG_TABLE_NAME, TG_OP, record_uuid,
                    row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, actor_id, NOW()
                );
                RETURN NEW;
            ELSE
                record_uuid := NEW.id;
                INSERT INTO audit_logs (
                    id, table_name, operation, record_id,
                    old_data, new_data, changed_by, created_at
                ) VALUES (
                    gen_random_uuid(), TG_TABLE_NAME, TG_OP, record_uuid,
                    NULL, row_to_json(NEW)::jsonb, actor_id, NOW()
                );
                RETURN NEW;
            END IF;
        END;
        $$ LANGUAGE plpgsql;
        """
    )


def downgrade() -> None:
    op.execute(
        r"""
        CREATE OR REPLACE FUNCTION process_audit_log()
        RETURNS TRIGGER AS $$
        BEGIN
            INSERT INTO audit_logs (
                id,
                table_name,
                operation,
                record_id,
                old_data,
                new_data,
                changed_by,
                created_at
            ) VALUES (
                gen_random_uuid(),
                TG_TABLE_NAME,
                TG_OP,
                CASE
                    WHEN TG_OP = 'DELETE' THEN OLD.id
                    ELSE NEW.id
                END,
                CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
                CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END,
                NULLIF(current_setting('app.current_user_id', true), ''),
                NOW()
            );
            RETURN COALESCE(NEW, OLD);
        END;
        $$ LANGUAGE plpgsql;
        """
    )
