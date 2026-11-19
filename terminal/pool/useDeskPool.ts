'use client';

import { useEffect, useMemo, useState } from 'react';
import type { EarnBinsAnswer } from '../../lib/earn-pools/bins.ts';
import type { EarnPool } from '../../lib/earn-pools/model.ts';
import { readPools } from '../coin/usePoolLayer.ts';
import { useBins } from '../earn/range/useBins.ts';
import { deskOfBins, deskOfCatalog, deskOfPro, type DeskPool } from './desk-pool.ts';
import { useProPool, type Read } from './usePro.ts';

/**
 * The pool a page stands on, whichever of Meteora's pools the address is: a DLMM Pro pool from the program
 * (`/api/pro/pools/<address>`), else a DLMM or DAMM v2 pool of the engine's catalogue (`/api/v1/earn/pools`, read once
 * for every chart of the page), else a DLMM pool the catalogue does not list, from its bins. A DLMM pool's first bins
 * give its coins' decimals and its price; the page's own read of the bins keeps the price after that. `none` — no pool of
 * Meteora's at the address.
 */
export function useDeskPool(address: string): Read<DeskPool> {
  const [catalog, setCatalog] = useState<readonly EarnPool[] | null>(null);
  useEffect(() => {
    let live = true;
    void readPools().then((pools) => {
      if (live) setCatalog(pools);
    });
    return () => {
      live = false;
    };
  }, []);
  const listed = useMemo(() => catalog?.find((pool) => pool.address === address) ?? null, [catalog, address]);
  // A pool the catalogue lists is not DLMM Pro's: the program is not asked about it again.
  const pro = useProPool(address, listed === null);
  // A DLMM pool's bins, until they first read: for a listed DLMM pool its decimals and first price; for one the catalogue
  // does not list, whether it is a pool at all (asked again every twenty seconds until it answers).
  const [kept, setKept] = useState<EarnBinsAnswer | null>(null);
  const seen = kept && kept.pool === address ? kept : null;
  const askBins = !seen && pro.status !== 'ready' && (listed ? listed.kind === 'dlmm' : catalog !== null && (pro.status === 'none' || pro.status === 'failed'));
  const bins = useBins('dlmm', askBins ? address : null);
  useEffect(() => {
    if (askBins && bins.status === 'ready' && bins.value.pool === address) setKept(bins.value);
  }, [askBins, bins, address]);
  return useMemo((): Read<DeskPool> => {
    if (pro.status === 'ready') return { status: 'ready', value: deskOfPro(pro.value) };
    if (listed) return { status: 'ready', value: deskOfCatalog(listed, seen) };
    if (seen) return { status: 'ready', value: deskOfBins(seen) };
    if (pro.status === 'reading' || catalog === null || (askBins && bins.status === 'reading')) return { status: 'reading' };
    return pro.status === 'failed' ? { status: 'failed' } : { status: 'none' };
  }, [pro, listed, seen, catalog, askBins, bins.status]);
}
