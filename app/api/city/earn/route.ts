import { readLstFeed } from '@/city/lib/earn/feed.server';
import { earnOpen } from '@/city/lib/earn/flag';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const CLOSED = { error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } };

/**
 * The SOL Saver's yield feed (CITY-94): each LST's worth in SOL and its last epoch's yield, from the stake pools on
 * chain and Sanctum's public figures. Read-only, kept a minute for every visitor, and closed while Earn is.
 */
export async function GET() {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) return Response.json(CLOSED, { status: 404, headers: { 'cache-control': 'no-store' } });
  const feed = await readLstFeed();
  if (!feed.lsts.some((row) => row.rate !== null || row.apyPct !== null)) {
    return Response.json({ error: { code: 'UNAVAILABLE', message: 'The yields did not read.' } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json(feed, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=120' } });
}
