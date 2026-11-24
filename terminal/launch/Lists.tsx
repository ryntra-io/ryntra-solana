'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LaunchMarketRow } from '@/lib/api/v1/contract';
import { num } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { launchEngine } from '@/city/lib/launch/district';
import { pct } from '@/city/lib/launch/format';
import { coinHref } from '@/terminal/shell/shelves';
import { Kick, Panel, usdText } from '@/terminal/ui';
import { logoOf } from '@/terminal/market/depth-view';
import { useMarket } from '@/terminal/shell/useMarket';
import { ageOf, ageText, byAge, freshLaunches, freshMerge, freshOf, logoRows, measured, pulseFresh, showcase, tickerKey, type FreshCoin } from './launch-view';
import { rudeName } from './rude';
import { MineMark } from './Side';
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

/** How long the new coins wait for the launches on Ryntra before they stand without them. */
const RYNTRA_WAIT_MS = 3000;

/**
 * The launches on Ryntra, as the engine's own list gives them (`/api/v1/launch/markets`), read once for the screen: the
 * list «Launches on Ryntra» and what the market's new coins leave out beside it. Null until read; empty where it failed,
 * or while a slow answer is still on its way after `RYNTRA_WAIT_MS` — the answer still counts when it comes.
 */
export function useRyntraLaunches(): readonly LaunchMarketRow[] | null {
  const [rows, setRows] = useState<readonly LaunchMarketRow[] | null>(null);
  useEffect(() => {
    let live = true;
    const late = setTimeout(() => live && setRows((was) => was ?? []), RYNTRA_WAIT_MS);
    void launchEngine()
      .markets()
      .then((answer) => {
        if (live) setRows((was) => (answer.ok ? answer.data.markets : (was ?? [])));
      });
    return () => {
      live = false;
      clearTimeout(late);
    };
  }, []);
  return rows;
}

/**
 * The launches «Launches on Ryntra» lists: none Ryntra took down, none without a picture, none crude or hateful,
 * none of Ryntra's own test coins; at most five. The market's new coins under it leave these out (`freshSkip`).
 */
export function ryntraShown(all: readonly LaunchMarketRow[] | null): readonly LaunchMarketRow[] {
  const rows = all ? all.filter((row) => !row.hidden && row.image !== null && !rudeName(row.symbol, row.name)) : null;
  return rows ? rows.filter((row) => !row.technicalValidation).slice(0, RYNTRA_MOST) : [];
}

/**
 * «Launches on Ryntra»: the coins launched here (`useRyntraLaunches`) — the picture, the ticker, the name and its format,
 * the days since, and where it stands: on its curve and how far, or in its pool. A picture that does not come gives way
 * to the brand's coin, never a letter.
 */
