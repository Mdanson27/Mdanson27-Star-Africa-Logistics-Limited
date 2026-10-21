#!/bin/sh
set -eu

echo "Applying database migrations..."
alembic upgrade head

echo "Starting Bertcom API..."
exec granian   --interface asgi   app.main:app   --host 0.0.0.0   --port "${PORT:-8000}"   --access-log   --log-level info   --workers 1   --runtime-threads 1   --http auto   --backlog 512
