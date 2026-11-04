import { earnOpen } from '@/city/lib/earn/flag';
import { reviewStockBuild } from '@/city/lib/earn/stock-pier-door';
import { admitStockExit } from '@/city/lib/earn/stock-pier-gate';
import { freshStockPair, readQuoteUsd, reviewWithStockPier } from '@/city/lib/earn/stock-pier.server';
import { parseReviewInput } from '@/lib/liquidity/studio/actions';
import { reviewLiquidityAction } from '@/lib/liquidity/studio/actions.server';
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from '@/lib/liquidity/studio/http.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * The Review of a Stock Pier action from the city (CITY-98). `build` — make the pair's pier with the first liquidity in
 * one signature, or moor beside it where it stands: the Stock Pier's door (switch, verified pair, dividend guard, live
 * price, ceiling) and then the engine's own Review with the Stock Pier's venue. Taking fees (`claim`) and leaving
 * (`remove`) on a DAMM v2 position: wherever the product is not closed to the wallet — the stop never holds money in —
 * straight to the engine's Review. Nothing is signed or sent here; the relay is the engine's own route.
 */
export async function POST(request: Request) {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const body = door.body as Record<string, unknown> | null;

  if (body?.action === 'build') {
    const owner = typeof body.owner === 'string' ? body.owner : '';
    if (door.mismatch(owner)) return liquidityFailure(403, 'WALLET_MISMATCH', "The session's wallet is not this action's wallet.", door.rate);
    const answer = await reviewStockBuild(body, {
      env: process.env,
      pairOf: freshStockPair,
      quoteUsd: async (quote) => (await readQuoteUsd())[quote],
      review: reviewWithStockPier,
      now: Date.now,
    });
    if (!answer.ok) return liquidityFailure(answer.status, answer.code, answer.reason, door.rate);
    return Response.json(
      {
        ...answer.value,
        stockPier: { builds: answer.builds, pool: answer.pool },
      },
      { headers: liquidityHeaders(door.rate) },
    );
  }

  const input = parseReviewInput(body);
  if (!input || input.venue !== 'meteora-damm2' || input.action === 'add') return liquidityFailure(400, 'BAD_REQUEST', 'The request was not understood.', door.rate);
  if (door.mismatch(input.request.owner)) return liquidityFailure(403, 'WALLET_MISMATCH', "The session's wallet is not this action's wallet.", door.rate);
  if (!admitStockExit(input.request.owner, process.env)) return liquidityFailure(403, 'STOCK_PIER_CLOSED', 'The Stock Pier is closed to this wallet.', door.rate);
  const reviewed = await reviewLiquidityAction(body);
  if (!reviewed.ok) return liquidityFailure(reviewed.status, reviewed.code, reviewed.reason, door.rate);
  return Response.json(reviewed.value, {
    headers: liquidityHeaders(door.rate),
  });
}
