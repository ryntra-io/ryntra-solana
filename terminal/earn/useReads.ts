import { useEffect, useMemo } from 'react';
import type { PositionView } from '../../lib/liquidity/catalog/positions.ts';
import { DOLLAR_ASSETS, type DollarMarket, type DollarPosition } from '../../city/lib/earn/dollar.ts';
import { DOLLAR_OPEN } from '../../city/lib/earn/dollar-gate.ts';
import { useDollar } from '../../city/lib/earn/dollar-store.ts';
import { entriesOf } from '../../city/lib/earn/device.ts';
import { EARN_OPEN } from '../../city/lib/earn/flag.ts';
import { LSTS } from '../../city/lib/earn/lst.ts';
import { lstHolding, type LstHolding } from '../../city/lib/earn/mine.ts';
import { PIER_MODE } from '../../city/lib/earn/pier-gate.ts';
import { PIER_LOCKED, usePier } from '../../city/lib/earn/pier-store.ts';
import { EARN_PRO_OPEN, proOffered, type ProBoat, type ProPier } from '../../city/lib/earn/pro.ts';
import { useProPier } from '../../city/lib/earn/pro-store.ts';
import { useSaver } from '../../city/lib/earn/saver-store.ts';
import { useEarnData } from '../../city/lib/earn/store.ts';
import { useWallet } from '../../city/lib/trade/wallet.ts';
import { mayAdd } from './ticket.ts';
import { poolRows, positionRows, proPoolRows, stakeRows, totals, venueSolUsd, type PoolRow, type PositionRow, type StakeRow } from './rows.ts';

/** The wallet the screen last read for, across visits of the page; undefined before the first. */
let lastOwner: string | null | undefined;

/** How many Earn screens are mounted: a width set by hand lives only while one is. */
let onEarn = 0;

/** The Earn screen's own: while it is mounted a width set by hand stands; leaving gives it back (`giveWidthBack`). */
export function useWidthGivenBack(): void {
  useEffect(() => {
    onEarn += 1;
    return () => {
      onEarn -= 1;
      giveWidthBack();
    };
  }, []);
}

/**
 * Leaving the screen gives a hand-set width back to the style, so the city's card of the same pool never stands on a
 * width it does not show. A form whose figures are still being built lets them go; a card that carries an outcome keeps
 * it untouched — only the width goes; while a signature is out nothing moves, and the width goes once it is over,
 * unless the person is back on the screen by then.
 */
export function giveWidthBack(): void {
  const st = usePier.getState();
  if (st.half === null) return;
  if (PIER_LOCKED.has(st.phase)) {
    const off = usePier.subscribe((next) => {
      if (PIER_LOCKED.has(next.phase)) return;
      off();
      if (onEarn === 0 && usePier.getState().half !== null) usePier.setState({ half: null, reviewed: null });
    });
    return;
  }
  if (st.outcome) return usePier.setState({ half: null });
  if (st.phase === 'reviewing') usePier.setState({ phase: 'idle' });
  usePier.getState().setHalf(null);
}

/** How often the lists and the wallet's positions are read again while the screen is in view. */
const AGAIN_MS = 60_000;

/**
 * The screen's reads, the city's own and by its rules: the pools and the staking rates for everybody, and for the
 * connected wallet what it may do here, its positions, its lending and its Pro positions. Each store keeps a fresh
 * answer and skips a second call; a read that failed is said as failed, never drawn as an empty list.
 */
