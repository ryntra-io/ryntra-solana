'use client';

import { useMemo, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { EarnBinsVenue } from '@/lib/earn-pools/bins';
import { useBins, type BinsState } from '@/terminal/earn/range/useBins';
import { Info, Tabs, sumText, usdText } from '@/terminal/ui';
import { DESK } from './desk-words';
import { agoOf, buyShareOf, depthBook, dexName, marksOf, signsOf, tapePrice, type DepthRow, type TokenPool, type WalletLabel } from './tape-view';
import { UNDER } from './under-words';
import { usePools, useNow, type Tape as TapeRead } from './useCoinMarket';
import { useCoinPool } from './useCoinPool';
import t from './tape.module.css';

export type TapeTab = 'trades' | 'depth';

/**
 * The narrow column beside the chart, as a trader's desk has it: the coin's trades as they come (time, price,
 * size, green a buy, red a sale; the new ones lit a moment) with the buyers' share of the dollars under them, and the
 * liquidity — the coin's deepest DLMM pool as a book by price where it has one, else the pools it trades in, deepest
 * first. Everything is the engine's read; nothing here is counted but the shares.
 */
export function Tape({ mint, tape, usd, tab, onTab, head }: { mint: string; tape: TapeRead; usd: number | null; tab: TapeTab; onTab: (tab: TapeTab) => void; head?: ReactNode }) {
  const d = useWords(DESK);
  return (
    <div className={t.tape}>
      <div className={t.head}>
        <Tabs
          bare
          label={d.tape}
          value={tab}
          onChange={onTab}
          items={[
            { id: 'trades', label: d.tapeTrades },
            { id: 'depth', label: d.tapeDepth },
          ]}
        />
        {/* What the signs by the wallets mean — here, where the «i» opens whole over the desk (flaw 123). */}
        {tab === 'trades' ? (
          <span className={t.headInfo}>
            <MarksInfo marks={signsOf(tape.trades)} />
          </span>
        ) : null}
        {head}
      </div>
      {tab === 'trades' ? <Trades tape={tape} /> : <Liquidity mint={mint} usd={usd} />}
    </div>
  );
}

/** The trades as they come, newest on top, and the buyers' share of the dollars at the foot. */
export function Trades({ tape, rows = 60 }: { tape: TapeRead; rows?: number }) {
  const d = useWords(DESK);
  const lang = useLang();
  const now = useNow(5_000);
  const share = useMemo(() => buyShareOf(tape.trades.slice(0, 100)), [tape.trades]);
  if (!tape.trades.length) {
    return (
      <p className={t.line} role="status" aria-busy={tape.status === 'reading' || undefined}>
        {tape.status === 'reading' ? <span className={t.shimmer} /> : tape.status === 'failed' ? d.tapeFailed : d.noTape}
      </p>
    );
  }
  return (
    <>
      <div className={t.cols} aria-hidden="true">
        <span>{d.colPrice}</span>
        <span>{d.colSize}</span>
        <span>{d.colTime}</span>
      </div>
      <ol className={t.list} aria-label={d.tapeTrades}>
        {tape.trades.slice(0, rows).map((trade) => {
          const ago = agoOf(trade.at, now);
          return (
            <li key={`${trade.signature}:${trade.side}`} className={t.row} data-side={trade.side} data-fresh={tape.fresh.has(trade.signature) || undefined}>
              <span className={t.price}>{trade.priceUsd !== null ? tapePrice(trade.priceUsd, lang) : '—'}</span>
              <span className={t.size}>
                <WalletMarks marks={marksOf(trade.labels, 3).filter((mark) => TAPE_MARKS.has(mark)).slice(0, 1)} />
                {trade.usd !== null ? sumText(trade.usd, lang) : '—'}
              </span>
              <span className={t.time}>{ago ? digits(agoText(ago, d), lang) : ''}</span>
            </li>
          );
        })}
      </ol>
      {share !== null ? <Balance share={share} /> : null}
    </>
  );
}

/** The marks the narrow column shows: who the wallet is, never the trade's size (the size is written beside it). */
const TAPE_MARKS: ReadonlySet<WalletLabel> = new Set(['ryntra-agent', 'creator', 'top-holder', 'fresh']);

type MarkWord = 'markCreator' | 'markAgent' | 'markTop' | 'markPool' | 'markVault' | 'markBig' | 'markFresh';
const MARK_WORD: Readonly<Record<WalletLabel, MarkWord>> = {
  creator: 'markCreator',
  'ryntra-agent': 'markAgent',
  'top-holder': 'markTop',
  pool: 'markPool',
  program: 'markVault',
  big: 'markBig',
  fresh: 'markFresh',
};

/** Each mark's sign, drawn with a stroke in its own tone. */
const MARK_PATH: Readonly<Record<WalletLabel, string>> = {
  creator: 'M4 17.5 5.5 8l4.5 4 2-6.5 2 6.5 4.5-4 1.5 9.5z',
  'ryntra-agent': 'M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z',
  'top-holder': 'M12 3.5 20 12l-8 8.5L4 12z',
  pool: 'M12 3.5c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z',
  program: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  big: 'M13 3 5.5 13.5H11L10 21l7.5-10.5H12z',
  fresh: 'M12 21v-8.5M12 12.5c0-4.5 3-7.5 8-7.5 0 5-3 7.5-8 7.5zM12 14.5c0-3-2-5.5-6-5.5 0 3.5 2 5.5 6 5.5',
};

/**
 * The marks beside a wallet: a small sign each, its one word as the hint and as what a reader hears. Nothing for none —
 * a wallet without marks reads as it always did.
 */
export function WalletMarks({ marks }: { marks: readonly WalletLabel[] }) {
  const u = useWords(UNDER);
  if (!marks.length) return null;
  return (
    <span className={t.marks}>
      {marks.map((mark) => (
        <span key={mark} className={t.mark} data-mark={mark} role="img" aria-label={u[MARK_WORD[mark]]} title={u[MARK_WORD[mark]]}>
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d={MARK_PATH[mark]} />
          </svg>
        </span>
      ))}
    </span>
  );
}

type WhyWord = 'whyCreator' | 'whyAgent' | 'whyTop' | 'whyPool' | 'whyVault' | 'whyBig' | 'whyFresh';
const WHY_WORD: Readonly<Record<WalletLabel, WhyWord>> = {
  creator: 'whyCreator',
  'ryntra-agent': 'whyAgent',
  'top-holder': 'whyTop',
  pool: 'whyPool',
  program: 'whyVault',
  big: 'whyBig',
  fresh: 'whyFresh',
};

/**
 * What the signs beside the wallets mean, behind one «i»: each sign on screen with its sentence (flaw 123 —
 * «◇» and «⚡» stood by the wallets with a hint only under the pointer). Nothing when no row carries a sign.
 */
export function MarksInfo({ marks }: { marks: readonly WalletLabel[] }) {
  const u = useWords(UNDER);
  if (!marks.length) return null;
  return (
    <Info label={u.marksWhy}>
      <ul className={t.why}>
        {marks.map((mark) => (
          <li key={mark}>
            <WalletMarks marks={[mark]} />
            <span>{u[WHY_WORD[mark]]}</span>
          </li>
        ))}
      </ul>
    </Info>
  );
}

/** The buyers' and the sellers' shares of the dollars, as one bar. */
function Balance({ share }: { share: number }) {
  const d = useWords(DESK);
  const lang = useLang();
  const buy = Math.round(share * 100);
  return (
    <div className={t.balance} style={{ ['--buy' as string]: `${buy}%` }}>
      <span className={t.buyShare}>
        {d.buysShare} {digits(String(buy), lang)}%
      </span>
      <span className={t.bar} aria-hidden="true" />
      <span className={t.sellShare}>
        {digits(String(100 - buy), lang)}% {d.sellsShare}
      </span>
    </div>
  );
}

export function agoText(ago: NonNullable<ReturnType<typeof agoOf>>, d: (typeof DESK)['en']): string {
  const n = String(ago.n);
  return ago.unit === 's' ? d.agoS(n) : ago.unit === 'm' ? d.agoM(n) : ago.unit === 'h' ? d.agoH(n) : d.agoD(n);
}

/** The coin's liquidity: its DLMM pool's book by price, or its pools. */
export function Liquidity({ mint, usd }: { mint: string; usd: number | null }) {
  const d = useWords(DESK);
  const pool = useCoinPool(mint);
  if (pool.status === 'reading') {
    return (
      <p className={t.line} role="status" aria-label={d.reading}>
        <span className={t.shimmer} />
      </p>
    );
  }
  if (pool.pool) return <PoolBook address={pool.pool.pool.address} side={pool.pool.side} usd={usd} name={`${pool.pool.pool.x.symbol}/${pool.pool.pool.y.symbol}`} />;
  return <PoolList mint={mint} />;
}

/**
 * A pool's liquidity as a book by price: asks over the price, bids under it, each row its dollars and the running total.
 * The coin's deepest DLMM pool on the Spot; a pool's own page names its pool and venue — DLMM Pro among them.
 */
export function PoolBook({ address, venue = 'dlmm', side, usd, name, bins: given }: { address: string; venue?: EarnBinsVenue; side: 'x' | 'y'; usd: number | null; name: string; bins?: BinsState }) {
  const d = useWords(DESK);
  const lang = useLang();
  // A pool's own page hands its one read of the bins in: the book and the bars beside it never tell two stories.
  const own = useBins(venue, given ? null : address);
  const bins = given ?? own;
  const book = useMemo(() => (bins.status === 'ready' ? depthBook(bins.value, side, usd) : { asks: [], bids: [] }), [bins, side, usd]);
  if (!book.asks.length && !book.bids.length) {
    if (bins.status === 'reading') {
      return (
        <p className={t.line} role="status">
          <span className={t.shimmer} />
        </p>
      );
    }
    // One quiet line, never «no pools» for a pool that is there: nothing in it yet; something, but not a
    // cent on any price. On a pool's own page (its read handed in) the bars beside the book speak for a read that failed
    // or a coin without a dollar price, so the book says nothing; the Spot keeps its line.
    const held = bins.status === 'ready' && bins.value.bins.some((bin) => bin.x !== '0' || bin.y !== '0');
    const priced = usd !== null && usd > 0;
    const line = bins.status === 'ready' && !held ? d.bookEmpty : bins.status === 'ready' && priced ? d.bookThin : given ? null : d.noPools;
    return line ? (
      <p className={t.line} role="status">
        {line}
      </p>
    ) : null;
  }
  const row = (r: DepthRow) => (
    <li key={r.key} className={t.depthRow} data-side={r.side} style={{ ['--share' as string]: `${Math.round(r.share * 100)}%` }}>
      <span className={t.price}>{tapePrice(r.price, lang)}</span>
      <span className={t.size}>{sumText(r.usd, lang)}</span>
      <span className={t.total}>{sumText(r.total, lang)}</span>
    </li>
  );
  return (
    <>
      <div className={t.cols} aria-hidden="true">
        <span>{d.colPrice}</span>
        <span>{d.colSize}</span>
        <span>{d.total}</span>
      </div>
      <div className={t.book} aria-label={d.poolBook(name)}>
        <ol className={t.asks}>{[...book.asks].reverse().map(row)}</ol>
        <p className={t.mid}>
          <b>{usd !== null ? tapePrice(usd, lang) : '—'}</b>
          <span>{name}</span>
        </p>
        <ol className={t.bids}>{book.bids.map(row)}</ol>
      </div>
    </>
  );
}

function PoolList({ mint }: { mint: string }) {
  const d = useWords(DESK);
  const lang = useLang();
  const pools = usePools(mint, true);
  const list: readonly TokenPool[] = pools.value ?? [];
  if (!list.length) {
    return (
      <p className={t.line} role="status">
        {pools.status === 'reading' ? <span className={t.shimmer} /> : d.noPools}
      </p>
    );
  }
  const deepest = Math.max(...list.map((p) => p.reserveUsd ?? 0));
  return (
    <>
      <div className={t.cols} aria-hidden="true">
        <span>{d.colPool}</span>
        <span>{d.colLiquidity}</span>
      </div>
      <ol className={t.list} aria-label={d.depthNone}>
        {list.map((pool) => (
          <li key={pool.address} className={t.poolRow} style={{ ['--share' as string]: `${deepest > 0 ? Math.round(((pool.reserveUsd ?? 0) / deepest) * 100) : 0}%` }}>
            <span className={t.poolName}>
              <b>{pool.name}</b>
              <span>{dexName(pool.dex)}</span>
            </span>
            <span className={t.size}>{pool.reserveUsd !== null ? usdText(pool.reserveUsd, lang) : '—'}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
