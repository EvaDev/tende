#!/usr/bin/env bash
# Install launchd agents for server (PM2), Caddy, and cloudflared.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/env"

export IMALI_ROOT="${IMALI_ROOT:-$ROOT}"
LABEL_PREFIX="app.imali"
AGENT_DIR="${HOME}/Library/LaunchAgents"

render() {
  local src="$1" dest="$2"
  sed \
    -e "s|__IMALI_ROOT__|${IMALI_ROOT}|g" \
    -e "s|__DOMAIN__|${DOMAIN}|g" \
    -e "s|__CADDY_PORT__|${CADDY_PORT:-8080}|g" \
    -e "s|__TUNNEL_NAME__|${TUNNEL_NAME}|g" \
    "$src" > "$dest"
}

mkdir -p "${AGENT_DIR}"
mkdir -p "${IMALI_ROOT}/deploy/logs"

for svc in server caddy cloudflared; do
  render "${SCRIPT_DIR}/launchd/${svc}.plist.template" "${AGENT_DIR}/${LABEL_PREFIX}.${svc}.plist"
  echo "==> Installed ${AGENT_DIR}/${LABEL_PREFIX}.${svc}.plist"
done

echo "==> Load agents (or reboot):"
echo "    launchctl load ${AGENT_DIR}/${LABEL_PREFIX}.server.plist"
echo "    launchctl load ${AGENT_DIR}/${LABEL_PREFIX}.caddy.plist"
echo "    launchctl load ${AGENT_DIR}/${LABEL_PREFIX}.cloudflared.plist"
