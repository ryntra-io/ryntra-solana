import { consumeSolanaReadRequest } from '@/lib/agent-control/http';
import { earnOpen } from '@/city/lib/earn/flag';
import { pierStates } from '@/city/lib/earn/pier-gate';
import { isPoolAddress } from '@/lib/liquidity/catalog/model';
import { liquidityActionStates } from '@/lib/liquidity/studio/gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What one wallet may do on the SOL piers from the city now (CITY-93): the Harbor's own switch — closed, canary or
 * open, its ceiling and its stop — joined with the engine's gate, which this route only reads. To a wallet the canary
 * does not name, the answer is the same as when closed.
 */
export async function GET(request: Request) {
  const headers = { 'cache-control': 'private, no-store' };
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers });
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return Response.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429, headers });
  const owner = new URL(request.url).searchParams.get('owner');
  if (!isPoolAddress(owner)) return Response.json({ error: { code: 'BAD_REQUEST', message: 'A wallet address is needed.' } }, { status: 400, headers });
  return Response.json(pierStates(owner, process.env, liquidityActionStates(owner, process.env)), { headers });
}
