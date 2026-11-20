'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { digits, useWords } from '@/city/lib/i18n/dict';
import { fieldText, fieldValue, plainFigure } from '@/city/lib/i18n/figures';
import { useLang } from '@/city/lib/i18n/lang';
import type { Lang } from '@/city/lib/i18n/langs';
import { formatUnits } from '@/city/lib/trade/format';
import { SLIDER_START_BPS, endsOf, positionOf, type Market, type Problem, type Quote } from '@/city/lib/trade/pro-ladder';
import { LADDER_BUSY, LADDER_MAX_RUNGS, choiceOf, useLadder } from '@/city/lib/trade/pro-store';
import type { TowerRef } from '@/city/lib/trade/store';
import { useWallet } from '@/city/lib/trade/wallet';
import { Action, AmountField, Figure, Kick, Quiet, Segment, Slider, SwitchRow, Tabs, cx, priceText } from '@/terminal/ui';
import { placedFigure, placesFor } from '@/terminal/ui/figures';
import { setLayer } from '../chart-layer';
import { ExplainBox, ExplainButton, LONG_LABEL, Rows, bare, connectOrPick } from '../parts';
import { coinLogo, payLogo } from '../staples';
import { WalletPick } from '../WalletPick';
import { LADDER_MIN_RUNGS, LADDER_START_RUNGS, TICKET_START_BPS, bpsOfPercent, depositSol, farPrice, ladderLines, percentField, priceAt, shapeOf, signedPercent, type Shape } from './ladder-view';
import { LIMIT } from './words';
import s from '../ticket.module.css';
import l from './ladder.module.css';

type W = (typeof LIMIT)['en'];

/**
 * A figure of a price as the chart's scale writes it: four significant figures, a run of four zeros or more after the
 * point folded into a small figure — 0.0₆1381, never 0.0000001381 across the ticket.
 */
function priceFigure(value: number): string {
  if (!(value > 0 && value < 0.01)) return plainFigure(value, { places: 4, significant: 4 });
  // No zeros at the end: «0.0035», never «0.003500».
  return placedFigure(value, placesFor(value, 4)).replace(/0+$/, '').replace(/\.$/, '');
}

/** A price in the quote coin as the person reads it: dollars for USDC, the coin's own figure for SOL. */
export function quotePrice(value: number, unit: string, lang: Lang): string {
  if (unit === 'USDC') return value > 0 && value < 0.01 ? digits(`$${priceFigure(value)}`, lang) : priceText(value, lang);
  return `${digits(priceFigure(value), lang)} ${unit}`;
}

// A fraction of a basis point is said, never rounded to «+0%» (JitoSOL's bonus is 0.004 %, as the pool's head says).
const pct = (bps: number, lang: Lang) => digits(String(Number((bps / 100).toFixed(bps < 10 ? 3 : 2))), lang);
/** A pool whose fee is this low is a pair that moves little (a staked SOL against SOL): its ladder starts at the slider's nearest. */
const CALM_FEE_BPS = 10;

/**
 * The ticket's Limit tab: buy cheaper or sell higher in the coin's Meteora DLMM Pro pool, at one price or on a ladder of
 * up to 25. One distance from the price — a slider and a per cent — one amount, how many prices; then the engine's
 * ladder in four tiles and as lines over the chart, the agent's switch, Ryntra's part in one line, and the one amber
 * press: the engine's Review, the wallet's one approval, the relay. Everything is the city's ladder logic as it is
 * (`city/lib/trade/pro-store.ts`); how it works waits behind «i».
 */
export function LadderTicket({ coin, market, usd, onOrders }: { coin: TowerRef; market: Market; usd: number | null; onOrders?: () => void }) {
  const phase = useLadder((st) => st.phase);
  const placed = useLadder((st) => st.placed);
  if (phase === 'done' && placed) return <Placed coin={coin} onOrders={onOrders} />;
  return <Fields coin={coin} market={market} usd={usd} />;
}

