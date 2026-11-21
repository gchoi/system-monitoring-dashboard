#!/usr/bin/env bash

# ==============================================================================
# Realtime System & GPU Monitoring Tool - Auto-Start with Port Fallback
#
#   Linux          : backend + frontend in Docker Compose
#                    (+ NVIDIA GPU passthrough when an NVIDIA GPU is detected)
#   macOS / Windows: backend runs NATIVELY on the host (a Docker container only
#                    sees the Linux VM, not the real OS, GPU or processes);
#                    frontend runs in Docker, or natively if Docker is missing.
# ==============================================================================

set -e

cd "$(dirname "$0")"
ROOT_DIR="$(pwd)"
RUN_DIR="$ROOT_DIR/.run"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "=================================================================="
echo "   🚀 Realtime System & GPU Monitor - Automated Deployment"
echo "=================================================================="
echo -e "${NC}"

# ── Platform detection ───────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux*)               HOST_OS="Linux" ;;
  Darwin*)              HOST_OS="macOS" ;;
  MINGW*|MSYS*|CYGWIN*) HOST_OS="Windows" ;;
  *)                    HOST_OS="$(uname -s)" ;;
esac

if [ "$HOST_OS" = "Linux" ]; then
  BACKEND_MODE="docker"
else
  BACKEND_MODE="native"
fi

HAS_DOCKER=false
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  HAS_DOCKER=true
fi

if [ "$BACKEND_MODE" = "docker" ] || [ "$HAS_DOCKER" = true ]; then
  FRONTEND_MODE="docker"
else
  FRONTEND_MODE="native"
fi

if [ "$BACKEND_MODE" = "docker" ] && [ "$HAS_DOCKER" != true ]; then
  echo -e "${RED}✖ Docker is required on Linux but is not available (is the daemon running?).${NC}"
  exit 1
fi

echo -e "🖥  Platform      : ${BOLD}${HOST_OS}${NC} ($(uname -m))"
echo -e "⚙️  Backend mode  : ${BOLD}${BACKEND_MODE}${NC}"
echo -e "⚙️  Frontend mode : ${BOLD}${FRONTEND_MODE}${NC}"
echo ""

# ── .env handling ────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo -e "${YELLOW}📝 .env file not found. Creating from .env.example...${NC}"
    cp .env.example .env
  else
    touch .env
  fi
fi

# Portable in-place update (BSD sed on macOS and GNU sed differ on -i)
update_env_var() {
  local key=$1 val=$2 tmp
  tmp="$(mktemp)"
  if grep -q "^${key}=" .env; then
    sed "s|^${key}=.*|${key}=${val}|" .env > "$tmp"
  else
    cat .env > "$tmp"
    echo "${key}=${val}" >> "$tmp"
  fi
  cat "$tmp" > .env
  rm -f "$tmp"
}

read_env_var() {
  grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d '=' -f2- | tr -d ' "\r\n' || true
}

NEXT_PUBLIC_WS_URL="$(read_env_var NEXT_PUBLIC_WS_URL)"

# ── Stop previous instances of THIS project ─────────────────────────────────
echo -e "${CYAN}🔄 Stopping previous instances (if any)...${NC}"
"$BASH" ./stop.sh --quiet || true  # same bash as us: on Windows a bare ./stop.sh can resolve to WSL bash

# ── Port resolution ──────────────────────────────────────────────────────────
PY_BOOT=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' >/dev/null 2>&1; then
    PY_BOOT="$c"; break
  fi
done

is_port_free() {
  local port=$1
  if [ -n "$PY_BOOT" ]; then
    "$PY_BOOT" - "$port" <<'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.15)
try:
    s.connect(('127.0.0.1', port))
    s.close()
    sys.exit(1)          # something is listening
except (ConnectionRefusedError, socket.timeout, OSError):
    s.close()
s2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
# Servers (uvicorn, Docker proxy) bind with SO_REUSEADDR, so lingering
# TIME_WAIT connections from a previous run do not make the port "busy".
s2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s2.bind(('0.0.0.0', port))
    s2.close()
    sys.exit(0)          # free
except OSError:
    s2.close()
    sys.exit(1)
PY
    return $?
  elif command -v lsof >/dev/null 2>&1; then
    lsof -i :"$port" >/dev/null 2>&1 && return 1 || return 0
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$port" >/dev/null 2>&1 && return 1 || return 0
  fi
  return 0
}

find_available_port() {
  local port=$1 attempt=0
  while [ $attempt -lt 50 ]; do
    if is_port_free "$port"; then echo "$port"; return 0; fi
    port=$((port + 1)); attempt=$((attempt + 1))
  done
  echo "$1"; return 1
}

resolve_port() {
  local label=$1 base=$2 port
  echo -n "🔍 Checking $label Port ($base)... " >&2
  if is_port_free "$base"; then
    echo -e "${GREEN}Available!${NC}" >&2
    echo "$base"
  else
    port=$(find_available_port $((base + 1)))
    echo -e "${YELLOW}in use${NC} → using ${BOLD}$port${NC}" >&2
    echo "$port"
  fi
}

FRONTEND_PORT=$(resolve_port "Frontend" 3000)
BACKEND_PORT=$(resolve_port "Backend" 8000)
update_env_var "FRONTEND_PORT" "$FRONTEND_PORT"
update_env_var "BACKEND_PORT" "$BACKEND_PORT"
export FRONTEND_PORT BACKEND_PORT NEXT_PUBLIC_WS_URL

mkdir -p "$RUN_DIR"

