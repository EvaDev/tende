#!/usr/bin/env bash
# Copy deploy/env → server/.env and render cloudflared config from template.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/env"
OUT="${ROOT}/server/.env"
CF_OUT="${SCRIPT_DIR}/cloudflared-config.yml"
CF_TEMPLATE="${SCRIPT_DIR}/cloudflared-config.yml.template"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE} — copy deploy/env.example to deploy/env first" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

export IMALI_ROOT="${IMALI_ROOT:-$ROOT}"
export CADDY_PORT="${CADDY_PORT:-8080}"
export TUNNEL_NAME="${TUNNEL_NAME:-imali-mac-mini}"
export DOMAIN="${DOMAIN:-imali.app}"

DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}"
CORS_ORIGINS="https://app.${DOMAIN},https://admin.${DOMAIN},https://merchant.${DOMAIN}"
WEBAUTHN_ORIGIN="https://app.${DOMAIN},https://merchant.${DOMAIN}"
IDOS_ISSUER_URI="https://api.${DOMAIN}/idos"

tmp="$(mktemp)"
have_db=0 have_cors=0 have_webauthn_origin=0 have_rp_id=0 have_idos=0

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && { echo "$line" >> "$tmp"; continue; }
  [[ -z "${line// }" ]] && { echo >> "$tmp"; continue; }
  if [[ "$line" =~ ^DATABASE_URL= ]]; then
    echo "DATABASE_URL=${DATABASE_URL}" >> "$tmp"; have_db=1; continue
  fi
  if [[ "$line" =~ ^CORS_ORIGINS= ]]; then
    echo "CORS_ORIGINS=${CORS_ORIGINS}" >> "$tmp"; have_cors=1; continue
  fi
  if [[ "$line" =~ ^WEBAUTHN_ORIGIN= ]]; then
    echo "WEBAUTHN_ORIGIN=${WEBAUTHN_ORIGIN}" >> "$tmp"; have_webauthn_origin=1; continue
  fi
  if [[ "$line" =~ ^WEBAUTHN_RP_ID= ]]; then
    echo "WEBAUTHN_RP_ID=${DOMAIN}" >> "$tmp"; have_rp_id=1; continue
  fi
  if [[ "$line" =~ ^IDOS_ISSUER_URI= ]]; then
    echo "IDOS_ISSUER_URI=${IDOS_ISSUER_URI}" >> "$tmp"; have_idos=1; continue
  fi
  # shellcheck disable=SC2097,SC2098
  eval "echo \"$line\"" >> "$tmp"
done < "${ENV_FILE}"

# Always inject composed values (deploy/env only needs PG_* etc.)
{
  (( have_db )) || echo "DATABASE_URL=${DATABASE_URL}"
  (( have_cors )) || echo "CORS_ORIGINS=${CORS_ORIGINS}"
  (( have_rp_id )) || echo "WEBAUTHN_RP_ID=${DOMAIN}"
  (( have_webauthn_origin )) || echo "WEBAUTHN_ORIGIN=${WEBAUTHN_ORIGIN}"
  (( have_idos )) || echo "IDOS_ISSUER_URI=${IDOS_ISSUER_URI}"
} >> "$tmp"

mv "$tmp" "$OUT"
chmod 600 "$OUT"
echo "==> Wrote ${OUT}"

sed \
  -e "s|__TUNNEL_NAME__|${TUNNEL_NAME}|g" \
  -e "s|__DOMAIN__|${DOMAIN}|g" \
  -e "s|__CADDY_PORT__|${CADDY_PORT}|g" \
  -e "s|__IMALI_ROOT__|${IMALI_ROOT}|g" \
  "${CF_TEMPLATE}" > "${CF_OUT}"
echo "==> Wrote ${CF_OUT}"
