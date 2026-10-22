import uuid

import pytest
from httpx import AsyncClient

from app.core.security import create_access_token

pytestmark = pytest.mark.asyncio


def _admin_headers() -> dict[str, str]:
    token = create_access_token(
        subject=str(uuid.uuid4()),
        is_superuser=True,
        extra={"email": "automindsafrica@gmail.com"},
    )
    return {"Authorization": f"Bearer {token}"}


def _user_headers() -> dict[str, str]:
    token = create_access_token(
        subject=str(uuid.uuid4()),
        is_superuser=False,
        extra={"email": "staff@example.com"},
    )
    return {"Authorization": f"Bearer {token}"}


async def _create_employee(client: AsyncClient, headers: dict[str, str], suffix: str) -> dict:
    response = await client.post(
        "/api/v1/people/employees",
        headers=headers,
        json={
            "employee_no": f"PAY-{suffix}",
            "full_name": f"Payroll Employee {suffix}",
            "email": f"payroll.{suffix.lower()}@example.com",
            "job_title": "Operations Officer",
            "department": "Operations",
            "base_salary_ugx": 1000000,
            "payment_method": "bank",
            "is_active": True,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


class TestPeopleAccess:
    async def test_people_requires_superadmin(self, async_client: AsyncClient):
        response = await async_client.get("/api/v1/people/employees", headers=_user_headers())
        assert response.status_code == 403

    async def test_admin_can_create_employee_and_employee_is_assignable(
        self, async_client: AsyncClient
    ):
        headers = _admin_headers()
        suffix = uuid.uuid4().hex[:6].upper()
        employee = await _create_employee(async_client, headers, suffix)

        assignable = await async_client.get("/api/v1/users/assignable", headers=headers)
        assert assignable.status_code == 200, assignable.text
        assert any(row["email"] == employee["email"] for row in assignable.json())


class TestPayrollWorkflow:
    async def test_payroll_run_calculation_and_locking(self, async_client: AsyncClient):
        headers = _admin_headers()
        suffix = uuid.uuid4().hex[:6].upper()
        employee = await _create_employee(async_client, headers, suffix)

        run_response = await async_client.post(
            "/api/v1/people/payroll-runs",
            headers=headers,
            json={
                "period_start": "2026-09-01",
                "period_end": "2026-09-30",
                "pay_date": "2026-10-01",
                "notes": "Payroll test",
            },
        )
        assert run_response.status_code == 201, run_response.text
        run = run_response.json()

        payments_response = await async_client.get(
            f"/api/v1/people/payroll-payments?payroll_run_id={run['id']}",
            headers=headers,
        )
        assert payments_response.status_code == 200, payments_response.text
        payments = payments_response.json()
        payment = next(row for row in payments if row["employee_id"] == employee["id"])
        assert payment["basic_pay_ugx"] == 1000000

        updated = await async_client.patch(
            f"/api/v1/people/payroll-payments/{payment['id']}",
            headers=headers,
            json={"allowances_ugx": 100000, "deductions_ugx": 50000},
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["gross_pay_ugx"] == 1100000
        assert updated.json()["net_pay_ugx"] == 1050000

        finalized = await async_client.patch(
            f"/api/v1/people/payroll-runs/{run['id']}",
            headers=headers,
            json={"status": "finalized"},
        )
        assert finalized.status_code == 200, finalized.text

        locked_math = await async_client.patch(
            f"/api/v1/people/payroll-payments/{payment['id']}",
            headers=headers,
            json={"allowances_ugx": 200000},
        )
        assert locked_math.status_code == 409

        paid = await async_client.patch(
            f"/api/v1/people/payroll-runs/{run['id']}",
            headers=headers,
            json={"status": "paid"},
        )
        assert paid.status_code == 200, paid.text
        assert paid.json()["status"] == "paid"

        paid_rows = await async_client.get(
            f"/api/v1/people/payroll-payments?payroll_run_id={run['id']}",
            headers=headers,
        )
        assert all(row["payment_status"] == "paid" for row in paid_rows.json())

        locked_paid = await async_client.patch(
            f"/api/v1/people/payroll-payments/{payment['id']}",
            headers=headers,
            json={"payment_reference": "SHOULD-NOT-CHANGE"},
        )
        assert locked_paid.status_code == 409
