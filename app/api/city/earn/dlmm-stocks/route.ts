import { consumeSolanaReadRequest } from '@/lib/agent-control/http';
import { earnOpen } from '@/city/lib/earn/flag';
import { readDlmmStockPool } from '@/lib/earn-dlmm/stocks.server';
import { isPoolAddress } from '@/lib/liquidity/catalog/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * One DLMM pool of a checked stock against USDC or SOL, for one wallet: the stock and its issuer, the
 * other coin, the pool's price from the chain, whether the issuer paused the coin, and whether this wallet may put money
 * in now (the switch `RYNTRA_EARN_DLMM_STOCKS`, its canary, the Harbor's stop and the engine's gate). A pool that is not a
 * stock's answers 403 `DLMM_STOCK_PAIR`. Read-only.
 */
export async function GET(request: Request) {
  const headers = { 'cache-control': 'private, no-store' };
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers });
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return Response.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429, headers });
  const url = new URL(request.url);
  const pool = url.searchParams.get('pool');
  const owner = url.searchParams.get('owner');
  if (!isPoolAddress(pool)) return Response.json({ error: { code: 'BAD_REQUEST', message: 'A pool address is needed.' } }, { status: 400, headers });
  if (owner !== null && !isPoolAddress(owner)) return Response.json({ error: { code: 'BAD_REQUEST', message: 'The wallet is not an address.' } }, { status: 400, headers });
  const read = await readDlmmStockPool(pool, owner);
  if (!read.ok) return Response.json({ error: { code: read.code, message: read.reason } }, { status: read.status, headers });
  return Response.json(read.value, { headers });
}
