import { create } from 'zustand';
import type { LimitReview } from '../../../lib/liquidity/studio/actions.ts';
import type { LimitOrderView } from '../../../lib/liquidity/studio/limit-orders.ts';
import { citySigner } from '../app-bridge/route.ts';
import { spendable } from '../districts/harbor/deposit.ts';
import { follow, outcomeOf, reviewFresh, signAndSend, type ActionOutcome, type SignMany } from '../districts/harbor/flow.ts';
import { failureWords } from '../districts/harbor/review.ts';
import type { Holdings } from '../trade/wallet.ts';
import { keepPlaced, placedOf } from './device.ts';
import {
  binForTarget,
  binsFit,
  binsFor,
  coinOfUsd,
  depositUnits,
  eveGuard,
  fullFillShown,
  orderUnitPrices,
  poolSide,
  quotedInDollars,
  unitPriceNow,
  usdOfCoin,
  wheelTarget,
  type EveGuard,
  type Intent,
  type LimitForm,
  type LimitMarket,
  type PlacedRecord,
} from './limit.ts';
import { createLimitEngine, type LimitBody, type LimitEngine } from './limit-engine.ts';
import type { LimitStates } from './limit-gate.ts';
import { limitWords } from './limit-words.ts';
import { useEarn } from './open.ts';

/**
 * Sell Higher's state in the Earn window (CITY-97): the market, the side, your price and amount, what the city and the
 * engine let this wallet do, the wallet's orders, the engine's Review of exactly what is on screen, and where an action
 * is. As with the Piers, a Review is built while the card is read, so every figure the person signs is on the card
 * before the one amber tap; one too old to sign is built again and shown first. While the wallet signs or bytes are on
 * their way, the window holds.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;
export type Loaded<T> = Readonly<{ status: 'loading' }> | Readonly<{ status: 'ready'; value: T; at: number }> | Readonly<{ status: 'error' }>;

export type LimitPhase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'partial' | 'failed' | 'unknown';
export const LIMIT_BUSY: ReadonlySet<LimitPhase> = new Set(['reviewing', 'wallet', 'sending']);
export const LIMIT_LOCKED: ReadonlySet<LimitPhase> = new Set(['wallet', 'sending']);

export type LimitTarget = Readonly<{ kind: 'place' }> | Readonly<{ kind: 'cancel' | 'roll'; order: LimitOrderView; replace?: boolean }>;
export type LimitReviewed = Readonly<{ key: string; body: LimitBody; review: LimitReview; at: number }>;
export type LimitNotice = Readonly<{ tone: 'warn' | 'error'; text: string }>;

/** The SOL a purchase paid in SOL leaves aside before the Review states the exact rent and network fee. */
export const SOL_RESERVE_LAMPORTS = 10_000_000n;
/** The least one order is worth, in dollars, before costs raise it. */
export const MIN_ORDER_USD = 1;
/** What never comes back (the pool's new bins and the network) is at most a twentieth of the order. */
export const COST_SHARE = 20;
/** A little under the ceiling, so the venue's own prices at the Review never land just above it. */
const CEILING_MARGIN = 0.98;
/** The unit the amount is typed in: the coin that goes in, or dollars (CITY-190). */
export type AmountUnit = 'coin' | 'usd';

/** How far from now the price field starts. */
export const START_STEP = 0.05;

export type LimitCosts = Readonly<{ lostLamports: bigint; keptLamports: bigint }>;

/** The Review's SOL costs: what never comes back (pool bins, network) and what does (the order's deposit). */
export function limitCosts(review: LimitReview): LimitCosts {
  let lost = BigInt(review.networkFeeLamports);
  let kept = 0n;
  for (const rent of review.preview.rent) {
    if (rent.direction !== 'pay') continue;
    if (rent.refundable) kept += BigInt(rent.lamports);
    else lost += BigInt(rent.lamports);
  }
  return { lostLamports: lost, keptLamports: kept };
}

export type LimitProblem = 'price' | 'side' | 'format' | 'min' | 'ceiling' | 'balance' | 'eve';

