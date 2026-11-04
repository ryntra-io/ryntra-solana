'use client';

import { useEffect, useMemo } from 'react';
import type { Amount } from '@ryntra/core/adapters';
import { RISK } from '@/city/lib/earn/flag';
import { placedOf } from '@/city/lib/earn/device';
import { depositInDollars, LADDER_BINS, quotedInDollars, replaceDue, shownUnits, unitPriceNow, type Intent, type LimitForm, type LimitMarket } from '@/city/lib/earn/limit';
import { LIMIT_MODE } from '@/city/lib/earn/limit-gate';
import { heldFor, LIMIT_BUSY, LIMIT_LOCKED, limitChoice, orderFacts, priceField, rollBins, SOL_RESERVE_LAMPORTS, useLimit, type AmountUnit, type LimitNotice } from '@/city/lib/earn/limit-store';
import { limitWords, type LimitWords } from '@/city/lib/earn/limit-words';
import { useEarn } from '@/city/lib/earn/open';
import type { Words } from '@/city/lib/earn/words';
import { dateText, digits } from '@/city/lib/i18n/dict';
import { amountText } from '@/city/lib/trade/size';
import { useWallet } from '@/city/lib/trade/wallet';
import { explorerTxUrl } from '@/lib/solana/explorer';
import type { LimitOrderView } from '@/lib/liquidity/studio/limit-orders';
import { BackGlyph, Coin, Line, Notify, RiskDots, Wallets } from './bits';
import { Product } from './Product';
import s from './earn.module.css';
import l from './sell.module.css';

/** With a wallet the product admits, the exact Review follows the card after this pause, once per choice. */
const AUTO_REVIEW_MS = 500;
const STEPS = [0.02, 0.05, 0.1] as const;
const INTENTS: readonly Intent[] = ['sell', 'buy'];
const UNITS: readonly AmountUnit[] = ['coin', 'usd'];
const FORMS: readonly LimitForm[] = ['one', 'ladder'];

/** A price in the market's quote: dollars for USDC, SOL for SOL. */
export function quoteText(market: LimitMarket, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (market.quote.symbol === 'USDC') return digits(`$${value >= 1000 ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : value >= 1 ? value.toFixed(2) : Number(value.toPrecision(4)).toString()}`);
  return digits(`${Number(value.toPrecision(value >= 1 ? 6 : 4))} SOL`);
}

/** An amount of the asset as the wallet shows it (shares, SOL). */
function assetText(market: LimitMarket, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return digits(`${Number(value.toPrecision(value >= 1 ? 6 : 4))} ${market.asset.symbol}`);
}

const solOf = (lamports: bigint) => digits(`${Number((Number(lamports) / 1e9).toPrecision(3))} SOL`);
const tokens = (amount: Amount) => Number(amount.units) / 10 ** amount.decimals;

/**
 * Sell Higher · Buy Lower · the Wheel (CITY-97): pick the side and the market, set your price and the amount, read the
 * one line, sign once. The order is the pool's own limit order: it fills only at your price or better and stays filled.
 * Prices per share follow the token's live multiplier; on the eve of a corporate action an order near the price waits.
 * Below the action, your orders: what filled, what it brought, take it back, or turn the Wheel in one tap.
 */
