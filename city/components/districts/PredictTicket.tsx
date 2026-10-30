'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { tradable } from '@/city/lib/districts/predict/detail';
import { cents, clock, closesIn, isDelayed, sideName, signedUsd, toWin, usd, volumeText, type Side } from '@/city/lib/districts/predict/markets';
import { AMOUNT_TILES, buyRefusal, SELL_TILES } from '@/city/lib/districts/predict/practice';
import { useReal, type Connection } from '@/city/lib/districts/predict/real-store';
import { doneNotice, practiceView, realView } from '@/city/lib/districts/predict/ticket';
import { priceOf, usePredict } from '@/city/lib/districts/predict/store';
import { PREDICT } from '@/city/lib/districts/predict/words';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue } from '@/city/lib/i18n/figures';
import { useWallet } from '@/city/lib/trade/wallet';
import { isPhoneUserAgent, PHANTOM_DOWNLOAD_URL, phantomBrowseUrl } from '@/lib/solana/open-in-wallet';
import { useNow, usePageMarket } from './predictHooks';
import { CheckGlyph, InfoGlyph, PracticeCoin, UsdcCoin } from './predictGlyphs';
import s from './predict.module.css';

/**
 * The ticket beside a market: Buy or Sell, the side with its price, the amount in dollars with its tiles, what it wins
 * if right, and one orange action. In Practice the action is taken at once; with real money the engine's Review comes
 * first — what leaves the account, the fee, what it pays — in one line, and the action confirms it. The rules, the
 * sources and the close wait behind «Details».
 */
export function PredictTicket() {
  const at = usePageMarket();
  const action = usePredict((st) => st.action);
  const setAction = usePredict((st) => st.setAction);
  const side = usePredict((st) => st.side);
  const setSide = usePredict((st) => st.setSide);
  const mode = usePredict((st) => st.mode);
  const resetTrade = useReal((st) => st.resetTrade);
  const w = useWords(PREDICT);
  if (!at) return null;
  const { market } = at;
  return (
    <aside className={s.ticket}>
      {at.detail && at.detail.rows.length > 1 && market.question ? <div className={s.ticketMarket}>{market.question}</div> : null}
      <div className={s.ticketTabs} role="tablist" aria-label={w.buyOrSell}>
        {(['buy', 'sell'] as const).map((a) => (
          <button
            key={a}
            role="tab"
            aria-selected={action === a}
            className={`${s.ticketTab} ${action === a ? s.ticketTabOn : ''}`}
            onClick={() => {
              resetTrade();
              setAction(a);
            }}
          >
            {a === 'buy' ? w.buy : w.sell}
          </button>
        ))}
      </div>
      <div className={s.choices} role="radiogroup" aria-label={w.side} data-many={market.sides.length > 2 ? '' : undefined}>
        {market.sides.map((x, i) => (
          <Choice
            key={x.id}
            side={x}
            tone={market.binary ? (i === 0 ? 'yes' : 'no') : 'alt'}
            on={x.id === side}
            onPick={() => {
              resetTrade();
              setSide(x.id);
            }}
          />
        ))}
      </div>
      {mode === 'real' ? <RealTicket /> : <PracticeTicket />}
      <Details />
    </aside>
  );
}

function Choice({ side, tone, on, onPick }: { side: Side; tone: 'yes' | 'no' | 'alt'; on: boolean; onPick: () => void }) {
  return (
    <button role="radio" aria-checked={on} className={`${s.choice} ${s[`choice_${tone}`]} ${on ? s.choiceOn : ''}`} onClick={onPick}>
      <span className={s.choiceCheck} aria-hidden="true">
        <CheckGlyph />
      </span>
      <span className={s.choiceLabel}>{sideName(side.label)}</span>
      <span className={s.choicePrice}>{cents(side.p)}</span>
    </button>
  );
}

