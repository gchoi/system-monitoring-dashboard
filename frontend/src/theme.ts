export type Appearance = 'system' | 'light' | 'dark';
export const themeStorageKey = 'system-monitor-appearance';

// Runs in the document head before any dashboard surface is painted.
export const themeBootstrap = `(function () {
  var preference = 'system';
  try {
    var stored = localStorage.getItem('system-monitor-appearance');
    if (stored === 'light' || stored === 'dark') preference = stored;
  } catch (_) {}
  var theme = preference === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.appearance = preference;
  document.documentElement.style.colorScheme = theme;
})();`;
