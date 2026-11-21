"""Host platform / device detection.

Everything reported here is read from the running system. Values that cannot
be determined are reported as ``None`` instead of being guessed.
"""

import logging
import os
import platform
import subprocess

logger = logging.getLogger("PlatformInfo")

_OS_NAMES = {
    "Linux": "Linux",
    "Darwin": "macOS",
    "Windows": "Windows",
}


def _run(cmd, timeout=3.0):
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if out.returncode == 0:
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    return None


def _in_container():
    if os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv"):
        return True
    try:
        with open("/proc/1/cgroup", "r") as f:
            content = f.read()
        return any(k in content for k in ("docker", "containerd", "kubepods", "libpod"))
    except OSError:
        return False


def _linux_distro():
    try:
        with open("/etc/os-release", "r") as f:
            fields = dict(
                line.rstrip("\n").split("=", 1) for line in f if "=" in line
            )
        return fields.get("PRETTY_NAME", "").strip('"') or None
    except OSError:
        return None


def _linux_cpu_model():
    try:
        with open("/proc/cpuinfo", "r") as f:
            for line in f:
                if line.lower().startswith(("model name", "hardware", "cpu model")):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return None


def _linux_device_model():
    for path in ("/sys/devices/virtual/dmi/id/product_name", "/proc/device-tree/model"):
        try:
            with open(path, "r") as f:
                value = f.read().strip("\x00\n ")
            if value:
                return value
        except OSError:
            continue
    return None


def detect_platform():
    system = platform.system()
    os_name = _OS_NAMES.get(system, system or "Unknown")
    info = {
        "os": os_name,                  # Linux / macOS / Windows
        "os_version": None,             # e.g. "15.1", "Ubuntu 22.04.4 LTS", "10.0.22631"
        "kernel": platform.release() or None,
        "arch": platform.machine() or None,
        "device_model": None,           # e.g. "Mac14,6", "ThinkPad X1"
        "cpu_model": None,              # e.g. "Apple M2 Max"
        "apple_silicon": False,
        "in_container": False,
    }

    if os_name == "macOS":
        info["os_version"] = platform.mac_ver()[0] or None
        info["device_model"] = _run(["sysctl", "-n", "hw.model"])
        info["cpu_model"] = _run(["sysctl", "-n", "machdep.cpu.brand_string"])
        info["apple_silicon"] = info["arch"] == "arm64"
    elif os_name == "Linux":
        info["os_version"] = _linux_distro()
        info["cpu_model"] = _linux_cpu_model()
        info["device_model"] = _linux_device_model()
        info["in_container"] = _in_container()
    elif os_name == "Windows":
        info["os_version"] = platform.version() or None
        info["cpu_model"] = platform.processor() or None

    logger.info(
        "Detected platform: %s %s (%s)%s",
        info["os"], info["os_version"] or "", info["arch"],
        " [container]" if info["in_container"] else "",
    )
    return info