/** The amount field and its tiles: dollars, typed or tapped. */
function Amount({ coin, label, unit }: { coin: ReactNode; label: string; unit: string }) {
  const amount = usePredict((st) => st.amount);
  const setAmount = usePredict((st) => st.setAmount);
  const resetTrade = useReal((st) => st.resetTrade);
  const w = useWords(PREDICT);
  const [text, setText] = useState(() => String(amount));
  useEffect(() => {
    // A tile tapped writes the field; what the person types stays as typed.
    if (Number(text) !== amount) setText(amount ? String(amount) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);
  return (
    <>
      <label className={s.fieldLabel} htmlFor="predict-amount">
        {label}
      </label>
      <div className={s.field}>
        <span className={s.fieldCoin}>{coin}</span>
        <input
          id="predict-amount"
          className={s.fieldInput}
          inputMode="decimal"
          autoComplete="off"
          value={fieldText(text)}
          onChange={(e) => {
            const v = fieldValue(e.target.value).replace(/[^0-9.]/g, '');
            setText(v);
            resetTrade();
            setAmount(Number(v) || 0);
          }}
        />
        <span className={s.fieldUnit}>{unit}</span>
      </div>
      <div className={s.tiles} role="radiogroup" aria-label={w.amount}>
        {AMOUNT_TILES.map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={n === amount}
            className={`${s.tile} ${n === amount ? s.tileOn : ''}`}
            onClick={() => {
              resetTrade();
              setAmount(n);
            }}
          >
            ${n}
          </button>
        ))}
      </div>
    </>
  );
}

/** «To win» with its quiet «i»: what it pays if right, the profit beside it, and what one share pays, on a tap. */
function ToWin({ value, spend, label }: { value: number; spend: number; label: string }) {
  const [why, setWhy] = useState(false);
  const w = useWords(PREDICT);
  const profit = Math.round((value - spend) * 100) / 100;
  return (
    <div className={s.win}>
      <div className={s.winRow}>
        <span className={s.winWord}>{w.toWin}</span>
        <span className={s.winFigure}>{usd(value)}</span>
        {value > 0 && profit > 0 ? <span className={`${s.winProfit} ${s.up}`}>{signedUsd(profit)}</span> : null}
        <button className={s.info} aria-label={w.howItPays} aria-expanded={why} onClick={() => setWhy((v) => !v)}>
          <InfoGlyph />
        </button>
      </div>
      {why ? <div className={s.why}>{w.eachShare(sideName(label))}</div> : null}
    </div>
  );
}

function Action({ label, onPress, disabled, waiting }: { label: string; onPress: () => void; disabled?: boolean; waiting?: boolean }) {
  return (
    <button className={`${s.primary} ${s.action} ${waiting ? s.waiting : ''}`} onClick={onPress} disabled={disabled}>
      {label}
    </button>
  );
}

/** After a buy: the position is open, what it wins, and a way to it — until the ticket changes. */
function Bought({ label, spend, wins, pending }: { label: string; spend: number; wins: number; pending: boolean }) {
  const go = usePredict((st) => st.go);
  const w = useWords(PREDICT);
  const box = useRef<HTMLDivElement>(null);
  // Shown where the eye is: a ticket scrolled to its button brings the confirmation into view.
  useEffect(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    box.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, []);
  return (
    <div className={s.bought} data-pending={pending ? '' : undefined} role="status" ref={box}>
      <span className={s.boughtMark} aria-hidden="true">
        <CheckGlyph />
      </span>
      <span className={s.boughtText}>
        <b>{pending ? w.boughtPending(sideName(label)) : w.youreIn(sideName(label))}</b>
        <span>{w.spendWins(usd(spend), usd(wins))}</span>
      </span>
      <button className={s.boughtGo} onClick={() => go({ kind: 'positions' })}>
        {w.positions}
      </button>
    </div>
  );
}