export function RyntraLaunches({ m, rows }: { m: LaunchModel; rows: readonly LaunchMarketRow[] | null }) {
  const { w } = m;
  const lang = useLang();
  const now = useSeconds(60_000);
  const shown = ryntraShown(rows);
  if (!shown.length || now === null) return null;
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
                <MineMark src={row.image!} />
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

/** Where the showcase reads new coins: the market's depth list «New», and the Pulse's newest and almost-on-a-DEX feeds. */
const FRESH_SOURCES: readonly Readonly<{ url: string; parse: (body: unknown) => FreshCoin[] }>[] = [
  { url: '/api/v1/market/depth?list=fresh&window=1h', parse: freshOf },
  { url: '/api/spot/pulse?feed=new&mode=meme', parse: pulseFresh },
  { url: '/api/spot/pulse?feed=soon&mode=meme', parse: pulseFresh },
];

/** How long one source may take before its read counts as a passing failure: a hung source never holds the others. */
const FRESH_ASK_MS = 8000;

/** One source's answer: its coins; «gone» — not served here, asked no more; null — a passing failure, asked next time. */
async function askFresh(url: string, parse: (body: unknown) => FreshCoin[]): Promise<readonly FreshCoin[] | 'gone' | null> {
  try {
    const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(FRESH_ASK_MS) : undefined;
    const answer = await fetch(url, { cache: 'no-store', signal });
    if (answer.status === 404 || answer.status === 501) return 'gone';
    return answer.ok ? parse(await answer.json()) : null;
  } catch {
    return null;
  }
}

/**
 * The market's new coins the Launch screen shows, read once for the screen and again every minute: the depth
 * list's own «New» and the Pulse's new coins (the depth list alone left «New» five cards long), through the
 * showcase's rules — a logo, a market cap, people holding it, the creator's rights given up, a decent name —, with the
 * market's own new launches through the same rules, newest first, once each (`freshMerge`). Null until read; empty where
 * none has a coin to show.
 */
export function useFreshCoins(): readonly FreshCoin[] | null {
  const [coins, setCoins] = useState<readonly FreshCoin[] | null>(null);
  useEffect(() => {
    let live = true;
    // A route not served here answers once; it is not asked again.
    const gone = new Set<string>();
    const read = () =>
      void Promise.all(FRESH_SOURCES.filter((source) => !gone.has(source.url)).map((source) => askFresh(source.url, source.parse).then((answer) => {
            if (answer !== 'gone') return answer;
            gone.add(source.url);
            return null;
          }))).then((answers) => {
        if (!live) return;
        if (gone.size === FRESH_SOURCES.length) clearInterval(timer);
        const lists = answers.filter((answer): answer is readonly FreshCoin[] => answer !== null);
        // Every source failed or is not served: what was read stays, and an empty list says there is none.
        if (!lists.length) {
          setCoins((was) => (was?.length ? was : []));
          return;
        }
        // A read adds the newest coins to those already shown — the feeds hold only the last minutes —, newest first; a coin
        // read again stands with its new figures, or goes when it no longer passes.
        const read = lists.flat();
        setCoins((was) => freshMerge(was ?? [], read, FRESH_KEPT));
      });
    // The answers come back after this line: the timer they clear is already set.
    const timer = setInterval(read, FRESH_EVERY_MS);
    read();
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  // The market's own new launches (its snapshot's docks) stand among them by age: the showcase has its rows when the
  // feeds' newest coins are mostly tests.
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
    return showcase([...coins, ...docks].sort(byAge), (coin) => coin, FRESH_KEPT);
  }, [coins, towers]);
}

/**
 * The new coins a list shows once what it leaves out is known (`skip`, from the launches on Ryntra): null while either is
 * still being read, so the list holds its place rather than draw a row it lets go a moment later.
 */
function useSkipped(all: readonly FreshCoin[] | null, skip: ReadonlySet<string> | null): readonly FreshCoin[] | null {
  return useMemo(() => (all === null || skip === null ? null : skip.size ? all.filter((coin) => !skip.has(coin.id) && !skip.has(tickerKey(coin.symbol))) : all), [all, skip]);
}

/** The coins whose logo did not come: a row without its picture is let go, and the next coin takes its place. */
function useMissed(): [ReadonlySet<string>, (id: string) => void] {
  const [missed, setMissed] = useState<ReadonlySet<string>>(() => new Set());
  const miss = useCallback((id: string) => setMissed((was) => (was.has(id) ? was : new Set([...was, id]))), []);
  return [missed, miss];
}

/** How long the lists wait for the new coins' logos before drawing the ones that came. */
const LOGO_WAIT_MS = 2500;

/**
 * Each new coin's logo read before its row is drawn: a logo that does not come draws no row, so no row is
 * drawn and then let go. `settled` — every logo of the first read decided, or the wait over; a logo still on its way then
 * draws no row, so none comes in between the rows already drawn.
 */
function useLogos(coins: readonly FreshCoin[] | null): Readonly<{ seen: ReadonlyMap<string, boolean>; settled: boolean }> {
  const [seen, setSeen] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const [waited, setWaited] = useState(false);
  const asked = useRef(new Set<string>());
  const decide = useCallback((id: string, ok: boolean) => setSeen((was) => (was.has(id) ? was : new Map([...was, [id, ok]]))), []);
  useEffect(() => {
    if (!coins) return;
    for (const coin of coins) {
      if (asked.current.has(coin.id)) continue;
      asked.current.add(coin.id);
      const src = logoOf(coin);
      if (!src) {
        decide(coin.id, false);
        continue;
      }
      const image = new window.Image();
      image.decoding = 'async';
      image.onload = () => decide(coin.id, true);
      image.onerror = () => decide(coin.id, false);
      image.src = src;
    }
  }, [coins, decide]);
  useEffect(() => {
    if (!coins || waited) return;
    const timer = setTimeout(() => {
      // The wait is over: a logo still on its way draws no row now.
      setSeen((was) => {
        const late = coins.filter((coin) => !was.has(coin.id));
        return late.length ? new Map([...was, ...late.map((coin) => [coin.id, false] as const)]) : was;
      });
      setWaited(true);
    }, LOGO_WAIT_MS);
    return () => clearTimeout(timer);
  }, [coins, waited]);
  const decided = coins !== null && coins.length > 0 && coins.every((coin) => seen.has(coin.id));
  // Settled once, settled for good: coins read later never bring the skeleton back over rows already drawn.
  useEffect(() => {
    if (decided && !waited) setWaited(true);
  }, [decided, waited]);
  const settled = waited || decided || (coins !== null && coins.length === 0);
  return { seen, settled };
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

/**
 * A new coin's second line: its own name where it says more than its ticker, and how many hold it. The name gives way
 * first; the count stands whole (EYES 19.11: «Birdwatcher…» cut while the row had room).
 */
function FreshLine({ m, coin }: { m: LaunchModel; coin: FreshCoin }) {
  const name = coin.name.trim().replace(/^\$+/, '');
  const named = name && name.toUpperCase() !== tickerOf(coin).toUpperCase() ? name : null;
  const held = coin.holders !== null ? m.w.holders(coin.holders) : null;
  return (
    <span className={l.freshLine}>
      {named ? <span className={l.freshName}>{named}</span> : null}
      {named && held ? <span aria-hidden="true">·</span> : null}
      {held ? <span className={l.freshHeld}>{held}</span> : null}
    </span>
  );
}

/**
 * «New on the market» beside the form: the market's new coins with their logos, as many as the screen's height holds.
 * Until the market's depth answers, or where it is not served, `fallback` stands in its place.
 */
export function FreshSolana({ m, coins: all, skip, fallback = null }: { m: LaunchModel; coins: readonly FreshCoin[] | null; skip: ReadonlySet<string> | null; fallback?: ReactNode }) {
  // What the launches on Ryntra leave out (`freshSkip`), known before a row is drawn: none is drawn and then let go.
  const coins = useSkipped(all, skip);
  const { w } = m;
  const lang = useLang();
  const [missed, miss] = useMissed();
  // A row is drawn once its logo was read: none is drawn and then let go.
  const { seen, settled } = useLogos(coins);
  const rows = logoRows(coins ?? [], seen, missed, FRESH_MOST);
  if (coins === null || !settled) {
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
                <FreshLine m={m} coin={coin} />
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
export function FreshTab({ m, coins: all, skip, fallback = null }: { m: LaunchModel; coins: readonly FreshCoin[] | null; skip: ReadonlySet<string> | null; fallback?: ReactNode }) {
  const { w } = m;
  const lang = useLang();
  const now = useSeconds(30_000);
  const coins = useSkipped(all, skip);
  const [missed, miss] = useMissed();
  const { seen, settled } = useLogos(coins);
  const rows = logoRows(coins ?? [], seen, missed);
  // The coins or their logos on their way: the tab's place held, not another panel shown a moment.
  if (coins === null || (coins.length && !settled)) {
    return (
      <Panel pad="none" edge label={w.fresh} className={l.freshTab}>
        <span className={l.skeleton} aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
      </Panel>
    );
  }
  if (!rows.length || now === null) return <>{fallback}</>;
  return (
    <Panel pad="none" edge label={w.fresh} className={l.freshTab}>
      <div className={l.freshGrid}>
        {rows.map((coin) => (
          <Link key={coin.id} href={coinHref(coin.id, 'live')} className={l.freshCard}>
            <Logo coin={coin} onMiss={miss} />
            <span className={l.listWords}>
              <b>{tickerOf(coin)}</b>
              <FreshLine m={m} coin={coin} />
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
