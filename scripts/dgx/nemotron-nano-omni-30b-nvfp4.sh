#!/usr/bin/env bash
# models/nemotron-nano-omni-30b-nvfp4.sh — nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4
# ~15 GB weights (NVFP4); MoE 3B active params; multimodal (image/audio/video); 128K ctx
# DGX Spark (GB10 / sm_121, ARM64, 128 GB unified): use aarch64-cu130 image + Marlin NVFP4 backend
# Requires vLLM >= v0.20.0-aarch64-cu130; driver R580 (580.95.05+); CUDA 13.0
# Usage: ./nemotron-nano-omni-30b-nvfp4.sh [container] [port] [thinking=0|1]
CONTAINER="${1:-vllm-active}"
PORT="${2:-18000}"
THINKING="${3:-0}"

if [ "$THINKING" = "1" ]; then
  THINKING_KWARGS='{"enable_thinking": true}'
else
  THINKING_KWARGS='{"enable_thinking": false}'
fi

docker network create vllm-net 2>/dev/null || true
docker rm -f "$CONTAINER" 2>/dev/null || true

docker run -d --gpus all --ipc=host \
  --restart unless-stopped \
  -e NVIDIA_DRIVER_CAPABILITIES=compute,utility \
  -e VLLM_NVFP4_GEMM_BACKEND=marlin \
  -e VLLM_USE_FLASHINFER_MOE_FP4=0 \
  --name "$CONTAINER" \
  --network vllm-net \
  -v /home/nvidia/.cache/huggingface:/root/.cache/huggingface \
  -v /home/nvidia/.cache/vllm-compile:/root/.cache/vllm \
  -p "${PORT}:${PORT}" \
  vllm/vllm-openai:v0.20.0-aarch64-cu130-ubuntu2404 \
    nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4 \
    --tensor-parallel-size 1 \
    --max-model-len 131072 \
    --max-num-seqs 256 \
    --reasoning-parser deepseek_r1 \
    --chat-template-kwargs "$THINKING_KWARGS" \
    --trust-remote-code \
    --moe-backend marlin \
    --gpu-memory-utilization 0.40 \
    --enable-auto-tool-choice \
    --tool-call-parser hermes \
    --limit-mm-per-prompt '{"image": 1, "video": 1}' \
    --port "$PORT"
