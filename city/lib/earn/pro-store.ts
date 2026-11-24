import { create } from 'zustand';
import type { EarnProReviewRequest } from '../../../lib/api/v1/contract.ts';
import { MAX_SIGNABLE_WINDOW_MS } from '../../../lib/solana/blockhash-life.ts';
import { citySigner } from '../app-bridge/route.ts';
import { follow, outcomeOf, reviewFresh, signAndSend, type ActionOutcome, type SignMany, type SignableReview } from '../districts/harbor/flow.ts';
import type { Holdings } from '../trade/wallet.ts';
import { useEarn } from './open.ts';
import { DEFAULT_STYLE, type PierGoal, type PierStyle } from './pier.ts';
import { EARN_PRO_OPEN, proChoice, proDefaultGoal, type ProAction, type ProBoat, type ProGoal, type ProPier, type ProReview, type ProStop } from './pro.ts';
import { createProEngine, type ProEngine } from './pro-engine.ts';
import { earnWords } from './words.ts';

/**
 * The Pro piers' state in the Earn window: the piers read from the chain, the wallet's boats at them, the
 * pier or the boat that is open, the engine's Review of exactly what is on screen, and where an action is.
 *
 * The flow is the Harbor's own (`districts/harbor/flow.ts`): a Review is built while the card is read, the wallet
 * signs its transactions in one prompt, the engine's relay sends them once each and in order, and an answer that never
 * came back is asked of the chain — never sent again. While the wallet signs or bytes travel, the window holds.
 *
 * An opening from SOL alone is two transactions of one approval — the pool's swap, then «open and deposit». When only
 * the swap lands (the price left the band between the two), the card says so plainly: the coins are in the wallet,
 * and nothing was lost but the network's fee.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;

export type ProPhase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'partial' | 'failed' | 'unknown';
export const PRO_BUSY: ReadonlySet<ProPhase> = new Set(['reviewing', 'wallet', 'sending']);
export const PRO_LOCKED: ReadonlySet<ProPhase> = new Set(['wallet', 'sending']);

/** What the open card is about to do: an opening of the pier on screen, or one action on the boat on screen. */
export type ProTarget = Readonly<{ kind: 'open' }> | Readonly<{ kind: Exclude<ProAction, 'open'>; nftMint: string }>;

export type ProReviewed = Readonly<{ key: string; review: ProReview; at: number }>;
export type ProNotice = Readonly<{ tone: 'warn' | 'error'; text: string }>;
export type Loaded<T> = Readonly<{ status: 'idle' }> | Readonly<{ status: 'loading' }> | Readonly<{ status: 'ready'; value: T; at: number }> | Readonly<{ status: 'error' }> | Readonly<{ status: 'closed' }>;

export type ProList = Readonly<{ network: 'devnet' | 'mainnet'; piers: readonly ProPier[]; care: boolean }>;

/** A Review as the Harbor's flow reads one: its bytes, its ticket, and how long from arriving it may still be signed. */
export function signableOf(review: ProReview, receivedAt: number): SignableReview {
  const left = Date.parse(review.expiresAt) - receivedAt;
  return { transactions: review.transactions.map((wireBase64) => ({ wireBase64 })) as unknown as SignableReview['transactions'], ticket: review.ticket, signableMs: Math.max(0, Math.min(MAX_SIGNABLE_WINDOW_MS, Number.isFinite(left) ? left - 5_000 : 0)) };
}

export type ProEnv = Readonly<{
  engine: ProEngine;
  sign: (connection: Connection, network: 'devnet' | 'mainnet') => SignMany;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** After an action: the wallet's coins are read again. */
  after: (owner: string) => void;
}>;

let env: ProEnv | null = null;
const browserEnv = (): ProEnv => ({
  engine: createProEngine(),
  sign: (connection, network) => async (unsigned) => {
    const signed = await citySigner.signTransactions({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: unsigned, chain: `solana:${network}` });
    return signed.ok ? { ok: true, signed: signed.signedWireBase64 } : { ok: false };
  },
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  after: () => undefined,
});
const proEnv = (): ProEnv => (env ??= browserEnv());

