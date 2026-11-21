import time
import os
import re
import platform
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("SystemMonitor")

import psutil

from platform_info import detect_platform

# Host's /etc/hostname, bind-mounted read-only by docker-compose.yml. Inside a
# container platform.node() returns the container ID, not the machine name.
HOST_HOSTNAME_FILE = "/host/etc/hostname"


def get_host_hostname():
    try:
        with open(HOST_HOSTNAME_FILE, "r") as f:
            name = f.read().strip()
            if name:
                return name
    except OSError:
        pass
    return platform.node()


def parse_block_mounts(lines):
    """(device, mountpoint, fstype) for /proc/*/mounts lines backed by a real block device, one per device."""
    seen, out = set(), []
    for line in lines:
        dev, mp, fstype = line.split()[:3]
        # shortcut: only /dev block devices (drops snap loops, tmpfs, overlay, NFS, ZFS datasets); widen if those matter
        if not dev.startswith("/dev/") or dev.startswith("/dev/loop") or dev in seen:
            continue
        seen.add(dev)  # first mount wins: "/" before its bind mounts / btrfs subvolumes
        out.append((dev, re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), mp), fstype))
    return out


assert parse_block_mounts([
    "overlay / overlay rw 0 0",
    "/dev/sda2 / ext4 rw 0 0",
    "/dev/sda2 /etc/hosts ext4 rw 0 0",
    "/dev/loop3 /snap/core/1 squashfs ro 0 0",
    "tmpfs /run tmpfs rw 0 0",
    "/dev/sdb1 /media/me/MY\\040USB vfat rw 0 0",
]) == [("/dev/sda2", "/", "ext4"), ("/dev/sdb1", "/media/me/MY USB", "vfat")]


