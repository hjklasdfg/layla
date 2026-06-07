#!/usr/bin/env bash
cd "$(dirname "$0")"
rm -f _graph_cache.pkl ../layla-data/_graph_cache.pkl
export NEMOTRON_BASE_URL="${NEMOTRON_BASE_URL:-http://localhost:18000}"
export TFL_APP_KEY="$(grep -E "^TFL_APP_KEY=" ../../../../frontend/.env.local 2>/dev/null | cut -d= -f2-)"
export PORT=8000
exec python3 mobility_plan_server.py
