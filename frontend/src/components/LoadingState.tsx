import styles from './LoadingState.module.css';

export default function LoadingState() {
  return (
    <div className={`glass-panel ${styles.panel}`} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      <h2 className={styles.title}>Connecting to your system</h2>
      <p className={styles.description}>Waiting for live telemetry…</p>
    </div>
  );
}