/** Practice: the same ticket with practice dollars, taken at the page's price with one tap. */
function PracticeTicket() {
  const at = usePageMarket()!;
  const action = usePredict((st) => st.action);
  const side = usePredict((st) => st.side);
  const amount = usePredict((st) => st.amount);
  const book = usePredict((st) => st.book);
  const bought = usePredict((st) => st.bought);
  const practiceBuy = usePredict((st) => st.practiceBuy);
  const now = useNow(5_000);
  const w = useWords(PREDICT);
  const chosen = at.market.sides.find((x) => x.id === side) ?? null;
  const open = at.detail ? tradable(at.detail, now) : true;
  if (action === 'sell') return <PracticeSell />;
  const refusal = !open ? 'closed' : chosen ? buyRefusal(book, { market: at.market, sideId: chosen.id, spendUsd: amount, readAt: at.readAt }, now) : 'side';
  const v = practiceView({ action, sideLabel: chosen?.label ?? null, refusal, sellBack: null, held: false });
  const justBought = bought && bought.marketId === at.market.marketId && bought.outcomeId === side ? bought : null;
  const holding = justBought ? book.holdings.find((h) => h.state === 'open' && h.marketId === justBought.marketId && h.outcomeId === justBought.outcomeId) : null;
  return (
    <>
      {justBought ? <Bought label={justBought.label} spend={justBought.spendUsd} wins={holding ? Math.floor(holding.shares * 100 + 1e-7) / 100 : toWin(justBought.spendUsd, chosen?.p ?? 1)} pending={false} /> : null}
      <Amount coin={<PracticeCoin />} label={w.amount} unit={w.practiceUnit} />
      <div className={s.rule} />
      {chosen ? <ToWin value={toWin(amount, chosen.p)} spend={amount} label={chosen.label} /> : null}
      {v.note ? <div className={`${s.line} ${s.lineOver} ${v.warn ? s.lineWarn : ''}`}>{v.note}</div> : null}
      <Action label={v.label} onPress={() => practiceBuy()} disabled={v.disabled} />
    </>
  );
}

function PracticeSell() {
  const at = usePageMarket()!;
  const side = usePredict((st) => st.side);
  const book = usePredict((st) => st.book);
  const fraction = usePredict((st) => st.fraction);
  const setFraction = usePredict((st) => st.setFraction);
  const practiceSell = usePredict((st) => st.practiceSell);
  const detail = usePredict((st) => st.detail);
  const lists = usePredict((st) => st.lists);
  const w = useWords(PREDICT);
  const chosen = at.market.sides.find((x) => x.id === side) ?? null;
  const holding = book.holdings.find((h) => h.state === 'open' && h.marketId === at.market.marketId && h.outcomeId === side) ?? null;
  // A sale is priced by the page's own read only: never by a quote read for the positions list.
  const price = holding ? priceOf({ detail, lists }, holding.eventId, holding.marketId, holding.outcomeId) : null;
  const back = holding && price ? Math.round(holding.shares * fraction * price.p * 100) / 100 : null;
  const v = practiceView({ action: 'sell', sideLabel: chosen?.label ?? null, refusal: null, sellBack: back, held: Boolean(holding) });
  if (!holding || !chosen) {
    return (
      <>
        <div className={s.hold}>{chosen ? w.holdNone(sideName(chosen.label)) : w.holdNoShares}</div>
        <Action label={v.label} onPress={() => undefined} disabled />
      </>
    );
  }
  const pnl = back !== null ? Math.round((back - holding.cost * fraction) * 100) / 100 : null;
  return (
    <>
      <div className={s.hold}>
        {w.youHold} <b>{digits(holding.shares.toLocaleString('en-US', { maximumFractionDigits: 2 }))}</b> {sideName(holding.label)}
      </div>
      <SellTiles fraction={fraction} onFraction={setFraction} />
      <div className={s.rule} />
      <div className={s.win}>
        <div className={s.winRow}>
          <span className={s.winWord}>{w.youGet}</span>
          <span className={s.winFigure}>{back !== null ? usd(back) : '—'}</span>
          {pnl !== null && Math.abs(pnl) >= 0.005 ? <span className={`${s.winProfit} ${pnl > 0 ? s.up : s.down}`}>{signedUsd(pnl)}</span> : null}
        </div>
      </div>
      {v.note ? <div className={`${s.line} ${s.lineOver}`}>{v.note}</div> : null}
      <Action label={v.label} onPress={() => practiceSell(holding.id)} disabled={v.disabled} />
    </>
  );
}

function SellTiles({ fraction, onFraction }: { fraction: number; onFraction: (f: number) => void }) {
  const w = useWords(PREDICT);
  return (
    <div className={s.tiles} role="radiogroup" aria-label={w.howMuchToSell}>
      {SELL_TILES.map((f) => (
        <button key={f} role="radio" aria-checked={f === fraction} className={`${s.tile} ${f === fraction ? s.tileOn : ''}`} onClick={() => onFraction(f)}>
          {f === 1 ? w.max : `${f * 100}%`}
        </button>
      ))}
    </div>
  );
}

