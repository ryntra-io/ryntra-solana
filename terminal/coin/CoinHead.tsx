'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { count } from '@/city/lib/chart/facts';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { isMint } from '@/city/lib/search/mint';
import { searchCatalog } from '@/city/lib/search/sources';
import type { DepthCoin } from '@/lib/market-depth/model';
import { lookalikeOf } from '@/lib/world/text-safety/lookalike';
import type { SpotMarket } from '@/lib/spot/markets';
import { targetOf, useDepthRead } from '@/terminal/market/depth';
import { KIND_TABS, logoChain, logoOf, type KindTab } from '@/terminal/market/depth-view';
import { coinName } from '@/terminal/market/market-view';
import { useSaved } from '@/terminal/market/saved';
import { useDismiss } from '@/terminal/shell/useDismiss';
import { chipOf, timeText } from '@/terminal/stocks/facts-view';
import { useStockPoolFacts } from '@/terminal/stocks/useStockPoolFacts';
import { STOCK_COIN, STOCK_FACTS } from '@/terminal/stocks/words';
import { Chip, CoinLogo, Icon, Search, Tabs, changeText, changeTone, cx, priceText, usdText } from '@/terminal/ui';
import { DESK } from './desk-words';
import { CoinGlyph } from './glyphs';
import { bare } from './parts';
import { inMainOrder, MAIN_MINTS, MONEY, payLogo } from './staples';
import { COIN } from './words';
import u from './coin.module.css';
import h from './head.module.css';

/** What the head shows of the coin in front: the engine's market read where it came, the city's tower before it. */
export type HeadCoin = Readonly<{ mint: string; symbol: string; name: string; logo: string | null; verified: boolean }>;

/** How long the catalogue waits for the typing to stop before it is asked. */
const SEARCH_AFTER_MS = 260;
/** The most rows the picker draws of one list. */
const PICK_ROWS = 50;

/** The picker's tabs: «Main» first (SOL, USDC, USDT and the coins people trade most), then the Market's kinds. */
type PickTab = 'main' | KindTab;
const PICK_TABS: readonly PickTab[] = ['main', ...KIND_TABS];

/**
 * The head of the coin's desk: the coin with its logo is
 * a picker — a search over every coin of Solana, «Main» first and the Market's tabs by kind (All · Memes ·
 * Crypto · Stocks · Pre-IPO · Saved), a tap opens another coin in place — then its price and the day's move, and the
 * figures a trader reads first: the market cap, liquidity, the day's volume, holders. Under them, the head's second row:
 * the coin's passport (`figures` — the full value, the moves over 5 minutes, an hour and six hours, the people who
 * traded in the day, the age) and, for a company's token, its issuer and the exchange's state (`stockMint`). The address
 * with its copy, the site and X stand behind one quiet control. Every figure is the engine's.
 */
