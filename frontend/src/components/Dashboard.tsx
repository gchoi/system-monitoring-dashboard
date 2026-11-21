'use client';

import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, AlertTriangle, Layers, Server, ListTree } from 'lucide-react';
import AppLogo from './AppLogo';
import styles from './Dashboard.module.css';
import SystemOverview from './SystemOverview';
import ThemeControl from './ThemeControl';
import LoadingState from './LoadingState';
import SystemCharts, { SystemHistoryItem } from './SystemCharts';
import GpuCard from './GpuCard';
import GpuDetailCard from './GpuDetailCard';
import RealtimeChart from './RealtimeChart';
import ProcessTable from './ProcessTable';
import { TelemetryData, PlatformInfo } from '../types/gpu';

const formatPlatform = (p: PlatformInfo) => {
  const parts = [p.os];
  if (p.os_version) parts.push(p.os_version);
  let label = parts.join(' ');
  if (p.arch) label += ` · ${p.arch}`;
  if (p.in_container) label += ' (container)';
  return label;
};

export interface HistoryItem {
  time: string;
  gpuUtil: number | null;
  memUtil: number | null;
}

export default function Dashboard() {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [selectedGpuIndex, setSelectedGpuIndex] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('connecting');
  const [errorCount, setErrorCount] = useState<number>(0);

  // Rolling history for GPU
  const [gpuHistory, setGpuHistory] = useState<Record<number, HistoryItem[]>>({});
  // Rolling history for system (CPU & Memory)
  const [systemHistory, setSystemHistory] = useState<SystemHistoryItem[]>([]);

  const [backendPort, setBackendPort] = useState<string>('');
  const [wsUrl, setWsUrl] = useState<string>('');

  const backendPortRef = useRef<string>('');
  const wsUrlRef = useRef<string>('');
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);

  const getWsUrl = () => {
    if (wsUrlRef.current) {
      return wsUrlRef.current;
    }
    if (process.env.NEXT_PUBLIC_WS_URL) {
      return process.env.NEXT_PUBLIC_WS_URL;
    }
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws';
    const port = backendPortRef.current || process.env.NEXT_PUBLIC_BACKEND_PORT || '8000';
    return `${protocol}://${host}:${port}/ws`;
  };

  const connect = async () => {
    setConnectionStatus('connecting');
    if (ws.current) {
      ws.current.close();
    }

    try {
      const res = await fetch('/api/config');
      if (res.ok) {
        const cfg = await res.json();
        if (cfg.backendPort) {
          backendPortRef.current = String(cfg.backendPort);
          setBackendPort(String(cfg.backendPort));
        }
        if (cfg.wsUrl) {
          wsUrlRef.current = cfg.wsUrl;
          setWsUrl(cfg.wsUrl);
        }
      }
    } catch {
      // fallback
    }

    const currentWsUrl = getWsUrl();
    console.log(`Connecting to WebSocket: ${currentWsUrl}`);

    const socket = new WebSocket(currentWsUrl);
    ws.current = socket;

    socket.onopen = () => {
      console.log('WebSocket connected');
      setConnectionStatus('connected');
      setErrorCount(0);
    };

    socket.onmessage = (event) => {
      try {
        const data: TelemetryData = JSON.parse(event.data);
        setTelemetry(data);

        const timeStr = new Date(data.timestamp * 1000).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });

        // Update GPU history for each GPU
        setGpuHistory((prevHistory) => {
          const updated = { ...prevHistory };
          data.gpus.forEach((gpu) => {
            const currentHistory = updated[gpu.index] || [];
            const newItem: HistoryItem = {
              time: timeStr,
              gpuUtil: gpu.gpu_util,
              memUtil: gpu.mem_util,
            };
            updated[gpu.index] = [...currentHistory, newItem].slice(-30);
          });
          return updated;
        });

        // Update system history
        setSystemHistory((prev) => {
          const newItem: SystemHistoryItem = {
            time: timeStr,
            cpu: data.system.cpu.percent,
            memory: data.system.memory.percent,
          };
          return [...prev, newItem].slice(-30);
        });
      } catch (err) {
        console.error('Failed to parse WebSocket message', err);
      }
    };

    socket.onclose = (event) => {
      console.log(`WebSocket closed: ${event.reason} (code: ${event.code})`);
      setConnectionStatus('disconnected');

      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = setTimeout(() => {
        setErrorCount((c) => c + 1);
        connect();
      }, 3000);
    };

    socket.onerror = (err) => {
      console.error('WebSocket error occurred:', err);
      setConnectionStatus('disconnected');
    };
  };

  useEffect(() => {
    connect();
    return () => {
      if (ws.current) ws.current.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, []);

  const handleRetry = () => {
    setErrorCount(0);
    connect();
  };

  const activeGpu = telemetry?.gpus.find((g) => g.index === selectedGpuIndex) || telemetry?.gpus[0];
  const activeHistory = activeGpu ? gpuHistory[activeGpu.index] || [] : [];

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  return (
    <div className={styles.container}>
      {/* ── Header ───────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <AppLogo size={34} />
          <h1 className={styles.title}>
            System <span style={{ color: 'var(--accent-blue)' }}>Monitor</span>
          </h1>
        </div>

        <div className={styles.headerControls}>
          {telemetry && (
            <div className={styles.systemInfo}>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Host</span>
                <span className={styles.infoValueMono}>{telemetry.system.hostname}</span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Platform</span>
                <span className={styles.infoValueMono}>{formatPlatform(telemetry.system.platform_info)}</span>
              </div>
              {(telemetry.system.platform_info.cpu_model || telemetry.system.platform_info.device_model) && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Device</span>
                  <span className={styles.infoValueMono}>
                    {[telemetry.system.platform_info.cpu_model, telemetry.system.platform_info.device_model]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.infoLabel}>Uptime</span>
                <span className={styles.infoValueMono}>{formatUptime(telemetry.system.uptime)}</span>
              </div>
              {telemetry.driver_version && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Driver</span>
                  <span className={styles.infoValueMono}>{telemetry.driver_version}</span>
                </div>
              )}
              {telemetry.cuda_version && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>CUDA</span>
                  <span className={styles.infoValueMono}>{telemetry.cuda_version}</span>
                </div>
              )}
              {telemetry.metal_support && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>Metal</span>
                  <span className={styles.infoValueMono}>{telemetry.metal_support}</span>
                </div>
              )}
              {telemetry.mps_available != null && (
                <div className={styles.infoItem}>
                  <span className={styles.infoLabel}>MPS</span>
                  <span className={styles.infoValueMono}>{telemetry.mps_available ? 'Available' : 'Unavailable'}</span>
                </div>
              )}
            </div>
          )}

          <ThemeControl />
          <div className={styles.connectionStatus}>
            <span className={`pulse-dot ${
              connectionStatus === 'connected' ? '' :
              connectionStatus === 'connecting' ? 'connecting' : 'disconnected'
            }`} />
            <span>{connectionStatus}</span>
          </div>
        </div>
      </header>

      {!telemetry && !(connectionStatus === 'disconnected' && errorCount > 2) && (
        <LoadingState />
      )}

      {/* ── Connection Failure ───────────────────────────────── */}
      {connectionStatus === 'disconnected' && errorCount > 2 && !telemetry && (
        <div className={styles.errorPanel}>
          <AlertTriangle size={48} style={{ color: 'var(--accent-red)' }} />
          <h2 className={styles.errorTitle}>API Server Unreachable</h2>
          <p className={styles.errorDesc}>
            Failed to connect to the backend WebSocket stream. Ensure the python API server is running at{' '}
            <code>{getWsUrl()}</code> and is accessible.
          </p>
          <button className={styles.retryBtn} onClick={handleRetry}>
            <RefreshCw size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
            Retry Connection
          </button>
        </div>
      )}

      {/* ── Main Content ─────────────────────────────────────── */}
      {telemetry && (
        <>
          {/* System Overview Cards */}
          <section>
            <h2 className={styles.sectionTitle}>
              <Server size={14} /> System Overview
            </h2>
            <SystemOverview system={telemetry.system} />
          </section>

          {/* System Charts */}
          <section>
            <SystemCharts cpuHistory={systemHistory} memoryHistory={systemHistory} />
          </section>

          {/* GPU Section — rendered only when a supported GPU was detected */}
          {telemetry.gpus.length > 0 && (
            <section>
              <h2 className={styles.sectionTitle}>
                <Layers size={14} />
                {telemetry.gpu_backend === 'metal' ? 'Apple GPU — Metal / MPS' : 'GPU Devices'} ({telemetry.gpus.length})
              </h2>
              <div className={styles.grid}>
                <aside className={styles.sidebar}>
                  <div className={styles.gpuList}>
                    {telemetry.gpus.map((gpu) => (
                      <GpuCard
                        key={gpu.uuid}
                        gpu={gpu}
                        isActive={activeGpu?.index === gpu.index}
                        onClick={() => setSelectedGpuIndex(gpu.index)}
                      />
                    ))}
                  </div>
                </aside>

                {activeGpu && (
                  <div className={styles.mainContent}>
                    <GpuDetailCard gpu={activeGpu} />
                    <div className={styles.chartsGrid}>
                      <RealtimeChart
                        history={activeHistory}
                        gpuName={activeGpu.name}
                        memoryLabel={activeGpu.memory_kind === 'unified' ? 'GPU Mem' : 'VRAM'}
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Processes — always shown (GPU tab only when a GPU is present) */}
          <section>
            <h2 className={styles.sectionTitle}>
              <ListTree size={14} /> Processes
            </h2>
            <ProcessTable
              gpuProcesses={activeGpu ? activeGpu.processes : []}
              gpuProcessMetric={activeGpu?.process_metric}
              showGpuTab={!!activeGpu}
              systemProcesses={telemetry.system.processes || []}
              gpuName={activeGpu?.name}
              backendPort={backendPort}
            />
          </section>
        </>
      )}
    </div>
  );
}