wait_for_http() {
  local url=$1 tries=${2:-30}
  for _ in $(seq 1 "$tries"); do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

# ── Backend ──────────────────────────────────────────────────────────────────
start_backend_native() {
  if [ -z "$PY_BOOT" ]; then
    echo -e "${RED}✖ Python 3.9+ is required to run the backend natively on ${HOST_OS}.${NC}"
    exit 1
  fi
  local venv="$ROOT_DIR/backend/.venv" py
  if [ "$HOST_OS" = "Windows" ]; then py="$venv/Scripts/python.exe"; else py="$venv/bin/python"; fi

  if [ ! -x "$py" ]; then
    echo -e "${CYAN}🐍 Creating Python virtualenv (backend/.venv)...${NC}"
    "$PY_BOOT" -m venv "$venv"
  fi

  # Reinstall dependencies only when requirements.txt changes
  local stamp="$venv/.requirements.sha" want have=""
  want=$("$py" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$ROOT_DIR/backend/requirements.txt")
  [ -f "$stamp" ] && have=$(cat "$stamp")
  if [ "$want" != "$have" ]; then
    echo -e "${CYAN}📦 Installing backend dependencies...${NC}"
    "$py" -m pip install -q --disable-pip-version-check -r "$ROOT_DIR/backend/requirements.txt"
    echo "$want" > "$stamp"
  fi

  echo -e "${CYAN}▶️  Starting backend natively on port ${BACKEND_PORT}...${NC}"
  (
    cd "$ROOT_DIR/backend"
    PORT="$BACKEND_PORT" nohup "$py" -m uvicorn main:app --host 0.0.0.0 --port "$BACKEND_PORT" \
      > "$RUN_DIR/backend.log" 2>&1 &
    echo $! > "$RUN_DIR/backend.pid"
  )

  if ! wait_for_http "http://127.0.0.1:${BACKEND_PORT}/api/health" 30; then
    echo -e "${RED}✖ Backend failed to start. Last log lines:${NC}"
    tail -n 30 "$RUN_DIR/backend.log" || true
    exit 1
  fi
}

COMPOSE_FILES=(-f docker-compose.yml)
if [ "$BACKEND_MODE" = "docker" ]; then
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 \
     && docker info --format '{{json .Runtimes}}' 2>/dev/null | grep -q nvidia; then
    echo -e "${GREEN}🎮 NVIDIA GPU + container runtime detected → enabling GPU passthrough${NC}"
    COMPOSE_FILES+=(-f docker-compose.gpu.yml)
  else
    echo -e "${YELLOW}ℹ️  No NVIDIA GPU / container runtime detected → GPU section will be hidden${NC}"
  fi
else
  start_backend_native
fi

# ── Frontend ─────────────────────────────────────────────────────────────────
start_frontend_native() {
  if ! command -v npm >/dev/null 2>&1; then
    echo -e "${RED}✖ Neither Docker nor npm is available to run the frontend.${NC}"
    exit 1
  fi
  echo -e "${CYAN}📦 Building frontend natively...${NC}"
  (
    cd "$ROOT_DIR/frontend"
    [ -d node_modules ] || npm install --no-audit --no-fund
    NEXT_PUBLIC_BACKEND_PORT="$BACKEND_PORT" npm run build
    BACKEND_PORT="$BACKEND_PORT" NEXT_PUBLIC_BACKEND_PORT="$BACKEND_PORT" \
      nohup node node_modules/next/dist/bin/next start -p "$FRONTEND_PORT" > "$RUN_DIR/frontend.log" 2>&1 &
    echo $! > "$RUN_DIR/frontend.pid"
  )
}

echo ""
if [ "$BACKEND_MODE" = "docker" ]; then
  echo -e "${CYAN}🐳 Building and starting Docker containers...${NC}"
  docker compose "${COMPOSE_FILES[@]}" up -d --build
elif [ "$FRONTEND_MODE" = "docker" ]; then
  echo -e "${CYAN}🐳 Building and starting frontend container...${NC}"
  docker compose "${COMPOSE_FILES[@]}" up -d --build --no-deps frontend
else
  start_frontend_native
fi

if ! wait_for_http "http://127.0.0.1:${FRONTEND_PORT}" 60; then
  echo -e "${YELLOW}⚠️  Frontend did not respond yet on port ${FRONTEND_PORT}; it may still be starting.${NC}"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
HOST_IP=""
case "$HOST_OS" in
  Linux)  HOST_IP=$(hostname -I 2>/dev/null | awk '{print $1}') ;;
  macOS)  HOST_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true) ;;
esac
[ -z "$HOST_IP" ] && HOST_IP="localhost"

echo ""
echo -e "${GREEN}${BOLD}=================================================================="
echo "   ✨ System & GPU Monitor is now RUNNING! (${HOST_OS})"
echo "=================================================================="
echo -e "${NC}"
echo -e "   🌐 Web Dashboard : ${CYAN}${BOLD}http://${HOST_IP}:${FRONTEND_PORT}${NC}"
if [ "$HOST_IP" != "localhost" ]; then
  echo -e "   💻 Local Access  : ${CYAN}http://localhost:${FRONTEND_PORT}${NC}"
fi
echo -e "   🔌 Backend API   : ${CYAN}http://${HOST_IP}:${BACKEND_PORT}${NC}"
if [ "$BACKEND_MODE" = "native" ]; then
  echo -e "   📄 Backend log   : ${CYAN}.run/backend.log${NC}"
fi
echo ""
echo -e "   🛑 To stop service: ${YELLOW}./stop.sh${NC}"
echo -e "${GREEN}==================================================================${NC}"
