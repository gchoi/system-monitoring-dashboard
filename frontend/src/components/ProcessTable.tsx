'use client';

import React, { useEffect, useState } from 'react';
import {
  Search,
  ChevronDown,
  ChevronUp,
  Terminal,
  Skull,
  AlertTriangle,
  X,
  CheckCircle,
  Loader2,
  Cpu,
  Layers,
  Server
} from 'lucide-react';
import { GpuProcess, SystemProcess } from '../types/gpu';
import styles from './ProcessTable.module.css';

interface ProcessTableProps {
  gpuProcesses: GpuProcess[];
  gpuProcessMetric?: 'memory' | 'gpu_time';
  showGpuTab?: boolean;
  systemProcesses?: SystemProcess[];
  gpuName?: string;
  backendPort?: string;
}

type TabType = 'gpu' | 'system';
type GpuSortField = 'pid' | 'name' | 'type' | 'used_memory' | 'gpu_percent';
type SysScope = 'all' | 'background' | 'foreground';

const MAX_RENDERED_ROWS = 500;
type SysSortField = 'pid' | 'name' | 'user' | 'cpu_percent' | 'memory_mb' | 'status';
type SortOrder = 'asc' | 'desc';

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

interface TargetProcessInfo {
  pid: number;
  name: string;
  command?: string;
  type?: string;
  user?: string;
  memory?: string;
  cpu?: string;
}

