import { useEffect, useMemo, useRef, useState } from 'react';
import { EARN_OPEN } from '../../city/lib/earn/flag.ts';
import { useEarnData } from '../../city/lib/earn/store.ts';
import type { Lang } from '../../city/lib/i18n/langs.ts';
import { useWallet } from '../../city/lib/trade/wallet.ts';
import type { EarnPool, EarnPoolsAnswer } from '../../lib/earn-pools/model.ts';
import { useBins } from '../earn/range/useBins.ts';
import { priceText } from '../ui/figures.ts';
import { setLayer } from './chart-layer.ts';
import { depthLines, hasEdges, poolOfCoin, positionLines } from './pool-layer.ts';

/**
 * The pool over a coin's chart, behind one switch: the liquidity of the coin's deepest DLMM pool as strips
 * by the price scale, and the edges of the wallet's own pool positions as lines. Read only while the switch is on; the
 * switch is the person's and is kept on this device. A coin no listed pool holds has no switch at all.
 */

const KEY = 'ryntra.coin.pool-layer';
const POOLS_FRESH_MS = 120_000;
const POSITIONS_FRESH_MS = 60_000;

let poolsKept: Readonly<{ at: number; pools: readonly EarnPool[] }> | null = null;
let poolsAsked: Promise<readonly EarnPool[]> | null = null;

/** The engine's pools (`/api/v1/earn/pools`), kept two minutes for every chart on the page. */
function readPools(): Promise<readonly EarnPool[]> {
  if (poolsKept && Date.now() - poolsKept.at < POOLS_FRESH_MS) return Promise.resolve(poolsKept.pools);
  poolsAsked ??= fetch('/api/v1/earn/pools', { headers: { accept: 'application/json' } })
    .then((response) => (response.ok ? (response.json() as Promise<EarnPoolsAnswer>) : null))
    .then((body) => {
      const pools = Array.isArray(body?.pools) ? body.pools : [];
      if (pools.length) poolsKept = { at: Date.now(), pools };
      return pools;
    })
    .catch(() => poolsKept?.pools ?? [])
    .finally(() => {
      poolsAsked = null;
    });
  return poolsAsked;
}

export type PoolLayer = Readonly<{
  /** Whether the coin has a pool to draw at all: without one there is no switch. */
  there: boolean;
  on: boolean;
  setOn: (on: boolean) => void;
}>;

export function usePoolLayer(mint: string, coinUsd: number | null, lang: Lang): PoolLayer {
  const [on, setOnState] = useState(true);
  const [pools, setPools] = useState<readonly EarnPool[]>(() => poolsKept?.pools ?? []);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === '0') setOnState(false);
    } catch {
      // A browser that keeps nothing: the switch lasts the visit.
    }
    let live = true;
    void readPools().then((read) => {
      if (live) setPools(read);
    });
    return () => {
      live = false;
    };
  }, []);
  const setOn = (next: boolean) => {
    setOnState(next);
    try {
      window.localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      // The same.
    }
  };

  const found = useMemo(() => poolOfCoin(pools, mint), [pools, mint]);
  const bins = useBins('dlmm', on && found ? found.pool.address : null);
  const owner = useWallet((st) => st.connection?.address ?? null);
  const positions = useEarnData((st) => st.positions);
  const views = owner && positions?.owner === owner && positions.value.status === 'ready' ? positions.value.value : null;

  // The wallet's positions, where Earn is open here and nobody read them yet.
  useEffect(() => {
    if (!on || !owner || !EARN_OPEN) return;
    // Read once for the wallet, again when the last read failed or is older than a minute: a position opened or closed
    // elsewhere is not drawn from an old list.
    const kept = useEarnData.getState().positions;
    const stale = kept?.owner === owner && (kept.value.status === 'error' || (kept.value.status === 'ready' && Date.now() - kept.value.at > POSITIONS_FRESH_MS));
    if (kept?.owner !== owner || stale) void useEarnData.getState().loadPositions(owner);
  }, [on, owner]);

  // Drawn when the pool or the positions were read, at the coin's price of that moment: the chart is not redrawn every tick.
  const usdNow = useRef(coinUsd);
  useEffect(() => {
    usdNow.current = coinUsd;
  }, [coinUsd]);
  const priced = coinUsd !== null;
  const answer = bins.status === 'ready' ? bins.value : null;
  const side = found?.side ?? null;
  useEffect(() => {
    const lines = on && answer && side && priced ? depthLines(answer, side, usdNow.current) : [];
    setLayer(mint, 'liquidity', lines.length ? { lines, badge: null } : null);
  }, [on, answer, side, priced, mint]);
  useEffect(() => {
    const tag = (usd: number) => priceText(usd, lang).replace(/^\$/, '');
    const lines = on && views ? positionLines(views, mint, tag) : [];
    setLayer(mint, 'positions', lines.length ? { lines, badge: null } : null);
  }, [on, views, mint, lang]);
  useEffect(
    () => () => {
      setLayer(mint, 'liquidity', null);
      setLayer(mint, 'positions', null);
    },
    [mint],
  );

  // A position in a pool the list does not carry is still the person's to see: the switch stands for it too.
  const held = views !== null && views.some((view) => hasEdges(view, mint));
  return { there: found !== null || held, on, setOn };
}
