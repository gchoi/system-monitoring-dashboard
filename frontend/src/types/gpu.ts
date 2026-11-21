export interface GpuProcess {
  pid: number;
  name: string;
  type: string;                 // Graphics / Compute / C+G (NVIDIA), Metal (Apple)
  used_memory: number | null;   // MB — null when the platform does not expose it (macOS)
  gpu_percent: number | null;   // share of GPU time — Apple only, null on the first sample
}

export interface SystemProcess {
  pid: number;
  name: string;
  command: string;
  user: string;
  cpu_percent: number;
  memory_mb: number;
  memory_percent: number;
  status: string;
  background?: boolean;         // no controlling terminal (daemon / service / nohup / detached)
}

export type GpuBackend = 'nvml' | 'metal';

// Every metric is nullable: null means "not exposed on this platform" and is not rendered.
export interface GpuData {
  index: number;
  name: string;
  uuid: string;
  vendor: string;
  backend: GpuBackend;
  memory_kind: 'dedicated' | 'unified';
  core_count: number | null;
  gpu_util: number | null;
  renderer_util: number | null;
  tiler_util: number | null;
  mem_util: number | null;
  mem_total: number | null;
  mem_used: number | null;
  mem_free: number | null;
  temperature: number | null;
  fan_speed: number | null;
  power_draw: number | null;
  power_limit: number | null;
  process_metric: 'memory' | 'gpu_time';
  processes: GpuProcess[];
}

export interface CpuData {
  percent: number;
  per_core: number[];
  count_logical: number;
  count_physical: number;
  frequency_current: number | null;
  frequency_max: number | null;
  temperature: number | null;
  load_avg: number[];
}

export interface MemoryData {
  total: number;      // MB
  used: number;       // MB
  available: number;  // MB
  percent: number;
  swap_total: number; // MB
  swap_used: number;  // MB
  swap_percent: number;
}

export interface DiskPartition {
  device: string;
  mountpoint: string;
  fstype: string;
  total: number;   // MB
  used: number;    // MB
  free: number;    // MB
  percent: number;
}

export interface DiskIo {
  read_bytes: number;
  write_bytes: number;
  read_count: number;
  write_count: number;
}

export interface DiskData {
  partitions: DiskPartition[];
  io: DiskIo;
}

export interface NetworkData {
  bytes_sent: number;
  bytes_recv: number;
  packets_sent: number;
  packets_recv: number;
}

export interface SystemData {
  cpu: CpuData;
  memory: MemoryData;
  disk: DiskData;
  network: NetworkData;
  processes?: SystemProcess[];
  uptime: number;         // seconds
  platform: PlatformOs;
  platform_info: PlatformInfo;
  hostname: string;
}

export type PlatformOs = 'Linux' | 'macOS' | 'Windows' | string;

export interface PlatformInfo {
  os: PlatformOs;
  os_version: string | null;
  kernel: string | null;
  arch: string | null;
  device_model: string | null;
  cpu_model: string | null;
  apple_silicon: boolean;
  in_container: boolean;
}

export interface TelemetryData {
  gpu_backend: GpuBackend | null;
  driver_version: string | null;   // NVIDIA
  cuda_version: string | null;     // NVIDIA
  metal_support: string | null;    // Apple, e.g. "Metal 4"
  mps_available: boolean | null;   // Apple, Metal Performance Shaders
  gpus: GpuData[];
  system: SystemData;
  timestamp: number;
}
