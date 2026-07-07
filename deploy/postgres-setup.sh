#!/usr/bin/env bash
# Create the iMali Postgres role and database on the Mac Mini.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.example
source "${SCRIPT_DIR}/env"

: "${PG_USER:?PG_USER not set in deploy/env}"
: "${PG_PASSWORD:?PG_PASSWORD not set in deploy/env}"
: "${PG_DATABASE:?PG_DATABASE not set in deploy/env}"

echo "==> Ensuring Postgres is running"
if command -v brew >/dev/null 2>&1; then
  brew services start postgresql@16 2>/dev/null || brew services start postgresql 2>/dev/null || true
fi

PSQL=(psql -v ON_ERROR_STOP=1 postgres)

echo "==> Creating role ${PG_USER} (if missing)"
"${PSQL[@]}" -tc "SELECT 1 FROM pg_roles WHERE rolname = '${PG_USER}'" | grep -q 1 \
  || "${PSQL[@]}" -c "CREATE ROLE ${PG_USER} WITH LOGIN PASSWORD '${PG_PASSWORD}';"

echo "==> Creating database ${PG_DATABASE} (if missing)"
"${PSQL[@]}" -tc "SELECT 1 FROM pg_database WHERE datname = '${PG_DATABASE}'" | grep -q 1 \
  || "${PSQL[@]}" -c "CREATE DATABASE ${PG_DATABASE} OWNER ${PG_USER};"

"${PSQL[@]}" -c "GRANT ALL PRIVILEGES ON DATABASE ${PG_DATABASE} TO ${PG_USER};"

echo "==> Postgres ready: ${PG_DATABASE} owned by ${PG_USER}"
