import { create } from 'zustand';
import type { PositionView } from '../../../lib/liquidity/catalog/positions.ts';
import type { LiquidityReview, ZapReview } from '../../../lib/liquidity/studio/actions.ts';
import { citySigner } from '../app-bridge/route.ts';
import { claimBody, exitBody, type ReviewBody } from '../districts/harbor/deposit.ts';
import { follow, outcomeOf, reviewFresh, signAndSend, type ActionOutcome, type SignMany } from '../districts/harbor/flow.ts';
import { VENUE_OF, type HarborPool } from '../districts/harbor/pools.ts';
import { failureWords } from '../districts/harbor/review.ts';
import type { Holdings } from '../trade/wallet.ts';
import { useEarn } from './open.ts';
import {
  DEFAULT_STYLE,
  pierCosts,
  pierMinimum,
  pierOf,
  pierRestBody,
  pierSplit,
  pierZapBody,
  PIER_RESERVE_LAMPORTS,
  solUsd,
  zapFit,
  zapMax,
  type Pier,
  type PierCosts,
  type PierRestBody,
  type PierSplit,
  type PierStyle,
  type PierZapBody,
} from './pier.ts';
import { createPierEngine, type PierEngine } from './pier-engine.ts';
import type { PierStates } from './pier-gate.ts';
import { closesOf } from './pier-history.ts';
import { lamportsFromText } from './saver.ts';
import { earnWords } from './words.ts';

/**
 * The SOL Pier's state in the Earn window (CITY-93): the pier open on the Piers tab with its style and its amount in
 * SOL, the boat open (a position, to take its fees or leave), what the city and the engine let this wallet do, the
 * engine's Review of exactly what is on screen, and where an action is. A Review is built as soon as a wallet is here
 * and admitted, so every figure the person signs stands on the card before the one amber tap; a tap on a Review too
 * old to sign builds it again and shows it first. While the wallet signs or bytes are on their way, the window holds.
 *
 * CITY-198: a pier takes SOL alone. The add is the engine's Zap — the swap of the part the other coin needs and the
 * deposit, in one approval of the wallet (several transactions signed together). When only part of it lands, the card
 * says so plainly and offers «Take back as SOL»: one more approval, and what the Zap left in the wallet comes back.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;

export type PierPhase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'partial' | 'failed' | 'unknown';
export const PIER_BUSY: ReadonlySet<PierPhase> = new Set(['reviewing', 'wallet', 'sending']);
/** Only a signature in the wallet or bytes on their way hold the window; a Review being built never does. */
export const PIER_LOCKED: ReadonlySet<PierPhase> = new Set(['wallet', 'sending']);

export type PierTarget = Readonly<{ kind: 'add' }> | Readonly<{ kind: 'claim' | 'exit'; position: PositionView }>;
export type PierBody = ReviewBody | PierZapBody | PierRestBody;
export type PierReviewed = Readonly<{ key: string; body: PierBody; review: LiquidityReview | ZapReview; at: number }>;

const isZapBody = (body: PierBody): body is PierZapBody | PierRestBody => body.action === 'zap_in' || body.action === 'zap_rest';

/** A pool action's own Review (a boat's fees or exit) when the reviewed action is one; null for a Zap. */
export function poolReviewOf(reviewed: PierReviewed | null): LiquidityReview | null {
  return reviewed && !isZapBody(reviewed.body) ? (reviewed.review as LiquidityReview) : null;
}

/** The Zap's own Review when the reviewed action is one; null otherwise. */
export function zapReviewOf(reviewed: PierReviewed | null): ZapReview | null {
  return reviewed && isZapBody(reviewed.body) ? (reviewed.review as ZapReview) : null;
}

/** «Take the rest» after a Zap that landed in part: its own Review, where it is, and how it ended. */
export type PierRest = Readonly<{ reviewed: PierReviewed | null; outcome: ActionOutcome | null; notice: PierNotice | null }>;
export type PierNotice = Readonly<{ tone: 'warn' | 'error'; text: string }>;

export type Loaded<T> = Readonly<{ status: 'loading' }> | Readonly<{ status: 'ready'; value: T; at: number }> | Readonly<{ status: 'error' }>;

export type PierProblem = 'format' | 'min' | 'ceiling' | 'sol';

