'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PositionView } from '@/lib/liquidity/catalog/positions';
import { explorerTxUrl } from '@/lib/solana/explorer';
import { reviewFigures } from '@/city/lib/districts/harbor/review';
import { openTradeCard } from '@/city/lib/coin/open';
import { RISK } from '@/city/lib/earn/flag';
import { useEarn } from '@/city/lib/earn/open';
import { solShort } from '@/city/lib/earn/pier';
import { useEarnData } from '@/city/lib/earn/store';
import { QUOTE, STOCK_PIER_BASE_FEE_BPS, STOCK_PIER_SLIPPAGE_BPS, STOCK_QUOTES, rawPrice, shownPrice, usdShort, type StockPair, type StockQuote } from '@/city/lib/earn/stock-pier';
import { STOCK_PIER_MODE } from '@/city/lib/earn/stock-pier-gate';
import { CLOSE_PLANS, DEFAULT_PLAN, dividendGuard, hoursOf, planDue, untilText, whenText, type ClosePlan, type Guard } from '@/city/lib/earn/stock-pier-hours';
import { STOCK_BUSY, STOCK_LOCKED, stockChoice, useStockPier, type StockNotice } from '@/city/lib/earn/stock-pier-store';
import type { Words } from '@/city/lib/earn/words';
import { digits } from '@/city/lib/i18n/dict';
import { useLang } from '@/city/lib/i18n/lang';
import { amountText } from '@/city/lib/trade/size';
import { useWallet } from '@/city/lib/trade/wallet';
import { Boat } from './Boat';
import { BackGlyph, Coin, Line, Notify, RiskDots, Wallets } from './bits';
import s from './earn.module.css';

/** With a wallet the Stock Pier admits, the exact Review follows the card after this pause, once per choice. */
const AUTO_REVIEW_MS = 450;
/** The clock the hours and the dividend guard are read on, while the card is open. */
const TICK_MS = 30_000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const pct = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
const quoteText = (units: bigint, quote: StockQuote) => `${digits(solShort(Number(units) / 10 ** QUOTE[quote].decimals))} ${QUOTE[quote].symbol}`;

/**
 * The Stock Pier (CITY-98): the person picks a verified stock and SOL or USDC, types what they put in, chooses what
 * happens at the exchange's close, and builds the pair's pier with the first liquidity in one signature — or moors
 * beside it where it stands. Their boats in stock piers ride at the top. One line before the signature; the rest
 * behind its «i».
 */