class SystemMonitor:
    def __init__(self):
        self.hostname = get_host_hostname()
        self.platform = detect_platform()
        self.is_linux = self.platform["os"] == "Linux"

    # ── CPU ────────────────────────────────────────────────────────

    def get_cpu_data(self):
        try:
            # Call cpu_percent once with a short interval to prime the counter,
            # then read the real value.
            psutil.cpu_percent(interval=0)
            time.sleep(0.1)
            percent = psutil.cpu_percent(interval=0)
            per_core = psutil.cpu_percent(interval=0, percpu=True)
            freq = None
            try:
                freq = psutil.cpu_freq()
            except Exception:
                pass  # not exposed on some platforms (e.g. certain Apple Silicon builds)

            load_avg = [0.0, 0.0, 0.0]
            try:
                load_avg = list(os.getloadavg())
            except (OSError, AttributeError):
                pass

            # Temperature (Linux-specific via psutil)
            temperature = None
            try:
                temps = psutil.sensors_temperatures()
                if temps:
                    for name in ["coretemp", "k10temp", "cpu_thermal", "acpitz", "cpu-pci-00"]:
                        if name in temps and temps[name]:
                            temperature = temps[name][0].current
                            break
                    if temperature is None:
                        first_key = list(temps.keys())[0]
                        if temps[first_key]:
                            temperature = temps[first_key][0].current
            except (AttributeError, Exception):
                pass

            return {
                "percent": round(percent, 1),
                "per_core": [round(c, 1) for c in per_core],
                "count_logical": psutil.cpu_count(logical=True) or 0,
                "count_physical": psutil.cpu_count(logical=False) or 0,
                "frequency_current": round(freq.current, 0) if freq and freq.current else None,
                "frequency_max": round(freq.max, 0) if freq and freq.max else None,
                "temperature": round(temperature, 1) if temperature is not None else None,
                "load_avg": [round(l, 2) for l in load_avg],
            }
        except Exception as e:
            logger.error(f"Failed to get CPU data: {e}")
            return {
                "percent": 0,
                "per_core": [],
                "count_logical": 0,
                "count_physical": 0,
                "frequency_current": None,
                "frequency_max": None,
                "temperature": None,
                "load_avg": [0.0, 0.0, 0.0],
            }

    # ── Memory ─────────────────────────────────────────────────────

    def get_memory_data(self):
        try:
            mem = psutil.virtual_memory()
            swap = psutil.swap_memory()
            return {
                "total": round(mem.total / (1024 * 1024)),          # MB
                "used": round(mem.used / (1024 * 1024)),
                "available": round(mem.available / (1024 * 1024)),
                "percent": round(mem.percent, 1),
                "swap_total": round(swap.total / (1024 * 1024)),
                "swap_used": round(swap.used / (1024 * 1024)),
                "swap_percent": round(swap.percent, 1),
            }
        except Exception as e:
            logger.error(f"Failed to get memory data: {e}")
            return {
                "total": 0, "used": 0, "available": 0, "percent": 0,
                "swap_total": 0, "swap_used": 0, "swap_percent": 0,
            }

    # ── Disk ───────────────────────────────────────────────────────

    def _list_partitions(self):
        """(device, mountpoint, fstype, path to stat) for each user-facing volume."""
        os_name = self.platform["os"]
        if os_name == "Linux":
            # docker-compose runs us with pid: host, so /proc/1 is the host's init:
            # read the host mount table and stat through its root to see host disks/USB.
            root = ""
            if self.platform["in_container"]:
                try:
                    os.listdir("/proc/1/root")
                    root = "/proc/1/root"
                except OSError:
                    pass
            with open("/proc/1/mounts" if root else "/proc/self/mounts") as f:
                return [(dev, mp, fs, root + mp) for dev, mp, fs in parse_block_mounts(f)]

        parts = psutil.disk_partitions(all=False)
        if os_name == "macOS":
            # APFS system volumes (sealed /, Preboot, VM...) share the Data volume's space;
            # external and USB disks mount under /Volumes.
            parts = [p for p in parts
                     if p.mountpoint == "/System/Volumes/Data" or p.mountpoint.startswith("/Volumes/")]
        return [(p.device, p.mountpoint, p.fstype, p.mountpoint) for p in parts]

    def get_disk_data(self):
        disks = []
        try:
            for device, mountpoint, fstype, path in self._list_partitions():
                try:
                    usage = psutil.disk_usage(path)
                    disks.append({
                        "device": device,
                        "mountpoint": mountpoint,
                        "fstype": fstype,
                        "total": round(usage.total / (1024 * 1024)),
                        "used": round(usage.used / (1024 * 1024)),
                        "free": round(usage.free / (1024 * 1024)),
                        "percent": round(usage.percent, 1),
                    })
                except OSError:  # access denied, or removable drive with no media
                    continue
        except Exception as e:
            logger.error(f"Failed to get disk data: {e}")

        # Put the volume that actually holds user data first (used by the overview card).
        os_name = self.platform["os"]
        primary = {"macOS": "/System/Volumes/Data", "Linux": "/"}.get(os_name)
        if os_name == "Windows":
            primary = (os.environ.get("SystemDrive", "C:") + "\\").upper()
        disks.sort(key=lambda d: 0 if d["mountpoint"].upper() == (primary or "").upper() else 1)

        io_data = {}
        try:
            io = psutil.disk_io_counters()
            if io:
                io_data = {
                    "read_bytes": io.read_bytes,
                    "write_bytes": io.write_bytes,
                    "read_count": io.read_count,
                    "write_count": io.write_count,
                }
        except Exception:
            pass

        return {"partitions": disks, "io": io_data}

    # ── Network ────────────────────────────────────────────────────

    def get_network_data(self):
        try:
            net = psutil.net_io_counters()
            return {
                "bytes_sent": net.bytes_sent,
                "bytes_recv": net.bytes_recv,
                "packets_sent": net.packets_sent,
                "packets_recv": net.packets_recv,
            }
        except Exception as e:
            logger.error(f"Failed to get network data: {e}")
            return {}

    # ── Uptime ─────────────────────────────────────────────────────

    def get_uptime(self):
        try:
            boot_time = psutil.boot_time()
            return int(time.time() - boot_time)
        except Exception:
            return 0

    # ── Processes ──────────────────────────────────────────────────

    _PROC_ATTRS = [
        'pid', 'ppid', 'name', 'username', 'cpu_percent', 'memory_info',
        'memory_percent', 'status', 'cmdline', 'terminal',
    ]
    _SCRIPT_HOSTS = ("python", "node", "bash", "sh", "zsh", "perl", "ruby", "java", "deno", "bun")

    def get_processes_data(self):
        """All processes visible to this user, including background ones.

        ``background`` is True when a process has no controlling terminal
        (daemons, launchd/systemd services, nohup'd or detached jobs).
        """
        processes = []
        try:
            for p in psutil.process_iter(self._PROC_ATTRS):
                try:
                    info = p.info
                    pid = info['pid']
                    ppid = info.get('ppid') or 0
                    cmdline = info.get('cmdline') or []
                    name = info.get('name') or "Unknown"

                    # Skip Linux kernel threads (children of kthreadd, no cmdline).
                    if self.is_linux and (pid <= 2 or ppid == 2):
                        continue
                    if pid == 0:
                        continue

                    user = info.get('username') or "unknown"
                    if user.isdigit():
                        try:
                            import pwd
                            user = pwd.getpwuid(int(user)).pw_name
                        except Exception:
                            pass

                    if cmdline:
                        full_cmd = " ".join(cmdline)
                        display_cmd = full_cmd if len(full_cmd) <= 160 else full_cmd[:157] + "..."
                    else:
                        display_cmd = name

                    display_name = name
                    if name.startswith(self._SCRIPT_HOSTS) and len(cmdline) > 1:
                        args = [a for a in cmdline[1:] if not a.startswith("-")]
                        if args:
                            display_name = f"{name} {os.path.basename(args[0])}"

                    mem_info = info.get('memory_info')
                    processes.append({
                        "pid": pid,
                        "name": display_name,
                        "command": display_cmd,
                        "user": user,
                        "cpu_percent": round(info.get('cpu_percent') or 0.0, 1),
                        "memory_mb": round(mem_info.rss / (1024 * 1024), 1) if mem_info else 0.0,
                        "memory_percent": round(info.get('memory_percent') or 0.0, 1),
                        "status": info.get('status') or "unknown",
                        "background": info.get('terminal') is None,
                    })
                except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                    continue

            processes.sort(key=lambda x: (x["cpu_percent"], x["memory_mb"]), reverse=True)
            return processes
        except Exception as e:
            logger.error(f"Failed to get system processes: {e}")
            return []

    # ── Combined ───────────────────────────────────────────────────

    def get_full_system_data(self):
        return {
            "cpu": self.get_cpu_data(),
            "memory": self.get_memory_data(),
            "disk": self.get_disk_data(),
            "network": self.get_network_data(),
            "processes": self.get_processes_data(),
            "uptime": self.get_uptime(),
            "hostname": self.hostname,
            "platform": self.platform["os"],
            "platform_info": self.platform,
        }
