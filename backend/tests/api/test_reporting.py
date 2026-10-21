"""Regression coverage for Reporting & Analytics 2.0."""

import uuid

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio


class TestReportingAnalytics:
    async def test_accounting_reports_are_balanced_and_financially_linked(
        self,
        async_client: AsyncClient,
        registered_user: dict,
    ) -> None:
        suffix = uuid.uuid4().hex[:8]
        headers = {"Authorization": f"Bearer {registered_user['token']}"}

        client = await async_client.post(
            "/api/v1/business/clients",
            headers=headers,
            json={"name": f"Reporting Client {suffix}"},
        )
        assert client.status_code == 201, client.text
        client_id = client.json()["id"]

        invoice = await async_client.post(
            "/api/v1/business/invoices",
            headers=headers,
            json={
                "invoice_number": f"IGNORED-{suffix}",
                "client_name": f"Reporting Client {suffix}",
                "client_id": client_id,
                "amount_ugx": 1_000_000,
                "paid_amount_ugx": 200_000,
                "issue_date": "2040-01-10",
                "items": [
                    {
                        "description": "Reporting implementation",
                        "quantity": 1,
                        "unit_price_ugx": 1_000_000,
                    }
                ],
            },
        )
        assert invoice.status_code == 201, invoice.text

        expense = await async_client.post(
            "/api/v1/business/expenses",
            headers=headers,
            json={
                "description": f"Reporting test expense {suffix}",
                "amount_ugx": 100_000,
                "expense_date": "2040-01-11",
                "category": "software",
            },
        )
        assert expense.status_code == 201, expense.text

        pnl = await async_client.get(
            "/api/v1/reports/profit-loss?from_date=2040-01-01&to_date=2040-12-31",
            headers=headers,
        )
        assert pnl.status_code == 200, pnl.text
        pnl_body = pnl.json()
        assert pnl_body["total_revenue_ugx"] >= 1_000_000
        assert pnl_body["total_expenses_ugx"] >= 100_000
        assert pnl_body["net_profit_ugx"] >= 900_000

        cash = await async_client.get(
            "/api/v1/reports/cash-flow?from_date=2040-01-01&to_date=2040-12-31",
            headers=headers,
        )
        assert cash.status_code == 200, cash.text
        cash_body = cash.json()
        assert cash_body["inflows_ugx"] >= 200_000
        assert cash_body["outflows_ugx"] >= 100_000

        aging = await async_client.get(
            "/api/v1/reports/receivables-aging?as_of=2040-12-31",
            headers=headers,
        )
        assert aging.status_code == 200, aging.text
        assert aging.json()["total_ugx"] >= 800_000

        trial = await async_client.get(
            "/api/v1/reports/trial-balance?as_of=2040-12-31",
            headers=headers,
        )
        assert trial.status_code == 200, trial.text
        trial_body = trial.json()
        assert trial_body["balanced"] is True
        assert abs(trial_body["difference_ugx"]) < 0.01
        assert trial_body["total_debits_ugx"] == trial_body["total_credits_ugx"]

        balance = await async_client.get(
            "/api/v1/reports/balance-sheet?as_of=2040-12-31",
            headers=headers,
        )
        assert balance.status_code == 200, balance.text
        assert balance.json()["balanced"] is True

    async def test_dashboard_and_manual_journal_endpoints(
        self,
        async_client: AsyncClient,
        registered_user: dict,
    ) -> None:
        headers = {"Authorization": f"Bearer {registered_user['token']}"}

        dashboard = await async_client.get("/api/v1/reports/dashboard?months=6", headers=headers)
        assert dashboard.status_code == 200, dashboard.text
        body = dashboard.json()
        assert "monthly_finance" in body
        assert "project_status" in body
        assert "task_status" in body
        assert "expense_categories" in body

        accounts = await async_client.get("/api/v1/reports/accounts", headers=headers)
        assert accounts.status_code == 200, accounts.text
        codes = {item["code"] for item in accounts.json()}
        assert {"1000", "1100", "3000", "4000", "5000"}.issubset(codes)

        journal = await async_client.post(
            "/api/v1/reports/journal-entries",
            headers=headers,
            json={
                "entry_date": "2040-02-01",
                "reference": "CAPITAL-TEST",
                "description": "Owner capital introduced",
                "lines": [
                    {"account_code": "1000", "debit_ugx": 500_000},
                    {"account_code": "3000", "credit_ugx": 500_000},
                ],
            },
        )
        assert journal.status_code == 201, journal.text
        assert len(journal.json()["lines"]) == 2

        trial = await async_client.get(
            "/api/v1/reports/trial-balance?as_of=2040-12-31",
            headers=headers,
        )
        assert trial.status_code == 200, trial.text
        assert trial.json()["balanced"] is True
