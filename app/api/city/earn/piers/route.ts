import { earnOpen } from '@/city/lib/earn/flag';
import { harborPools } from '@/city/lib/districts/harbor/pools';
import { readPoolCatalog } from '@/lib/liquidity/catalog/service.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * The Piers tab (CITY-92): the Harbor's own list — the engine's catalogue of Meteora pools cut to the verified, deep
 * ones — read-only, so Earn can show it while the Harbor's own switch (which moves money) is still closed.
 */
export async function GET() {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const catalog = await readPoolCatalog(null);
  const times = [catalog.sources.dlmm.at, catalog.sources['damm-v2'].at].filter((at): at is string => at !== null).sort();
  const pools = harborPools(catalog.pools);
  if (!pools.length && !catalog.sources.dlmm.ok && !catalog.sources['damm-v2'].ok) {
    return Response.json({ error: { code: 'UNAVAILABLE', message: 'Meteora did not answer.' } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ pools, at: times[0] ?? null }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=120' } });
}
