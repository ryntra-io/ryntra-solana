'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { Chip, Icon, Title } from '@/terminal/ui';
import { botHref, isPaperBot, type BotId } from './kinds';
import { BotBadge } from './parts';
import { GRID_NET, MET_MINT, useGrid } from './grid-store';
import { BOTS } from './words';
import b from './bots.module.css';

type W = (typeof BOTS)['en'];

/** The catalogue's order: the grid first, as a grid bot leads every exchange's catalogue; then the menu's order. */
const ORDER: readonly BotId[] = ['grid', 'recurring', 'ladder', 'signals', 'autopilot'];

/** The market each bot suits, in one tag — as the catalogues at Pionex, OKX and Bybit tag theirs. */
const FIT: Readonly<Record<BotId, 'fitSideways' | 'fitTrend' | 'fitAny'>> = { grid: 'fitSideways', recurring: 'fitAny', ladder: 'fitSideways', signals: 'fitTrend', autopilot: 'fitAny' };

/** Where a bot's orders stand, where it is one place. */
function runsOn(w: W, id: BotId): string | null {
  if (id === 'grid') return GRID_NET !== null ? w.runsMeteoraPro : w.runsMeteora;
  if (id === 'ladder') return w.runsMeteora;
  if (isPaperBot(id)) return w.paperKick;
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
  return (
    <div className={b.catalog} data-bots-catalog="">
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
                {w.bonusLine(digits((bonus / 100).toFixed(2), lang))}
              </span>
            ) : null}
            {lead ? <GridPicture /> : null}
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

/** The grid's card picture: the band's levels, buys under the price and sells over it — the bot's own shape, drawn. */
function GridPicture() {
  const levels = [12, 22, 32, 42, 58, 68, 78, 88];
  return (
    <svg className={b.catalogPicture} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {levels.map((y) => (
        <line key={y} x1={0} x2={100} y1={y} y2={y} className={y < 50 ? b.pictureSell : b.pictureBuy} vectorEffect="non-scaling-stroke" />
      ))}
      <polyline points="0,62 10,54 18,66 27,47 36,58 45,40 54,55 63,36 72,51 81,44 90,57 100,49" className={b.picturePrice} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
