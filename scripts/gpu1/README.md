# gpu1 — Layla Deployment Scripts

Adapted from `scripts/dgx/` for **gpu1** (Ubuntu 24.04 · x86_64 · RTX PRO 6000
Blackwell · 97 GB VRAM · driver R610 / CUDA 13.3).

The migration from DGX Spark (aarch64) to gpu1 (x86_64) was **not a drop-in
port**. Four distinct issues in vLLM v0.20.0 had to be sorted out — recording
them here so the next person doesn't lose half a day to the same things.

---

## TL;DR — daily startup

```bash
cd ~/_charles/_github/hjklasdfg/layla/scripts/gpu1

./nemotron-nano-omni-30b-nvfp4.sh   # 1. vLLM (Nemotron NVFP4, ~3 min cold start)
./caddy.sh                          # 2. Reverse proxy on :80, :8081, :3002
./run-frontend.sh                   # 3. Next.js (tmux session "frontend")
sudo systemctl status cloudflared   # 4. Tunnel — systemd
docker ps --filter name=cloudflared # 5. Tunnel — Docker (HA second connector)

curl -s http://localhost/v1/models | jq .id     # vLLM via Caddy
curl -s https://layla.ai-cloud.io/v1/models     # public
```

All containers have `--restart unless-stopped`, so a gpu1 reboot brings the
stack back automatically.

---

## Scripts

| Script | Purpose |
|---|---|
| `nemotron-nano-omni-30b-nvfp4.sh` | Launch Nemotron NVFP4 (~21 GB weights, ~29 GB total VRAM) on `vllm-active:18000`. **Default.** |
| `nemotron-nano-omni-30b-bf16.sh`  | Launch BF16 reference (~60 GB) on `vllm-nemotron-bf16:18002`. For quality comparisons. |
| `open-webui-config.sh`            | Re-deploy `open-webui` on `vllm-net` pointing at our Nemotron container. |
| `Caddyfile` / `caddy.sh`          | Reverse proxy — `/v1` → vLLM, `/oui` → OUI, `/mobility` → backend, `/` → frontend. |
| `run-frontend.sh`                 | Start Next.js (`bun dev`) in a tmux session, listening on `0.0.0.0:3000`. |

**Cloudflare Tunnel** infrastructure lives **outside this repo** at
`/home/charles/_charles/_github/charles-cai/homelabs/ubuntu/gpu1/cloudflared/`
on gpu1 (separate `charles-cai/homelabs` git repo). Both connectors —
systemd service + Docker compose — are managed there. See its `README.md`.

---

## Migration findings — DGX Spark → gpu1

Background: the original deployment ran on a DGX Spark (GB10 Grace Blackwell,
ARM64, 128 GB unified memory) with `vllm/vllm-openai:v0.20.0-aarch64-cu130-ubuntu2404`.
Moving to gpu1 (RTX PRO 6000 Blackwell, x86_64) required these fixes.

### Pre-existing state on gpu1

Two **dead Qwen vLLM containers** were stuck in restart loops:

| Container | RestartCount | Root cause |
|---|---|---|
| `vllm-active` (Qwen3.6-35B-A3B-FP8) | **1762** | Engine core init failed every boot |
| `vllm-35b` (Qwen3.6-35B-A3B-FP8)    | **1153** | `unrecognized arguments: Qwen/...` (old CLI) |

The host showed "memory goes up, flatlines, then up again" — that's the docker
`--restart unless-stopped` policy cycling shard-load → fail → restart. Removed
with `docker rm -f`. VRAM dropped from 38 GB to ~640 MiB.

### Issue 1 — `vllm` CLI requires a subcommand and renamed a flag

The image's entrypoint is `["vllm","serve"]` — args after the image name must
NOT include `serve` themselves (that part works). What broke is:

```diff
- --chat-template-kwargs '{"enable_thinking": false}'
+ --default-chat-template-kwargs '{"enable_thinking": false}'
```

`--chat-template-kwargs` was renamed in current `latest-cu130-ubuntu2404`
(despite both images self-reporting `version 0.20.0`). Symptom:

```
vllm: error: unrecognized arguments: --chat-template-kwargs ...
```

### Issue 2 — `--moe-backend triton` is **not valid for NVFP4**

The official vLLM recipe[¹] tells you to use `--moe-backend triton` on RTX Pro
"due to FlashInfer compatibility issues". That advice is for the **non-NVFP4**
Nemotron variant. For NVFP4 the engine errors out:

