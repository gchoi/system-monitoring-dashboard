'use client';

import { useEffect, useState } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';
import { Appearance, themeStorageKey } from '../theme';
import styles from './ThemeControl.module.css';

const options = [
  { value: 'system', label: 'System', Icon: Laptop },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
] as const;

export default function ThemeControl() {
  const [appearance, setAppearance] = useState<Appearance>('system');

  useEffect(() => {
    const stored = document.documentElement.dataset.appearance;
    if (stored === 'light' || stored === 'dark') setAppearance(stored);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    // The head script may already have restored an explicit preference.
    const preference = document.documentElement.dataset.appearance || appearance;
    const apply = () => {
      const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [appearance]);

  const select = (value: Appearance) => {
    document.documentElement.dataset.appearance = value;
    const theme = value === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    setAppearance(value);
    try { localStorage.setItem(themeStorageKey, value); } catch { /* Theme still works without storage. */ }
  };

  return (
    <div className={styles.control} role="group" aria-label="Appearance">
      {options.map(({ value, label, Icon }) => (
        <button key={value} type="button" className={styles.option}
          aria-label={`${label} theme`} aria-pressed={appearance === value}
          onClick={() => select(value)} title={`${label} appearance`}>
          <Icon size={15} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
