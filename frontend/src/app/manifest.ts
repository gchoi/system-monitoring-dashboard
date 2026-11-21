import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'System Monitor',
    short_name: 'SysMonitor',
    description: 'Real-time system monitoring dashboard for CPU, memory, disk, network, and NVIDIA GPU telemetry.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b1220',
    theme_color: '#245cbd',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
