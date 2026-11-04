import { create } from 'zustand';
import { citySigner } from '../app-bridge/route.ts';
import { wordsNow } from '../i18n/dict.ts';
import { langNow } from '../i18n/lang.ts';
import { createEngine, type Engine } from '../trade/engine.ts';
import type { SignResult } from '../trade/flow.ts';
import { STOPS_ENGINE } from '../trade/gates.ts';
import { cancelLimit, createLimits, placeLimit, reviewLimit, type LimitDeps, type LimitIntent, type LimitOrderView, type LimitReview, type LimitsApi } from '../trade/limits.ts';
import { proveWallet, type ProofOutcome } from '../trade/proof.ts';
import { createStopsApi, type EngineStopView, type StopsApi } from '../trade/stops-api.ts';
import type { Connection } from '../trade/store.ts';
import { useWallet } from '../trade/wallet.ts';
import { ONE_SENTENCE_OPEN } from './flag.ts';
import { answer as answerOf, baseMintOf, NO_FACTS, planOf, PROBE_USD, rawUsd, USDC_MINT, type Answer, type Facts, type Plan, type Planned } from './plan.ts';
import { createRulesApi, type RulesApi, type RuleView } from './rules-api.ts';
import type { Instruction } from './types.ts';
import { INSTRUCT_LINES } from './words.ts';

/**
 * The agent's card and «My instructions» (CITY-176). The card holds one instruction read from a sentence; the taps fill
 * what was missing; the engines say the price, the coin's decimals and the fee; and «Sign» hands the exact request to
 * the engine that already does it — the person's wallet signs, Ryntra holds nothing and signs nothing for them:
 *
 * - a limit: the spot limits engine builds the Jupiter Trigger V1 order, the card shows its fee, the wallet signs the
 *   order once (`../trade/limits.ts`, the same calls the Spot ticket makes);
 * - a stop: the wallet proves itself with one message, the engine keeps the stop and watches it (CITY-149);
 * - a regular purchase: the wallet proves itself with one message, the engine keeps the rule and reminds on schedule;
 *   every purchase is the wallet's own signature.
 *
 * What was set from a sentence is kept on this device under the wallet (`ryntra.city.instructions.v1:<owner>`) as
 * public facts — the engine's id and what was said — and «My instructions» reads each one's state from its engine.
 * Cancelling is one tap: a limit's cancellation is signed in the wallet; a stop or a rule is let go on the wallet's proof.
 */

export type Phase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'done' | 'failed';
export const BUSY: ReadonlySet<Phase> = new Set(['wallet', 'sending']);

export type Notice = Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }>;

/** What a sentence set, as this device keeps it: the engine's id and the words said. Public facts only. */
export type Entry = Readonly<{
  id: string;
  owner: string;
  kind: 'recurring' | 'limit' | 'stop';
  said: string;
  side: 'buy' | 'sell';
  coin: Readonly<{ mint: string; symbol: string; name: string; icon: string | null }>;
  /** Dollars on a buy; the coin's amount on a sale. */
  amount: string;
  /** Dollars per coin, for a limit or a stop. */
  price: string | null;
  cadence: 'daily' | 'weekly' | 'monthly' | null;
  ref: Readonly<{ kind: 'limit'; venue: 'trigger' | 'dlmm'; order: string }> | Readonly<{ kind: 'stop'; id: string }> | Readonly<{ kind: 'rule'; id: string }>;
  createdAt: number;
}>;

/** How an instruction stands, from its engine. */
export type Live =
  | Readonly<{ state: 'reading' }>
  | Readonly<{ state: 'next'; at: number | null }>
  | Readonly<{ state: 'due'; until: number }>
  | Readonly<{ state: 'paused' }>
  | Readonly<{ state: 'waiting' }>
  | Readonly<{ state: 'watching' }>
  | Readonly<{ state: 'reached' }>
  | Readonly<{ state: 'filled' }>
  | Readonly<{ state: 'ended' }>
  | Readonly<{ state: 'unknown' }>;

export type Reads = Readonly<{ orders: readonly LimitOrderView[] | null; stops: readonly EngineStopView[] | null; rules: readonly RuleView[] | null }>;