export function useEarnReads(owner: string | null): void {
  useEffect(() => {
    const read = () => {
      if (document.visibilityState !== 'visible') return;
      if (EARN_OPEN) {
        void useEarnData.getState().loadFeed();
        void useEarnData.getState().loadPiers();
      }
      void useProPier.getState().loadPiers();
    };
    read();
    const timer = setInterval(read, AGAIN_MS);
    document.addEventListener('visibilitychange', read);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', read);
    };
  }, []);

  // A width set by hand is this screen's own: leaving it gives the width back to the style, so the city's card of the
  // same pool never signs a width it does not show. Never while a signature is out — the store refuses it itself.
  // Another wallet: what the last one could do and held is not this one's. The same wallet back on the screen keeps what
  // its last action ended in — an outcome not read to its end stays on its card.
  useEffect(() => {
    useEarnData.getState().follow(EARN_OPEN ? owner : null);
    if (owner !== lastOwner) {
      usePier.getState().forget();
      useProPier.getState().forget();
      // An order built for the last wallet is not this one's to sign.
      const saver = useSaver.getState().phase;
      if (lastOwner !== undefined && (saver === 'idle' || saver === 'done' || saver === 'failed')) useSaver.getState().again();
      lastOwner = owner;
    }
    if (owner && EARN_OPEN && PIER_MODE !== 'closed') void usePier.getState().loadStates(owner);
    if (DOLLAR_OPEN && EARN_OPEN) void useDollar.getState().load(owner);
    if (!owner) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (EARN_OPEN && usePier.getState().phase === 'idle') void useEarnData.getState().loadPositions(owner);
      if (useProPier.getState().phase === 'idle') void useProPier.getState().loadBoats(owner);
    }, AGAIN_MS);
    return () => clearInterval(timer);
  }, [owner]);

  // The Pro positions are asked for once the Pro pools answered: a server that does not serve them is never asked.
  const proReady = useProPier((st) => st.list.status === 'ready');
  useEffect(() => {
    if (owner && proReady) void useProPier.getState().loadBoats(owner);
  }, [owner, proReady]);
}

/** After an action landed: the wallet's coins and its positions are read again, and once more for a network that lags. */
const AFTER_MS = [1_500, 7_000] as const;

