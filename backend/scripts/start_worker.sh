#!/bin/sh
set -eu

echo "Starting Bertcom SAQ worker..."
exec python -m saq app.core.worker.settings --workers 1
