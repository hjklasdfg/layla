#!/usr/bin/env bash
# scripts/gpu1/cloudflared-docker.sh — run cloudflared as a Docker container (assurance)
# Cloudflare supports running the same tunnel from multiple connectors in parallel
# (HA mode). Pair this with the systemd service for redundancy.
#
# Usage: ./cloudflared-docker.sh
set -e

CONFIG_FILE="$(realpath "$(dirname "$0")/../cloudflare/cloudflared.yml")"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: $CONFIG_FILE not found. Run scripts/cloudflare/setup-named-tunnel.sh first."
  exit 1
fi

CREDS_FILE=$(awk '/^credentials-file:/{print $2}' "$CONFIG_FILE")
if [ -z "$CREDS_FILE" ] || [ ! -f "$CREDS_FILE" ]; then
  echo "Error: credentials file referenced in $CONFIG_FILE not found ($CREDS_FILE)."
  exit 1
fi

CREDS_BASENAME=$(basename "$CREDS_FILE")

# Write a docker-tailored config that references the credentials at the mount path
CONFIG_DIR="$(realpath "$(dirname "$0")/../cloudflare")"
DOCKER_CONFIG="${CONFIG_DIR}/cloudflared-docker.yml"
sed "s|^credentials-file:.*|credentials-file: /etc/cloudflared/${CREDS_BASENAME}|" \
  "$CONFIG_FILE" > "$DOCKER_CONFIG"

docker rm -f cloudflared 2>/dev/null || true

docker run -d \
  --name cloudflared \
  --restart unless-stopped \
  --network host \
  -v "${DOCKER_CONFIG}:/etc/cloudflared/config.yml:ro" \
  -v "${CREDS_FILE}:/etc/cloudflared/${CREDS_BASENAME}:ro" \
  cloudflare/cloudflared:latest \
  tunnel --no-autoupdate --config /etc/cloudflared/config.yml run

sleep 2
echo ""
echo "cloudflared (docker) started. Recent logs:"
docker logs --tail 15 cloudflared
echo ""
echo "Tail logs: docker logs -f cloudflared"
