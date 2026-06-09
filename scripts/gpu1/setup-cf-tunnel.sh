#!/usr/bin/env bash
# scripts/gpu1/setup-cf-tunnel.sh — bootstrap a named Cloudflare Tunnel on gpu1
# using ONLY the API token (no browser-based `cloudflared tunnel login`).
#
# What it does (idempotent):
#   1. Reads CLOUDFLARE_API_TOKEN from ../.env
#   2. Verifies token, looks up account_id + zone_id for ai-cloud.io
#   3. Deletes any existing tunnel named "$TUNNEL_NAME" (orphaned from hp-07)
#   4. Creates a new tunnel via REST, generates the 32-byte secret locally
#   5. Writes ~/.cloudflared/<id>.json (credentials)
#   6. Copies credentials + writes /etc/cloudflared/{config.yml,<id>.json} for systemd
#   7. Patches the homelabs docker-compose config.yml with the new tunnel id
#   8. Creates/updates the CNAME record layla.ai-cloud.io → <id>.cfargotunnel.com
#
# Usage: ./setup-cf-tunnel.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${SCRIPT_DIR}/../.env}"
TUNNEL_NAME="${TUNNEL_NAME:-layla-hackathon}"
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-layla.ai-cloud.io}"
ZONE_NAME="${ZONE_NAME:-ai-cloud.io}"
HOMELABS_CF_DIR="${HOMELABS_CF_DIR:-/home/charles/_charles/_github/charles-cai/homelabs/ubuntu/gpu1/cloudflared}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2; exit 1
fi
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: CLOUDFLARE_API_TOKEN is empty in $ENV_FILE" >&2; exit 1
fi

