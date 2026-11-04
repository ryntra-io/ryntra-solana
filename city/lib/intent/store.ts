import { create } from 'zustand';
import type { AddressEvidenceSummary } from '../../../lib/evidence/address.ts';
import { checkReturnedBytes } from '../../../lib/solana/fingerprint.client.ts';
import { forgetPendingSend, rememberPendingSend } from '../../../lib/solana/send-pending.client.ts';
import { storeSolanaReceipt } from '../../../lib/solana/send-receipt-vault.client.ts';
import { parseSwapClientAttempt, type SwapClientAttempt } from '../../../lib/solana/swap-client-safety.ts';
import { resolveSkrName } from '../../../lib/solana/skr.client.ts';
import type { SolanaEnvironmentContext } from '../../../lib/solana/environment.ts';
import { citySigner } from '../app-bridge/route.ts';
import { wordsNow } from '../i18n/dict.ts';
import { ask, browserFetch, V1, type FetchLike } from '../money/engine.ts';
import { riskOf } from '../money/recipient.ts';
import { blockedLine, confirmSend, reviewSend, signable, type SendBundle, type SendDeps, type SendIntent, type SignResult } from '../money/send.ts';
import { createEngine, type Engine, type OrderBody, type QuoteBody } from '../trade/engine.ts';
import { orderMatchesQuote } from '../trade/figures.ts';
import { confirmTrade, prepareOrder, recoverTrade, RECOVERY_DEADLINE_MS, RECOVERY_INTERVAL_MS, type AttemptStore, type FlowDeps, type Intent as TradeIntent, type TradeOutcome } from '../trade/flow.ts';
import { quoteLine } from '../trade/quote-copy.ts';
import { useWallet } from '../trade/wallet.ts';
import * as api from './api.ts';
import { goneOfCode, goneOfStatus, orderFitsIntent, planFitsIntent, swapLeg, type Gone, type Intent, type IntentTransferSpec } from './check.ts';
import { INTENT_LINES } from './words.ts';

/**
 * The sheet a prepared action opens in the city (CITY-161): `ryntra.io/i/<id>`. It shows who prepared it, the engine's
 * own live quote (a swap) or the real recipient with the engine's checks (a transfer), and one action. The press claims
 * the intent for this wallet, has the engine build the exact transaction, refuses anything that is not what was
 * prepared, and opens the person's wallet — the same swap and transfer flows every other window of the city runs, so
 * the engine sends the signed bytes once and reads the chain back. Before the engine may send them, the wallet's signed
 * bytes mark the claim on the server: from then on this intent is only ever read back by that signature and receipted —
 * after a reload, on another device, after an answer that never came — never signed again. A wallet that said no before
 * anything was signed lets the intent go. Nothing here holds a key or prices anything.
 */

export type Phase = 'idle' | 'claiming' | 'preparing' | 'wallet' | 'sending' | 'checking' | 'recording';
export const BUSY_PHASES: ReadonlySet<Phase> = new Set(['claiming', 'preparing', 'wallet', 'sending', 'checking', 'recording']);

/** How the sheet names the coin: its own words when the engine or the city knows them, its address cut short otherwise. */
export type CoinLook = Readonly<{ mint: string; symbol: string; name: string | null; icon: string | null; verified: boolean | null }>;

export type Line = Readonly<{ tone: 'info' | 'warn' | 'error'; text: string }>;

/** How it ended; the signature only where this answer may carry it (the wallet's own step, never a stranger's read). */
export type Done = Readonly<{ signature: string | null; failed: boolean; recorded: boolean; outRaw?: string | null }>;

export type IntentState = Readonly<{
  id: string | null;
  open: boolean;
  view: Intent | null;
  gone: Gone | null;
  coin: CoinLook | null;
  quote: Readonly<{ body: QuoteBody; at: number }> | null;
  quoteState: 'none' | 'reading' | 'ready' | 'failed';
  /** Fresh figures from the exact order, shown when the price moved since the quote: a second press signs them. */
  order: Readonly<{ body: OrderBody; receivedAt: number }> | null;
  review: Readonly<{ bundle: SendBundle; authorized: SolanaEnvironmentContext; owner: string }> | null;
  reviewState: 'none' | 'reading' | 'ready' | 'failed';
  risk: AddressEvidenceSummary | null;
  /** The signature this intent's claim was marked with — once known, the sheet only reads it back, never signs again. */
  sent: string | null;
  phase: Phase;
  line: Line | null;
  done: Done | null;
}>;

