'use client';

import { useMemo } from 'react';
import { useCity } from '@/city/lib/city/store';
import { pctText } from '@/city/lib/earn/captain';
import { bestLst } from '@/city/lib/earn/feed';
import { lstOf, percentText, SOL_MINT } from '@/city/lib/earn/lst';
import type { ProductId } from '@/city/lib/earn/flag';
import { useEarnData } from '@/city/lib/earn/store';
import { usdShort } from '@/city/lib/earn/stock-pier';
import { useStockPier } from '@/city/lib/earn/stock-pier-store';
import { digits } from '@/city/lib/i18n/dict';
import { formatPrice, usd } from '@/city/lib/districts/harbor/pools';

/** One product's big number on its card and in its window: a live figure with its unit, or none — never a made-up one. */
export type Big = Readonly<{ value: string; unit: string }> | null;

/**
 * The live context of each product of the Shelf, from what the city and Earn already read: the LSTs' last-epoch rate,
 * the Piers' fees, SOL-3's lending rate, SOL's and a stock's price from the city's own towers, the best proven record
 * of «Like the Captain». A source that did not
 * answer leaves its product without a number.
 */
export function useShelfContext(): Readonly<Record<ProductId, Big>> {
  const feed = useEarnData((st) => st.feed);
  const piers = useEarnData((st) => st.piers);
  const lend = useEarnData((st) => st.lend);
  const captainRead = useEarnData((st) => st.captain);
  const towers = useCity((st) => st.layout.towers);
  const stockList = useStockPier((st) => st.list);

  return useMemo(() => {
    const value = feed.status === 'ready' ? feed.value : null;
    const best = value?.lsts.find((row) => row.id === bestLst(value));
    const saver: Big = best?.apyPct != null ? { value: percentText(best.apyPct), unit: lstOf(best.id)?.symbol ?? '' } : null;

    const pools = piers.status === 'ready' ? piers.value.pools : [];
    const solPools = pools.filter((p) => (p.x.mint === SOL_MINT || p.y.mint === SOL_MINT) && p.lpFees24hUsd !== null);
    solPools.sort((a, b) => (b.lpFees24hUsd ?? 0) - (a.lpFees24hUsd ?? 0));
    const top = solPools[0];
    const pier: Big = top ? { value: usd(top.lpFees24hUsd), unit: top.pair } : null;

    const rate = lend.status === 'ready' ? lend.value.usdc : null;
    const dollar: Big = rate !== null ? { value: percentText(rate), unit: 'USDC' } : null;

    const sol = towers.find((t) => t.tower.id === SOL_MINT)?.tower;
    const sell: Big = sol && !sol.unread?.includes('price') && sol.price > 0 ? { value: `$${formatPrice(sol.price)}`, unit: 'SOL' } : null;

    const stock = towers
      .map((t) => t.tower)
      .filter((t) => t.district === 'avenue' && /x$/.test(t.symbol) && t.price > 0 && !t.unread?.includes('price'))
      .sort((a, b) => b.volume24h - a.volume24h)[0];
    const stocks: Big = stock ? { value: `$${formatPrice(stock.price)}`, unit: stock.symbol } : null;

    // The best proven record on a pier listed now — none until a strategy has thirty days and five copies.
    const listed = new Set(pools.map((p) => p.address));
    const record = captainRead.status === 'ready' ? captainRead.value.strategies.find((st) => listed.has(st.pool)) : undefined;
    const captain: Big = record ? { value: pctText(record.resultPct), unit: '' } : null;

    // The Stock Pier: the busiest verified stock's seven days of trading.
    const topStock = stockList?.status === 'ready' ? stockList.value.pairs[0] : undefined;
    const stockpier: Big = topStock ? { value: digits(usdShort(topStock.volume7dUsd)), unit: topStock.symbol } : null;

    return { saver, pier, dollar, sell, stockpier, stocks, captain };
  }, [feed, piers, lend, towers, stockList, captainRead]);
}
