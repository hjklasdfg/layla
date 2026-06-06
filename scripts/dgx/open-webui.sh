#!/usr/bin/env bash
# open-webui.sh — Open WebUI connected to a running vLLM container on vllm-net
# Usage: ./open-webui.sh [container-name] [vllm-container] [vllm-port] [webui-port]
# Example: ./open-webui.sh open-webui vllm-active 18000 3000
CONTAINER="${1:-open-webui}"
VLLM_CONTAINER="${2:-vllm-active}"
VLLM_PORT="${3:-18000}"
WEBUI_PORT="${4:-3001}"

docker network create vllm-net 2>/dev/null || true
docker rm -f "$CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network vllm-net \
  -p "${WEBUI_PORT}:8080" \
  -v open-webui-data:/app/backend/data \
  -e OPENAI_API_BASE_URLS="http://${VLLM_CONTAINER}:${VLLM_PORT}/v1" \
  -e OPENAI_API_KEY="dummy" \
  -e WEBUI_AUTH=False \
  -e ENABLE_OLLAMA_API=False \
  ghcr.io/open-webui/open-webui:main

echo ""
echo "Open WebUI starting → http://localhost:${WEBUI_PORT}"
echo "Connecting to vLLM at http://${VLLM_CONTAINER}:${VLLM_PORT}/v1"
