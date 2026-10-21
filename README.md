# Star Africa Logistics Limited Operating System

Company operating system for **Star Africa Logistics Limited**, maintained by the AutoMinds Africa technical team.

This repository was initialized from the stable Bertcom Business OS architecture, but it is a **separate product and data environment**. Do not connect it to Bertcom databases, auth projects, object storage, or runtime endpoints.

## Branding files to add
Put the following exact files in `frontend/public/branding/`:

- `star-africa-logo.png`
- `star-africa-logo-compact.png`
- `star-africa-mark.png`

The code is already wired to those paths in `frontend/src/config/brand.ts`.

## Technical team — start here
Read **[STAR_AFRICA_CONVERSION.md](STAR_AFRICA_CONVERSION.md)** before making changes. It contains the conversion checklist, security rules, branch workflow, and logistics feature backlog.

## Development workflow
1. Clone this repository.
2. Copy `.env.testing.example` to `.env.testing` and fill it only with **Star Africa-specific** test credentials.
3. Never commit `.env.testing`.
4. Create a feature branch; do not work directly on `main`.
5. Run backend/frontend checks before opening a PR.
6. Merge only after CI passes.

## Core modules inherited from the Business OS foundation
Dashboard, Projects, Bids & Tenders, Inventory & Warehouses, Documents, Business, Tasks, Reports, Settings and audit controls.

## Next Star Africa modules
Fleet Management, Shipment & Delivery Management, Driver Management, then Employees & Payroll and unified logistics reporting.

Powered by **AutoMinds Africa**.
