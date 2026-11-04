import { create } from 'zustand';
import { rawToDecimal } from '../../../lib/solana/limits/model.ts';
import { citySigner } from '../app-bridge/route.ts';
import { digits, wordsNow } from '../i18n/dict.ts';
import { langNow } from '../i18n/lang.ts';
import { createEngine, type Engine } from './engine.ts';
import type { SignResult } from './flow.ts';
import { SPOT_OPEN, STOPS_ENGINE } from './gates.ts';
import {
  cancelLimit,
  createLimits,
  placeLimit,
  reviewLimit,
  type LimitDeps,
  type LimitIntent,
  type LimitOrderView,
  type LimitReview,
  type LimitsApi,
  type LimitToken,
} from './limits.ts';
import { proveWallet, type ProofOutcome } from './proof.ts';
import { createStopsApi, stopOfView, type StopsApi, type StopsFailure } from './stops-api.ts';
import {
  inputMintOf,
  isEngineStop,
  keptStops,
  makeStop,
  MAX_STOPS,
  outputMintOf,
  parseStops,
  stopReached,
  stopsKey,
  stopsToWatch,
  stopView,
  withState,
  type Stop,
  type StopExpiry,
  type StopInput,
} from './stops.ts';
import { useTrade, type Connection, type Notice } from './store.ts';
import { isBase, unitOf, type PayAsset } from './tiles.ts';
import { useWallet } from './wallet.ts';
import { LIMITS, STOPS } from './words.ts';

/**
 * The trade card's Limit and Stop, and «My orders». A limit order is the engine's: the card reads the pair's price,
 * asks the engine for the exact order once the person taps, shows every figure of it, and the wallet signs; the engine
 * relays it once. A stop is the engine's watched kind (`stops.ts`): kept on this device, asked about with the swap
 * engine's quote while Ryntra is open, and when it is reached the city opens the sale's exact order for the person to
 * sign. All of it stands behind `NEXT_PUBLIC_RYNTRA_CITY_SPOT` (`gates.ts`): shut, nothing here asks the engine for
 * an order, places one, or watches a stop.
 *
 * Since CITY-149, behind `NEXT_PUBLIC_RYNTRA_CITY_STOPS`, a new stop is the engine's: the wallet proves itself with one
 * signed message (no transaction), the engine keeps the stop under the wallet, watches it around the clock and tells
 * the person when it is reached — Telegram, the browser's push. The device keeps a copy for «My orders», and the city
 * still asks the quote while it is open. A reached stop is offered once on this device: the one a note's link names
 * (`?stop=`) first, else the newest the engine reached — so a tap on the note opens the city on that sale.
 */

export type SpotPhase = 'idle' | 'reviewing' | 'wallet' | 'sending' | 'placed' | 'set' | 'failed' | 'unclear';

/** The phases where a signature may be out: the card cannot be closed or changed under them. */
export const SPOT_BUSY: ReadonlySet<SpotPhase> = new Set(['wallet', 'sending']);
/** The phases where the ticket can be changed. */
export const SPOT_IDLE: ReadonlySet<SpotPhase> = new Set(['idle']);

export type MarketRead =
  | Readonly<{ key: string; status: 'loading' }>
  | Readonly<{ key: string; status: 'ready'; price: number | null; quoteUsd: number | null; at: number }>
  | Readonly<{ key: string; status: 'error' }>;

export type SpotReview = Readonly<{ key: string; review: LimitReview; receivedAt: number }>;

export type Placed =
  | Readonly<{ kind: 'limit'; state: string; signature: string; settled: boolean; review: LimitReview; coin: string; unit: string }>
  | Readonly<{ kind: 'stop'; stop: Stop }>;

export type OrdersRead = Readonly<{
  owner: string;
  status: 'reading' | 'ready' | 'failed';
  list: readonly LimitOrderView[];
  tokens: Readonly<Record<string, LimitToken>>;
  complete: boolean;
  at: number | null;
}>;

export type Cancelling = Readonly<{ key: string; phase: 'building' | 'wallet' | 'sending' }>;

/** «My orders» as the connected wallet may see them: its own read, never the one of a wallet before it. */
export function ownOrders(orders: OrdersRead | null, owner: string | null): OrdersRead | null {
  return orders && owner && orders.owner === owner ? orders : null;
}