export type LimitChoice = Readonly<{
  target: number | null;
  bins: Readonly<{ lower: number; upper: number }> | null;
  side: 'ask' | 'bid';
  /** The order's prices per unit: where it starts and, for a ladder, where it ends. */
  near: number | null;
  far: number | null;
  deposit: bigint | null;
  /** If every bin fills, in the other side's units. */
  fullFill: number | null;
  /** The order's dollars at the venue's prices. */
  usd: number | null;
  minUsd: number;
  eve: EveGuard;
  problem: LimitProblem | null;
  key: string | null;
}>;

/** A decimal typed in any locale's way. */
export function numberOfText(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** What one wallet holds of the side that goes in: the asset on a sale, the quote on a purchase (SOL less a reserve). */
export function heldFor(market: LimitMarket, intent: Intent, holdings: Holdings | null, reserve: bigint): bigint | null {
  const mint = intent === 'sell' ? market.asset.mint : market.quote.mint;
  const held = spendable(holdings, mint);
  if (held === null) return null;
  if (market.asset.kind === 'sol' && intent === 'sell') return held > reserve ? held - reserve : 0n;
  if (market.quote.symbol === 'SOL' && intent === 'buy') return held > reserve ? held - reserve : 0n;
  return held;
}

/** Everything the card stands on for what is typed. */
export function limitChoice(input: Readonly<{
  market: LimitMarket;
  intent: Intent;
  form: LimitForm;
  price: string;
  amount: string;
  holdings: Holdings | null;
  owner: string | null;
  ceilingUsd: number | null;
  costs: LimitCosts | null;
  solUsd: number | null;
  nowMs: number;
}>): LimitChoice {
  const { market, intent, form, holdings, owner, ceilingUsd, costs, solUsd } = input;
  const side = poolSide(intent, market.assetIsX);
  const target = numberOfText(input.price);
  const bin = target === null ? null : binForTarget(market, intent, target);
  const bins = bin === null ? null : binsFor(side, bin, form);
  const prices = bins ? orderUnitPrices(market, side, bins) : null;
  const deposit = depositUnits(market, intent, input.amount);
  const fullFill = bins && deposit ? fullFillShown(market, intent, bins, deposit) : null;
  const unitUsd = intent === 'sell' ? market.priceUsd : market.quoteUsd;
  const usd = deposit !== null && unitUsd !== null ? (intent === 'sell' ? (Number(deposit) / 10 ** market.asset.decimals) * market.multiplier.current * unitUsd : (Number(deposit) / 10 ** market.quote.decimals) * unitUsd) : null;
  const lostUsd = costs && solUsd ? (Number(costs.lostLamports) / 1e9) * solUsd : 0;
  const minUsd = Math.max(MIN_ORDER_USD, lostUsd * COST_SHARE);
  const reserve = costs ? costs.lostLamports + costs.keptLamports : SOL_RESERVE_LAMPORTS;
  const held = heldFor(market, intent, holdings, reserve);
  const now = unitPriceNow(market);
  const ratio = prices ? prices.near / now : 1;
  const eve = eveGuard({ intent, multiplier: market.multiplier, mint: market.asset.mint, ratio, nowMs: input.nowMs });
  let problem: LimitProblem | null = null;
  if (target === null || bins === null) problem = 'price';
  else if (!binsFit(side, bins, market.activeBin)) problem = 'side';
  else if (eve.blocked) problem = 'eve';
  else if (deposit === null) problem = 'format';
  else if (usd !== null && usd < minUsd) problem = 'min';
  else if (ceilingUsd !== null && usd !== null && usd > ceilingUsd * CEILING_MARGIN) problem = 'ceiling';
  else if (held !== null && deposit > held) problem = 'balance';
  const key = owner && bins && deposit && !problem ? `place:${owner}:${market.pool}:${side}:${bins.lower}:${bins.upper}:${deposit}` : null;
  return { target, bins, side, near: prices?.near ?? null, far: prices?.far ?? null, deposit, fullFill, usd, minUsd, eve, problem, key };
}

/** An order as the card says it: whether it sells or buys the market's asset, its nearest price per unit, how much. */
export function orderFacts(market: LimitMarket, order: LimitOrderView): Readonly<{ intent: Intent; near: number; far: number }> {
  const intent: Intent = order.side === poolSide('sell', market.assetIsX) ? 'sell' : 'buy';
  const lower = order.bins[0]?.bin ?? market.activeBin;
  const upper = order.bins[order.bins.length - 1]?.bin ?? market.activeBin;
  const { near, far } = orderUnitPrices(market, order.side, { lower, upper });
  return { intent, near, far };
}

/**
 * The Wheel's next order for a filled one: the other side, a step past the price it filled at — never on the wrong
 * side of the price now (a step from now at the least, so it never trades at once).
 */
export function rollBins(market: LimitMarket, order: LimitOrderView): Readonly<{ lower: number; upper: number }> | null {
  const facts = orderFacts(market, order);
  const next: Intent = facts.intent === 'sell' ? 'buy' : 'sell';
  const now = unitPriceNow(market);
  const wanted = wheelTarget(facts.intent, facts.near);
  const target = next === 'buy' ? Math.min(wanted, now * (1 - 0.01)) : Math.max(wanted, now * (1 + 0.01));
  const bin = binForTarget(market, next, target);
  if (bin === null) return null;
  const side = poolSide(next, market.assetIsX);
  const bins = binsFor(side, bin, 'one');
  return binsFit(side, bins, market.activeBin) ? bins : null;
}

/** The price a typed field starts at: a step over now for a sale, under it for a purchase. */
export function startPrice(market: LimitMarket, intent: Intent): number {
  const now = unitPriceNow(market);
  return intent === 'sell' ? now * (1 + START_STEP) : now * (1 - START_STEP);
}

/** A price for the field: enough digits to mean something, no more — in dollars, to the cent from a dollar up. */
export function priceField(value: number, dollars = false): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1000 || (dollars && value >= 1)) return value.toFixed(2);
  if (dollars) return Number(value.toPrecision(4)).toString();
  if (value >= 1) return value.toFixed(value >= 100 ? 2 : 4).replace(/0+$/, '').replace(/\.$/, '');
  return Number(value.toPrecision(5)).toString();
}

