#!/usr/bin/env bash
# scripts/gpu1/nemotron-nano-omni-30b-nvfp4.sh
# nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 on gpu1 (RTX PRO 6000 Blackwell, x86_64)
# ~15 GB weights (NVFP4); MoE 3B active params; multimodal; 128K ctx
# Requires: Blackwell SM_120 + driver R580+ + CUDA 13.x. vLLM Marlin NVFP4 backend.
# Usage: ./nemotron-nano-omni-30b-nvfp4.sh [container] [port] [thinking=0|1]
set -e

CONTAINER="${1:-vllm-active}"
PORT="${2:-18000}"
THINKING="${3:-0}"
IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:latest-cu130-ubuntu2404}"
HF_CACHE="${HF_CACHE:-$HOME/.cache/huggingface}"
VLLM_COMPILE_CACHE="${VLLM_COMPILE_CACHE:-$HOME/.cache/vllm-compile}"

if [ "$THINKING" = "1" ]; then
  THINKING_KWARGS='{"enable_thinking": true}'
else
  THINKING_KWARGS='{"enable_thinking": false}'
fi

mkdir -p "$HF_CACHE" "$VLLM_COMPILE_CACHE"

docker network create vllm-net 2>/dev/null || true
docker rm -f "$CONTAINER" 2>/dev/null || true

docker run -d --gpus all --ipc=host \
  --restart unless-stopped \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,utility \
  -e VLLM_NVFP4_GEMM_BACKEND=marlin \
  -e VLLM_USE_FLASHINFER_MOE_FP4=0 \
  --name "$CONTAINER" \
  --network vllm-net \
  -v "${HF_CACHE}:/root/.cache/huggingface" \
  -v "${VLLM_COMPILE_CACHE}:/root/.cache/vllm" \
  -p "${PORT}:${PORT}" \
  "$IMAGE" \
    nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 \
    --tensor-parallel-size 1 \
    --max-model-len 131072 \
    --max-num-seqs 256 \
    --reasoning-parser deepseek_r1 \
    --chat-template-kwargs "$THINKING_KWARGS" \
    --trust-remote-code \
    --moe-backend marlin \
    --gpu-memory-utilization 0.50 \
    --enable-auto-tool-choice \
    --tool-call-parser hermes \
    --limit-mm-per-prompt '{"image": 1, "video": 1}' \
    --port "$PORT"

echo ""
echo "Nemotron NVFP4 starting → http://localhost:${PORT}/v1"
echo "Tail logs:  docker logs -f ${CONTAINER}"
echo "Health:     curl -s http://localhost:${PORT}/v1/models | jq ."
