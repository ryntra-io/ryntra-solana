'use client';

import { useWords } from '@/city/lib/i18n/dict';
import { Page, PageHead } from '@/terminal/ui';
import { GridBot, type GridParts } from './Grid';
import { BotTabs, useWorking } from './head';
import { BOTS } from './words';
import g from './grid.module.css';

/**
 * «Grid» — a terminal with a chart, so a page of the kind «desk»: the whole working width, as a grid bot stands at
 * Binance, OKX, Pionex and KuCoin. The coin's chart with the grid over it on the left — the most of the width and of
 * the window's height, never lower than the form; the form on the right, the chart's whole height; the person's grids
 * under both, the whole width. The section's head and tabs are the other bots' own.
 */
export function GridScreen() {
  const w = useWords(BOTS);
  const working = useWorking();
  const lay = ({ chart, form, mine }: GridParts) => (
    <div className={g.desk} data-grid-desk="">
      <div className={g.deskChart} data-grid-desk-chart="">
        {chart}
      </div>
      <div className={g.deskForm} data-grid-desk-form="">
        {form}
      </div>
      <section className={g.deskMine}>{mine}</section>
    </div>
  );
  return (
    <Page kind="desk" data-bots="" data-bot="grid">
      <PageHead title={w.section} tabs={<BotTabs current="grid" working={working} />} />
      <GridBot lay={lay} />
    </Page>
  );
}
