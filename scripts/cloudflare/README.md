# Cloudflare Tunnel

Expose the local vLLM endpoint to the internet via [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/) — no account needed, no DNS setup required.

---

## Install cloudflared

Via the official Cloudflare apt repository (works on amd64 and ARM64 / DGX Spark):

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install cloudflared

# Verify
cloudflared --version
```

---

## Quick Tunnel

```bash
# Default — exposes localhost:18000
./cloudflare/cloudflared-tunnel.sh

# Custom port
./cloudflare/cloudflared-tunnel.sh 18000

# Custom port + custom .env target
./cloudflare/cloudflared-tunnel.sh 18000 /path/to/.env
```

The script:
1. Starts a Quick Tunnel to `localhost:<port>`
2. Waits for the `*.trycloudflare.com` URL to appear
3. Prints the URL prominently
4. Writes `VLLM_PUBLIC_URL=https://...trycloudflare.com` into `nebius/.env`

---

## Keeping the tunnel alive (hackathon / multi-day)

Quick tunnels last **as long as the process runs** — there is no 12-hour expiry. The URL only changes if the process is restarted. To survive SSH disconnects, run inside tmux:

```bash
tmux new -s tunnel
./cloudflare/cloudflared-tunnel.sh
# Ctrl+B then D  →  detach (tunnel keeps running)

# Re-attach later
tmux attach -t tunnel
```

---

## Using the public URL

After the tunnel starts, `VLLM_PUBLIC_URL` is written to `nebius/.env`. Use it anywhere you need the external endpoint:

```bash
# One-off check
source nebius/.env
curl ${VLLM_PUBLIC_URL}/v1/models

# Pass to nano-image-chat.py via env override (no code change needed)
VLLM_PUBLIC_URL=https://xxxx.trycloudflare.com python3 nano-image-chat.py assets/police-road-block-AG3Y12.jpg
```

---

## Open WebUI via cloudflare tunnel (test / loop instance)

To verify the tunnel end-to-end, spin up a second Open WebUI instance (`open-webui-cf`) on port **3002** that routes through the cloudflare URL instead of the internal Docker network:

```bash
docker run -d \
  --name open-webui-cf \
  -p 3002:8080 \
  -v open-webui-cf-data:/app/backend/data \
  -e OPENAI_API_BASE_URLS="https://xxxx.trycloudflare.com/v1" \
  -e OPENAI_API_KEY="dummy" \
  -e WEBUI_AUTH=False \
  -e ENABLE_OLLAMA_API=False \
  ghcr.io/open-webui/open-webui:main
```

Replace `xxxx.trycloudflare.com` with the URL printed by `cloudflared-tunnel.sh`.

**VS Code Remote SSH** — VS Code does not auto-forward port 3002. Add it manually:
Ports panel → **Forward a Port** → `3002`, then open `http://localhost:3002`.

| Instance | Port | Backend |
|---|---|---|
| `open-webui` | 3001 | vLLM direct via `vllm-net` Docker network |
| `open-webui-cf` | 3002 | vLLM via cloudflare tunnel (loop test) |

---

## Tunnel URL rotation

If the process dies and restarts, cloudflare assigns a **new** random URL. The script automatically updates `VLLM_PUBLIC_URL` in `.env` on each start. Re-source the file or restart any service that reads it.

For `open-webui-cf`, recreate the container with the new URL:
```bash
docker rm -f open-webui-cf
# re-run the docker run command above with the new URL
```

---

## Architecture

```
Internet
   │
   ▼
*.trycloudflare.com   (Cloudflare edge — free, no account)
   │  encrypted tunnel
   ▼
cloudflared (this machine)
   │  localhost
   ├──▶ vLLM  :18000
   └──▶ open-webui-cf  :3002  (loop test: OUI → cloudflare → vLLM)
```
