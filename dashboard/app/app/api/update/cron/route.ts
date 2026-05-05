// GET /api/update/cron — Vercel Cron daily hit. Authed by CRON_SECRET header.
// Configure in vercel.json: { "crons": [{ "path": "/api/update/cron", "schedule": "0 10 * * *" }] }
// (10:00 UTC ≈ 06:00 ET)

import { NextRequest, NextResponse } from 'next/server';
import { runSync } from '@/lib/sync';

export async function GET(req: NextRequest) {
  const secret = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  console.log('[cron] auth ok, starting runSync');
  const result = await runSync({ trigger: 'cron' });
  console.log('[cron] runSync done:', JSON.stringify(result).slice(0, 200));
  return NextResponse.json(result);
}
