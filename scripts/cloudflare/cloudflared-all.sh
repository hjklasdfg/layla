#!/usr/bin/env bash
# cloudflare/cloudflared-all.sh — single Cloudflare Quick Tunnel → Caddy → all services
# Caddy must be running first (./cloudflare/caddy.sh).
# Run inside tmux to survive SSH disconnects.
#
# Usage: ./cloudflared-all.sh [caddy-port] [env-file]
#   caddy-port — port Caddy listens on (default: 80)
#   env-file   — written with GATEWAY_URL (default: ../.env)

CADDY_PORT="${1:-80}"
ENV_FILE="${2:-$(dirname "$0")/../.env}"
LOG_FILE="/tmp/cloudflared-${CADDY_PORT}.log"

if ! command -v cloudflared &>/dev/null; then
  echo "Error: cloudflared not found."
  exit 1
fi

upsert_env() {
  local key="$1" val="$2" file="$3"
  if [ -f "$file" ]; then
    if grep -q "^${key}=" "$file"; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$file"
    else
      echo "" >> "$file"
      echo "${key}=${val}" >> "$file"
    fi
  else
    echo "${key}=${val}" > "$file"
  fi
}

echo "Starting Cloudflare Quick Tunnel → localhost:${CADDY_PORT} (Caddy proxy)"
echo ""

cloudflared tunnel --url "http://localhost:${CADDY_PORT}" 2>&1 | tee "$LOG_FILE" >/dev/null &
CF_PID=$!

echo -n "Waiting for tunnel URL..."
for i in $(seq 1 30); do
  GATEWAY_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_FILE" | head -1)
  [ -n "$GATEWAY_URL" ] && break
  sleep 1
done
echo " done"

if [ -z "$GATEWAY_URL" ]; then
  echo "Error: tunnel URL not found after 30s. Check $LOG_FILE"
  kill "$CF_PID" 2>/dev/null
  exit 1
fi

upsert_env "GATEWAY_URL" "$GATEWAY_URL" "$ENV_FILE"

echo ""
echo "========================================="
echo "  Gateway  : ${GATEWAY_URL}"
echo "  vLLM API : ${GATEWAY_URL}/v1/"
echo "  OUI      : ${GATEWAY_URL}/oui/"
echo "  Frontend : ${GATEWAY_URL}/"
echo "  .env     : ${ENV_FILE}"
echo "========================================="
echo ""
echo "Update frontend/.env.local:"
echo "  NEMOTRON_BASE_URL=${GATEWAY_URL}"
echo ""
echo "Tunnel live. Press Ctrl+C to stop."
echo ""

wait "$CF_PID"
