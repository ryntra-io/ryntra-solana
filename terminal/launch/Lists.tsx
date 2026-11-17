'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { LaunchMarketRow } from '@/lib/api/v1/contract';
import { num } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { launchEngine } from '@/city/lib/launch/district';
import { pct } from '@/city/lib/launch/format';
import { coinHref } from '@/terminal/shell/shelves';
import { CoinLogo, Kick, Panel, usdText } from '@/terminal/ui';
import { ageOf, ageText } from './launch-view';
import type { LaunchModel } from './useLaunchModel';
import { useSeconds } from './useSeconds';
import l from './launch.module.css';

/** The rows each list shows at most. */
const RYNTRA_MOST = 5;
const FRESH_MOST = 6;
/** The market's new coins are read again this often. */
const FRESH_EVERY_MS = 60_000;

/**
 * «Launches on Ryntra»: the coins launched here, as the engine's own list gives them (`/api/v1/launch/markets`) — the
 * picture, the ticker, the name and its format, the days since, and where it stands: on its curve and how far, or in
 * its pool. A coin whose picture Ryntra took down is shown without it; Ryntra's own test coins are not listed for
 * people.
 */
export function RyntraLaunches({ m }: { m: LaunchModel }) {
  const { w } = m;
  const lang = useLang();
  const now = useSeconds(60_000);
  const [rows, setRows] = useState<readonly LaunchMarketRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void launchEngine()
      .markets()
      .then((answer) => live && setRows(answer.ok ? answer.data.markets : []));
    return () => {
      live = false;
    };
  }, []);
  if (!rows?.length || now === null) return null;
  const shown = rows.filter((row) => !row.technicalValidation).slice(0, RYNTRA_MOST);
  if (!shown.length) return null;
  return (
    <Panel pad="none" edge label={w.onRyntra} className={l.list}>
      <div className={l.listHead}>
        <Kick className={l.grow}>{w.onRyntra}</Kick>
      </div>
      <ul className={l.listRows}>
        {shown.map((row) => {
          const age = ageOf(row.launchedAt, now * 1000);
          const tag = row.preset === 'protected' ? w.protectedTag : null;
          const where = row.progress?.migrated || row.venue === 'pool' ? w.inPool : row.progress ? w.onCurve(pct(row.progress.bps)) : null;
          return (
            <li key={row.token}>
              <Link href={coinHref(row.token, 'live')} className={l.listRow}>
                <CoinLogo src={row.hidden ? null : row.image} symbol={row.symbol} />
                <span className={l.listWords}>
                  <b>${row.symbol}</b>
                  <span>{tag ? `${row.name} · ${tag}` : row.name}</span>
                </span>
                <span className={l.listAge}>{age ? (age.unit === 'day' ? w.daysShort(num(age.n, undefined, lang)) : ageText(w, age)) : ''}</span>
                {where ? <span className={l.listPill}>{where}</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** A right a new coin's mint keeps or gave up, as the market's depth reads it from Jupiter; null — not said. */
type Right = 'on' | 'off' | null;

type FreshCoin = Readonly<{
  id: string;
  symbol: string;
  name: string;
  icon: string | null;
  mcap: number | null;
  holders: number | null;
  bornAt: string | null;
  mint: Right;
  freeze: Right;
}>;

const right = (value: unknown): Right => (value === 'on' || value === 'off' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null);

/** The market's own «New» list (`/api/v1/market/depth?list=fresh`), read defensively: a row it cannot read is left out. */
function freshOf(body: unknown): FreshCoin[] {
  const coins = body && typeof body === 'object' && Array.isArray((body as { coins?: unknown }).coins) ? (body as { coins: unknown[] }).coins : [];
  const out: FreshCoin[] = [];
  for (const coin of coins) {
    if (!coin || typeof coin !== 'object') continue;
    const c = coin as Record<string, unknown>;
    if (typeof c.id !== 'string' || typeof c.symbol !== 'string') continue;
    out.push({
      id: c.id,
      symbol: c.symbol,
      name: typeof c.name === 'string' ? c.name : c.symbol,
      icon: typeof c.icon === 'string' ? c.icon : null,
      mcap: count(c.mcap),
      holders: count(c.holders),
      bornAt: typeof c.bornAt === 'string' ? c.bornAt : null,
      mint: right(c.mint),
      freeze: right(c.freeze),
    });
  }
  return out;
}

/**
 * «New on the market»: the coins just born on Solana, with the two marks a buyer reads first — «M», whether the creator
 * can still mint more, and «F», whether they can freeze a wallet — lit green when given up and red when kept. Where the
 * market's depth is not served, the list is not drawn.
 */
export function FreshSolana({ m, fallback = null }: { m: LaunchModel; fallback?: ReactNode }) {
  const { w } = m;
  const lang = useLang();
  const now = useSeconds(30_000);
  const [coins, setCoins] = useState<readonly FreshCoin[] | null>(null);
  useEffect(() => {
    let live = true;
    // A route not served here answers once; it is not asked again.
    const read = () =>
      void fetch('/api/v1/market/depth?list=fresh&window=1h', { cache: 'no-store' })
        .then((answer) => {
          // Not served here: asked no more. A passing failure keeps what was read and asks again next time.
          if (answer.status === 404 || answer.status === 501) throw new Error('not served');
          return answer.ok ? answer.json() : null;
        })
        .then((body) => live && body !== null && setCoins(freshOf(body).slice(0, FRESH_MOST)))
        .catch(() => {
          clearInterval(timer);
          if (live) setCoins((was) => (was?.length ? was : []));
        });
    // The answers come back after this line: the timer they clear is already set.
    const timer = setInterval(read, FRESH_EVERY_MS);
    read();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  // Until the market's depth answers, or where it is not served: the city's own new launches in its place.
  if (!coins?.length || now === null) return <>{fallback}</>;
  return (
    <Panel pad="none" edge label={w.newSolana} className={l.list}>
      <div className={l.listHead}>
        <Kick className={l.grow}>{w.newSolana}</Kick>
        <span className={l.listLead}>{w.newSolanaLead}</span>
      </div>
      <ul className={l.listRows}>
        {coins.map((coin) => {
          const age = ageText(w, ageOf(coin.bornAt, now * 1000));
          const line = [age, coin.holders !== null ? w.holdersShort(num(coin.holders, undefined, lang)) : null].filter(Boolean).join(' · ');
          return (
            <li key={coin.id}>
              <Link href={coinHref(coin.id, 'live')} className={l.listRow}>
                <CoinLogo src={coin.icon} symbol={coin.symbol} />
                <span className={l.listWords}>
                  <b>{coin.symbol}</b>
                  <span>{line}</span>
                </span>
                <span className={l.marks}>
                  <Mark right={coin.mint} letter={w.markMint} off={w.mintOff} on={w.mintOn} />
                  <Mark right={coin.freeze} letter={w.markFreeze} off={w.freezeOff} on={w.freezeOn} />
                </span>
                <span className={l.listCap}>{coin.mcap !== null ? usdText(coin.mcap, lang) : '—'}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** One mark: its letter, green when the right is given up, red when kept; its meaning in words for a reader. */
function Mark({ right: value, letter, off, on }: { right: Right; letter: string; off: string; on: string }) {
  if (value === null) return null;
  const words = value === 'off' ? off : on;
  return (
    <abbr className={l.mark} data-right={value} title={words} aria-label={words}>
      {letter}
    </abbr>
  );
}
