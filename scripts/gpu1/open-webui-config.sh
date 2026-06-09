#!/usr/bin/env bash
# scripts/gpu1/open-webui-config.sh — point the already-running open-webui on gpu1
# at the new Nemotron vLLM container. Recreates open-webui with the right env.
#
# Usage: ./open-webui-config.sh [vllm-container] [vllm-port] [webui-host-port]
set -e

VLLM_CONTAINER="${1:-vllm-active}"
VLLM_PORT="${2:-18000}"
WEBUI_PORT="${3:-3001}"

docker network create vllm-net 2>/dev/null || true

# Detect existing data volume — keep user history/settings
DATA_VOL="open-webui-data"
docker volume inspect "$DATA_VOL" >/dev/null 2>&1 || docker volume create "$DATA_VOL" >/dev/null

docker rm -f open-webui 2>/dev/null || true

docker run -d \
  --name open-webui \
  --restart unless-stopped \
  --network vllm-net \
  -p "${WEBUI_PORT}:8080" \
  -v "${DATA_VOL}:/app/backend/data" \
  -e OPENAI_API_BASE_URLS="http://${VLLM_CONTAINER}:${VLLM_PORT}/v1" \
  -e OPENAI_API_KEY="dummy" \
  -e WEBUI_AUTH=False \
  -e ENABLE_OLLAMA_API=False \
  ghcr.io/open-webui/open-webui:main

echo ""
echo "Open WebUI re-deployed → http://localhost:${WEBUI_PORT}"
echo "Connecting to vLLM at  → http://${VLLM_CONTAINER}:${VLLM_PORT}/v1"
