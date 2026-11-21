#!/usr/bin/env bash

# ==============================================================================
# Realtime System & GPU Monitoring Tool - Stop Service
#   Stops natively started processes (macOS / Windows backend, optional native
#   frontend) and this project's Docker Compose containers.
#   Usage: ./stop.sh [--quiet]
# ==============================================================================

cd "$(dirname "$0")"
RUN_DIR="$(pwd)/.run"
QUIET=false
[ "$1" = "--quiet" ] && QUIET=true

GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

say() { [ "$QUIET" = true ] || echo -e "$@"; }

say "${CYAN}${BOLD}"
say "=================================================================="
say "   🛑 Stopping System & GPU Monitor..."
say "=================================================================="
say "${NC}"

stop_pidfile() {
  local name=$1 file="$RUN_DIR/$1.pid" pid
  [ -f "$file" ] || return 0
  pid=$(cat "$file")
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    # Windows: venv python.exe is a launcher; kill its whole tree or the real interpreter keeps the port
    [ -r "/proc/$pid/winpid" ] && taskkill //T //F //PID "$(cat "/proc/$pid/winpid")" >/dev/null 2>&1
    kill "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    say "${GREEN}✔ Stopped native ${name} (PID ${pid})${NC}"
  fi
  rm -f "$file"
}

stop_pidfile backend
stop_pidfile frontend

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  if [ "$QUIET" = true ]; then
    docker compose down >/dev/null 2>&1 || true
  else
    docker compose down || true
  fi
fi

say ""
say "${GREEN}✔ All services stopped.${NC}"
