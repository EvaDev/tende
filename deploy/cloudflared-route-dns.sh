#!/usr/bin/env bash
# Register DNS CNAME records for all iMali subdomains on the named tunnel.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/env"

: "${TUNNEL_NAME:?TUNNEL_NAME not set}"
: "${DOMAIN:?DOMAIN not set}"

hosts=(app admin merchant api)

for h in "${hosts[@]}"; do
  fqdn="${h}.${DOMAIN}"
  echo "==> Routing ${fqdn} → tunnel ${TUNNEL_NAME}"
  cloudflared tunnel route dns "${TUNNEL_NAME}" "${fqdn}"
done

echo "==> DNS routes registered"
