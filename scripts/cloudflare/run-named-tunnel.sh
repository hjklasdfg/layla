#!/usr/bin/env bash
# cloudflare/run-named-tunnel.sh — run the named Cloudflare Tunnel (stable URL, no restarts)
# Run setup-named-tunnel.sh once before this.
# Run inside tmux to survive SSH disconnects.
#
# Usage: ./run-named-tunnel.sh [env-file]

ENV_FILE="${1:-$(dirname "$0")/../.env}"
CONFIG_FILE="$(realpath "$(dirname "$0")/cloudflared.yml")"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  exit 1
fi

set -a; source "$ENV_FILE"; set +a
export CLOUDFLARE_API_TOKEN

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: cloudflared.yml not found. Run setup-named-tunnel.sh first."
  exit 1
fi

echo "Starting named tunnel: ${TUNNEL_NAME:-layla-hackathon}"
echo "  Gateway: https://${TUNNEL_HOSTNAME:-layla.ai-cloud.io}"
echo "  Config:  ${CONFIG_FILE}"
echo ""
echo "Tunnel live. Press Ctrl+C to stop."
echo ""

cloudflared tunnel --config "$CONFIG_FILE" run