export function Sell({ words }: { words: Words }) {
  const lw = limitWords();
  const markets = useLimit((st) => st.markets);
  const pool = useLimit((st) => st.pool);
  const intent = useLimit((st) => st.intent);
  const form = useLimit((st) => st.form);
  const price = useLimit((st) => st.price);
  const amount = useLimit((st) => st.amount);
  const usdTyped = useLimit((st) => st.usd);
  const unitChosen = useLimit((st) => st.unit);
  const phase = useLimit((st) => st.phase);
  const reviewed = useLimit((st) => st.reviewed);
  const notice = useLimit((st) => st.notice);
  const outcome = useLimit((st) => st.outcome);
  const statesFor = useLimit((st) => st.states);
  const costsFor = useLimit((st) => st.costs);
  const target = useLimit((st) => st.target);
  const connection = useWallet((st) => st.connection);
  const holdingsFor = useWallet((st) => st.holdings);
  const owner = connection?.address ?? null;
  const holdings = holdingsFor && holdingsFor.owner === owner ? holdingsFor : null;
  const states = owner && statesFor?.owner === owner ? statesFor.value : null;
  const admitted = states?.place === 'on';
  const list = markets.status === 'ready' ? markets.value : [];
  const market = list.find((m) => m.pool === pool) ?? null;
  const solUsd = list.find((m) => m.asset.kind === 'sol')?.priceUsd ?? null;
  const costs = market && costsFor?.pool === market.pool ? costsFor.value : null;
  const busy = LIMIT_BUSY.has(phase);

  useEffect(() => {
    void useLimit.getState().loadMarkets();
  }, []);
  useEffect(() => {
    if (!owner) return void useLimit.getState().forget();
    void useLimit.getState().loadStates(owner);
    void useLimit.getState().loadOrders(owner);
  }, [owner]);

  const choice = useMemo(
    () => (market ? limitChoice({ market, intent, form, price, amount, holdings, owner, ceilingUsd: states?.ceilingUsd ?? null, costs, solUsd, nowMs: Date.now() }) : null),
    [market, intent, form, price, amount, holdings, owner, states, costs, solUsd],
  );
  const shown = reviewed && choice?.key && reviewed.key === choice.key && target?.kind === 'place' ? reviewed : null;

  // The exact Review of what is on the card, while the person reads it.
  useEffect(() => {
    if (!connection || !admitted || !choice?.key || phase !== 'idle' || notice || shown) return;
    const timer = setTimeout(() => void useLimit.getState().prepare(connection, { kind: 'place' }, useWallet.getState().holdings), AUTO_REVIEW_MS);
    return () => clearTimeout(timer);
  }, [connection, admitted, choice?.key, phase, notice, shown]);

  if (LIMIT_MODE === 'closed') return <Product id="sell" words={words} />;
  if (outcome) return <SellOutcome lw={lw} />;
  // Under the canary, to every wallet it does not name, the product is the calm card it is when closed.
  if (LIMIT_MODE === 'canary' && !admitted) return <Product id="sell" words={words} />;

  const back = (
    <button type="button" className={s.back} onClick={() => useEarn.getState().openProduct(null)} disabled={LIMIT_LOCKED.has(phase)}>
      <BackGlyph />
      {words.back}
    </button>
  );
  if (markets.status !== 'ready' || !market || !choice) {
    return (
      <section className={s.saver} aria-label={words.products.sell.name}>
        {back}
        <div className={s.cardHead}>
          <h3 className={`${s.display} ${s.productName}`}>{words.products.sell.name}</h3>
          <RiskDots dots={RISK.sell} words={words} />
        </div>
        {markets.status === 'loading' ? (
          <div className={s.bones} aria-busy="true">
            <span />
          </div>
        ) : (
          <p className={s.lead}>{lw.empty}</p>
        )}
        <div className={s.grow} />
        <Notify product="sell" words={words} />
      </section>
    );
  }

  const now = unitPriceNow(market);
  const sell = intent === 'sell';
  const depositUnit = sell ? market.asset.symbol : market.quote.symbol;
  const reserve = costs ? costs.lostLamports + costs.keptLamports : SOL_RESERVE_LAMPORTS;
  const held = heldFor(market, intent, holdings, reserve);
  const max = held !== null && held > 0n ? (sell && market.multiplier.current !== 1 ? amountTextShares(held, market) : amountText(held, sell ? market.asset.decimals : market.quote.decimals)) : null;
  // The amount in dollars (CITY-190): the field shows dollars, the order stays in the coin, said once under the field.
  const unit: AmountUnit = depositInDollars(market, intent) ? 'coin' : unitChosen;
  const typed = unit === 'usd' ? usdTyped : amount;
  const coinValue = Number(amount.replace(',', '.'));
  const coinShown = amount.trim() !== '' && coinValue > 0 ? (sell ? assetText(market, coinValue) : depositInDollars(market, intent) ? null : quoteText(market, coinValue)) : null;
  const echo = typed.trim() === '' ? null : unit === 'usd' ? coinShown : choice.usd !== null && !depositInDollars(market, intent) ? digits(`$${choice.usd >= 1 ? choice.usd.toFixed(2) : Number(choice.usd.toPrecision(2))}`) : null;
  const fill = choice.fullFill;
  const preview = shown?.review.preview;
  const rent = preview ? preview.rent : [];
  const keptRent = rent.filter((r) => r.direction === 'pay' && r.refundable).reduce((sum, r) => sum + BigInt(r.lamports), 0n);
  const lostRent = rent.filter((r) => r.direction === 'pay' && !r.refundable).reduce((sum, r) => sum + BigInt(r.lamports), 0n);
  const network = shown ? BigInt(shown.review.networkFeeLamports) : null;
  const minText = digits(`$${choice.minUsd.toFixed(choice.minUsd < 10 ? 2 : 0)}`);
  // A problem is said once the person has typed what it is about.
  const typedFor = choice.problem === 'format' || choice.problem === 'min' || choice.problem === 'ceiling' || choice.problem === 'balance' ? typed.trim() !== '' : price.trim() !== '';
  const problem = choice.problem && typedFor ? problemText(lw, choice, intent, market) : null;
  const pct = choice.near ? (choice.near / now - 1) * 100 : null;
  // Open here, but not to this wallet (the engine's own gate is closed to it): the calm card, «tell me when it opens».
  if (states !== null && !admitted && !states.stopped) return <Product id="sell" words={words} />;

  return (
    <section className={s.saver} aria-label={words.products.sell.name}>
      {back}
      <div className={l.head}>
        <div className={l.intents} role="radiogroup" aria-label={words.products.sell.name}>
          {INTENTS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={intent === id} className={`${s.display} ${l.intent} ${intent === id ? l.intentOn : ''}`} onClick={() => useLimit.getState().setIntent(id)} disabled={busy}>
              {lw.intents[id]}
            </button>
          ))}
        </div>
        <RiskDots dots={RISK.sell} words={words} />
      </div>

      <div className={l.markets} role="radiogroup" aria-label={lw.price}>
        {list.map((m) => (
          <button key={m.pool} type="button" role="radio" aria-checked={m.pool === market.pool} className={`${l.market} ${m.pool === market.pool ? l.marketOn : ''}`} onClick={() => useLimit.getState().selectMarket(m.pool)} disabled={busy}>
            <Coin mint={m.asset.mint} size={22} />
            <b>{m.asset.symbol}</b>
          </button>
        ))}
      </div>

      <div className={s.context}>
        <b className={`${s.display} ${s.contextFigure}`}>{quoteText(market, now)}</b>
        <span className={s.contextUnit}>
          {market.asset.symbol} · {lw.now}
        </span>
      </div>

      <label className={s.kicker} htmlFor="earn-limit-price">
        {lw.price}
      </label>
      <div className={s.field}>
        <input id="earn-limit-price" className={`${s.input} ${s.amount}`} inputMode="decimal" autoComplete="off" value={price} onChange={(event) => useLimit.getState().setPrice(event.target.value)} disabled={busy} aria-invalid={choice.problem === 'price' || choice.problem === 'side' || choice.problem === 'eve'} />
        <span className={s.unit}>{market.quote.symbol}</span>
        {pct !== null ? <span className={`${l.pct} ${pct >= 0 ? s.gain : s.loss}`}>{digits(`${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`)}</span> : null}
      </div>
      <div className={l.steps}>
        {STEPS.map((step) => (
          <button key={step} type="button" className={l.step} onClick={() => useLimit.getState().setPrice(priceField(now * (sell ? 1 + step : 1 - step), quotedInDollars(market)))} disabled={busy}>
            {digits(`${sell ? '+' : '−'}${Math.round(step * 100)}%`)}
          </button>
        ))}
      </div>

      <label className={s.kicker} htmlFor="earn-limit-amount">
        {lw.amount[intent]}
      </label>
      <div className={s.field}>
        <input
          id="earn-limit-amount"
          className={`${s.input} ${s.amount}`}
          inputMode="decimal"
          autoComplete="off"
          value={typed}
          onChange={(event) => (unit === 'usd' ? useLimit.getState().setUsd(event.target.value) : useLimit.getState().setAmount(event.target.value))}
          disabled={busy}
          aria-invalid={choice.problem === 'format' || choice.problem === 'balance' || choice.problem === 'min' || choice.problem === 'ceiling'}
        />
        {depositInDollars(market, intent) ? (
          <span className={s.unit}>{depositUnit}</span>
        ) : (
          <span className={l.units} role="radiogroup" aria-label={lw.unitIn}>
            {UNITS.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={unit === id} className={`${l.unitPick} ${unit === id ? l.unitOn : ''}`} onClick={() => useLimit.getState().setUnit(id)} disabled={busy}>
                {id === 'usd' ? '$' : depositUnit}
              </button>
            ))}
          </span>
        )}
        {max ? (
          <button type="button" className={s.inline} onClick={() => useLimit.getState().setAmount(max)} disabled={busy}>
            {lw.max}
          </button>
        ) : null}
      </div>
      {echo ? <p className={l.echo}>≈ {echo}</p> : null}
      {fill !== null && fill > 0 ? (
        <p className={s.goesIn}>
          {lw.ifAll[intent]} ≈ {sell ? quoteText(market, fill) : assetText(market, fill)}
        </p>
      ) : null}

      <Line
        label={words.details}
        line={
          <>
            {lw.noFee} · {lw.minimum} {minText} · {lw.risk[intent]}
          </>
        }
      >
        <div className={l.forms} role="radiogroup" aria-label={lw.form}>
          {FORMS.map((id) => (
            <button key={id} type="button" role="radio" aria-checked={form === id} className={`${l.intent} ${form === id ? l.intentOn : ''}`} onClick={() => useLimit.getState().setForm(id)} disabled={busy}>
              {lw.forms[id]}
              {id === 'ladder' ? <small>{digits(` · ${LADDER_BINS}`)}</small> : null}
            </button>
          ))}
        </div>
        <dl className={s.dl}>
          <dt>{lw.orderAt}</dt>
          <dd>{quoteText(market, choice.near)}</dd>
          {form === 'ladder' ? (
            <>
              <dt>{lw.ladderTo}</dt>
              <dd>{quoteText(market, choice.far)}</dd>
            </>
          ) : null}
          <dt>{lw.bonus}</dt>
          <dd>{lw.bonusValue(digits(`${Number((market.feeBps / 100).toFixed(3))}%`))}</dd>
          <dt>{lw.rent}</dt>
          <dd>{shown ? `${solOf(keptRent)}, ${lw.rentBack}` : '—'}</dd>
          {lostRent > 0n ? (
            <>
              <dt>{lw.binsRent}</dt>
              <dd>{solOf(lostRent)}</dd>
            </>
          ) : null}
          <dt>{lw.network}</dt>
          <dd>{network !== null ? solOf(network) : '—'}</dd>
          {market.asset.kind === 'stock' ? (
            <>
              <dt>{lw.units}</dt>
              <dd>{lw.unitsValue(digits(String(Number(market.multiplier.current.toPrecision(8)))))}</dd>
            </>
          ) : null}
          {choice.eve.eve && choice.eve.at ? (
            <>
              <dt>{lw.eve}</dt>
              <dd>{dateText(Date.parse(choice.eve.at), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</dd>
            </>
          ) : null}
        </dl>
        {choice.eve.eve ? <p className={s.fine}>{lw.eveFine}</p> : null}
        {market.asset.kind === 'stock' ? <p className={s.fine}>{lw.issuerFine}</p> : null}
        <p className={s.fine}>{lw.taxes}</p>
        <p className={s.fine}>{lw.fine}</p>
      </Line>

      {problem ? <p className={`${s.note} ${s.noteWarn}`}>{problem}</p> : null}
      {states?.stopped ? <p className={`${s.note} ${s.noteWarn}`}>{lw.stopped}</p> : null}
      <SellNote notice={target?.kind === 'place' ? notice : null} />

      <div className={s.grow} />
      <SellAction
        lw={lw}
        verb={lw.place[intent]}
        ready={Boolean(shown)}
        blocked={connection && (!admitted || choice.problem) ? lw.place[intent] : null}
        words={words}
        onPrepare={() => connection && void useLimit.getState().prepare(connection, { kind: 'place' }, holdings)}
      />

      {owner ? <Orders lw={lw} markets={list} owner={owner} /> : null}
    </section>
  );
}

