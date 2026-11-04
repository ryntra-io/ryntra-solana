import { earnOpen } from '@/city/lib/earn/flag';
import { limitMode } from '@/city/lib/earn/limit-gate';
import { readLimitMarkets } from '@/city/lib/earn/limit-markets.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Sell Higher's markets (CITY-97): SOL against USDC and the most traded listed stocks, each on a verified Meteora DLMM
 * pool that takes limit orders, with the live Scaled UI multiplier and any new one scheduled. Read-only. While the
 * product's switch is closed there is nothing to list.
 */
export async function GET() {
  const headers = { 'cache-control': 'no-store' };
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN) || limitMode(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN_LIMITS) === 'closed') {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers });
  }
  const answer = await readLimitMarkets();
  if (!answer.markets.length) return Response.json({ error: { code: 'UNAVAILABLE', message: 'No market could be checked now.' } }, { status: 503, headers });
  return Response.json(answer, { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=90' } });
}
