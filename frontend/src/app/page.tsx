'use client';

import dynamic from 'next/dynamic';
import LoadingState from '@/components/LoadingState';

// Dynamically import the main dashboard component to prevent SSR hydration errors
// since WebSockets are client-only.
const Dashboard = dynamic(() => import('@/components/Dashboard'), {
  ssr: false,
  loading: () => (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: 24 }}>
      <LoadingState />
    </div>
  )
});

export default function Home() {
  return (
    <main>
      <Dashboard />
    </main>
  );
}