/** A held balance of base tokens as shares, for «Max» on an xStock: what the wallet shows. */
function amountTextShares(raw: bigint, market: LimitMarket): string {
  const value = shownUnits(raw, market.asset.decimals, market.multiplier.current);
  // A hair under, so the shares typed back never ask for one base unit more than is held.
  const floored = Math.floor(value * 10 ** Math.min(6, market.asset.decimals)) / 10 ** Math.min(6, market.asset.decimals);
  return String(floored);
}

function problemText(lw: LimitWords, choice: NonNullable<ReturnType<typeof limitChoice>>, intent: Intent, market: LimitMarket): string | null {
  const p = lw.problems;
  switch (choice.problem) {
    case 'price':
      return p.price;
    case 'side':
      return p.side[intent];
    case 'eve':
      return choice.eve.blocked ? lw.eveBlocked(lw.eveKinds[choice.eve.kind], dateText(Date.parse(choice.eve.at), { day: 'numeric', month: 'short' })) : null;
    case 'format':
      return p.format;
    case 'min':
      return p.min(digits(`$${choice.minUsd.toFixed(2)}`));
    case 'ceiling':
      return p.ceiling(digits(`$${Math.floor((useLimit.getState().states?.value.ceilingUsd ?? 0) * 0.98)}`));
    case 'balance':
      return p.balance(intent === 'sell' ? market.asset.symbol : market.quote.symbol);
    default:
      return null;
  }
}

