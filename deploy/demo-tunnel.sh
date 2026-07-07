#!/usr/bin/env bash
# Public HTTPS demo without owning a domain.
# Uses Cloudflare Quick Tunnel → random *.trycloudflare.com URL (free, no DNS setup).
#
# Limitations vs production deploy:
#   - URL changes every time you restart this script
#   - Consumer app only (admin/merchant need subdomains or path-based builds)
#   - Passkeys: update WEBAUTHN_ORIGIN to the new URL, then pm2 restart imali-server
#
# Prerequisites: pm2 running imali-server, consumer/dist built.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [[ -f "${SCRIPT_DIR}/env" ]]; then
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/env"
fi

IMALI_ROOT="${IMALI_ROOT:-$ROOT}"
CADDY_PORT="${CADDY_PORT:-8080}"
CADDY_PID=""

cleanup() {
  if [[ -n "${CADDY_PID}" ]] && kill -0 "${CADDY_PID}" 2>/dev/null; then
    kill "${CADDY_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -d "${IMALI_ROOT}/consumer/dist" ]]; then
  echo "Missing ${IMALI_ROOT}/consumer/dist — run ./deploy/build-all.sh first" >&2
  exit 1
fi

if ! curl -sf "http://127.0.0.1:3001/health" >/dev/null 2>&1; then
  echo "API not reachable on :3001 — run: pm2 start deploy/ecosystem.config.cjs" >&2
  exit 1
fi

if lsof -nP -iTCP:"${CADDY_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "==> Port ${CADDY_PORT} already in use — assuming Caddy is running"
else
  echo "==> Starting Caddy (demo mode) on :${CADDY_PORT}"
  IMALI_ROOT="${IMALI_ROOT}" CADDY_PORT="${CADDY_PORT}" \
    caddy run --config "${SCRIPT_DIR}/Caddyfile.demo" --adapter caddyfile &
  CADDY_PID=$!
  sleep 1
fi

echo ""
echo "==> Starting Cloudflare Quick Tunnel (no domain, no login, no DNS)"
echo ""
echo "    When the https://....trycloudflare.com URL appears, open it in a browser."
echo ""
echo "    Passkey demo only: add to deploy/env, then ./deploy/link-env.sh && pm2 restart imali-server"
echo "      WEBAUTHN_RP_ID=trycloudflare.com"
echo "      WEBAUTHN_ORIGIN=https://<paste-url-here>.trycloudflare.com"
echo "      CORS_ORIGINS=https://<paste-url-here>.trycloudflare.com"
echo ""
echo "    Admin console: use http://localhost:5174 via npm run dev:admin on the Mac Mini,"
echo "    or set up a domain later for the full multi-subdomain deploy."
echo ""

exec cloudflared tunnel --url "http://127.0.0.1:${CADDY_PORT}"
