#!/usr/bin/env bash
# cloudflare/setup-named-tunnel.sh — ONE-TIME setup for a named Cloudflare Tunnel
# Creates the tunnel, writes config.yml, and routes DNS.
# After this runs, use run-named-tunnel.sh for daily startup.
#
# Usage: ./setup-named-tunnel.sh [tunnel-name] [hostname] [env-file]
#   tunnel-name — default: layla-hackathon
#   hostname    — default: layla.ai-cloud.io
#   env-file    — must contain CLOUDFLARE_API_TOKEN (default: ../.env)

TUNNEL_NAME="${1:-layla-hackathon}"
TUNNEL_HOSTNAME="${2:-layla.ai-cloud.io}"
ENV_FILE="${3:-$(dirname "$0")/../.env}"
SCRIPT_DIR="$(realpath "$(dirname "$0")")"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  exit 1
fi

set -a; source "$ENV_FILE"; set +a

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "Error: CLOUDFLARE_API_TOKEN not set in $ENV_FILE"
  exit 1
fi

export CLOUDFLARE_API_TOKEN

echo "=== Named Tunnel Setup ==="
echo "  Name:     ${TUNNEL_NAME}"
echo "  Hostname: ${TUNNEL_HOSTNAME}"
echo ""

# Create the tunnel (idempotent — fails gracefully if already exists)
echo "Creating tunnel '${TUNNEL_NAME}'..."
cloudflared tunnel create "${TUNNEL_NAME}" 2>&1

# Get tunnel ID
TUNNEL_ID=$(cloudflared tunnel list --output json 2>/dev/null | \
  python3 -c "import json,sys; t=[x for x in json.load(sys.stdin) if x['name']=='${TUNNEL_NAME}']; print(t[0]['id'] if t else '')" 2>/dev/null)

if [ -z "$TUNNEL_ID" ]; then
  echo "Error: could not retrieve tunnel ID for '${TUNNEL_NAME}'"
  exit 1
fi

echo "  Tunnel ID: ${TUNNEL_ID}"
echo ""

# Credentials file written by cloudflared to ~/.cloudflared/<id>.json
CREDS_FILE="${HOME}/.cloudflared/${TUNNEL_ID}.json"

if [ ! -f "$CREDS_FILE" ]; then
  echo "Warning: credentials file not found at ${CREDS_FILE}"
  echo "  cloudflared may have written it elsewhere — check ~/.cloudflared/"
fi

# Write cloudflared config
CONFIG_FILE="${SCRIPT_DIR}/cloudflared.yml"
cat > "$CONFIG_FILE" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS_FILE}

ingress:
  - hostname: ${TUNNEL_HOSTNAME}
    service: http://localhost:80
  - service: http_status:404
EOF

echo "Config written to: ${CONFIG_FILE}"
echo ""

# Route DNS (creates CNAME in Cloudflare DNS)
echo "Routing DNS: ${TUNNEL_HOSTNAME} → ${TUNNEL_NAME}..."
cloudflared tunnel route dns "${TUNNEL_NAME}" "${TUNNEL_HOSTNAME}" 2>&1
echo ""

# Save vars to .env
upsert_env() {
  local key="$1" val="$2" file="$3"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "" >> "$file"
    echo "${key}=${val}" >> "$file"
  fi
}

upsert_env "TUNNEL_NAME"     "$TUNNEL_NAME"     "$ENV_FILE"
upsert_env "TUNNEL_HOSTNAME" "$TUNNEL_HOSTNAME" "$ENV_FILE"
upsert_env "GATEWAY_URL"     "https://${TUNNEL_HOSTNAME}" "$ENV_FILE"

echo "=== Setup complete ==="
echo ""
echo "  Gateway URL: https://${TUNNEL_HOSTNAME}"
echo ""
echo "Next steps:"
echo "  1. Start Caddy:          ./cloudflare/caddy.sh"
echo "  2. Start tunnel (tmux):  ./cloudflare/run-named-tunnel.sh"
echo "  3. Update frontend:      NEMOTRON_BASE_URL=https://${TUNNEL_HOSTNAME}"
