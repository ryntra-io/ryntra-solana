import { consumeSolanaReadRequest } from '@/lib/agent-control/http';
import { earnOpen } from '@/city/lib/earn/flag';
import { isPoolAddress } from '@/lib/liquidity/catalog/model';
import { readLimitOrders } from '@/lib/liquidity/studio/actions.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * A wallet's DLMM limit orders as the chain holds them (CITY-97): each order's bins, what has filled and what it
 * brought, and what a cancel would send back now. Every order the wallet owns is listed — one placed elsewhere too — so
 * nothing is ever out of reach. Read-only; a read that failed says so, never an empty list in its place.
 */
export async function GET(request: Request) {
  const headers = { 'cache-control': 'private, no-store' };
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers });
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return Response.json({ error: { code: 'RATE_LIMITED', message: 'Too many requests.' } }, { status: 429, headers });
  const owner = new URL(request.url).searchParams.get('owner');
  if (!isPoolAddress(owner)) return Response.json({ error: { code: 'BAD_REQUEST', message: 'A wallet address is needed.' } }, { status: 400, headers });
  const orders = await readLimitOrders(owner).catch(() => null);
  if (orders === null) return Response.json({ error: { code: 'UNAVAILABLE', message: 'Solana did not answer.' } }, { status: 503, headers });
  return Response.json({ owner, orders, at: new Date().toISOString() }, { headers });
}
