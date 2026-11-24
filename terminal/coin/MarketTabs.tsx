'use client';

import Link from 'next/link';
import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { LANG_LOCALE, type Lang } from '@/city/lib/i18n/langs';
import { useWallet } from '@/city/lib/trade/wallet';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { Info, Quiet, amountOf, priceText, sumText, usdText } from '@/terminal/ui';
import { walletHref } from '@/terminal/watch/watch-view';
import { DESK } from './desk-words';
import {
  agoOf,
  filterTape,
  holderMarksOf,
  holderMoveOf,
  holdersPartOf,
  marksOf,
  resultTone,
  shortAddress,
  signedSum,
  signsOf,
  sortTraders,
  tapeFiltersOf,
  tapePrice,
  tradersOf,
  type TapeFilter,
  type TraderRow,
  type TradersBasis,
  type WalletLabel,
} from './tape-view';
import { agoText, MarksInfo, WalletMarks } from './Tape';
import { UNDER } from './under-words';
import { useHolders, useNow, useTraders, type Tape } from './useCoinMarket';
import m from './market.module.css';

/** A transaction on Solscan, the explorer people read: a new tab, nothing of Ryntra's sent with it. */
const solscanTx = (id: string) => `https://solscan.io/tx/${encodeURIComponent(id)}`;

/** The width of the box the market's tables stand in (`TapeBox`); 0 where none is measured. */
const BoxWidth = createContext(0);

/**
 * The box under the chart the market's tables stand in: it measures its own width, so a table there takes a phone's
 * columns where the desk's do not fit — a tablet's panel beside the ticket — rather than running past its edge.
 */
export function TapeBox({ className, children }: { className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const take = () => setWidth(el.clientWidth);
    take();
    const seen = new ResizeObserver(take);
    seen.observe(el);
    return () => seen.disconnect();
  }, []);
  return (
    <div ref={box} className={className}>
      <BoxWidth.Provider value={width}>{children}</BoxWidth.Provider>
    </div>
  );
}

/** The least width a desk's columns need: each track's least, the gaps between them and the row's sides (`market.module.css`). */
export function leastWidth(cols: string): number {
  const tracks = cols.match(/minmax\([^)]*\)|[^\s]+/gu) ?? [];
  const least = tracks.reduce((sum, track) => sum + Number(/^(?:minmax\()?(\d+(?:\.\d+)?)px/u.exec(track)?.[1] ?? 0), 0);
  return least + Math.max(0, tracks.length - 1) * 12 + 2 * 16;
}

/** A phone's columns on a phone, and in a box narrower than the desk's `cols` need. */
function useCompact(cols: string): boolean {
  const phone = useNarrow();
  const width = useContext(BoxWidth);
  return phone || (width > 0 && width < leastWidth(cols));
}

/** A table of numbers, dense as a trader reads it: a head, then rows. `cols` is the grid's columns. */
/** `fit` — the columns share the box's own width (their least widths fit it) rather than each its widest cell. */
function Grid({ cols, label, head, narrow = false, fit = false, children }: { cols: string; label: string; head: readonly ReactNode[]; narrow?: boolean; fit?: boolean; children: ReactNode }) {
  return (
    <div className={m.scroll}>
      <div role="table" aria-label={label} className={m.table} data-narrow={narrow || undefined} data-fit={fit || undefined} style={{ ['--cols' as string]: cols }}>
        <div role="row" className={m.head}>
          {head.map((cell, i) => (
            <span key={i} role="columnheader">
              {cell}
            </span>
          ))}
        </div>
        {children}
      </div>
    </div>
  );
}

function Line({ children }: { children: ReactNode }) {
  return (
    <p className={m.line} role="status">
      {children}
    </p>
  );
}

/** A wallet in any row opens its page in the terminal — what it holds, what it traded — never another site. */
function Wallet({ address, marks = [] }: { address: string; marks?: readonly WalletLabel[] }) {
  const u = useWords(UNDER);
  const short = shortAddress(address);
  return (
    <span role="cell" className={m.wallet}>
      <Link href={walletHref(address)} prefetch={false} className={m.link} aria-label={u.openWallet(short)}>
        {short}
      </Link>
      <WalletMarks marks={marks} />
    </span>
  );
}

