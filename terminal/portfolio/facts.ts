import { useEffect, useMemo, useState } from 'react';
import type { DepthAnswer, DepthCoin } from '@/lib/market-depth/model';
import type { PortfolioResponse } from '@/lib/api/v1/contract';
import { NATIVE_SOL_MINT, type MarketFact } from './all-view';

/** The market's list of named mints answers this many at a time. */
const PART = 50;
/** The most mints one wallet asks the market of: everything that works, then its coins, biggest first. */
const MOST = 150;
/** A fact read is kept this long for every wallet on the page, then asked again with the wallet's next read. */
const KEEP_MS = 5 * 60_000;

const kept = new Map<string, Readonly<{ at: number; fact: MarketFact | null }>>();

function factOf(coin: DepthCoin): MarketFact {
  const day = coin.stats?.['24h']?.change;
  return { symbol: coin.symbol || null, name: coin.name || null, icon: coin.icon, price: coin.price, dayPct: typeof day === 'number' && Number.isFinite(day) ? day : null };
}

async function readPart(mints: readonly string[]): Promise<void> {
  try {
    const res = await fetch(`/api/v1/market/depth?list=saved&mints=${mints.join(',')}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const body = (await res.json()) as DepthAnswer;
    const at = Date.now();
    const found = new Map((Array.isArray(body.coins) ? body.coins : []).map((coin) => [coin.id, coin]));
    // A mint the market does not know is kept as known-unknown: it is not asked again for a while.
    for (const mint of mints) {
      const coin = found.get(mint);
      kept.set(mint, { at, fact: coin ? factOf(coin) : null });
    }
  } catch {
    // The market silent: the rows keep the engine's own words and the logo route's picture.
  }
}

/**
 * The mints of a wallet worth asking the market of, in order: every coin of a pool, a stake or a loan (its side may
 * have no engine price), then the wallet's coins biggest first. Native SOL is asked by its wrapped mint.
 */
export function factMints(answer: Pick<PortfolioResponse, 'positions'> | null): string[] {
  if (!answer) return [];
  const works: string[] = [];
  const coins: string[] = [];
  for (const position of answer.positions) {
    if (position.state === 'unread') continue;
    const into = position.kind === 'coin' ? coins : works;
    for (const token of position.tokens) into.push(token.mint);
  }
  return [...new Set([...works, ...coins, NATIVE_SOL_MINT])].slice(0, MOST);
}

/**
 * What the market says of the wallet's coins — a name for a coin the engine could not name, the logo the market lists,
 * the price of a pool's side the engine left unpriced, and every coin's move over the day — read once, beside the
 * engine's answer (`/api/v1/market/depth`, the list of named mints the Market's «Saved» reads). Reads only.
 */
export function useFacts(answer: Pick<PortfolioResponse, 'positions' | 'at'> | null): (mint: string) => MarketFact | null {
  const mints = useMemo(() => factMints(answer), [answer]);
  const key = mints.join(',');
  // Each read of the wallet asks again what has grown old: the day's move and a pool's price stay of the hour.
  const stamp = answer?.at ?? '';
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!key) return;
    const now = Date.now();
    const ask = key.split(',').filter((mint) => {
      const had = kept.get(mint);
      return !had || now - had.at > KEEP_MS;
    });
    if (!ask.length) return;
    let live = true;
    const parts = Array.from({ length: Math.ceil(ask.length / PART) }, (_, at) => ask.slice(at * PART, at * PART + PART));
    void Promise.all(parts.map(readPart)).then(() => {
      if (live) setRound((was) => was + 1);
    });
    return () => {
      live = false;
    };
  }, [key, stamp]);
  // A new answer of the facts is a new function: the rows that read it are laid out again.
  return useMemo(() => {
    void round;
    return (mint: string) => kept.get(mint)?.fact ?? null;
  }, [round]);
}
