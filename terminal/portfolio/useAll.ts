import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEarnEngine } from '@/city/lib/earn/engine';
import { rangeMark } from '@/city/lib/earn/pier';
import type { PortfolioResponse } from '@/lib/api/v1/contract';
import { useMarket } from '@/terminal/shell/useMarket';
import { dayMove, groupsOf, summaryOf, withMarket, type DayMove, type Group, type MarketFact, type Summary } from './all-view';
import { useClean } from './clean';
import { useFacts } from './facts';

/** The portfolio is read again this often while the screen is in front. */
const AGAIN_MS = 60_000;
/** After something landed, the chain is read again — and once more for a network that lags. */
const AFTER_MS = [1_500, 7_000] as const;

export type AllRead = 'none' | 'reading' | 'ready' | 'failed';

export type AllData = Readonly<{
  /** The wallet on screen: the address looked at, or the connected one. */
  address: string | null;
  read: AllRead;
  /** A read is on its way over what stands on screen. */
  rereading: boolean;
  answer: PortfolioResponse | null;
  groups: readonly Group[];
  sum: Summary | null;
  day: DayMove | null;
  /** A pool position's range as one mark, by the position's address — where the venue states it. */
  ranges: ReadonlyMap<string, string>;
  /** A coin of the market by its mint: its name, its logo, its day's move. */
  coin: (mint: string) => Readonly<{ name: string | null; icon: string | null; dayPct: number | null }> | null;
  /** What the market's list of named mints says of a coin of this wallet: its symbol, name, logo, price and day. */
  fact: (mint: string) => MarketFact | null;
  /** Reads everything again now. */
  reread: () => void;
  /** Reads again after something landed: now, and once more for a network that lags. */
  landed: () => void;
}>;

async function getPortfolio(owner: string, refresh: boolean): Promise<PortfolioResponse | null> {
  try {
    const query = new URLSearchParams(refresh ? { owner, refresh: '1' } : { owner });
    const answer = await fetch(`/api/v1/portfolio?${query}`, { cache: 'no-store', headers: { accept: 'application/json', 'X-Ryntra-API': '1' } });
    if (!answer.ok) return null;
    const body = (await answer.json()) as PortfolioResponse;
    return body && body.owner === owner && Array.isArray(body.positions) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Everything the wallet on screen holds across Solana: the engine's one read (`GET /api/v1/portfolio?owner=`, public
 * data of a public address — so an address alone is enough), laid out as the screen's groups with the total. Beside it,
 * two reads the terminal already makes: the pool positions' ranges (the Earn screen's read) and the market's coins for
 * a name, a logo and the day's move. `agentsUsd` — what the person's agents hold, counted into the total.
 */
export function useAll(address: string | null, agentsUsd: number | null = null): AllData {
  const [kept, setKept] = useState<Readonly<{ owner: string; answer: PortfolioResponse | null; failed: boolean }> | null>(null);
  const [rereading, setRereading] = useState(false);
  const [ranges, setRanges] = useState<Readonly<{ owner: string; marks: ReadonlyMap<string, string> }> | null>(null);
  const round = useRef(0);

  const read = useCallback(
    async (refresh: boolean) => {
      if (!address) return;
      const mine = ++round.current;
      setRereading(true);
      const answer = await getPortfolio(address, refresh);
      if (mine !== round.current) return;
      setRereading(false);
      // A read that fell keeps the last good answer of the same wallet on screen.
      setKept((was) => (answer ? { owner: address, answer, failed: false } : was?.owner === address && was.answer ? was : { owner: address, answer: null, failed: true }));
    },
    [address],
  );

  useEffect(() => {
    round.current += 1;
    setRereading(false);
    if (!address) return;
    void read(false);
    const again = () => {
      if (document.visibilityState === 'visible') void read(false);
    };
    const timer = setInterval(again, AGAIN_MS);
    document.addEventListener('visibilitychange', again);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
    };
  }, [address, read]);

  const answer = address && kept?.owner === address ? kept.answer : null;
  const failed = Boolean(address && kept?.owner === address && kept.failed);

  // The ranges of the wallet's pool positions, once it is known to hold any: the venue's own bounds.
  const hasPools = Boolean(answer?.positions.some((position) => position.kind === 'pool' && position.refs.position));
  useEffect(() => {
    if (!address || !hasPools) return;
    let live = true;
    void createEarnEngine()
      .positions(address)
      .then((got) => {
        if (!live || !got.ok) return;
        const marks = new Map<string, string>();
        for (const view of got.value.positions) {
          const mark = rangeMark(view.lower, view.upper);
          if (mark) marks.set(view.address, mark);
        }
        setRanges({ owner: address, marks });
      });
    return () => {
      live = false;
    };
  }, [address, hasPools]);

  const landedTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      landedTimers.current.forEach(clearTimeout);
      landedTimers.current = [];
    },
    [address],
  );
  const reread = useCallback(() => void read(true), [read]);
  const landed = useCallback(() => {
    landedTimers.current.forEach(clearTimeout);
    landedTimers.current = AFTER_MS.map((ms) => setTimeout(() => void read(true), ms));
  }, [read]);

  // The coins a clean would burn: a coin without a price is dust only when the clean's own read says so.
  const cleanRead = useClean((st) => (address && st.owner === address ? st.read : null));
  const litter = useMemo(() => new Set((cleanRead?.items ?? []).filter((item) => item.kind === 'litter').map((item) => item.mint)), [cleanRead]);

  const towers = useMarket().towers;
  const market = useMemo(() => new Map(towers.map((tower) => [tower.id, tower])), [towers]);
  const fact = useFacts(answer);
  // The day's move of every coin with a price: the market's list of the wallet's own mints first, the towers after.
  const coin = useCallback(
    (mint: string) => {
      const tower = market.get(mint);
      const said = fact(mint);
      if (!tower && !said) return null;
      const towerDay = tower && Number.isFinite(tower.change24h) ? tower.change24h : null;
      return { name: said?.name ?? tower?.name ?? null, icon: tower?.icon ? `/api/icon/${tower.id}` : (said?.icon ?? null), dayPct: said?.dayPct ?? towerDay };
    },
    [market, fact],
  );

  return useMemo(() => {
    const groups = answer ? withMarket(groupsOf(answer, litter), fact) : [];
    const rows = groups.flatMap((group) => group.rows);
    return {
      address,
      read: !address ? 'none' : answer ? 'ready' : failed ? 'failed' : 'reading',
      rereading,
      answer,
      groups,
      sum: answer ? summaryOf(answer, groups, agentsUsd) : null,
      day: answer ? dayMove(rows, (mint) => coin(mint)?.dayPct ?? null) : null,
      ranges: address && ranges?.owner === address ? ranges.marks : new Map<string, string>(),
      coin,
      fact,
      reread,
      landed,
    };
  }, [address, answer, failed, rereading, litter, agentsUsd, ranges, coin, fact, reread, landed]);
}
