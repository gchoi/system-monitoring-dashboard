"""GPU telemetry.

Supported backends:
  * NVIDIA via NVML (Linux / Windows)          -> backend "nvml"
  * Apple GPU via IOKit registry (macOS)       -> backend "metal"
    Metal / Metal Performance Shaders (MPS) workloads run on the Apple GPU;
    utilization, GPU memory and per-process GPU time are read from the
    IOAccelerator registry entries (no root privileges required).

No simulated data is ever produced. A metric that the platform does not
expose is reported as ``None`` and a GPU that cannot be detected is simply
not listed.
"""

import logging
import os
import platform
import plistlib
import re
import subprocess
import time

logger = logging.getLogger("GPUMonitor")

try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False

MB = 1024 * 1024


def _process_display_name(pid, fallback=None):
    if not HAS_PSUTIL:
        return fallback or "Unknown"
    try:
        p = psutil.Process(pid)
        name = p.name()
        try:
            cmdline = p.cmdline()
            if name.startswith("python") and len(cmdline) > 1:
                script = os.path.basename(cmdline[1])
                if not script.startswith("-"):
                    return f"{name} {script}"
        except (psutil.AccessDenied, psutil.ZombieProcess):
            pass
        return name or fallback or "Unknown"
    except Exception:
        return fallback or "Unknown"


# ═══════════════════════════════════════════════════════════════════
#  NVIDIA (NVML)
# ═══════════════════════════════════════════════════════════════════

class NvidiaBackend:
    name = "nvml"

    def __init__(self):
        import pynvml  # raises ImportError if unavailable
        self.nvml = pynvml
        pynvml.nvmlInit()
        count = pynvml.nvmlDeviceGetCount()
        if count == 0:
            raise RuntimeError("NVML initialized but no NVIDIA GPU found")
        self.handles = [pynvml.nvmlDeviceGetHandleByIndex(i) for i in range(count)]

        drv = pynvml.nvmlSystemGetDriverVersion()
        self.driver_version = drv.decode() if isinstance(drv, bytes) else drv
        try:
            cv = pynvml.nvmlSystemGetCudaDriverVersion()
            self.cuda_version = f"{cv // 1000}.{(cv % 1000) // 10}"
        except Exception:
            self.cuda_version = None
        logger.info("NVML initialized: %d GPU(s), driver %s", count, self.driver_version)

    def info(self):
        return {
            "driver_version": self.driver_version,
            "cuda_version": self.cuda_version,
        }

    @staticmethod
    def _try(fn, default=None):
        try:
            return fn()
        except Exception:
            return default

    def get_gpus(self):
        nv = self.nvml
        gpus = []
        for i, h in enumerate(self.handles):
            name = self._try(lambda: nv.nvmlDeviceGetName(h), f"NVIDIA GPU {i}")
            if isinstance(name, bytes):
                name = name.decode()
            uuid = self._try(lambda: nv.nvmlDeviceGetUUID(h), f"nvidia-{i}")
            if isinstance(uuid, bytes):
                uuid = uuid.decode()

            util = self._try(lambda: nv.nvmlDeviceGetUtilizationRates(h))
            mem = self._try(lambda: nv.nvmlDeviceGetMemoryInfo(h))
            mem_total = int(mem.total / MB) if mem else None
            mem_used = int(mem.used / MB) if mem else None
            mem_free = int(mem.free / MB) if mem else None
            mem_util = int(mem_used / mem_total * 100) if mem and mem_total else None

            temp = self._try(lambda: nv.nvmlDeviceGetTemperature(h, nv.NVML_TEMPERATURE_GPU))
            fan = self._try(lambda: nv.nvmlDeviceGetFanSpeed(h))
            power = self._try(lambda: nv.nvmlDeviceGetPowerUsage(h) / 1000.0)
            power_limit = self._try(lambda: nv.nvmlDeviceGetPowerManagementLimit(h) / 1000.0)

            proc_map = {}
            for kind, fn in (("Graphics", nv.nvmlDeviceGetGraphicsRunningProcesses),
                             ("Compute", nv.nvmlDeviceGetComputeRunningProcesses)):
                for p in self._try(lambda: fn(h), []) or []:
                    used = int(p.usedGpuMemory / MB) if p.usedGpuMemory else None
                    if p.pid in proc_map:
                        entry = proc_map[p.pid]
                        entry["type"] = "C+G"
                        if used is not None and (entry["used_memory"] or 0) < used:
                            entry["used_memory"] = used
                    else:
                        proc_map[p.pid] = {"type": kind, "used_memory": used}

            processes = [
                {
                    "pid": pid,
                    "name": _process_display_name(pid),
                    "type": info["type"],
                    "used_memory": info["used_memory"],
                    "gpu_percent": None,
                }
                for pid, info in proc_map.items()
            ]

            gpus.append({
                "index": i,
                "name": name,
                "uuid": uuid,
                "vendor": "NVIDIA",
                "backend": self.name,
                "memory_kind": "dedicated",
                "core_count": None,
                "gpu_util": util.gpu if util else None,
                "renderer_util": None,
                "tiler_util": None,
                "mem_util": mem_util,
                "mem_total": mem_total,
                "mem_used": mem_used,
                "mem_free": mem_free,
                "temperature": temp,
                "fan_speed": fan,
                "power_draw": round(power, 1) if power is not None else None,
                "power_limit": round(power_limit, 1) if power_limit is not None else None,
                "process_metric": "memory",
                "processes": processes,
            })
        return gpus

    def shutdown(self):
        try:
            self.nvml.nvmlShutdown()
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════
#  Apple GPU (Metal / MPS) via IOKit registry
# ═══════════════════════════════════════════════════════════════════

