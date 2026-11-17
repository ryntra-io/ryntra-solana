'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue, plainFigure } from '@/city/lib/i18n/figures';
import { cardTag, filledCard } from '@/city/lib/launch/cards';
import { coinLink } from '@/city/lib/share/coin-link';
import { formatUnits, ticker } from '@/city/lib/trade/format';
import { endsOf, positionOf, reachText, type LadderAction, type Market, type Order, type Problem, type Quote } from '@/city/lib/trade/pro-ladder';
import { LADDER_BUSY, LADDER_NETWORK, LADDER_OPEN, choiceOf, takeLadderAsk, useLadder, type OrderStep } from '@/city/lib/trade/pro-store';
import { keyShare, pointerShare } from '@/city/lib/trade/size';
import type { TowerRef } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { PRO_LIMITS_CHAINS } from '@/lib/pro-limits/gate';
import { useShareCard } from '../launch/useShareCard';
import l from './ladder.module.css';
import { LADDER } from './pro-words';
import s from './trade.module.css';

/**
 * «Buy cheaper», «sell higher» in the coin's window: one slider — how far from the price — one amount, one
 * button. The ladder under it is the engine's: up to 25 prices in the coin's Meteora DLMM Pro pool, each filled at
 * exactly its own price, with the maker's share of the pool's fee told as one number before the signature.
 *
 * Drawn only where the window's switch names a network and the coin has such a pool; anywhere else nothing of it is on
 * screen. It rests folded as one line under the ticket, and opens on a tap — or by itself when a sentence asked for a
 * ladder. How it works waits behind «i».
 */
export function LadderPanel({ tower }: { tower: TowerRef }) {
  if (!LADDER_OPEN) return null;
  return <OpenLadderPanel tower={tower} />;
}

const price = (value: number) => digits(plainFigure(value, { places: 6, significant: 4 }));
const pct = (bps: number) => digits(String(Math.round(bps) / 100));
/** The order's deposit, SOL, before a Review says it to the lamport: what the program keeps for an order and each of its prices. */
const depositSol = (prices: number) => digits(((6_157_000 + 935_000 * prices) / 1e9).toFixed(3));

function OpenLadderPanel({ tower }: { tower: TowerRef }) {
  const w = useWords(LADDER);
  const market = useLadder((st) => (st.mint === tower.mint ? st.market : null));
  const shown = useLadder((st) => st.shown);
  const connected = useWallet((st) => st.connection?.address ?? null);

  useEffect(() => {
    useLadder.getState().open({ mint: tower.mint, symbol: tower.symbol }, takeLadderAsk(tower.mint));
  }, [tower.mint, tower.symbol]);
  // The wallet's ladders follow the wallet: read again when one connects or changes.
  useEffect(() => {
    if (market?.value) void useLadder.getState().loadOrders();
  }, [connected, market?.value]);

  const value = market?.value ?? null;
  if (!value) return null;
  if (!shown) {
    return (
      <button className={l.line} onClick={() => useLadder.getState().show()}>
        <LadderGlyph />
        <span className={`${s.display} ${l.lineWord}`}>{w.openLine}</span>
        <span className={l.lineMore}>{w.openMore(pct(value.bonus.ownerBps))}</span>
      </button>
    );
  }
  return <Ladder market={value} symbol={ticker(tower.symbol)} />;
}