export type PierChoice = Readonly<{
  lamports: bigint | null;
  /** The even split the Zap aims at, for the eye before the Review says exactly what goes in. */
  split: PierSplit | null;
  /** The wallet holds the SOL and what is kept aside; true while it is not read. */
  fits: boolean;
  minimum: bigint;
  /** The most this wallet may put in now under the ceiling, lamports; null when no ceiling is known. */
  ceiling: bigint | null;
  max: bigint | null;
  problem: PierProblem | null;
  /** The Review's key for this exact choice, or null when it cannot be asked. */
  key: string | null;
}>;

/** A little under the dollar ceiling, so the venue's own prices at the Review never land just above it. */
const CEILING_MARGIN = 0.98;

/**
 * What the card stands on for a typed amount of SOL: whether the wallet holds it with the SOL kept aside, the live
 * minimum (from the Review's costs once there is one) and the ceiling this wallet has now. The wallet needs no other coin.
 */
export function pierChoice(pier: Pier, style: PierStyle, typed: string, holdings: Holdings | null, owner: string | null, ceilingUsd: number | null, costs: PierCosts | null): PierChoice {
  const lamports = lamportsFromText(typed);
  const price = solUsd(pier);
  const ceiling = ceilingUsd !== null && price !== null ? BigInt(Math.floor((ceilingUsd * CEILING_MARGIN * 1e9) / price)) : null;
  const floor = pierMinimum(costs);
  // Under a small ceiling (the canary's) the minimum never shuts the door: it stays within half of it.
  const minimum = ceiling !== null && floor * 2n > ceiling ? ceiling / 2n : floor;
  const reserve = costs ? costs.total : PIER_RESERVE_LAMPORTS;
  const split = lamports ? pierSplit(pier, lamports) : null;
  const fits = zapFit(lamports, holdings, reserve);
  const held = zapMax(holdings, reserve);
  const max = held !== null && ceiling !== null ? (held < ceiling ? held : ceiling) : (held ?? ceiling);
  let problem: PierProblem | null = null;
  if (!lamports || !split) problem = 'format';
  else if (lamports < minimum) problem = 'min';
  else if (ceiling !== null && lamports > ceiling) problem = 'ceiling';
  else if (!fits) problem = 'sol';
  const key = owner && lamports && !problem ? `zap:${owner}:${pier.pool.address}:${style}:${lamports}` : null;
  return { lamports, split, fits, minimum, ceiling, max, problem, key };
}

export function targetKey(owner: string, target: Exclude<PierTarget, { kind: 'add' }>): string {
  return `${target.kind}:${owner}:${target.position.address}`;
}

/** A position that landed through the city, for «Like the Captain»'s ledger (CITY-99): the chain is asked, not believed. */
export type LandedAdd = Readonly<{ owner: string; position: string; pool: string; style: PierStyle }>;

export type PierEnv = Readonly<{
  engine: PierEngine;
  /** After an add landed: the city tells the ledger, which holds it to the chain before it counts. Never awaited. */
  report: (landed: LandedAdd) => void;
  sign: (connection: Connection) => SignMany;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** After an action: the wallet's coins and positions are read again, for an RPC that lags. */
  after: (owner: string) => void;
}>;

let env: PierEnv | null = null;
/** The ledger's door. A refusal or a silence changes nothing on the card: the position is simply not counted as a copy. */
function reportLanded(landed: LandedAdd): void {
  if (typeof window === 'undefined') return;
  void fetch('/api/city/earn/captain/copies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(landed), credentials: 'same-origin' }).catch(() => undefined);
}

const browserEnv = (): PierEnv => ({
  engine: createPierEngine(),
  report: reportLanded,
  sign: (connection) => async (unsigned) => {
    const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: unsigned, chain: 'solana:mainnet' });
    return signed.ok ? { ok: true, signed: signed.signedWireBase64 } : { ok: false };
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  after: () => undefined,
});
const pierEnv = (): PierEnv => (env ??= browserEnv());

/** Tests and the window put their own reach here. */
export function setPierEnv(next: Partial<PierEnv>): void {
  env = { ...pierEnv(), ...next };
}