```
ValueError: moe_backend='triton' is not supported for NvFP4 MoE.
Expected one of ['cutlass', 'flashinfer_trtllm', 'flashinfer_cutlass',
'flashinfer_cutedsl', 'marlin', 'emulation'].
```

On RTX PRO 6000 Blackwell, FlashInfer kernels also fail at dispatch time, so
the supported backend is **`marlin`**. Cleanly accepted, ~10 it/s on CUDA
graph capture.

```
--moe-backend marlin
```

### Issue 3 — `--reasoning-parser nemotron_v3` swallows `.content`

When `enable_thinking=false`, the model emits no `<think>...</think>` blocks,
but the parser still routes the output into `.message.reasoning` and leaves
`.message.content = null`. Any OpenAI-spec client (including the Layla
frontend's `fetch /v1/chat/completions`) breaks.

We dropped `--reasoning-parser` entirely so output goes to `.content` as
plain text. If we ever want chain-of-thought displayed in the UI, we'd add the
parser back AND enable thinking AND patch the frontend to read both fields.

### Issue 4 — `vllm-openai:latest-cu130-ubuntu2404` resolves to v0.20.0 on amd64

The DGX image was pinned to `v0.20.0-aarch64-cu130-ubuntu2404`. The amd64 tag
`latest-cu130-ubuntu2404` currently resolves to v0.20.0 too — but with flag
renames (issue 1) and slightly different MoE backend selection logic (issue 2).
Pin explicitly if you need reproducibility:

```bash
VLLM_IMAGE=vllm/vllm-openai:v0.20.0-cu130-ubuntu2404 ./nemotron-nano-omni-30b-nvfp4.sh
```

[¹]: <https://docs.vllm.ai/projects/recipes/en/latest/NVIDIA/Nemotron-3-Nano-30B-A3B.html>

---

## Hardware notes

- **GPU**: NVIDIA RTX PRO 6000 Blackwell · 97 GB GDDR7 · SM_120
- **NVFP4** weights load in ~4 s from a fast NVMe; CUDA graph capture takes ~10 s
- **Total cold start** to "Application startup complete": ~3 minutes (first time)
- **Warm restart** (compile cache in `~/.cache/vllm-compile`): ~50 s
- **VRAM at idle**:
  - NVFP4 + 131k ctx + `--gpu-memory-utilization 0.55`: ~29 GB
  - BF16  + 131k ctx + `--gpu-memory-utilization 0.85`: ~75 GB (be careful, KV cache scales with ctx)

For BF16 at full 131k context the KV cache balloons; consider dropping to
`--max-model-len 32768` (or 65536) if you only need short-context evaluation.

## Public URL

`https://layla.ai-cloud.io` — same hostname as the DGX deployment, re-pointed
to gpu1's tunnel. The HP-07 (DGX) credentials JSON was lost when that host went
away, so the tunnel was deleted from Cloudflare and recreated with the same
hostname.

## Auto-restart on reboot

All Docker containers in this stack have `--restart unless-stopped`:

- `vllm-active`        (Nemotron)
- `open-webui`         (if re-deployed via `open-webui-config.sh`)
- `caddy-proxy`        (reverse proxy)
- `cloudflared`        (Docker connector — HA)

The Docker daemon auto-starts on boot on Ubuntu, so a `sudo reboot` brings the
whole stack back without intervention. The cloudflared systemd service
(`cloudflared-service.sh`) is also `enable`d so it survives reboots.

The frontend (`bun dev`) lives in a tmux session — **not auto-restart**. After
a reboot, re-run `./run-frontend.sh`. (If you want it to survive reboots,
write a systemd unit or wrap it in a docker container.)

## Security

No secrets are committed to this repo. The repo is public.

- `frontend/.env.local` is in `.gitignore` (real keys for TfL, Gemini)
- `scripts/.env` is in `.gitignore` (`CLOUDFLARE_API_TOKEN`, etc.)
- Scripts reference env vars via `${VAR}`; they never hardcode keys
- Cloudflare tunnel credentials live in `~/.cloudflared/<id>.json` (chmod 600)
  and `/etc/cloudflared/<id>.json` (root-owned, chmod 600)

## Cross-references

- Dev notes (more detail, kept on gpu1):
  `/home/charles/_charles/_github/charles-cai/dev-notes/gpu/vllm/nemotron-3-nano-omni-30b-nvfp4.md`
- Original DGX scripts: `../dgx/`
- Cloudflare scripts:   `../cloudflare/`