/** Tests and the window put their own reach here. */
export function setProEnv(next: Partial<ProEnv>): void {
  env = { ...proEnv(), ...next };
}

/** The engine's refusals in the window's words. */
export function proFailure(code: string): string {
  const own = earnWords().pro.failures as Readonly<Record<string, string>>;
  return Object.hasOwn(own, code) ? own[code]! : own.UNAVAILABLE!;
}

const PIERS_FRESH_MS = 60_000;
const BOATS_FRESH_MS = 20_000;

type Store = {
  list: Loaded<ProList>;
  boats: Readonly<{ owner: string; value: Loaded<readonly ProBoat[]> }> | null;
  pier: ProPier | null;
  boat: ProBoat | null;
  style: PierStyle;
  /** What the person picked; null — the pier's own default. */
  goal: ProGoal | null;
  /** The person's own grid in place of the goal (the terminal's ticket): 32 columns of 0 to 8 cells; null — the goal stands. */
  shape: readonly number[] | null;
  typed: string;
  /** The stop a care is given, percent under the price now; 0 — none. */
  stop: ProStop;
  target: ProTarget | null;
  reviewed: ProReviewed | null;
  phase: ProPhase;
  outcome: ActionOutcome | null;
  /** What was sent, kept while the card says how it ended. */
  sent: ProReviewed | null;
  notice: ProNotice | null;
  loadPiers: () => Promise<void>;
  loadBoats: (owner: string, force?: boolean) => Promise<void>;
  openPier: (pier: ProPier) => void;
  openBoat: (boat: ProBoat) => void;
  back: () => void;
  setStyle: (style: PierStyle) => void;
  setGoal: (goal: ProGoal) => void;
  setShape: (shape: readonly number[] | null) => void;
  setTyped: (text: string) => void;
  setStop: (stop: ProStop) => void;
  prepare: (connection: Connection, target: ProTarget, holdings: Holdings | null) => Promise<void>;
  confirm: (connection: Connection, holdings: Holdings | null) => Promise<void>;
  recheck: (owner: string) => Promise<void>;
  again: () => void;
  forget: () => void;
};

let ticket = 0;
const START_TEXT = '1';

/** The goal in force on a pier: the person's, else the pier's own default — Wave included (the terminal's ticket). */
export const proGoalOf = (pier: ProPier, picked: ProGoal | null): ProGoal => picked ?? proDefaultGoal(pier);

/** The goal in force as the city's frozen window names it: one of the three; it never offers Wave. */
export const proGoal = (pier: ProPier, picked: ProGoal | null): PierGoal => (picked === null || picked === 'wave' ? proDefaultGoal(pier) : picked);

