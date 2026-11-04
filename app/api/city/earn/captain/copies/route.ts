import { earnOpen } from '@/city/lib/earn/flag';
import { readReport } from '@/city/lib/earn/captain-ledger';
import { captainCounting, captainReport } from '@/city/lib/earn/captain.server';
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from '@/lib/liquidity/studio/http.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The city's word that a pier add landed (CITY-99): the position, its wallet, its pier and its style. Nothing about it
 * is believed until the chain shows it — the wallet's own position, in that pool, exactly that style's width; then its
 * amounts at that read are where its record starts. Only a SOL pier, only the session's own wallet, a few a day.
 * Read-only on the chain: nothing is built, signed or sent.
 */
export async function POST(request: Request) {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const input = readReport(door.body);
  if (!input) return liquidityFailure(400, 'BAD_REQUEST', 'The request was not understood.', door.rate);
  if (door.mismatch(input.owner)) return liquidityFailure(403, 'WALLET_MISMATCH', "The session's wallet is not this copy's wallet.", door.rate);
  if (!captainCounting()) return liquidityFailure(503, 'NOT_COUNTING', 'Copies are not counted here yet.', door.rate);
  try {
    const outcome = await captainReport(input);
    if (!outcome.ok) return liquidityFailure(403, outcome.code, 'Only SOL piers are counted.', door.rate);
    return Response.json({ state: outcome.state }, { headers: liquidityHeaders(door.rate) });
  } catch {
    return liquidityFailure(503, 'UNAVAILABLE', 'The ledger did not answer.', door.rate);
  }
}
