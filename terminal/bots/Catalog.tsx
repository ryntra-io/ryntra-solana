'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { pctOfBps } from '@/terminal/pool/pool-view';
import { Chip, Icon, Title } from '@/terminal/ui';
import { copyMoneyOpen } from '@/lib/wallet-watch/copy-agent';
import { BOT_IDS, botHref, isPaperBot, type BotId } from './kinds';
import { BotBadge } from './parts';
import { GRID_NET, MET_MINT, useGrid } from './grid-store';
import { BOTS } from './words';
import b from './bots.module.css';

type W = (typeof BOTS)['en'];

/** The catalogue's order is the tabs' over it and the menu's (QA 20.11, вада 36: Grid → Recurring here, Recurring → Grid
    in the tabs); the grid's card leads by its width, not by its place. */
const ORDER: readonly BotId[] = BOT_IDS;

/** The market each bot suits, in one tag — as the catalogues at Pionex, OKX and Bybit tag theirs. */
const FIT: Readonly<Record<BotId, 'fitSideways' | 'fitTrend' | 'fitAny'>> = { grid: 'fitSideways', recurring: 'fitAny', ladder: 'fitSideways', copy: 'fitAny', signals: 'fitTrend', autopilot: 'fitAny' };

/** Where a bot's orders stand, where it is one place. */
function runsOn(w: W, id: BotId): string | null {
  if (id === 'grid') return GRID_NET !== null ? w.runsMeteoraPro : w.runsMeteora;
  if (id === 'ladder') return w.runsMeteora;
  /* The copy with money opens only with the screen's switch. */
  if (id === 'copy' && copyMoneyOpen(process.env.NEXT_PUBLIC_RYNTRA_AGENT_COPY)) return w.copyMoneyKick;
  if (isPaperBot(id) || id === 'copy') return w.paperKick;
  return null;
}

/**
 * «All bots»: the section's own page, a card a bot that stands
 * here. A card says what the bot is for in one line, the market it suits, where its orders stand, and how many of it
 * work for the person now; the grid's card says the DLMM Pro maker's bonus as the engine reads it. A tap opens the bot.
 * Nothing on a card promises a result: no yield is drawn that a bot of the person's has not made.
 */
export function BotsCatalog({ open, working }: { open: readonly BotId[]; working: Readonly<Partial<Record<BotId, number>>> }) {
  const w = useWords(BOTS);
  const lang = useLang();
  const bonus = useGrid((st) => st.markets[MET_MINT]?.value?.bonus.ownerBps ?? null);
  const gridOpen = open.includes('grid');
  useEffect(() => {
    if (gridOpen && GRID_NET !== null) void useGrid.getState().loadMarket(MET_MINT);
  }, [gridOpen]);
  const shown = ORDER.filter((id) => open.includes(id));
  // How many cards stand decides the rows (QA 19.11, вада 19; QA 20.11, вада 109): on a desk of any width three to a row,
  // the grid's card taking what the row of three leaves — no hole at the end of a row, whichever bots are open here —
  // and on a wide desk the two rows stand taller.
  return (
    <div className={b.catalog} data-bots-catalog="" data-count={shown.length}>
      {shown.map((id) => {
        const runs = runsOn(w, id);
        const count = working[id] ?? 0;
        const lead = id === 'grid';
        return (
          <Link key={id} href={botHref(id)} className={b.catalogCard} data-lead={lead ? '' : undefined} data-bot-card={id}>
            <span className={b.catalogTop}>
              <BotBadge id={id} on={count > 0} />
              {count ? (
                <Chip tone="ok" dot>
                  {w.workingCount(digits(String(count), lang))}
                </Chip>
              ) : null}
            </span>
            <span className={b.catalogWords}>
              <Title as="h2" className={b.catalogName}>
                {w[id]}
              </Title>
              <span className={b.job}>{w[`${id}Job`]}</span>
            </span>
            <span className={b.catalogTags}>
              <span className={b.catalogTag}>{w[FIT[id]]}</span>
              {runs ? (
                <span className={b.catalogTag} data-tone={id === 'grid' && GRID_NET !== null ? 'pro' : undefined}>
                  {runs}
                </span>
              ) : null}
            </span>
            {lead && bonus !== null && bonus > 0 ? (
              <span className={b.catalogLive} data-bots-bonus="">
                {/* The bonus as the pool's page writes it (QA 19.11, вада 20: «+0.60%» here, «+0.6%» there). */}
                {w.bonusLine(digits(pctOfBps(bonus), lang))}
              </span>
            ) : null}
            <span className={b.catalogGo}>
              {w.setUp}
              <Icon name="arrow" size="s" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
