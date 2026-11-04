import { NextRequest, NextResponse } from 'next/server';

import { runAgentReport } from '@/city/lib/autopilot/report-watch.server';
import { getGuardRuntime } from '@/lib/guard/runtime';
import { privateNoStoreHeaders } from '@/lib/http-control';
import { reportError } from '@/lib/monitor';
import { decideBearerAuth, LEGACY_KEY_ERROR } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The agent's daily report (CITY-194), every hour: each person whose hour has come on her own clock hears what her
 * agent did since the last report — «3 trades, +0.012 SOL» — through the engine's inbox and delivery: Telegram, the
 * phone's push, the browser's push. Internal — the cron's bearer only. Shut unless `RYNTRA_AGENT_REPORT=on`. Signs,
 * sends money and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth({ authorization: req.headers.get('authorization'), legacyKeyPresent: req.nextUrl.searchParams.has('key') }, process.env.CRON_SECRET);
  if (decision === 'legacy-rejected') return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401, headers: privateNoStoreHeaders() });
  if (decision !== 'authorized') return NextResponse.json({ ok: false }, { status: 401, headers: privateNoStoreHeaders() });
  try {
    const answer = await runAgentReport(process.env, getGuardRuntime());
    return NextResponse.json({ ok: true, ...answer }, { headers: privateNoStoreHeaders() });
  } catch (error) {
    /* A pass that failed whole is taken again next hour: each person stays due until her day is claimed. */
    void reportError('cron:agent-report', error, {});
    return NextResponse.json({ ok: false }, { status: 500, headers: privateNoStoreHeaders() });
  }
}
