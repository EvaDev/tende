#!/usr/bin/env bash
# Apply db/*.sql migrations in numeric order.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${SCRIPT_DIR}/env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/env"
fi

DATABASE_URL="${DATABASE_URL:-postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}}"
: "${DATABASE_URL:?DATABASE_URL not set — copy deploy/env.example to deploy/env}"

echo "==> Applying migrations from ${ROOT}/db"
shopt -s nullglob
files=("${ROOT}"/db/[0-9][0-9][0-9]_*.sql)
if (( ${#files[@]} == 0 )); then
  echo "No migration files found in ${ROOT}/db" >&2
  exit 1
fi

for f in "${files[@]}"; do
  echo "    $(basename "$f")"
  psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -f "$f" -q
done

echo "==> Migrations complete (${#files[@]} files)"