export const NO_READS: Reads = { orders: null, stops: null, rules: null };

/** One instruction's state from what its engine said; `reading` while its engine has not answered yet. */
export function liveOf(entry: Entry, reads: Reads, now: number): Live {
  const ref = entry.ref;
  if (ref.kind === 'limit') {
    if (!reads.orders) return { state: 'reading' };
    const order = reads.orders.find((o) => o.order === ref.order);
    if (!order) return { state: 'unknown' };
    if (order.state === 'FILLED') return { state: 'filled' };
    if (order.state === 'CANCELLED' || order.state === 'EXPIRED' || order.state === 'FAILED') return { state: 'ended' };
    return { state: 'waiting' };
  }
  if (ref.kind === 'stop') {
    if (!reads.stops) return { state: 'reading' };
    const stop = reads.stops.find((s) => s.id === ref.id);
    if (!stop) return { state: 'ended' };
    if (stop.state === 'watching') return stop.expiresAt !== null && now >= stop.expiresAt ? { state: 'ended' } : { state: 'watching' };
    if (stop.state === 'reached') return { state: 'reached' };
    if (stop.state === 'done') return { state: 'filled' };
    return { state: 'ended' };
  }
  if (!reads.rules) return { state: 'reading' };
  const rule = reads.rules.find((r) => r.id === ref.id);
  if (!rule) return { state: 'ended' };
  if (rule.status === 'paused') return { state: 'paused' };
  const open = rule.occurrences.find((o) => o.state === 'due' && Date.parse(o.openUntil) > now);
  if (open) return { state: 'due', until: Date.parse(open.openUntil) };
  return { state: 'next', at: rule.nextDueAt ? Date.parse(rule.nextDueAt) : null };
}

/** Whether «Cancel» asks its engine (a live instruction) or only lets go of this device's line (one that ended). */
export const isLive = (live: Live): boolean => !['ended', 'filled', 'unknown'].includes(live.state);

export type InstructEnv = Readonly<{
  open: boolean;
  /** Stops kept by the engine (CITY-149); shut, the card says stops are coming and sets none. */
  stopsEngine: boolean;
  limits: LimitsApi;
  stops: StopsApi;
  rules: RulesApi;
  engine: Engine;
  sign: (connection: Connection, unsignedWireBase64: string) => Promise<SignResult>;
  prove: (connection: Connection) => Promise<ProofOutcome>;
  wallet: () => ReturnType<typeof useWallet.getState>;
  storage: Readonly<{ read: (key: string) => string | null; write: (key: string, value: string) => void }>;
  now: () => number;
  locale: () => 'en' | 'uk';
  timeZone: () => string;
  id: () => string;
}>;

const browserStorage: InstructEnv['storage'] = {
  read: (key) => {
    try {
      return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, value) => {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    } catch {
      /* A browser that refuses storage keeps the list for this visit only. */
    }
  },
};

let env: InstructEnv = {
  open: ONE_SENTENCE_OPEN,
  stopsEngine: STOPS_ENGINE,
  limits: createLimits(),
  stops: createStopsApi(),
  rules: createRulesApi(),
  engine: createEngine(),
  sign: (connection, wire) => citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
  prove: (connection) => proveWallet(connection),
  wallet: () => useWallet.getState(),
  storage: browserStorage,
  now: () => Date.now(),
  locale: () => langNow(),
  timeZone: () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  },
  id: () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
};

/** Tests and the screenshot stand put their own engines here. */
export function setInstructEnv(next: Partial<InstructEnv>): void {
  env = { ...env, ...next };
}

