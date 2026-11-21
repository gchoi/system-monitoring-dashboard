import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const backendPort = process.env.BACKEND_PORT || process.env.NEXT_PUBLIC_BACKEND_PORT || '8000';
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || '';
  return NextResponse.json({
    backendPort,
    wsUrl,
  });
}
