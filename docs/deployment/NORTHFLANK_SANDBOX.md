# Bertcom Africa Business OS — Northflank Sandbox Deployment

This deployment is for testing. It uses the Northflank Developer Sandbox and keeps Neon as the source of truth for PostgreSQL, TimescaleDB, Better Auth, and object storage.

## Target topology

- GitHub Pages — React frontend
- Northflank service 1 — `bertcom-api`
- Northflank service 2 — `bertcom-worker`
- Northflank Redis addon — `bertcom-valkey`
- Neon — PostgreSQL, TimescaleDB, pgvector, Better Auth, object storage

The Sandbox currently provides two free services and one free database/addon, which matches this topology.

## Northflank project

Create one project named:

`Bertcom Africa Business OS`

Use the Developer Sandbox plan.

## Service 1 — bertcom-api

Type: Combined service

Repository:
`https://github.com/Mdanson27/Bertcom-Africa-Limited`

Branch:
`main`

Build type:
Dockerfile

Dockerfile:
`/backend/Dockerfile`

Build context:
`/backend`

Deployment:
- 1 instance
- smallest Sandbox compute
- public HTTP port: 8000
- health check: `/health/live`

Docker runtime:
- custom entrypoint: `sh`
- custom command: `/app/scripts/start_api.sh`

Environment:
- `ENVIRONMENT=production`
- `DEBUG=false`
- `CORS_ALLOWED_ORIGINS=https://mdanson27.github.io`
- `PLATFORM_ADMIN_EMAIL=<approved-star-africa-admin-email>`
- `DATABASE_URL=<Neon pooled database URL>`
- `DATABASE_URL_UNPOOLED=<Neon direct database URL>`
- `NEON_AUTH_BASE_URL=<Neon auth base URL>`
- `NEON_AUTH_JWKS_URL=<Neon JWKS URL>`
- `VALKEY_URL=<Northflank Redis connection URL>`
- `SECRET_KEY=<strong random secret>`

Never commit these values to GitHub.

## Service 2 — bertcom-worker

Type: Combined service

Use the same repository, branch, Dockerfile, and build context as the API.

Do not expose a public port.

Docker runtime:
- custom entrypoint: `sh`
- custom command: `/app/scripts/start_worker.sh`

Give it the same runtime environment values as the API service.

## Redis addon

Create a Redis addon named:

`bertcom-valkey`

- private access only
- TLS if available on the selected Sandbox configuration
- link its connection URL into both services as `VALKEY_URL`

## Frontend API endpoint

When `bertcom-api` has a public Northflank HTTPS hostname, set GitHub Actions repository variable:

`VITE_API_URL=https://<northflank-api-hostname>`

Then rerun the GitHub Pages deployment.

## Required verification

API:
- `/health`
- `/health/live`
- `/health/ready`
- `/health/startup`

Expected after the stack is healthy:
- API healthy
- Neon database connected
- migrations current
- Redis/Valkey connected
- SAQ worker running
- Google/Neon Auth working from GitHub Pages
