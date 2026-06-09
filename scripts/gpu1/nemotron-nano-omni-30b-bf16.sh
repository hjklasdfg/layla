#!/usr/bin/env bash
# scripts/gpu1/nemotron-nano-omni-30b-bf16.sh
# nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16 on gpu1 (~60 GB weights).
# Reference quality (no quantization). RTX PRO 6000 (97 GB) fits it comfortably.
#
# Flags adapted from the official Nemotron-3-Nano recipe + BF16 model card:
#   https://docs.vllm.ai/projects/recipes/en/latest/NVIDIA/Nemotron-3-Nano-30B-A3B.html
#
# Usage: ./nemotron-nano-omni-30b-bf16.sh [container] [port] [thinking=0|1]
set -e

CONTAINER="${1:-vllm-nemotron-bf16}"
PORT="${2:-18002}"
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
  --name "$CONTAINER" \
  --network vllm-net \
  -v "${HF_CACHE}:/root/.cache/huggingface" \
  -v "${VLLM_COMPILE_CACHE}:/root/.cache/vllm" \
  -p "${PORT}:${PORT}" \
  "$IMAGE" \
    nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-BF16 \
    --host 0.0.0.0 \
    --port "$PORT" \
    --tensor-parallel-size 1 \
    --dtype bfloat16 \
    --max-model-len 131072 \
    --max-num-seqs 128 \
    --trust-remote-code \
    --kv-cache-dtype auto \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --default-chat-template-kwargs "$THINKING_KWARGS" \
    --gpu-memory-utilization 0.85 \
    --limit-mm-per-prompt '{"image": 1, "video": 1}' \
    --video-pruning-rate 0.5 \
    --allowed-local-media-path / \
    --media-io-kwargs '{"video": {"fps": 2, "num_frames": 256}}'

echo ""
echo "Nemotron BF16 starting → http://localhost:${PORT}/v1"
echo "Note: BF16 loads ~60 GB of weights from HF. First run will be slow."
echo "Tail logs:  docker logs -f ${CONTAINER}"