type Storage = Readonly<{ read: (key: string) => string | null; write: (key: string, value: string) => void }>;

/** Everything the ticket reaches outside itself; tests put stubs here. */
export type SpotEnv = Readonly<{
  api: LimitsApi;
  engine: Engine;
  sign: (connection: Connection, unsignedWireBase64: string) => Promise<SignResult>;
  now: () => number;
  /** The operator's switch: shut, the ticket asks the engine for nothing. */
  open: boolean;
  storage: Storage;
  wallet: () => Readonly<{ connection: Connection | null }>;
  refreshHoldings: (delaysMs?: readonly number[]) => void;
  later: (run: () => void, ms: number) => void;
  id: () => string;
  /** CITY-149: the engine's stops, the wallet's proof for a change, and the switch that puts stops in the engine. */
  stops: StopsApi;
  prove: (connection: Connection) => Promise<ProofOutcome>;
  engineStops: boolean;
  locale: () => 'en' | 'uk';
  /** The stop a note's link names (`?stop=`), read once and taken off the address. */
  askedStop: () => string | null;
}>;

const browserStorage: Storage = {
  read: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Without storage the stop lives only while this page is open.
    }
  },
};

let env: SpotEnv = {
  api: createLimits(),
  engine: createEngine(),
  sign: (connection, wire) => citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
  now: () => Date.now(),
  open: SPOT_OPEN,
  storage: browserStorage,
  wallet: () => useWallet.getState(),
  refreshHoldings: (delays) => useWallet.getState().refreshHoldings(delays),
  later: (run, ms) => void setTimeout(run, ms),
  id: () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`),
  stops: createStopsApi(),
  prove: (connection) => proveWallet(connection),
  engineStops: STOPS_ENGINE,
  locale: () => langNow(),
  askedStop: () => {
    if (typeof window === 'undefined') return null;
    const query = new URLSearchParams(window.location.search);
    const id = query.get('stop');
    if (id === null) return null;
    query.delete('stop');
    const rest = query.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    return id;
  },
};

/** Where a wallet's offered stops are remembered: a reached stop opens its sale by itself once on this device. */
export const offeredKey = (owner: string) => `ryntra.city.stops.offered.v1:${owner}`;
const OFFERED_KEPT = 60;
/** The engine's stops are read again after this while the page is open; the cron checks them every minute. */
const ENGINE_READ_MS = 30_000;

/** A refusal of the engine's, said in the card's words. */
function stopRefusal(failure: StopsFailure, side: 'buy' | 'sell'): string {
  if (failure.code === 'STOP_REACHED') return side === 'sell' ? wordsNow(STOPS).thereLower : wordsNow(STOPS).thereHigher;
  if (failure.code === 'STOP_LIMIT') return wordsNow(STOPS).tooMany(MAX_STOPS);
  if (failure.status === 401 || failure.status === 403) return wordsNow(LIMITS).notSigned;
  return wordsNow(STOPS).notKept;
}

/** Swap what the ticket reaches: for tests, and nothing else. */
export function setSpotEnv(next: Partial<SpotEnv>): void {
  env = { ...env, ...next };
  engineRead = null;
  asked = undefined;
}

/** After a placement or a cancellation the orders are read again a little later, for a venue that lags. */
const AFTER_ORDER_READS_MS = [2_500, 9_000];
/** «My orders» read this recently are not read again when the panel opens. */
const ORDERS_FRESH_MS = 20_000;

/** The pair's key: the side and both coins. A market price belongs to it. */
export const pairKey = (side: string, baseMint: string, quoteMint: string) => `${side}:${baseMint}/${quoteMint}`;
/**
 * The order's key: the wallet, the pair, the amount and the price. A Review belongs to it — its bytes are built for one
 * wallet, so another wallet never signs them.
 */
export const reviewKey = (intent: Pick<LimitIntent, 'owner' | 'side' | 'baseMint' | 'quoteMint' | 'amount' | 'price'>) =>
  `${intent.owner}|${pairKey(intent.side, intent.baseMint, intent.quoteMint)}:${intent.amount}@${intent.price}`;

/** What the price field keeps of a keystroke: digits and one point, a comma read as the point. */
export function cleanPrice(text: string): string {
  let point = false;
  let out = '';
  for (const char of text.replace(/,/g, '.')) {
    if (char >= '0' && char <= '9') out += char;
    else if (char === '.' && !point) {
      point = true;
      out += char;
    }
  }
  return out.slice(0, 30);
}

/** The price as the engine takes it — a plain positive decimal — or null. */
export function enginePrice(text: string): string | null {
  let clean = text.endsWith('.') ? text.slice(0, -1) : text;
  if (clean.startsWith('.')) clean = `0${clean}`;
  if (!/^\d{1,18}(?:\.\d{1,18})?$/.test(clean) || !/[1-9]/.test(clean)) return null;
  return clean;
}

/** The amount as the engine takes it: raw units written as a plain decimal. */
export function engineAmount(amountRaw: string, decimals: number): string | null {
  if (!/^\d+$/.test(amountRaw) || BigInt(amountRaw) === 0n) return null;
  const text = rawToDecimal(amountRaw, decimals);
  return /^\d{1,18}(?:\.\d{1,18})?$/.test(text) ? text : null;
}

type SpotStore = {
  market: MarketRead | null;
  price: string;
  /** The ticket and pair the price field was last filled for: another fills it again. */
  priceFor: string | null;
  expiry: StopExpiry;
  review: SpotReview | null;
  phase: SpotPhase;
  notice: Notice | null;
  placed: Placed | null;
  failed: string | null;
  unclear: Readonly<{ signature: string | null; message: string }> | null;

  orders: OrdersRead | null;
  cancelling: Cancelling | null;
  ordersNotice: Notice | null;
  /** The connected wallet's stops on this device. */
  stops: readonly Stop[];
  stopsOwner: string | null;

  /** The pair's price now, read again after a while; the price field of a new pair starts empty beside it. */
  readMarket: (args: Readonly<{ side: 'buy' | 'sell'; baseMint: string; quoteMint: string; mode: 'limit' | 'stop' }>) => Promise<void>;
  setPrice: (text: string) => void;
  setExpiry: (expiry: StopExpiry) => void;
  /** Ask the engine for the exact order; never opens the wallet. */
  reviewOrder: (intent: LimitIntent) => Promise<void>;
  /** The wallet signs the Review on screen; the engine relays it once. `words` name the coin and its price's unit. */
  placeOrder: (intent: LimitIntent, words?: Readonly<{ coin: string; unit: string }>) => Promise<void>;
  /** Set a stop: the engine's under the wallet (CITY-149), or this device's while that switch is shut. `nowOutRaw` is the engine's quote for its amount now. */
  setStop: (input: Omit<StopInput, 'owner'>, nowOutRaw: string | null) => Promise<void>;
  /** The ticket back to its fields, for another order. */
  again: () => void;
  /** Everything of the ticket let go: another coin, the card closed. */
  reset: () => void;

  readOrders: (force?: boolean) => Promise<void>;
  cancelOrder: (order: Pick<LimitOrderView, 'key' | 'venue' | 'order'>) => Promise<void>;
  /** The wallet's stops: this device's copy at once, then the engine's when they live there. */
  loadStops: () => void;
  /** Read the engine's stops into this device's copy (at most every half a minute unless forced). */
  readEngineStops: (force?: boolean) => Promise<void>;
  cancelStop: (id: string) => Promise<void>;
  /**
   * Ask the engine's quote once for every watched stop, and the engine for the ones it reached; the reached ones not
   * offered on this device yet are returned, a note's own stop first — the sale is the person's.
   */
  watchStops: () => Promise<readonly Stop[]>;
  /** A reached stop's sale on the trade card, at the market price, for the person to read and sign. */
  openSale: (stop: Stop) => void;
};

const initial = {
  review: null,
  phase: 'idle' as SpotPhase,
  notice: null,
  placed: null,
  failed: null,
  unclear: null,
};

let marketTicket = 0;
let actionTicket = 0;
let ordersTicket = 0;
let watching = false;
let engineRead: Readonly<{ owner: string; at: number }> | null = null;
/** The stop a note's link named, until it is offered; `undefined` until the address is read. */
let asked: string | null | undefined;

export const useSpot = create<SpotStore>((set, get) => {
  const deps = (connection: Connection, my: number): LimitDeps => ({
    api: env.api,
    sign: (wire) => env.sign(connection, wire),
    now: env.now,
    onPhase: (phase) => my === actionTicket && set({ phase }),
  });

  const writeStops = (owner: string, stops: readonly Stop[]) => {
    const kept = keptStops(stops, env.now());
    env.storage.write(stopsKey(owner), JSON.stringify(kept));
    set({ stops: kept, stopsOwner: owner });
    return kept;
  };

  const ownStops = (owner: string) => parseStops(env.storage.read(stopsKey(owner))).filter((stop) => stop.owner === owner);

  const offered = (owner: string): readonly string[] => {
    try {
      const list = JSON.parse(env.storage.read(offeredKey(owner)) ?? '[]') as unknown;
      return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  };
  const markOffered = (owner: string, ids: readonly string[]) => {
    if (!ids.length) return;
    env.storage.write(offeredKey(owner), JSON.stringify([...ids, ...offered(owner).filter((id) => !ids.includes(id))].slice(0, OFFERED_KEPT)));
  };
  const askedNow = (): string | null => {
    if (asked === undefined) asked = env.askedStop();
    return asked;
  };

  /**
   * The reached stops to offer: not offered on this device yet, the note's own stop first (even one this device has
   * not seen reached: the person tapped «sell?»), then the newest. Each is offered once.
   */
  const toOffer = (owner: string, stops: readonly Stop[], reachedNow: readonly Stop[]): readonly Stop[] => {
    const seen = new Set(offered(owner));
    const named = askedNow();
    const mine = named ? stops.find((stop) => stop.id === named && (stop.state === 'reached' || stopView(stop, env.now()) === 'watching')) : undefined;
    const fresh = [...reachedNow, ...stops.filter((stop) => stop.state === 'reached' && isEngineStop(stop))]
      .filter((stop, index, all) => all.findIndex((other) => other.id === stop.id) === index && !seen.has(stop.id) && stop.id !== mine?.id && (stop.state === 'watching' || stop.state === 'reached') && stopView(stop, env.now()) !== 'expired')
      .sort((a, b) => (b.reachedAt ?? 0) - (a.reachedAt ?? 0));
    const list = mine ? [mine, ...fresh] : fresh;
    if (mine) asked = null;
    markOffered(owner, list.map((stop) => stop.id));
    return list;
  };

  return {
    ...initial,
    market: null,
    price: '',
    priceFor: null,
    expiry: '7d',
    orders: null,
    cancelling: null,
    ordersNotice: null,
    stops: [],
    stopsOwner: null,

    readMarket: async ({ side, baseMint, quoteMint, mode }) => {
      if (!env.open || baseMint === quoteMint) return;
      const key = pairKey(side, baseMint, quoteMint);
      const field = `${mode}|${key}`;
      // The price is the person's own: the field starts empty, the market's price beside it and as its hint. A price
      // put there by itself would sit on the market — a limit that fills at once, an error before anything was typed.
      const fill = () => {
        if (get().priceFor === field || get().phase !== 'idle') return;
        set({ price: '', priceFor: field, review: null, notice: null });
      };
      fill();
      const now = get().market;
      if (now && now.key === key && (now.status === 'loading' || (now.status === 'ready' && env.now() - now.at < 20_000))) return;
      const my = ++marketTicket;
      set({ market: { key, status: 'loading' } });
      const answer = await env.api.market({ owner: env.wallet().connection?.address ?? null, baseMint, quoteMint });
      if (my !== marketTicket) return;
      if (!answer.ok) {
        set({ market: { key, status: 'error' } });
        return fill();
      }
      const price = typeof answer.value.price === 'number' && Number.isFinite(answer.value.price) && answer.value.price > 0 ? answer.value.price : null;
      const quoteUsd = typeof answer.value.quoteUsd === 'number' && answer.value.quoteUsd > 0 ? answer.value.quoteUsd : null;
      set({ market: { key, status: 'ready', price, quoteUsd, at: env.now() } });
      fill();
    },

    setPrice: (text) => {
      if (get().phase !== 'idle') return;
      const price = cleanPrice(text);
      if (price === get().price) return;
      actionTicket += 1;
      set({ price, review: null, notice: null });
    },

    setExpiry: (expiry) => {
      if (get().phase !== 'idle') return;
      set({ expiry });
    },

    reviewOrder: async (intent) => {
      const connection = env.wallet().connection;
      if (!env.open || !connection || connection.address !== intent.owner || get().phase !== 'idle') return;
      const my = ++actionTicket;
      set({ phase: 'reviewing', notice: null, review: null });
      const outcome = await reviewLimit(intent, deps(connection, my));
      if (my !== actionTicket) return;
      if (outcome.kind === 'refused') return set({ phase: 'idle', notice: { tone: 'error', text: outcome.refusal.message } });
      set({ phase: 'idle', review: { key: reviewKey(intent), review: outcome.review, receivedAt: outcome.receivedAt } });
    },

    placeOrder: async (intent, words = { coin: '', unit: '' }) => {
      const connection = env.wallet().connection;
      const shown = get().review;
      if (!env.open || !connection || connection.address !== intent.owner || get().phase !== 'idle' || !shown || shown.key !== reviewKey(intent)) return;
      const my = ++actionTicket;
      set({ notice: null });
      const outcome = await placeLimit({ intent, review: shown.review, receivedAt: shown.receivedAt }, deps(connection, my));
      if (my !== actionTicket) return;
      switch (outcome.kind) {
        case 'placed':
          env.refreshHoldings(AFTER_ORDER_READS_MS);
          set({ phase: 'placed', placed: { kind: 'limit', state: outcome.state, signature: outcome.signature, settled: outcome.settled, review: shown.review, ...words } });
          void get().readOrders(true);
          for (const delay of AFTER_ORDER_READS_MS) env.later(() => void get().readOrders(true), delay);
          return;
        case 'review':
          set({ phase: 'idle', review: { key: shown.key, review: outcome.review, receivedAt: outcome.receivedAt }, notice: { tone: 'warn', text: outcome.note } });
          return;
        case 'cancelled':
          set({ phase: 'idle', notice: { tone: 'info', text: wordsNow(LIMITS).notSigned } });
          return;
        case 'refused':
          set({ phase: 'idle', review: null, notice: { tone: 'error', text: outcome.refusal.message } });
          return;
        case 'failed':
          env.refreshHoldings(AFTER_ORDER_READS_MS);
          set({ phase: 'failed', review: null, failed: outcome.signature });
          return;
        case 'unclear':
          set({ phase: 'unclear', review: null, unclear: { signature: outcome.signature, message: outcome.message } });
          for (const delay of AFTER_ORDER_READS_MS) env.later(() => void get().readOrders(true), delay);
          return;
      }
    },

    setStop: async (input, nowOutRaw) => {
      const connection = env.wallet().connection;
      if (!env.open || !connection || get().phase !== 'idle') return;
      const owner = connection.address;
      const made = makeStop({ ...input, owner }, env.now(), nowOutRaw, env.id());
      if (!made.ok) return set({ notice: { tone: 'error', text: made.problem.text } });
      if (!env.engineStops) {
        writeStops(owner, [made.stop, ...ownStops(owner)]);
        return set({ phase: 'set', placed: { kind: 'stop', stop: made.stop }, notice: null });
      }
      // The engine keeps it: the wallet proves itself with one signed message (none when its proof is fresh), then the stop is sent.
      const my = ++actionTicket;
      set({ phase: 'wallet', notice: null });
      const proof = await env.prove(connection);
      if (my !== actionTicket) return;
      if (!proof.ok) return set({ phase: 'idle', notice: proof.state === 'declined' ? { tone: 'info', text: wordsNow(LIMITS).notSigned } : { tone: 'error', text: proof.message } });
      set({ phase: 'sending' });
      const answer = await env.stops.create({ side: input.side, base: input.base, quote: input.quote, amountRaw: input.amountRaw, price: input.price, expiry: input.expiry, locale: env.locale() });
      if (my !== actionTicket) return;
      if (!answer.ok) return set({ phase: 'idle', notice: { tone: answer.failure.code === 'STOP_REACHED' ? 'error' : 'warn', text: stopRefusal(answer.failure, input.side) } });
      const stop = stopOfView(answer.value, owner);
      writeStops(owner, [stop, ...ownStops(owner)]);
      set({ phase: 'set', placed: { kind: 'stop', stop }, notice: null });
    },

    again: () => {
      actionTicket += 1;
      set({ ...initial });
    },

    reset: () => {
      actionTicket += 1;
      marketTicket += 1;
      set({ ...initial, market: null, price: '', priceFor: null });
    },

    readOrders: async (force = false) => {
      const connection = env.wallet().connection;
      if (!env.open || !connection) return;
      const owner = connection.address;
      const now = get().orders;
      if (!force && now?.owner === owner && (now.status === 'reading' || (now.at !== null && env.now() - now.at < ORDERS_FRESH_MS))) return;
      const my = ++ordersTicket;
      set({ orders: now?.owner === owner ? { ...now, status: now.status === 'ready' ? 'ready' : 'reading' } : { owner, status: 'reading', list: [], tokens: {}, complete: false, at: null } });
      const answer = await env.api.orders(owner);
      if (my !== ordersTicket || env.wallet().connection?.address !== owner) return;
      const before = get().orders;
      if (!answer.ok) {
        // Older orders stay on screen with their time; with none, the list is unavailable, not empty.
        set({ orders: before && before.at !== null ? { ...before, status: 'ready' } : { owner, status: 'failed', list: [], tokens: {}, complete: false, at: null } });
        return;
      }
      set({ orders: { owner, status: 'ready', list: answer.value.orders ?? [], tokens: answer.value.tokens ?? {}, complete: answer.value.complete === true, at: env.now() } });
    },

    cancelOrder: async (order) => {
      const connection = env.wallet().connection;
      if (!env.open || !connection || get().cancelling) return;
      set({ cancelling: { key: order.key, phase: 'building' }, ordersNotice: null });
      const outcome = await cancelLimit(
        { owner: connection.address, venue: order.venue, order: order.order },
        { api: env.api, sign: (wire) => env.sign(connection, wire), now: env.now, onPhase: (phase) => phase !== 'reviewing' && set({ cancelling: { key: order.key, phase } }) },
      );
      const notice: Notice =
        outcome.kind === 'cancelled'
          ? { tone: 'info', text: outcome.settled ? wordsNow(LIMITS).orderCancelled : wordsNow(LIMITS).cancelSent }
          : outcome.kind === 'kept'
            ? { tone: 'info', text: outcome.message }
            : outcome.kind === 'refused'
              ? { tone: 'error', text: outcome.refusal.message }
              : { tone: 'warn', text: outcome.message };
      set({ cancelling: null, ordersNotice: notice });
      if (outcome.kind === 'cancelled' || outcome.kind === 'unclear') {
        env.refreshHoldings(AFTER_ORDER_READS_MS);
        void get().readOrders(true);
        for (const delay of AFTER_ORDER_READS_MS) env.later(() => void get().readOrders(true), delay);
      }
    },

    loadStops: () => {
      const owner = env.wallet().connection?.address ?? null;
      if (!owner) return set({ stops: [], stopsOwner: null });
      set({ stops: keptStops(ownStops(owner), env.now()), stopsOwner: owner });
      if (env.open && env.engineStops) void get().readEngineStops();
    },

    readEngineStops: async (force = false) => {
      const owner = env.wallet().connection?.address ?? null;
      if (!env.open || !env.engineStops || !owner) return;
      if (!force && engineRead?.owner === owner && env.now() - engineRead.at < ENGINE_READ_MS) return;
      engineRead = { owner, at: env.now() };
      const answer = await env.stops.list();
      // A wallet that has not proved itself, or an engine that did not answer: the device's copy stays as it was.
      if (!answer.ok || env.wallet().connection?.address !== owner) return;
      const ids = new Set(answer.value.map((view) => view.id));
      // The engine's word for its stops; the device's own stops (set before, or while the switch was shut) as they were.
      writeStops(owner, [...answer.value.map((view) => stopOfView(view, owner)), ...ownStops(owner).filter((stop) => !isEngineStop(stop) || (!ids.has(stop.id) && stop.state !== 'watching'))]);
    },

    cancelStop: async (id) => {
      const connection = env.wallet().connection;
      if (!connection) return;
      const owner = connection.address;
      const stop = ownStops(owner).find((item) => item.id === id);
      if (stop && isEngineStop(stop) && env.engineStops && (stop.state === 'watching' || stop.state === 'reached')) {
        // The engine lets it go only on the wallet's own word: one signed message when its proof is not fresh.
        const proof = await env.prove(connection);
        if (!proof.ok) return set({ ordersNotice: { tone: proof.state === 'declined' ? 'info' : 'error', text: proof.state === 'declined' ? wordsNow(LIMITS).notSigned : proof.message } });
        const answer = await env.stops.cancel(id);
        if (!answer.ok && answer.failure.code !== 'STOP_NOT_FOUND') return set({ ordersNotice: { tone: 'warn', text: wordsNow(STOPS).notKept } });
        if (env.wallet().connection?.address !== owner) return;
      }
      writeStops(owner, withState(ownStops(owner), id, { state: 'cancelled' }));
    },

    watchStops: async () => {
      const connection = env.wallet().connection;
      if (!env.open || !connection || watching) return [];
      const owner = connection.address;
      watching = true;
      const reached: Stop[] = [];
      try {
        for (const stop of stopsToWatch(ownStops(owner), owner, env.now())) {
          const quoted = await env.engine.quote({ inputMint: inputMintOf(stop), outputMint: outputMintOf(stop), amountRaw: stop.amountRaw });
          if (quoted.ok && stopReached(stop, quoted.value.order.outAmountRaw)) reached.push(stop);
        }
        if (env.wallet().connection?.address !== owner) return [];
        // Read again before writing: another tab may have changed the list in the meantime.
        let stops: readonly Stop[] = ownStops(owner);
        for (const stop of reached) stops = withState(stops, stop.id, { state: 'reached', reachedAt: env.now() });
        writeStops(owner, stops);
        // The engine's word too: the stops it reached, with the city closed or on another device.
        await get().readEngineStops();
        if (env.wallet().connection?.address !== owner) return [];
        return toOffer(owner, ownStops(owner), reached);
      } finally {
        watching = false;
      }
    },

    openSale: (stop) => {
      const trade = useTrade.getState();
      // A card in use — a trade or a limit's signature under way — is never taken over.
      if (trade.open && (trade.phase !== 'idle' || trade.held)) return;
      trade.openFor({ id: stop.base.mint, symbol: stop.base.symbol, name: stop.base.name, icon: null }, stop.side, { mode: 'market' });
      // Only on the stop's own card: the amount and the coin never land on another one.
      if (useTrade.getState().tower?.mint !== stop.base.mint) return;
      const pay: PayAsset = { mint: stop.quote.mint, symbol: stop.quote.symbol, decimals: stop.quote.decimals };
      if (isBase(pay)) useTrade.getState().setPay(pay.symbol);
      else useTrade.getState().pickCoin(pay);
      useTrade.getState().setTyped(rawToDecimal(stop.amountRaw, stop.side === 'buy' ? stop.quote.decimals : stop.base.decimals));
      useTrade.setState({ notice: { tone: 'warn', text: wordsNow(LIMITS).stopReached(digits(stop.price), unitOf(stop.quote)) } });
    },
  };
});

// A limit's signature out holds the trade card: it cannot be closed or switched under it.
useSpot.subscribe((state, before) => {
  if (state.phase !== before.phase) useTrade.setState({ held: SPOT_BUSY.has(state.phase) });
});

// Another coin, another side or way to trade, or the card closed: the ticket starts again from its fields.
useTrade.subscribe((state, before) => {
  if (SPOT_BUSY.has(useSpot.getState().phase)) return;
  if (!state.open || state.tower?.mint !== before.tower?.mint) {
    if (before.open || state.open) useSpot.getState().reset();
  } else if (state.mode !== before.mode || state.side !== before.side) useSpot.getState().again();
});

/**
 * A reached stop's sale that settled lets the stop go: a trade on the card of the stop's coins, after it was reached.
 */
useTrade.subscribe((state, before) => {
  if (!state.done || state.done === before.done) return;
  const spot = useSpot.getState();
  const owner = spot.stopsOwner;
  if (!owner) return;
  const { inputMint, outputMint } = state.done.trade;
  const stops = parseStops(env.storage.read(stopsKey(owner))).filter((stop) => stop.owner === owner);
  const match = stops.find((stop) => stop.state === 'reached' && inputMintOf(stop) === inputMint && outputMintOf(stop) === outputMint);
  if (!match) return;
  const kept = keptStops(withState(stops, match.id, { state: 'done' }), env.now());
  env.storage.write(stopsKey(owner), JSON.stringify(kept));
  useSpot.setState({ stops: kept });
  // The engine's stop is told too, on the proof the wallet already gave; without it the stop simply stays «reached» there.
  if (env.engineStops && isEngineStop(match)) void env.stops.finish(match.id).catch(() => undefined);
});