export function SellNote({ notice }: { notice: LimitNotice | null }) {
  if (!notice) return null;
  return (
    <p className={`${s.note} ${notice.tone === 'warn' ? s.noteWarn : s.noteError}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
      {notice.text}
    </p>
  );
}

/** The one amber action: connect, build the exact Review, sign it, or say plainly why not. */
function SellAction({ lw, verb, ready, blocked, onPrepare, words }: { lw: LimitWords; verb: string; ready: boolean; blocked: string | null; onPrepare: () => void; words: Words }) {
  const phase = useLimit((st) => st.phase);
  const target = useLimit((st) => st.target);
  const connection = useWallet((st) => st.connection);
  if (!connection) return <Wallets words={words} />;
  const mine = target?.kind === 'place';
  const waiting = mine && (phase === 'reviewing' || phase === 'wallet' || phase === 'sending');
  const label = !mine ? verb : phase === 'reviewing' ? lw.building : phase === 'wallet' ? lw.wallet : phase === 'sending' ? lw.sending : blocked ?? verb;
  const press = () => {
    if (ready) void useLimit.getState().confirm(connection, useWallet.getState().holdings);
    else onPrepare();
  };
  return (
    <button type="button" className={`${s.display} ${s.action} ${s.cta} ${waiting ? s.waiting : ''}`} onClick={press} disabled={waiting || Boolean(blocked) || LIMIT_BUSY.has(phase)}>
      {label}
    </button>
  );
}

/** Your orders: each one's side, price and fill, what it brought, and its actions. */
function Orders({ lw, markets, owner }: { lw: LimitWords; markets: readonly LimitMarket[]; owner: string }) {
  const orders = useLimit((st) => (st.orders?.owner === owner ? st.orders.value : null));
  if (!orders || orders.status !== 'ready' || orders.value.length === 0) return null;
  const placed = placedOf(owner);
  return (
    <div className={l.orders}>
      <span className={s.kicker}>{lw.orders}</span>
      <ul className={l.orderList}>
        {orders.value.map((order) => (
          <li key={order.address}>
            <OrderCard lw={lw} order={order} market={markets.find((m) => m.pool === order.pool) ?? null} replace={replaceDue(placed.get(order.address) ?? null, markets.find((m) => m.pool === order.pool)?.multiplier.current ?? 1)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrderCard({ lw, order, market, replace }: { lw: LimitWords; order: LimitOrderView; market: LimitMarket | null; replace: boolean }) {
  const phase = useLimit((st) => st.phase);
  const target = useLimit((st) => st.target);
  const reviewed = useLimit((st) => st.reviewed);
  const notice = useLimit((st) => st.notice);
  const connection = useWallet((st) => st.connection);
  const mine = target && target.kind !== 'place' && target.order.address === order.address ? target : null;
  const ready = Boolean(mine && reviewed && reviewed.body.action !== 'limit_place' && reviewed.body.request.order === order.address && reviewed.body.action === (mine.kind === 'roll' ? 'limit_roll' : 'limit_cancel'));
  const busy = LIMIT_BUSY.has(phase);
  const facts = market ? orderFacts(market, order) : null;
  const status = order.status === 'filled' ? lw.filled : order.status === 'partial' ? lw.partly(digits(`${Math.round(order.filledBps / 100)}%`)) : lw.waiting;
  const deposit = tokens(order.deposit);
  const proceeds = tokens(order.proceeds);
  const intent = facts?.intent ?? (order.side === 'ask' ? 'sell' : 'buy');
  const amount = market && facts ? (facts.intent === 'sell' ? assetText(market, market.asset.kind === 'stock' ? deposit * market.multiplier.current : deposit) : quoteText(market, deposit)) : digits(String(Number(deposit.toPrecision(6))));
  const got = market && facts && proceeds > 0 ? (facts.intent === 'sell' ? quoteText(market, proceeds) : assetText(market, market.asset.kind === 'stock' ? proceeds * market.multiplier.current : proceeds)) : null;
  const roll = market && order.status === 'filled' ? rollBins(market, order) : null;
  const act = (kind: 'cancel' | 'roll', again = false) => {
    if (!connection) return;
    if (ready && mine?.kind === kind) void useLimit.getState().confirm(connection, useWallet.getState().holdings);
    else void useLimit.getState().prepare(connection, { kind, order, ...(again ? { replace: true } : {}) }, useWallet.getState().holdings);
  };
  const label = (kind: 'cancel' | 'roll', word: string) => (mine?.kind === kind ? (phase === 'reviewing' ? lw.building : phase === 'wallet' ? lw.wallet : phase === 'sending' ? lw.sending : word) : word);
  const backX = tokens(order.withdrawable.x);
  const backY = tokens(order.withdrawable.y);
  const backText = [backX > 0 ? `${digits(String(Number(backX.toPrecision(5))))} ${symbolOf(market, order.tokenX.mint)}` : null, backY > 0 ? `${digits(String(Number(backY.toPrecision(5))))} ${symbolOf(market, order.tokenY.mint)}` : null].filter(Boolean).join(' + ');

  return (
    <article className={`${l.order} ${order.status === 'filled' ? l.orderFilled : ''}`} data-order-status={order.status}>
      <div className={l.orderHead}>
        <span className={l.orderName}>
          {market ? <Coin mint={market.asset.mint} size={20} /> : null}
          <b>{market ? market.asset.symbol : lw.orders}</b>
          <small>{lw.intents[intent]}</small>
        </span>
        <span className={l.orderStatus}>{status}</span>
      </div>
      <div className={l.orderFigures}>
        <span>{market && facts ? quoteText(market, facts.near) : order.lowerPrice}</span>
        {got ? <b className={s.gain}>+{got}</b> : <small>{amount}</small>}
      </div>
      <div className={l.fill} aria-hidden="true">
        <span style={{ width: `${Math.min(100, order.filledBps / 100)}%` }} />
      </div>
      {mine && ready && mine.kind === 'cancel' && backText ? (
        <p className={s.goesIn}>
          {lw.youGetBack} {backText}
        </p>
      ) : null}
      {replace ? <p className={`${s.note} ${s.noteWarn}`}>{lw.replace}</p> : null}
      {mine ? <SellNote notice={notice} /> : null}
      <div className={`${s.pair} ${l.orderActions}`}>
        {roll && intent ? (
          <button type="button" className={`${s.display} ${s.action} ${mine?.kind === 'roll' && busy ? s.waiting : ''}`} onClick={() => act('roll')} disabled={busy || !connection}>
            {label('roll', lw.wheel[intent])}
          </button>
        ) : null}
        <button type="button" className={`${s.display} ${replace && !roll ? s.action : s.secondary} ${mine?.kind === 'cancel' && busy ? s.waiting : ''}`} onClick={() => act('cancel', replace)} disabled={busy || !connection}>
          {label('cancel', order.status === 'open' && !replace ? lw.cancel : lw.take)}
        </button>
      </div>
    </article>
  );
}

function symbolOf(market: LimitMarket | null, mint: string): string {
  if (!market) return '';
  return mint === market.asset.mint ? market.asset.symbol : market.quote.symbol;
}

/** What happened: set, back, turned — or not at all, or not known yet — never sent twice. */
function SellOutcome({ lw }: { lw: LimitWords }) {
  const outcome = useLimit((st) => st.outcome);
  const done = useLimit((st) => st.done);
  const phase = useLimit((st) => st.phase);
  const connection = useWallet((st) => st.connection);
  if (!outcome) return null;
  const signature = outcome.kind === 'failed' ? outcome.signature : 'signatures' in outcome ? (outcome.signatures.at(-1) ?? null) : null;
  const good = outcome.kind === 'done';
  const kind = done ?? 'place';
  return (
    <section className={s.saver}>
      <div className={`${s.result} ${good ? s.resultGood : ''}`} role="status">
        {good ? (
          <>
            <span className={`${s.display} ${s.resultWord}`}>{lw.done[kind]}</span>
            <p className={s.fine}>{lw.doneLine[kind]}</p>
          </>
        ) : (
          <p className={s.lead}>{outcome.kind === 'partial' ? lw.partial : outcome.kind === 'failed' ? lw.failed : lw.unknown}</p>
        )}
        {signature ? (
          <a className={s.link} href={explorerTxUrl('mainnet', signature)} target="_blank" rel="noreferrer">
            {lw.explorer}
          </a>
        ) : null}
      </div>
      <div className={s.grow} />
      {outcome.kind === 'unknown' && connection ? (
        <button type="button" className={`${s.display} ${s.action} ${phase === 'sending' ? s.waiting : ''}`} onClick={() => void useLimit.getState().recheck(connection.address)} disabled={phase === 'sending'}>
          {phase === 'sending' ? lw.sending : lw.checking}
        </button>
      ) : (
        <button type="button" className={`${s.display} ${good ? s.action : s.secondary}`} onClick={() => useLimit.getState().again()}>
          {good ? lw.orders : lw.again}
        </button>
      )}
    </section>
  );
}