export function CoinHead({ coin, market, price, change, tools, figures, stockMint = null }: { coin: HeadCoin; market: SpotMarket | null; price: number | null; change: number | null; tools: ReactNode; figures?: ReactNode; stockMint?: string | null }) {
  const w = useWords(COIN);
  const d = useWords(DESK);
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, box, () => setOpen(false));
  const sym = bare(coin.symbol);
  // The order the best terminals read a coin in: what it is worth, how deep its pool is, how much traded, who holds it.
  const own: [string, string][] = [
    [d.mcap, market?.marketCapUsd != null ? usdText(market.marketCapUsd, lang) : '—'],
    [d.liquidity, market?.liquidityUsd != null ? usdText(market.liquidityUsd, lang) : '—'],
    [d.volume, market?.volume24hUsd != null ? usdText(market.volume24hUsd, lang) : '—'],
    [d.holders, market?.holders != null ? digits(count(market.holders), lang) : '—'],
  ];
  return (
    <div className={h.box}>
      <div className={h.head}>
        <div className={cx(h.anchor, h.pickAnchor)} ref={box}>
          <button type="button" className={u.pickBtn} aria-haspopup="dialog" aria-expanded={open} aria-label={`${sym} — ${d.pick}`} onClick={() => setOpen((was) => !was)}>
            <CoinLogo {...logoChain(coin.mint, coin.logo, coin.logo)} symbol={sym} size="l" />
            <span className={h.names}>
              <span className={h.symRow}>
                <b className={h.sym}>{sym}</b>
                <Icon name="chevron" size="s" />
              </span>
              <span className={h.name}>{coinName({ id: coin.mint, name: coin.name })}</span>
            </span>
          </button>
          {open ? <Picker current={coin.mint} onClose={() => setOpen(false)} /> : null}
        </div>
        {coin.verified ? (
          <span className={h.vetted} title={w.verified} role="img" aria-label={w.verified}>
            <Chip tone="ok">
              <Icon name="check" size="s" />
              <span className={h.vettedWord} aria-hidden="true">
                {w.verified}
              </span>
            </Chip>
          </span>
        ) : null}
        <div className={h.quote}>
          <b className={h.price}>{price !== null ? priceText(price, lang) : '—'}</b>
          {change !== null ? (
            <span className={h.change} data-tone={changeTone(change)}>
              {changeText(change, lang)}
            </span>
          ) : null}
        </div>
        <dl className={h.figures}>
          {own.map(([label, value]) => (
            <div key={label} className={h.figure}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <span className={h.grow} />
        <About mint={coin.mint} market={market} />
        {tools}
      </div>
      {figures || stockMint ? (
        <div className={h.more}>
          {figures}
          {stockMint ? <StockLine mint={stockMint} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** How often the exchange's chip is judged again: a minute is fine enough for an exchange's hours. */
const STOCK_TICK_MS = 60_000;

/**
 * A company's token in the head: whose it is («Stock token · Backpack Securities», «Pre-IPO token · not a share») and the
 * exchange's state with the time it next changes — the stock's own facts (`terminal/stocks`), the same read the facts
 * block under the ticket uses. A coin that is no stock shows nothing.
 */
function StockLine({ mint }: { mint: string }) {
  const facts = useStockPoolFacts(mint);
  const d = useWords(STOCK_FACTS);
  const w = useWords(STOCK_COIN);
  const lang = useLang();
  // Times are the person's own clock: drawn in the browser only, never a server's zone first.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const tick = window.setInterval(() => setNow(Date.now()), STOCK_TICK_MS);
    return () => window.clearInterval(tick);
  }, []);
  if (now === null || !facts?.isStock || !facts.issuer) return null;
  const chip = chipOf(facts, now);
  return (
    <span className={h.stock} data-session={facts.session}>
      <span className={h.issuer}>
        <span className={h.issuerKind}>{facts.kind === 'pre-ipo' ? w.preIpo : w.share}</span>
        <span className={h.issuerName}>{facts.issuer.label}</span>
      </span>
      {chip ? (
        <Chip tone={chip.tone} dot>
          <span className={h.chipText}>{chip.at === null ? d[chip.key] : d[`${chip.key}Until`](timeText(chip.at, now, lang))}</span>
        </Chip>
      ) : null}
    </span>
  );
}

/** The address with its copy, the site, X and Telegram — behind one quiet control. */
function About({ mint, market }: { mint: string; market: SpotMarket | null }) {
  const d = useWords(DESK);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useDismiss(open, box, () => setOpen(false));
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1_600);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mint);
      setCopied(true);
    } catch {
      // The browser keeps its clipboard shut: the address stays on screen to select.
    }
  };
  const links: [string, string, 'site' | 'x' | 'telegram'][] = [];
  if (market?.links.website) links.push([d.site, market.links.website, 'site']);
  if (market?.links.twitter) links.push([d.x, market.links.twitter, 'x']);
  if (market?.links.telegram) links.push([d.telegram, market.links.telegram, 'telegram']);
  return (
    <span className={cx(h.anchor, h.about)} ref={box}>
      <span className={h.links}>
        {/* On a wide head the links stand beside «i»; where the four figures need the room, they wait behind it (QA 19.11). */}
        {links.map(([label, href, glyph]) => (
          <a key={glyph} className={cx(u.iconBtn, h.barLink)} href={href} target="_blank" rel="noopener noreferrer nofollow" aria-label={label} title={label}>
            <CoinGlyph name={glyph} />
          </a>
        ))}
        <button type="button" className={u.iconBtn} aria-label={d.about} title={d.about} aria-expanded={open} onClick={() => setOpen((was) => !was)}>
          <CoinGlyph name="info" size={18} />
        </button>
      </span>
      {open ? (
        <div className={h.pop} role="dialog" aria-label={d.about}>
          {links.length ? (
            <span className={h.popLinks}>
              {links.map(([label, href, glyph]) => (
                <a key={glyph} className={h.popLink} href={href} target="_blank" rel="noopener noreferrer nofollow">
                  <CoinGlyph name={glyph} />
                  {label}
                </a>
              ))}
            </span>
          ) : null}
          <span className={h.popLabel}>{d.address}</span>
          <span className={h.addressRow}>
            <code className={h.address}>{mint}</code>
            <button type="button" className={u.iconBtn} aria-label={d.copy} title={copied ? d.copied : d.copy} onClick={() => void copy()} data-done={copied || undefined}>
              {copied ? <Icon name="check" size="s" /> : <CoinGlyph name="copy" />}
            </button>
          </span>
          {copied ? (
            <span className={h.popNote} role="status">
              {d.copied}
            </span>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

type CatalogRow = Awaited<ReturnType<typeof searchCatalog>>[number];

type PickRow = Readonly<{ mint: string; symbol: string; name: string; logo: string | null; price: number | null; change: number | null; volume: number | null; mcap: number | null; verified: boolean }>;

const rowOfDepth = (coin: DepthCoin): PickRow => ({ mint: coin.id, symbol: coin.symbol, name: coinName({ id: coin.id, name: coin.name }), logo: logoOf(coin), price: coin.price, change: coin.stats['24h']?.change ?? null, volume: coin.stats['24h']?.volume ?? null, mcap: coin.mcap, verified: coin.verified });
/**
 * A coin the catalogue found, as a row — not one Jupiter marks suspicious, nor one whose ticker passes for a known coin's
 * on another mint. Its address, pasted whole, still opens it.
 */
const rowOfCatalog = (row: CatalogRow): PickRow | null =>
  row.symbol && !row.isSuspicious && !lookalikeOf(row.symbol, row.mint)
    ? { mint: row.mint, symbol: row.symbol, name: row.name ?? row.symbol, logo: logoOf({ id: row.mint, icon: row.icon }), price: null, change: null, volume: null, mcap: null, verified: row.isVerified === true }
    : null;

/**
 * The picker: a search over every coin, «Main» and the Market's kinds as tabs, and the coins of the tab — a tap opens
 * the coin. «Main» is the Market's own read of its named coins, with their prices; it opens first, and its coins stand
 * first in a search, whichever tab was open.
 */
function Picker({ current, onClose }: { current: string; onClose: () => void }) {
  const d = useWords(DESK);
  const lang = useLang();
  const router = useRouter();
  const [tab, setTab] = useState<PickTab>('main');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Readonly<{ query: string; rows: readonly PickRow[] }> | null>(null);
  const [at, setAt] = useState(0);
  const savedMints = useSaved((st) => st.mints);
  const main = useDepthRead('saved', '24h', MAIN_MINTS);
  // Under «Main» the Market's «All» is read ahead: the next tab a person opens.
  const kind = useDepthRead(targetOf(tab === 'main' ? 'all' : tab, 'trending'), '24h', tab === 'saved' ? savedMints : []);
  const mainRows = useMemo<readonly PickRow[]>(() => {
    const read = inMainOrder(main.coins).map(rowOfDepth);
    if (read.length || main.status === 'reading') return read;
    // The read did not come: the money still stands, with its logos — the picker never opens on nothing.
    return MONEY.map((asset) => ({ mint: asset.mint, symbol: asset.symbol, name: asset.name ?? asset.symbol, logo: payLogo(asset), price: null, change: null, volume: null, mcap: null, verified: true }));
  }, [main.coins, main.status]);
  const list = tab === 'main' ? main : kind;
  const wrap = useRef<HTMLDivElement>(null);
  const listBox = useRef<HTMLOListElement>(null);

  useEffect(() => {
    wrap.current?.querySelector('input')?.focus();
  }, []);

  // The catalogue answers what was typed, a moment after the typing stops.
  const typed = query.trim();
  useEffect(() => {
    if (typed.length < 2) return;
    const stop = new AbortController();
    const timer = setTimeout(() => {
      void searchCatalog(typed, { signal: stop.signal })
        .then((rows) => {
          if (!stop.signal.aborted) setFound({ query: typed, rows: rows.map(rowOfCatalog).filter((row): row is PickRow => row !== null) });
        })
        .catch(() => undefined);
    }, SEARCH_AFTER_MS);
    return () => {
      stop.abort();
      clearTimeout(timer);
    };
  }, [typed]);

  const rows = useMemo<readonly PickRow[]>(() => {
    const listed = tab === 'main' ? mainRows : kind.coins.map(rowOfDepth);
    if (!typed) return listed.slice(0, PICK_ROWS);
    const key = typed.toLowerCase().replace(/^\$/, '');
    // The main coins first, then the tab's own, each once: «usdt» finds Tether from any tab.
    const pool = new Map<string, PickRow>();
    for (const row of [...mainRows, ...listed]) if (!pool.has(row.mint)) pool.set(row.mint, row);
    const near = [...pool.values()].filter((row) => row.mint === typed || bare(row.symbol).toLowerCase().includes(key) || row.name.toLowerCase().includes(key));
    const seen = new Set(near.map((row) => row.mint));
    const more = (found?.query === typed ? found.rows : []).filter((row) => !seen.has(row.mint));
    const all = [...near, ...more];
    // An address pasted whole opens that coin, whatever the lists know of it.
    if (isMint(typed) && !all.some((row) => row.mint === typed)) all.unshift({ mint: typed, symbol: `${typed.slice(0, 4)}…${typed.slice(-4)}`, name: d.address, logo: null, price: null, change: null, volume: null, mcap: null, verified: false });
    return all.slice(0, PICK_ROWS);
  }, [tab, mainRows, kind.coins, typed, found, d.address]);

  useEffect(() => setAt(0), [tab, typed]);
  useEffect(() => {
    listBox.current?.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const go = (mint: string) => {
    onClose();
    if (mint !== current) router.push(`/coin/${encodeURIComponent(mint)}`);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    // The rows answer the search field's keys only: a tab of kinds keeps its own Enter and arrows.
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAt((n) => Math.min(rows.length - 1, n + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAt((n) => Math.max(0, n - 1));
    } else if (event.key === 'Enter' && rows[at]) {
      event.preventDefault();
      go(rows[at]!.mint);
    }
  };
  const tabs = PICK_TABS.map((id) => ({ id, label: d[id], ...(id === 'saved' ? { icon: <Icon name="star" size="s" /> } : {}) }));
  const reading = !typed && list.status === 'reading' && !list.coins.length;

  return (
    <div className={h.picker} role="dialog" aria-label={d.pick} ref={wrap} onKeyDown={key}>
      <div className={h.pickTop}>
        <Search value={query} onChange={setQuery} placeholder={d.find} />
        {typed ? null : <Tabs bare label={d.kinds} value={tab} onChange={setTab} items={tabs} className={h.kinds} />}
      </div>
      {rows.length ? (
        <div className={h.pickCols} aria-hidden="true">
          <span />
          <span>{d.pickCoin}</span>
          <span>{d.pickPrice}</span>
          <span>{d.pickCap}</span>
        </div>
      ) : null}
      <ol className={h.pickList} ref={listBox} role="listbox" aria-label={d.pick}>
        {rows.map((row, i) => (
          <li key={row.mint} role="option" aria-selected={i === at} data-at={i}>
            <button type="button" className={cx(h.pickRow, row.mint === current && h.pickHere)} onClick={() => go(row.mint)} onMouseEnter={() => setAt(i)} tabIndex={-1}>
              <CoinLogo {...logoChain(row.mint, row.logo, row.logo)} symbol={bare(row.symbol)} size="m" eager />
              <span className={h.pickName}>
                <b>
                  {bare(row.symbol)}
                  {row.verified ? <Icon name="check" size="s" /> : null}
                </b>
                <span>{row.name}</span>
              </span>
              <span className={h.pickNum}>
                <b>{row.price !== null ? priceText(row.price, lang) : ''}</b>
                {row.change !== null ? (
                  <span className={h.change} data-tone={changeTone(row.change)}>
                    {changeText(row.change, lang)}
                  </span>
                ) : null}
              </span>
              <span className={h.pickNum}>
                <b>{row.mcap !== null ? usdText(row.mcap, lang) : ''}</b>
                <span>{row.volume !== null ? usdText(row.volume, lang) : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      {!rows.length ? (
        <p className={h.pickLine} role="status">
          {reading ? d.reading : d.noCoins}
        </p>
      ) : null}
    </div>
  );
}
