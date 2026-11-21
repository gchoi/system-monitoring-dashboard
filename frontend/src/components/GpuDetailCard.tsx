'use client';

import React from 'react';
import { Activity, Database, Thermometer, Zap, Wind, Cpu } from 'lucide-react';
import { GpuData } from '../types/gpu';
import styles from './GpuDetailCard.module.css';

interface GpuDetailCardProps {
  gpu: GpuData;
}

export default function GpuDetailCard({ gpu }: GpuDetailCardProps) {
  const formatMemory = (megabytes: number) => {
    if (megabytes >= 1024) {
      return `${(megabytes / 1024).toFixed(1)} GB`;
    }
    return `${megabytes} MB`;
  };

  const isUnified = gpu.memory_kind === 'unified';
  const subtitle = [
    gpu.vendor,
    gpu.core_count != null ? `${gpu.core_count}-core GPU` : null,
    isUnified ? 'Unified memory' : null,
    gpu.backend === 'metal' ? 'Metal' : 'NVML',
  ]
    .filter(Boolean)
    .join(' · ');

  const powerPercent =
    gpu.power_draw != null && gpu.power_limit
      ? Math.min(100, (gpu.power_draw / gpu.power_limit) * 100)
      : null;

  return (
    <section className={styles.detailCard}>
      <div className={styles.titleHeader}>
        <h2 className={styles.deviceTitle}>{gpu.name}</h2>
        <span className={styles.deviceUuid}>{subtitle}</span>
      </div>

      <div className={styles.grid}>
        {/* GPU Core Utilization */}
        {gpu.gpu_util != null && (
          <div className={styles.metricBlock}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>GPU Utilization</span>
              <div className={styles.iconWrapper} style={{ color: 'var(--accent-cyan)' }}>
                <Activity size={18} />
              </div>
            </div>
            <div>
              <span className={styles.metricValue}>{gpu.gpu_util}</span>
              <span className={styles.metricUnit}>%</span>
            </div>
            <div className={styles.progressContainer}>
              <div
                className={`${styles.progressBar} ${styles.barCyan}`}
                style={{ width: `${gpu.gpu_util}%` }}
              />
            </div>
            <div className={styles.subText}>
              <span>{gpu.backend === 'metal' ? 'Device (Metal / MPS)' : 'Core Usage'}</span>
              <span>100% Max</span>
            </div>
          </div>
        )}

        {/* Apple: renderer / tiler pipeline utilization */}
        {(gpu.renderer_util != null || gpu.tiler_util != null) && (
          <div className={styles.metricBlock}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>Renderer / Tiler</span>
              <div className={styles.iconWrapper} style={{ color: 'var(--accent-blue)' }}>
                <Cpu size={18} />
              </div>
            </div>
            <div>
              <span className={styles.metricValue}>{gpu.renderer_util ?? '—'}</span>
              <span className={styles.metricUnit}>%</span>
            </div>
            <div className={styles.progressContainer}>
              <div
                className={`${styles.progressBar} ${styles.barCyan}`}
                style={{ width: `${gpu.renderer_util ?? 0}%` }}
              />
            </div>
            <div className={styles.subText}>
              <span>Renderer</span>
              {gpu.tiler_util != null && <span>Tiler {gpu.tiler_util}%</span>}
            </div>
          </div>
        )}

        {/* GPU Memory */}
        {gpu.mem_used != null && (
          <div className={styles.metricBlock}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>{isUnified ? 'GPU Memory (Unified)' : 'VRAM Memory'}</span>
              <div className={styles.iconWrapper} style={{ color: 'var(--accent-purple)' }}>
                <Database size={18} />
              </div>
            </div>
            <div>
              {isUnified ? (
                <>
                  <span className={styles.metricValue}>
                    {gpu.mem_used >= 1024 ? (gpu.mem_used / 1024).toFixed(1) : gpu.mem_used}
                  </span>
                  <span className={styles.metricUnit}>{gpu.mem_used >= 1024 ? 'GB' : 'MB'}</span>
                </>
              ) : (
                <>
                  <span className={styles.metricValue}>{gpu.mem_util ?? '—'}</span>
                  <span className={styles.metricUnit}>%</span>
                </>
              )}
            </div>
            <div className={styles.progressContainer}>
              <div
                className={`${styles.progressBar} ${styles.barPurple}`}
                style={{ width: `${gpu.mem_util ?? 0}%` }}
              />
            </div>
            <div className={styles.subText}>
              <span>{isUnified ? 'In use by GPU' : `${formatMemory(gpu.mem_used)} used`}</span>
              {gpu.mem_total != null && (
                <span>{formatMemory(gpu.mem_total)} {isUnified ? 'system' : 'total'}</span>
              )}
            </div>
          </div>
        )}

        {/* Temperature / Fan Speed */}
        {gpu.temperature != null && (
          <div className={styles.metricBlock}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>Temperature</span>
              <div
                className={styles.iconWrapper}
                style={{ color: gpu.temperature >= 75 ? 'var(--accent-orange)' : 'var(--accent-green)' }}
              >
                <Thermometer size={18} />
              </div>
            </div>
            <div>
              <span className={styles.metricValue}>{gpu.temperature}</span>
              <span className={styles.metricUnit}>°C</span>
            </div>
            <div className={styles.progressContainer}>
              <div
                className={`${styles.progressBar} ${gpu.temperature >= 80 ? styles.barOrange : styles.barGreen}`}
                style={{ width: `${Math.min(100, gpu.temperature)}%` }}
              />
            </div>
            {gpu.fan_speed != null && (
              <div className={styles.subText}>
                <span>Fan Speed</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Wind size={10} /> {gpu.fan_speed}%
                </span>
              </div>
            )}
          </div>
        )}

        {/* Power Draw */}
        {gpu.power_draw != null && (
          <div className={styles.metricBlock}>
            <div className={styles.metricHeader}>
              <span className={styles.metricTitle}>Power Draw</span>
              <div className={styles.iconWrapper} style={{ color: 'var(--accent-orange)' }}>
                <Zap size={18} />
              </div>
            </div>
            <div>
              <span className={styles.metricValue}>{gpu.power_draw}</span>
              <span className={styles.metricUnit}>W</span>
            </div>
            {powerPercent != null && (
              <div className={styles.progressContainer}>
                <div className={`${styles.progressBar} ${styles.barOrange}`} style={{ width: `${powerPercent}%` }} />
              </div>
            )}
            <div className={styles.subText}>
              <span>Active draw</span>
              {gpu.power_limit != null && <span>Limit: {gpu.power_limit} W</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