type Actions = Readonly<{
  /** Opens the sheet for the intent the address names, with what the page already read. */
  start: (input: Readonly<{ id: string; view: Intent | null; gone: Gone | null; coin: CoinLook | null }>) => void;
  close: () => void;
  /** The engine's quote (a swap) or Review (a transfer, once a wallet is connected), read again. */
  refresh: () => Promise<void>;
  confirm: () => Promise<void>;
}>;

/** Everything the sheet reaches outside itself; tests put stubs here. */
export type IntentEnv = Readonly<{
  fetch: FetchLike;
  engine: Engine;
  sign: (connection: Readonly<{ wallet: string; address: string }>, wire: string) => Promise<SignResult>;
  connection: () => Readonly<{ wallet: string; address: string }> | null;
  attempts: AttemptStore;
  checkReturned: SendDeps['checkReturned'];
  storage: () => Storage | null;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  refreshCity: () => void;
}>;

/** The one record of an open swap signature, shared with every trade surface of Ryntra in this tab. */
const ATTEMPT_KEY = 'ryntra.solana.m2.swap-client-attempt.v1';

const session = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};
const local = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
};

const browserAttempts: AttemptStore = {
  read: () => {
    try {
      return parseSwapClientAttempt(session()?.getItem(ATTEMPT_KEY) ?? null);
    } catch {
      return null;
    }
  },
  write: (attempt) => {
    try {
      session()?.setItem(ATTEMPT_KEY, JSON.stringify(attempt));
    } catch {
      // Without storage the server's own lock still holds the signature.
    }
  },
  clear: () => {
    try {
      session()?.removeItem(ATTEMPT_KEY);
    } catch {
      // Nothing to clear.
    }
  },
};

const memory: Storage = (() => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  };
})();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let env: IntentEnv = {
  fetch: browserFetch,
  engine: createEngine(),
  sign: (connection, wire) => citySigner.signTransaction({ wallet: connection.wallet, address: connection.address, unsignedWireBase64: wire, chain: 'solana:mainnet' }),
  connection: () => useWallet.getState().connection,
  attempts: browserAttempts,
  checkReturned: (plan, signed) => checkReturnedBytes({ plan, signedWireBase64: signed }),
  storage: local,
  now: () => Date.now(),
  sleep,
  refreshCity: () => useWallet.getState().refreshHoldings([1_500, 7_000]),
};

/** Swap what the sheet reaches: for tests, and nothing else. */
export function setIntentEnv(next: Partial<IntentEnv>): void {
  env = { ...env, ...next };
  // What one storage could not take is not owed to another.
  if (next.storage) overflow = null;
}

const EMPTY: IntentState = {
  id: null,
  open: false,
  view: null,
  gone: null,
  coin: null,
  quote: null,
  quoteState: 'none',
  order: null,
  review: null,
  reviewState: 'none',
  risk: null,
  sent: null,
  phase: 'idle',
  line: null,
  done: null,
};

const DECIMALS_KNOWN: Readonly<Record<string, number>> = { SOL: 9, So11111111111111111111111111111111111111112: 9, EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6 };

/** The decimals of a transfer's coin as far as anything the city read says them; null until the Review does. */
export function transferDecimals(spec: IntentTransferSpec, review: IntentState['review']): number | null {
  if (review) return review.bundle.plan.decimals;
  if (DECIMALS_KNOWN[spec.coin] !== undefined) return DECIMALS_KNOWN[spec.coin]!;
  const held = useWallet.getState().holdings?.tokens.get(spec.coin);
  return held ? held.decimals : null;
}

function sendIntentOf(spec: IntentTransferSpec, connection: Readonly<{ wallet: string; address: string }>, decimals: number, symbol: string): SendIntent {
  const native = spec.coin === 'SOL';
  return { wallet: connection.wallet, sender: connection.address, asset: { native, mint: native ? null : spec.coin, decimals, symbol }, recipient: spec.to, amountRaw: spec.amountRaw, name: null };
}

/** Where this device keeps the signature each intent was marked with, so a reload reads it back instead of signing. */
const SENT_KEY = 'ryntra.intent.sent.v2';

/**
 * What this device knows of an intent's marks: the live one — signed bytes that may have left, read back by their
 * signature — and every dead one: bytes this device held back (the engine refused them before its submit boundary, or
 * their mark's answer never came and the flow refused them), or a signature the chain says never landed. A dead
 * signature is never forgotten while the intent lives, whatever is marked after it.
 */
