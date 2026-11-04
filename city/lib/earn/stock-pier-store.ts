import { create } from 'zustand';
import type { PositionView } from '../../../lib/liquidity/catalog/positions.ts';
import { citySigner } from '../app-bridge/route.ts';
import { claimBody, exitBody } from '../districts/harbor/deposit.ts';
import { follow, outcomeOf, reviewFresh, signAndSend, type ActionOutcome, type SignMany } from '../districts/harbor/flow.ts';
import { failureWords } from '../districts/harbor/review.ts';
import type { Holdings } from '../trade/wallet.ts';
import { keepPlan, plansOf } from './device.ts';
import { useEarn } from './open.ts';
import { createStockPierEngine, type ExitBody, type StockPierEngine, type StockReview } from './stock-pier-engine.ts';
import { CLOSED_STATES, type StockPierStates } from './stock-pier-gate.ts';
import { DEFAULT_PLAN, dividendGuard, type ClosePlan } from './stock-pier-hours.ts';
import {
  DEFAULT_QUOTE,
  QUOTE,
  STOCK_BUILD_RESERVE_LAMPORTS,
  STOCK_MOOR_RESERVE_LAMPORTS,
  depositUsdOf,
  quoteUnitsFromText,
  stockBuildBody,
  stockFit,
  stockMax,
  stockMinimum,
  stockSplit,
  type StockBuildBody,
  type StockFit,
  type StockPair,
  type StockPierList,
  type StockQuote,
  type StockSplit,
} from './stock-pier.ts';
import { earnWords } from './words.ts';

/**
 * The Stock Pier's state in the Earn window (CITY-98): the verified pairs, the stock and the quote coin chosen, the
 * amount, the plan for the exchange's close, what the city and the engine let this wallet do, the engine's Review of
 * exactly what is on screen, and where an action is — building the pier (or mooring beside it), taking a boat's fees,
 * leaving. A Review is built as soon as a wallet is here and admitted, so every figure the person signs stands on the
 * card before the one amber tap; one too old to sign is built again and shown first. While the wallet signs or bytes
 * travel, the window holds.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;
export type Loaded<T> = Readonly<{ status: 'loading' }> | Readonly<{ status: 'ready'; value: T; at: number }> | Readonly<{ status: 'error' }>;

export type StockPhase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'partial' | 'failed' | 'unknown';
export const STOCK_BUSY: ReadonlySet<StockPhase> = new Set(['reviewing', 'wallet', 'sending']);
export const STOCK_LOCKED: ReadonlySet<StockPhase> = new Set(['wallet', 'sending']);

export type StockTarget = Readonly<{ kind: 'build' }> | Readonly<{ kind: 'claim' | 'exit'; position: PositionView }>;
export type StockReviewed = Readonly<{
  key: string;
  review: StockReview;
  at: number;
}>;
export type StockNotice = Readonly<{ tone: 'warn' | 'error'; text: string }>;
export type StockProblem = 'format' | 'min' | 'ceiling' | 'quote' | 'stock' | 'dividend';

export type StockChoice = Readonly<{
  worth: bigint | null;
  split: StockSplit | null;
  fit: StockFit;
  minimum: bigint;
  /** The most worth this wallet may put in now under the ceiling, quote base units; null when none is known. */
  ceiling: bigint | null;
  max: bigint | null;
  problem: StockProblem | null;
  key: string | null;
}>;

/** A little under the dollar ceiling, so the prices at the Review never land just above it. */
const CEILING_MARGIN = 0.98;
const START: Readonly<Record<StockQuote, string>> = { sol: '1', usdc: '150' };

/**
 * What the card stands on for a typed amount: the split, whether the wallet holds it, the live minimum (from the
 * Review's costs once there is one), the ceiling this wallet has now, and whether a corporate step holds new money.
 */