export type LimitEnv = Readonly<{
  engine: LimitEngine;
  sign: (connection: Connection) => SignMany;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  after: (owner: string) => void;
}>;

let env: LimitEnv | null = null;
const browserEnv = (): LimitEnv => ({
  engine: createLimitEngine(),
  sign: (connection) => async (unsigned) => {
    const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: unsigned, chain: 'solana:mainnet' });
    return signed.ok ? { ok: true, signed: signed.signedWireBase64 } : { ok: false };
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  after: () => undefined,
});
const limitEnv = (): LimitEnv => (env ??= browserEnv());

export function setLimitEnv(next: Partial<LimitEnv>): void {
  env = { ...limitEnv(), ...next };
}

export function limitFailure(code: string): string {
  const own = limitWords().failures;
  return Object.hasOwn(own, code) ? own[code]! : failureWords(code);
}

type Store = {
  markets: Loaded<readonly LimitMarket[]>;
  pool: string | null;
  intent: Intent;
  form: LimitForm;
  price: string;
  amount: string;
  /** The amount in dollars as the field shows it while the unit is dollars; the order is always `amount`, in the coin. */
  usd: string;
  unit: AmountUnit;
  states: Readonly<{ owner: string; value: LimitStates }> | null;
  orders: Readonly<{ owner: string; value: Loaded<readonly LimitOrderView[]> }> | null;
  reviewed: LimitReviewed | null;
  costs: Readonly<{ pool: string; value: LimitCosts }> | null;
  target: LimitTarget | null;
  phase: LimitPhase;
  outcome: ActionOutcome | null;
  done: 'place' | 'cancel' | 'roll' | null;
  notice: LimitNotice | null;
  loadMarkets: () => Promise<void>;
  selectMarket: (pool: string) => void;
  setIntent: (intent: Intent) => void;
  setForm: (form: LimitForm) => void;
  setPrice: (text: string) => void;
  setAmount: (text: string) => void;
  setUsd: (text: string) => void;
  setUnit: (unit: AmountUnit) => void;
  loadStates: (owner: string) => Promise<void>;
  loadOrders: (owner: string) => Promise<void>;
  prepare: (connection: Connection, target: LimitTarget, holdings: Holdings | null) => Promise<void>;
  confirm: (connection: Connection, holdings: Holdings | null) => Promise<void>;
  recheck: (owner: string) => Promise<void>;
  again: () => void;
  forget: () => void;
};