/** One line over a table: what it is, on the left, and its «i», on the right. */
function Caption({ children, info }: { children?: ReactNode; info?: ReactNode }) {
  return (
    <div className={m.captionRow}>
      <span>{children}</span>
      {info}
    </div>
  );
}

/* ------------------------------------------------------------------ trades */

const FILTER_WORD: Readonly<Record<TapeFilter, 'filterAll' | 'filterCreator' | 'filterBig' | 'filterTop' | 'filterMine'>> = {
  all: 'filterAll',
  creator: 'filterCreator',
  big: 'filterBig',
  top: 'filterTop',
  mine: 'filterMine',
};
const FILTER_NONE: Readonly<Record<Exclude<TapeFilter, 'all'>, 'noneCreator' | 'noneBig' | 'noneTop' | 'noneMine'>> = {
  creator: 'noneCreator',
  big: 'noneBig',
  top: 'noneTop',
  mine: 'noneMine',
};

/** The filters over the trades: one choice, the rows change in place. */
function Filters({ items, value, onChange }: { items: readonly TapeFilter[]; value: TapeFilter; onChange: (filter: TapeFilter) => void }) {
  const u = useWords(UNDER);
  return (
    <div role="radiogroup" aria-label={u.filters} className={m.filters}>
      {items.map((item) => (
        <Quiet key={item} size="s" role="radio" aria-checked={item === value} className={m.filter} onClick={() => onChange(item)}>
          {u[FILTER_WORD[item]]}
        </Quiet>
      ))}
    </div>
  );
}

/**
 * On a phone: when, the side, the price, the value, the wallet. The rows share one grid (`market.module.css`, a phone's
 * table), so «auto» is the widest of the column's cells in every row: the wallet holds the widest short address with
 * its mark and the time and the side their longest word, whatever the language; the price takes the rest (EYES 19.11,
 * вада 8: «MfDu…GVWa» ran into the screen's edge).
 */
const TRADE_COLS_PHONE = 'auto auto minmax(0, 1fr) auto auto';
const TRADE_COLS = 'minmax(52px, 0.6fr) minmax(60px, 0.6fr) minmax(96px, 1fr) minmax(96px, 1fr) minmax(80px, 0.9fr) minmax(84px, 0.9fr) minmax(136px, 1.3fr)';
/** The same columns without the market cap: a coin whose trades carry none (a company's token). */
const TRADE_COLS_NO_CAP = 'minmax(52px, 0.6fr) minmax(60px, 0.6fr) minmax(96px, 1fr) minmax(96px, 1fr) minmax(80px, 0.9fr) minmax(136px, 1.3fr)';

/**
 * The market's own trades of the coin, the newest first: when, which side, the price, how much, the wallet with its
 * marks. Over them the filters — all, the creator's, the big ones, the top holders', the person's own.
 */
