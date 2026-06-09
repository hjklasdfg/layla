#!/usr/bin/env bash
# scripts/gpu1/camera-hazard.sh — build + run the YOLO11n hazard service on gpu1.
# CPU device by default to avoid contending with vLLM for VRAM (YOLO11n is fast on CPU).
#
# Usage: ./camera-hazard.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SVC_DIR="$(realpath "${SCRIPT_DIR}/../../backend/camera-hazard")"
IMAGE="${IMAGE:-camera-hazard:latest}"
CONTAINER="${CONTAINER:-camera-hazard}"
PORT="${PORT:-8001}"
YOLO_DEVICE="${YOLO_DEVICE:-cpu}"

[ -d "$SVC_DIR" ] || { echo "ERROR: $SVC_DIR not found" >&2; exit 1; }

echo "==> Building $IMAGE (this pulls torch + ultralytics; first build ~5 min)"
docker build -t "$IMAGE" "$SVC_DIR"

docker network create vllm-net 2>/dev/null || true
docker rm -f "$CONTAINER" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  --network vllm-net \
  -p "${PORT}:8001" \
  -e PORT=8001 \
  -e YOLO_DEVICE="$YOLO_DEVICE" \
  -e YOLO_MODEL="${YOLO_MODEL:-yolo11n.pt}" \
  -e CAMERA_HAZARD_DEMO="${CAMERA_HAZARD_DEMO:-0}" \
  "$IMAGE"

sleep 3
docker ps --filter "name=^${CONTAINER}$" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo ""
echo "Health:  curl -s http://localhost:${PORT}/health"
echo "Logs:    docker logs -f ${CONTAINER}"
