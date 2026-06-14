#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="${TK_BROWSER_RUNTIME_DIR:-"$HOME/.md-browser"}"
PID_FILE="$RUNTIME_DIR/webui.pid"
LOG_FILE="${TK_BROWSER_WEBUI_LOG:-"$RUNTIME_DIR/webui.log"}"
HOST="${TK_BROWSER_WEBUI_HOST:-127.0.0.1}"
PORT="${TK_BROWSER_WEBUI_PORT:-18777}"

mkdir -p "$RUNTIME_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required." >&2
  exit 1
fi

if [[ "${1:-}" == "--foreground" ]]; then
  cd "$BASE_DIR"
  exec node src/server.js
fi

listening_pid() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
  fi
}

status_ready() {
  curl -fsS "http://$HOST:$PORT/api/status" 2>/dev/null | node -e 'let s = ""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const data = JSON.parse(s); if (!data || typeof data !== "object" || !data.config || !data.routes) process.exit(1); });' >/dev/null 2>&1
}

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "MD-Browser WebUI is already running."
    echo "PID: $existing_pid"
    echo "URL: http://$HOST:$PORT"
    echo "Log: $LOG_FILE"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

port_pid="$(listening_pid || true)"
if [[ -n "$port_pid" ]]; then
  if status_ready; then
    echo "$port_pid" >"$PID_FILE"
    echo "MD-Browser WebUI is already running."
    echo "PID: $port_pid"
    echo "URL: http://$HOST:$PORT"
    echo "Log: $LOG_FILE"
    exit 0
  fi
  echo "Port $PORT is already occupied by PID $port_pid." >&2
  echo "Run scripts/stop_webui.sh first, or set TK_BROWSER_WEBUI_PORT to another port." >&2
  exit 1
fi

cd "$BASE_DIR"
nohup node src/server.js >"$LOG_FILE" 2>&1 </dev/null &
webui_pid=$!
echo "$webui_pid" >"$PID_FILE"

for _ in {1..20}; do
  if status_ready; then
    echo "MD-Browser WebUI started."
    echo "PID: $webui_pid"
    echo "URL: http://$HOST:$PORT"
    echo "Log: $LOG_FILE"
    exit 0
  fi
  if ! kill -0 "$webui_pid" 2>/dev/null; then
    echo "WebUI process exited before becoming ready." >&2
    echo "Log: $LOG_FILE" >&2
    rm -f "$PID_FILE"
    exit 1
  fi
  sleep 0.25
done

echo "WebUI process started but did not become ready in time." >&2
echo "PID: $webui_pid" >&2
echo "Log: $LOG_FILE" >&2
exit 1
