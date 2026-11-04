import { earnOpen } from '@/city/lib/earn/flag';
import { LSTS } from '@/city/lib/earn/lst';
import { pierOf } from '@/city/lib/earn/pier';
import { harborPools } from '@/city/lib/districts/harbor/pools';
import { mergeCatalog } from '@/lib/liquidity/catalog/model';
import { readPoolCatalog } from '@/lib/liquidity/catalog/service.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

/**
 * The Piers tab (CITY-92, CITY-93): the SOL piers — Meteora DLMM pools of SOL against USDC or an LST of the SOL Saver —
 * from the engine's catalogue, cut to the verified, deep ones. The top of the catalogue carries SOL–USDC; each LST is
 * looked up by its mint too (each look-up is the catalogue's own, kept two minutes and within its search budget).
 * Read-only, so Earn can show it while the Harbor's own switch — which moves money — is still closed.
 */
export async function GET() {
  if (!earnOpen(process.env.NEXT_PUBLIC_RYNTRA_CITY_EARN)) {
    return Response.json({ error: { code: 'EARN_CLOSED', message: 'Earn is closed here.' } }, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
  const [top, ...lsts] = await Promise.all([readPoolCatalog(null), ...LSTS.map((lst) => readPoolCatalog(lst.mint))]);
  const reads = [top!, ...lsts];
  const times = reads.flatMap((read) => [read.sources.dlmm.at, read.sources['damm-v2'].at]).filter((at): at is string => at !== null).sort();
  const pools = harborPools(mergeCatalog(reads.map((read) => read.pools))).filter((pool) => pierOf(pool) !== null);
  if (!pools.length && !reads.some((read) => read.sources.dlmm.ok)) {
    return Response.json({ error: { code: 'UNAVAILABLE', message: 'Meteora did not answer.' } }, { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  return Response.json({ pools, at: times[0] ?? null }, { headers: { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=120' } });
}
