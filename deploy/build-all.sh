#!/usr/bin/env bash
# Install dependencies and build server + all three frontends.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${SCRIPT_DIR}/env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/env"
fi

IMALI_ROOT="${IMALI_ROOT:-$ROOT}"
cd "${IMALI_ROOT}"

echo "==> Node $(node -v) (expected ~20.x per .tool-versions)"

echo "==> Installing root dev deps"
npm install

for app in server admin consumer merchant; do
  echo "==> Installing ${app}"
  (cd "${app}" && npm install)
done

if [[ -n "${VITE_ALCHEMY_API_KEY:-}" || -n "${VITE_WALLETCONNECT_PROJECT_ID:-}" ]]; then
  export VITE_ALCHEMY_API_KEY VITE_WALLETCONNECT_PROJECT_ID
fi

echo "==> Building server"
(cd server && npm run build)

echo "==> Building admin"
(cd admin && npm run build)

echo "==> Building consumer"
(cd consumer && npm run build)

echo "==> Building merchant"
(cd merchant && npm run build)

echo "==> Build complete"
echo "    server/dist/index.js"
echo "    admin/dist/"
echo "    consumer/dist/"
echo "    merchant/dist/"
