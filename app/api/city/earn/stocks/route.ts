import { consumeSolanaReadRequest } from '@/lib/agent-control/http';
import { earnOpen } from '@/city/lib/earn/flag';
import { mintsOf } from '@/city/lib/earn/stocks';
import { readScaledConfigs } from '@/city/lib/earn/stocks.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * «Mine»'s dividend line (CITY-95): for the mints asked, the Scaled UI Amount multiplier as the chain states it — now,
 * and the one step of history the extension keeps. Read-only, behind a read's rate limit, closed while Earn is.
 */
export async function GET(request: Request) {
  const headers = { 'cache-control': 'private, max-age=60' };
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers });
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return Response.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429, headers });
  const mints = mintsOf(new URL(request.url).searchParams.get('mints'));
  const stocks = await readScaledConfigs(mints);
  return Response.json({ stocks, at: new Date().toISOString() }, { headers });
}
