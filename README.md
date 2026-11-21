# System Monitor

A sleek, modern, glassmorphic real-time system monitoring dashboard.
Built with **Next.js (React/TypeScript)** for the frontend, **FastAPI (Python)** for the backend telemetry stream over WebSockets, and fully containerized with **Docker Compose**.

![System Monitor Dashboard](./figures/screenshot.png)

---

## Features
- **Platform Detection**: Detects the host OS (**Linux / macOS / Windows**), version, architecture and device model (e.g. `macOS 15.1 · arm64`, `Apple M2 Max · Mac14,13`) and shows them in the header.
- **System Overview**: Real-time CPU usage, temperature (where the OS exposes it), load average, RAM/swap, disk usage per partition and network I/O — updated every second.
- **NVIDIA GPU Monitoring (Linux / Windows)**: Core utilization, VRAM, temperature, fan speed, power draw and CUDA/Graphics processes via NVML.
- **Apple GPU Monitoring — Metal / MPS (macOS)**: Device / renderer / tiler utilization, GPU memory in use (unified memory), Metal support level, MPS availability, and **per-process GPU time** for every Metal/MPS client (e.g. PyTorch `mps` jobs) — read from the IOKit registry, no `sudo` needed.
- **All Processes incl. Background**: Every process visible to the user, with a *Background* filter for processes without a controlling terminal (daemons, launchd/systemd services, `nohup` / detached jobs).
- **Process Management & Termination (Kill)**: Terminate any GPU or system process (`SIGTERM` / `SIGKILL`) from the web UI with a confirmation modal.
- **Smart Port Fallback**: `./start.sh` picks free ports automatically (3000/8000 → 3001/8001 …).
- **Rolling Time-series Charts**: 30-second history for CPU, memory, GPU utilization and GPU memory.
- **Real data only**: There is no mock/simulated mode. A metric the platform does not expose (e.g. Apple GPU temperature/power, which require root) is simply not displayed; without a supported GPU the GPU section is hidden.

---

## Quick Start (Recommended)

```bash
./start.sh     # start
./stop.sh      # stop
```

What `start.sh` does depends on the host:

| Host | Backend | Frontend | GPU |
| --- | --- | --- | --- |
| **Linux** | Docker (`pid: host`) | Docker | NVIDIA passthrough is added automatically (`docker-compose.gpu.yml`) when `nvidia-smi` and the NVIDIA container runtime are present |
| **macOS** | **Native** Python venv (`backend/.venv`) | Docker, or native `npm` if Docker is unavailable | Apple GPU (Metal / MPS) |
| **Windows** (Git Bash) | **Native** Python venv | Docker, or native `npm` | NVIDIA via NVML if present |

> **Why native on macOS / Windows?** Docker Desktop runs containers inside a Linux VM, so a containerized backend would only see that VM — not the real OS, the Apple GPU or the host's processes.

Native runtime state (PID files, `backend.log`) is kept in `.run/`. Requirements for native mode: Python 3.9+.

---

## Manual Docker Compose Launch (Linux)

```bash
# Without NVIDIA GPU
docker compose up -d --build

# With NVIDIA GPU (requires NVIDIA driver + NVIDIA Container Toolkit)
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up -d --build
```
- **Frontend Dashboard**: [http://localhost:3000](http://localhost:3000)
- **Backend API**: [http://localhost:8000](http://localhost:8000)
- **API Health Check**: [http://localhost:8000/api/health](http://localhost:8000/api/health) — reports the detected platform and GPU backend (`nvml`, `metal` or `null`).

---

## Environment Variables

All configuration lives in `.env` in the project root (`start.sh` creates it from `.env.example`).

| Variable | Default | Description |
| --- | --- | --- |
| `BACKEND_PORT` | `8000` | Host port for the FastAPI backend. |
| `FRONTEND_PORT` | `3000` | Host port for the Next.js frontend. |
| `NEXT_PUBLIC_WS_URL` | *(empty)* | WebSocket URL for telemetry. If empty, the frontend connects to the current browser host on `BACKEND_PORT`. Example: `ws://192.168.1.100:8000/ws`. |

---

## Platform Notes

### macOS (Apple GPU — Metal / MPS)
- GPU metrics come from the `IOAccelerator` IOKit registry (`ioreg`), the same source Activity Monitor uses. MPS workloads execute on the GPU through Metal, so they show up in GPU utilization and as *Metal* clients in **GPU Workloads**.
- **GPU Time** per process = share of GPU execution time over the last 1 s sample (first sample shows `—`).
- GPU memory is *unified* memory; the card shows memory currently in use by the GPU against total system RAM.
- Not shown on macOS (requires root / `powermetrics`): GPU temperature, power draw, fan speed and per-process GPU memory.
- CPU temperature is not exposed to unprivileged processes on macOS and is therefore hidden.

### Linux / Windows (NVIDIA)
- Requires the NVIDIA driver (NVML). Without an NVIDIA GPU the GPU section is hidden and only system metrics/processes are shown.

---

## Local Development (No Docker)

### Backend (Python FastAPI)
1. Navigate to `/backend`
2. Install requirements:
   ```bash
   pip install -r requirements.txt
   ```
3. Run the API:
   ```bash
   python main.py
   ```
   On macOS / Windows always run the backend this way (natively), not in Docker.

### Frontend (Next.js)
1. Navigate to `/frontend`
2. Install Node packages:
   ```bash
   npm install
   ```
3. Start the dev server:
   ```bash
   npm run dev
   ```
