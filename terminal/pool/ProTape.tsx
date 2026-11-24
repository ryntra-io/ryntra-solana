'use client';

import Link from 'next/link';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { useWallet } from '@/city/lib/trade/wallet';
import { myBonus } from '@/lib/portfolio/pool-result';
import type { ProFill, ProTrade, TapePair } from '@/lib/pro-pools/tape';
import { agoText } from '@/terminal/coin/Tape';
import { agoOf, shortAddress, tapePrice } from '@/terminal/coin/tape-view';
import { useNow } from '@/terminal/coin/useCoinMarket';
import { DESK } from '@/terminal/coin/desk-words';
import { dayText } from '@/terminal/earn/ResultFacts';
import { shortUsd } from '@/terminal/earn/rows';
import { Info, Quiet } from '@/terminal/ui';
import { fillAmounts, sidesOf, walletHref, type ProDay } from './pro-tape';
import { useProList } from './useProTape';
import { POOL } from './words';
import t from '@/terminal/coin/tape.module.css';
import p from './pool.module.css';

const SHORT: Readonly<Record<Lang, readonly [string, string]>> = { en: ['K', 'M'], uk: [' тис.', ' млн'] };

/** Whole coins, short, in the language's own digits and units: «1.25 USDC», «12.4K RHRSL», «36,15 млн RHRSL». */
function coinText(amount: number, symbol: string, lang: Lang): string {
  const [k, m] = SHORT[lang] ?? SHORT.en;
  const short = amount >= 1e6 ? `${digits((amount / 1e6).toFixed(2), lang)}${m}` : amount >= 1e4 ? `${digits((amount / 1e3).toFixed(1), lang)}${k}` : digits(amount.toLocaleString('en-US', { maximumFractionDigits: amount >= 100 ? 1 : amount >= 1 ? 3 : 4 }), lang);
  return `${short} ${symbol}`.trim();
}

/** One quiet line where a list has no rows: reading, failed (with «Try again»), or empty. */
function Line({ status, empty, again }: { status: 'reading' | 'failed' | 'ready' | 'none'; empty: string; again: () => void }) {
  const w = useWords(POOL);
  if (status === 'reading') {
    return (
      <p className={t.line} role="status" aria-busy="true">
        <span className={t.shimmer} />
      </p>
    );
  }
  return (
    <p className={`${t.line} ${p.tapeLine}`} role="status">
      <span>{status === 'failed' ? w.tapeFailed : empty}</span>
      {status === 'failed' ? (
        <Quiet size="s" onClick={again}>
          {w.again}
        </Quiet>
      ) : null}
    </p>
  );
}

/** A wallet in a row: short, a tap opens its own page. */
function Wallet({ address }: { address: string | null }) {
  const w = useWords(POOL);
  if (!address) return <span className={p.tapeWallet}>—</span>;
  const short = shortAddress(address);
  return (
    <Link className={p.tapeWallet} href={walletHref(address)} aria-label={w.walletOf(short)}>
      {short}
    </Link>
  );
}

/** A trade's price in dollars where the coin it is priced in has one, else in that coin. */
function tradePrice(trade: ProTrade, pair: TapePair, lang: Lang): string {
  if (trade.price === null) return '—';
  if (pair.quote.usd !== null) return tapePrice(trade.price * pair.quote.usd, lang);
  return coinText(trade.price, pair.quote.symbol ?? '', lang);
}

/** A trade's size in dollars where the coin it is priced in has one, else in the coin traded. */
function tradeSize(trade: ProTrade, pair: TapePair, lang: Lang): string {
  if (pair.quote.usd !== null) return shortUsd(trade.quoteAmount * pair.quote.usd, lang);
  return coinText(trade.coinAmount, pair.coin.symbol ?? '', lang);
}

/**
 * The pool's own trades, newest first — read from the program's events, not the coin's market: the price, the size, who
 * traded (a tap opens the wallet's page) and how long ago.
 */
