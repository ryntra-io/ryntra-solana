'use client';

import { useEffect, useMemo, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useMoneyStore } from '@/city/lib/money/store';
import { USDC } from '@/city/lib/trade/tiles';
import { useWallet } from '@/city/lib/trade/wallet';
import { iconOf } from '@/terminal/coin/Ticket';
import { recentRows, type Ago, type RecentRow } from '@/terminal/swap/swap-view';
import { RECENT } from '@/terminal/swap/words';
import { CoinLogo, Kick, Panel, Quiet } from '@/terminal/ui';
import { MONEY_WORDS } from './words';
import r from '@/terminal/swap/swap.module.css';

/** The rows shown at once, and all of them behind «All». */
const SHOWN = 5;
const ALL = 12;
/** The ledger read deep enough that a few swaps never hide the transfers under them. */
const READ = 50;
const CLOCK_MS = 30_000;

const logoOf = (mint: string | null): string | null => (mint === null ? null : mint === USDC.mint ? iconOf(USDC) : `/api/icon/${mint}`);

/**
 * «Recent transfers» beside the money's form: what this wallet sent, received and bridged through Ryntra, newest first —
 * the engine's own ledger as the money logic reads it (`city/lib/money/**`, `POST /api/solana/activity`), its swaps left
 * to the Swap. Read when the wallet comes and again whenever a transfer on this screen ends. The rows look as «Recent»
 * does on the Swap.
 */
export function Transfers() {
  const w = useWords(MONEY_WORDS);
  const rw = useWords(RECENT);
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

  const rows = useMemo(
    () => (activity.read ? recentRows(activity.read.actions, Math.max(now, activity.read.at), READ).filter((row) => row.kind !== 'swap').slice(0, ALL) : []),
    [activity.read, now],
  );
  const shown = all ? rows : rows.slice(0, SHOWN);
  const agoText = (ago: Ago): string =>
    ago.unit === 'now' ? rw.justNow : ago.unit === 'minutes' ? rw.minutes(String(ago.n)) : ago.unit === 'hours' ? rw.hours(String(ago.n)) : ago.unit === 'yesterday' ? rw.yesterday : rw.days(String(ago.n));
  const titleOf = (row: RecentRow): string => (row.kind === 'bridge' ? rw.bridge(row.from ?? 'USDC') : row.kind === 'send' ? rw.sent(row.from ?? '—') : rw.received(row.to ?? '—'));
  const pillOf = (row: RecentRow): string => (row.outcome === 'DONE' ? rw.done : row.outcome === 'FAILED' ? rw.failedPill : row.outcome === 'NEEDS_YOU' ? rw.needsYouPill : rw.movingPill);

  let body;
  if (!owner) body = <p className={r.recentLine}>{w.transfersConnect}</p>;
  else if (!activity.read && activity.status === 'failed')
    body = (
      <div className={r.recentBlank}>
        <p className={r.recentLine}>{rw.failed}</p>
        <Quiet size="s" onClick={() => void useMoneyStore.getState().readActivity()}>
          {rw.tryAgain}
        </Quiet>
      </div>
    );
  else if (!activity.read)
    body = (
      <div className={r.bones} aria-busy="true" aria-label={rw.reading}>
        <span />
        <span />
        <span />
      </div>
    );
  else if (!rows.length) body = <p className={r.recentLine}>{w.noTransfers}</p>;
  else
    body = (
      <ul className={r.recentRows}>
        {shown.map((row) => (
          <li key={row.id} className={r.recentRow}>
            <span className={r.pairLogos} aria-hidden="true">
              <CoinLogo src={logoOf(row.kind === 'receive' ? row.toMint : row.fromMint)} symbol={(row.kind === 'receive' ? row.to : row.from) ?? '?'} size="s" />
              {row.network ? <CoinLogo src={`/marks/networks/${row.network}.svg`} symbol={row.network} size="s" /> : null}
            </span>
            <span className={r.recentNames}>
              <b>{titleOf(row)}</b>
              <span>{agoText(row.ago)}</span>
            </span>
            <span className={r.recentAmount}>{row.amount ? digits(row.amount, lang) : '—'}</span>
            <span className={r.outcome} data-outcome={row.outcome}>
              {pillOf(row)}
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <Panel pad="none" edge label={w.recent} className={r.recent}>
      <div className={r.recentHead}>
        <Kick className={r.recentKick}>{w.recent}</Kick>
        {rows.length > SHOWN ? (
          <button type="button" className={r.recentAll} onClick={() => setAll((was) => !was)} aria-expanded={all}>
            {all ? rw.fewer : rw.all}
          </button>
        ) : null}
      </div>
      {body}
    </Panel>
  );
}