export function MarketTrades({ tape, sym, legend }: { tape: Tape; sym: string; legend?: boolean }) {
  const d = useWords(DESK);
  const u = useWords(UNDER);
  const lang = useLang();
  const now = useNow(5_000);
  const narrow = useCompact(TRADE_COLS_NO_CAP);
  // The market cap's column only where the desk's columns have room for it too.
  const capRoom = !useCompact(TRADE_COLS);
  const me = useWallet((st) => st.connection?.address ?? null);
  const [picked, setPicked] = useState<TapeFilter>('all');
  const marks = tape.marks ?? null;
  const filters = tapeFiltersOf(marks, me);
  const filter = filters.includes(picked) ? picked : 'all';
  const rows = useMemo(() => filterTape(tape.trades, filter, marks, me), [tape.trades, filter, marks, me]);
  if (!tape.trades.length) return <Line>{tape.status === 'reading' ? d.reading : tape.status === 'failed' ? u.quiet : d.noTape}</Line>;
  // The market cap at a trade, only where the engine counted it for some row: a company's token has none, and a column
  // of «—» in every row says nothing.
  const capKnown = capRoom && rows.some((trade) => trade.capUsd !== null);
  const head = narrow ? [d.colTime, d.colSide, d.colPrice, d.colValue, d.colWallet] : [d.colTime, d.colSide, d.colPrice, `${d.colAmount}, ${sym}`, d.colValue, ...(capKnown ? [d.colCap] : []), d.colWallet];
  const most = narrow ? 1 : 2;
  // What the signs mean — where no column beside the chart says it (a phone, a narrow desk): the bottom panel of a desk
  // would cut the «i» open (flaw 123).
  const signs = (legend ?? narrow) ? signsOf(rows, most) : [];
  const bar = (
    <div className={m.filterRow}>
      <Filters items={filters} value={filter} onChange={setPicked} />
      <MarksInfo marks={signs} />
    </div>
  );
  if (!rows.length) {
    return (
      <>
        {bar}
        <Line>{u[FILTER_NONE[filter as Exclude<TapeFilter, 'all'>]]}</Line>
      </>
    );
  }
  return (
    <>
      {bar}
      <Grid cols={narrow ? TRADE_COLS_PHONE : capKnown ? TRADE_COLS : TRADE_COLS_NO_CAP} label={d.marketTrades} head={head} narrow={narrow}>
        {rows.slice(0, narrow ? 40 : 100).map((trade, at) => {
          const ago = agoOf(trade.at, now);
          const fresh = tape.fresh.has(trade.signature);
          // On a phone the list stands in the page itself: a new trade rewrites the rows where they stand, so nothing
          // under the finger jumps down a row (QA 19.11: SOL's page moved 0.078 by its trades). On a desk it has its own box.
          // A fresh trade's row is keyed by it too, so its light starts over on the row it lands in, and only there.
          const key = narrow ? (fresh ? `${at}:${trade.signature}:${trade.side}` : String(at)) : `${trade.signature}:${trade.side}`;
          return (
            <div key={key} role="row" className={m.row} data-side={trade.side} data-fresh={fresh || undefined}>
              <span role="cell" className={m.dim}>
                <a href={solscanTx(trade.signature)} target="_blank" rel="noopener noreferrer nofollow" className={m.link}>
                  {ago ? digits(agoText(ago, d), lang) : '—'}
                </a>
              </span>
              <span role="cell" className={m.side}>
                {trade.side === 'buy' ? d.buy : d.sell}
              </span>
              {/* A tiny price with its zeros folded on a phone ($0.0₄4108), as the trades column beside the chart writes it. */}
              <span role="cell">{trade.priceUsd !== null ? (narrow ? tapePrice(trade.priceUsd, lang) : priceText(trade.priceUsd, lang)) : '—'}</span>
              {narrow ? null : <span role="cell">{amountOf(trade.tokenAmount, trade.tokenAmount >= 1 ? 2 : 6, lang)}</span>}
              <span role="cell" className={m.strong}>
                {trade.usd !== null ? sumText(trade.usd, lang) : '—'}
              </span>
              {capKnown ? (
                <span role="cell" className={m.dim}>
                  {trade.capUsd !== null ? usdText(trade.capUsd, lang) : '—'}
                </span>
              ) : null}
              <Wallet address={trade.wallet} marks={marksOf(trade.labels, most)} />
            </div>
          );
        })}
      </Grid>
    </>
  );
}

/* ----------------------------------------------------------------- holders */

const HOLDER_COLS = '32px minmax(150px, 1.3fr) minmax(130px, 1.3fr) minmax(84px, 0.9fr) minmax(100px, 1fr) minmax(120px, 1.1fr)';
/** On a phone: the rank, the wallet, the share, the worth, what it did. */
const HOLDER_COLS_PHONE = 'auto auto minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 0.9fr)';

/** A token amount as a holder's row writes it: whole from a thousand on, two places from one, six under it. */
const tokens = (value: number, lang: Lang) => amountOf(value, value >= 1_000 ? 0 : value >= 1 ? 2 : 6, lang);

/**
 * The coin's largest holders: the wallet with its mark, its share with a bar, what it is worth in dollars, how much, and
 * what it did in the trades read — bought more, sold. Where the list is only the largest part, one line says so.
 */
