'use client';

import { useMemo, type ReactNode } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { useNarrow } from '@/terminal/shell/useNarrow';
import { amountOf, priceText, sumText, usdText } from '@/terminal/ui';
import { DESK } from './desk-words';
import { agoOf, shortAddress, tradersOf } from './tape-view';
import { agoText } from './Tape';
import { useHolders, useNow, type Tape } from './useCoinMarket';
import m from './market.module.css';

/** A wallet or a transaction on Solscan, the explorer people read: a new tab, nothing of Ryntra's sent with it. */
const solscan = (kind: 'account' | 'tx', id: string) => `https://solscan.io/${kind}/${encodeURIComponent(id)}`;

/** A table of numbers, dense as a trader reads it: a head, then rows. `cols` is the grid's columns. */
function Grid({ cols, label, head, narrow = false, children }: { cols: string; label: string; head: readonly ReactNode[]; narrow?: boolean; children: ReactNode }) {
  return (
    <div className={m.scroll}>
      <div role="table" aria-label={label} className={m.table} data-narrow={narrow || undefined} style={{ ['--cols' as string]: cols }}>
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

/** On a phone: when, the side, the price, the value, the wallet. */
const TRADE_COLS_PHONE = 'minmax(40px, 0.6fr) minmax(58px, 0.8fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr)';
const TRADE_COLS = 'minmax(64px, 0.7fr) minmax(76px, 0.8fr) minmax(110px, 1.1fr) minmax(110px, 1.1fr) minmax(96px, 1fr) minmax(96px, 1fr) minmax(100px, 1fr)';

/** The market's own trades of the coin, the newest first: when, which side, the price, how much, the wallet. */
export function MarketTrades({ tape, sym }: { tape: Tape; sym: string }) {
  const d = useWords(DESK);
  const lang = useLang();
  const now = useNow(5_000);
  const narrow = useNarrow();
  if (!tape.trades.length) return <Line>{tape.status === 'reading' ? d.reading : tape.status === 'failed' ? d.tapeFailed : d.noTape}</Line>;
  const head = narrow ? [d.colTime, d.colSide, d.colPrice, d.colValue, d.colWallet] : [d.colTime, d.colSide, d.colPrice, `${d.colAmount}, ${sym}`, d.colValue, d.colCap, d.colWallet];
  return (
    <Grid cols={narrow ? TRADE_COLS_PHONE : TRADE_COLS} label={d.marketTrades} head={head} narrow={narrow}>
      {tape.trades.slice(0, narrow ? 40 : 100).map((trade, at) => {
        const ago = agoOf(trade.at, now);
        const fresh = tape.fresh.has(trade.signature);
        // On a phone the list stands in the page itself: a new trade rewrites the rows where they stand, so nothing
        // under the finger jumps down a row (QA 19.11: SOL's page moved 0.078 by its trades). On a desk it has its own box.
        // A fresh trade's row is keyed by it too, so its light starts over on the row it lands in, and only there.
        const key = narrow ? (fresh ? `${at}:${trade.signature}:${trade.side}` : String(at)) : `${trade.signature}:${trade.side}`;
        return (
          <div key={key} role="row" className={m.row} data-side={trade.side} data-fresh={fresh || undefined}>
            <span role="cell" className={m.dim}>
              <a href={solscan('tx', trade.signature)} target="_blank" rel="noopener noreferrer nofollow" className={m.link}>
                {ago ? digits(agoText(ago, d), lang) : '—'}
              </a>
            </span>
            <span role="cell" className={m.side}>
              {trade.side === 'buy' ? d.buy : d.sell}
            </span>
            <span role="cell">{trade.priceUsd !== null ? priceText(trade.priceUsd, lang) : '—'}</span>
            {narrow ? null : <span role="cell">{amountOf(trade.tokenAmount, trade.tokenAmount >= 1 ? 2 : 6, lang)}</span>}
            <span role="cell" className={m.strong}>
              {trade.usd !== null ? sumText(trade.usd, lang) : '—'}
            </span>
            {narrow ? null : (
              <span role="cell" className={m.dim}>
                {trade.capUsd !== null ? usdText(trade.capUsd, lang) : '—'}
              </span>
            )}
            <span role="cell">
              <a href={solscan('account', trade.wallet)} target="_blank" rel="noopener noreferrer nofollow" className={m.link}>
                {shortAddress(trade.wallet)}
              </a>
            </span>
          </div>
        );
      })}
    </Grid>
  );
}

const HOLDER_COLS = '40px minmax(150px, 1.4fr) minmax(160px, 1.6fr) minmax(110px, 1fr) minmax(96px, 1fr)';

/** The coin's largest holders: the wallet (a pool or a vault said so), its share with a bar, how much, its net in the read. */
export function Holders({ mint, sym }: { mint: string; sym: string }) {
  const d = useWords(DESK);
  const lang = useLang();
  const read = useHolders(mint, true);
  const holders = useMemo(() => read.value?.holders ?? [], [read.value]);
  const top = useMemo(() => Math.max(1, ...holders.map((holder) => holder.sharePct ?? 0)), [holders]);
  if (!holders.length) return <Line>{read.status === 'reading' ? d.reading : d.noHolders}</Line>;
  return (
    <Grid cols={HOLDER_COLS} label={d.holdersTab} head={['#', d.colWallet, d.colShare, `${d.colAmount}, ${sym}`, d.colNet]}>
      {holders.map((holder, i) => {
        const label = holder.labels.includes('creator') ? d.creator : holder.labels.includes('program') || holder.labels.includes('pool') ? d.program : null;
        const share = holder.sharePct;
        return (
          <div key={holder.owner} role="row" className={m.row}>
            <span role="cell" className={m.dim}>
              {digits(String(i + 1), lang)}
            </span>
            <span role="cell" className={m.wallet}>
              <a href={solscan('account', holder.owner)} target="_blank" rel="noopener noreferrer nofollow" className={m.link}>
                {shortAddress(holder.owner)}
              </a>
              {label ? <span className={m.tag}>{label}</span> : null}
            </span>
            <span role="cell" className={m.shareCell}>
              <b>{share !== null ? digits(`${share.toFixed(2)}%`, lang) : '—'}</b>
              <span className={m.shareBar} aria-hidden="true" style={{ ['--share' as string]: `${share !== null ? Math.round((share / top) * 100) : 0}%` }} />
            </span>
            <span role="cell">{amountOf(holder.amount, holder.amount >= 1 ? 2 : 6, lang)}</span>
            <span role="cell" className={m.net} data-tone={holder.change === null ? undefined : holder.change > 0 ? 'up' : holder.change < 0 ? 'down' : undefined}>
              {holder.change === null ? '—' : `${holder.change > 0 ? '+' : holder.change < 0 ? '−' : ''}${amountOf(Math.abs(holder.change), Math.abs(holder.change) >= 1 ? 2 : 6, lang)}`}
            </span>
          </div>
        );
      })}
    </Grid>
  );
}

const TRADER_COLS = 'minmax(150px, 1.4fr) repeat(3, minmax(100px, 1fr)) minmax(64px, 0.6fr)';

/** Who traded the coin most over the trades read: what each bought and sold in dollars, the net, how many trades. */
export function Traders({ tape }: { tape: Tape }) {
  const d = useWords(DESK);
  const lang = useLang();
  const traders = useMemo(() => tradersOf(tape.trades), [tape.trades]);
  if (!traders.length) return <Line>{tape.status === 'reading' ? d.reading : tape.status === 'failed' ? d.tapeFailed : d.noTape}</Line>;
  return (
    <>
      <p className={m.caption}>{d.tradersOf(digits(String(tape.trades.length), lang))}</p>
      <Grid cols={TRADER_COLS} label={d.tradersTab} head={[d.colWallet, d.colBought, d.colSold, d.colNet, d.colTrades]}>
        {traders.map((trader) => (
          <div key={trader.wallet} role="row" className={m.row}>
            <span role="cell">
              <a href={solscan('account', trader.wallet)} target="_blank" rel="noopener noreferrer nofollow" className={m.link}>
                {shortAddress(trader.wallet)}
              </a>
            </span>
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