export const entriesKey = (owner: string) => `ryntra.city.instructions.v1:${owner}`;
const ENTRIES_KEPT = 40;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The kept list read back; anything not exactly an entry is left out, never guessed at. */
export function parseEntries(text: string | null, owner: string): readonly Entry[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Entry => {
    const v = item as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || v.owner !== owner || typeof v.id !== 'string' || typeof v.said !== 'string') return false;
    if (!['recurring', 'limit', 'stop'].includes(v.kind as string) || (v.side !== 'buy' && v.side !== 'sell') || typeof v.amount !== 'string') return false;
    const coin = v.coin as Record<string, unknown> | null;
    const ref = v.ref as Record<string, unknown> | null;
    if (!coin || typeof coin.mint !== 'string' || !MINT.test(coin.mint) || typeof coin.symbol !== 'string' || !ref || typeof v.createdAt !== 'number') return false;
    if (ref.kind === 'limit') return typeof ref.order === 'string' && MINT.test(ref.order) && (ref.venue === 'trigger' || ref.venue === 'dlmm');
    return (ref.kind === 'stop' || ref.kind === 'rule') && typeof ref.id === 'string' && ref.id.length <= 80;
  }).slice(0, ENTRIES_KEPT);
}

type FactsRead = Readonly<{ key: string; status: 'reading' | 'ready' | 'failed'; facts: Facts }>;

type InstructState = {
  /** The card. */
  open: boolean;
  instruction: Instruction | null;
  facts: FactsRead | null;
  review: Readonly<{ key: string; review: LimitReview; receivedAt: number }> | null;
  phase: Phase;
  notice: Notice | null;
  /** What «Sign» set, while the card says so. */
  done: Entry | null;
  /** «My instructions». */
  listOpen: boolean;
  owner: string | null;
  entries: readonly Entry[];
  reads: Reads;
  cancelling: string | null;
  listNotice: Notice | null;

  show: (instruction: Instruction) => void;
  close: () => void;
  choose: (given: Answer) => void;
  readFacts: () => Promise<void>;
  /** The exact limit order for the connected wallet, so its fee is on the card before the wallet opens. */
  prepare: () => Promise<void>;
  sign: () => Promise<void>;
  openList: () => void;
  closeList: () => void;
  readList: () => Promise<void>;
  cancel: (id: string) => Promise<void>;
};

let factsTicket = 0;
let actionTicket = 0;
let listTicket = 0;

const holdingOf = (wallet: ReturnType<InstructEnv['wallet']>, mint: string): Readonly<{ raw: string | null; decimals: number | null }> => {
  const holdings = wallet.holdings;
  if (!holdings || !wallet.connection || holdings.owner !== wallet.connection.address) return { raw: null, decimals: null };
  const balance = mint === 'So11111111111111111111111111111111111111112' ? holdings.sol : holdings.tokens.get(mint);
  if (balance) return { raw: balance.spendableRaw, decimals: balance.decimals };
  return { raw: holdings.complete ? '0' : null, decimals: null };
};

/** The plan for the card as it stands: the instruction, the engines' facts and the wallet's holding now. */
export function planNow(state: Pick<InstructState, 'instruction' | 'facts'>): Planned | null {
  const instruction = state.instruction;
  if (!instruction) return null;
  const base = instruction.coin ? baseMintOf(instruction.coin) : null;
  const held = base ? holdingOf(env.wallet(), base) : { raw: null, decimals: null };
  const read = state.facts && base && state.facts.key.startsWith(`${base}|`) ? state.facts.facts : NO_FACTS;
  const facts: Facts = { ...read, holdingRaw: held.raw, decimals: held.decimals ?? read.decimals };
  return planOf(instruction, facts, { now: env.now(), timeZone: env.timeZone(), locale: env.locale() });
}

const intentOf = (plan: Extract<Plan, { kind: 'limit' }>, owner: string): LimitIntent => ({
  owner,
  side: plan.side,
  baseMint: baseMintOf(plan.coin),
  quoteMint: USDC_MINT,
  amount: plan.amount,
  price: plan.price,
  quoteUsd: 1,
});

const intentKey = (intent: LimitIntent) => JSON.stringify([intent.owner, intent.side, intent.baseMint, intent.quoteMint, intent.amount, intent.price]);

const AFTER_READS_MS = [4_000, 12_000, 30_000] as const;