api() {
  curl -fsS \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

echo "==> Verifying API token…"
api https://api.cloudflare.com/client/v4/user/tokens/verify >/dev/null

ACCOUNT_ID=$(api https://api.cloudflare.com/client/v4/accounts | jq -r '.result[0].id')
if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "null" ]; then
  echo "ERROR: could not read account id" >&2; exit 1
fi
echo "    account: $ACCOUNT_ID"

ZONE_ID=$(api "https://api.cloudflare.com/client/v4/zones?name=${ZONE_NAME}" | jq -r '.result[0].id')
if [ -z "$ZONE_ID" ] || [ "$ZONE_ID" = "null" ]; then
  echo "ERROR: zone '$ZONE_NAME' not found under this account" >&2; exit 1
fi
echo "    zone:    $ZONE_ID ($ZONE_NAME)"

echo "==> Deleting existing tunnels named '$TUNNEL_NAME' (if any)…"
EXISTING_IDS=$(api "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false" \
  | jq -r '.result[] | .id')
for id in $EXISTING_IDS; do
  echo "    delete $id"
  # Cleanup connections first (otherwise delete is rejected for active tunnels)
  api -X DELETE \
    "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${id}/connections" >/dev/null || true
  api -X DELETE \
    "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel/${id}" >/dev/null || true
done

echo "==> Creating tunnel '$TUNNEL_NAME'…"
TUNNEL_SECRET_RAW=$(head -c 32 /dev/urandom | base64 -w0)
RESP=$(api -X POST \
  "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/cfd_tunnel" \
  -d "$(jq -nc --arg n "$TUNNEL_NAME" --arg s "$TUNNEL_SECRET_RAW" \
        '{name:$n, tunnel_secret:$s, config_src:"local"}')")
TUNNEL_ID=$(echo "$RESP" | jq -r '.result.id')
if [ -z "$TUNNEL_ID" ] || [ "$TUNNEL_ID" = "null" ]; then
  echo "ERROR: tunnel create failed:"; echo "$RESP" | jq .; exit 1
fi
echo "    tunnel:  $TUNNEL_ID"

# --- Credentials JSON (what cloudflared expects on disk) ---------------------
CREDS_HOME="$HOME/.cloudflared/${TUNNEL_ID}.json"
mkdir -p "$HOME/.cloudflared"
jq -nc --arg a "$ACCOUNT_ID" --arg t "$TUNNEL_ID" --arg s "$TUNNEL_SECRET_RAW" \
  '{AccountTag:$a, TunnelID:$t, TunnelSecret:$s}' > "$CREDS_HOME"
chmod 600 "$CREDS_HOME"
echo "==> Credentials → $CREDS_HOME"

# --- systemd: /etc/cloudflared/{config.yml,<id>.json} ------------------------
echo "==> Writing /etc/cloudflared/ for systemd…"
sudo mkdir -p /etc/cloudflared
sudo cp "$CREDS_HOME" "/etc/cloudflared/${TUNNEL_ID}.json"
sudo chmod 600 "/etc/cloudflared/${TUNNEL_ID}.json"
sudo tee /etc/cloudflared/config.yml >/dev/null <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: /etc/cloudflared/${TUNNEL_ID}.json

ingress:
  - hostname: ${TUNNEL_HOSTNAME}
    service: http://localhost:80
  - hostname: layla-oui.ai-cloud.io
    service: http://localhost:8081
  - hostname: layla-dev.ai-cloud.io
    service: http://localhost:3002
  - hostname: "*.${ZONE_NAME}"
    service: http://localhost:80
  - service: http_status:404
EOF

# --- docker-compose: patch ${HOMELABS_CF_DIR}/config.yml ---------------------
if [ -f "${HOMELABS_CF_DIR}/config.yml" ]; then
  echo "==> Patching ${HOMELABS_CF_DIR}/config.yml…"
  sudo cp -f /etc/cloudflared/config.yml "${HOMELABS_CF_DIR}/config.yml"
  sudo sed -i "s|/etc/cloudflared/${TUNNEL_ID}.json|/etc/cloudflared/.creds/${TUNNEL_ID}.json|" "${HOMELABS_CF_DIR}/config.yml"
  sudo chown "$(id -u):$(id -g)" "${HOMELABS_CF_DIR}/config.yml"
fi

# --- DNS record (CNAME via REST — `cf` CLI optional) -------------------------
echo "==> Setting CNAME ${TUNNEL_HOSTNAME} → ${TUNNEL_ID}.cfargotunnel.com…"
CONTENT="${TUNNEL_ID}.cfargotunnel.com"
EXISTING=$(api "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=CNAME&name=${TUNNEL_HOSTNAME}" \
  | jq -r '.result[0].id // empty')
PAYLOAD=$(jq -nc --arg n "$TUNNEL_HOSTNAME" --arg c "$CONTENT" \
  '{type:"CNAME", name:$n, content:$c, proxied:true, ttl:1}')
if [ -n "$EXISTING" ]; then
  api -X PUT "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${EXISTING}" -d "$PAYLOAD" \
    | jq '{success, name: .result.name, content: .result.content}'
else
  api -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" -d "$PAYLOAD" \
    | jq '{success, name: .result.name, content: .result.content}'
fi

# --- Persist key vars back to .env (idempotent upsert) -----------------------
upsert() {
  local k="$1" v="$2" f="$3"
  if grep -qE "^${k}=" "$f"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$f"
  else
    printf '\n%s=%s\n' "$k" "$v" >> "$f"
  fi
}
upsert TUNNEL_ID       "$TUNNEL_ID"       "$ENV_FILE"
upsert TUNNEL_NAME     "$TUNNEL_NAME"     "$ENV_FILE"
upsert TUNNEL_HOSTNAME "$TUNNEL_HOSTNAME" "$ENV_FILE"
upsert GATEWAY_URL     "https://${TUNNEL_HOSTNAME}" "$ENV_FILE"

echo ""
echo "✓ Tunnel bootstrap complete."
echo "  TUNNEL_ID : $TUNNEL_ID"
echo "  Hostname  : https://${TUNNEL_HOSTNAME}"
echo ""
echo "Next:"
echo "  ./cloudflared-service.sh                              # start systemd connector"
echo "  cd $HOMELABS_CF_DIR && docker compose up -d           # start docker connector"
