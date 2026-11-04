import { NextRequest, NextResponse } from 'next/server';

import { captainCounting, captainPass } from '@/city/lib/earn/captain.server';
import { reportError } from '@/lib/monitor';
import { decideBearerAuth, LEGACY_KEY_ERROR } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * «Like the Captain»'s daily pass (CITY-99): every copy held to the chain once — confirmed, measured with SOL-2b's
 * arithmetic, closed or dropped — and today's point of every strategy written. Internal — the cron's bearer only.
 * Reads the chain; signs, sends and trades nothing.
 */
export async function GET(req: NextRequest) {
  const decision = decideBearerAuth(
    { authorization: req.headers.get('authorization'), legacyKeyPresent: new URL(req.url).searchParams.has('key') },
    process.env.CRON_SECRET,
  );
  if (decision === 'legacy-rejected') return NextResponse.json({ ok: false, error: LEGACY_KEY_ERROR }, { status: 401 });
  if (decision !== 'authorized') return NextResponse.json({ ok: false }, { status: 401 });
  /* Closed until Earn opens and the ledger's migration is applied: nothing is read. */
  if (!captainCounting()) return NextResponse.json({ ok: true, closed: true });
  try {
    const pass = await captainPass();
    return NextResponse.json({ ok: true, ...pass });
  } catch (error) {
    void reportError('cron:city-earn-captain', error, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
