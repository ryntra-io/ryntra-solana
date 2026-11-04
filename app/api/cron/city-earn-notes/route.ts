import { NextRequest, NextResponse } from 'next/server';

import { earnOpen } from '@/city/lib/earn/flag';
import { runEarnWatch } from '@/city/lib/earn/notes-watch.server';
import { getGuardRuntime } from '@/lib/guard/runtime';
import { reportError } from '@/lib/monitor';
import { decideBearerAuth, LEGACY_KEY_ERROR } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Earn's notes (CITY-100), every five minutes: the wallets that asked to be watched, a few per pass, each read at most
 * every quarter hour — positions out of range, the exchange's weekend, dividend dates — and the person told through the
 * engine's inbox and delivery: Telegram, the phone's push, the browser's push. Internal — the cron's bearer only. Shut
 * where Earn is closed. Signs, sends money and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get('authorization'), legacyKeyPresent: new URL(req.url).searchParams.has('key') },
    process.env.CRON_SECRET,
  );
  if (decision === 'legacy-rejected') return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== 'authorized') return NextResponse.json({ ok: false }, { status: 401 });
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) return NextResponse.json({ ok: true, skipped: 'closed' });
  const guard = getGuardRuntime();
  if (!guard.writes.allowed) return NextResponse.json({ ok: true, skipped: 'read-only' });
  try {
    const run = await runEarnWatch(guard.store);
    return NextResponse.json({ ok: true, ...run });
  } catch (error) {
    /* A pass that failed whole is taken again on the next; each note is claimed once. */
    void reportError('cron:city-earn-notes', error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
