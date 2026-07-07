#!/usr/bin/env bash
# One-shot Mac Mini bootstrap: brew deps, Postgres, migrations, build, env link.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ ! -f "${SCRIPT_DIR}/env" ]]; then
  echo "==> Creating deploy/env from example — edit secrets before going live"
  cp "${SCRIPT_DIR}/env.example" "${SCRIPT_DIR}/env"
  echo "    Edit ${SCRIPT_DIR}/env then re-run this script"
  exit 1
fi

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/env"
export IMALI_ROOT="${IMALI_ROOT:-$ROOT}"
export DOMAIN CADDY_PORT

echo "==> Checking Homebrew dependencies"
need=()
for pkg in postgresql@16 caddy cloudflared node@20; do
  brew list "$pkg" &>/dev/null || need+=("$pkg")
done
if (( ${#need[@]} > 0 )); then
  echo "    Installing: ${need[*]}"
  brew install "${need[@]}"
fi

if ! command -v pm2 &>/dev/null; then
  echo "==> Installing PM2"
  npm install -g pm2
fi

chmod +x "${SCRIPT_DIR}"/*.sh

echo "==> Postgres"
"${SCRIPT_DIR}/postgres-setup.sh"

echo "==> Link server/.env"
"${SCRIPT_DIR}/link-env.sh"

echo "==> Database migrations"
"${SCRIPT_DIR}/migrate-db.sh"

echo "==> Build all apps"
"${SCRIPT_DIR}/build-all.sh"

echo ""
echo "==> Bootstrap complete. Next steps:"
echo "    1. cloudflared tunnel login"
echo "    2. cloudflared tunnel create ${TUNNEL_NAME:-imali-mac-mini}"
echo "    3. cp ~/.cloudflared/<id>.json deploy/cloudflared-credentials.json"
echo "    4. ./deploy/cloudflared-route-dns.sh"
echo "    5. pm2 start deploy/ecosystem.config.cjs"
echo "    6. DOMAIN=${DOMAIN} IMALI_ROOT=${IMALI_ROOT} CADDY_PORT=${CADDY_PORT:-8080} caddy run --config deploy/Caddyfile"
echo "    7. cloudflared tunnel --config deploy/cloudflared-config.yml run"
echo ""
echo "    Or install launchd agents: ./deploy/install-launchd.sh"