export function useRefreshAfter(landed: boolean, owner: string | null): void {
  useEffect(() => {
    if (!landed || !owner) return;
    useWallet.getState().refreshHoldings(AFTER_MS);
    const timers = AFTER_MS.map((ms) =>
      setTimeout(() => {
        if (EARN_OPEN) void useEarnData.getState().loadPositions(owner);
        void useProPier.getState().loadBoats(owner, true);
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [landed, owner]);
}

export type EarnFigures = Readonly<{
  pools: readonly PoolRow[];
  poolsRead: 'reading' | 'ready' | 'failed';
  stakes: readonly StakeRow[];
  /** Whether staking's and lending's rates are still on their way. */
  yieldRead: 'reading' | 'ready';
  /** The lending market of dollars: its rate now, or null when lending is not open here or was not read. */
  lendRate: number | null;
  /** Whether this wallet (or a guest) is offered to add to the city's pools. */
  addOpen: boolean;
  /** New money is stopped by the switch; taking out works. */
  paused: boolean;
  /** Whether this wallet may take fees from and leave a pool position through here. */
  exitOpen: boolean;
  lendOpen: boolean;
  positions: readonly PositionRow[];
  positionsRead: 'guest' | 'reading' | 'ready' | 'failed';
  working: number | null;
  earned: number | null;
  solPriceUsd: number | null;
  views: readonly PositionView[];
  staked: readonly LstHolding[];
  lent: readonly DollarPosition[];
  markets: Readonly<Partial<Record<'USDC' | 'SOL', DollarMarket | null>>>;
  /** The Pro pools a new position is offered in here (where the terminal opens it). */
  proPiers: readonly ProPier[];
  /** Every Pro pool the engine serves: the pool of a position the wallet holds is found here, offered or not. */
  proAll: readonly ProPier[];
  proBoats: readonly ProBoat[];
}>;

const NO_MARKETS = {} as const;

/** Everything the screen draws, from the stores the reads above fill. */
export function useEarnFigures(owner: string | null): EarnFigures {
  const piers = useEarnData((st) => st.piers);
  const feed = useEarnData((st) => st.feed);
  const positions = useEarnData((st) => st.positions);
  const lots = useEarnData((st) => st.lots);
  const states = usePier((st) => st.states);
  const surface = useDollar((st) => st.surface);
  const proList = useProPier((st) => st.list);
  const proBoatsFor = useProPier((st) => st.boats);
  const holdings = useWallet((st) => st.holdings);
  const holdingsRead = useWallet((st) => st.holdingsRead);

  return useMemo(() => {
    const pools = piers.status === 'ready' ? piers.value.pools : [];
    const solPriceUsd = venueSolUsd(pools);
    const proAll = EARN_PRO_OPEN && proList.status === 'ready' ? proList.value.piers : [];
    // A new position is offered where the terminal opens it; a position held is shown wherever it is.
    const proPiers = proList.status === 'ready' ? proAll.filter((pier) => proOffered(pier, proList.value.network)) : proAll;
    const rows = [...poolRows(pools), ...proPoolRows(proPiers, solPriceUsd)];
    const poolsRead = piers.status === 'ready' ? 'ready' : piers.status === 'error' || !EARN_OPEN ? (rows.length ? 'ready' : 'failed') : 'reading';

    const feedValue = feed.status === 'ready' ? feed.value : null;
    const stakes = feedValue ? stakeRows(feedValue.lsts) : [];

    const waiting = (status: string) => status === 'idle' || status === 'loading';
    const yieldRead = (EARN_OPEN && waiting(feed.status)) || (DOLLAR_OPEN && waiting(surface.status)) ? 'reading' : 'ready';
    const lend = DOLLAR_OPEN && surface.status === 'ready' ? surface.value : null;
    const lendRate = lend?.provider ? (lend.markets.USDC?.rate ?? null) : null;
    const lendOpen = lendRate !== null && (owner === null || lend?.owner !== owner || lend.actions.open);

    const mine = owner && states?.owner === owner ? states.value : null;
    const addOpen = mayAdd(PIER_MODE, mine?.add === 'on') && !(mine !== null && mine.add !== 'on' && !mine.stopped && mine.exit !== 'on');
    const paused = Boolean(mine?.stopped);
    const exitOpen = mine?.exit === 'on';

    const held = owner && holdings?.owner === owner ? holdings : null;
    const views = owner && positions?.owner === owner && positions.value.status === 'ready' ? positions.value.value : [];
    const myLots = owner && lots?.owner === owner ? lots.lots : [];
    const staked = held
      ? LSTS.flatMap((lst) => {
          const balance = held.tokens.get(lst.mint);
          return balance && BigInt(balance.spendableRaw) > 0n ? [lstHolding(lst.id, BigInt(balance.spendableRaw), feedValue, myLots)] : [];
        })
      : [];
    const lent = owner && lend?.owner === owner ? DOLLAR_ASSETS.flatMap((asset) => (lend.positions[asset] ? [lend.positions[asset]] : [])) : [];
    const markets = lend ? lend.markets : NO_MARKETS;
    const proBoats = owner && proAll.length && proBoatsFor?.owner === owner && proBoatsFor.value.status === 'ready' ? proBoatsFor.value.value : [];
    const entries = owner && typeof window !== 'undefined' ? entriesOf(owner) : new Map();
    const table = positionRows({ views, entries, staked, lent, markets, proBoats, proPiers: proAll, solPriceUsd });

    const viewsRead = positions?.owner === owner ? positions.value.status : 'loading';
    const positionsRead: EarnFigures['positionsRead'] = !owner
      ? 'guest'
      : table.length
        ? 'ready'
        : !EARN_OPEN || (viewsRead === 'ready' && held)
          ? 'ready'
          : viewsRead === 'error' || holdingsRead === 'failed'
            ? 'failed'
            : 'reading';
    const sums = totals(table);
    return { pools: rows, poolsRead, stakes, yieldRead, lendRate, addOpen, paused, exitOpen, lendOpen, positions: table, positionsRead, working: sums.workingUsd, earned: sums.earnedUsd, solPriceUsd, views, staked, lent, markets, proPiers, proAll, proBoats };
  }, [piers, feed, positions, lots, states, surface, proList, proBoatsFor, holdings, holdingsRead, owner]);
}