export function StockPier({ words }: { words: Words }) {
  const w = words.stock;
  const lang = useLang();
  const locale = lang === 'uk' ? 'uk-UA' : 'en-US';
  const now = useNow();
  const list = useStockPier((st) => st.list);
  const mint = useStockPier((st) => st.mint);
  const quote = useStockPier((st) => st.quote);
  const typed = useStockPier((st) => st.typed);
  const plan = useStockPier((st) => st.plan);
  const phase = useStockPier((st) => st.phase);
  const reviewed = useStockPier((st) => st.reviewed);
  const costs = useStockPier((st) => st.costs);
  const notice = useStockPier((st) => st.notice);
  const outcome = useStockPier((st) => st.outcome);
  const boat = useStockPier((st) => st.boat);
  const statesFor = useStockPier((st) => st.states);
  const plansFor = useStockPier((st) => st.plans);
  const positions = useEarnData((st) => st.positions);
  const connection = useWallet((st) => st.connection);
  const holdingsFor = useWallet((st) => st.holdings);
  const owner = connection?.address ?? null;
  const holdings = holdingsFor && holdingsFor.owner === owner ? holdingsFor : null;
  const states = owner && statesFor?.owner === owner ? statesFor.value : null;
  const admitted = states?.build === 'on';

  useEffect(() => void useStockPier.getState().load(), []);
  useEffect(() => {
    useStockPier.getState().forget();
    if (owner) void useStockPier.getState().loadStates(owner);
  }, [owner]);

  const ready = list?.status === 'ready' ? list.value : null;
  const pair = ready ? (ready.pairs.find((p) => p.mint === mint) ?? ready.pairs[0] ?? null) : null;
  const spot = pair ? pair.piers[quote] : null;
  const lost = pair && costs && costs.pool === spot?.address ? costs.lost : null;
  const choice = useMemo(
    () => (pair && ready ? stockChoice(pair, quote, typed, holdings, owner, states?.ceilingUsd ?? null, ready.quoteUsd, lost, now) : null),
    [pair, ready, quote, typed, holdings, owner, states, lost, now],
  );
  const shown = reviewed && choice?.key && reviewed.key === choice.key ? reviewed : null;
  const busy = STOCK_BUSY.has(phase);

  // The exact Review of what is on the card, while the person reads it.
  useEffect(() => {
    if (!connection || !admitted || !choice?.key || phase !== 'idle' || notice || shown || boat) return;
    const timer = setTimeout(() => void useStockPier.getState().prepare(connection, { kind: 'build' }, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, admitted, choice?.key, phase, notice, shown, boat]);

  // The wallet's boats in stock piers: positions in a pier the list knows.
  const piers = useMemo(() => {
    const out = new Map<string, Readonly<{ pair: StockPair; quote: StockQuote }>>();
    for (const p of ready?.pairs ?? []) for (const q of STOCK_QUOTES) out.set(p.piers[q].address, { pair: p, quote: q });
    return out;
  }, [ready]);
  const views: readonly PositionView[] = positions && positions.owner === owner && positions.value.status === 'ready' ? positions.value.value.filter((v) => piers.has(v.pool)) : [];

  if (outcome) return <StockOutcome words={words} />;
  if (boat) {
    const known = piers.get(boat.pool) ?? null;
    return <StockBoat words={words} view={boat} pair={known?.pair ?? null} now={now} locale={locale} />;
  }

  const back = (
    <button type="button" className={s.back} onClick={() => useEarn.getState().openProduct(null)} disabled={STOCK_LOCKED.has(phase)}>
      <BackGlyph />
      {words.back}
    </button>
  );
  const head = (
    <div className={s.cardHead}>
      <h3 className={`${s.display} ${s.productName}`}>{words.products.stockpier.name}</h3>
      <RiskDots dots={RISK.stockpier} words={words} />
    </div>
  );

  if (!list || list.status === 'loading') {
    return (
      <section className={s.saver} aria-label={words.products.stockpier.name}>
        {back}
        {head}
        <div className={s.bones} aria-busy="true">
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }
  if (list.status === 'error' || !pair || !spot || !choice || !ready) {
    return (
      <section className={s.saver} aria-label={words.products.stockpier.name}>
        {back}
        {head}
        <p className={s.empty}>{list.status === 'error' ? words.unavailable : w.empty}</p>
        {list.status === 'error' ? (
          <button type="button" className={`${s.display} ${s.secondary}`} onClick={() => void useStockPier.getState().load()}>
            {words.tryAgain}
          </button>
        ) : null}
        <div className={s.grow} />
        <Notify product="stockpier" words={words} />
      </section>
    );
  }

  const hours = hoursOf(pair.session, now);
  const guard = dividendGuard(pair.step, now);
  const builds = !spot.built;
  const verb = builds ? w.build : w.moor;
  const figures = shown ? reviewFigures(shown.review, symbolsOf(pair, quote, spot.stockIsA), null) : null;
  const rent = shown ? rentOf(shown.review.preview.rent) : null;
  const price = shownPrice(pair, ready.quoteUsd[quote]);
  const deposit = shown ? depositOf(shown.review.preview, pair, spot.stockIsA) : null;
  const goesIn = deposit
    ? `${quoteText(deposit.quote, quote)} + ${stockText(deposit.stock, pair)}`
    : choice.split
      ? `≈ ${quoteText(choice.split.quoteUnits, quote)} + ${stockText(choice.split.stockUnits, pair)}`
      : null;
  // A corporate step is said once, at the top; the other problems under the line.
  const problem = choice.problem && choice.problem !== 'dividend' && typed && !closedFor(states, admitted) ? problemText(words, choice, pair, quote) : null;
  const shortStock = choice.problem === 'stock' && Boolean(connection);
  const closed = closedFor(states, admitted);
  const unit = QUOTE[quote].symbol;

  return (
    <section className={s.saver} aria-label={words.products.stockpier.name}>
      {back}
      {head}
      <HoursChip words={words} hours={hours} now={now} locale={locale} />
      <StepNote words={words} guard={guard} now={now} />

      <div className={s.stockRow} role="radiogroup" aria-label={w.pick}>
        {ready.pairs.map((p) => (
          <button
            key={p.mint}
            type="button"
            role="radio"
            aria-checked={p.mint === pair.mint}
            className={`${s.stockChip} ${p.mint === pair.mint ? s.stockOn : ''}`}
            onClick={() => useStockPier.getState().choose(p.mint)}
            disabled={busy}
          >
            <Coin mint={p.mint} size={26} />
            <b>{p.symbol}</b>
            <span>{digits(usdShort(p.volume7dUsd))}</span>
          </button>
        ))}
      </div>

      <div className={s.stockFacts}>
        <span>
          <small className={s.kicker}>{w.volume7d}</small>
          <b className={s.display}>{digits(usdShort(pair.volume7dUsd))}</b>
        </span>
        <span>
          <small className={s.kicker}>{w.price}</small>
          <b className={s.display}>{price !== null ? `${digits(solShort(price))} ${unit}` : '—'}</b>
        </span>
      </div>

      <div className={s.segment} role="radiogroup" aria-label={w.pick}>
        {STOCK_QUOTES.map((q) => (
          <button
            key={q}
            type="button"
            role="radio"
            aria-checked={quote === q}
            className={`${s.segmentButton} ${quote === q ? s.segmentOn : ''}`}
            onClick={() => useStockPier.getState().setQuote(q)}
            disabled={busy}
          >
            <Coin mint={QUOTE[q].mint} size={20} />
            <b>
              {pair.symbol} · {QUOTE[q].symbol}
            </b>
          </button>
        ))}
      </div>
      <p className={s.pierState}>
        {spot.built ? (
          <>
            {w.standing(digits(spot.feeBps !== null ? pct(spot.feeBps) : '—'))}
            {spot.depthUsd !== null ? ` · ${w.depth} ${digits(usdShort(spot.depthUsd))}` : ''}
          </>
        ) : (
          w.newPier
        )}
      </p>

      <label className={s.kicker} htmlFor="earn-stock-amount">
        {w.amount}
      </label>
      <div className={s.field}>
        <input
          id="earn-stock-amount"
          className={`${s.input} ${s.amount}`}
          inputMode="decimal"
          autoComplete="off"
          value={typed}
          onChange={(event) => useStockPier.getState().setTyped(event.target.value)}
          disabled={busy}
          aria-invalid={Boolean(problem)}
        />
        <span className={s.unit}>{unit}</span>
        {choice.max !== null && choice.max > 0n ? (
          <button type="button" className={s.inline} onClick={() => useStockPier.getState().setTyped(amountText(choice.max!, QUOTE[quote].decimals))} disabled={busy}>
            {w.max}
          </button>
        ) : null}
      </div>
      {goesIn ? <p className={s.goesIn}>{goesIn}</p> : null}

      <span className={s.kicker}>{w.atClose}</span>
      <PlanSwitch words={words} plan={plan} onPlan={(next) => useStockPier.getState().setPlan(next)} disabled={busy} />

      <Line
        label={words.details}
        line={
          <>
            {w.noFee} · {w.minimum} {quoteText(choice.minimum, quote)} · {w.risk}
          </>
        }
      >
        <dl className={s.dl}>
          <dt>{w.venue}</dt>
          <dd>{w.venueValue}</dd>
          <dt>{w.tradeFee}</dt>
          <dd>{digits(builds ? w.tradeFeeValue(pct(STOCK_PIER_BASE_FEE_BPS)) : spot.feeBps !== null ? pct(spot.feeBps) : '—')}</dd>
          <dt>{w.feesIn}</dt>
          <dd>{builds ? unit : `${pair.symbol} · ${unit}`}</dd>
          {builds && rawPrice(pair, ready.quoteUsd[quote]) !== null ? (
            <>
              <dt>{w.priceAt}</dt>
              <dd>
                1 {pair.symbol} = {digits(solShort(price))} {unit}
              </dd>
            </>
          ) : null}
          {rent && rent.pool > 0n ? (
            <>
              <dt>{w.poolRent}</dt>
              <dd>
                {digits(solShort(rent.pool))} SOL, {w.poolRentStays}
              </dd>
            </>
          ) : null}
          <dt>{w.positionRent}</dt>
          <dd>{rent ? `${digits(solShort(rent.position))} SOL, ${words.pier.rentBack}` : '—'}</dd>
          <dt>{words.pier.network}</dt>
          <dd>{figures ? `${figures.networkSol} SOL` : '—'}</dd>
          <dt>{words.pier.slippage}</dt>
          <dd>{digits(`${STOCK_PIER_SLIPPAGE_BPS / 100}%`)}</dd>
        </dl>
        <p className={s.fine}>{w.templateFine}</p>
        <p className={s.fine}>{w.closeFine}</p>
        <p className={s.fine}>{w.dividendFine}</p>
        {pair.issuerMoves ? <p className={s.fine}>{w.issuerFine}</p> : null}
        <p className={s.fine}>{w.hoursFine}</p>
        <p className={s.fine}>{w.fine}</p>
      </Line>

      {problem ? <p className={`${s.note} ${s.noteWarn}`}>{problem}</p> : null}
      {states?.stopped ? <p className={`${s.note} ${s.noteWarn}`}>{w.stopped}</p> : null}
      <StockNoteLine notice={notice ?? (figures?.note ? { tone: 'warn', text: figures.note } : null)} />
      {views.length ? (
        <div className={s.dock}>
          <span className={s.kicker}>{w.boats}</span>
          <ul className={s.boats}>
            {views.map((view) => (
              <BoatTile
                key={view.address}
                words={words}
                view={view}
                due={planDue((plansFor?.owner === owner ? plansFor.value.get(view.pool) : null) ?? DEFAULT_PLAN, hoursOf(piers.get(view.pool)?.pair.session ?? null, now))}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <div className={s.grow} />
      {closed ? (
        <Notify product="stockpier" words={words} />
      ) : shortStock ? (
        <button
          type="button"
          className={`${s.display} ${s.action} ${s.cta}`}
          onClick={() =>
            openTradeCard({
              mint: pair.mint,
              symbol: pair.symbol,
              name: pair.name,
              icon: null,
            })
          }
        >
          {words.pier.get(pair.symbol)}
        </button>
      ) : (
        <StockAction
          words={words}
          verb={verb}
          ready={Boolean(shown)}
          blocked={connection && (!admitted || choice.problem) ? verb : null}
          onPrepare={() => connection && void useStockPier.getState().prepare(connection, { kind: 'build' }, holdings)}
        />
      )}
    </section>
  );
}

/** Closed — and, under the canary, closed to every wallet it does not name: the canary is never announced. */
function closedFor(states: Readonly<{ stopped: boolean }> | null, admitted: boolean): boolean {
  return STOCK_PIER_MODE === 'closed' || (STOCK_PIER_MODE === 'canary' && !admitted) || (states !== null && !admitted && !states.stopped);
}

/** Stock base units as the wallet shows them: times the multiplier in force. */
function stockText(units: bigint, pair: StockPair): string {
  return `${digits(solShort((Number(units) / 10 ** pair.decimals) * pair.multiplier))} ${pair.symbol}`;
}

/** What a Review puts in, by coin: the stock is X unless a standing pier is the other way round. */
function depositOf(
  preview: Readonly<{
    action: string;
    deposit?: Readonly<{
      x: Readonly<{ units: string }>;
      y: Readonly<{ units: string }>;
    }>;
  }>,
  pair: StockPair,
  stockIsA: boolean,
): Readonly<{ stock: bigint; quote: bigint }> | null {
  if (preview.action !== 'add' || !preview.deposit) return null;
  const x = /^\d+$/.test(preview.deposit.x.units) ? BigInt(preview.deposit.x.units) : null;
  const y = /^\d+$/.test(preview.deposit.y.units) ? BigInt(preview.deposit.y.units) : null;
  if (x === null || y === null) return null;
  void pair;
  return stockIsA ? { stock: x, quote: y } : { stock: y, quote: x };
}

/** The pool's two coins by side, for the engine's figures: the stock is X unless a standing pier is the other way round. */
function symbolsOf(pair: StockPair, quote: StockQuote, stockIsA: boolean): Readonly<{ x: string; y: string }> {
  return stockIsA ? { x: pair.symbol, y: QUOTE[quote].symbol } : { x: QUOTE[quote].symbol, y: pair.symbol };
}

function rentOf(
  rows: readonly Readonly<{
    what: string;
    direction: string;
    lamports: string;
    refundable: boolean;
  }>[],
): Readonly<{ pool: bigint; position: bigint }> {
  let pool = 0n;
  let position = 0n;
  for (const row of rows) {
    if (row.direction !== 'pay' || !/^\d+$/.test(row.lamports)) continue;
    if (row.refundable) position += BigInt(row.lamports);
    else pool += BigInt(row.lamports);
  }
  return { pool, position };
}

function problemText(words: Words, choice: NonNullable<ReturnType<typeof stockChoice>>, pair: StockPair, quote: StockQuote): string {
  const p = words.stock.problem;
  const unit = QUOTE[quote].symbol;
  if (choice.problem === 'dividend') return p.dividend;
  if (choice.problem === 'min') return p.min(quoteText(choice.minimum, quote));
  if (choice.problem === 'ceiling') return p.ceiling(choice.ceiling !== null ? quoteText(choice.ceiling, quote) : '—');
  if (choice.problem === 'quote') return p.quote(unit);
  if (choice.problem === 'stock') return p.stock(pair.symbol);
  return p.format(unit);
}

/** The exchange's hours as one quiet chip: a lit dot while it is open, the next change in the person's own clock. */
function HoursChip({ words, hours, now, locale }: { words: Words; hours: ReturnType<typeof hoursOf>; now: number; locale: string }) {
  const h = words.stock.hours;
  if (hours.state === 'unknown') return null;
  const at = hours.nextAt !== null ? digits(whenText(hours.nextAt, now, locale)) : null;
  const text = hours.state === 'closed' ? (at ? h.closed(at) : h.closedNow) : hours.state === 'closing' ? (at ? h.closing(at) : h.openNow) : at ? h.open(at) : h.openNow;
  return (
    <p className={`${s.hours} ${hours.state === 'closed' ? '' : s.hoursOpen} ${hours.state === 'closing' ? s.hoursClosing : ''}`}>
      <i aria-hidden="true" />
      {text}
    </p>
  );
}

/** Stay or step out at the close: two choices, the second line says what each does. */
function PlanSwitch({ words, plan, onPlan, disabled }: { words: Words; plan: ClosePlan; onPlan: (plan: ClosePlan) => void; disabled: boolean }) {
  const w = words.stock;
  return (
    <div className={s.segment} role="radiogroup" aria-label={w.atClose}>
      {CLOSE_PLANS.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={plan === id}
          className={`${s.segmentButton} ${s.planButton} ${plan === id ? s.segmentOn : ''}`}
          onClick={() => onPlan(id)}
          disabled={disabled}
        >
          <PlanGlyph plan={id} />
          <b>{w.plans[id]}</b>
          <span>{w.planLine[id]}</span>
        </button>
      ))}
    </div>
  );
}

function PlanGlyph({ plan }: { plan: ClosePlan }) {
  return (
    <svg className={s.planGlyph} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {plan === 'stay' ? <path d="M12 3v10M8 9l4 4 4-4M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0" /> : <path d="M12 14V4M8 8l4-4 4 4M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0" />}
    </svg>
  );
}

/** A corporate step in sight: a quiet chip while new liquidity may still go in, amber while it waits. */
function StepNote({ words, guard, now }: { words: Words; guard: Guard; now: number }) {
  if (guard.kind === 'none') return null;
  const w = words.stock;
  const when = digits(untilText(guard.kind === 'hold' ? guard.until : guard.at, now, w.units));
  return <p className={`${s.stepNote} ${guard.kind === 'hold' ? s.stepHold : ''}`}>{guard.kind === 'hold' ? w.step.hold[guard.step](when) : w.step.ahead[guard.step](when)}</p>;
}

function BoatTile({ words, view, due }: { words: Words; view: PositionView; due: boolean }) {
  const lit = view.rangeState === 'in_range';
  return (
    <li>
      <button type="button" className={`${s.boatTile} ${lit ? s.boatLit : ''}`} onClick={() => useStockPier.getState().openBoat(view)} aria-label={view.name}>
        <Boat lit={lit} size={64} />
        <b>{view.name}</b>
        <span className={due ? s.noteWarn : undefined}>{due ? words.stock.stepOut : words.pier.inRange}</span>
      </button>
    </li>
  );
}

/** One boat in a stock pier: what it holds and its fees, its plan for the close, and Take fees · Leave. */
function StockBoat({ words, view, pair, now, locale }: { words: Words; view: PositionView; pair: StockPair | null; now: number; locale: string }) {
  const w = words.stock;
  const phase = useStockPier((st) => st.phase);
  const target = useStockPier((st) => st.target);
  const reviewed = useStockPier((st) => st.reviewed);
  const notice = useStockPier((st) => st.notice);
  const plans = useStockPier((st) => st.plans);
  const statesFor = useStockPier((st) => st.states);
  const connection = useWallet((st) => st.connection);
  const owner = connection?.address ?? null;
  const states = owner && statesFor?.owner === owner ? statesFor.value : null;
  const plan = (plans?.owner === owner ? plans.value.get(view.pool) : null) ?? DEFAULT_PLAN;
  const hours = hoursOf(pair?.session ?? null, now);
  const due = planDue(plan, hours);
  const guard = dividendGuard(pair?.step ?? null, now);
  const exits = states?.exit === 'on';
  const kind = target && target.kind !== 'build' && target.position.address === view.address ? target.kind : null;
  const shown = kind && reviewed ? reviewed : null;
  const figures = shown ? reviewFigures(shown.review, { x: view.x.symbol, y: view.y.symbol }, null) : null;
  const busy = STOCK_BUSY.has(phase);
  const act = (next: 'claim' | 'exit') => {
    if (!connection) return;
    if (kind === next && shown) void useStockPier.getState().confirm(connection, useWallet.getState().holdings);
    else void useStockPier.getState().prepare(connection, { kind: next, position: view }, useWallet.getState().holdings);
  };
  const label = (next: 'claim' | 'exit', verb: string) =>
    kind === next && phase === 'reviewing' ? words.pier.building : kind === next && phase === 'wallet' ? words.pier.wallet : kind === next && phase === 'sending' ? words.pier.sending : verb;
  return (
    <section className={s.saver} aria-label={view.name}>
      <button type="button" className={s.back} onClick={() => useStockPier.getState().back()} disabled={STOCK_LOCKED.has(phase)}>
        <BackGlyph />
        {words.back}
      </button>
      <div className={s.cardHead}>
        <span className={s.pierTitle}>
          <span className={s.pierCoins} aria-hidden="true">
            <Coin mint={view.x.mint} size={30} />
            <Coin mint={view.y.mint} size={30} />
          </span>
          <h3 className={`${s.display} ${s.productName}`}>{view.name}</h3>
        </span>
      </div>
      <HoursChip words={words} hours={hours} now={now} locale={locale} />
      <div className={s.stockFacts}>
        <span>
          <small className={s.kicker}>{words.pier.holds}</small>
          <b className={s.display}>{digits(usdShort(view.valueUsd))}</b>
        </span>
        <span>
          <small className={s.kicker}>{words.pier.youTake}</small>
          <b className={`${s.display} ${view.unclaimedUsd ? s.gain : ''}`}>{digits(usdShort(view.unclaimedUsd))}</b>
        </span>
      </div>
      <span className={s.kicker}>{w.atClose}</span>
      <PlanSwitch words={words} plan={plan} onPlan={(next) => owner && useStockPier.getState().keepBoatPlan(owner, view.pool, next)} disabled={busy} />
      {due ? <p className={`${s.note} ${s.noteWarn}`}>{w.stepOutLine}</p> : null}
      <StepNote words={words} guard={guard} now={now} />
      {figures ? <p className={s.goesIn}>{figures.amounts.join(' + ')}</p> : null}
      <StockNoteLine notice={notice} />
      <div className={s.grow} />
      {!connection ? (
        <Wallets words={words} />
      ) : (
        <div className={`${s.pair} ${s.cta}`}>
          <button type="button" className={`${s.display} ${due ? s.secondary : s.action}`} onClick={() => act('claim')} disabled={busy || !exits || !view.unclaimedUsd}>
            {label('claim', words.pier.take)}
          </button>
          <button type="button" className={`${s.display} ${due ? s.action : s.secondary}`} onClick={() => act('exit')} disabled={busy || !exits}>
            {label('exit', due ? w.stepOut : words.pier.leave)}
          </button>
        </div>
      )}
    </section>
  );
}

function StockNoteLine({ notice }: { notice: StockNotice | null }) {
  if (!notice) return null;
  return (
    <p className={`${s.note} ${notice.tone === 'warn' ? s.noteWarn : s.noteError}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      {notice.text}
    </p>
  );
}

/** The one amber action: connect, build the exact Review, sign it, or say plainly why not. */
function StockAction({ words, verb, ready, blocked, onPrepare }: { words: Words; verb: string; ready: boolean; blocked: string | null; onPrepare: () => void }) {
  const phase = useStockPier((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  if (!connection) return <Wallets words={words} />;
  const waiting = phase === 'reviewing' || phase === 'wallet' || phase === 'sending';
  const w = words.pier;
  const label = phase === 'reviewing' ? w.building : phase === 'wallet' ? w.wallet : phase === 'sending' ? w.sending : (blocked ?? verb);
  const press = () => {
    if (ready) void useStockPier.getState().confirm(connection, useWallet.getState().holdings);
    else onPrepare();
  };
  return (
    <button type="button" className={`${s.display} ${s.action} ${s.cta} ${waiting ? s.waiting : ''}`} onClick={press} disabled={waiting || Boolean(blocked)}>
      {label}
    </button>
  );
}

/** What happened: built, moored, fees taken, out — or not, or not known yet; never sent twice. */
function StockOutcome({ words }: { words: Words }) {
  const w = words.stock;
  const outcome = useStockPier((st) => st.outcome);
  const done = useStockPier((st) => st.done);
  const quote = useStockPier((st) => st.quote);
  const phase = useStockPier((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  if (!outcome) return null;
  const signature = outcome.kind === 'failed' ? outcome.signature : 'signatures' in outcome ? (outcome.signatures.at(-1) ?? null) : null;
  const good = outcome.kind === 'done';
  const title = done?.kind === 'build' ? w.built : done?.kind === 'moor' ? w.moored : done?.kind === 'claim' ? w.taken : w.left;
  const line = done?.kind === 'build' ? w.builtLine(QUOTE[quote].symbol) : done?.kind === 'moor' ? w.mooredLine : null;
  const word = good ? title : outcome.kind === 'partial' ? words.pier.partial : outcome.kind === 'failed' ? words.pier.failed : words.pier.unknown;
  return (
    <section className={s.saver}>
      <div className={`${s.result} ${good ? s.resultGood : ''}`} role="status">
        {good ? (
          <>
            <span className={`${s.display} ${s.resultWord}`}>{word}</span>
            {line ? <p className={s.fine}>{line}</p> : null}
          </>
        ) : (
          <p className={s.lead}>{word}</p>
        )}
        {signature ? (
          <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
            {words.pier.explorer}
          </a>
        ) : null}
      </div>
      <div className={s.grow} />
      {outcome.kind === 'unknown' && connection ? (
        <button
          type="button"
          className={`${s.display} ${s.action} ${phase === 'sending' ? s.waiting : ''}`}
          onClick={() => void useStockPier.getState().recheck(connection.address)}
          disabled={phase === 'sending'}
        >
          {phase === 'sending' ? words.pier.sending : words.pier.checking}
        </button>
      ) : (
        <div className={s.pair}>
          <button
            type="button"
            className={`${s.display} ${s.secondary}`}
            onClick={() => {
              useStockPier.getState().again();
              useEarn.getState().setTab('mine');
            }}
          >
            {words.tabs.mine}
          </button>
          <button type="button" className={`${s.display} ${good ? s.action : s.secondary}`} onClick={() => useStockPier.getState().again()}>
            {good ? words.products.stockpier.name : words.pier.again}
          </button>
        </div>
      )}
    </section>
  );
}