/** Real money: connect, sign in once, then the engine's Review — the fee in one line — and the order it confirms. */
function RealTicket() {
  const at = usePageMarket()!;
  const action = usePredict((st) => st.action);
  const side = usePredict((st) => st.side);
  const amount = usePredict((st) => st.amount);
  const fraction = usePredict((st) => st.fraction);
  const setFraction = usePredict((st) => st.setFraction);
  const go = usePredict((st) => st.go);
  const setMode = usePredict((st) => st.setMode);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => st.connecting);
  const live = useReal((st) => (connection && st.owner === connection.address ? st.live : null));
  const liveRead = useReal((st) => st.liveRead);
  const opening = useReal((st) => st.opening);
  const openError = useReal((st) => st.openError);
  const trade = useReal((st) => st.trade);
  const start = useReal((st) => st.start);
  const quote = useReal((st) => st.quote);
  const place = useReal((st) => st.place);
  const say = usePredict((st) => st.say);
  const [picking, setPicking] = useState(false);
  const now = useNow(5_000);
  const w = useWords(PREDICT);
  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);
  const chosen = at.market.sides.find((x) => x.id === side) ?? null;
  const open = at.detail ? tradable(at.detail, now) : true;
  const position = live?.positions.find((p) => p.sell && p.sell.marketId === at.market.marketId && p.sell.outcomeId === side) ?? null;
  // A side held across venues is shown, but the window does not sell it as one order.
  const spread = !position && chosen ? (live?.positions.find((p) => !p.sell && p.eventId === at.market.eventId && p.label === chosen.label) ?? null) : null;
  const key = `${at.market.eventId}:${at.market.marketId}:${side}:${action}:${action === 'buy' ? amount : fraction}`;
  const mine = 'key' in trade && trade.key === key ? trade : null;

  useEffect(() => {
    if (mine?.step === 'done') say(doneNotice(mine.state, mine.review));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.step]);

  const v = realView({
    action,
    sideLabel: chosen?.label ?? null,
    amount,
    tradable: open,
    connected: Boolean(connection),
    connecting: Boolean(connecting),
    walletName: connection?.wallet ?? null,
    opening: opening !== null,
    liveRead,
    live,
    openError,
    trade: mine,
    sellable: Boolean(position),
    spread: Boolean(spread),
    now,
  });

  function askOf() {
    const sell = action === 'sell' && position?.sell ? position.sell : null;
    return {
      eventId: at.market.eventId,
      marketId: sell?.marketId ?? at.market.marketId,
      outcomeId: sell?.outcomeId ?? side ?? '',
      side: action,
      // Max sells every share the engine counts; a part is rounded down to the hundredth of a share.
      ...(action === 'buy' ? { spendUsd: amount } : { sellShares: fraction >= 1 ? (position?.shares ?? 0) : Math.floor((position?.shares ?? 0) * fraction * 100) / 100 }),
    } as const;
  }

  const press = () => {
    switch (v.act) {
      case 'connect': {
        const { wallets, connect } = useWallet.getState();
        if (wallets.length === 1) void connect(wallets[0]!.name);
        else setPicking(true);
        return;
      }
      case 'start':
        return void start(connection as Connection);
      case 'deposit':
        return go({ kind: 'money', tab: 'deposit' });
      case 'quote':
        return void quote(connection as Connection, askOf(), key);
      case 'place':
        return void place({ title: at.market.question ? `${at.market.title} · ${at.market.question}` : at.market.title });
      default:
        return;
    }
  };

  if (!connection && picking) return <WalletPicker onBack={() => setPicking(false)} />;
  const shares = position?.shares ?? spread?.shares ?? null;
  const done = mine?.step === 'done' && mine.review.side === 'buy' ? mine : null;
  return (
    <>
      {done ? <Bought label={done.review.label} spend={done.review.totalUsd} wins={done.review.toWinUsd} pending={done.state === 'submitted'} /> : null}
      {action === 'buy' ? (
        <Amount coin={<UsdcCoin />} label={w.amountUsdc} unit="USDC" />
      ) : shares === null ? (
        <div className={s.hold}>{chosen?.label ? w.holdNone(sideName(chosen.label)) : w.holdNoShares}</div>
      ) : (
        <>
          <div className={s.hold}>
            {w.youHold} <b>{digits(shares.toLocaleString('en-US', { maximumFractionDigits: 2 }))}</b> {chosen ? sideName(chosen.label) : ''}
          </div>
          <SellTiles fraction={fraction} onFraction={setFraction} />
        </>
      )}
      <div className={s.rule} />
      {action === 'buy' && chosen ? <ToWin value={mine?.step === 'review' ? mine.review.toWinUsd : toWin(amount, chosen.p)} spend={mine?.step === 'review' ? mine.review.totalUsd : amount} label={chosen.label} /> : null}
      {/* The fee and what it pays, in one line right over the button that signs: read before the press, never after. */}
      {v.note ? <div className={`${s.line} ${s.lineOver} ${v.warn ? s.lineWarn : ''}`}>{v.note}</div> : null}
      <Action label={v.label} onPress={press} disabled={v.disabled} waiting={v.waiting} />
      {live && live.access.state === 'off' ? (
        <button className={s.quiet} onClick={() => setMode('practice')}>
          {w.tryPractice}
        </button>
      ) : null}
    </>
  );
}

