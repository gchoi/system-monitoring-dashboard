// Same mark as src/app/icon.svg (favicon), rendered inline for the header.
export default function AppLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="app-logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#245cbd" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#app-logo-grad)" />
      <polyline
        points="11,34 21,34 26,21 34,45 40,29 44,34 53,34"
        fill="none"
        stroke="#fff"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
