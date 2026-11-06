import { earnOpen } from '@/city/lib/earn/flag';
import { admitPierAdd, admitPierExit, checkPierAdd, isSolPair } from '@/city/lib/earn/pier-gate';
import { SOL_MINT } from '@/city/lib/earn/lst';
import { readPoolRecord } from '@/lib/liquidity/catalog/service.server';
import { parseZapInput } from '@/lib/liquidity/studio/actions';
import { reviewZapAction } from '@/lib/liquidity/studio/actions.server';
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from '@/lib/liquidity/studio/http.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The Review of a SOL pier's Zap from the city (CITY-198): SOL into a new position in one approval, or «Take the rest»
 * of a Zap that landed in part. The Harbor's own door stands in front, as for every pier add (`../review/route.ts`):
 * new money only where the Harbor admits this wallet, only on a SOL pier, only when the SOL put in is within the
 * ceiling at the venue's own price; «Take the rest» wherever the Harbor is not closed to the wallet — the stop never
 * holds money in. Past the door it is the engine's Zap Review (`reviewZapAction`): its gate, its wallet-only rules, the
 * reference price, the simulation and the sealed ticket. The relay is the engine's own `/api/liquidity/submit`.
 */
export async function POST(request: Request) {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const input = parseZapInput(door.body);
  if (!input) return liquidityFailure(400, 'BAD_REQUEST', 'The request was not understood.', door.rate);
  const owner = input.request.owner;
  if (door.mismatch(owner)) return liquidityFailure(403, 'WALLET_MISMATCH', "The session's wallet is not this action's wallet.", door.rate);

  const record = await readPoolRecord('dlmm', input.request.pool, { meteora: { timeoutMs: 4_000 } });
  const pool = record.pool;
  if (input.action === 'zap_in') {
    const admitted = admitPierAdd(owner, input.venue, process.env);
    if (!admitted.ok) return liquidityFailure(403, admitted.code, 'The Harbor takes no new money from this wallet now.', door.rate);
    // The most a Zap puts in is the SOL it takes: priced on SOL's side of the pool, against the ceiling.
    const solOnX = pool?.x.mint === SOL_MINT;
    const check = checkPierAdd({ amountX: solOnX ? input.request.amountIn : '0', amountY: solOnX ? '0' : input.request.amountIn }, pool, admitted.ceilingUsd);
    if (!check.ok) return liquidityFailure(403, check.code, 'This add is outside what the Harbor takes.', door.rate);
  } else {
    if (!admitPierExit(owner, process.env)) return liquidityFailure(403, 'PIER_CLOSED', 'The Harbor is closed to this wallet.', door.rate);
    if (!pool || !isSolPair(pool.x.mint, pool.y.mint)) return liquidityFailure(403, 'PIER_PAIR', 'Only SOL piers open from here.', door.rate);
  }

  const reviewed = await reviewZapAction(door.body);
  if (!reviewed.ok) return liquidityFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
  // The Zap acts on the very pool and coins the door priced, else the ticket is dropped here and never reaches the wallet.
  const preview = reviewed.value.preview;
  if (!pool || preview.pool !== input.request.pool || preview.tokenX.mint !== pool.x.mint || preview.tokenY.mint !== pool.y.mint) {
    return liquidityFailure(403, 'PIER_PAIR', 'This add is outside what the Harbor takes.', door.rate);
  }
  return Response.json(reviewed.value, { headers: liquidityHeaders(door.rate) });
}
