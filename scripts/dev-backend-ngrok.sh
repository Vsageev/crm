#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

NGROK_DOMAIN="${NGROK_DOMAIN:-posticous-unmaturely-theola.ngrok-free.dev}"
BACKEND_PORT="${BACKEND_PORT:-3000}"

if ! command -v ngrok >/dev/null 2>&1; then
  echo "Error: ngrok is not installed or not in PATH."
  exit 1
fi

cleanup() {
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

cd "$PROJECT_ROOT"

echo "Starting backend on port ${BACKEND_PORT}..."
pnpm --filter backend dev &
BACKEND_PID=$!

echo "Starting ngrok tunnel at https://${NGROK_DOMAIN} -> http://localhost:${BACKEND_PORT}"
ngrok http --url="${NGROK_DOMAIN}" "${BACKEND_PORT}"