export function WalletPicker({ onBack }: { onBack: () => void }) {
  const wallets = useWallet((st) => st.wallets);
  const connecting = useWallet((st) => st.connecting);
  const error = useWallet((st) => st.error);
  const connect = useWallet((st) => st.connect);
  const [phone, setPhone] = useState(false);
  const w = useWords(PREDICT);
  useEffect(() => setPhone(isPhoneUserAgent(navigator.userAgent)), []);
  if (!wallets.length) {
    const here = typeof window === 'undefined' ? '' : window.location.href;
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    return (
      <div className={s.wallets}>
        <a className={`${s.primary} ${s.action}`} href={phone ? phantomBrowseUrl(here, origin) : PHANTOM_DOWNLOAD_URL} target={phone ? undefined : '_blank'} rel="noreferrer">
          {phone ? w.openInPhantom : w.getPhantom}
        </a>
        <button className={s.quiet} onClick={onBack}>
          {w.back}
        </button>
      </div>
    );
  }
  return (
    <div className={s.wallets}>
      {wallets.map((wallet) => (
        <button key={wallet.name} className={s.walletButton} onClick={() => void connect(wallet.name)} disabled={Boolean(connecting)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {wallet.icon ? <img src={wallet.icon} alt="" /> : null}
          {connecting === wallet.name ? w.opening(wallet.name) : wallet.name}
        </button>
      ))}
      {error ? <div className={`${s.line} ${s.lineWarn}`}>{error}</div> : null}
      <button className={s.quiet} onClick={onBack}>
        {w.back}
      </button>
    </div>
  );
}

/** «Details»: what resolves the market, where the figures come from, the close — opened on a tap, closed on another. */
function Details() {
  const at = usePageMarket();
  const mode = usePredict((st) => st.mode);
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDListElement>(null);
  const now = useNow(30_000);
  const w = useWords(PREDICT);
  // Opened at the foot of a column that scrolls: brought into view, so the tap shows what it opened.
  useEffect(() => {
    if (!open) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    body.current?.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }, [open]);
  const rows = useMemo(() => {
    if (!at) return [];
    const d = at.detail;
    const out: [string, string][] = [];
    if (d?.settlement) out.push([w.resolves, d.settlement]);
    if (d?.rules) out.push([w.rules, d.rules]);
    else if (d?.description) out.push([w.rules, d.description]);
    out.push([w.closesIn, closesIn(at.market.closes, now)]);
    out.push([w.volume, volumeText(at.market.volume)]);
    out.push([w.venues, at.market.venues.length ? at.market.venues.join(', ') : 'AGG']);
    out.push([w.prices, isDelayed(at.readAt, now) ? `${clock(at.readAt)} · ${w.delayed}` : clock(at.readAt)]);
    out.push([w.money, mode === 'real' ? w.moneyReal : w.moneyPractice]);
    out.push([w.note, w.notAdvice]);
    return out;
  }, [at, mode, now, w]);
  return (
    <div className={s.details}>
      <button className={s.detailsToggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {w.details}
        <span className={s.chevron} data-open={open ? '' : undefined} aria-hidden="true" />
      </button>
      {open ? (
        <dl className={s.detailsBody} ref={body}>
          {rows.map(([k, v]) => (
            <div key={k} className={s.detailsRow}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
