# Star Africa Logistics Limited Operating System — AutoMinds Technical Team Handover

## Purpose
This repository is a separate Star Africa Logistics Limited OS derived from the stable Bertcom Business OS foundation. Do not push Star Africa changes back into the Bertcom repository.

## Branding assets
Place these exact files in `frontend/public/branding/`:
- `star-africa-logo.png`
- `star-africa-logo-compact.png`
- `star-africa-mark.png`

The application reads them from `frontend/src/config/brand.ts`. Company-facing names, domain, emails and administrator contact should also be changed in that one file rather than hard-coded across components.

For generated quotation/invoice/receipt PDFs, also copy the approved primary `star-africa-logo.png` into `backend/src/app/assets/star-africa-logo.png`. If it is not present yet, PDFs intentionally render without a logo rather than showing Bertcom branding.

## Safety rules
1. Never commit `.env`, `.env.testing`, passwords, OAuth secrets, database URLs, JWT secrets or API keys.
2. Star Africa must use its own Neon project/database, object storage, authentication configuration and runtime endpoint. Never point this repository at Bertcom's database.
3. Work on feature branches. Do not push unfinished work directly to `main`.
4. Every database change needs an Alembic migration and a rollback path.
5. Every stock quantity change must continue to create an auditable stock transaction.
6. CI must pass before merging.

## Branch workflow
```text
git checkout main
git pull --ff-only origin main
git checkout -b feature/<short-task-name>
# make and test changes
git add <intended-files>
git commit -m "Describe the change"
git push -u origin feature/<short-task-name>
# open PR -> CI -> review -> merge
```


## GitHub repository configuration before enabling Pages
Create these repository secrets in **Settings -> Secrets and variables -> Actions**:
- `VITE_NEON_AUTH_URL` — the Star Africa Neon Auth base URL.
- `VITE_PLATFORM_ADMIN_EMAIL` — the approved Star Africa platform administrator email.

Do not reuse Bertcom values. The Star Africa Pages build intentionally has no hard-coded auth endpoint or administrator.

GitHub Pages deployment is intentionally **manual-only** at this stage. Enable automatic deployment only after the Star Africa secrets, database/auth environment, and branding files are ready.

## Phase 1 — conversion checklist
- [ ] Star Africa logo, compact logo and mark installed.
- [ ] No visible Bertcom branding remains.
- [ ] Star Africa legal/company details verified.
- [ ] Separate Star Africa Neon database created.
- [ ] Separate Star Africa Neon Auth/OAuth configured.
- [ ] Separate object-storage bucket configured.
- [ ] Platform administrator(s) agreed and provisioned.
- [ ] Login/password reset tested.
- [ ] Dashboard, Projects, Bids & Tenders, Inventory, Documents, Business, Tasks and Reports tested.
- [ ] Create -> refresh -> navigate -> return persistence test passes.

## Logistics adaptation backlog
After the conversion is stable, add logistics-specific modules without removing the reusable Business OS foundation:

### Fleet Management
Vehicles, registration, insurance, licence/inspection dates, mileage, fuel, maintenance, driver assignment, incidents and vehicle expenses.

### Shipment & Delivery Management
Shipment/job number, client, origin, destination, cargo, quantity/weight, assigned vehicle/driver, dispatch/ETA/arrival, status, proof of delivery, documents, revenue and costs.

### Driver Management
Driver profile, licence/expiry, vehicle assignments, trips, incidents, allowances and payroll linkage.

## Existing modules to retain
- Projects
- Bids & Tenders -> Awarded -> Convert to Project
- Inventory & Warehouses -> General or Project stock
- Documents
- Business / commercial documents
- Tasks
- Reports
- Settings / roles / audit controls

## Definition of done for initial Star Africa conversion
Open Star Africa OS -> sign in -> confirm Star Africa branding -> create a record -> refresh -> record persists -> navigate to Projects/Bids/Inventory/Documents/Business/Tasks/Reports -> no Bertcom-facing branding or Bertcom data appears.
