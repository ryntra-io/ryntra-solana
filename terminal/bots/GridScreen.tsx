'use client';

import { useState, type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { Page, PageHead, Segment } from '@/terminal/ui';
import { BotBudget } from './BotBudget';
import { BOT_BUDGET } from './budget-words';
import { GridBot, type GridParts } from './Grid';
import { BotTabs, useOpenBots, useWorking } from './head';
import { BOTS } from './words';
import g from './grid.module.css';

/**
 * «Grid» — a terminal with a chart, so a page of the kind «desk»: the whole working width, as a grid bot stands at
 * Binance, OKX, Pionex and KuCoin. The coin's chart with the grid over it on the left — the most of the width and of
 * the window's height, never lower than the form; the form on the right, the chart's whole height; the person's grids
 * under both, the whole width. The section's head and tabs are the other bots' own.
 *
 * Two ways the grid trades, one switch over the form — «Orders»: the levels as limit orders on the chain, her
 * wallet signs; «Budget»: the agent buys each level and sells it one step up within her budget (`BotBudget`), on paper
 * first. The budget's way stands where the budget's engine does (the same door as «Recurring buys»).
 */
export function GridScreen() {
  const w = useWords(BOTS);
  const m = useWords(BOT_BUDGET);
  const working = useWorking();
  const budgetOpen = useOpenBots().includes('recurring');
  const [mode, setMode] = useState<'orders' | 'budget'>('orders');
  const lay = ({ chart, form, mine }: GridParts, top: ReactNode = null) => (
    <div className={g.desk} data-grid-desk="">
      <div className={g.deskChart} data-grid-desk-chart="">
        {chart}
      </div>
      <div className={g.deskForm} data-grid-desk-form="">
        {top}
        {form}
      </div>
      <section className={g.deskMine}>{mine}</section>
    </div>
  );
  const modes = budgetOpen ? (
    <Segment
      label={m.modeLabel}
      items={[
        { id: 'orders' as const, label: m.modeOrders },
        { id: 'budget' as const, label: m.modeBudget },
      ]}
      value={mode}
      onChange={setMode}
    />
  ) : null;
  return (
    <Page kind="desk" data-bots="" data-bot="grid" data-grid-mode={mode}>
      <PageHead title={w.section} tabs={<BotTabs current="grid" working={working} />} />
      {mode === 'budget' && budgetOpen ? <BotBudget bot="grid" lay={(parts) => lay(parts)} top={modes} /> : <GridBot lay={(parts) => lay(parts, modes)} />}
    </Page>
  );
}