export function ProTrades({ address }: { address: string }) {
  const w = useWords(POOL);
  const d = useWords(DESK);
  const lang = useLang();
  const now = useNow(5_000);
  const { read, again } = useProList(address, 'trades', true);
  if (read.status !== 'ready' || !read.value.trades.length) return <Line status={read.status === 'ready' ? 'none' : read.status} empty={w.noTrades} again={again} />;
  const { pair, trades } = read.value;
  return (
    <>
      <div className={`${t.cols} ${p.tapeCols}`} aria-hidden="true">
        <span>{w.colTradePrice}</span>
        <span>{w.colSize}</span>
        <span>{w.colWallet}</span>
        <span>{d.colTime}</span>
      </div>
      <ol className={t.list} aria-label={w.trades} data-pool-trades="">
        {trades.map((trade, at) => {
          const ago = trade.at ? agoOf(trade.at, now) : null;
          return (
            <li key={`${trade.signature}:${at}`} className={`${t.row} ${p.tapeRow}`} data-side={trade.side}>
              <span className={t.price}>{tradePrice(trade, pair, lang)}</span>
              <span className={t.size}>{tradeSize(trade, pair, lang)}</span>
              <Wallet address={trade.wallet} />
              <span className={t.time}>{ago ? digits(agoText(ago, d), lang) : ''}</span>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/**
 * The pool's limit orders collected with a part filled, newest first: buy or sell, filled whole or in part, what the
 * order got, the bonus its maker took and whose it was. Over them — the day's bonus paid and, for the person, what
 * their own orders brought here; how the bonus is counted and from when — behind one «i».
 */
export function ProFills({ address, day }: { address: string; day: ProDay | null }) {
  const w = useWords(POOL);
  const lang = useLang();
  const owner = useWallet((st) => st.connection?.address ?? null);
  const { read, again } = useProList(address, 'fills', true);
  const answer = read.status === 'ready' ? read.value : null;
  const mine = answer && owner ? myBonus(answer.fills, owner, sidesOf(answer.pair)) : null;
  const from = answer?.depth.from ? Date.parse(answer.depth.from) : NaN;
  return (
    <>
      <div className={p.fillsHead}>
        {/* The day's bonus stands only once the day is read: a cold day shows no figure rather than a dash. */}
        {day && day.bonusPaidUsd !== null ? (
          <span className={p.fillsFigure}>
            <span>{w.bonusPaid24}</span>
            <b className={p.up}>{`${day.whole ? '' : '≥ '}${shortUsd(day.bonusPaidUsd, lang)}`}</b>
            <span>{digits(w.filledN(String(day.filled)), lang)}</span>
          </span>
        ) : (
          <span className={p.fillsFigure} />
        )}
        <Info label={w.fillsTitle}>
          <span className={p.facts}>
            <span>{w.fillsWhy}</span>
            {Number.isFinite(from) ? <span>{w.readFrom(dayText(from, lang))}</span> : null}
          </span>
        </Info>
      </div>
      {mine && mine.count > 0 && mine.usd !== null ? (
        <p className={p.fillsMine} data-pool-my-bonus="">
          <span>{w.yourBonus}</span>
          <b className={p.up}>{`+${shortUsd(mine.usd, lang)}`}</b>
        </p>
      ) : null}
      {!answer || !answer.fills.length ? (
        <Line status={read.status === 'ready' ? 'none' : read.status} empty={w.noFills} again={again} />
      ) : (
        <>
          <ol className={t.list} aria-label={w.tabLimits} data-pool-fills="">
            {answer.fills.map((fill: ProFill, at) => {
              const { got, bonus } = fillAmounts(fill, answer.pair);
              return (
                <li key={`${fill.signature}:${fill.order}:${at}`} className={p.fillRow} data-side={fill.coinSide ?? undefined}>
                  <span className={p.fillWhat}>{`${fill.coinSide === 'buy' ? w.buy : fill.coinSide === 'sell' ? w.sell : '—'} · ${fill.state === 'filled' ? w.filledWhole : w.filledPart}`}</span>
                  <span className={`${p.fillBonus} ${p.up}`}>{bonus.length ? `+${bonus.map((part) => coinText(part.amount, part.symbol, lang)).join(' + ')}` : '—'}</span>
                  <span className={p.fillGot}>{got ? coinText(got.amount, got.symbol, lang) : '—'}</span>
                  <Wallet address={fill.owner} />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </>
  );
}