function Fields({ coin, market, usd }: { coin: TowerRef; market: Market; usd: number | null }) {
  const w = useWords(LIMIT);
  const lang = useLang();
  const state = useLadder();
  const holdings = useWallet((st) => st.holdings);
  const connection = useWallet((st) => st.connection);
  const connecting = useWallet((st) => Boolean(st.connecting));
  const [picking, setPicking] = useState(false);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const { action, farBps, phase, rungs } = state;
  const busy = LADDER_BUSY.has(phase);
  // An order's own action asking the wallet: the ticket waits, so the wallet is asked once at a time.
  const acting = useLadder((st) => st.acting !== null && LADDER_BUSY.has(st.acting.phase));
  const ends = endsOf(action, market);
  const choice = choiceOf(state, holdings);
  const quote: Quote | null = state.quote.status === 'ready' && choice && state.quote.key === choice.key ? state.quote.value : null;
  const quoteFailed = state.quote.status === 'failed' && choice !== null && state.quote.key === choice.key;
  const shape: Shape = shapeOf(rungs);
  const sym = bare(coin.symbol);
  const unit = action === 'buy' ? market.quote.symbol : sym;
  const getUnit = action === 'buy' ? sym : market.quote.symbol;
  const getDecimals = action === 'buy' ? market.coin.decimals : market.quote.decimals;

  // A ladder starts with the approved design's count; a moved side or a new coin brings it back.
  const lastLadder = useRef(LADDER_START_RUNGS);
  useEffect(() => {
    if (rungs === null && !busy) useLadder.getState().setRungs(lastLadder.current);
    else if (rungs !== null && rungs > 1) lastLadder.current = rungs;
  }, [rungs, busy]);
  // The distance starts where the ladder stays on the chart, once a coin and a side — unless a sentence said its own.
  const started = useRef<string | null>(null);
  useEffect(() => {
    const key = `${coin.mint}:${action}`;
    if (started.current === key || !ends || farBps === null || busy) return;
    started.current = key;
    const calm = market.bonus.feeBps <= CALM_FEE_BPS;
    if (!state.shown && farBps === SLIDER_START_BPS[action]) state.setReach(positionOf(calm ? ends.min : TICKET_START_BPS[action], action, ends), true);
  }, [coin.mint, action, ends, farBps, busy, state, market.bonus.feeBps]);
  // The count is this tab's own: left, the store fits as many as it can again, as the city's view of the coin asks.
  // Never over a placed order: «Placed» stands in place of these fields and keeps its phase.
  useEffect(
    () => () => {
      if (useLadder.getState().phase !== 'done') useLadder.getState().setRungs(null);
    },
    [],
  );
  // A wallet that connects closes the list of wallets.
  useEffect(() => {
    if (connection) setPicking(false);
  }, [connection]);

  // The ladder over the chart: the engine's prices as they are quoted, in the chart's dollars at that moment — drawn once
  // a quote, so the lines stand where the quote's prices are, not a tick away, and the chart is not redrawn every tick.
  const tag = useMemo(() => (value: number) => (value > 0 && value < 0.01 ? digits(priceFigure(value), lang) : priceText(value, lang).replace(/^\$/, '')), [lang]);
  const usdNow = useRef(usd);
  useEffect(() => {
    usdNow.current = usd;
  }, [usd]);
  const priced = usd !== null;
  useEffect(() => {
    const lines = quote && priced ? ladderLines(quote, usdNow.current, tag) : [];
    const badge = quote ? (quote.rungs.length === 1 ? w.badgeOne : w.badgeLadder(quote.rungs.length)) : null;
    setLayer(coin.mint, 'ladder', lines.length ? { lines, badge } : null);
  }, [quote, priced, tag, coin.mint, w]);
  useEffect(() => () => setLayer(coin.mint, 'ladder', null), [coin.mint]);

  const far = quote ? farPrice(quote) : farBps !== null ? priceAt(market, farBps, action) : null;
  const count = quote?.rungs.length ?? rungs ?? LADDER_START_RUNGS;
  // The pool fits fewer prices than asked at this distance: one more would change nothing.
  const full = quote !== null && rungs !== null && quote.rungs.length < rungs;
  const balance = choice?.max != null ? digits(formatUnits(choice.max.toString(), choice.decimals, 'down'), lang) : null;
  const problem: Problem | null = connection ? (choice?.problem ?? null) : 'connect';
  const bonus = (quote ?? market).bonus;
  const deposit = digits(depositSol(count).toFixed(3), lang);

  const labels = {
    place: shape === 'one' ? w.placeOne : w.placeLadder,
    wallet: connection?.wallet ? w.confirmIn(connection.wallet) : w.confirm,
  };
  const label = busy
    ? phase === 'wallet'
      ? labels.wallet
      : phase === 'sending'
        ? w.sending
        : w.preparing
    : !connection
      ? connecting
        ? w.connecting
        : w.connect
      : problem
        ? problemWords(w, problem, market, lang, unit)
        : quoteFailed
          ? quoteWords(w, state.quote.code)
          : labels.place;
  const live = !busy && !acting && (!connection ? !connecting : !problem && Boolean(quote));
  const tap = () => {
    if (!connection) return connectOrPick(() => setPicking(true));
    void state.place();
  };

  return (
    <>
      <fieldset className={s.group} disabled={busy}>
        <Segment
          label={w.side}
          value={action}
          onChange={(next) => state.setAction(next)}
          items={[
            { id: 'buy', label: w.buyCheaper, tone: 'buy' },
            { id: 'sell', label: w.sellHigher, tone: 'sell' },
          ]}
        />
      </fieldset>
      <fieldset className={s.group} disabled={busy}>
        <Tabs fill label={w.shape} value={shape} onChange={(next) => state.setRungs(next === 'one' ? 1 : lastLadder.current)} items={[{ id: 'one', label: w.one }, { id: 'ladder', label: w.ladder }]} />
      </fieldset>
      <fieldset className={s.group} disabled={busy}>
        <AmountField
          label={action === 'buy' ? w.youPay : w.youSell}
          aside={balance ? w.balance(balance) : undefined}
          value={fieldText(state.typed)}
          onChange={(text) => state.setTyped(fieldValue(text))}
          asset={{ symbol: unit, icon: action === 'buy' ? payLogo({ mint: market.quote.mint, icon: null }) : coinLogo(coin) }}
        />
      </fieldset>
      {ends && farBps !== null ? (
        <fieldset className={cx(s.group, l.reach)} disabled={busy}>
          <div className={l.reachHead}>
            <Kick>{shape === 'one' ? w.atPrice : w.toPrice}</Kick>
            <span className={l.reachValue}>
              <Percent bps={farBps} action={action} label={w.percent} onBps={(bps) => state.setReach(positionOf(bps, action, ends), true)} />
              {far !== null ? <span className={l.reachPrice}>{quotePrice(far, market.quote.symbol, lang)}</span> : null}
            </span>
          </div>
          <Slider
            value={Math.round(positionOf(farBps, action, ends))}
            onChange={(position) => state.setReach(position, true)}
            label={w.reach}
            valueText={w.reachValue(digits(signedPercent(farBps, action), lang), far !== null ? quotePrice(far, market.quote.symbol, lang) : '')}
          />
        </fieldset>
      ) : null}
      <div className={l.tiles}>
        <div className={l.tile}>
          {/* Where the pool fits no more prices at this distance, the count's name says so — «+» rests for a reason seen. */}
          <Kick>{shape === 'ladder' && full ? w.pricesFull : w.prices}</Kick>
          <span className={l.count}>
            <Figure value={digits(String(count), lang)} size="m" />
            {shape === 'ladder' ? (
              <span className={l.steps}>
                <button type="button" className={l.step} aria-label={w.fewer} disabled={busy || count <= LADDER_MIN_RUNGS} onClick={() => state.setRungs(Math.max(LADDER_MIN_RUNGS, count - 1))}>
                  −
                </button>
                <button
                  type="button"
                  className={l.step}
                  aria-label={w.more}
                  // The pool fits fewer prices than asked where the distance is short: more would change nothing — said on the control.
                  disabled={busy || count >= LADDER_MAX_RUNGS || full}
                  title={full ? w.moreFull : undefined}
                  onClick={() => state.setRungs(Math.min(LADDER_MAX_RUNGS, count + 1))}
                >
                  +
                </button>
              </span>
            ) : null}
          </span>
        </div>
        <div className={l.tile}>
          {/* The coin it is priced in stands in the tile's name, so the figure is whole in a quarter of a laptop's ticket
              («0,00352…» was cut on 1440). */}
          <Kick>{market.quote.symbol !== 'USDC' ? w.averageIn(market.quote.symbol) : w.average}</Kick>
          {quote && market.quote.symbol !== 'USDC' ? (
            <Figure value={digits(priceFigure(quote.averagePrice), lang)} size="m" />
          ) : (
            <Figure value={quote ? quotePrice(quote.averagePrice, market.quote.symbol, lang) : '—'} size="m" />
          )}
        </div>
        <div className={l.tile}>
          <Kick>{w.youGet(getUnit)}</Kick>
          <Figure value={quote ? digits(formatUnits(quote.paysRaw, getDecimals, 'down'), lang) : '—'} size="m" />
        </div>
        <div className={l.tile}>
          <Kick>{w.bonus}</Kick>
          <Figure value={`+${pct(bonus.ownerBps, lang)}%`} size="m" tone="up" />
        </div>
      </div>
      {market.collector ? (
        <fieldset className={s.group} disabled={busy}>
          <SwitchRow label={w.agent} on={state.agent} onChange={(on) => state.setAgent(on)} />
        </fieldset>
      ) : null}
      <div className={s.termsLine}>
        <span>{bonus.referralBps > 0 ? w.fee(pct(bonus.referralBps, lang), deposit) : w.noFee(deposit)}</span>
        <ExplainButton label={w.details} open={details} controls={detailsId} onToggle={() => setDetails((was) => !was)} />
      </div>
      {details ? (
        <ExplainBox id={detailsId}>
          <Details market={market} quote={quote} agent={Boolean(choice?.agent)} deposit={deposit} />
        </ExplainBox>
      ) : null}
      {phase === 'failed' && state.failure ? (
        <p className={s.note} data-tone="error" role="alert">
          {failureWords(w, state.failure)}
        </p>
      ) : quoteFailed && !problem && state.quote.code !== 'VALIDATION_ERROR' && state.quote.code !== 'PRO_LIMIT_REFUSED' ? (
        <p className={s.termsLine}>
          <span>{w.noPrice}</span>
          <Quiet size="s" onClick={() => state.setTyped(state.typed)}>
            {w.tryAgain}
          </Quiet>
        </p>
      ) : null}
      {picking && !connection ? (
        <WalletPick onBack={() => setPicking(false)} />
      ) : (
        <Action className={s.go} data-long={label.length > LONG_LABEL || undefined} onClick={tap} disabled={!live} busy={busy || connecting}>
          {label}
        </Action>
      )}
    </>
  );
}

