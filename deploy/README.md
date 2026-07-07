# Mac Mini deployment (Apple Silicon)

Production runbook for the iMali / 1Remit stack: Postgres, four Node apps, Caddy reverse proxy, and a named Cloudflare tunnel with WebAuthn origins wired for the tunnel hostnames.

## Architecture

```
Internet → Cloudflare (TLS) → cloudflared tunnel → Caddy :8080
                                                      ├─ app.DOMAIN      → consumer/dist + /api → Express :3001
                                                      ├─ admin.DOMAIN    → admin/dist    + /api,/idos
                                                      ├─ merchant.DOMAIN → merchant/dist + /api
                                                      └─ api.DOMAIN      → Express :3001
Postgres :5432 ← Express (DATABASE_URL)
```

| Hostname | App | WebAuthn |
|----------|-----|----------|
| `app.DOMAIN` | Consumer UI | Yes (passkey login) |
| `merchant.DOMAIN` | Merchant UI | Yes (member login) |
| `admin.DOMAIN` | Admin UI | No (wallet connect) |
| `api.DOMAIN` | API + `/idos` | — |

Replace `DOMAIN` with your registrable domain (default `imali.app`).

## Prerequisites

On the Mac Mini (M1/M2/M3):

```bash
# Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node 20 (matches .tool-versions)
brew install node@20
echo 'export PATH="/opt/homebrew/opt/node@20/bin:$PATH"' >> ~/.zshrc
```

## Quick start

```bash
git clone <repo> ~/eth
cd ~/eth

# Creates deploy/env from example on first run — edit secrets, then re-run
./deploy/setup.sh
```

`setup.sh` installs Homebrew packages (`postgresql@16`, `caddy`, `cloudflared`, `node@20`, `pm2`), creates the Postgres role/database, links `server/.env`, runs migrations, and builds all apps.

## Manual steps

### 1. Configure environment

```bash
cp deploy/env.example deploy/env
# Edit deploy/env — set PG_PASSWORD, JWT_SECRET, RPC URLs, Pimlico, Safe addresses, etc.
```

Key production values (auto-expanded into `server/.env` by `deploy/link-env.sh`):

| Variable | Example | Notes |
|----------|---------|-------|
| `DOMAIN` | `imali.app` | Registrable domain; also `WEBAUTHN_RP_ID` |
| `WEBAUTHN_ORIGIN` | `https://app.imali.app,https://merchant.imali.app` | Exact origins (scheme + host) |
| `CORS_ORIGINS` | `https://app.imali.app,https://admin.imali.app,https://merchant.imali.app` | All frontends that call the API |
| `IDOS_ISSUER_URI` | `https://api.imali.app/idos` | idOS discovery endpoint |

### 2. Postgres

```bash
./deploy/postgres-setup.sh   # create role + database
./deploy/migrate-db.sh       # apply db/001…035 migrations
```

### 3. Build

```bash
./deploy/build-all.sh
```

Admin build needs wallet-connect env vars exported (set in `deploy/env`):

```bash
export VITE_ALCHEMY_API_KEY=...
export VITE_WALLETCONNECT_PROJECT_ID=...
```

### 4. Named Cloudflare tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create imali-mac-mini

# Copy credentials into the repo (gitignored)
cp ~/.cloudflared/<tunnel-uuid>.json deploy/cloudflared-credentials.json

# DNS CNAMEs: app, admin, merchant, api → tunnel
./deploy/cloudflared-route-dns.sh
```

Tunnel config: `deploy/cloudflared-config.yml` (ingress → Caddy on `127.0.0.1:8080`).

### 5. Start services

**Interactive (for testing):**

```bash
./deploy/link-env.sh
pm2 start deploy/ecosystem.config.cjs

DOMAIN=imali.app IMALI_ROOT=$PWD CADDY_PORT=8080 \
  caddy run --config deploy/Caddyfile

cloudflared tunnel --config deploy/cloudflared-config.yml run
```

**launchd (survives reboot):**

```bash
./deploy/install-launchd.sh
launchctl load ~/Library/LaunchAgents/app.imali.server.plist
launchctl load ~/Library/LaunchAgents/app.imali.caddy.plist
launchctl load ~/Library/LaunchAgents/app.imali.cloudflared.plist
```

Logs: `deploy/logs/`

### 6. Verify

```bash
curl -s https://api.imali.app/health | jq
# → { "status": "ok", "db": "connected", "env": "production" }
```

Open `https://app.imali.app` and register a passkey — the ceremony must use an origin listed in `WEBAUTHN_ORIGIN`.

## Scripts reference

| Script | Purpose |
|--------|---------|
| `deploy/setup.sh` | Full bootstrap |
| `deploy/postgres-setup.sh` | Create Postgres role + DB |
| `deploy/migrate-db.sh` | Run SQL migrations |
| `deploy/build-all.sh` | `npm install` + build all four apps |
| `deploy/link-env.sh` | `deploy/env` → `server/.env` |
| `deploy/cloudflared-route-dns.sh` | Register tunnel DNS routes |
| `deploy/install-launchd.sh` | Install macOS launch agents |

## Updating

```bash
git pull
./deploy/build-all.sh
./deploy/migrate-db.sh    # if new SQL files
pm2 restart imali-server
# Caddy/cloudflared pick up static file changes automatically
```

## Troubleshooting

**WebAuthn origin mismatch** — `WEBAUTHN_ORIGIN` must match the browser URL exactly (`https://app.imali.app`, not trailing slash). `WEBAUTHN_RP_ID` must be the registrable domain (`imali.app`).

**CORS errors** — add the frontend origin to `CORS_ORIGINS` in `deploy/env`, then `./deploy/link-env.sh && pm2 restart imali-server`.

**Passkey challenges lost on restart** — challenges are in-memory; single-instance only. Do not run multiple server replicas without adding Redis.

**Caddy path** — launchd templates assume Homebrew at `/opt/homebrew/bin`. Intel Macs may need `/usr/local/bin`.