export function stockChoice(
  pair: StockPair,
  quote: StockQuote,
  typed: string,
  holdings: Holdings | null,
  owner: string | null,
  ceilingUsd: number | null,
  quoteUsd: Readonly<Record<StockQuote, number | null>>,
  lostLamports: bigint | null,
  nowMs: number,
): StockChoice {
  const q = quoteUsd[quote];
  const worth = quoteUnitsFromText(typed, quote);
  const builds = !pair.piers[quote].built;
  const reserve = builds ? STOCK_BUILD_RESERVE_LAMPORTS : STOCK_MOOR_RESERVE_LAMPORTS;
  const ceiling = ceilingUsd !== null && q !== null ? BigInt(Math.floor(((ceilingUsd * CEILING_MARGIN) / q) * 10 ** QUOTE[quote].decimals)) : null;
  const floor = stockMinimum(builds ? lostLamports : null, quote, quoteUsd.sol);
  // Under a small ceiling (the canary's) the minimum never shuts the door: it stays within half of it.
  const minimum = ceiling !== null && floor * 2n > ceiling ? ceiling / 2n : floor;
  const split = worth ? stockSplit(pair, quote, q, worth) : null;
  const fit = stockFit(pair, quote, split, holdings, reserve);
  const held = stockMax(pair, quote, q, holdings, reserve);
  const max = held !== null && ceiling !== null ? (held < ceiling ? held : ceiling) : (held ?? ceiling);
  let problem: StockProblem | null = null;
  if (dividendGuard(pair.step, nowMs).kind === 'hold') problem = 'dividend';
  else if (!worth || !split) problem = 'format';
  else if (worth < minimum) problem = 'min';
  else if (ceiling !== null && worth > ceiling) problem = 'ceiling';
  else if (!fit.fits) problem = fit.short;
  const key = owner && worth && split && !problem ? `build:${owner}:${pair.mint}:${quote}:${worth}` : null;
  return { worth, split, fit, minimum, ceiling, max, problem, key };
}

export function targetKey(owner: string, target: Exclude<StockTarget, { kind: 'build' }>): string {
  return `${target.kind}:${owner}:${target.position.address}`;
}

/** What never comes back from a build's Review: the pool's own accounts and the network, lamports. */
export function lostOf(review: StockReview): bigint {
  let lost = /^\d+$/.test(review.networkFeeLamports) ? BigInt(review.networkFeeLamports) : 0n;
  for (const row of review.preview.rent) if (row.direction === 'pay' && !row.refundable && /^\d+$/.test(row.lamports)) lost += BigInt(row.lamports);
  return lost;
}

export type StockEnv = Readonly<{
  engine: StockPierEngine;
  sign: (connection: Connection) => SignMany;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  after: (owner: string) => void;
}>;

