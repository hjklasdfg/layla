#!/usr/bin/env bash
# cloudflare/caddy.sh — start Caddy reverse proxy in front of vLLM + OUI + frontend
#
# Usage: ./caddy.sh [env-file]
#   env-file — default: ../.env

ENV_FILE="${1:-$(dirname "$0")/../.env}"
CADDYFILE="$(realpath "$(dirname "$0")/Caddyfile")"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  exit 1
fi

docker rm -f caddy-proxy 2>/dev/null || true

docker run -d \
  --name caddy-proxy \
  --restart unless-stopped \
  --network vllm-net \
  --add-host=host.docker.internal:host-gateway \
  -p 80:80 \
  -p 8081:8081 \
  -v "${CADDYFILE}:/etc/caddy/Caddyfile:ro" \
  caddy:alpine

echo ""
echo "Caddy proxy started."
echo "  Intranet:  http://$(hostname -I | awk '{print $1}')/"
echo "  vLLM API:  http://localhost/v1/"
echo "  OUI:       http://localhost/oui/  (fallback: http://localhost:8081/)"
echo "  Frontend:  http://localhost/"
echo ""
echo "  Logs: docker logs -f caddy-proxy"