/** The distance as a per cent the person may type: what the slider says, written into the same reach. */
function Percent({ bps, action, label, onBps }: { bps: number; action: 'buy' | 'sell'; label: string; onBps: (bps: number) => void }) {
  const lang = useLang();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? digits(percentField(bps), lang);
  return (
    <span className={l.percent} data-side={action}>
      <span aria-hidden="true">{action === 'buy' ? '−' : '+'}</span>
      <input
        className={l.percentInput}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        value={shown}
        style={{ width: `${Math.max(1, shown.length) + 0.4}ch` }}
        onFocus={(event) => {
          setDraft(event.target.value);
          event.target.select();
        }}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d.,]/g, ''))}
        // Taken on Enter or when the field is left: the reach snaps to the slider's step, and the field then shows what is used.
        onBlur={(event) => {
          const next = bpsOfPercent(event.target.value);
          if (next !== null) onBps(next);
          setDraft(null);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      <span aria-hidden="true">%</span>
    </span>
  );
}

/** Behind «i»: the prices, each filled exactly, the corridor, the bonus and Ryntra's part, the deposit, the most one order holds. */
function Details({ market, quote, agent, deposit }: { market: Market; quote: Quote | null; agent: boolean; deposit: string }) {
  const w = useWords(LIMIT);
  const lang = useLang();
  const bonus = (quote ?? market).bonus;
  const first = quote?.rungs[0];
  const last = quote?.rungs[quote.rungs.length - 1];
  const unit = market.quote.symbol;
  const rows: [string, string][] = [];
  if (first && last) rows.push([w.dPrices, quote!.rungs.length === 1 ? quotePrice(first.price, unit, lang) : w.dFromTo(quotePrice(first.price, unit, lang), quotePrice(last.price, unit, lang))]);
  rows.push([w.dExact, w.dExactValue]);
  if (quote?.corridorBps != null) rows.push([w.dCorridor, w.dCorridorValue(pct(quote.corridorBps, lang))]);
  rows.push([w.dBonus, w.dBonusValue(pct(bonus.ownerBps, lang))]);
  if (bonus.referralBps > 0) rows.push([w.dRyntra, w.dRyntraValue(pct(bonus.referralBps, lang))]);
  rows.push([w.dDeposit, w.dDepositValue(deposit)]);
  if (market.cap.maxRaw !== null) rows.push([w.dCap, w.dCapValue(digits(formatUnits(market.cap.maxRaw, market.quote.decimals, 'down'), lang), unit)]);
  if (agent) rows.push([w.dAgent, w.dAgentValue]);
  return <Rows rows={rows} />;
}

