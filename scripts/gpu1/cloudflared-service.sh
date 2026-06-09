#!/usr/bin/env bash
# scripts/gpu1/cloudflared-service.sh — enable the cloudflared systemd service on gpu1
#
# Assumes setup-cf-tunnel.sh has already populated /etc/cloudflared/ with
# config.yml + <id>.json. This script just installs / refreshes the systemd
# unit and starts it.
#
# Usage: ./cloudflared-service.sh
set -euo pipefail

if [ ! -f /etc/cloudflared/config.yml ]; then
  echo "ERROR: /etc/cloudflared/config.yml not found. Run ./setup-cf-tunnel.sh first." >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "ERROR: cloudflared not installed. Run ./install-cloudflared.sh." >&2
  exit 1
fi

# Install / refresh service (idempotent — uninstall first so config refreshes)
sudo cloudflared service uninstall 2>/dev/null || true
sudo cloudflared service install

sudo systemctl daemon-reload
sudo systemctl enable cloudflared
sudo systemctl restart cloudflared

sleep 2
sudo systemctl --no-pager status cloudflared | head -15
