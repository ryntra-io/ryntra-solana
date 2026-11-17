'use client';

import { useEffect, useMemo, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useMoneyStore } from '@/city/lib/money/store';
import { USDC } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { iconOf } from '@/terminal/coin/Ticket';
import { CoinLogo, Kick, Panel, Quiet, cx } from '@/terminal/ui';
import { recentRows, type Ago, type RecentRow } from './swap-view';
import { RECENT } from './words';
import s from './swap.module.css';

/** The rows shown at once, and all of them behind «All». */
const SHOWN = 4;
const ALL = 12;
/** «just now» becomes «2 min ago» on its own. */
const CLOCK_MS = 30_000;

/** A coin's logo by its mint: USDC's own, the rest through the engine's logo proxy. */
const logoOf = (mint: string | null): string | null => (mint === null ? null : mint === USDC.mint ? iconOf(USDC) : `/api/icon/${mint}`);

/**
 * «Recent»: what this wallet swapped, sent, bridged and received through Ryntra, newest first — the engine's own ledger
 * as the money window reads it (`city/lib/money/**`, `POST /api/solana/activity`). Read when the wallet comes and again
 * whenever a swap, a transfer or a bridge on this screen ends. `title`: a screen that names the list its own way (the
 * Portfolio's «Recent activity»).
 */
export function Recent({ title, edge = false }: { title?: string; edge?: boolean }) {
  const w = useWords(RECENT);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const activity = useMoneyStore((st) => st.activity);
  const following = useMoneyStore((st) => st.owner);
  const [all, setAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (owner && following === owner) void useMoneyStore.getState().readActivity();
  }, [owner, following]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  // The clock is never behind the read it words: a row read a moment ago is never «in the future».
  const rows = useMemo(() => (activity.read ? recentRows(activity.read.actions, Math.max(now, activity.read.at), ALL) : []), [activity.read, now]);
  const shown = all ? rows : rows.slice(0, SHOWN);
  const agoText = (ago: Ago): string =>
    ago.unit === 'now' ? w.justNow : ago.unit === 'minutes' ? w.minutes(String(ago.n)) : ago.unit === 'hours' ? w.hours(String(ago.n)) : ago.unit === 'yesterday' ? w.yesterday : w.days(String(ago.n));
  const titleOf = (row: RecentRow): string => {
    const coin = row.kind === 'receive' ? row.to : row.from;
    if (row.kind === 'swap') return `${row.from ?? '—'} → ${row.to ?? '—'}`;
    if (row.kind === 'bridge') return w.bridge(coin ?? 'USDC');
    return row.kind === 'send' ? w.sent(coin ?? '—') : w.received(coin ?? '—');
  };
  const pillOf = (row: RecentRow): string => (row.outcome === 'DONE' ? w.done : row.outcome === 'FAILED' ? w.failedPill : row.outcome === 'NEEDS_YOU' ? w.needsYouPill : w.movingPill);

  let body;
  if (!owner) body = <p className={s.recentLine}>{w.connect}</p>;
  else if (!activity.read && activity.status === 'failed')
    body = (
      <div className={s.recentBlank}>
        <p className={s.recentLine}>{w.failed}</p>
        <Quiet size="s" onClick={() => void useMoneyStore.getState().readActivity()}>
          {w.tryAgain}
        </Quiet>
      </div>
    );
  else if (!activity.read)
    body = (
      <div className={s.bones} aria-busy="true" aria-label={w.reading}>
        <span />
        <span />
        <span />
      </div>
    );
  else if (!rows.length) body = <p className={s.recentLine}>{w.none}</p>;
  else
    body = (
      <ul className={s.recentRows}>
        {shown.map((row) => {
          return (
            <li key={row.id} className={s.recentRow}>
              <span className={s.pairLogos} aria-hidden="true">
                {/* A receipt has no coin that left: its logo is the coin that came. */}
                <CoinLogo src={logoOf(row.kind === 'receive' ? row.toMint : row.fromMint)} symbol={(row.kind === 'receive' ? row.to : row.from) ?? '?'} size="s" />
                {row.kind === 'swap' ? <CoinLogo src={logoOf(row.toMint)} symbol={row.to ?? '?'} size="s" /> : row.network ? <CoinLogo src={`/marks/networks/${row.network}.svg`} symbol={row.network} size="s" /> : null}
              </span>
              <span className={s.recentNames}>
                <b>{titleOf(row)}</b>
                <span>{agoText(row.ago)}</span>
              </span>
              <span className={s.recentAmount}>{row.amount ? digits(row.amount, lang) : '—'}</span>
              <span className={s.outcome} data-outcome={row.outcome}>
                {pillOf(row)}
              </span>
            </li>
          );
        })}
      </ul>
    );

  return (
    <Panel pad="none" edge={edge} label={title ?? w.title} className={s.recent}>
      <div className={s.recentHead}>
        <Kick className={s.recentKick}>{title ?? w.title}</Kick>
        {rows.length > SHOWN ? (
          <button type="button" className={cx(s.recentAll)} onClick={() => setAll((was) => !was)} aria-expanded={all}>
            {all ? w.fewer : w.all}
          </button>
        ) : null}
      </div>
      {body}
    </Panel>
  );
}
