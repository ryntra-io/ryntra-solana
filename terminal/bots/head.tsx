'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { LADDER_NET, useLadder, viewOf } from '@/city/lib/bots/ladder';
import { useBots } from '@/city/lib/bots/store';
import { useWords } from '@/city/lib/i18n/dict';
import { useAgentsData } from '@/terminal/agents/useAgentsData';
import { Tabs } from '@/terminal/ui';
import { BOTS_PATH, botDoors, botHref, botsOpen, type BotId } from './kinds';
import { rowBot } from './budget-bots';
import { netOf, useGrid } from './grid-store';
import { ladderRows, paperWorking } from './rows';
import { BOTS } from './words';
import { useCopies } from './copy-store';
import { copiesWorking } from './copy-view';
import b from './bots.module.css';

/**
 * How many bots of each kind work for the person now: the budget's from the engine's read, the ladders from the chain's
 * read of this browser's own, the grids and the paper ones from this browser.
 */
export function useWorking(): Readonly<Partial<Record<BotId, number>>> {
  const { rows, owner, views } = useAgentsData();
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
  const counts = useMemo(
    () => ({
      // A budget's bot counts on its own page — the grid that sells and signals — regular buys here.
      recurring: rows.filter((row) => row.role === 'trader' && row.state === 'working' && rowBot(row, views) === null).length,
      autopilot: rows.filter((row) => row.role === 'pilot' && row.state === 'working').length,
      ladder: ladderRows(ladders, owner, LADDER_NET).filter((ladder) => viewOf(ladder, reads, prices).state === 'working').length,
      // Each grid on its own venue's network, as «My grids» counts them: DLMM Pro's and the classic pool's.
      grid:
        (owner ? grids.filter((grid) => grid.owner === owner && netOf(grid.venue) !== null && grid.network === netOf(grid.venue) && grid.stoppedAt === null).length : 0) +
        rows.filter((row) => row.state === 'working' && rowBot(row, views) === 'grid').length,
      signals: paperWorking(bots, 'signals') + rows.filter((row) => row.state === 'working' && rowBot(row, views) === 'signals').length,
    }),
    [rows, views, owner, bots, ladders, reads, prices, grids],
  );

  // «Copy a wallet»: her copies as the engine keeps them for her proven wallet, read once wherever the tabs stand.
  const copies = useCopies((st) => (st.owner === owner ? st.rows : null));
  useEffect(() => {
    if (owner && useCopies.getState().owner !== owner) void useCopies.getState().follow(owner);
  }, [owner]);
  return useMemo(() => ({ ...counts, copy: copies ? copiesWorking(copies) : 0 }), [counts, copies]);
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
  const more = useTabsInView(current ?? 'all', items.length);
  return (
    <div ref={more.box} className={b.tabsBox} data-more={more.side ?? undefined} data-bot-tabs="">
      <Tabs<BotId | 'all'> bare label={w.views} value={current ?? 'all'} onChange={(id) => router.push(id === 'all' ? BOTS_PATH : botHref(id))} items={items} />
    </div>
  );
}

/**
 * A row of tabs wider than its screen (a phone: six tabs, four in view — QA 20.11, вада 24): the chosen one is scrolled
 * into view as the page opens, never left past the edge, and the edge with more tabs behind it fades — a quiet sign that
 * the row goes on. Only the row moves; the page never scrolls for it.
 */
function useTabsInView(chosen: string, count: number) {
  const box = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<'start' | 'end' | 'both' | null>(null);
  useEffect(() => {
    const row = box.current?.querySelector<HTMLElement>('[role="tablist"]');
    if (!row) return;
    // The row keeps the chosen tab in view as its words and counts come (the fonts, «2 working»), until the person
    // scrolls it herself.
    let held = false;
    let ours = false;
    const place = () => {
      const tab = row.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
      if (held || !tab || row.scrollWidth <= row.clientWidth + 1) return;
      const start = tab.offsetLeft - row.offsetLeft;
      const end = start + tab.offsetWidth;
      // The chosen tab whole in view, a little of its neighbour beside it: the row reads as one that goes on.
      if (start < row.scrollLeft || end > row.scrollLeft + row.clientWidth) {
        ours = true;
        row.scrollLeft = Math.max(0, end - row.clientWidth + Math.min(48, start));
      }
    };
    const read = () => {
      const before = row.scrollLeft > 1;
      const after = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      setSide(before && after ? 'both' : before ? 'start' : after ? 'end' : null);
    };
    const scrolled = () => {
      if (!ours) held = true;
      ours = false;
      read();
    };
    const resized = () => {
      place();
      read();
    };
    resized();
    row.addEventListener('scroll', scrolled, { passive: true });
    const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resized);
    sized?.observe(row);
    for (const tab of row.querySelectorAll('[role="tab"]')) sized?.observe(tab);
    return () => {
      row.removeEventListener('scroll', scrolled);
      sized?.disconnect();
    };
  }, [chosen, count]);
  return { box, side };
}
