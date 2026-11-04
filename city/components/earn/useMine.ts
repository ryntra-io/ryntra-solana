'use client';

import { useMemo } from 'react';
import { dividendLine, readAction, type DividendLine } from '@/city/lib/earn/corporate';
import { headline, lstBalances, lstHolding, pierRow, type Headline, type LstHolding, type PierRow } from '@/city/lib/earn/mine';
import { entriesOf } from '@/city/lib/earn/device';
import { LSTS } from '@/city/lib/earn/lst';
import { activeMultiplier } from '@/city/lib/earn/stocks';
import { useEarnData } from '@/city/lib/earn/store';
import { NATIVE_ID, type MoneyAsset } from '@/city/lib/money/assets';
import { useMoneyStore } from '@/city/lib/money/store';
import { DOLLAR_ASSETS, type DollarPosition } from '@/city/lib/earn/dollar';
import { useDollar } from '@/city/lib/earn/dollar-store';

export type StockRow = Readonly<{ mint: string; symbol: string; line: DividendLine; splitSeen: boolean; units: number }>;

export type MineFigures = Readonly<{
  /** The wallet's coins are read for this owner. */
  ready: boolean;
  failed: boolean;
  lsts: readonly LstHolding[];
  piers: readonly PierRow[];
  stocks: readonly StockRow[];
  /** The Dollar Saver's positions at Jupiter Lend (CITY-192), in their own coins: never added to the SOL headline. */
  dollars: readonly DollarPosition[];
  head: Headline;
  /** Nothing earning and nothing to measure: the empty state. */
  empty: boolean;
}>;

/** January 1st of this year, local time: the dividend line's period. */
function yearStart(now = new Date()): number {
  return new Date(now.getFullYear(), 0, 1).getTime();
}

/** «Mine» and the headline, from the wallet's coins, the LST feed, the device's lots and the pool positions. */
export function useMine(owner: string | null): MineFigures {
  const wallet = useMoneyStore((st) => st.wallet);
  const walletRead = useMoneyStore((st) => st.walletRead);
  const feed = useEarnData((st) => st.feed);
  const lots = useEarnData((st) => st.lots);
  const positions = useEarnData((st) => st.positions);
  const stocks = useEarnData((st) => st.stocks);
  const steps = useEarnData((st) => st.steps);
  const dollarSurface = useDollar((st) => st.surface);

  return useMemo(() => {
    const assets: readonly MoneyAsset[] = wallet && wallet.owner === owner ? wallet.assets : [];
    const ready = Boolean(owner && wallet && wallet.owner === owner);
    const value = feed.status === 'ready' ? feed.value : null;
    const solUsd = assets.find((a) => a.id === NATIVE_ID)?.usdPrice ?? null;
    const balances = lstBalances(assets);
    const myLots = lots && lots.owner === owner ? lots.lots : [];
    const lsts = LSTS.filter((lst) => balances.has(lst.id)).map((lst) => lstHolding(lst.id, balances.get(lst.id)!, value, myLots));
    const entries = owner ? entriesOf(owner) : new Map();
    const views = positions && positions.owner === owner && positions.value.status === 'ready' ? positions.value.value : [];
    const piers = views.map((view) => pierRow(view, entries.get(view.address) ?? null, solUsd));
    const configs = stocks && stocks.owner === owner && stocks.value.status === 'ready' ? stocks.value.value : [];
    const since = yearStart();
    const stockRows: StockRow[] = configs.flatMap((config) => {
      const asset = assets.find((a) => a.mint === config.mint);
      if (!asset) return [];
      const raw = BigInt(asset.amountRaw);
      const line = dividendLine(config.mint, steps, raw, asset.decimals, since);
      const splitSeen = steps.some((step) => step.mint === config.mint && readAction(step).kind !== 'dividend' && Date.parse(step.at) >= since);
      const units = (Number(raw) / 10 ** asset.decimals) * activeMultiplier(config, Date.now());
      return [{ mint: config.mint, symbol: asset.symbol, line, splitSeen, units }];
    });
    const lend = dollarSurface.status === 'ready' && dollarSurface.value.owner === owner ? dollarSurface.value.positions : {};
    const dollars = DOLLAR_ASSETS.flatMap((asset) => (lend[asset] ? [lend[asset]!] : []));
    const head = headline(lsts, piers);
    return { ready, failed: walletRead === 'failed', lsts, piers, stocks: stockRows, dollars, head, empty: ready && !lsts.length && !piers.length && !stockRows.length && !dollars.length };
  }, [wallet, walletRead, owner, feed, lots, positions, stocks, steps, dollarSurface]);
}
