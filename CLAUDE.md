# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Real-time system/GPU monitoring dashboard: FastAPI backend (`backend/`) streams telemetry over a WebSocket to a Next.js 14 / React 18 / TypeScript frontend (`frontend/`). There is no test suite.

## Commands

```bash
./start.sh            # full stack, platform-aware (see below); picks free ports, writes them to .env
./stop.sh [--quiet]   # stops native PIDs in .run/ and `docker compose down`

# Backend (native)
cd backend && pip install -r requirements.txt && python main.py     # honors $PORT (default 8000)
curl localhost:8000/api/health                                       # reports platform + gpu_backend

# Frontend
cd frontend && npm install
npm run dev           # port 3000
npm run build
npm run lint          # next lint
npx tsc --noEmit      # type-check — `next build` ignores TS and ESLint errors (next.config.js)

# Docker (Linux only)
docker compose up -d --build
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build   # NVIDIA passthrough
```

## Architecture

**Deployment model is platform-dependent** (`start.sh`):
- Linux: backend + frontend in Docker. Backend container uses `pid: host` + `KILL`/`SYS_PTRACE` caps so it can see and kill host processes, and list host disks via `/proc/1/mounts` + `/proc/1/root` (`SystemMonitor._list_partitions`). `docker-compose.gpu.yml` is layered on when `nvidia-smi` and the NVIDIA container runtime are present.
- macOS / Windows: backend **must run natively** (venv at `backend/.venv`, deps reinstalled only when `requirements.txt` hash changes) because a containerized backend would only see Docker Desktop's Linux VM. Frontend runs in Docker or falls back to native `npm`. Logs/PIDs live in `.run/`.

**Backend** (`backend/`):
- `main.py` — `/ws` loops every 1s, calling `GPUMonitor.get_gpu_data()` and `SystemMonitor.get_full_system_data()` via `asyncio.to_thread` (both block), and sends one merged JSON payload: GPU fields at top level plus a `system` key. Also `GET /api/health` and `POST /api/processes/{pid}/kill` (body `{force}` → SIGKILL vs SIGTERM; refuses PID ≤ 1 and its own PID).
- `gpu_monitor.py` — `GPUMonitor` facade selects one backend by OS: `AppleMetalBackend` on Darwin (parses `ioreg` IOAccelerator registry; per-process GPU time is computed from deltas between samples, so the first sample is `None`), otherwise `NvidiaBackend` (NVML via `nvidia-ml-py`). If construction fails, GPU telemetry is disabled and `gpus` is empty.
- `system_monitor.py` — psutil-based CPU/mem/disk/net/uptime/processes; processes carry a `background` flag (no controlling terminal).
- `platform_info.py` — OS/arch/device-model detection shown in the header.

**Frontend** (`frontend/src/`):
- `app/page.tsx` loads `components/Dashboard.tsx` with `ssr: false` (WebSocket is client-only).
- `Dashboard.tsx` owns the WebSocket and all state. Before connecting it fetches `app/api/config/route.ts`, which returns `BACKEND_PORT`/`NEXT_PUBLIC_WS_URL` from the server's **runtime** env — this is how the port chosen by `start.sh` reaches the browser without rebuilding. WS URL = `NEXT_PUBLIC_WS_URL` if set, else `ws(s)://<browser host>:<backendPort>/ws`. It keeps 30-sample rolling histories (per GPU index, and system CPU/mem) for the charts.
- `ProcessTable.tsx` calls the kill endpoint directly against the backend origin.
- `types/gpu.ts` mirrors the backend payload shape — update it alongside any payload change in the Python monitors.

## Conventions

- **Real data only — never add mock/simulated telemetry.** A metric the platform doesn't expose is sent as `null` and the UI hides it (e.g. Apple GPU temperature/power/fan, per-process GPU memory on macOS, CPU temp on macOS). Without a supported GPU the GPU section is hidden.
- New GPU fields must be added to `GPUMonitor.info()`/backend dicts for both NVML and Metal (as `None` where unsupported) and to `types/gpu.ts` as nullable.
- Styling uses per-component CSS Modules (`*.module.css`) plus `app/globals.css`; charts use Recharts, icons lucide-react.
