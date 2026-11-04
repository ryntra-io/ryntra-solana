'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCity } from '@/city/lib/city/store';
import { useLang } from '@/city/lib/i18n/lang';
import { isNamed, type Tower } from '@/city/lib/market/types';
import { runOf, statusOf, type BotStatus, type PaperBot } from '@/city/lib/bots/hangar';
import { useBots, type Coin } from '@/city/lib/bots/store';
import type { Run } from '@/city/lib/bots/sim';
import { WORDS, type Words } from '@/city/lib/bots/words';
import type { Lang } from '@/city/lib/bots/format';

/** The window's words in the city's language (CITY-79): the switch in the menu repaints them in place. */
export function useWords(): Readonly<{ w: Words; lang: Lang }> {
  const lang = useLang();
  return { w: WORDS[lang], lang };
}

export const coinOf = (tower: Pick<Tower, 'id' | 'symbol' | 'price'>): Coin => ({ mint: tower.id, symbol: tower.symbol, price: tower.price });

/** The named towers a bot can run on, deepest first: the coin picker's list. */
export function useCoins(limit = 8): Tower[] {
  const towers = useCity((s) => s.snapshot.towers);
  return useMemo(() => towers.filter((t) => isNamed(t) && t.price > 0).sort((a, b) => b.volume24h - a.volume24h).slice(0, limit), [towers, limit]);
}

/** The hub's coin: the one chosen in the window, else the tower picked in the city, else SOL, else the deepest named tower. */
export function useCoin(): Coin | null {
  const chosen = useBots((s) => s.mint);
  const selected = useCity((s) => s.selectedId);
  const towers = useCity((s) => s.snapshot.towers);
  return useMemo(() => {
    const named = towers.filter((t) => isNamed(t) && t.price > 0);
    const pick = (id: string | null) => (id ? named.find((t) => t.id === id) : undefined);
    const tower = pick(chosen) ?? pick(selected) ?? named.find((t) => t.symbol === 'SOL') ?? [...named].sort((a, b) => b.volume24h - a.volume24h)[0];
    return tower ? coinOf(tower) : null;
  }, [chosen, selected, towers]);
}

/** A coin by its mint, from the city's towers; null when the tower is gone. */
export function useCoinByMint(): (mint: string) => Coin | null {
  const towers = useCity((s) => s.snapshot.towers);
  return useMemo(() => {
    const byId = new Map(towers.map((t) => [t.id, t]));
    return (mint: string) => {
      const t = byId.get(mint);
      return t && t.price > 0 ? coinOf(t) : null;
    };
  }, [towers]);
}

/** The hour, a minute at a time: runs and ages move on while the window is open. */
export function useNow(stepMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(timer);
  }, [stepMs]);
  return now;
}

export type BotRow = Readonly<{ bot: PaperBot; status: BotStatus; run: Run | null }>;

/** Every bot of the hangar with its status and what it did, and the market paths it needs read. */
export function useBotRows(): BotRow[] {
  const bots = useBots((s) => s.bots);
  const strategies = useBots((s) => s.strategies);
  const paths = useBots((s) => s.paths);
  const towers = useCity((s) => s.snapshot.towers);
  const coinBy = useCoinByMint();
  // Bars of the coins the bots run on, read once each.
  useEffect(() => {
    const seen = new Set<string>();
    for (const b of bots) {
      if (seen.has(b.draft.pair.mint)) continue;
      seen.add(b.draft.pair.mint);
      const coin = coinBy(b.draft.pair.mint);
      if (coin) void useBots.getState().loadPath(coin);
    }
  }, [bots, coinBy]);
  return useMemo(() => {
    const mints = towers.length ? new Set(towers.map((t) => t.id)) : null;
    const ids = new Set(strategies.map((s) => s.id));
    return bots.map((bot) => {
      const status = statusOf(bot, { mints, strategies: ids });
      const path = paths[bot.draft.pair.mint];
      return { bot, status, run: path && path.status === 'ready' ? runOf(bot, path.bars) : null };
    });
  }, [bots, strategies, paths, towers]);
}
