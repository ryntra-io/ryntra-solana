import 'server-only';
import { readOnchainMintCached, warmOnchainMints } from '@/lib/stocks/asset.server';
import type { ScaledConfig } from './stocks';

/**
 * The Scaled UI Amount configuration of each mint asked for, as the chain states it — through the stocks engine's own
 * mint read and its ten-minute cache (`lib/stocks/asset.server.ts`), one batched call for the lot. Reading only.
 */
export async function readScaledConfigs(mints: readonly string[]): Promise<ScaledConfig[]> {
  if (!mints.length) return [];
  await warmOnchainMints(mints).catch(() => undefined);
  const reads = await Promise.all(mints.map((mint) => readOnchainMintCached(mint).catch(() => ({ error: 'read' }) as const)));
  const out: ScaledConfig[] = [];
  reads.forEach((read, index) => {
    if ('error' in read || !read.scaledUi) return;
    out.push({ mint: mints[index]!, multiplier: read.scaledUi.multiplier, newMultiplier: read.scaledUi.newMultiplier, newMultiplierEffectiveAt: read.scaledUi.newMultiplierEffectiveAt });
  });
  return out;
}
