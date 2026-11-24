'use client';

import { type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { ActionBody, Page, PageHead } from '@/terminal/ui';
import { AutopilotBot, RecurringBot } from './Budget';
import { BotBudget } from './BotBudget';
import { useBots } from '@/city/lib/bots/store';
import { BotsCatalog } from './Catalog';
import { BotTabs, useOpenBots, useWorking } from './head';
import { isPaperBot, type DeskBotId } from './kinds';
import { LadderBot } from './Ladder';
import { CopyBot } from './Copy';
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
/**
 * The Grid's desk: the chart and the form one height; under the form what helps it (the ladder's prices), under the
 * chart the person's bots — so nothing beside the form stretches the chart past the window. The AI trader's plan on the
 * Agents shelf stands on the same desk.
 */
export function botDesk(parts: BotParts): ReactNode {
  return (
    <div className={`${g.desk} ${b.botDesk}`} data-bot-desk="" data-side={parts.side ? '' : undefined}>
      <div className={g.deskChart}>{parts.chart}</div>
      <div className={g.deskForm} data-bot-form="">
        {parts.form}
      </div>
      {parts.side ? <div className={b.deskSide}>{parts.side}</div> : null}
      <section className={g.deskMine} data-bot-mine="">
        {parts.mine}
      </section>
    </div>
  );
}

export function BotsScreen({ bot }: { bot: DeskBotId | null }) {
  const w = useWords(BOTS);
  const working = useWorking();
  const open = useOpenBots();
  // The Signals this browser practised before the budget came stay listed — only when there are any.
  const practice = useBots((st) => st.bots.some((one) => one.draft.kind === 'signal'));

  const lay = botDesk;

  return (
    // A desk, as the Grid's tab: the head stands on one line on every tab, the chart and the catalogue under it.
    <Page kind="desk" data-bots="" data-bot={bot ?? 'all'}>
      <PageHead title={w.section} tabs={<BotTabs current={bot} working={working} />} />
      {bot === null ? (
        <ActionBody className={b.wideBody}>
          <BotsCatalog open={open} working={working} />
        </ActionBody>
      ) : bot === 'copy' ? (
        <CopyBot lay={lay} />
      ) : bot === 'recurring' ? (
        <RecurringBot lay={lay} />
      ) : bot === 'autopilot' ? (
        <AutopilotBot lay={lay} />
      ) : bot === 'ladder' ? (
        <LadderBot lay={lay} />
      ) : bot === 'signals' && open.includes('recurring') ? (
        // Signals on the budget — the week on paper at live prices, then money; the person's bots of this
        // browser's practice stay listed under hers.
        <BotBudget bot="signals" lay={(parts) => lay({ ...parts, mine: practice ? [parts.mine, <PaperBot key="practice" id="signals" lay={(own) => own.mine} />] : parts.mine })} />
      ) : isPaperBot(bot) ? (
        <PaperBot key={bot} id={bot} lay={lay} />
      ) : null}
    </Page>
  );
}
