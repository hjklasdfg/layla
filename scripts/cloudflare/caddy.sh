#!/usr/bin/env bash
# cloudflare/caddy.sh — start Caddy reverse proxy in front of vLLM + OUI + frontend
# Reads CADDY_USER and CADDY_HASHED_PASSWORD from env-file.
#
# Usage: ./caddy.sh [env-file]
#   env-file — default: ../.env
#
# One-time password setup:
#   HASH=$(docker run --rm caddy:alpine caddy hash-password --plaintext 'yourpassword')
#   echo "CADDY_USER=layla"                   >> scripts/.env
#   echo "CADDY_HASHED_PASSWORD=${HASH}"      >> scripts/.env

ENV_FILE="${1:-$(dirname "$0")/../.env}"
CADDYFILE="$(realpath "$(dirname "$0")/Caddyfile")"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: env file not found: $ENV_FILE"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [ -z "$CADDY_USER" ] || [ -z "$CADDY_HASHED_PASSWORD" ]; then
  echo "Error: CADDY_USER and CADDY_HASHED_PASSWORD must be set in $ENV_FILE"
  echo ""
  echo "  Generate a hash:"
  echo "    docker run --rm caddy:alpine caddy hash-password --plaintext 'yourpassword'"
  echo ""
  echo "  Then add to $ENV_FILE:"
  echo "    CADDY_USER=layla"
  echo "    CADDY_HASHED_PASSWORD=<hash>"
  exit 1
fi

docker rm -f caddy-proxy 2>/dev/null || true

docker run -d \
  --name caddy-proxy \
  --network vllm-net \
  --add-host=host.docker.internal:host-gateway \
  -p 80:80 \
  -p 8081:8081 \
  -v "${CADDYFILE}:/etc/caddy/Caddyfile:ro" \
  -e CADDY_USER="$CADDY_USER" \
  -e CADDY_HASHED_PASSWORD="$CADDY_HASHED_PASSWORD" \
  caddy:alpine

echo ""
echo "Caddy proxy started."
echo "  Intranet:  http://$(hostname -I | awk '{print $1}')/"
echo "  vLLM API:  http://localhost/v1/"
echo "  OUI:       http://localhost/oui/  (fallback: http://localhost:8081/)"
echo "  Frontend:  http://localhost/"
echo ""
echo "  Logs: docker logs -f caddy-proxy"
