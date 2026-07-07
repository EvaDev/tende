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

# Read a single KEY=value from deploy/env without sourcing secrets (avoids $ expansion).
env_val() {
  local key="$1" default="${2:-}"
  local line
  line="$(grep -m1 "^${key}=" "${ENV_FILE}" 2>/dev/null || true)"
  if [[ -z "${line}" ]]; then
    printf '%s' "${default}"
  else
    printf '%s' "${line#*=}"
  fi
}

PG_USER="$(env_val PG_USER imali)"
PG_PASSWORD="$(env_val PG_PASSWORD)"
PG_DATABASE="$(env_val PG_DATABASE imali)"
PG_HOST="$(env_val PG_HOST localhost)"
PG_PORT="$(env_val PG_PORT 5432)"
DOMAIN="$(env_val DOMAIN imali.app)"
TUNNEL_NAME="$(env_val TUNNEL_NAME imali-mac-mini)"
IMALI_ROOT="$(env_val IMALI_ROOT "${ROOT}")"
CADDY_PORT="$(env_val CADDY_PORT 8080)"

DATABASE_URL="postgresql://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${PG_DATABASE}"
DEFAULT_CORS="https://app.${DOMAIN},https://admin.${DOMAIN},https://merchant.${DOMAIN}"
DEFAULT_WEBAUTHN="https://app.${DOMAIN},https://merchant.${DOMAIN}"
DEFAULT_IDOS="https://api.${DOMAIN}/idos"

tmp="$(mktemp)"
have_db=0 have_cors=0 have_webauthn_origin=0 have_rp_id=0 have_idos=0

while IFS= read -r line || [[ -n "$line" ]]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && { printf '%s\n' "$line" >> "$tmp"; continue; }
  [[ -z "${line// }" ]] && { printf '\n' >> "$tmp"; continue; }

  if [[ "$line" =~ ^DATABASE_URL= ]]; then
    printf 'DATABASE_URL=%s\n' "${DATABASE_URL}" >> "$tmp"; have_db=1; continue
  fi
  if [[ "$line" =~ ^CORS_ORIGINS= ]]; then
    printf '%s\n' "$line" >> "$tmp"; have_cors=1; continue
  fi
  if [[ "$line" =~ ^WEBAUTHN_ORIGIN= ]]; then
    printf '%s\n' "$line" >> "$tmp"; have_webauthn_origin=1; continue
  fi
  if [[ "$line" =~ ^WEBAUTHN_RP_ID= ]]; then
    printf '%s\n' "$line" >> "$tmp"; have_rp_id=1; continue
  fi
  if [[ "$line" =~ ^IDOS_ISSUER_URI= ]]; then
    printf '%s\n' "$line" >> "$tmp"; have_idos=1; continue
  fi

  # Secrets and other values — copy literally (never eval; private keys may contain $).
  if [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
    printf '%s\n' "$line" >> "$tmp"
    continue
  fi

  printf '%s\n' "$line" >> "$tmp"
done < "${ENV_FILE}"

{
  (( have_db )) || printf 'DATABASE_URL=%s\n' "${DATABASE_URL}"
  (( have_cors )) || printf 'CORS_ORIGINS=%s\n' "${DEFAULT_CORS}"
  (( have_rp_id )) || printf 'WEBAUTHN_RP_ID=%s\n' "${DOMAIN}"
  (( have_webauthn_origin )) || printf 'WEBAUTHN_ORIGIN=%s\n' "${DEFAULT_WEBAUTHN}"
  (( have_idos )) || printf 'IDOS_ISSUER_URI=%s\n' "${DEFAULT_IDOS}"
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
