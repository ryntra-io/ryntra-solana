'use client';

import { type ReactNode } from 'react';
import { useWords } from '@/city/lib/i18n/dict';
import { ActionBody, Page, PageHead } from '@/terminal/ui';
import { AutopilotBot, RecurringBot } from './Budget';
import { BotsCatalog } from './Catalog';
import { BotTabs, useOpenBots, useWorking } from './head';
import { isPaperBot, type FormBotId } from './kinds';
import { LadderBot } from './Ladder';
import { PaperBot, type BotParts } from './Paper';
import { BOTS } from './words';
import b from './bots.module.css';

/**
 * «Bots» — the section's page of the kind «action»: a form in its
 * container. Its own address is the catalogue of the bots (a card a bot — what it is for, the market it suits,
 * where it runs and how many of it work for the person — as a bot's catalogue stands at Pionex, OKX and Bybit); each
 * bot whose screen is a form — Recurring buys, the Order ladder, Signals, the Money autopilot — is a page of its own:
 * the form beside what helps it, then the person's bots of that kind. The Grid is a terminal with a chart: a page of
 * its own kind («desk», `GridScreen.tsx`). Every bot is a rule the person sets; the money moves only by her signature,
 * the paper ones not at all.
 */
export function BotsScreen({ bot }: { bot: FormBotId | null }) {
  const w = useWords(BOTS);
  const working = useWorking();
  const open = useOpenBots();

  const lay = (parts: BotParts): ReactNode => (
    <>
      <ActionBody side={parts.side} sideLabel={bot ? w[bot] : undefined}>
        {parts.form}
      </ActionBody>
      <ActionBody>{parts.mine}</ActionBody>
    </>
  );

  return (
    // The Grid's tab is a desk: the head stands on its line here too, so a turn of the tabs never moves it.
    <Page head="desk" data-bots="" data-bot={bot ?? 'all'}>
      <PageHead title={w.section} tabs={<BotTabs current={bot} working={working} />} />
      {bot === null ? (
        <ActionBody className={b.catalogBody}>
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