let ticket = 0;

export const useLimit = create<Store>((set, get) => {
  const hold = (phase: LimitPhase) => {
    set({ phase });
    useEarn.getState().setBusy(LIMIT_LOCKED.has(phase));
  };
  const marketOf = (pool: string | null): LimitMarket | null => {
    const markets = get().markets;
    return markets.status === 'ready' ? (markets.value.find((m) => m.pool === pool) ?? null) : null;
  };
  const solUsd = (): number | null => {
    const markets = get().markets;
    if (markets.status !== 'ready') return null;
    return markets.value.find((m) => m.asset.kind === 'sol')?.priceUsd ?? markets.value.find((m) => m.quote.symbol === 'SOL')?.quoteUsd ?? null;
  };
  const marketOfOrder = (order: LimitOrderView): LimitMarket | null => marketOf(order.pool);

  const keyFor = (owner: string, target: LimitTarget, holdings: Holdings | null): Readonly<{ key: string; body: LimitBody }> | null => {
    const st = get();
    if (target.kind === 'cancel') return { key: `cancel:${owner}:${target.order.address}`, body: { action: 'limit_cancel', venue: 'meteora-dlmm', request: { order: target.order.address, owner } } };
    if (target.kind === 'roll') {
      const market = marketOfOrder(target.order);
      const bins = market ? rollBins(market, target.order) : null;
      if (!bins) return null;
      return { key: `roll:${owner}:${target.order.address}:${bins.lower}:${bins.upper}`, body: { action: 'limit_roll', venue: 'meteora-dlmm', request: { order: target.order.address, owner, bins } } };
    }
    const market = marketOf(st.pool);
    const states = st.states?.owner === owner ? st.states.value : null;
    if (!market || !states || states.place !== 'on') return null;
    const costs = st.costs?.pool === market.pool ? st.costs.value : null;
    const choice = limitChoice({ market, intent: st.intent, form: st.form, price: st.price, amount: st.amount, holdings, owner, ceilingUsd: states.ceilingUsd, costs, solUsd: solUsd(), nowMs: limitEnv().now() });
    if (!choice.key || !choice.bins || choice.deposit === null) return null;
    return { key: choice.key, body: { action: 'limit_place', venue: 'meteora-dlmm', request: { pool: market.pool, owner, side: choice.side, amount: choice.deposit.toString(), bins: choice.bins } } };
  };

  /** After an order lands: what the device keeps of it, so a moved multiplier can be offered again. */
  const remember = (owner: string, reviewed: LimitReviewed) => {
    const preview = reviewed.review.preview;
    if (preview.action === 'limit_cancel') return;
    const market = marketOf(preview.pool);
    if (!market) return;
    const place = preview.place;
    const intent: Intent = place.side === poolSide('sell', market.assetIsX) ? 'sell' : 'buy';
    const near = orderUnitPrices(market, place.side, place.bins).near;
    const record: PlacedRecord = { order: reviewed.review.position, pool: market.pool, mint: market.asset.mint, intent, target: near, multiplier: market.multiplier.current, at: limitEnv().now() };
    keepPlaced(owner, record);
  };

  return {
    markets: { status: 'loading' },
    pool: null,
    intent: 'sell',
    form: 'one',
    price: '',
    amount: '',
    usd: '',
    unit: 'usd',
    states: null,
    orders: null,
    reviewed: null,
    costs: null,
    target: null,
    phase: 'idle',
    outcome: null,
    done: null,
    notice: null,

    loadMarkets: async () => {
      const kept = get().markets;
      if (kept.status === 'ready' && limitEnv().now() - kept.at < 60_000) return;
      const answer = await limitEnv().engine.markets();
      if (!answer.ok || !Array.isArray(answer.value.markets)) {
        if (kept.status !== 'ready') set({ markets: { status: 'error' } });
        return;
      }
      const markets = answer.value.markets;
      set({ markets: { status: 'ready', value: markets, at: limitEnv().now() } });
      const st = get();
      if (!st.pool || !markets.some((m) => m.pool === st.pool)) {
        const first = markets[0];
        if (first) set({ pool: first.pool, price: priceField(startPrice(first, st.intent), quotedInDollars(first)), reviewed: null });
      }
    },
    selectMarket: (pool) => {
      if (LIMIT_BUSY.has(get().phase)) return;
      const market = marketOf(pool);
      if (!market) return;
      ticket += 1;
      set({ pool, price: priceField(startPrice(market, get().intent), quotedInDollars(market)), amount: '', usd: '', reviewed: null, phase: 'idle', notice: null, target: { kind: 'place' } });
    },
    setIntent: (intent) => {
      if (LIMIT_BUSY.has(get().phase)) return;
      const market = marketOf(get().pool);
      ticket += 1;
      set({ intent, amount: '', usd: '', price: market ? priceField(startPrice(market, intent), quotedInDollars(market)) : get().price, reviewed: null, phase: 'idle', notice: null, target: { kind: 'place' } });
    },
    setForm: (form) => {
      if (LIMIT_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ form, reviewed: null, phase: 'idle', notice: null });
    },
    setPrice: (text) => {
      if (LIMIT_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ price: text, reviewed: null, phase: 'idle', notice: null, target: { kind: 'place' } });
    },
    setAmount: (text) => {
      if (LIMIT_BUSY.has(get().phase)) return;
      ticket += 1;
      const market = marketOf(get().pool);
      set({ amount: text, usd: market ? usdOfCoin(market, get().intent, text) : '', reviewed: null, phase: 'idle', notice: null, target: { kind: 'place' } });
    },
    // Dollars in, the coin out: what is signed is the coin at the venue's price as typed, rounded down.
    setUsd: (text) => {
      if (LIMIT_BUSY.has(get().phase)) return;
      const market = marketOf(get().pool);
      ticket += 1;
      set({ usd: text, amount: market ? coinOfUsd(market, get().intent, text) : '', reviewed: null, phase: 'idle', notice: null, target: { kind: 'place' } });
    },
    setUnit: (unit) => {
      if (LIMIT_BUSY.has(get().phase)) return;
      set({ unit });
    },
    loadStates: async (owner) => {
      const answer = await limitEnv().engine.admit(owner);
      if (answer.ok && (answer.value.place === 'on' || answer.value.place === 'off')) set({ states: { owner, value: answer.value } });
      else set({ states: { owner, value: { place: 'off', exit: 'off', ceilingUsd: null, stopped: false } } });
    },
    loadOrders: async (owner) => {
      const kept = get().orders;
      if (!(kept?.owner === owner && kept.value.status === 'ready')) set({ orders: { owner, value: { status: 'loading' } } });
      const answer = await limitEnv().engine.orders(owner);
      if (answer.ok && answer.value.owner === owner && Array.isArray(answer.value.orders)) set({ orders: { owner, value: { status: 'ready', value: answer.value.orders, at: limitEnv().now() } } });
      else if (!(kept?.owner === owner && kept.value.status === 'ready')) set({ orders: { owner, value: { status: 'error' } } });
    },

    prepare: async (connection, target, holdings) => {
      if (LIMIT_BUSY.has(get().phase)) return;
      const asked = keyFor(connection.address, target, holdings);
      if (!asked) return;
      const mine = ++ticket;
      const kept = get().reviewed?.key === asked.key ? get().reviewed : null;
      set({ target, notice: null, outcome: null, reviewed: kept });
      hold('reviewing');
      const answer = await limitEnv().engine.review(asked.body);
      if (mine !== ticket) return;
      if (!answer.ok) {
        set({ reviewed: null, notice: { tone: 'error', text: limitFailure(answer.failure.code) } });
        return hold('idle');
      }
      const reviewed: LimitReviewed = { key: asked.key, body: asked.body, review: answer.value, at: limitEnv().now() };
      const pool = get().pool;
      set({ reviewed, ...(target.kind === 'place' && pool ? { costs: { pool, value: limitCosts(answer.value) } } : {}) });
      hold('idle');
      // The Review's own costs can raise the minimum past the amount on screen: then it is not offered for signing.
      if (target.kind === 'place' && keyFor(connection.address, target, holdings)?.key !== asked.key) set({ reviewed: null });
    },

    confirm: async (connection, holdings) => {
      const st = get();
      const target = st.target;
      if (!target || LIMIT_BUSY.has(st.phase)) return;
      const asked = keyFor(connection.address, target, holdings);
      const reviewed = asked && st.reviewed?.key === asked.key ? st.reviewed : null;
      const e = limitEnv();
      if (!reviewed || !reviewFresh(reviewed.review, reviewed.at, e.now())) {
        await get().prepare(connection, target, holdings);
        return;
      }
      const mine = ++ticket;
      hold('wallet');
      const sign = e.sign(connection);
      const outcome = await signAndSend(reviewed.review, reviewed.at, {
        engine: e.engine,
        now: e.now,
        sleep: e.sleep,
        sign: async (unsigned) => {
          const signed = await sign(unsigned);
          if (signed.ok && mine === ticket) hold('sending');
          return signed;
        },
      });
      if (mine !== ticket) return;
      if (outcome.kind === 'aged') {
        set({ reviewed: null });
        hold('idle');
        await get().prepare(connection, target, holdings);
        return;
      }
      if (outcome.kind === 'refused') {
        set({ notice: { tone: 'error', text: limitFailure(outcome.code) }, ...(outcome.code === 'WALLET_REFUSED' ? {} : { reviewed: null }) });
        return hold('idle');
      }
      const done = target.kind === 'place' ? 'place' : target.kind === 'roll' ? 'roll' : 'cancel';
      set({ outcome, reviewed: null, done });
      hold(outcome.kind);
      if (outcome.kind === 'done' || outcome.kind === 'partial') {
        if (target.kind !== 'cancel' && outcome.kind === 'done') remember(connection.address, reviewed);
        // «Set it again»: the taken order's price per unit and what it held come back to the card.
        if (target.kind === 'cancel' && target.replace && outcome.kind === 'done') {
          const market = marketOfOrder(target.order);
          const record = placedOf(connection.address).get(target.order.address) ?? null;
          if (market && record) set({ pool: market.pool, intent: record.intent, price: priceField(record.target) });
        }
        e.after(connection.address);
        void get().loadOrders(connection.address);
      }
    },

    recheck: async (owner) => {
      const outcome = get().outcome;
      if (outcome?.kind !== 'unknown' || LIMIT_BUSY.has(get().phase)) return;
      const mine = ++ticket;
      hold('sending');
      const e = limitEnv();
      const relay = await follow(
        { results: outcome.signatures.map((signature) => ({ signature, state: 'UNKNOWN' as const, reason: null })), settled: false },
        { engine: e.engine, now: e.now, sleep: e.sleep, sign: async () => ({ ok: false }), followMs: 20_000 },
      );
      if (mine !== ticket) return;
      const next = outcomeOf(relay);
      set({ outcome: next });
      hold(next.kind === 'aged' || next.kind === 'refused' ? 'idle' : next.kind);
      if (next.kind === 'done' || next.kind === 'partial') {
        e.after(owner);
        void get().loadOrders(owner);
      }
    },

    again: () => {
      if (LIMIT_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ phase: 'idle', outcome: null, reviewed: null, notice: null, done: null, target: { kind: 'place' }, ...(get().done === 'place' ? { amount: '', usd: '' } : {}) });
    },

    forget: () => {
      if (LIMIT_BUSY.has(get().phase)) {
        set({ states: null });
        return;
      }
      ticket += 1;
      set({ states: null, orders: null, reviewed: null, phase: 'idle', outcome: null, notice: null, done: null, target: { kind: 'place' } });
    },
  };
});

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __limit: useLimit });