type SentLive = Readonly<{ signature: string; wallet: string; requestId: string | null }>;
type SentEntry = Readonly<{ live: SentLive | null; dead: readonly string[]; at: number }>;

/** The book as last written when storage refused it (full or blocked): read beside storage for the life of this page. */
let overflow: string | null = null;

/** Where the book lives: the device's storage, or memory when the browser keeps none. */
const sentStore = (): Storage => {
  try {
    return env.storage() ?? memory;
  } catch {
    return memory;
  }
};

/** Only rows that read as an entry: anything else in storage is ignored, never a reason to fail. */
function rowsOf(raw: string | null): Record<string, SentEntry> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter(([, row]) => row !== null && typeof row === 'object' && typeof (row as SentEntry).at === 'number')) as Record<string, SentEntry>;
  } catch {
    return {};
  }
}

function sentBook(): Record<string, SentEntry> {
  let stored: Record<string, SentEntry> = {};
  try {
    stored = rowsOf(sentStore().getItem(SENT_KEY));
  } catch {
    stored = {};
  }
  // Whatever storage could not take: per intent, the newer entry wins and the dead signatures add up.
  const kept = rowsOf(overflow);
  const book: Record<string, SentEntry> = { ...stored };
  for (const [id, row] of Object.entries(kept)) {
    const other = book[id];
    const newer = !other || row.at >= other.at ? row : other;
    book[id] = { ...newer, dead: [...new Set([...(Array.isArray(other?.dead) ? other.dead : []), ...(Array.isArray(row.dead) ? row.dead : [])])] };
  }
  return book;
}

function writeSentBook(book: Record<string, SentEntry>): void {
  // A day is longer than any intent lives; older entries are forgotten.
  const text = JSON.stringify(Object.fromEntries(Object.entries(book).filter(([, row]) => env.now() - row.at < 86_400_000)));
  try {
    sentStore().setItem(SENT_KEY, text);
    overflow = null;
  } catch {
    // A full or blocked storage: this page keeps it, and reads merge both.
    overflow = text;
  }
}

function entryOf(id: string): SentEntry {
  const row = sentBook()[id];
  const live = row?.live && typeof row.live.signature === 'string' && typeof row.live.wallet === 'string' ? row.live : null;
  return { live, dead: Array.isArray(row?.dead) ? row.dead.filter((sig) => typeof sig === 'string') : [], at: row?.at ?? env.now() };
}

/** The signature this device marked and that may have left; null when there is none. */
export function readSent(id: string): SentLive | null {
  return entryOf(id).live;
}

/** Whether this device knows these bytes never left. */
export function isDeadSent(id: string, signature: string): boolean {
  return entryOf(id).dead.includes(signature);
}

function keepSent(id: string, live: SentLive): void {
  const entry = entryOf(id);
  writeSentBook({ ...sentBook(), [id]: { live, dead: entry.dead.filter((sig) => sig !== live.signature), at: env.now() } });
}

/** These bytes never left: kept as dead, and no longer the live mark if they were. */
function killSent(id: string, signature: string): void {
  const entry = entryOf(id);
  const live = entry.live?.signature === signature ? null : entry.live;
  writeSentBook({ ...sentBook(), [id]: { live, dead: [...new Set([...entry.dead, signature])], at: env.now() } });
}

/** For the store's tests only. */
export const __sentBookForTests = Object.freeze({ kill: (id: string, signature: string) => killSent(id, signature) });

function forgetSent(id: string): void {
  const book = sentBook();
  delete book[id];
  writeSentBook(book);
}

/** A mark's failure that leaves open whether the server took it: no answer, or the server's own trouble. */
const AMBIGUOUS = /^(TIMEOUT|NETWORK|UNAVAILABLE|UNREADABLE|ABORTED|HTTP_5\d\d)$/;

/** One press of «Confirm»: the intent it began on and the mark it may replace; `marked` once its own mark is taken. */
type Press = { id: string; digest: string; replaces: string | null; marked: string | null };

export type ReadBack = Readonly<{ kind: 'settled'; signature: string; outRaw: string | null } | { kind: 'failed'; signature: string } | { kind: 'nothing'; message: string } | { kind: 'unknown'; message: string }>;

