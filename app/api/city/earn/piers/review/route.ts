import { earnOpen } from '@/city/lib/earn/flag';
import { admitPierAdd, admitPierExit, checkPierAdd } from '@/city/lib/earn/pier-gate';
import { readPoolRecord } from '@/lib/liquidity/catalog/service.server';
import { parseReviewInput } from '@/lib/liquidity/studio/actions';
import { reviewLiquidityAction } from '@/lib/liquidity/studio/actions.server';
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from '@/lib/liquidity/studio/http.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The Review of a SOL pier action from the city (CITY-93): the Harbor's own door in front of the engine's. An add is
 * let through only where the Harbor admits this wallet (closed · canary · open, and the stop), only on a SOL pier, and
 * only when the most it can put in is within the ceiling of its venue at the venue's own prices; taking fees and
 * leaving pass wherever the Harbor is not closed to the wallet — the stop never holds money in. Past the door it is
 * the engine's own Review, unchanged: its gate, its checks and simulation, its sealed ticket. Nothing is signed or sent.
 */
export async function POST(request: Request) {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const input = parseReviewInput(door.body);
  if (!input) return liquidityFailure(400, 'BAD_REQUEST', 'The request was not understood.', door.rate);
  const owner = input.request.owner;
  if (door.mismatch(owner)) return liquidityFailure(403, 'WALLET_MISMATCH', "The session's wallet is not this action's wallet.", door.rate);

  let mints: Readonly<{ pool: string; x: string; y: string }> | null = null;
  if (input.action === 'add') {
    const admitted = admitPierAdd(owner, input.venue, process.env);
    if (!admitted.ok) return liquidityFailure(403, admitted.code, 'The Harbor takes no new money from this wallet now.', door.rate);
    if (input.request.position) return liquidityFailure(400, 'BAD_REQUEST', 'The city opens new positions only.', door.rate);
    const record = await readPoolRecord('dlmm', input.request.pool, { meteora: { timeoutMs: 4_000 } });
    const check = checkPierAdd(input.request, record.pool, admitted.ceilingUsd);
    if (!check.ok) return liquidityFailure(403, check.code, 'This add is outside what the Harbor takes.', door.rate);
    mints = { pool: input.request.pool, x: record.pool!.x.mint, y: record.pool!.y.mint };
  } else if (!admitPierExit(owner, process.env)) {
    return liquidityFailure(403, 'PIER_CLOSED', 'The Harbor is closed to this wallet.', door.rate);
  }

  const reviewed = await reviewLiquidityAction(door.body);
  if (!reviewed.ok) return liquidityFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
  if (mints) {
    const preview = reviewed.value.preview;
    // What goes in is never more than was asked; it must also be the very coins the ceiling was priced on, else the
    // ticket is dropped here and never reaches the wallet.
    const same = preview.action === 'add' && preview.pool === mints.pool && preview.deposit.x.asset === mints.x && preview.deposit.y.asset === mints.y;
    if (!same) return liquidityFailure(403, 'PIER_PAIR', 'This add is outside what the Harbor takes.', door.rate);
  }
  return Response.json(reviewed.value, { headers: liquidityHeaders(door.rate) });
}
