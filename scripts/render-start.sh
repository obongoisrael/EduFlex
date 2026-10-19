#!/usr/bin/env bash
# Render start command:  bash scripts/render-start.sh
#
# With LITESTREAM_REPLICA_URL set: restore the latest database backup (if any), then
# run EduFlex under Litestream so every change is streamed to the backup bucket.
# Without it: just start EduFlex (data is lost on restart on hosts without a disk).
set -euo pipefail
cd "$(dirname "$0")/.."

export EDUFLEX_DB_PATH="${EDUFLEX_DB_PATH:-$PWD/data/eduflex.db}"
mkdir -p "$(dirname "$EDUFLEX_DB_PATH")"

if [ -n "${LITESTREAM_REPLICA_URL:-}" ]; then
  echo "Restoring the database from backup (if one exists)..."
  # If the restore fails (wrong bucket keys/URL, storage outage) do NOT start with an
  # empty database: its backups would become the newest copy and hide the real data.
  if ! ./bin/litestream restore -config litestream.yml -if-db-not-exists -if-replica-exists "$EDUFLEX_DB_PATH"; then
    echo "ERROR: could not restore the database backup. Check LITESTREAM_REPLICA_URL,"
    echo "LITESTREAM_ACCESS_KEY_ID and LITESTREAM_SECRET_ACCESS_KEY. EduFlex was NOT started"
    echo "so that existing backups are not overwritten."
    exit 1
  fi
  echo "Starting EduFlex with continuous backup..."
  exec ./bin/litestream replicate -config litestream.yml -exec "node server.js"
else
  echo "LITESTREAM_REPLICA_URL is not set: starting WITHOUT backups."
  exec node server.js
fi