export const useIntent = create<IntentState & Actions>((set, get) => {
  let ticket = 0;

  const say = (tone: Line['tone'], text: string) => set({ line: { tone, text } });

  /** The intent is no longer what opens a sheet: said once, the action gone. */
  const goneWith = (gone: Gone) => set({ gone, phase: 'idle', line: null });

  /** The person's wallet signs these exact bytes — while it is still the wallet that claimed. */
  const signWith = (connection: Readonly<{ wallet: string; address: string }>, wire: string): Promise<SignResult> => {
    const now = env.connection();
    if (!now || now.address !== connection.address) return Promise.resolve({ ok: false, reason: wordsNow(INTENT_LINES).walletChanged });
    return env.sign(connection, wire);
  };

  /**
   * The signed bytes passed every check of the flow and are about to go to the engine: first they mark the claim on the
   * server. A mark that could not be made stops the flow there, and nothing leaves.
   */
  const markBeforeSend = async (press: Press, wallet: string, signed: Readonly<{ signedWireBase64: string; signature: string; requestId?: string }>) => {
    const w = wordsNow(INTENT_LINES);
    const marked = await api.mark(env.fetch, press.id, { digest: press.digest, wallet, signedWireBase64: signed.signedWireBase64, replaces: press.replaces }).catch(() => null);
    if (!marked?.ok || marked.intent.sentSignature !== signed.signature) {
      // The gate refuses, so these bytes never leave this tab. Where the server may still have taken the mark (no answer,
      // its own trouble, an answer that is not this mark), this device keeps the signature as dead, so the next press
      // builds afresh instead of waiting on a signature that never left. A clear refusal took nothing.
      const unclear = !marked || (marked.ok && marked.intent.sentSignature !== signed.signature) || (!marked.ok && (AMBIGUOUS.test(marked.code) || marked.status === 0 || (marked.status >= 500 && marked.code !== 'CAPABILITY_UNAVAILABLE')));
      if (unclear) killSent(press.id, signed.signature);
      return { ok: false as const, message: w.notMarked };
    }
    keepSent(press.id, { signature: signed.signature, wallet, requestId: signed.requestId ?? null });
    press.replaces = signed.signature;
    press.marked = signed.signature;
    if (get().id === press.id) set({ sent: signed.signature, view: marked.intent });
    return { ok: true as const };
  };

  /** The shared record of an open swap signature, and beside it this intent's own: the request the signature belongs to. */
  const attemptsFor = (): AttemptStore => ({
    read: () => env.attempts.read(),
    write: (attempt) => {
      env.attempts.write(attempt);
      const { id, sent } = get();
      if (id && sent && attempt.signature === sent) keepSent(id, { signature: sent, wallet: attempt.taker, requestId: attempt.requestId });
    },
    clear: () => env.attempts.clear(),
  });

  const flowDeps = (connection: Readonly<{ wallet: string; address: string }>, press: Press): FlowDeps => ({
    engine: env.engine,
    sign: (wire) => signWith(connection, wire),
    attempts: attemptsFor(),
    now: env.now,
    sleep: env.sleep,
    onPhase: (phase) => set({ phase }),
    beforeSend: (signed) => markBeforeSend(press, connection.address, signed),
  });

  const sendDeps = (connection: Readonly<{ wallet: string; address: string }>, press: Press | null = null): SendDeps => ({
    fetch: env.fetch,
    sign: (wire) => signWith(connection, wire),
    ...(press ? { beforeSend: (signed: Readonly<{ signedWireBase64: string; signature: string }>) => markBeforeSend(press, connection.address, signed) } : {}),
    checkReturned: env.checkReturned,
    resolveName: (name) => resolveSkrName(name),
    pending: {
      remember: (pending) => void rememberPendingSend(env.storage() ?? memory, pending),
      forget: (wallet) => void forgetPendingSend(env.storage() ?? memory, wallet),
    },
    keepReceipt: (wallet, receipt) => void storeSolanaReceipt(env.storage() ?? memory, wallet, receipt),
    // A recipient an agent named is not one the person chose: it stays out of their recent list.
    rememberRecipient: () => undefined,
    now: env.now,
    onPhase: (phase) => set({ phase: phase === 'reviewing' ? 'preparing' : phase }),
  });

  /**
   * A marked signature read back from the chain through the swap engine's recovery route — which accepts no bytes and
   * moves nothing. With the request it belongs to (this device signed it) the trade flow's own recovery; without it
   * (another device) the same route by the signature alone.
   */
  const readBack = async (signature: string, owner: string, requestId: string | null): Promise<ReadBack> => {
    const w = wordsNow(INTENT_LINES);
    set({ phase: 'checking' });
    if (requestId) {
      const attempt: SwapClientAttempt = { schema: 'ryntra.solana.swap-client-attempt', schemaVersion: '1.0.0', requestId, signature, taker: owner, state: 'SUBMITTED_UNKNOWN', recordedAt: new Date(env.now()).toISOString() };
      const outcome = await recoverTrade(attempt, { engine: env.engine, sign: async () => ({ ok: false, reason: '' }), attempts: attemptsFor(), now: env.now, sleep: env.sleep });
      if (outcome.kind === 'settled') return { kind: 'settled', signature, outRaw: outcome.trade.outputRaw };
      if (outcome.kind === 'failed') return { kind: 'failed', signature };
      if (outcome.kind === 'nothing') return { kind: 'nothing', message: outcome.message };
      return { kind: 'unknown', message: 'message' in outcome ? outcome.message : w.stillUnknown };
    }
    const deadline = env.now() + RECOVERY_DEADLINE_MS;
    for (;;) {
      const read = await env.engine.recover({ owner, signature });
      if (read.ok) {
        const state = read.value.state;
        // Seen on chain (with or without the engine's record): it landed. Whether it failed is the server's chain read.
        const observation = 'observation' in read.value ? (read.value.observation as { actualOutputRaw?: unknown } | null | undefined) : null;
        const outRaw = typeof observation?.actualOutputRaw === 'string' ? observation.actualOutputRaw : null;
        if (state === 'RECOVERED' || state === 'ALREADY_RECEIPTED' || state === 'SEEN_WITHOUT_RECORD') return { kind: 'settled', signature, outRaw };
        if (state === 'FAILED') return { kind: 'failed', signature };
        if (state === 'UNKNOWN_TO_CHAIN' || state === 'EXPIRED_BEFORE_SUBMIT' || state === 'EXPIRED_AFTER_SUBMIT') return { kind: 'nothing', message: w.nothingLeft };
      }
      if (env.now() >= deadline) return { kind: 'unknown', message: w.stillUnknown };
      await env.sleep(RECOVERY_INTERVAL_MS);
    }
  };

  /** Let the intent go after a «no» or a refusal before anything was signed; quietly, since nothing moved. */
  const letGo = async (connection: Readonly<{ address: string }>) => {
    const { id, view, sent } = get();
    // Signed bytes marked the claim: it is never let go, only read back (the server refuses it too).
    if (!id || !view || sent) return;
    const answer = await api.release(env.fetch, id, { digest: view.digest, wallet: connection.address }).catch(() => null);
    if (answer?.ok && get().id === id) set({ view: answer.intent });
  };

  /** The signature that went out, recorded on the intent — the agent reads it back from there. */
  const record = async (connection: Readonly<{ address: string }>, signature: string, failed: boolean, outRaw: string | null = null) => {
    const { id, view } = get();
    if (!id || !view) return;
    set({ phase: 'recording' });
    const answer = await api.receipt(env.fetch, id, { digest: view.digest, wallet: connection.address, signature }, env.sleep).catch(() => null);
    if (get().id !== id) return;
    if (answer?.ok) {
      set({ view: answer.intent });
      forgetSent(id);
    }
    // Where the server read the chain, its word decides whether the transaction failed; the city's guess otherwise.
    const chain = answer?.ok ? answer.intent.receipt?.chain : undefined;
    const lost = chain === 'FAILED' ? true : chain === 'CONFIRMED' ? false : failed;
    set({ phase: 'idle', done: { signature, failed: lost, recorded: Boolean(answer?.ok), outRaw }, line: null, order: null });
    env.refreshCity();
  };

  /** A marked signature, read back and receipted — or, when the chain says nothing left, forgotten so a fresh build may follow. */
  const resume = async (owner: string, signature: string, requestId: string | null): Promise<'done' | 'nothing' | 'unknown'> => {
    const id = get().id;
    const back = await readBack(signature, owner, requestId);
    if (get().id !== id) return 'unknown';
    if (back.kind === 'settled' || back.kind === 'failed') {
      await record({ address: owner }, signature, back.kind === 'failed', back.kind === 'settled' ? back.outRaw : null);
      return 'done';
    }
    if (back.kind === 'nothing') {
      // Kept as dead, not forgotten: the server still holds this mark, and the next press must know it never left.
      if (id) killSent(id, signature);
      set({ sent: null, phase: 'idle' });
      say('info', back.message);
      return 'nothing';
    }
    set({ phase: 'idle' });
    say('warn', back.message);
    return 'unknown';
  };

  const readQuote = async () => {
    const { view } = get();
    if (!view || view.spec.action !== 'swap') return;
    const my = ++ticket;
    if (!get().quote) set({ quoteState: 'reading' });
    const priced = await env.engine.quote(swapLeg(view.spec));
    if (my !== ticket || get().view?.id !== view.id) return;
    if (!priced.ok) {
      set({ quoteState: get().quote ? 'ready' : 'failed' });
      if (!get().quote) say('warn', quoteLine(priced.failure.code).text);
      return;
    }
    // A price that arrives after one that could not be read takes that line away; any other line stays.
    const recovered = get().quoteState === 'failed';
    set({ quote: { body: priced.value, at: env.now() }, quoteState: 'ready', ...(recovered ? { line: null } : {}) });
  };

  const readRisk = async () => {
    const { view } = get();
    if (!view || view.spec.action !== 'transfer') return;
    const answer = await ask<unknown>(env.fetch, `/api/v1/research/address-evidence?address=${encodeURIComponent(view.spec.to)}`, { headers: V1 });
    if (get().view?.id === view.id) set({ risk: answer.ok ? riskOf(answer.value) : 'unavailable' });
  };

  const readReview = async () => {
    const { view, coin } = get();
    const connection = env.connection();
    if (!view || view.spec.action !== 'transfer' || !connection) return;
    const spec = view.spec;
    const my = ++ticket;
    set({ reviewState: 'reading' });
    const decimals = transferDecimals(spec, null) ?? 0;
    const outcome = await reviewSend(sendDeps(connection), sendIntentOf(spec, connection, decimals, coin?.symbol ?? 'SOL'));
    if (my !== ticket || get().view?.id !== view.id) return;
    if (outcome.kind === 'refused') {
      set({ review: null, reviewState: 'failed', phase: 'idle' });
      say('error', outcome.refusal.message);
      return;
    }
    if (!planFitsIntent(outcome.bundle.plan, spec, connection.address)) {
      set({ review: null, reviewState: 'failed', phase: 'idle' });
      say('error', wordsNow(INTENT_LINES).notWhatWasPrepared);
      return;
    }
    set({ review: { bundle: outcome.bundle, authorized: outcome.authorized, owner: connection.address }, reviewState: 'ready', phase: 'idle', line: signable(outcome.bundle) ? null : { tone: 'warn', text: blockedLine(outcome.bundle) } });
  };

  const settleTrade = async (outcome: TradeOutcome, connection: Readonly<{ wallet: string; address: string }>) => {
    const w = wordsNow(INTENT_LINES);
    switch (outcome.kind) {
      case 'settled':
        return record(connection, outcome.trade.signature, false, outcome.trade.outputRaw);
      case 'failed':
        return record(connection, outcome.signature, true);
      case 'review':
        set({ order: { body: outcome.order, receivedAt: outcome.receivedAt }, phase: 'idle' });
        return say('warn', outcome.note);
      case 'unknown':
        // A signature may be on its way: never let the intent go, never sign again.
        set({ phase: 'idle' });
        return say('warn', outcome.message);
      case 'locked':
        set({ phase: 'idle' });
        return say('warn', w.swapOnItsWay);
      case 'cancelled':
        set({ phase: 'idle' });
        say('info', outcome.message);
        return letGo(connection);
      case 'nothing':
        set({ phase: 'idle' });
        say('info', outcome.message);
        return letGo(connection);
      case 'refused':
        set({ phase: 'idle' });
        say('error', outcome.refusal.message);
        return letGo(connection);
      case 'ready':
        set({ phase: 'idle' });
        return;
    }
  };

  const confirmSwap = async (view: Intent, connection: Readonly<{ wallet: string; address: string }>, press: Press) => {
    if (view.spec.action !== 'swap') return;
    const spec = view.spec;
    const intent: TradeIntent = { side: spec.side, ...swapLeg(spec), taker: connection.address };
    const deps = flowDeps(connection, press);
    let order = get().order;
    if (!order) {
      const prepared = await prepareOrder(intent, deps);
      // The sheet moved to another intent meanwhile: nothing of this press touches it.
      if (get().id !== press.id) return;
      if (prepared.kind !== 'ready') return settleTrade(prepared, connection);
      order = { body: prepared.order, receivedAt: prepared.receivedAt };
    }
    if (!orderFitsIntent(order.body.order, spec, connection.address)) {
      set({ phase: 'idle', order: null });
      say('error', wordsNow(INTENT_LINES).notWhatWasPrepared);
      return letGo(connection);
    }
    // The figures on the sheet were the quote's: an order that is worse is shown first and signed on the next press.
    const quoted = get().quote?.body.order;
    if (!get().order && (!quoted || !orderMatchesQuote(quoted, order.body))) {
      set({ order, phase: 'idle' });
      return say('warn', wordsNow(INTENT_LINES).priceMoved);
    }
    set({ order: null });
    const outcome = await confirmTrade({ intent, order: order.body, receivedAt: order.receivedAt }, deps);
    // Marked in this press and then refused by the engine before its submit boundary (a refusal, fresh figures, the
    // wallet's other open swap) or never landed: those bytes never left. The mark stays on the server; this device knows
    // it is dead, so the next press builds afresh.
    const dead = ['refused', 'review', 'nothing', 'cancelled', 'locked'];
    if (press.marked && dead.includes(outcome.kind)) {
      killSent(press.id, press.marked);
      if (get().id === press.id) set({ sent: null });
    }
    if (get().id !== press.id) return;
    return settleTrade(outcome, connection);
  };

  const confirmTransfer = async (view: Intent, connection: Readonly<{ wallet: string; address: string }>, press: Press) => {
    if (view.spec.action !== 'transfer') return;
    const spec = view.spec;
    const w = wordsNow(INTENT_LINES);
    let review = get().review;
    if (!review || review.owner !== connection.address) {
      await readReview();
      if (get().id !== press.id) return;
      review = get().review;
      if (!review) return letGo(connection);
    }
    if (!planFitsIntent(review.bundle.plan, spec, connection.address)) {
      set({ phase: 'idle' });
      say('error', w.notWhatWasPrepared);
      return letGo(connection);
    }
    if (!signable(review.bundle)) {
      set({ phase: 'idle' });
      say('warn', blockedLine(review.bundle));
      return letGo(connection);
    }
    const intent = sendIntentOf(spec, connection, review.bundle.plan.decimals, get().coin?.symbol ?? 'SOL');
    // The Review was authorized over this intent's coin, amount, recipient and wallet: a fresh build that differs on any
    // of them comes back as a Review, never as a signature.
    const outcome = await confirmSend(sendDeps(connection, press), intent, review.authorized);
    // The sheet moved to another intent meanwhile: nothing of this press touches it.
    if (get().id !== press.id) return;
    switch (outcome.kind) {
      case 'settled':
        if (outcome.settled.observed) return record(connection, outcome.settled.signature, false);
        set({ phase: 'idle' });
        say('warn', outcome.line ?? w.notConfirmed);
        // Not observed: the signature may still land, so the intent is held until its claim runs out.
        return;
      case 'unresolved':
        set({ phase: 'idle' });
        return say('warn', outcome.line);
      case 'review':
        if (!planFitsIntent(outcome.bundle.plan, spec, connection.address)) {
          set({ phase: 'idle', review: null });
          say('error', w.notWhatWasPrepared);
          return letGo(connection);
        }
        set({ phase: 'idle', review: { bundle: outcome.bundle, authorized: outcome.authorized, owner: connection.address } });
        return say('warn', outcome.line);
      case 'cancelled':
        set({ phase: 'idle' });
        say('info', outcome.line);
        return letGo(connection);
      case 'refused':
        set({ phase: 'idle' });
        say('error', outcome.refusal.message);
        return letGo(connection);
    }
  };

  return {
    ...EMPTY,

    start: ({ id, view, gone, coin }) => {
      ticket += 1;
      const lapsed = view ? goneOfStatus(view.status) : null;
      const done: Done | null = view?.status === 'DONE' ? { signature: view.receipt?.signature ?? null, failed: view.receipt?.chain === 'FAILED', recorded: true } : null;
      // This device marked a signature for this intent: it is read back and receipted, never signed again.
      const local = !done && view && (view.status === 'CLAIMED' || view.status === 'LAPSED') ? readSent(id) : null;
      set({ ...EMPTY, id, open: true, view, coin, gone: gone ?? (local ? null : lapsed), done, sent: local?.signature ?? null });
      if (done && view?.status === 'DONE') forgetSent(id);
      if (gone || done) return;
      if (!view) {
        // The page could not read it just now: the city asks once more itself.
        void api.readOne(env.fetch, id).then((answer) => {
          if (get().id !== id) return;
          if (answer.ok) return get().start({ id, view: answer.intent, gone: null, coin });
          const lost = goneOfCode(answer.code);
          if (lost) return goneWith(lost);
          say('error', wordsNow(INTENT_LINES).notReached);
        });
        return;
      }
      if (local && view.spec.action === 'swap') {
        void resume(local.wallet, local.signature, local.requestId).then((result) => {
          if (get().id !== id || result !== 'nothing') return;
          if (view.status === 'LAPSED') return goneWith('used');
          void get().refresh();
        });
        return;
      }
      if (local) {
        say('warn', wordsNow(INTENT_LINES).transferOnItsWay);
        return;
      }
      if (lapsed) return;
      void get().refresh();
      if (view.spec.action === 'transfer') void readRisk();
    },

    close: () => {
      if (BUSY_PHASES.has(get().phase)) return;
      ticket += 1;
      set({ open: false });
    },

    refresh: async () => {
      const { view, gone, done, phase } = get();
      if (!view || gone || done || phase !== 'idle') return;
      if (view.spec.action === 'swap') return readQuote();
      return readReview();
    },

    confirm: async () => {
      const { id, view, gone, done, phase } = get();
      const connection = env.connection();
      if (!id || !view || gone || done || BUSY_PHASES.has(phase)) return;
      // A signature this device marked and that may have left is read back first — a receipt needs no new claim, and a
      // lapsed claim can still be receipted by it.
      const local = readSent(id);
      if (local && view.spec.action === 'swap') {
        set({ line: null });
        const result = await resume(local.wallet, local.signature, local.requestId);
        if (result !== 'nothing' || get().id !== id) return;
        if (view.status === 'LAPSED') return goneWith('used');
      }
      if (!connection) return;
      // An intent bound to another wallet is never claimed from this one.
      if (view.for && view.for !== connection.address) return say('warn', wordsNow(INTENT_LINES).otherWallet);
      if (Date.parse(view.expiresAt) <= env.now() && view.status === 'OPEN') return goneWith('expired');
      set({ phase: 'claiming', line: null });
      const claimed = await api.claim(env.fetch, id, { digest: view.digest, wallet: connection.address });
      if (get().id !== id) return;
      if (!claimed.ok) {
        const lost = goneOfCode(claimed.code);
        if (lost) return goneWith(lost);
        set({ phase: 'idle' });
        const w = wordsNow(INTENT_LINES);
        if (claimed.code === 'INTENT_WRONG_WALLET') return say('warn', w.otherWallet);
        return say(claimed.code === 'INTENT_BUSY' ? 'warn' : 'error', claimed.code === 'INTENT_BUSY' ? w.busy : w.notReached);
      }
      set({ view: claimed.intent, phase: 'preparing' });
      try {
        // Bytes of this claim were already marked (this tab, a reload, another device): read them back, never sign again.
        const marked = claimed.intent.sentSignature;
        const known = readSent(id);
        // A mark this device knows never left: a fresh build follows, and its own mark replaces it.
        if (marked && !isDeadSent(id, marked)) {
          set({ sent: marked });
          if (view.spec.action !== 'swap') {
            set({ phase: 'idle' });
            return say('warn', wordsNow(INTENT_LINES).transferOnItsWay);
          }
          const result = await resume(connection.address, marked, known?.signature === marked ? known.requestId : null);
          // Only when the chain says those bytes never left does a fresh build follow, marking the claim anew.
          if (result !== 'nothing') return;
          set({ phase: 'preparing' });
        }
        // This press, captured: the intent it is for and the mark it began from (a dead one is what a fresh mark replaces).
        const press: Press = { id, digest: claimed.intent.digest, replaces: claimed.intent.sentSignature, marked: null };
        if (view.spec.action === 'swap') await confirmSwap(claimed.intent, connection, press);
        else await confirmTransfer(claimed.intent, connection, press);
      } catch {
        set({ phase: 'idle' });
        say('error', wordsNow(INTENT_LINES).notReached);
      }
    },
  };
});