export function Holders({ mint, sym }: { mint: string; sym: string }) {
  const d = useWords(DESK);
  const u = useWords(UNDER);
  const lang = useLang();
  const narrow = useCompact(HOLDER_COLS);
  const read = useHolders(mint, true);
  const holders = useMemo(() => read.value?.holders ?? [], [read.value]);
  const top = useMemo(() => Math.max(1, ...holders.map((holder) => holder.sharePct ?? 0)), [holders]);
  if (!holders.length) return <Line>{read.status === 'reading' ? d.reading : read.status === 'failed' ? u.quiet : u.holdersQuiet}</Line>;
  const part = holdersPartOf(read.value?.reach, holders.length);
  const head = narrow ? ['#', d.colWallet, d.colShare, d.colValue, u.colDid] : ['#', d.colWallet, d.colShare, d.colValue, `${d.colAmount}, ${sym}`, u.colDid];
  return (
    <>
      <Caption info={<Info label={u.colDid}>{u.holdersWhy}</Info>}>
        {part ? (part.of !== null ? u.partOf(amountOf(part.listed, 0, lang), amountOf(part.of, 0, lang)) : u.partTop(amountOf(part.listed, 0, lang))) : null}
      </Caption>
      <Grid cols={narrow ? HOLDER_COLS_PHONE : HOLDER_COLS} label={d.holdersTab} head={head} narrow={narrow}>
        {holders.map((holder, i) => {
          const share = holder.sharePct;
          const move = holderMoveOf(holder);
          const value = holder.valueUsd;
          return (
            <div key={holder.owner} role="row" className={m.row}>
              <span role="cell" className={m.dim}>
                {digits(String(i + 1), lang)}
              </span>
              <Wallet address={holder.owner} marks={holderMarksOf(holder.labels)} />
              {narrow ? (
                <span role="cell">{share !== null ? digits(`${share.toFixed(share >= 10 ? 1 : 2)}%`, lang) : '—'}</span>
              ) : (
                <span role="cell" className={m.shareCell}>
                  <b>{share !== null ? digits(`${share.toFixed(2)}%`, lang) : '—'}</b>
                  <span className={m.shareBar} aria-hidden="true" style={{ ['--share' as string]: `${share !== null ? Math.round((share / top) * 100) : 0}%` }} />
                </span>
              )}
              <span role="cell" className={m.strong}>
                {typeof value === 'number' && Number.isFinite(value) ? usdText(value, lang) : '—'}
              </span>
              {narrow ? null : <span role="cell">{tokens(holder.amount, lang)}</span>}
              <span role="cell" className={m.move} data-move={move?.kind}>
                {move === null ? <span className={m.dim}>—</span> : move.kind === 'even' ? u.even : narrow ? (move.kind === 'added' ? u.added : u.sold) : `${move.kind === 'added' ? u.added : u.sold} ${move.kind === 'added' ? '+' : '−'}${tokens(move.tokens, lang)}`}
              </span>
            </div>
          );
        })}
      </Grid>
    </>
  );
}

/* ----------------------------------------------------------------- traders */

/* The table fits the box under the chart on a 1366 desk too (QA 20.11: «Trades» stood past the edge on 1440). */
const TRADER_COLS = 'minmax(136px, 1.4fr) repeat(4, minmax(72px, 1fr)) minmax(84px, 1fr) minmax(44px, 0.5fr)';
/** On a phone: the wallet, bought, sold, the result. */
const TRADER_COLS_PHONE = 'auto repeat(3, minmax(0, 1fr))';

