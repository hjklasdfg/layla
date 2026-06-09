#!/usr/bin/env bash
# scripts/gpu1/run-frontend.sh — run the Next.js frontend on gpu1 in a tmux session
# Listens on 0.0.0.0:3000 so Caddy (running in vllm-net) can reach it via
# host.docker.internal:3000.
#
# Bun lives under $HOME/.bun/bin on gpu1 (charles user, not on system PATH).
#
# Usage: ./run-frontend.sh
set -e

BUN="${BUN:-$HOME/.bun/bin/bun}"
SCRIPT_DIR="$(realpath "$(dirname "$0")")"
FRONTEND_DIR="$(realpath "${SCRIPT_DIR}/../../frontend")"
SESSION="frontend"

if [ ! -x "$BUN" ]; then
  echo "Error: bun not found at $BUN. Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

cd "$FRONTEND_DIR"

if [ ! -d node_modules ]; then
  echo "Installing frontend dependencies (bun install)..."
  "$BUN" install
fi

# Kill any prior session
tmux kill-session -t "$SESSION" 2>/dev/null || true

tmux new-session -d -s "$SESSION" -c "$FRONTEND_DIR" \
  "$BUN --bun run dev -H 0.0.0.0 -p 3000 2>&1 | tee /tmp/frontend.log"

sleep 2
echo ""
echo "Frontend starting in tmux session '$SESSION' → http://localhost:3000"
echo "Attach:  tmux attach -t $SESSION    (Ctrl+B then D to detach)"
echo "Logs:    tail -f /tmp/frontend.log"
