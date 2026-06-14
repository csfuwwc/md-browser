#!/usr/bin/env bash
set -euo pipefail

RUNTIME_DIR="${TK_BROWSER_RUNTIME_DIR:-"$HOME/.md-browser"}"
PID_FILE="$RUNTIME_DIR/webui.pid"
PORT="${TK_BROWSER_WEBUI_PORT:-18777}"

listening_pid() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | head -n 1
  fi
}

if [[ ! -f "$PID_FILE" ]]; then
  port_pid="$(listening_pid || true)"
  if [[ -n "$port_pid" ]]; then
    kill "$port_pid"
    echo "Stopped MD-Browser WebUI listener on port $PORT (PID: $port_pid)."
  else
    echo "MD-Browser WebUI is not running."
  fi
  exit 0
fi

webui_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "$webui_pid" ]]; then
  rm -f "$PID_FILE"
  echo "PID file was empty and has been cleared."
  exit 0
fi

if kill -0 "$webui_pid" 2>/dev/null; then
  kill "$webui_pid"
  echo "Stopped MD-Browser WebUI (PID: $webui_pid)."
else
  echo "Process $webui_pid was not running."
fi

port_pid="$(listening_pid || true)"
if [[ -n "$port_pid" ]] && [[ "$port_pid" != "$webui_pid" ]]; then
  kill "$port_pid"
  echo "Stopped stale MD-Browser WebUI listener on port $PORT (PID: $port_pid)."
fi

rm -f "$PID_FILE"
