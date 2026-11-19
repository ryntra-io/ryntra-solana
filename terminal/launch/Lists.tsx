'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LaunchMarketRow } from '@/lib/api/v1/contract';
import { num } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { launchEngine } from '@/city/lib/launch/district';
import { pct } from '@/city/lib/launch/format';
import { coinHref } from '@/terminal/shell/shelves';
import { CoinLogo, Kick, Panel, usdText } from '@/terminal/ui';
import { logoOf } from '@/terminal/market/depth-view';
import { useMarket } from '@/terminal/shell/useMarket';
import { ageOf, ageText, freshLaunches, measured, showcase } from './launch-view';
import { rudeName } from './rude';
import type { LaunchModel } from './useLaunchModel';
import { useSeconds } from './useSeconds';
import l from './launch.module.css';

/** The rows each list shows at most. */
const RYNTRA_MOST = 5;
const FRESH_MOST = 8;
/** The market's new coins kept after the showcase's rules: room for the rows whose logo does not come. */
const FRESH_KEPT = 40;
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
      // A crude or hateful name is not shown here; Ryntra's own test coins are left out below.
      .then((answer) => live && setRows(answer.ok ? answer.data.markets.filter((row) => !row.hidden && row.image !== null && !rudeName(row.symbol, row.name)) : []));
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
                <CoinLogo src={row.image} symbol={row.symbol} />
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