_CREATOR_RE = re.compile(r"pid\s+(\d+),\s*(.*)")


class AppleMetalBackend:
    name = "metal"

    def __init__(self):
        if platform.system() != "Darwin":
            raise RuntimeError("Apple Metal backend requires macOS")
        accelerators = self._read_registry()
        if not accelerators:
            raise RuntimeError("No IOAccelerator (GPU) entries found")

        self.metal_support = None
        self.vendor = None
        self._read_display_profile()

        self.macos_version = platform.mac_ver()[0] or None
        self.apple_silicon = platform.machine() == "arm64"
        self.mps_available = self._mps_available()

        # pid -> (accumulated GPU ns, sample wall-clock ns) per accelerator
        self._prev_gpu_time = {}

        self.total_memory_mb = (
            int(psutil.virtual_memory().total / MB) if HAS_PSUTIL else None
        )
        logger.info(
            "Apple GPU backend initialized: %d accelerator(s), %s, MPS %s",
            len(accelerators), self.metal_support or "Metal",
            "available" if self.mps_available else "unavailable",
        )

    # -- static helpers -------------------------------------------------

    @staticmethod
    def _read_registry():
        try:
            out = subprocess.run(
                ["ioreg", "-a", "-l", "-r", "-c", "IOAccelerator"],
                capture_output=True, timeout=5,
            )
            if out.returncode != 0 or not out.stdout.strip():
                return []
            data = plistlib.loads(out.stdout)
            return data if isinstance(data, list) else [data]
        except Exception as e:
            logger.debug("ioreg read failed: %s", e)
            return []

    def _read_display_profile(self):
        try:
            import json
            out = subprocess.run(
                ["system_profiler", "SPDisplaysDataType", "-json"],
                capture_output=True, text=True, timeout=15,
            )
            entries = json.loads(out.stdout).get("SPDisplaysDataType", [])
        except Exception as e:
            logger.debug("system_profiler failed: %s", e)
            return
        for entry in entries:
            fam = entry.get("spdisplays_mtlgpufamilysupport") or entry.get("spdisplays_metal")
            if fam:
                # e.g. "spdisplays_metal4" -> "Metal 4"
                m = re.search(r"metal(\d+)", fam.lower())
                self.metal_support = f"Metal {m.group(1)}" if m else "Metal"
            vendor = entry.get("spdisplays_vendor", "")
            if "apple" in vendor.lower():
                self.vendor = "Apple"
            if self.metal_support:
                break

    def _mps_available(self):
        # MPS (as used by PyTorch & co.) requires Metal-capable GPU and macOS 12.3+.
        if not self.metal_support or not self.macos_version:
            return False
        try:
            parts = [int(x) for x in self.macos_version.split(".")[:2]]
            while len(parts) < 2:
                parts.append(0)
            return tuple(parts) >= (12, 3)
        except ValueError:
            return False

    @staticmethod
    def _collect_clients(node, out):
        if "IOUserClientCreator" in node:
            out.append(node)
        for child in node.get("IORegistryEntryChildren", []) or []:
            AppleMetalBackend._collect_clients(child, out)

    def info(self):
        return {
            "metal_support": self.metal_support,
            "mps_available": self.mps_available,
        }

    # -- sampling -------------------------------------------------------

    def _processes(self, acc_index, accelerator, now_ns):
        clients = []
        self._collect_clients(accelerator, clients)

        per_pid = {}
        for c in clients:
            usage = c.get("AppUsage") or []
            if not usage:
                continue
            m = _CREATOR_RE.match(str(c.get("IOUserClientCreator", "")))
            if not m:
                continue
            pid = int(m.group(1))
            entry = per_pid.setdefault(pid, {"creator": m.group(2).strip(), "gpu_ns": 0, "apis": set()})
            for u in usage:
                entry["gpu_ns"] += int(u.get("accumulatedGPUTime", 0) or 0)
                if u.get("API"):
                    entry["apis"].add(str(u["API"]))

        prev = self._prev_gpu_time.get(acc_index, {})
        current = {}
        processes = []
        for pid, entry in per_pid.items():
            current[pid] = (entry["gpu_ns"], now_ns)
            gpu_percent = None
            if pid in prev:
                prev_ns, prev_t = prev[pid]
                dt = now_ns - prev_t
                delta = entry["gpu_ns"] - prev_ns
                if dt > 0 and delta >= 0:
                    gpu_percent = round(min(100.0, delta / dt * 100.0), 1)
            processes.append({
                "pid": pid,
                "name": _process_display_name(pid, entry["creator"]),
                "type": "/".join(sorted(entry["apis"])) or "Metal",
                "used_memory": None,   # not exposed per-process on macOS
                "gpu_percent": gpu_percent,
            })
        self._prev_gpu_time[acc_index] = current
        processes.sort(key=lambda p: (p["gpu_percent"] or 0.0), reverse=True)
        return processes

    def get_gpus(self):
        now_ns = time.monotonic_ns()
        gpus = []
        for i, acc in enumerate(self._read_registry()):
            stats = acc.get("PerformanceStatistics") or {}

            def pct(key):
                v = stats.get(key)
                return int(v) if isinstance(v, (int, float)) else None

            in_use = stats.get("In use system memory")
            mem_used = int(in_use / MB) if isinstance(in_use, (int, float)) else None
            mem_total = self.total_memory_mb
            mem_free = mem_total - mem_used if mem_total is not None and mem_used is not None else None
            mem_util = (
                int(mem_used / mem_total * 100)
                if mem_total and mem_used is not None else None
            )

            name = acc.get("model") or acc.get("IOClass") or f"Apple GPU {i}"
            if isinstance(name, bytes):
                name = name.decode(errors="ignore").strip("\x00")
            cores = acc.get("gpu-core-count")
            reg_id = acc.get("IORegistryEntryID")

            gpus.append({
                "index": i,
                "name": name,
                "uuid": f"{acc.get('IOClass', 'IOAccelerator')}-{reg_id}" if reg_id else f"apple-gpu-{i}",
                "vendor": self.vendor or "Apple",
                "backend": self.name,
                "memory_kind": "unified" if self.apple_silicon else "dedicated",
                "core_count": int(cores) if isinstance(cores, int) else None,
                "gpu_util": pct("Device Utilization %"),
                "renderer_util": pct("Renderer Utilization %"),
                "tiler_util": pct("Tiler Utilization %"),
                "mem_util": mem_util,
                "mem_total": mem_total,
                "mem_used": mem_used,
                "mem_free": mem_free,
                # Not readable without root (powermetrics / SMC) -> not reported.
                "temperature": None,
                "fan_speed": None,
                "power_draw": None,
                "power_limit": None,
                "process_metric": "gpu_time",
                "processes": self._processes(i, acc, now_ns),
            })
        return gpus

    def shutdown(self):
        pass


# ═══════════════════════════════════════════════════════════════════
#  Facade
# ═══════════════════════════════════════════════════════════════════

class GPUMonitor:
    def __init__(self):
        self.backend = None
        system = platform.system()
        candidates = [AppleMetalBackend] if system == "Darwin" else [NvidiaBackend]
        for cls in candidates:
            try:
                self.backend = cls()
                break
            except Exception as e:
                logger.info("GPU backend '%s' unavailable: %s", cls.name, e)
        if self.backend is None:
            logger.info("No supported GPU detected. GPU telemetry disabled.")

    @property
    def backend_name(self):
        return self.backend.name if self.backend else None

    def info(self):
        base = {
            "gpu_backend": self.backend_name,
            "driver_version": None,
            "cuda_version": None,
            "metal_support": None,
            "mps_available": None,
        }
        if self.backend:
            base.update(self.backend.info())
        return base

    def get_gpu_data(self):
        gpus = []
        if self.backend:
            try:
                gpus = self.backend.get_gpus()
            except Exception as e:
                logger.error("Failed to read GPU telemetry: %s", e)
        return {**self.info(), "gpus": gpus, "timestamp": time.time()}

    def __del__(self):
        if self.backend:
            self.backend.shutdown()
