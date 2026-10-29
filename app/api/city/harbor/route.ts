import { harborOpen } from '@/city/lib/districts/harbor/flag';
import { harborPools } from '@/city/lib/districts/harbor/pools';
import { readPoolCatalog } from '@/lib/liquidity/catalog/service.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * The Harbor's pools: the engine's catalogue of Meteora DLMM and DAMM v2 pools (kept two minutes for every visitor),
 * cut to the verified, deep pools the city lists. Read-only, and closed while the Harbor is.
 */
export async function GET() {
  if (!harborOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_HARBOR)) {
    return Response.json({ error: { code: 'HARBOR_CLOSED', message: 'The Harbor opens soon.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const catalog = await readPoolCatalog(null);
  const times = [catalog.sources.dlmm.at, catalog.sources['damm-v2'].at].filter((at): at is string => at !== null).sort();
  const pools = harborPools(catalog.pools);
  if (!pools.length && !catalog.sources.dlmm.ok && !catalog.sources['damm-v2'].ok) {
    return Response.json({ error: { code: 'UNAVAILABLE', message: 'Meteora did not answer.' } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ pools, at: times[0] ?? null }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=120' } });
}
