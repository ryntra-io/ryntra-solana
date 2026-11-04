import { earnOpen } from '@/city/lib/earn/flag';
import { captainRecord } from '@/city/lib/earn/captain.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * «Like the Captain» (CITY-99): the strategies with a proven record — at least thirty days of it and copies from at
 * least five wallets, the deepest fall beside the result — from the ledger the daily pass keeps against the chain.
 * Read-only. Where the ledger is not counting yet (production before its migration) the list is empty, never made up.
 */
export async function GET() {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  try {
    const answer = await captainRecord();
    return Response.json(answer, { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=600' } });
  } catch {
    return Response.json({ error: { code: 'UNAVAILABLE', message: 'The record could not be read now.' } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
