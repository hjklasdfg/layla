#!/usr/bin/env bash
# scripts/gpu1/caddy.sh — start Caddy reverse proxy on gpu1
# Routes:
#   /v1/*       → vllm-active:18000   (Nemotron)
#   /oui/*      → open-webui:8080
#   /mobility/* → host:8000           (layla-routing, optional)
#   /*          → host:3000           (Next.js frontend)
#
# Usage: ./caddy.sh
set -e

CADDYFILE="$(realpath "$(dirname "$0")/Caddyfile")"

docker network create vllm-net 2>/dev/null || true

# Attach open-webui to vllm-net so Caddy can reach it by container name.
# open-webui on gpu1 uses host networking by default; if so we still reach it
# via host.docker.internal:8080. The Caddyfile uses container-name routing
# (open-webui:8080) — re-attach safely if it exists and isn't on host net.
if docker ps --format '{{.Names}}' | grep -q '^open-webui$'; then
  OW_NET=$(docker inspect open-webui --format '{{range $k,$_ := .NetworkSettings.Networks}}{{$k}} {{end}}')
  if echo "$OW_NET" | grep -q host; then
    echo "Note: open-webui is on host network — Caddy /oui/* may need to be re-pointed to host.docker.internal:8080."
  elif ! echo "$OW_NET" | grep -q vllm-net; then
    docker network connect vllm-net open-webui 2>/dev/null || true
  fi
fi

docker rm -f caddy-proxy 2>/dev/null || true

docker run -d \
  --name caddy-proxy \
  --restart unless-stopped \
  --network vllm-net \
  --add-host=host.docker.internal:host-gateway \
  -p 80:80 \
  -p 8081:8081 \
  -p 3002:3002 \
  -v "${CADDYFILE}:/etc/caddy/Caddyfile:ro" \
  caddy:alpine

echo ""
echo "Caddy proxy started."
echo "  vLLM API : http://localhost/v1/"
echo "  OUI      : http://localhost/oui/  (fallback: http://localhost:8081/)"
echo "  Frontend : http://localhost/"
echo ""
echo "Logs: docker logs -f caddy-proxy"
