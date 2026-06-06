#!/usr/bin/env python3
# nebius-image-chat.py — multimodal image chat via OpenAI-compatible API
# Usage: python3 nebius-image-chat.py <image_path> [prompt] [--type nebius|dgx]
#
# --type nebius (default): Nebius cloud endpoint, requires NEBIUS_API_KEY
# --type dgx:              local vLLM on localhost:18000

import base64, json, os, sys, urllib.request, urllib.error
from pathlib import Path

CONFIGS = {
    "nebius": {
        "url":   "https://api.tokenfactory.nebius.com/v1/chat/completions",
        "model": "nvidia/Nemotron-3-Nano-Omni",
        "key_env": "NEBIUS_API_KEY",
    },
    "dgx": {
        "url":   "http://localhost:18000/v1/chat/completions",
        "model": "nvidia/Nemotron-3-Nano-Omni-30B-A3B-Reasoning-NVFP4",
        "key_env": None,
    },
}

def load_dotenv():
    env_file = Path(__file__).parent / "nebius" / ".env"
    if not env_file.exists():
        env_file = Path(__file__).parent / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip().removeprefix("export").strip()
        if "=" in line and not line.startswith("#"):
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

def main():
    load_dotenv()

    args = sys.argv[1:]
    endpoint_type = "nebius"
    if "--type" in args:
        idx = args.index("--type")
        endpoint_type = args[idx + 1]
        args = args[:idx] + args[idx + 2:]

    if not args:
        print(f"Usage: {sys.argv[0]} <image_path> [prompt] [--type nebius|dgx]")
        sys.exit(1)

    image_path = args[0]
    prompt     = args[1] if len(args) > 1 else "What's in this image? Describe in detail."

    cfg = CONFIGS.get(endpoint_type)
    if not cfg:
        print(f"Unknown --type '{endpoint_type}'. Choose: {', '.join(CONFIGS)}", file=sys.stderr)
        sys.exit(1)

    api_key = os.environ.get(cfg["key_env"]) if cfg["key_env"] else "dummy"
    if not api_key:
        print(f"Error: {cfg['key_env']} env var not set (check .env)", file=sys.stderr)
        sys.exit(1)

    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()

    ext  = image_path.rsplit(".", 1)[-1].lower()
    mime = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")

    payload = {
        "model": cfg["model"],
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                {"type": "text", "text": prompt}
            ]
        }]
    }

    print(f"type   : {endpoint_type}")
    print(f"url    : {cfg['url']}")
    print(f"model  : {cfg['model']}")
    print(f"image  : {image_path}")
    print(f"prompt : {prompt}")
    print()

    req = urllib.request.Request(
        cfg["url"],
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Accept": "*/*",
            "Authorization": f"Bearer {api_key}"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            msg = result["choices"][0]["message"]
            print(msg["content"])
            if msg.get("reasoning_content"):
                print("\n--- thinking ---")
                print(msg["reasoning_content"])
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection error: {e.reason}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
