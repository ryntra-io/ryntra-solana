'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { LADDER_NET, useLadder, viewOf } from '@/city/lib/bots/ladder';
import { useBots } from '@/city/lib/bots/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useAgentsData } from '@/terminal/agents/useAgentsData';
import { Tabs } from '@/terminal/ui';
import { BOTS_PATH, botDoors, botHref, botsOpen, type BotId } from './kinds';
import { netOf, useGrid } from './grid-store';
import { ladderRows, paperWorking } from './rows';
import { BOTS } from './words';

/**
 * How many bots of each kind work for the person now: the budget's from the engine's read, the ladders from the chain's
 * read of this browser's own, the grids and the paper ones from this browser.
 */
export function useWorking(): Readonly<Partial<Record<BotId, number>>> {
  const { rows, owner } = useAgentsData();
  const bots = useBots((st) => st.bots);
  const ladders = useLadder((st) => st.ladders);
  const reads = useLadder((st) => st.reads);
  const prices = useLadder((st) => st.prices);
  const grids = useGrid((st) => st.grids);
  useEffect(() => {
    useBots.getState().hydrate();
    useLadder.getState().hydrate();
    useGrid.getState().hydrate();
  }, []);
  return useMemo(
    () => ({
      recurring: rows.filter((row) => row.role === 'trader' && row.state === 'working').length,
      autopilot: rows.filter((row) => row.role === 'pilot' && row.state === 'working').length,
      ladder: ladderRows(ladders, owner, LADDER_NET).filter((ladder) => viewOf(ladder, reads, prices).state === 'working').length,
      // Each grid on its own venue's network, as «My grids» counts them: DLMM Pro's and the classic pool's.
      grid: owner ? grids.filter((grid) => grid.owner === owner && netOf(grid.venue) !== null && grid.network === netOf(grid.venue) && grid.stoppedAt === null).length : 0,
      signals: paperWorking(bots, 'signals'),
    }),
    [rows, owner, bots, ladders, reads, prices, grids],
  );
}

/** The bots that stand on this deployment, in the menu's order. */
export function useOpenBots(): readonly BotId[] {
  return useMemo(() => botsOpen(botDoors()), []);
}

/**
 * The section's tabs: «All bots» — the catalogue — then each bot that stands, with how many of
 * it work. A tab is a page of its own: the browser's Back walks them.
 */
export function BotTabs({ current, working }: { current: BotId | null; working: Readonly<Partial<Record<BotId, number>>> }) {
  const w = useWords(BOTS);
  const router = useRouter();
  const open = useOpenBots();
  const items = [{ id: 'all' as const, label: w.all }, ...open.map((id) => ({ id, label: w[id], ...(working[id] ? { count: String(working[id]) } : {}) }))];
  return <Tabs<BotId | 'all'> bare label={w.views} value={current ?? 'all'} onChange={(id) => router.push(id === 'all' ? BOTS_PATH : botHref(id))} items={items} />;
}