export default function ProcessTable({
  gpuProcesses = [],
  gpuProcessMetric = 'memory',
  showGpuTab = true,
  systemProcesses = [],
  gpuName,
  backendPort,
}: ProcessTableProps) {
  const [activeTab, setActiveTab] = useState<TabType>(showGpuTab ? 'gpu' : 'system');
  const [searchTerm, setSearchTerm] = useState('');
  const [sysScope, setSysScope] = useState<SysScope>('all');

  useEffect(() => {
    if (!showGpuTab && activeTab === 'gpu') setActiveTab('system');
  }, [showGpuTab, activeTab]);

  const gpuMetricField: GpuSortField = gpuProcessMetric === 'gpu_time' ? 'gpu_percent' : 'used_memory';

  // Sort states
  const [gpuSortField, setGpuSortField] = useState<GpuSortField>(gpuMetricField);
  useEffect(() => {
    setGpuSortField((f) => (f === 'used_memory' || f === 'gpu_percent' ? gpuMetricField : f));
  }, [gpuMetricField]);
  const [gpuSortOrder, setGpuSortOrder] = useState<SortOrder>('desc');
  const [sysSortField, setSysSortField] = useState<SysSortField>('cpu_percent');
  const [sysSortOrder, setSysSortOrder] = useState<SortOrder>('desc');

  // Process termination states
  const [selectedProcess, setSelectedProcess] = useState<TargetProcessInfo | null>(null);
  const [forceKill, setForceKill] = useState(false);
  const [isKilling, setIsKilling] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const getApiBaseUrl = () => {
    if (typeof window === 'undefined') return 'http://localhost:8000';
    if (process.env.NEXT_PUBLIC_WS_URL) {
      try {
        const url = new URL(process.env.NEXT_PUBLIC_WS_URL);
        const protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
        return `${protocol}//${url.host}`;
      } catch {
        // fallback
      }
    }
    const protocol = window.location.protocol;
    const host = window.location.hostname;
    const port = backendPort || process.env.NEXT_PUBLIC_BACKEND_PORT || '8000';
    return `${protocol}//${host}:${port}`;
  };

  const handleKillSubmit = async () => {
    if (!selectedProcess) return;
    setIsKilling(true);
    try {
      const baseUrl = getApiBaseUrl();
      const res = await fetch(`${baseUrl}/api/processes/${selectedProcess.pid}/kill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: forceKill }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to terminate process');
      }
      showToast(data.message || `Process ${selectedProcess.name} (PID: ${selectedProcess.pid}) terminated.`, 'success');
      setSelectedProcess(null);
      setForceKill(false);
    } catch (err: any) {
      showToast(err.message || 'Error occurred while terminating process.', 'error');
    } finally {
      setIsKilling(false);
    }
  };

  const handleGpuSort = (field: GpuSortField) => {
    if (gpuSortField === field) {
      setGpuSortOrder(gpuSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setGpuSortField(field);
      setGpuSortOrder('desc');
    }
  };

  const handleSysSort = (field: SysSortField) => {
    if (sysSortField === field) {
      setSysSortOrder(sysSortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSysSortField(field);
      setSysSortOrder('desc');
    }
  };

  // GPU filter & sort
  const filteredGpu = gpuProcesses.filter((proc) => {
    const term = searchTerm.toLowerCase();
    return (
      proc.name.toLowerCase().includes(term) ||
      proc.pid.toString().includes(term) ||
      proc.type.toLowerCase().includes(term)
    );
  });

  const sortedGpu = [...filteredGpu].sort((a, b) => {
    const valA = a[gpuSortField];
    const valB = b[gpuSortField];
    if (typeof valA === 'string' && typeof valB === 'string') {
      return gpuSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    const numA = (valA as number | null) ?? -1;
    const numB = (valB as number | null) ?? -1;
    return gpuSortOrder === 'asc' ? numA - numB : numB - numA;
  });

  // System filter & sort
  const scopedSys = systemProcesses.filter((proc) => {
    if (sysScope === 'background') return proc.background === true;
    if (sysScope === 'foreground') return proc.background === false;
    return true;
  });
  const backgroundCount = systemProcesses.filter((p) => p.background).length;

  const filteredSys = scopedSys.filter((proc) => {
    const term = searchTerm.toLowerCase();
    return (
      proc.name.toLowerCase().includes(term) ||
      proc.command.toLowerCase().includes(term) ||
      proc.user.toLowerCase().includes(term) ||
      proc.pid.toString().includes(term) ||
      proc.status.toLowerCase().includes(term)
    );
  });

  const sortedSys = [...filteredSys].sort((a, b) => {
    const valA = a[sysSortField];
    const valB = b[sysSortField];
    if (typeof valA === 'string' && typeof valB === 'string') {
      return sysSortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sysSortOrder === 'asc'
      ? (valA as number) - (valB as number)
      : (valB as number) - (valA as number);
  });

  const getSortIconGpu = (field: GpuSortField) => {
    if (gpuSortField !== field) return null;
    return gpuSortOrder === 'asc' ? (
      <ChevronUp size={12} style={{ marginLeft: '4px', display: 'inline' }} />
    ) : (
      <ChevronDown size={12} style={{ marginLeft: '4px', display: 'inline' }} />
    );
  };

  const getSortIconSys = (field: SysSortField) => {
    if (sysSortField !== field) return null;
    return sysSortOrder === 'asc' ? (
      <ChevronUp size={12} style={{ marginLeft: '4px', display: 'inline' }} />
    ) : (
      <ChevronDown size={12} style={{ marginLeft: '4px', display: 'inline' }} />
    );
  };

  const getBadgeClass = (type: string) => {
    const t = type.toLowerCase();
    if (t.includes('c+g') || (t.includes('compute') && t.includes('graphics'))) return styles.typeCG;
    if (t.includes('compute')) return styles.typeCompute;
    if (t.includes('graphics')) return styles.typeGraphics;
    return styles.typeUnknown;
  };

  const getStatusBadgeClass = (status: string) => {
    const s = status.toLowerCase();
    if (s === 'running') return styles.statusRunning;
    if (s === 'sleeping') return styles.statusSleeping;
    if (s === 'stopped' || s === 'zombie') return styles.statusStopped;
    return styles.statusOther;
  };

  const visibleSys = sortedSys.slice(0, MAX_RENDERED_ROWS);
  const currentCount = activeTab === 'gpu' ? sortedGpu.length : visibleSys.length;
  const totalCount = activeTab === 'gpu' ? gpuProcesses.length : systemProcesses.length;

  const formatGpuMetric = (proc: GpuProcess) => {
    if (gpuProcessMetric === 'gpu_time') {
      return proc.gpu_percent != null ? `${proc.gpu_percent}%` : '—';
    }
    return proc.used_memory != null ? `${proc.used_memory} MB` : '—';
  };

  return (
    <div className={styles.tableContainer}>
      {/* Toast Notification */}
      {toast && (
        <div className={`${styles.toast} ${toast.type === 'success' ? styles.toastSuccess : styles.toastError}`}>
          {toast.type === 'success' ? (
            <CheckCircle size={18} className={styles.toastIcon} />
          ) : (
            <AlertTriangle size={18} className={styles.toastIcon} />
          )}
          <span className={styles.toastMessage}>{toast.message}</span>
          <button onClick={() => setToast(null)} className={styles.toastCloseBtn}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header & Tabs */}
      <div className={styles.tableHeaderSection}>
        <div className={styles.tabGroup}>
          {showGpuTab && (
            <button
              className={`${styles.tabBtn} ${activeTab === 'gpu' ? styles.tabBtnActive : ''}`}
              onClick={() => {
                setActiveTab('gpu');
                setSearchTerm('');
              }}
            >
              <Layers size={14} style={{ marginRight: '6px' }} />
              {gpuProcessMetric === 'gpu_time' ? 'GPU Workloads (Metal / MPS)' : 'GPU Workloads'}
              <span className={styles.tabBadge}>{gpuProcesses.length}</span>
            </button>
          )}
          <button
            className={`${styles.tabBtn} ${activeTab === 'system' ? styles.tabBtnActive : ''}`}
            onClick={() => {
              setActiveTab('system');
              setSearchTerm('');
            }}
          >
            <Server size={14} style={{ marginRight: '6px' }} />
            All Processes
            <span className={styles.tabBadge}>{systemProcesses.length}</span>
          </button>
        </div>

        {activeTab === 'system' && (
          <div className={styles.tabGroup}>
            {(['all', 'background', 'foreground'] as SysScope[]).map((scope) => (
              <button
                key={scope}
                className={`${styles.tabBtn} ${sysScope === scope ? styles.tabBtnActive : ''}`}
                onClick={() => setSysScope(scope)}
                title={
                  scope === 'background'
                    ? 'No controlling terminal: daemons, services, nohup / detached jobs'
                    : scope === 'foreground'
                      ? 'Attached to a terminal (TTY)'
                      : 'All processes'
                }
              >
                {scope === 'all' ? 'All' : scope === 'background' ? 'Background' : 'Terminal'}
                <span className={styles.tabBadge}>
                  {scope === 'all'
                    ? systemProcesses.length
                    : scope === 'background'
                      ? backgroundCount
                      : systemProcesses.length - backgroundCount}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className={styles.searchBar}>
          <input
            type="text"
            placeholder={
              activeTab === 'gpu'
                ? 'Filter GPU processes...'
                : 'Filter by command, script, user, PID...'
            }
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className={styles.searchInput}
          />
          <div className={styles.countText}>
            Showing {currentCount} of {totalCount}
            {activeTab === 'system' && sortedSys.length > MAX_RENDERED_ROWS && ' (refine filter to see more)'}
          </div>
        </div>
      </div>

      {/* ── GPU Processes Table ─────────────────────────────────────── */}
      {activeTab === 'gpu' && (
        <>
          {sortedGpu.length > 0 ? (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th} onClick={() => handleGpuSort('pid')} style={{ width: '90px' }}>
                      PID {getSortIconGpu('pid')}
                    </th>
                    <th className={styles.th} onClick={() => handleGpuSort('name')}>
                      Process Name {getSortIconGpu('name')}
                    </th>
                    <th className={styles.th} onClick={() => handleGpuSort('type')} style={{ width: '130px' }}>
                      Workload Type {getSortIconGpu('type')}
                    </th>
                    <th
                      className={styles.th}
                      onClick={() => handleGpuSort(gpuMetricField)}
                      style={{ textAlign: 'right', width: '130px' }}
                      title={gpuProcessMetric === 'gpu_time' ? 'Share of GPU time over the last sampling interval' : undefined}
                    >
                      {gpuProcessMetric === 'gpu_time' ? 'GPU Time' : 'GPU VRAM'} {getSortIconGpu(gpuMetricField)}
                    </th>
                    <th className={styles.th} style={{ textAlign: 'center', width: '90px' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedGpu.map((proc) => (
                    <tr key={`${proc.pid}-${proc.type}`} className={styles.tr}>
                      <td className={`${styles.td} ${styles.pid}`}>{proc.pid}</td>
                      <td className={`${styles.td} ${styles.name}`}>{proc.name}</td>
                      <td className={styles.td}>
                        <span className={`${styles.typeBadge} ${getBadgeClass(proc.type)}`}>
                          {proc.type}
                        </span>
                      </td>
                      <td className={`${styles.td} ${styles.memory}`} style={{ textAlign: 'right' }}>
                        {formatGpuMetric(proc)}
                      </td>
                      <td className={styles.td} style={{ textAlign: 'center' }}>
                        <button
                          className={styles.killActionBtn}
                          onClick={() => {
                            setSelectedProcess({
                              pid: proc.pid,
                              name: proc.name,
                              type: proc.type,
                              memory:
                                gpuProcessMetric === 'gpu_time'
                                  ? `${formatGpuMetric(proc)} GPU time`
                                  : `${formatGpuMetric(proc)} (GPU)`,
                            });
                            setForceKill(false);
                          }}
                          title={`Terminate ${proc.name} (PID: ${proc.pid})`}
                        >
                          <Skull size={13} style={{ marginRight: '4px' }} />
                          Kill
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <Terminal size={32} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
              <div className={styles.emptyTitle}>No Active GPU Processes</div>
              <p className={styles.emptyDesc}>
                {gpuProcesses.length === 0
                  ? gpuProcessMetric === 'gpu_time'
                    ? 'No Metal / MPS workloads are currently running on this GPU.'
                    : 'No graphics or compute workloads are currently running on this GPU.'
                  : 'Try checking your search term filter.'}
              </p>
            </div>
          )}
        </>
      )}

      {/* ── System & Background Processes Table ────────────────────── */}
      {activeTab === 'system' && (
        <>
          {sortedSys.length > 0 ? (
            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.th} onClick={() => handleSysSort('pid')} style={{ width: '80px' }}>
                      PID {getSortIconSys('pid')}
                    </th>
                    <th className={styles.th} onClick={() => handleSysSort('name')}>
                      Command / Process {getSortIconSys('name')}
                    </th>
                    <th className={styles.th} onClick={() => handleSysSort('user')} style={{ width: '100px' }}>
                      User {getSortIconSys('user')}
                    </th>
                    <th
                      className={styles.th}
                      onClick={() => handleSysSort('cpu_percent')}
                      style={{ textAlign: 'right', width: '90px' }}
                    >
                      CPU % {getSortIconSys('cpu_percent')}
                    </th>
                    <th
                      className={styles.th}
                      onClick={() => handleSysSort('memory_mb')}
                      style={{ textAlign: 'right', width: '110px' }}
                    >
                      RAM (MB) {getSortIconSys('memory_mb')}
                    </th>
                    <th className={styles.th} onClick={() => handleSysSort('status')} style={{ width: '95px' }}>
                      Status {getSortIconSys('status')}
                    </th>
                    <th className={styles.th} style={{ textAlign: 'center', width: '90px' }}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSys.map((proc) => (
                    <tr key={`sys-${proc.pid}`} className={styles.tr}>
                      <td className={`${styles.td} ${styles.pid}`}>{proc.pid}</td>
                      <td className={`${styles.td}`}>
                        <div className={styles.name}>
                          {proc.name}
                          {proc.background && (
                            <span
                              className={`${styles.statusBadge} ${styles.statusOther}`}
                              style={{ marginLeft: '8px' }}
                              title="No controlling terminal (daemon / service / nohup / detached)"
                            >
                              bg
                            </span>
                          )}
                        </div>
                        {proc.command && proc.command !== proc.name && (
                          <div className={styles.subCommand} title={proc.command}>
                            {proc.command}
                          </div>
                        )}
                      </td>
                      <td className={`${styles.td} ${styles.userText}`}>{proc.user}</td>
                      <td className={`${styles.td} ${styles.cpuValue}`} style={{ textAlign: 'right' }}>
                        {proc.cpu_percent}%
                      </td>
                      <td className={`${styles.td} ${styles.memory}`} style={{ textAlign: 'right' }}>
                        {proc.memory_mb} MB
                      </td>
                      <td className={styles.td}>
                        <span className={`${styles.statusBadge} ${getStatusBadgeClass(proc.status)}`}>
                          {proc.status}
                        </span>
                      </td>
                      <td className={styles.td} style={{ textAlign: 'center' }}>
                        <button
                          className={styles.killActionBtn}
                          onClick={() => {
                            setSelectedProcess({
                              pid: proc.pid,
                              name: proc.name,
                              command: proc.command,
                              user: proc.user,
                              cpu: `${proc.cpu_percent}%`,
                              memory: `${proc.memory_mb} MB (RAM)`,
                            });
                            setForceKill(false);
                          }}
                          title={`Terminate ${proc.name} (PID: ${proc.pid})`}
                        >
                          <Skull size={13} style={{ marginRight: '4px' }} />
                          Kill
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyState}>
              <Cpu size={32} style={{ color: 'var(--text-muted)', marginBottom: '8px' }} />
              <div className={styles.emptyTitle}>No System Processes Found</div>
              <p className={styles.emptyDesc}>
                {systemProcesses.length === 0
                  ? 'No system processes telemetry available.'
                  : 'Try checking your search term filter.'}
              </p>
            </div>
          )}
        </>
      )}

      {/* Confirmation Modal */}
      {selectedProcess && (
        <div className={styles.modalOverlay} onClick={() => !isKilling && setSelectedProcess(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitleArea}>
                <AlertTriangle size={18} className={styles.modalAlertIcon} />
                <h3 className={styles.modalTitle}>Terminate Process</h3>
              </div>
              <button
                className={styles.modalCloseBtn}
                onClick={() => setSelectedProcess(null)}
                disabled={isKilling}
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.modalBody}>
              <p className={styles.modalWarningText}>
                Are you sure you want to terminate this process? Terminating critical system processes may affect system stability.
              </p>

              <div className={styles.processDetailBox}>
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>Process Name:</span>
                  <span className={styles.detailValueName}>{selectedProcess.name}</span>
                </div>
                {selectedProcess.command && selectedProcess.command !== selectedProcess.name && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Full Command:</span>
                    <span className={styles.detailValueCommand} title={selectedProcess.command}>
                      {selectedProcess.command}
                    </span>
                  </div>
                )}
                <div className={styles.detailRow}>
                  <span className={styles.detailLabel}>PID:</span>
                  <span className={styles.detailValueMono}>{selectedProcess.pid}</span>
                </div>
                {selectedProcess.user && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>User:</span>
                    <span className={styles.detailValueMono}>{selectedProcess.user}</span>
                  </div>
                )}
                {selectedProcess.type && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Workload Type:</span>
                    <span className={styles.detailValueMono}>{selectedProcess.type}</span>
                  </div>
                )}
                {selectedProcess.cpu && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>CPU Usage:</span>
                    <span className={styles.detailValueMono}>{selectedProcess.cpu}</span>
                  </div>
                )}
                {selectedProcess.memory && (
                  <div className={styles.detailRow}>
                    <span className={styles.detailLabel}>Memory:</span>
                    <span className={styles.detailValueMono}>{selectedProcess.memory}</span>
                  </div>
                )}
              </div>

              <label className={styles.forceCheckboxLabel}>
                <input
                  type="checkbox"
                  checked={forceKill}
                  onChange={(e) => setForceKill(e.target.checked)}
                  disabled={isKilling}
                  className={styles.checkboxInput}
                />
                <span>
                  <strong>Force Kill (SIGKILL)</strong> - Immediately terminates without graceful cleanup
                </span>
              </label>
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.btnCancel}
                onClick={() => setSelectedProcess(null)}
                disabled={isKilling}
              >
                Cancel
              </button>
              <button
                className={styles.btnDanger}
                onClick={handleKillSubmit}
                disabled={isKilling}
              >
                {isKilling ? (
                  <>
                    <Loader2 size={14} className={styles.spinner} />
                    Terminating...
                  </>
                ) : (
                  <>
                    <Skull size={14} style={{ marginRight: '6px' }} />
                    {forceKill ? 'Force Kill (SIGKILL)' : 'Terminate (SIGTERM)'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
