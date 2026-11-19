'use client';

import { Fragment, useId, useState, type ReactNode } from 'react';
import { CoinLogo, Figure, Icon, cx } from '@/terminal/ui';
import type { Coin, Risk } from './rows';
import e from './earn.module.css';

/** A coin's logo through Ryntra's own icon address, as every screen draws it. */
/** USDC's own logo, kept with the site: the engine's logo proxy serves the market's coins and answers nothing for USDC. */
const USDC = { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', logo: '/site/universe/USDC.png' } as const;

export const iconOf = (mint: string): string => (mint === USDC.mint ? USDC.logo : `/api/icon/${mint}`);

/**
 * Where a coin's logo is asked next when the engine's route has none (DLMM Pro's list was letters: the route
 * answers nothing for a coin that is no market tower): the catalogue's own logo through the engine, by the coin's
 * address. The letter only when neither loads.
 */
export const iconsAfter = (mint: string): readonly string[] => (mint === USDC.mint ? [] : [`/api/spot/icon?mint=${encodeURIComponent(mint)}`]);

/** One coin's logo, or a pair's two with the second over the first's edge. */
export function Pair({ coins, size = 'm' }: { coins: readonly Coin[]; size?: 'm' | 'l' }) {
  return (
    <span className={e.pair} aria-hidden="true">
      {coins.map((coin) => (
        <CoinLogo key={coin.mint} src={iconOf(coin.mint)} also={iconsAfter(coin.mint)} symbol={coin.symbol} size={size} />
      ))}
    </span>
  );
}

/** Risk as one to three amber dots; its words are the label a screen reader says. */
export function RiskDots({ dots, label }: { dots: Risk; label: string }) {
  return (
    <span className={e.risk} role="img" aria-label={label}>
      {[1, 2, 3].map((n) => (
        <i key={n} data-on={n <= dots ? '' : undefined} />
      ))}
    </span>
  );
}

/* The three signs of the screen's panels, on the kit's own grid and stroke. */
const SIGNS = {
  pools: <path d="M3 9c2 0 2 2 4.5 2S10 9 12 9s2 2 4.5 2S19 9 21 9M3 15c2 0 2 2 4.5 2s2.5-2 4.5-2 2 2 4.5 2 2.5-2 4.5-2" />,
  staking: <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" />,
  lending: <path d="M4 10l8-5 8 5M6 10v8M10 10v8M14 10v8M18 10v8M4 20h16" />,
} as const;

export function Sign({ name }: { name: keyof typeof SIGNS }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {SIGNS[name]}
    </svg>
  );
}

/** The one line before a signature — the fee and the band — with everything else behind its «i», opened in place. */
export function OneLine({ line, label, children }: { line: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div className={e.oneLine}>
        <span>{line}</span>
        <button type="button" className={e.infoBtn} aria-label={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((was) => !was)}>
          <Icon name="info" size="s" />
        </button>
      </div>
      {open ? (
        <div id={id} role="note" className={e.details}>
          {children}
        </div>
      ) : null}
    </>
  );
}

/** Names and their figures, two columns; a row without a figure is left out. */
export function Facts({ rows }: { rows: readonly (readonly [string, string | null])[] }) {
  const shown = rows.filter((row): row is readonly [string, string] => row[1] !== null && row[1] !== '');
  if (!shown.length) return null;
  return (
    <dl className={e.kv}>
      {shown.map(([name, value]) => (
        <Fragment key={name}>
          <dt>{name}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** One honest line under the form: amber for a warning, flare for a refusal. */
export function Note({ tone = 'warn', children }: { tone?: 'warn' | 'error' | 'plain'; children: ReactNode }) {
  return (
    <p className={e.note} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  );
}

/** The ticket's head: what it is about, its second line, and its one figure with what the figure is. */
export function TicketHead({ coins, name, sub, figure, figureCap, tone, extra }: { coins: readonly Coin[]; name: string; sub?: string | null; figure?: string | null; figureCap?: string; tone?: 'up' | 'down'; extra?: ReactNode }) {
  return (
    <div className={e.tHead}>
      <Pair coins={coins} size="l" />
      <div className={e.tWords}>
        <span className={cx(e.sym, e.symL)}>{name}</span>
        {extra ? (
          <span className={e.subRow}>
            {extra}
            {sub ? <span className={e.cap}>{sub}</span> : null}
          </span>
        ) : sub ? (
          <span className={e.cap}>{sub}</span>
        ) : null}
      </div>
      {figure ? (
        <div className={e.tSide}>
          <Figure value={figure} size="s" tone={tone} />
          {figureCap ? <span className={e.cap}>{figureCap}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** How an action ended: its word, one line, and where to read it on the chain. */
export function Result({ word, line, good, link, linkLabel, extra }: { word: string; line?: string | null; good: boolean; link?: string | null; linkLabel?: string; extra?: ReactNode }) {
  return (
    <div className={e.result} role="status">
      {good ? <Figure value={word} size="m" tone="up" /> : <p className={e.resultLine}>{word}</p>}
      {line ? <p className={e.resultLine}>{line}</p> : null}
      {extra}
      {link ? (
        <a className={e.link} href={link} target="_blank" rel="noreferrer">
          {linkLabel}
        </a>
      ) : null}
    </div>
  );
}