let env: StockEnv | null = null;
const browserEnv = (): StockEnv => ({
  engine: createStockPierEngine(),
  sign: (connection) => async (unsigned) => {
    const signed = await citySigner.signTransactions({
      wallet: connection.wallet,
      address: connection.address,
      unsignedWireBase64: unsigned,
      chain: 'solana:mainnet',
    });
    return signed.ok ? { ok: true, signed: signed.signedWireBase64 } : { ok: false };
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  after: () => undefined,
});
const stockEnv = (): StockEnv => (env ??= browserEnv());

/** Tests and the window put their own reach here. */
export function setStockEnv(next: Partial<StockEnv>): void {
  env = { ...stockEnv(), ...next };
}

/** The door's and the engine's refusals in the window's words. */
export function stockFailure(code: string): string {
  const own = earnWords().stock.failures as Readonly<Record<string, string>>;
  return Object.hasOwn(own, code) ? own[code]! : failureWords(code);
}

type Store = {
  list: Loaded<StockPierList> | null;
  mint: string | null;
  quote: StockQuote;
  typed: string;
  /** The plan for the close chosen on the card; kept for the pier once it is built or moored. */
  plan: ClosePlan;
  plans: Readonly<{
    owner: string;
    value: ReadonlyMap<string, ClosePlan>;
  }> | null;
  states: Readonly<{ owner: string; value: StockPierStates }> | null;
  reviewed: StockReviewed | null;
  costs: Readonly<{ pool: string; lost: bigint }> | null;
  target: StockTarget | null;
  boat: PositionView | null;
  phase: StockPhase;
  outcome: ActionOutcome | null;
  /** What the last outcome was of: a build, a mooring, fees, or leaving. */
  done: Readonly<{
    kind: 'build' | 'moor' | 'claim' | 'exit';
    pool: string | null;
  }> | null;
  notice: StockNotice | null;
  load: () => Promise<void>;
  choose: (mint: string) => void;
  setQuote: (quote: StockQuote) => void;
  setTyped: (text: string) => void;
  setPlan: (plan: ClosePlan) => void;
  /** The plan of a pier the wallet is in, changed from its boat. */
  keepBoatPlan: (owner: string, pool: string, plan: ClosePlan) => void;
  loadStates: (owner: string) => Promise<void>;
  openBoat: (position: PositionView) => void;
  back: () => void;
  prepare: (connection: Connection, target: StockTarget, holdings: Holdings | null) => Promise<void>;
  confirm: (connection: Connection, holdings: Holdings | null) => Promise<void>;
  recheck: (owner: string) => Promise<void>;
  again: () => void;
  forget: () => void;
};

let ticket = 0;

export const useStockPier = create<Store>((set, get) => {
  const hold = (phase: StockPhase) => {
    set({ phase });
    useEarn.getState().setBusy(STOCK_LOCKED.has(phase));
  };
  const pairNow = (): StockPair | null => {
    const st = get();
    const list = st.list?.status === 'ready' ? st.list.value : null;
    return list?.pairs.find((p) => p.mint === st.mint) ?? list?.pairs[0] ?? null;
  };
  const asked = (owner: string, target: StockTarget, holdings: Holdings | null): Readonly<{ key: string; body: StockBuildBody | ExitBody }> | null => {
    if (target.kind !== 'build') {
      const body = (target.kind === 'claim' ? claimBody('meteora-damm2', target.position.address, owner) : exitBody('meteora-damm2', target.position.address, owner)) as ExitBody;
      return { key: targetKey(owner, target), body };
    }
    const st = get();
    const pair = pairNow();
    const list = st.list?.status === 'ready' ? st.list.value : null;
    const states = st.states?.owner === owner ? st.states.value : null;
    if (!pair || !list || !states || states.build !== 'on') return null;
    const lost = st.costs?.pool === pair.piers[st.quote].address ? st.costs.lost : null;
    const choice = stockChoice(pair, st.quote, st.typed, holdings, owner, states.ceilingUsd, list.quoteUsd, lost, stockEnv().now());
    if (!choice.key || !choice.split) return null;
    return {
      key: choice.key,
      body: stockBuildBody(pair, st.quote, owner, choice.split),
    };
  };

  return {
    list: null,
    mint: null,
    quote: DEFAULT_QUOTE,
    typed: START[DEFAULT_QUOTE],
    plan: DEFAULT_PLAN,
    plans: null,
    states: null,
    reviewed: null,
    costs: null,
    target: null,
    boat: null,
    phase: 'idle',
    outcome: null,
    done: null,
    notice: null,

    load: async () => {
      const kept = get().list;
      if (kept?.status === 'loading' || (kept?.status === 'ready' && stockEnv().now() - kept.at < 120_000)) return;
      if (kept?.status !== 'ready') set({ list: { status: 'loading' } });
      const answer = await stockEnv().engine.list();
      if (answer.ok)
        set({
          list: { status: 'ready', value: answer.value, at: stockEnv().now() },
        });
      else if (get().list?.status !== 'ready') set({ list: { status: 'error' } });
    },
    choose: (mint) => {
      if (STOCK_BUSY.has(get().phase)) return;
      ticket += 1;
      set({
        mint,
        reviewed: null,
        phase: 'idle',
        notice: null,
        outcome: null,
        target: { kind: 'build' },
      });
    },
    setQuote: (quote) => {
      if (STOCK_BUSY.has(get().phase) || quote === get().quote) return;
      ticket += 1;
      set({
        quote,
        typed: START[quote],
        reviewed: null,
        phase: 'idle',
        notice: null,
      });
    },
    setTyped: (text) => {
      if (STOCK_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ typed: text, reviewed: null, phase: 'idle', notice: null });
    },
    setPlan: (plan) => set({ plan }),
    keepBoatPlan: (owner, pool, plan) => set({ plans: { owner, value: keepPlan(owner, pool, plan) } }),
    loadStates: async (owner) => {
      set({ plans: { owner, value: plansOf(owner) } });
      const answer = await stockEnv().engine.admit(owner);
      set({
        states: {
          owner,
          value: answer.ok && (answer.value.build === 'on' || answer.value.build === 'off') ? answer.value : CLOSED_STATES,
        },
      });
    },
    openBoat: (position) => {
      if (STOCK_BUSY.has(get().phase)) return;
      ticket += 1;
      set({
        boat: position,
        target: null,
        reviewed: null,
        phase: 'idle',
        outcome: null,
        notice: null,
      });
    },
    back: () => {
      if (STOCK_LOCKED.has(get().phase)) return;
      ticket += 1;
      useEarn.getState().setBusy(false);
      set({
        boat: null,
        target: null,
        reviewed: null,
        phase: 'idle',
        outcome: null,
        notice: null,
      });
    },

    prepare: async (connection, target, holdings) => {
      if (STOCK_BUSY.has(get().phase)) return;
      const ask = asked(connection.address, target, holdings);
      if (!ask) return;
      const mine = ++ticket;
      const kept = get().reviewed?.key === ask.key ? get().reviewed : null;
      set({ target, notice: null, outcome: null, reviewed: kept });
      hold('reviewing');
      const answer = await stockEnv().engine.door(ask.body);
      if (mine !== ticket) return;
      if (!answer.ok) {
        set({
          reviewed: null,
          notice: { tone: 'error', text: stockFailure(answer.failure.code) },
        });
        return hold('idle');
      }
      const review = answer.value;
      set({
        reviewed: { key: ask.key, review, at: stockEnv().now() },
        ...(target.kind === 'build' && review.stockPier?.builds ? { costs: { pool: review.stockPier.pool, lost: lostOf(review) } } : {}),
      });
      hold('idle');
      // The Review's own costs can raise the live minimum past the amount on screen: then it is not offered for signing.
      if (target.kind === 'build' && asked(connection.address, target, holdings)?.key !== ask.key) set({ reviewed: null });
    },

    confirm: async (connection, holdings) => {
      const st = get();
      const target = st.target;
      if (!target || STOCK_BUSY.has(st.phase)) return;
      const ask = asked(connection.address, target, holdings);
      const reviewed = ask && st.reviewed?.key === ask.key ? st.reviewed : null;
      const e = stockEnv();
      if (!reviewed || !reviewFresh(reviewed.review, reviewed.at, e.now())) {
        await get().prepare(connection, target, holdings);
        if (get().reviewed) set({ notice: { tone: 'warn', text: earnWords().pier.fresh } });
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
        if (get().reviewed) set({ notice: { tone: 'warn', text: earnWords().pier.fresh } });
        return;
      }
      if (outcome.kind === 'refused') {
        set({
          notice: { tone: 'error', text: stockFailure(outcome.code) },
          ...(outcome.code === 'WALLET_REFUSED' ? {} : { reviewed: null }),
        });
        return hold('idle');
      }
      const pool = target.kind === 'build' ? (reviewed.review.stockPier?.pool ?? reviewed.review.preview.pool) : target.position.pool;
      const kind = target.kind === 'build' ? (reviewed.review.stockPier?.builds ? 'build' : 'moor') : target.kind;
      set({ outcome, reviewed: null, done: { kind, pool } });
      hold(outcome.kind);
      if (outcome.kind === 'done' || outcome.kind === 'partial') {
        // The plan chosen on the card is kept for the pier the person is now in.
        if (target.kind === 'build')
          set({
            plans: {
              owner: connection.address,
              value: keepPlan(connection.address, pool, get().plan),
            },
          });
        e.after(connection.address);
      }
    },

    recheck: async (owner) => {
      const outcome = get().outcome;
      if (outcome?.kind !== 'unknown' || STOCK_BUSY.has(get().phase)) return;
      const mine = ++ticket;
      hold('sending');
      const e = stockEnv();
      const relay = await follow(
        {
          results: outcome.signatures.map((signature) => ({
            signature,
            state: 'UNKNOWN' as const,
            reason: null,
          })),
          settled: false,
        },
        {
          engine: e.engine,
          now: e.now,
          sleep: e.sleep,
          sign: async () => ({ ok: false }),
          followMs: 20_000,
        },
      );
      if (mine !== ticket) return;
      const next = outcomeOf(relay);
      set({ outcome: next });
      hold(next.kind === 'aged' || next.kind === 'refused' ? 'idle' : next.kind);
      if (next.kind === 'done' || next.kind === 'partial') e.after(owner);
    },

    again: () => {
      if (STOCK_BUSY.has(get().phase)) return;
      ticket += 1;
      set({
        boat: null,
        target: null,
        reviewed: null,
        phase: 'idle',
        outcome: null,
        notice: null,
        done: null,
      });
    },

    forget: () => {
      if (STOCK_BUSY.has(get().phase)) {
        set({ states: null });
        return;
      }
      ticket += 1;
      set({
        states: null,
        plans: null,
        reviewed: null,
        phase: 'idle',
        outcome: null,
        notice: null,
        boat: null,
        target: null,
      });
    },
  };
});

/** Dollars a choice puts in, for the shelf's and the card's words. */
export function choiceUsd(pair: StockPair, quote: StockQuote, split: StockSplit | null, quoteUsd: Readonly<Record<StockQuote, number | null>>): number | null {
  return split ? depositUsdOf(pair, quote, quoteUsd[quote], split.stockUnits, split.quoteUnits) : null;
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __stockPier: useStockPier });