export type FreshCoin = Readonly<{
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
 * The market's new coins the Launch screen shows, read once for the screen and again every minute: the depth
 * list's own «New», through the showcase's rules — a logo, a market cap, people holding it, the creator's rights given
 * up, a decent name —, and after them the market's own new launches through the same rules, once each. Null until read;
 * empty where neither has a coin to show.
 */
export function useFreshCoins(): readonly FreshCoin[] | null {
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
        .then((body) => {
          if (!live || body === null) return;
          const read = showcase(freshOf(body), (coin) => ({ ...coin, kept: coin.mint === 'on' || coin.freeze === 'on' }), FRESH_KEPT);
          // A read adds the newest coins to those already shown — the feed holds only the last few minutes — newest first.
          setCoins((was) => {
            const fresh = new Map(read.map((coin) => [coin.id, coin]));
            const kept = (was ?? []).filter((coin) => !fresh.has(coin.id));
            return showcase([...read, ...kept].sort((a, b) => (Date.parse(b.bornAt ?? '') || 0) - (Date.parse(a.bornAt ?? '') || 0)), (coin) => coin, FRESH_KEPT);
          });
        })
        .catch((error: unknown) => {
          if (error instanceof Error && error.message === 'not served') clearInterval(timer);
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
  // The market's own new launches (its snapshot's docks) follow the depth list's: the showcase has its rows when the
  // depth list's newest coins are mostly tests.
  const towers = useMarket().towers;
  return useMemo(() => {
    if (coins === null) return null;
    const docks: FreshCoin[] = showcase(freshLaunches(towers), (tower) => ({ symbol: tower.symbol, name: tower.name, icon: tower.icon, mcap: measured(tower, 'mcap'), holders: measured(tower, 'holders') }), FRESH_KEPT).map((tower) => ({
      id: tower.id,
      symbol: tower.symbol,
      name: tower.name,
      icon: tower.icon,
      mcap: measured(tower, 'mcap'),
      holders: measured(tower, 'holders'),
      bornAt: tower.launchedAt,
      mint: null,
      freeze: null,
    }));
    return showcase([...coins, ...docks], (coin) => coin, FRESH_KEPT);
  }, [coins, towers]);
}

/** The coins whose logo did not come: a row without its picture is let go, and the next coin takes its place. */
function useMissed(): [ReadonlySet<string>, (id: string) => void] {
  const [missed, setMissed] = useState<ReadonlySet<string>>(() => new Set());
  const miss = useCallback((id: string) => setMissed((was) => (was.has(id) ? was : new Set([...was, id]))), []);
  return [missed, miss];
}

/** A new coin's logo through the engine's proxy; one that does not come tells its list, which lets the row go. */
function Logo({ coin, onMiss }: { coin: FreshCoin; onMiss: (id: string) => void }) {
  const src = logoOf(coin);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={l.markSmall} src={src} alt="" decoding="async" onError={() => onMiss(coin.id)} />;
}

/** A coin's ticker as the Market writes it: without a «$» of its own. */
function tickerOf(coin: FreshCoin): string {
  return coin.symbol.trim().replace(/^\$+/, '');
}

/** A new coin's second line: its own name where it says more than its ticker, and how many hold it. */
function freshLine(m: LaunchModel, coin: FreshCoin): string {
  const name = coin.name.trim().replace(/^\$+/, '');
  const named = name && name.toUpperCase() !== coin.symbol.trim().replace(/^\$+/, '').toUpperCase() ? name : null;
  return [named, coin.holders !== null ? m.w.holders(coin.holders) : null].filter(Boolean).join(' · ');
}

/**
 * «New on the market» beside the form: the market's new coins with their logos, as many as the screen's height holds.
 * Until the market's depth answers, or where it is not served, `fallback` stands in its place.
 */
export function FreshSolana({ m, coins, fallback = null }: { m: LaunchModel; coins: readonly FreshCoin[] | null; fallback?: ReactNode }) {
  const { w } = m;
  const lang = useLang();
  const [missed, miss] = useMissed();
  const rows = (coins ?? []).filter((coin) => !missed.has(coin.id)).slice(0, FRESH_MOST);
  if (coins === null) {
    return (
      <Panel pad="none" edge label={w.newSolana} className={l.list}>
        <div className={l.listHead}>
          <Kick className={l.grow}>{w.newSolana}</Kick>
        </div>
        <span className={l.skeleton} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
      </Panel>
    );
  }
  if (!rows.length) return <>{fallback}</>;
  return (
    <Panel pad="none" edge label={w.newSolana} className={l.list}>
      <div className={l.listHead}>
        <Kick className={l.grow}>{w.newSolana}</Kick>
      </div>
      <ul className={l.listRows}>
        {rows.map((coin) => (
          <li key={coin.id}>
            <Link href={coinHref(coin.id, 'live')} className={l.listRow}>
              <Logo coin={coin} onMiss={miss} />
              <span className={l.listWords}>
                <b>{tickerOf(coin)}</b>
                <span>{freshLine(m, coin)}</span>
              </span>
              <span className={l.listCap}>{coin.mcap !== null ? usdText(coin.mcap, lang) : ''}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * The «New on the market» tab: the same coins as beside the form, the whole list — the coin, how long ago it was born,
 * how many hold it and its market cap. Where the market's depth is not served, `fallback` stands in its place.
 */
export function FreshTab({ m, coins, fallback = null }: { m: LaunchModel; coins: readonly FreshCoin[] | null; fallback?: ReactNode }) {
  const { w } = m;
  const lang = useLang();
  const now = useSeconds(30_000);
  const [missed, miss] = useMissed();
  const rows = (coins ?? []).filter((coin) => !missed.has(coin.id));
  if (!rows.length || now === null) return <>{fallback}</>;
  return (
    <Panel pad="none" edge label={w.fresh} className={l.freshTab}>
      <div className={l.freshGrid}>
        {rows.map((coin) => (
          <Link key={coin.id} href={coinHref(coin.id, 'live')} className={l.freshCard}>
            <Logo coin={coin} onMiss={miss} />
            <span className={l.listWords}>
              <b>{tickerOf(coin)}</b>
              <span>{freshLine(m, coin)}</span>
            </span>
            <span className={l.freshFigures}>
              <b>{coin.mcap !== null ? usdText(coin.mcap, lang) : ''}</b>
              <span>{ageText(w, ageOf(coin.bornAt, now * 1000)) ?? ''}</span>
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}