export const useInstruct = create<InstructState>((set, get) => {
  const deps = (connection: Connection, my: number): LimitDeps => ({
    api: env.limits,
    sign: (wire) => env.sign(connection, wire),
    now: env.now,
    onPhase: (phase) => my === actionTicket && phase !== 'reviewing' && set({ phase }),
  });

  const ownEntries = (owner: string) => parseEntries(env.storage.read(entriesKey(owner)), owner);
  const keep = (owner: string, entries: readonly Entry[]) => {
    const kept = entries.slice(0, ENTRIES_KEPT);
    env.storage.write(entriesKey(owner), JSON.stringify(kept));
    if (get().owner === owner) set({ entries: kept });
    return kept;
  };

  const entryOf = (plan: Plan, owner: string, ref: Entry['ref']): Entry => {
    const instruction = get().instruction!;
    const coin = plan.coin;
    return {
      id: env.id(),
      owner,
      kind: plan.kind,
      said: instruction.said,
      side: plan.kind === 'recurring' ? 'buy' : plan.side,
      coin: { mint: coin.mint, symbol: coin.symbol, name: coin.name, icon: coin.icon },
      amount: plan.kind === 'recurring' ? String(plan.usd) : plan.amount,
      price: plan.kind === 'recurring' ? null : plan.price,
      cadence: plan.kind === 'recurring' ? plan.schedule.cadence : null,
      ref,
      createdAt: env.now(),
    };
  };

  const proved = async (connection: Connection, my: number): Promise<boolean> => {
    set({ phase: 'wallet', notice: null });
    const proof = await env.prove(connection);
    if (my !== actionTicket) return false;
    if (!proof.ok) {
      set({ phase: 'idle', notice: { tone: proof.state === 'declined' ? 'info' : 'error', text: proof.state === 'declined' ? wordsNow(INSTRUCT_LINES).notSigned : proof.message } });
      return false;
    }
    set({ phase: 'sending' });
    return true;
  };

  const settle = (entry: Entry) => {
    keep(entry.owner, [entry, ...ownEntries(entry.owner).filter((e) => e.id !== entry.id)]);
    set({ phase: 'done', done: entry, notice: null });
    void get().readList();
  };

  return {
    open: false,
    instruction: null,
    facts: null,
    review: null,
    phase: 'idle',
    notice: null,
    done: null,
    listOpen: false,
    owner: null,
    entries: [],
    reads: NO_READS,
    cancelling: null,
    listNotice: null,

    show: (instruction) => {
      if (!env.open || BUSY.has(get().phase)) return;
      actionTicket += 1;
      set({ open: true, instruction, review: null, phase: 'idle', notice: null, done: null });
      void get().readFacts();
    },

    close: () => {
      if (BUSY.has(get().phase)) return;
      actionTicket += 1;
      factsTicket += 1;
      set({ open: false, instruction: null, facts: null, review: null, phase: 'idle', notice: null, done: null });
    },

    choose: (given) => {
      const instruction = get().instruction;
      if (!instruction || get().phase !== 'idle') return;
      const next = answerOf(instruction, given);
      actionTicket += 1;
      set({ instruction: next, review: null, notice: null });
      void get().readFacts();
    },

    readFacts: async () => {
      const instruction = get().instruction;
      if (!env.open || !instruction?.coin) return;
      const base = baseMintOf(instruction.coin);
      const usd = instruction.kind === 'recurring' || instruction.side === 'buy' ? (instruction.usd ?? PROBE_USD) : PROBE_USD;
      const key = `${base}|${usd}`;
      const now = get().facts;
      if (now?.key === key && now.status !== 'failed') {
        if (now.status === 'ready') void get().prepare();
        return;
      }
      const my = ++factsTicket;
      set({ facts: { key, status: 'reading', facts: now?.key.startsWith(`${base}|`) ? now.facts : NO_FACTS } });
      const owner = env.wallet().connection?.address ?? null;
      const amountRaw = rawUsd(usd) ?? '10000000';
      const [market, quote] = await Promise.all([
        base === USDC_MINT ? Promise.resolve(null) : env.limits.market({ owner, baseMint: base, quoteMint: USDC_MINT }),
        base === USDC_MINT ? Promise.resolve(null) : env.engine.quote({ inputMint: USDC_MINT, outputMint: base, amountRaw }),
      ]);
      if (my !== factsTicket) return;
      const decimals = quote?.ok && typeof quote.value.decimals?.[base] === 'number' ? quote.value.decimals[base]! : null;
      // The price the quote implies — dollars paid over the coin got — stands in when the market read did not answer.
      const outRaw = quote?.ok ? Number(quote.value.order?.outAmountRaw) : NaN;
      const quotedPrice = decimals !== null && outRaw > 0 ? Number(usd) / (outRaw / 10 ** decimals) : null;
      const marketPrice = market?.ok && typeof market.value.price === 'number' && Number.isFinite(market.value.price) && market.value.price > 0 ? market.value.price : null;
      const feeBps = quote?.ok && typeof quote.value.outputFee?.basisPoints === 'number' ? quote.value.outputFee.basisPoints : null;
      const facts: Facts = { price: marketPrice ?? quotedPrice, decimals, holdingRaw: null, feeBps };
      set({ facts: { key, status: facts.price === null && decimals === null ? 'failed' : 'ready', facts } });
      void get().prepare();
    },

    prepare: async () => {
      const connection = env.wallet().connection;
      const planned = planNow(get());
      if (!env.open || !connection || !planned?.ok || planned.plan.kind !== 'limit' || get().phase !== 'idle') return;
      const intent = intentOf(planned.plan, connection.address);
      const key = intentKey(intent);
      if (get().review?.key === key) return;
      const my = ++actionTicket;
      set({ phase: 'reviewing', review: null, notice: null });
      const outcome = await reviewLimit(intent, deps(connection, my));
      if (my !== actionTicket) return;
      if (outcome.kind === 'refused') return set({ phase: 'idle', notice: { tone: 'error', text: outcome.refusal.message } });
      set({ phase: 'idle', review: { key, review: outcome.review, receivedAt: outcome.receivedAt } });
    },

    sign: async () => {
      const connection = env.wallet().connection;
      const planned = planNow(get());
      if (!env.open || !connection || !planned?.ok || get().phase !== 'idle') return;
      const plan = planned.plan;
      const owner = connection.address;

      if (plan.kind === 'limit') {
        const intent = intentOf(plan, owner);
        const shown = get().review;
        // The person signs only what the card showed: without the engine's order on screen, the press asks for it first.
        if (!shown || shown.key !== intentKey(intent)) return get().prepare();
        const my = ++actionTicket;
        set({ notice: null });
        const outcome = await placeLimit({ intent, review: shown.review, receivedAt: shown.receivedAt }, deps(connection, my));
        if (my !== actionTicket) return;
        switch (outcome.kind) {
          case 'placed':
            env.wallet().refreshHoldings([...AFTER_READS_MS]);
            return settle(entryOf(plan, owner, { kind: 'limit', venue: shown.review.venue, order: shown.review.order }));
          case 'review':
            return set({ phase: 'idle', review: { key: shown.key, review: outcome.review, receivedAt: outcome.receivedAt }, notice: { tone: 'warn', text: outcome.note } });
          case 'cancelled':
            return set({ phase: 'idle', notice: { tone: 'info', text: wordsNow(INSTRUCT_LINES).notSigned } });
          case 'refused':
            return set({ phase: 'idle', review: null, notice: { tone: 'error', text: outcome.refusal.message } });
          case 'failed':
            return set({ phase: 'failed', review: null, notice: { tone: 'error', text: wordsNow(INSTRUCT_LINES).failed } });
          case 'unclear':
            // Sent, the answer not clear: the engine's record holds it — kept in the list, never placed again.
            return settle(entryOf(plan, owner, { kind: 'limit', venue: shown.review.venue, order: shown.review.order }));
        }
      }

      const my = ++actionTicket;
      if (plan.kind === 'stop') {
        if (!env.stopsEngine) return set({ notice: { tone: 'info', text: wordsNow(INSTRUCT_LINES).stopsComing } });
        if (!(await proved(connection, my))) return;
        const answer = await env.stops.create(plan.body);
        if (my !== actionTicket) return;
        if (!answer.ok) return set({ phase: 'idle', notice: { tone: answer.failure.code === 'STOP_REACHED' ? 'error' : 'warn', text: wordsNow(INSTRUCT_LINES).refused(answer.failure.code) } });
        return settle(entryOf(plan, owner, { kind: 'stop', id: answer.value.id }));
      }

      if (!(await proved(connection, my))) return;
      const answer = await env.rules.create(plan.body);
      if (my !== actionTicket) return;
      if (!answer.ok) return set({ phase: 'idle', notice: { tone: 'warn', text: wordsNow(INSTRUCT_LINES).refused(answer.failure.code) } });
      return settle(entryOf(plan, owner, { kind: 'rule', id: answer.value.id }));
    },

    openList: () => {
      if (!env.open) return;
      set({ listOpen: true, listNotice: null });
      void get().readList();
    },

    closeList: () => {
      if (get().cancelling) return;
      set({ listOpen: false, listNotice: null });
    },

    readList: async () => {
      const owner = env.wallet().connection?.address ?? null;
      if (!owner) return set({ owner: null, entries: [], reads: NO_READS });
      const entries = ownEntries(owner);
      const fresh = get().owner !== owner;
      set({ owner, entries, ...(fresh ? { reads: NO_READS } : {}) });
      if (!env.open || !entries.length) return;
      const my = ++listTicket;
      const has = (kind: Entry['ref']['kind']) => entries.some((e) => e.ref.kind === kind);
      const [orders, stops, rules] = await Promise.all([
        has('limit') ? env.limits.orders(owner) : Promise.resolve(null),
        has('stop') ? env.stops.list() : Promise.resolve(null),
        has('rule') ? env.rules.list() : Promise.resolve(null),
      ]);
      if (my !== listTicket || env.wallet().connection?.address !== owner) return;
      const before = get().reads;
      // An engine that did not answer keeps what it said before; with nothing before, its rows say they are reading.
      set({
        reads: {
          orders: orders?.ok ? (orders.value.orders ?? []) : has('limit') ? before.orders : [],
          stops: stops?.ok ? stops.value : has('stop') ? before.stops : [],
          rules: rules?.ok ? rules.value : has('rule') ? before.rules : [],
        },
      });
    },

    cancel: async (id) => {
      const connection = env.wallet().connection;
      if (!connection || get().cancelling) return;
      const owner = connection.address;
      const entry = ownEntries(owner).find((e) => e.id === id);
      if (!entry) return;
      const drop = () => keep(owner, ownEntries(owner).filter((e) => e.id !== id));
      const live = liveOf(entry, get().reads, env.now());
      // An instruction that already ended leaves this device's list; nothing is asked of any engine.
      if (!isLive(live)) return void drop();
      set({ cancelling: id, listNotice: null });
      const w = wordsNow(INSTRUCT_LINES);
      try {
        const ref = entry.ref;
        if (ref.kind === 'limit') {
          const outcome = await cancelLimit({ owner, venue: ref.venue, order: ref.order }, { api: env.limits, sign: (wire) => env.sign(connection, wire), now: env.now });
          if (outcome.kind === 'cancelled') drop();
          else set({ listNotice: { tone: outcome.kind === 'kept' ? 'info' : outcome.kind === 'refused' ? 'error' : 'warn', text: outcome.kind === 'refused' ? outcome.refusal.message : outcome.message } });
          if (outcome.kind === 'cancelled' || outcome.kind === 'unclear') env.wallet().refreshHoldings([...AFTER_READS_MS]);
          return;
        }
        const proof = await env.prove(connection);
        if (!proof.ok) return set({ listNotice: { tone: proof.state === 'declined' ? 'info' : 'error', text: proof.state === 'declined' ? w.notSigned : proof.message } });
        const answer = ref.kind === 'stop' ? await env.stops.cancel(ref.id) : await env.rules.remove(ref.id);
        if (answer.ok || answer.failure.code === 'STOP_NOT_FOUND' || answer.failure.code === 'NOT_FOUND') drop();
        else set({ listNotice: { tone: 'warn', text: w.notCancelled } });
      } finally {
        set({ cancelling: null });
        void get().readList();
      }
    },
  };
});

// Development hook: lets the screenshot scripts and the console drive the card and the list.
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __instruct: useInstruct, __setInstructEnv: setInstructEnv });