/** The engine's and the city's refusals in the window's words; the Harbor's words for the engine's own codes. */
export function pierFailure(code: string): string {
  const own = earnWords().pier.failures as Readonly<Record<string, string>>;
  return Object.hasOwn(own, code) ? own[code]! : failureWords(code);
}

/** Candles kept a few minutes: the picture is of the month gone, it does not move by the minute. */
const CANDLES_MS = 5 * 60_000;

/** A strategy of «Like the Captain» being copied: its recipe's style is fixed on the card. */
export type PierCopy = Readonly<{ strategy: string; style: PierStyle }>;

type Store = {
  pool: HarborPool | null;
  style: PierStyle;
  copy: PierCopy | null;
  typed: string;
  boat: PositionView | null;
  states: Readonly<{ owner: string; value: PierStates }> | null;
  reviewed: PierReviewed | null;
  /** The last add Review's costs for the open pier: they set the live minimum and the SOL kept aside. */
  costs: Readonly<{ pool: string; value: PierCosts }> | null;
  target: PierTarget | null;
  phase: PierPhase;
  outcome: ActionOutcome | null;
  sent: PierReviewed | null;
  notice: PierNotice | null;
  /** «Take the rest» of the Zap last sent, when it landed in part. */
  rest: PierRest | null;
  candles: Readonly<Record<string, Loaded<ReadonlyMap<number, number>>>>;
  openPier: (pool: HarborPool) => void;
  /** The same card on a strategy's pier, its style fixed (CITY-99). */
  openCopy: (pool: HarborPool, copy: PierCopy) => void;
  openBoat: (position: PositionView) => void;
  /** Back to the list: never while a signature is out. */
  back: () => void;
  setStyle: (style: PierStyle) => void;
  setTyped: (text: string) => void;
  loadStates: (owner: string) => Promise<void>;
  loadCandles: (mint: string) => Promise<void>;
  prepare: (connection: Connection, target: PierTarget, holdings: Holdings | null) => Promise<void>;
  confirm: (connection: Connection, holdings: Holdings | null) => Promise<void>;
  recheck: (owner: string) => Promise<void>;
  /** Build «Take the rest» for the Zap that landed in part, while the card says what happened. */
  prepareRest: (connection: Connection) => Promise<void>;
  /** The one action of a half-landed Zap: sign «Take the rest», or build it first. */
  takeRest: (connection: Connection) => Promise<void>;
  again: () => void;
  forget: () => void;
};

let ticket = 0;
const START_TEXT = '1';