/** The order is on the pool: how many prices and how far, and the way to the next one or to the orders. */
function Placed({ coin, onOrders }: { coin: TowerRef; onOrders?: () => void }) {
  const w = useWords(LIMIT);
  const lang = useLang();
  const placed = useLadder((st) => st.placed);
  const orders = useLadder((st) => st.orders.value);
  const again = useLadder((st) => st.again);
  if (!placed) return null;
  const told = placed.quote;
  const one = told?.rungs.length === 1;
  // Said only where the agent would collect this order but the person's accounts did not land with it.
  const agentWaits = placed.agent && !placed.whole && Boolean(orders?.some((order) => order.nftMint === placed.nftMint && order.agent && !order.agentReady && order.agentOffered));
  return (
    <>
      <div className={s.result} role="status">
        <Kick className={s.kickUp}>{one ? w.placedOne : w.placedLadder}</Kick>
        {told ? <Figure value={w.placedMore(told.rungs.length, digits(signedPercent(told.farBps, told.action), lang))} size="m" /> : <Figure value={bare(coin.symbol)} size="m" />}
        {agentWaits ? <span className={s.line}>{w.agentNotYet}</span> : null}
      </div>
      {onOrders ? (
        <Quiet full onClick={onOrders}>
          {w.myOrders}
        </Quiet>
      ) : null}
      <Action onClick={again}>{w.another}</Action>
    </>
  );
}

/** Why the ladder cannot be placed as it stands, on the button itself. */
export function problemWords(w: W, problem: Problem, market: Market, lang: Lang, spend: string): string {
  switch (problem) {
    case 'connect':
      return w.connect;
    case 'amount':
      return w.enterAmount;
    case 'balance':
      return w.notEnough(spend);
    case 'sol':
      return w.keepSol;
    case 'cap':
      return w.capped(digits(formatUnits(market.cap.maxRaw ?? '0', market.quote.decimals, 'down'), lang), market.quote.symbol);
    case 'small':
      return w.tooSmall;
    case 'paused':
      return w.paused;
  }
}

/** Why the engine would not quote: a ladder it cannot build as asked, or no answer now. */
function quoteWords(w: W, code: string | null): string {
  return code === 'VALIDATION_ERROR' || code === 'PRO_LIMIT_REFUSED' ? w.cantBuild : w.noPrice;
}

/** A refusal in plain words, what happened to the money first: nothing moved. */
export function failureWords(w: W, code: string): string {
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
