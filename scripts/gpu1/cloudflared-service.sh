#!/usr/bin/env bash
# scripts/gpu1/cloudflared-service.sh — install cloudflared as a systemd service on gpu1
# Uses the named tunnel config at scripts/cloudflare/cloudflared.yml.
# Run AFTER:
#   1. install-cloudflared.sh
#   2. ../cloudflare/setup-named-tunnel.sh   (creates tunnel, writes cloudflared.yml)
#
# Usage: ./cloudflared-service.sh
set -e

CONFIG_FILE="$(realpath "$(dirname "$0")/../cloudflare/cloudflared.yml")"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: $CONFIG_FILE not found. Run scripts/cloudflare/setup-named-tunnel.sh first."
  exit 1
fi

# cloudflared expects /etc/cloudflared/config.yml when run as a service.
sudo mkdir -p /etc/cloudflared
sudo cp "$CONFIG_FILE" /etc/cloudflared/config.yml

# Copy credentials file referenced in the yml (~/.cloudflared/<id>.json) into /etc/cloudflared
CREDS_FILE=$(awk '/^credentials-file:/{print $2}' "$CONFIG_FILE")
if [ -n "$CREDS_FILE" ] && [ -f "$CREDS_FILE" ]; then
  sudo cp "$CREDS_FILE" /etc/cloudflared/
  CREDS_BASENAME=$(basename "$CREDS_FILE")
  # rewrite credentials-file path in /etc/cloudflared/config.yml to the service-readable location
  sudo sed -i "s|^credentials-file:.*|credentials-file: /etc/cloudflared/${CREDS_BASENAME}|" /etc/cloudflared/config.yml
else
  echo "Warning: credentials file not found at $CREDS_FILE"
fi

sudo chmod 644 /etc/cloudflared/config.yml
sudo chmod 600 /etc/cloudflared/*.json 2>/dev/null || true

# Install service (idempotent — uninstall first to refresh config)
sudo cloudflared service uninstall 2>/dev/null || true
sudo cloudflared service install

sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared

sleep 2
sudo systemctl --no-pager status cloudflared | head -20
