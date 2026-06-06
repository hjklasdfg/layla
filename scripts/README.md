# Layla Scripts

Multimodal inference scripts for **Nemotron-3-Nano-Omni** — supports both Nebius cloud and local DGX vLLM endpoints.

---

## Structure

```
scripts/
├── nano-image-chat.py        # multimodal image chat CLI
├── assets/                   # test images
│   └── police-road-block-AG3Y12.jpg
├── dgx/
│   ├── nemotron-nano-omni-30b-nvfp4.sh   # start vLLM container on DGX
│   └── open-webui.sh                      # start Open WebUI connected to vLLM
└── nebius/
    └── .env.example          # copy to .env and fill in your API key
```

---

## Setup

```bash
cp nebius/.env.example nebius/.env
# edit nebius/.env and set NEBIUS_API_KEY
```

---

## nano-image-chat.py

Send an image to Nemotron-3-Nano-Omni and ask a question. Defaults to Nebius cloud.

### Options

```
python3 nano-image-chat.py <image_path> [prompt] [--type nebius|dgx]
```

| Argument | Default | Description |
|---|---|---|
| `image_path` | required | path to image (jpg, png, webp) |
| `prompt` | `"What's in this image? Describe in detail."` | question to ask |
| `--type nebius` | default | Nebius cloud endpoint, reads `NEBIUS_API_KEY` from `nebius/.env` |
| `--type dgx` | — | local vLLM on `localhost:18000` |

### Examples

```bash
# Nebius (default)
python3 nano-image-chat.py assets/police-road-block-AG3Y12.jpg

# Custom prompt
python3 nano-image-chat.py assets/police-road-block-AG3Y12.jpg "How many people and vehicles?"

# Local DGX vLLM
python3 nano-image-chat.py assets/police-road-block-AG3Y12.jpg --type dgx

# Custom prompt on DGX
python3 nano-image-chat.py assets/police-road-block-AG3Y12.jpg "Any text visible?" --type dgx
```

---

## DGX: Start vLLM

```bash
# Start Nemotron vLLM container (thinking OFF by default)
./dgx/nemotron-nano-omni-30b-nvfp4.sh

# With thinking ON
./dgx/nemotron-nano-omni-30b-nvfp4.sh vllm-active 18000 1

# Usage: nemotron-nano-omni-30b-nvfp4.sh [container] [port] [thinking=0|1]
```

Model: `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4` (NVFP4, ~15 GB, 128K ctx, multimodal)

---

## DGX: Start Open WebUI

```bash
./dgx/open-webui.sh
# → http://localhost:3001

# Usage: open-webui.sh [container] [vllm-container] [vllm-port] [webui-port]
```

Connects to vLLM over `vllm-net` Docker network. Disable thinking per model in Open WebUI via:
Admin Panel → Models → Advanced Parameters → Extra Request Body:
```json
{"chat_template_kwargs": {"enable_thinking": false}}
```

---

## Endpoints

| Type | URL | Model |
|---|---|---|
| nebius | `https://api.tokenfactory.nebius.com/v1/chat/completions` | `nvidia/Nemotron-3-Nano-Omni` |
| dgx | `http://localhost:18000/v1/chat/completions` | `nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4` |
