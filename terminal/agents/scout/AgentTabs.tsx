'use client';

import { useRouter } from 'next/navigation';
import { useWords } from '@/city/lib/i18n/dict';
import { MENU } from '@/terminal/shell/menu';
import { Tabs } from '@/terminal/ui';
import { SCOUT } from './words';

export type AgentTab = 'analyst' | 'scout' | 'trader';

/** The Scout stands on the shelf once its menu item does: one line in the menu turns both on. */
export const scoutReady = (): boolean => itemReady('scout');

/** The AI trader stands on the shelf once its menu item does. */
export const traderReady = (): boolean => itemReady('aiTrader');

function itemReady(id: string): boolean {
  return MENU.some((group) => group.items.some((item) => item.id === id && item.ready));
}

export const AGENT_HREF: Readonly<Record<AgentTab, string>> = { analyst: '/agent', scout: '/agent?ai=scout', trader: '/agent?ai=trader' };

/** The Agents shelf's tabs — the AI trader, the Scout and the analyst — at the head of every screen of it, in one place. */
export function AgentTabs({ value }: { value: AgentTab }) {
  const w = useWords(SCOUT);
  const router = useRouter();
  const items = [
    ...(traderReady() ? [{ id: 'trader' as const, label: w.trader }] : []),
    ...(scoutReady() ? [{ id: 'scout' as const, label: w.scout }] : []),
    { id: 'analyst' as const, label: w.analyst },
  ];
  if (items.length < 2) return null;
  return (
    <Tabs
      bare
      label={w.agents}
      value={value}
      onChange={(id: AgentTab) => {
        if (id !== value) router.push(AGENT_HREF[id]);
      }}
      // The menu's items are the shelf's tabs, by the same names and in their order.
      items={items}
    />
  );
}