export const usePier = create<Store>((set, get) => {
  const hold = (phase: PierPhase) => {
    set({ phase });
    useEarn.getState().setBusy(PIER_LOCKED.has(phase));
  };
  const keyFor = (owner: string, target: PierTarget, holdings: Holdings | null): Readonly<{ key: string; body: PierBody }> | null => {
    const st = get();
    if (target.kind !== 'add') {
      const venue = VENUE_OF[target.position.kind];
      const body = target.kind === 'claim' ? claimBody(venue, target.position.address, owner) : exitBody(venue, target.position.address, owner);
      return { key: targetKey(owner, target), body };
    }
    const pier = st.pool ? pierOf(st.pool) : null;
    if (!pier) return null;
    const states = st.states?.owner === owner ? st.states.value : null;
    if (!states || states.add !== 'on') return null;
    const costs = st.costs?.pool === pier.pool.address ? st.costs.value : null;
    const choice = pierChoice(pier, st.style, st.typed, holdings, owner, states.ceilingUsd, costs);
    if (!choice.key || !choice.split) return null;
    return { key: choice.key, body: pierZapBody(pier, owner, choice.lamports!, st.style) };
  };

  return {
    pool: null,
    style: DEFAULT_STYLE,
    copy: null,
    typed: START_TEXT,
    boat: null,
    states: null,
    reviewed: null,
    costs: null,
    target: null,
    phase: 'idle',
    outcome: null,
    sent: null,
    notice: null,
    rest: null,
    candles: {},

    openPier: (pool) => {
      if (PIER_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ pool, copy: null, boat: null, target: { kind: 'add' }, reviewed: null, phase: 'idle', outcome: null, notice: null, rest: null, ...(get().costs?.pool === pool.address ? {} : { costs: null }) });
      const pier = pierOf(pool);
      if (pier) {
        void get().loadCandles(pier.sol.mint);
        if (pier.pair === 'lst') void get().loadCandles(pier.other.mint);
      }
    },
    openCopy: (pool, copy) => {
      if (PIER_BUSY.has(get().phase) || !pierOf(pool)) return;
      ticket += 1;
      set({ pool, copy, style: copy.style, boat: null, target: { kind: 'add' }, reviewed: null, phase: 'idle', outcome: null, notice: null, rest: null, ...(get().costs?.pool === pool.address ? {} : { costs: null }) });
    },
    openBoat: (position) => {
      if (PIER_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ boat: position, pool: null, copy: null, target: null, reviewed: null, phase: 'idle', outcome: null, notice: null, rest: null });
    },
    back: () => {
      if (PIER_LOCKED.has(get().phase)) return;
      ticket += 1;
      useEarn.getState().setBusy(false);
      set({ pool: null, copy: null, boat: null, target: null, reviewed: null, phase: 'idle', outcome: null, notice: null, rest: null });
    },
    setStyle: (style) => {
      // A copy is its recipe: the style is the strategy's own.
      if (PIER_BUSY.has(get().phase) || get().copy) return;
      ticket += 1;
      set({ style, reviewed: null, phase: 'idle', notice: null });
    },
    setTyped: (text) => {
      if (PIER_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ typed: text, reviewed: null, phase: 'idle', notice: null });
    },
    loadStates: async (owner) => {
      const answer = await pierEnv().engine.admit(owner);
      if (answer.ok && (answer.value.add === 'on' || answer.value.add === 'off')) set({ states: { owner, value: answer.value } });
      else set({ states: { owner, value: { add: 'off', exit: 'off', ceilingUsd: null, stopped: false } } });
    },
    loadCandles: async (mint) => {
      const kept = get().candles[mint];
      if (kept && (kept.status === 'loading' || (kept.status === 'ready' && pierEnv().now() - kept.at < CANDLES_MS))) return;
      set({ candles: { ...get().candles, [mint]: { status: 'loading' } } });
      const answer = await pierEnv().engine.candles(mint);
      const closes = answer.ok ? closesOf(answer.value) : null;
      set({ candles: { ...get().candles, [mint]: closes && closes.size ? { status: 'ready', value: closes, at: pierEnv().now() } : { status: 'error' } } });
    },

    prepare: async (connection, target, holdings) => {
      if (PIER_BUSY.has(get().phase)) return;
      const asked = keyFor(connection.address, target, holdings);
      if (!asked) return;
      const mine = ++ticket;
      const kept = get().reviewed?.key === asked.key ? get().reviewed : null;
      set({ target, notice: null, outcome: null, reviewed: kept });
      hold('reviewing');
      const engine = pierEnv().engine;
      const answer = isZapBody(asked.body) ? await engine.zap(asked.body) : await engine.review(asked.body);
      if (mine !== ticket) return;
      if (!answer.ok) {
        set({ reviewed: null, notice: { tone: 'error', text: pierFailure(answer.failure.code) } });
        return hold('idle');
      }
      const reviewed: PierReviewed = { key: asked.key, body: asked.body, review: answer.value, at: pierEnv().now() };
      const pool = get().pool;
      set({ reviewed, ...(target.kind === 'add' && pool ? { costs: { pool: pool.address, value: pierCosts(answer.value) } } : {}) });
      hold('idle');
      // The Review's own costs can raise the live minimum past the amount on screen: then it is not offered for signing,
      // and the costs it read stay, so the card says the new minimum instead of asking again.
      if (target.kind === 'add' && keyFor(connection.address, target, holdings)?.key !== asked.key) set({ reviewed: null });
    },

    confirm: async (connection, holdings) => {
      const st = get();
      const target = st.target;
      if (!target || PIER_BUSY.has(st.phase)) return;
      const asked = keyFor(connection.address, target, holdings);
      const reviewed = asked && st.reviewed?.key === asked.key ? st.reviewed : null;
      const e = pierEnv();
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
        set({ notice: { tone: 'error', text: pierFailure(outcome.code) }, ...(outcome.code === 'WALLET_REFUSED' ? {} : { reviewed: null }) });
        return hold('idle');
      }
      set({ outcome, sent: reviewed, reviewed: null, rest: null });
      hold(outcome.kind);
      if (outcome.kind === 'done' || outcome.kind === 'partial') {
        e.after(connection.address);
        const pool = get().pool;
        // A Zap's position exists only once its last transaction landed: a part of it is no copy.
        if (target.kind === 'add' && pool && (outcome.kind === 'done' || !isZapBody(reviewed.body))) e.report({ owner: connection.address, position: reviewed.review.position, pool: pool.address, style: get().style });
      }
    },

    recheck: async (owner) => {
      const outcome = get().outcome;
      if (outcome?.kind !== 'unknown' || PIER_BUSY.has(get().phase)) return;
      const mine = ++ticket;
      hold('sending');
      const e = pierEnv();
      const relay = await follow(
        { results: outcome.signatures.map((signature) => ({ signature, state: 'UNKNOWN' as const, reason: null })), settled: false },
        { engine: e.engine, now: e.now, sleep: e.sleep, sign: async () => ({ ok: false }), followMs: 20_000 },
      );
      if (mine !== ticket) return;
      const next = outcomeOf(relay);
      set({ outcome: next });
      hold(next.kind === 'aged' || next.kind === 'refused' ? 'idle' : next.kind);
      if (next.kind === 'done' || next.kind === 'partial') e.after(owner);
    },

    prepareRest: async (connection) => {
      const st = get();
      const zapped = st.outcome?.kind === 'partial' ? zapReviewOf(st.sent) : null;
      if (!zapped || zapped.preview.action !== 'zap_in' || PIER_BUSY.has(st.phase) || st.rest?.outcome?.kind === 'done') return;
      const body = pierRestBody(zapped.preview.pool, connection.address, zapped.preview.otherBefore);
      const key = `rest:${connection.address}:${zapped.preview.pool}:${zapped.preview.otherBefore}`;
      const mine = ++ticket;
      set({ rest: { reviewed: null, outcome: null, notice: null } });
      const answer = await pierEnv().engine.zap(body);
      if (mine !== ticket) return;
      if (!answer.ok) return set({ rest: { reviewed: null, outcome: null, notice: { tone: 'error', text: pierFailure(answer.failure.code) } } });
      set({ rest: { reviewed: { key, body, review: answer.value, at: pierEnv().now() }, outcome: null, notice: null } });
    },

    takeRest: async (connection) => {
      const st = get();
      const kept = st.rest?.reviewed ?? null;
      const e = pierEnv();
      if (PIER_BUSY.has(st.phase) || st.rest?.outcome?.kind === 'done') return;
      if (!kept || !reviewFresh(kept.review, kept.at, e.now())) return get().prepareRest(connection);
      const mine = ++ticket;
      hold('wallet');
      const sign = e.sign(connection);
      const outcome = await signAndSend(kept.review, kept.at, {
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
      hold('partial');
      if (outcome.kind === 'aged') return get().prepareRest(connection);
      if (outcome.kind === 'refused') return set({ rest: { reviewed: outcome.code === 'WALLET_REFUSED' ? kept : null, outcome: null, notice: { tone: 'error', text: pierFailure(outcome.code) } } });
      set({ rest: { reviewed: null, outcome, notice: null } });
      if (outcome.kind === 'done' || outcome.kind === 'partial') e.after(connection.address);
    },

    again: () => {
      if (PIER_BUSY.has(get().phase)) return;
      const st = get();
      ticket += 1;
      // A partly landed add already opened a position: a new Review of the whole amount could open a second one.
      if (st.outcome?.kind === 'partial' || st.outcome?.kind === 'done' || st.target?.kind !== 'add') {
        set({ pool: null, copy: null, boat: null, target: null, reviewed: null, phase: 'idle', outcome: null, notice: null, rest: null });
        return;
      }
      set({ phase: 'idle', outcome: null, reviewed: null, notice: null });
    },

    forget: () => {
      if (PIER_BUSY.has(get().phase)) {
        set({ states: null });
        return;
      }
      ticket += 1;
      set({ states: null, reviewed: null, phase: 'idle', outcome: null, notice: null, rest: null, boat: null, target: get().pool ? { kind: 'add' } : null });
    },
  };
});

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __pier: usePier });
