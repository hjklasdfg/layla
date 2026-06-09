#!/usr/bin/env bash
# scripts/gpu1/nemotron-nano-omni-30b-nvfp4.sh
# nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 on gpu1
#   - RTX PRO 6000 Blackwell · x86_64 · CUDA 13 · vLLM v0.20.0+
#
# Flags follow the official vLLM recipe:
#   https://docs.vllm.ai/projects/recipes/en/latest/NVIDIA/Nemotron-3-Nano-30B-A3B.html
#   https://huggingface.co/nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4
# RTX PRO is **not FlashInfer-compatible** for NVFP4 MoE → use Marlin backend.
# (The recipe's "triton" recommendation is for the non-NVFP4 variant; NVFP4 MoE
#  only accepts cutlass / flashinfer_* / marlin / emulation.)
#
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
  --name "$CONTAINER" \
  --network vllm-net \
  -v "${HF_CACHE}:/root/.cache/huggingface" \
  -v "${VLLM_COMPILE_CACHE}:/root/.cache/vllm" \
  -p "${PORT}:${PORT}" \
  "$IMAGE" \
    nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 \
    --host 0.0.0.0 \
    --port "$PORT" \
    --tensor-parallel-size 1 \
    --max-model-len 131072 \
    --max-num-seqs 384 \
    --trust-remote-code \
    --kv-cache-dtype fp8 \
    --moe-backend marlin \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --default-chat-template-kwargs "$THINKING_KWARGS" \
    --gpu-memory-utilization 0.55 \
    --limit-mm-per-prompt '{"image": 1, "video": 1}' \
    --video-pruning-rate 0.5 \
    --allowed-local-media-path / \
    --media-io-kwargs '{"video": {"fps": 2, "num_frames": 256}}'

echo ""
echo "Nemotron NVFP4 starting → http://localhost:${PORT}/v1"
echo "Tail logs:  docker logs -f ${CONTAINER}"
echo "Health:     curl -s http://localhost:${PORT}/v1/models | jq ."