export const useProPier = create<Store>((set, get) => {
  const hold = (phase: ProPhase) => {
    set({ phase });
    useEarn.getState().setBusy(PRO_LOCKED.has(phase));
  };
  /** The Review's key and body for what is on the card, or null when it cannot be asked. */
  const asked = (owner: string, target: ProTarget, holdings: Holdings | null): Readonly<{ key: string; body: EarnProReviewRequest }> | null => {
    const st = get();
    if (target.kind === 'open') {
      if (!st.pier) return null;
      const goal = proGoalOf(st.pier, st.goal);
      const choice = proChoice(st.pier, st.style, goal, st.typed, holdings, owner, st.shape);
      if (!choice.key || !choice.lamports) return null;
      const opening = { action: 'open', owner, pool: st.pier.address, style: st.style, lamports: choice.lamports.toString() } as const;
      return { key: choice.key, body: st.shape ? { ...opening, goal: 'custom', columns: [...st.shape] } : { ...opening, goal } };
    }
    const boat = st.boat;
    if (!boat || boat.nftMint !== target.nftMint) return null;
    if (target.kind === 'care_on') return { key: `pro:care_on:${owner}:${boat.nftMint}:${st.stop}`, body: { action: 'care_on', owner, pool: boat.pool, nftMint: boat.nftMint, stopPct: st.stop } };
    return { key: `pro:${target.kind}:${owner}:${boat.nftMint}`, body: { action: target.kind, owner, pool: boat.pool, nftMint: boat.nftMint } };
  };
  return {
    list: { status: 'idle' },
    boats: null,
    pier: null,
    boat: null,
    style: DEFAULT_STYLE,
    goal: null,
    shape: null,
    typed: START_TEXT,
    stop: 0,
    target: null,
    reviewed: null,
    phase: 'idle',
    outcome: null,
    sent: null,
    notice: null,

    loadPiers: async () => {
      if (!EARN_PRO_OPEN) return set({ list: { status: 'closed' } });
      const kept = get().list;
      if (kept.status === 'loading' || kept.status === 'closed' || (kept.status === 'ready' && proEnv().now() - kept.at < PIERS_FRESH_MS)) return;
      if (kept.status !== 'ready') set({ list: { status: 'loading' } });
      const answer = await proEnv().engine.piers();
      if (answer.ok && Array.isArray(answer.value.piers)) return set({ list: { status: 'ready', value: { network: answer.value.network, piers: answer.value.piers, care: answer.value.care === true }, at: proEnv().now() } });
      // The server does not serve it here: the window stays as it was, and does not ask again.
      if (!answer.ok && answer.failure.code === 'CAPABILITY_UNAVAILABLE') return set({ list: { status: 'closed' } });
      // What was read stays on screen through a miss.
      if (get().list.status !== 'ready') set({ list: { status: 'error' } });
    },
    loadBoats: async (owner, force = false) => {
      const list = get().list;
      if (!EARN_PRO_OPEN || list.status === 'closed') return;
      const kept = get().boats;
      if (kept?.owner === owner && (kept.value.status === 'loading' || (!force && kept.value.status === 'ready' && proEnv().now() - kept.value.at < BOATS_FRESH_MS))) return;
      if (kept?.owner !== owner || kept.value.status !== 'ready') set({ boats: { owner, value: { status: 'loading' } } });
      const answer = await proEnv().engine.positions(owner);
      if (answer.ok && Array.isArray(answer.value.positions)) {
        set({ boats: { owner, value: { status: 'ready', value: answer.value.positions, at: proEnv().now() } } });
        // The boat on screen is the chain's latest word on it; one that is gone closes its card.
        const open = get().boat;
        if (open && !PRO_BUSY.has(get().phase) && !get().outcome) {
          const fresh = answer.value.positions.find((entry) => entry.nftMint === open.nftMint) ?? null;
          set({ boat: fresh, ...(fresh ? {} : { target: null, reviewed: null }) });
        }
        return;
      }
      if (get().boats?.owner === owner && get().boats!.value.status !== 'ready') set({ boats: { owner, value: { status: 'error' } } });
    },

    openPier: (pier) => {
      if (PRO_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ pier, boat: null, target: { kind: 'open' }, reviewed: null, phase: 'idle', outcome: null, notice: null });
    },
    openBoat: (boat) => {
      if (PRO_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ boat, pier: null, target: null, reviewed: null, phase: 'idle', outcome: null, notice: null, stop: 0 });
    },
    back: () => {
      if (PRO_LOCKED.has(get().phase)) return;
      ticket += 1;
      useEarn.getState().setBusy(false);
      set({ pier: null, boat: null, target: null, reviewed: null, phase: 'idle', outcome: null, notice: null });
    },
    setStyle: (style) => {
      if (PRO_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ style, reviewed: null, phase: 'idle', notice: null });
    },
    setGoal: (goal) => {
      if (PRO_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ goal, shape: null, reviewed: null, phase: 'idle', notice: null });
    },
    setShape: (shape) => {
      if (PRO_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ shape: shape ? [...shape] : null, reviewed: null, phase: 'idle', notice: null });
    },
    setTyped: (text) => {
      if (PRO_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ typed: text, reviewed: null, phase: 'idle', notice: null });
    },
    setStop: (stop) => {
      if (PRO_BUSY.has(get().phase)) return;
      ticket += 1;
      set({ stop, reviewed: null, phase: 'idle', notice: null });
    },

    prepare: async (connection, target, holdings) => {
      if (PRO_BUSY.has(get().phase)) return;
      const want = asked(connection.address, target, holdings);
      if (!want) return;
      const mine = ++ticket;
      const kept = get().reviewed?.key === want.key ? get().reviewed : null;
      set({ target, notice: null, outcome: null, reviewed: kept });
      hold('reviewing');
      const answer = await proEnv().engine.review(want.body);
      if (mine !== ticket) return;
      if (!answer.ok) {
        set({ reviewed: null, notice: { tone: answer.failure.code === 'NOTHING_TO_DO' ? 'warn' : 'error', text: proFailure(answer.failure.code) } });
        return hold('idle');
      }
      set({ reviewed: { key: want.key, review: answer.value, at: proEnv().now() } });
      hold('idle');
    },

    confirm: async (connection, holdings) => {
      const st = get();
      const target = st.target;
      if (!target || PRO_BUSY.has(st.phase)) return;
      const want = asked(connection.address, target, holdings);
      const reviewed = want && st.reviewed?.key === want.key ? st.reviewed : null;
      const e = proEnv();
      if (!reviewed || !reviewFresh(signableOf(reviewed.review, reviewed.at), reviewed.at, e.now())) {
        await get().prepare(connection, target, holdings);
        if (get().reviewed) set({ notice: { tone: 'warn', text: earnWords().pro.fresh } });
        return;
      }
      const mine = ++ticket;
      hold('wallet');
      const sign = e.sign(connection, reviewed.review.network);
      const outcome = await signAndSend(signableOf(reviewed.review, reviewed.at), reviewed.at, {
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
        if (get().reviewed) set({ notice: { tone: 'warn', text: earnWords().pro.fresh } });
        return;
      }
      if (outcome.kind === 'refused') {
        set({ notice: { tone: 'error', text: proFailure(outcome.code) }, ...(outcome.code === 'WALLET_REFUSED' ? {} : { reviewed: null }) });
        return hold('idle');
      }
      set({ outcome, sent: reviewed, reviewed: null });
      hold(outcome.kind);
      if (outcome.kind === 'done' || outcome.kind === 'partial') {
        e.after(connection.address);
        void get().loadBoats(connection.address, true);
      }
    },

    recheck: async (owner) => {
      const outcome = get().outcome;
      if (outcome?.kind !== 'unknown' || PRO_BUSY.has(get().phase)) return;
      const mine = ++ticket;
      hold('sending');
      const e = proEnv();
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
        void get().loadBoats(owner, true);
      }
    },

    again: () => {
      if (PRO_BUSY.has(get().phase)) return;
      const st = get();
      ticket += 1;
      // Something landed: the list says what is there now. Nothing landed: the same card, to try again.
      if (st.outcome?.kind === 'done' || st.outcome?.kind === 'partial' || st.outcome?.kind === 'unknown') {
        set({ pier: null, boat: null, target: null, reviewed: null, phase: 'idle', outcome: null, sent: null, notice: null });
        return;
      }
      set({ phase: 'idle', outcome: null, sent: null, reviewed: null, notice: null });
    },

    forget: () => {
      if (PRO_BUSY.has(get().phase)) return set({ boats: null });
      ticket += 1;
      set({ boats: null, boat: null, reviewed: null, phase: 'idle', outcome: null, sent: null, notice: null, target: get().pier ? { kind: 'open' } : null });
    },
  };
});

/** The network's name for a signature's link. */
export const proNetwork = (): 'devnet' | 'mainnet' => {
  const list = useProPier.getState().list;
  return list.status === 'ready' ? list.value.network : 'mainnet';
};

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __proPier: useProPier });
