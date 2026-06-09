# gpu1 — Deployment Scripts

Adapted from `scripts/dgx/` for **gpu1** (Ubuntu 24.04 · x86_64 · RTX PRO 6000 Blackwell · 97 GB VRAM).

The DGX Spark scripts use the ARM64 vLLM image (`v0.20.0-aarch64-cu130`). gpu1 uses the
amd64 image (`vllm/vllm-openai:latest-cu130-ubuntu2404`). Caches live in `$HOME/.cache/...`
on gpu1 (user `charles`) instead of `/home/nvidia/.cache/...`.

## Scripts

| Script | Purpose |
|---|---|
| `nemotron-nano-omni-30b-nvfp4.sh` | Launch Nemotron NVFP4 (~15 GB) on `vllm-active:18000`. Default. |
| `nemotron-nano-omni-30b-bf16.sh`  | Launch BF16 reference (~60 GB) on `vllm-nemotron-bf16:18002`. Test only. |
| `open-webui-config.sh`            | Re-create `open-webui` on `vllm-net` pointing at our Nemotron container. |
| `Caddyfile` / `caddy.sh`          | Reverse proxy — `/v1` → vLLM, `/oui` → OUI, `/mobility` → backend, `/` → frontend. |
| `install-cloudflared.sh`          | Install `cloudflared` apt package (one-time, sudo). |
| `cloudflared-service.sh`          | Run `cloudflared` as a **systemd service** (primary). |
| `cloudflared-docker.sh`           | Run `cloudflared` as a **Docker container** (assurance — HA second connector). |
| `run-frontend.sh`                 | Start Next.js frontend (`bun dev`) in a tmux session on `0.0.0.0:3000`. |

## Daily startup (after one-time setup)

```bash
# 1. vLLM (Nemotron NVFP4)
./nemotron-nano-omni-30b-nvfp4.sh

# 2. Re-hook open-webui (only if you changed the vLLM container name)
./open-webui-config.sh

# 3. Caddy
./caddy.sh

# 4. Frontend
./run-frontend.sh

# 5. Tunnel — both connectors come up automatically (systemd + docker --restart)
sudo systemctl status cloudflared
docker ps --filter name=cloudflared
```

## One-time setup

```bash
./install-cloudflared.sh

# Login via the Cloudflare dashboard in a browser (writes ~/.cloudflared/cert.pem)
cloudflared tunnel login

# Re-create the named tunnel + DNS for gpu1 (idempotent; will reuse the old tunnel ID
# if it still exists in your Cloudflare account)
cd ../cloudflare
./setup-named-tunnel.sh layla-hackathon layla.ai-cloud.io

# Bring up both connectors
cd ../gpu1
./cloudflared-service.sh
./cloudflared-docker.sh
```

## Hardware notes

- **NVFP4 + Marlin backend** works on Blackwell SM_120. `VLLM_NVFP4_GEMM_BACKEND=marlin`.
- `--gpu-memory-utilization` is set conservatively (0.50 for NVFP4, 0.85 for BF16) so the
  GPU can also host short-lived auxiliary models (e.g. Qwen-VL, YOLO via ultralytics).
- `nvidia-smi` should show ~15 GB used after Nemotron NVFP4 boots; ~60 GB for BF16.

## Public URL

`https://layla.ai-cloud.io` — same hostname as the DGX deployment, just re-pointed at
gpu1's tunnel ID.
