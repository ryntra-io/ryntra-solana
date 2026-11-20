'use client';

import { type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { ActionBody, Page, PageHead } from '@/terminal/ui';
import { AutopilotBot, RecurringBot } from './Budget';
import { BotsCatalog } from './Catalog';
import { BotTabs, useOpenBots, useWorking } from './head';
import { isPaperBot, type DeskBotId } from './kinds';
import { LadderBot } from './Ladder';
import { PaperBot, type BotParts } from './Paper';
import { BOTS } from './words';
import b from './bots.module.css';
import g from './grid.module.css';

/**
 * «Bots» — the section's desk. Its own address is the catalogue of the bots
 * (a card a bot — what it is for, the market it suits, where it runs and how many of it work for the person —
 * as a bot's catalogue stands at Pionex, OKX and Bybit). Every bot is a terminal with a chart: Recurring buys, the Order ladder, Signals
 * and the Money autopilot stand as the Grid does (`GridScreen.tsx`) — the coin's chart, the terminal's own, the most of
 * the width and of the window's height on the left, the form on the right the chart's whole height, the person's bots
 * of that kind under both. Every bot is a rule the person sets; the money moves only by her signature, the paper ones
 * not at all.
 */
export function BotsScreen({ bot }: { bot: DeskBotId | null }) {
  const w = useWords(BOTS);
  const working = useWorking();
  const open = useOpenBots();

  // The Grid's desk: the chart and the form one height; under the form what helps it (the ladder's prices), under the
  // chart the person's bots — so nothing beside the form stretches the chart past the window.
  const lay = (parts: BotParts): ReactNode => (
    <div className={`${g.desk} ${b.botDesk}`} data-bot-desk="" data-side={parts.side ? '' : undefined}>
      <div className={g.deskChart}>{parts.chart}</div>
      <div className={g.deskForm}>{parts.form}</div>
      {parts.side ? <div className={b.deskSide}>{parts.side}</div> : null}
      <section className={g.deskMine}>{parts.mine}</section>
    </div>
  );

  return (
    // A desk, as the Grid's tab: the head stands on one line on every tab, the chart and the catalogue under it.
    <Page kind="desk" data-bots="" data-bot={bot ?? 'all'}>
      <PageHead title={w.section} tabs={<BotTabs current={bot} working={working} />} />
      {bot === null ? (
        <ActionBody className={b.wideBody}>
          <BotsCatalog open={open} working={working} />
        </ActionBody>
      ) : bot === 'recurring' ? (
        <RecurringBot lay={lay} />
      ) : bot === 'autopilot' ? (
        <AutopilotBot lay={lay} />
      ) : bot === 'ladder' ? (
        <LadderBot lay={lay} />
      ) : isPaperBot(bot) ? (
        <PaperBot key={bot} id={bot} lay={lay} />
      ) : null}
    </Page>
  );
}
