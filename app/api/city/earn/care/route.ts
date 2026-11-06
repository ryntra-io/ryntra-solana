import { careGate, careStatus, relayStop, reviewCare, stopCare, submitCare } from '@/lib/care/service.server';
import { liquidityFailure, liquidityHeaders, openLiquidityDoor } from '@/lib/liquidity/studio/http.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * «Your agent looks after it» (CITY-203): one door for the window. Every action is the wallet's own — `review` builds the
 * care's transactions, `submit` relays the ones the wallet signed, `stop` builds everything back, `status` reads the
 * wallet's cares. The session's wallet must be the action's; the switch closed answers 404.
 */
export async function POST(request: Request) {
  if (!careGate(process.env).open) return Response.json({ error: { code: 'CARE_CLOSED', message: 'Closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  const door = await openLiquidityDoor(request);
  if (!door.ok) return door.response;
  const body = (door.body ?? {}) as Record<string, unknown>;
  const owner = typeof body.owner === 'string' ? body.owner : '';
  if (!owner) return liquidityFailure(400, 'BAD_REQUEST', 'The request was not understood.', door.rate);
  if (door.mismatch(owner)) return liquidityFailure(403, 'WALLET_MISMATCH', "The session's wallet is not this action's wallet.", door.rate);
  const answer =
    body.action === 'review'
      ? await reviewCare({ owner, pool: String(body.pool ?? ''), lamports: String(body.lamports ?? ''), fees: body.fees === 'wallet' ? 'wallet' : 'reinvest', width: typeof body.width === 'number' ? body.width : undefined, stopPct: typeof body.stopPct === 'number' ? body.stopPct : 0 })
      : body.action === 'submit'
        ? await submitCare({ owner, key: String(body.key ?? ''), signed: Array.isArray(body.signed) ? body.signed.map(String) : [] })
        : body.action === 'stop'
          ? await stopCare({ owner, key: String(body.key ?? '') })
          : body.action === 'relay'
            ? await relayStop({ owner, key: String(body.key ?? ''), signed: Array.isArray(body.signed) ? body.signed.map(String) : [] })
            : body.action === 'status'
              ? await careStatus(owner)
              : null;
  if (!answer) return liquidityFailure(400, 'BAD_REQUEST', 'The request was not understood.', door.rate);
  if (!answer.ok) return liquidityFailure(answer.code === 'CARE_CLOSED' ? 404 : 409, answer.code, answer.reason, door.rate);
  return Response.json(answer, { headers: liquidityHeaders(door.rate) });
}
