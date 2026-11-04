import { earnOpen } from '@/city/lib/earn/flag';
import { eveGuard, poolSide, previewRatio } from '@/city/lib/earn/limit';
import { admitLimitExit, admitLimitPlace, withinLimitCeiling } from '@/city/lib/earn/limit-gate';
import { readLimitMarkets } from '@/city/lib/earn/limit-markets.server';
import { parseLimitInput } from '@/lib/liquidity/studio/actions';
import { reviewLimitAction } from '@/lib/liquidity/studio/actions.server';
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from '@/lib/liquidity/studio/http.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The Review of a limit order from the city (CITY-97): the product's own door in front of the engine's. A new order —
 * placed, or rolled from a filled one (the Wheel) — passes only where the product admits this wallet (closed · canary
 * · open, and the stop), only on a market whose every mint and pool passed the checks, only within the ceiling at the
 * venue's own prices, and never on the eve of a corporate action where the step alone could fill it. A cancel passes
 * wherever the product is not closed to the wallet — the stop never holds money in. Past the door it is the engine's
 * own Review: its gate, its checks and simulation, its sealed ticket. Nothing is signed or sent here; a ticket the door
 * refuses after the build never reaches the wallet.
 */
export async function POST(request: Request) {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const input = parseLimitInput(door.body);
  if (!input) return liquidityFailure(400, 'BAD_REQUEST', 'The request was not understood.', door.rate);
  const owner = input.request.owner;
  if (door.mismatch(owner)) return liquidityFailure(403, 'WALLET_MISMATCH', "The session's wallet is not this action's wallet.", door.rate);

  let ceilingUsd: number | null = null;
  if (input.action === 'limit_cancel') {
    if (!admitLimitExit(owner, process.env)) return liquidityFailure(403, 'LIMITS_CLOSED', 'Limit orders are closed to this wallet.', door.rate);
  } else {
    const admitted = admitLimitPlace(owner, process.env);
    if (!admitted.ok) return liquidityFailure(403, admitted.code, 'No new order from this wallet now.', door.rate);
    ceilingUsd = admitted.ceilingUsd;
    if (input.action === 'limit_place') {
      const { markets } = await readLimitMarkets();
      if (!markets.some((market) => market.pool === input.request.pool)) return liquidityFailure(403, 'LIMIT_MARKET', 'This market is not one Sell Higher offers.', door.rate);
    }
  }

  const reviewed = await reviewLimitAction(door.body);
  if (!reviewed.ok) return liquidityFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
  const preview = reviewed.value.preview;
  if (preview.action !== 'limit_cancel' && ceilingUsd !== null) {
    const market = (await readLimitMarkets()).markets.find((m) => m.pool === preview.pool);
    if (!market) return liquidityFailure(403, 'LIMIT_MARKET', 'This market is not one Sell Higher offers.', door.rate);
    if (!withinLimitCeiling(reviewed.value.depositUsd, ceilingUsd)) return liquidityFailure(403, 'LIMIT_CEILING', 'More than one order takes for now.', door.rate);
    const place = preview.place;
    const intent = place.side === poolSide('sell', market.assetIsX) ? 'sell' : 'buy';
    const ratio = previewRatio({ assetIsX: market.assetIsX, side: place.side, poolPrice: Number(preview.price), lowerPrice: Number(place.lowerPrice), upperPrice: Number(place.upperPrice) });
    if (ratio === null) return liquidityFailure(422, 'LIMIT_UNPRICED', 'The order could not be priced.', door.rate);
    const guard = eveGuard({ intent, multiplier: market.multiplier, mint: market.asset.mint, ratio, nowMs: Date.now() });
    if (guard.blocked) return liquidityFailure(409, 'LIMIT_EVE', 'A corporate action is due: an order this near the price waits until after it.', door.rate);
  }
  return Response.json(reviewed.value, { headers: liquidityHeaders(door.rate) });
}
