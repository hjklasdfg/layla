#!/usr/bin/env bash
# cloudflare/cloudflared-tunnel.sh — expose local vLLM via Cloudflare Quick Tunnel
# URL is stable for as long as this process runs; restarts give a new URL.
# Tip: run inside tmux so it survives SSH disconnects.
#
# Usage: ./cloudflared-tunnel.sh [port] [env-file]
#   port      — vLLM port to expose (default: 18000)
#   env-file  — .env to update with VLLM_PUBLIC_URL (default: ../.env)

PORT="${1:-18000}"
ENV_FILE="${2:-$(dirname "$0")/../.env}"
LOG_FILE="/tmp/cloudflared-${PORT}.log"

if ! command -v cloudflared &>/dev/null; then
  echo "Error: cloudflared not found. Install it first:"
  echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

echo "Starting Cloudflare Quick Tunnel → localhost:${PORT}"
echo "Log: ${LOG_FILE}"
echo ""

# Start cloudflared, stream to both log and terminal
cloudflared tunnel --url "http://localhost:${PORT}" 2>&1 | tee "${LOG_FILE}" &
CF_PID=$!

# Wait for the tunnel URL to appear in the log (up to 30s)
echo "Waiting for tunnel URL..."
for i in $(seq 1 30); do
  TUNNEL_URL=$(grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' "${LOG_FILE}" | head -1)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "Error: tunnel URL not found after 30s. Check ${LOG_FILE}"
  kill "$CF_PID" 2>/dev/null
  exit 1
fi

echo ""
echo "========================================="
echo "  Tunnel URL: ${TUNNEL_URL}"
echo "========================================="
echo ""

# Write / update VLLM_PUBLIC_URL in the .env file
if [ -f "$ENV_FILE" ]; then
  if grep -q "^VLLM_PUBLIC_URL=" "$ENV_FILE"; then
    sed -i "s|^VLLM_PUBLIC_URL=.*|VLLM_PUBLIC_URL=${TUNNEL_URL}|" "$ENV_FILE"
    echo "Updated VLLM_PUBLIC_URL in ${ENV_FILE}"
  else
    echo "" >> "$ENV_FILE"
    echo "VLLM_PUBLIC_URL=${TUNNEL_URL}" >> "$ENV_FILE"
    echo "Added VLLM_PUBLIC_URL to ${ENV_FILE}"
  fi
else
  echo "VLLM_PUBLIC_URL=${TUNNEL_URL}" > "$ENV_FILE"
  echo "Created ${ENV_FILE} with VLLM_PUBLIC_URL"
fi

echo ""
echo "Tunnel is live. Press Ctrl+C to stop."
echo ""

# Wait for cloudflared to exit
wait "$CF_PID"
