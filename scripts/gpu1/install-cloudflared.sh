#!/usr/bin/env bash
# scripts/gpu1/install-cloudflared.sh — install cloudflared apt package on gpu1 (Ubuntu)
# Idempotent. Requires sudo.
set -e

if command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared already installed: $(cloudflared --version)"
  exit 0
fi

sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt-get update
sudo apt-get install -y cloudflared

cloudflared --version
