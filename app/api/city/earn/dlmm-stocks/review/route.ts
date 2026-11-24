import { earnOpen } from '@/city/lib/earn/flag';
import { reviewDlmmStockAction } from '@/lib/earn-dlmm/stocks.server';
import { parseReviewInput } from '@/lib/liquidity/studio/actions';
import { reviewLiquidityAction } from '@/lib/liquidity/studio/actions.server';
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from '@/lib/liquidity/studio/http.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The Review of an action on a DLMM pool of a checked stock from the terminal. New money (`add`) goes
 * through the stock door of `lib/earn-dlmm/stocks.ts` — the switch, the stock and its pair, the issuer's pause — and then
 * the engine's own Review; taking fees (`claim`) and leaving (`remove`, with `close`) go straight to the engine's own
 * Review whatever the switch says: a switch closed again never holds a position in. Nothing is signed or sent here; the
 * relay is the engine's own `/api/liquidity/submit`.
 */
export async function POST(request: Request) {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const input = parseReviewInput(door.body);
  if (!input || input.venue !== 'meteora-dlmm') return liquidityFailure(400, 'BAD_REQUEST', 'The request was not understood.', door.rate);
  if (door.mismatch(input.request.owner)) return liquidityFailure(403, 'WALLET_MISMATCH', "The session's wallet is not this action's wallet.", door.rate);
  const reviewed = input.action === 'add' ? await reviewDlmmStockAction(door.body) : await reviewLiquidityAction(door.body);
  if (!reviewed.ok) return liquidityFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
  return Response.json(reviewed.value, { headers: liquidityHeaders(door.rate) });
}