function Ladder({ market, symbol }: { market: Market; symbol: string }) {
  const w = useWords(LADDER);
  const state = useLadder();
  const holdings = useWallet((st) => st.holdings);
  const connection = useWallet((st) => st.connection);
  const [details, setDetails] = useState(false);
  const panel = useRef<HTMLElement>(null);
  // Unfolded — by a tap on its line, or by a sentence — the panel comes into view: what was asked for is what is seen.
  useEffect(() => {
    panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);
  const { action, farBps, phase } = state;
  const ends = endsOf(action, market);
  const choice = choiceOf(state, holdings);
  const busy = LADDER_BUSY.has(phase);
  const quote = state.quote.status === 'ready' && choice && state.quote.key === choice.key ? state.quote.value : null;
  const unit = action === 'buy' ? market.quote.symbol : symbol;
  const getUnit = action === 'buy' ? symbol : market.quote.symbol;
  const getDecimals = action === 'buy' ? market.coin.decimals : market.quote.decimals;
  const reach = farBps === null ? '' : digits(reachText(farBps, action));
  const problem = connection ? (choice?.problem ?? null) : 'connect';
  /* The engine would not build this ladder: the button says why instead of standing dead. */
  const refusedQuote = state.quote.status === 'failed' && choice !== null && state.quote.key === choice.key;

  if (phase === 'done' && state.placed) {
    const placed = state.placed.quote;
    return (
      <section className={l.panel} aria-label={w.openLine}>
        <div className={l.done} role="status">
          <span className={`${s.display} ${l.doneTitle}`}>{w.placed}</span>
          {placed && <span className={l.sub}>{w.placedMore(placed.rungs.length, digits(reachText(placed.farBps, placed.action)))}</span>}
          {/* Said only where the row below offers «Resume agent»: the accounts did not land and the agent would collect this order. */}
          {state.placed.agent && !state.placed.whole && state.orders.value?.some((order) => order.nftMint === state.placed?.nftMint && order.agent && !order.agentReady && order.agentOffered) && <span className={l.sub}>{w.agentNotYet}</span>}
        </div>
        <Orders market={market} symbol={symbol} />
        <button className={`${s.display} ${l.quiet}`} onClick={state.again}>
          {w.another}
        </button>
      </section>
    );
  }

  return (
    <section ref={panel} className={l.panel} aria-label={w.openLine}>
      <div className={s.sides} role="tablist" aria-label={w.side}>
        {(['buy', 'sell'] as const).map((id) => (
          <button key={id} role="tab" aria-selected={action === id} className={`${s.side} ${action === id ? s.sideOn : ''}`} onClick={() => state.setAction(id)} disabled={busy}>
            {id === 'buy' ? w.buyCheaper : w.sellHigher}
          </button>
        ))}
      </div>

      {ends && farBps !== null && (
        <>
          <div className={l.reach}>
            <span className={`${s.display} ${l.reachFigure}`}>{reach}</span>
            <span className={l.sub}>{quote ? headline(w, quote, market, action) : ' '}</span>
          </div>
          <ReachSlider position={positionOf(farBps, action, ends)} resting={busy} label={w.reach} valueText={w.reachValue(reach, action)} onMove={state.setReach} />
        </>
      )}

      <div className={`${s.row} ${s.rowWrap}`}>
        <span className={s.label}>{action === 'buy' ? w.youPay : w.youSell}</span>
      </div>
      <div className={s.size}>
        <label className={`${s.amount} ${problem === 'balance' || problem === 'cap' ? s.amountWrong : ''}`}>
          <input
            className={`${s.display} ${s.amountInput}`}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            placeholder="0"
            aria-label={w.amountIn(unit)}
            value={fieldText(state.typed)}
            onChange={(event) => state.setTyped(fieldValue(event.target.value))}
            disabled={busy}
          />
          <span className={`${s.display} ${s.amountUnit}`}>{unit}</span>
        </label>
        {choice?.max != null && (
          <div className={s.shares} role="group" aria-label={w.shareOfBalance}>
            {[25, 50, 75, 100].map((share) => (
              <button key={share} className={s.share} onClick={() => state.setShare(share)} disabled={busy || choice.max === 0n}>
                {share === 100 ? w.max : digits(`${share}%`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {quote && (
        <div className={l.get}>
          <span className={s.label}>{w.youGet}</span>
          <span className={`${s.display} ${l.getFigure}`}>
            {w.about} {digits(formatUnits(quote.paysRaw, getDecimals, 'down'))} {getUnit}
          </span>
          <span className={l.sub}>{w.filledWhole}</span>
        </div>
      )}

      {market.collector && (
        <label className={l.agent}>
          <input type="checkbox" checked={state.agent} onChange={(event) => state.setAgent(event.target.checked)} disabled={busy} />
          <span>{w.agent}</span>
        </label>
      )}

      <div className={s.terms}>
        <span className={s.termsText}>
          <b>{w.bonus(pct((quote ?? market).bonus.ownerBps))}</b>
          {(quote ?? market).bonus.referralBps > 0 && <> · {w.ryntraPart}</>}
          {quote && <> · {w.deposit(depositSol(quote.rungs.length))}</>}
        </span>
        <button className={`${s.info} ${details ? s.infoOn : ''}`} aria-label={w.details} aria-expanded={details} onClick={() => setDetails(!details)}>
          i
        </button>
      </div>
      {details && <Details market={market} quote={quote} agent={Boolean(choice?.agent)} symbol={symbol} />}

      {state.failure && phase === 'failed' && (
        <p className={`${s.notice} ${s.noticeError}`} role="alert">
          {failureWords(w, state.failure)}
        </p>
      )}

      <button className={`${s.display} ${s.action} ${busy ? s.waiting : ''}`} onClick={() => void state.place()} disabled={busy || problem !== null || !quote}>
        {busy ? (phase === 'wallet' ? w.wallet : phase === 'sending' ? w.sending : w.reviewing) : problem ? problemWords(w, problem, market) : refusedQuote ? quoteWords(w, state.quote.code) : w.place}
      </button>

      <Orders market={market} symbol={symbol} />
    </section>
  );
}

type W = (typeof LADDER)['en'];

/** Under the big figure: how many prices, and where the farthest one stands. */
function headline(w: W, quote: Quote, market: Market, action: LadderAction): string {
  const far = quote.rungs[quote.rungs.length - 1]!;
  const where = quote.rungs.length === 1 ? w.at(price(far.price), market.quote.symbol) : action === 'buy' ? w.downTo(price(far.price), market.quote.symbol) : w.upTo(price(far.price), market.quote.symbol);
  return `${w.prices(quote.rungs.length)} · ${where}`;
}

function problemWords(w: W, problem: Problem, market: Market): string {
  switch (problem) {
    case 'connect':
      return w.connect;
    case 'amount':
      return w.enterAmount;
    case 'balance':
      return w.notEnough;
    case 'sol':
      return w.keepSol;
    case 'cap':
      return w.capped(digits(formatUnits(market.cap.maxRaw ?? '0', market.quote.decimals, 'down')), market.quote.symbol);
    case 'small':
      return w.tooSmall;
    case 'paused':
      return w.paused;
  }
}

/** Why the engine would not quote the ladder: a ladder it cannot build as asked, or the network not answering. */
function quoteWords(w: W, code: string | null): string {
  return code === 'VALIDATION_ERROR' || code === 'PRO_LIMIT_REFUSED' ? w.cantBuild : w.failed;
}

/** A refusal in the window's own words: what happened to the money first — nothing moved. */
function failureWords(w: W, code: string): string {
  switch (code) {
    case 'WALLET_DECLINED':
      return w.notSigned;
    case 'PRO_LIMIT_SUBMIT_FAILED':
      return w.moved;
    case 'PRO_LIMIT_REVIEW_EXPIRED':
    case 'TIMEOUT':
      return w.tooLong;
    case 'PRO_LIMIT_BALANCE_LOW':
      return w.lowBalance;
    case 'UNKNOWN':
      return w.unknown;
    default:
      return w.failed;
  }
}

function Details({ market, quote, agent, symbol }: { market: Market; quote: Quote | null; agent: boolean; symbol: string }) {
  const w = useWords(LADDER);
  const bonus = (quote ?? market).bonus;
  const first = quote?.rungs[0];
  const last = quote?.rungs[quote.rungs.length - 1];
  const feeUnit = quote ? (quote.bonus.feeIn === market.quote.mint ? market.quote.symbol : symbol) : market.quote.symbol;
  return (
    <dl className={s.details}>
      {quote && first && last && (
        <>
          <dt>{w.dPrices}</dt>
          <dd>{quote.rungs.length === 1 ? `${price(first.price)} ${market.quote.symbol}` : w.dFromTo(price(first.price), price(last.price), market.quote.symbol)}</dd>
          <dt>{w.dAverage}</dt>
          <dd>
            {price(quote.averagePrice)} {market.quote.symbol}
          </dd>
        </>
      )}
      <dt>{w.dExact}</dt>
      <dd>{w.dExactValue}</dd>
      {quote?.corridorBps != null && (
        <>
          <dt>{w.dCorridor}</dt>
          <dd>{w.dCorridorValue(pct(quote.corridorBps))}</dd>
        </>
      )}
      <dt>{w.dBonus}</dt>
      <dd>{w.dBonusValue(pct(bonus.ownerBps), feeUnit)}</dd>
      {bonus.referralBps > 0 && (
        <>
          <dt>{w.dRyntra}</dt>
          <dd>{w.dRyntraValue(pct(bonus.referralBps))}</dd>
        </>
      )}
      {quote && (
        <>
          <dt>{w.dDeposit}</dt>
          <dd>{w.dDepositValue(depositSol(quote.rungs.length))}</dd>
        </>
      )}
      {agent && (
        <>
          <dt>{w.dAgent}</dt>
          <dd>{w.dAgentValue}</dd>
          {market.quote.symbol === 'SOL' && (
            <>
              <dt>{w.dWrapped}</dt>
              <dd>{w.dWrappedValue}</dd>
            </>
          )}
        </>
      )}
    </dl>
  );
}

/** The reach as a slider: the ticket's own track and thumb. Dragged, tapped or moved by the keyboard. */
function ReachSlider({ position, resting, label, valueText, onMove }: { position: number; resting: boolean; label: string; valueText: string; onMove: (position: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const at = (event: ReactPointerEvent<HTMLElement>) => {
    const box = track.current?.getBoundingClientRect();
    return box ? pointerShare(event.clientX, box.left, box.width) : position;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (resting || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    onMove(at(event));
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resting && event.currentTarget.hasPointerCapture(event.pointerId)) onMove(at(event));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = resting ? null : keyShare(position, event.key);
    if (next === null) return;
    event.preventDefault();
    onMove(next);
  };
  return (
    <div className={l.accent}>
      <div
        className={`${s.slider} ${resting ? s.sliderResting : ''}`}
        role="slider"
        tabIndex={resting ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(position)}
        aria-valuetext={valueText}
        aria-disabled={resting}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <div ref={track} className={s.track}>
          <span className={s.fill} style={{ width: `${position}%` }} />
          <span className={s.thumb} style={{ left: `${position}%` }} />
        </div>
      </div>
    </div>
  );
}

/** The wallet's ladders of this coin: what each does, how far along it is, and the one thing to do with it. */
function Orders({ market, symbol }: { market: Market; symbol: string }) {
  const w = useWords(LADDER);
  const orders = useLadder((st) => st.orders.value);
  const acting = useLadder((st) => st.acting);
  const phase = useLadder((st) => st.phase);
  const act = useLadder((st) => st.act);
  const sharing = useShareCard();
  if (!orders || orders.length === 0) return null;
  const held = LADDER_BUSY.has(phase) || (acting !== null && LADDER_BUSY.has(acting.phase));
  return (
    <div className={l.orders}>
      <span className={s.label}>{w.myLadders}</span>
      {orders.map((order) => {
        const mine = acting?.nftMint === order.nftMint ? acting : null;
        const working = mine !== null && LADDER_BUSY.has(mine.phase);
        const card = filledCard({ coin: { token: market.coin.mint, symbol, logo: false }, pairSymbol: market.quote.symbol, order, tag: cardTag(LADDER_NETWORK ? (PRO_LIMITS_CHAINS[LADDER_NETWORK] as 'solana:devnet' | 'solana:mainnet') : null, false) });
        const button = (step: OrderStep, text: string, strong = false) => (
          <button className={`${s.display} ${strong ? l.take : l.quiet}`} onClick={() => void act(order, step)} disabled={held}>
            {working && mine.step === step ? (mine.phase === 'wallet' ? w.wallet : mine.phase === 'sending' ? w.sending : w.reviewing) : text}
          </button>
        );
        return (
          <div key={order.nftMint} className={l.order}>
            <div className={l.orderHead}>
              <span className={`${s.display} ${l.orderWord}`}>{order.action === 'buy' ? w.buying : order.action === 'sell' ? w.selling : w.emptied}</span>
              <span className={l.sub}>
                {order.state === 'taken' ? '' : order.filledPrices > 0 ? w.progress(order.filledPrices, order.prices) : w.resting(order.prices)}
                {order.agent && order.state !== 'taken' ? ` · ${order.agentReady ? w.agentCollects : w.agentPaused}` : ''}
              </span>
            </div>
            {order.filledPrices > 0 && order.filledPrice !== null && (
              <div className={l.filled}>
                <span className={`${s.display} ${l.filledTitle}`}>{w.filledTitle}</span>
                <span className={l.filledPrice}>{w.at(price(order.filledPrice), market.quote.symbol)}</span>
              </div>
            )}
            <div className={l.orderActions}>
              {order.state === 'taken' ? button('close', w.depositBack, true) : order.filledPrices > 0 ? button('collect', w.take, true) : null}
              {order.state !== 'taken' && button('close', w.cancel)}
              {/* Let in, it can always be stopped; paused — its accounts gone — it can be resumed; never offered on an order it would not collect. */}
              {market.collector && order.state !== 'taken' && order.agent && !order.agentReady && order.agentOffered && button('agent-on', w.agentResume)}
              {market.collector && order.state !== 'taken' && order.agent && button('agent-off', w.agentOff)}
              {market.collector && order.state !== 'taken' && !order.agent && order.agentOffered && button('agent-on', w.agentOn)}
              {card && (
                <button className={`${s.display} ${l.quiet}`} onClick={() => void sharing.share(`filled-${order.nftMint}`, card, coinLink(market.coin.mint))} disabled={sharing.making !== null}>
                  {sharing.label}
                </button>
              )}
            </div>
            {mine?.phase === 'failed' && mine.failure && (
              <p className={`${s.notice} ${s.noticeError}`} role="alert">
                {mine.failure === 'PRO_LIMIT_SUBMIT_FAILED' ? w.notDone : failureWords(w, mine.failure)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LadderGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M4 19h5M9 14h5M14 9h6M4 19v-1M9 14v5M14 9v5M20 9V5" />
    </svg>
  );
}