/** A moment of the table's span, short, in the screen's language: «Nov 19, 14:05». */
function whenText(at: string | null, lang: Lang): string {
  const t = at ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat(LANG_LOCALE[lang], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(t);
}

/** What the traders' table stands on, for its «i»: how many trades, since when, and the standard of the result. */
function Basis({ basis }: { basis: TradersBasis }) {
  const u = useWords(UNDER);
  const lang = useLang();
  const n = amountOf(basis.trades, 0, lang);
  const from = whenText(basis.from, lang);
  return (
    <>
      {basis.whole ? u.tradersWhole(n, from) : u.tradersSpan(n, from)} {u.tradersRule}
    </>
  );
}

/**
 * Who traded the coin and who earned: what each bought and sold, the average prices, the result after fees with what is
 * still held valued at the price it would sell for now — the largest result first, a tap on «Result» turns the order.
 * Where the result cannot be counted, the counts of the trades read stand instead.
 */
export function Traders({ tape }: { tape: Tape }) {
  const d = useWords(DESK);
  const u = useWords(UNDER);
  const lang = useLang();
  const narrow = useCompact(TRADER_COLS);
  const read = useTraders(tape.mint ?? null, true);
  const [dir, setDir] = useState<'down' | 'up'>('down');
  const rows = useMemo(() => sortTraders(read.value?.traders ?? [], dir), [read.value, dir]);
  if (rows.length) {
    const basis = read.value?.basis ?? null;
    const sort = (
      <button type="button" className={m.sort} aria-label={u.sortResult} aria-pressed={dir === 'up'} onClick={() => setDir((was) => (was === 'down' ? 'up' : 'down'))}>
        {u.colResult}
        <span aria-hidden="true">{dir === 'down' ? '↓' : '↑'}</span>
      </button>
    );
    const head = narrow ? [d.colWallet, d.colBought, d.colSold, sort] : [d.colWallet, d.colBought, d.colSold, u.colAvgBuy, u.colAvgSell, sort, d.colTrades];
    return (
      <>
        <Caption info={basis ? <Info label={u.tradersHow} word={narrow ? undefined : u.tradersHow}><Basis basis={basis} /></Info> : null}>{u.tradersCount(amountOf(rows.length, 0, lang))}</Caption>
        <Grid cols={narrow ? TRADER_COLS_PHONE : TRADER_COLS} label={d.tradersTab} head={head} narrow={narrow} fit>
          {rows.map((row) => (
            <TraderLine key={row.wallet} row={row} narrow={narrow} />
          ))}
        </Grid>
      </>
    );
  }
  if (read.status === 'reading' && tape.mint) return <Line>{d.reading}</Line>;
  return <TapeTraders tape={tape} />;
}

function TraderLine({ row, narrow }: { row: TraderRow; narrow: boolean }) {
  const u = useWords(UNDER);
  const lang = useLang();
  const sum = (value: number) => sumText(value, lang);
  const result = row.resultUsd;
  return (
    <div role="row" className={m.row}>
      <Wallet address={row.wallet} marks={marksOf(row.labels, narrow ? 1 : 2)} />
      <span role="cell" className={m.buyText}>
        {row.boughtUsd > 0 ? sum(row.boughtUsd) : '—'}
      </span>
      <span role="cell" className={m.sellText}>
        {row.soldUsd > 0 ? sum(row.soldUsd) : '—'}
      </span>
      {narrow ? null : <span role="cell">{row.avgBuyPriceUsd !== null ? priceText(row.avgBuyPriceUsd, lang) : '—'}</span>}
      {narrow ? null : <span role="cell">{row.avgSellPriceUsd !== null ? priceText(row.avgSellPriceUsd, lang) : '—'}</span>}
      <span role="cell" className={m.net} data-tone={resultTone(result)} title={result === null ? u.noResult : undefined}>
        {result === null ? '—' : signedSum(result, sum)}
      </span>
      {narrow ? null : (
        <span role="cell" className={m.dim}>
          {digits(`${row.buys + row.sells}`, lang)}
        </span>
      )}
    </div>
  );
}

const TAPE_TRADER_COLS = 'minmax(150px, 1.4fr) repeat(3, minmax(100px, 1fr)) minmax(64px, 0.6fr)';

/** Where the engine has no table for the coin: who traded most over the trades read, in dollars bought and sold, the net. */
function TapeTraders({ tape }: { tape: Tape }) {
  const d = useWords(DESK);
  const u = useWords(UNDER);
  const lang = useLang();
  const traders = useMemo(() => tradersOf(tape.trades), [tape.trades]);
  if (!traders.length) return <Line>{tape.status === 'reading' ? d.reading : tape.status === 'failed' ? u.quiet : u.tradersQuiet}</Line>;
  return (
    <>
      <p className={m.caption}>{d.tradersOf(digits(String(tape.trades.length), lang))}</p>
      <Grid cols={TAPE_TRADER_COLS} label={d.tradersTab} head={[d.colWallet, d.colBought, d.colSold, d.colNet, d.colTrades]}>
        {traders.map((trader) => (
          <div key={trader.wallet} role="row" className={m.row}>
            <Wallet address={trader.wallet} />
            <span role="cell" className={m.buyText}>
              {trader.bought > 0 ? sumText(trader.bought, lang) : '—'}
            </span>
            <span role="cell" className={m.sellText}>
              {trader.sold > 0 ? sumText(trader.sold, lang) : '—'}
            </span>
            <span role="cell" className={m.net} data-tone={trader.net > 0 ? 'up' : trader.net < 0 ? 'down' : undefined}>
              {`${trader.net > 0 ? '+' : trader.net < 0 ? '−' : ''}${sumText(Math.abs(trader.net), lang)}`}
            </span>
            <span role="cell" className={m.dim}>
              {digits(String(trader.trades), lang)}
            </span>
          </div>
        ))}
      </Grid>
    </>
  );
}
