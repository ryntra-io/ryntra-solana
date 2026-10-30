import { create } from 'zustand';
import type { EngineResult } from '../../trade/engine.ts';
import type { Json } from './engine.ts';
import { failureWords, moving, readFunding, readLinked, readLive, readOrder, readReview, readWithdrawPreview, statusOf, type Funding, type Live, type OrderLine, type OrderState, type Review, type WithdrawPreview } from './real.ts';
import type { Signed } from './sign.ts';
import { predictEnv } from './store.ts';
import { wordsNow } from '../../i18n/dict.ts';
import { PREDICT_TEXT } from './words.ts';

/**
 * Real money in the window, for one proven Solana wallet, through the engine's own routes and gates: the wallet proves
 * itself to Ryntra (one signed message), the managed account opens with the provider's sign-in (one more), then a buy
 * or a sale is a Review the engine prices — what leaves the account, the fee, what it pays if right — and the order the
 * person confirms on it. Deposit is the account's own Solana address; a withdrawal goes back to the proven wallet only.
 * Nothing here signs a transaction or holds a key: AGG's managed wallet signs the trades, as on the web's Predictions.
 */

export type Connection = Readonly<{ wallet: string; address: string }>;

/** What the wallet is asked: Ryntra's own proof (one signed message), and the provider's sign-in text, verbatim. */
export type RealDeps = Readonly<{
  prove: (connection: Connection) => Promise<Readonly<{ ok: true }> | Readonly<{ ok: false; state: 'declined' | 'failed'; message: string }>>;
  sign: (wallet: string, address: string, text: string) => Promise<Signed>;
}>;

// The wallet's modules load only in a browser, when a wallet is first asked.
let deps: RealDeps = {
  prove: async (connection) => (await import('../../trade/proof.ts')).proveWallet(connection),
  sign: async (wallet, address, text) => (await import('./sign.ts')).signText(wallet, address, text),
};

/** Tests put their own wallet here. */
export function setRealDeps(next: Partial<RealDeps>): void {
  deps = { ...deps, ...next };
}

export type Ask = Readonly<{ eventId: string; marketId: string; outcomeId: string; side: 'buy' | 'sell'; spendUsd?: number; sellShares?: number }>;

/** What the ticket knows of the market an order is for, so its line reads at once — before the engine's record does. */
export type AskedFor = Readonly<{ title: string }>;

export type TradePhase =
  | Readonly<{ step: 'idle' }>
  | Readonly<{ step: 'quoting'; key: string }>
  | Readonly<{ step: 'review'; key: string; review: Review; ask: Ask }>
  | Readonly<{ step: 'placing'; key: string; review: Review; ask: Ask }>
  | Readonly<{ step: 'done'; key: string; review: Review; state: OrderState }>
  | Readonly<{ step: 'failed'; key: string; text: string }>;

export type WithdrawPhase =
  | Readonly<{ step: 'idle' }>
  | Readonly<{ step: 'pricing' }>
  | Readonly<{ step: 'review'; preview: WithdrawPreview; requestId: string }>
  | Readonly<{ step: 'sending'; preview: WithdrawPreview; requestId: string }>
  /** Recorded by the engine: on its way, arrived, or still being asked about. */
  | Readonly<{ step: 'sent'; requestId: string; phase: string }>
  | Readonly<{ step: 'failed'; text: string }>;

type Store = {
  owner: string | null;
  live: Live | null;
  liveRead: 'none' | 'reading' | 'ready' | 'failed';
  funding: Funding | null;
  /** A step of opening the account in flight: the wallet's proof, or the provider's sign-in. */
  opening: 'prove' | 'link' | null;
  openError: string | null;
  trade: TradePhase;
  /**
   * Orders placed in this visit, from the press on: «on its way» while the engine answers, then what it answered. The
   * engine's own record (read with the account) takes each one's place as soon as it holds it — so a line never waits
   * for a read, and after a reload the account's records alone stand.
   */
  recent: readonly OrderLine[];
  /** A collect in flight, or the last one's outcome. */
  collecting: 'idle' | 'sending' | 'failed';
  withdraw: WithdrawPhase;
  /** Read the account of this wallet; a wallet that has not proven itself reads as not signed in. */
  refresh: (owner: string) => Promise<void>;
  /** Prove the wallet and open the managed account, whichever of the two is still missing. */
  start: (connection: Connection) => Promise<boolean>;
  /** Ask the engine for the Review of a buy or a sale. `key` names the ticket it was asked for. */
  quote: (connection: Connection, ask: Ask, key: string) => Promise<void>;
  /** Place the order the Review shows; its line shows at once as on its way. */
  place: (askedFor?: AskedFor) => Promise<void>;
  /** Collect the wins the venues mark payable now. */
  collect: (outcomeIds: readonly string[]) => Promise<void>;
  resetTrade: () => void;
  previewWithdraw: (body: Readonly<{ amountRaw: string }> | Readonly<{ max: true }>) => Promise<void>;
  confirmWithdraw: () => Promise<void>;
  resetWithdraw: () => void;
  /** Forget everything read for a wallet that is no longer the connected one. */
  forget: () => void;
};

const POLL_MS = 1_500;
const POLL_TIMES = 8;

/**
 * Answers to a placed order that say for certain nothing was sent: the engine refused before the provider saw it. Any
 * other failure — a lost answer, a timeout, the provider down — may hide an order already live, so the order is read
 * back by its quote and never offered again as if nothing happened.
 */
const NOTHING_SENT: ReadonlySet<string> = new Set(['ORDER_REFUSED', 'QUOTE_EXPIRED', 'NOT_FOUND', 'VALIDATION_ERROR', 'RATE_LIMITED', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_LINKED', 'SESSION_EXPIRED', 'LINK_UNAVAILABLE', 'FUNDING_OFF']);

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The openings started in this visit: only the newest one frees the window when it ends. */
let starts = 0;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const failed = (got: EngineResult<Json>) => (got.ok ? null : got.failure.code);

export const useReal = create<Store>((set, get) => {
  const mine = (owner: string) => get().owner === owner;
  return {
    owner: null,
    live: null,
    liveRead: 'none',
    funding: null,
    opening: null,
    openError: null,
    trade: { step: 'idle' },
    recent: [],
    collecting: 'idle',
    withdraw: { step: 'idle' },
    refresh: async (owner) => {
      if (get().owner !== owner) set({ owner, live: null, funding: null, liveRead: 'none', trade: { step: 'idle' }, recent: [], collecting: 'idle', withdraw: { step: 'idle' }, opening: null, openError: null });
      if (!get().live) set({ liveRead: 'reading' });
      const got = await predictEnv().engine.live();
      if (!mine(owner)) return;
      if (!got.ok) {
        // Not signed in reads as no account at all; anything else keeps what was read before.
        if (got.failure.code === 'UNAUTHORIZED' || got.failure.code === 'HTTP_401') return set({ live: null, funding: null, liveRead: 'ready' });
        return set({ liveRead: get().live ? 'ready' : 'failed' });
      }
      const live = readLive(got.value);
      // The proof belongs to another wallet (signed in from another tab): nothing of either account is drawn here.
      if (!live || (live.wallet && live.wallet !== owner)) return set({ live: null, funding: null, liveRead: 'ready' });
      let linked = live.linked;
      if (linked === null && live.access.state !== 'off') {
        const account = await predictEnv().engine.account();
        if (!mine(owner)) return;
        linked = account.ok ? readLinked(account.value) : null;
      }
      // A line of this visit gives way to the engine's own record of the same order once the account holds it.
      const known = new Set(live.orders.map((o) => o.quoteId));
      set({ live: { ...live, linked }, liveRead: 'ready', recent: get().recent.filter((o) => !known.has(o.quoteId)) });
      if (!linked || live.access.state === 'off') return set({ funding: null });
      const funding = await predictEnv().engine.funding();
      if (!mine(owner)) return;
      const read = funding.ok ? readFunding(funding.value) : null;
      if (!read || (read.wallet && read.wallet !== owner)) return;
      set({ funding: read });
      // A withdrawal whose state is not known is asked about again under its own request id; the engine never sends twice.
      const open = read.withdrawals.find((w) => moving(w) && (w.phase === 'unknown' || w.phase === 'sending'));
      if (!open) return;
      const checked = await predictEnv().engine.withdrawal(open.requestId);
      if (!mine(owner) || !checked.ok) return;
      const phase = (checked.value.withdrawal as { phase?: unknown } | undefined)?.phase;
      if (typeof phase !== 'string') return;
      const now = get().funding;
      if (now) set({ funding: { ...now, withdrawals: now.withdrawals.map((w) => (w.requestId === open.requestId ? { ...w, phase } : w)) } });
    },
    start: async (connection) => {
      if (get().opening) return false;
      const owner = connection.address;
      const run = ++starts;
      set({ owner, opening: 'prove', openError: null });
      try {
        const proof = await deps.prove(connection);
        if (!mine(owner)) return false;
        if (!proof.ok) {
          set({ openError: proof.state === 'declined' ? null : proof.message });
          return false;
        }
        await get().refresh(owner);
        const live = get().live;
        if (!mine(owner) || !live || live.access.state === 'off' || live.linked) return Boolean(live) && mine(owner);
        set({ opening: 'link' });
        const started = await predictEnv().engine.linkStart();
        if (!mine(owner)) return false;
        const message = started.ok && typeof started.value.message === 'string' ? started.value.message : null;
        if (!message) {
          set({ openError: failureWords(failed(started) ?? 'UNAVAILABLE') });
          return false;
        }
        const signed = await deps.sign(connection.wallet, owner, message);
        if (!mine(owner)) return false;
        if (!signed.ok) {
          set({ openError: signed.declined ? null : signed.message });
          return false;
        }
        const verified = await predictEnv().engine.linkVerify(message, signed.signature);
        if (!mine(owner)) return false;
        if (!verified.ok) {
          set({ openError: failureWords(verified.failure.code) });
          return false;
        }
        await get().refresh(owner);
        return true;
      } finally {
        // Whatever ends the opening — an answer, a refusal, a wallet switched mid-way — the window is free again,
        // unless a newer opening (for the wallet switched to) is running by now.
        if (run === starts) set({ opening: null });
      }
    },
    quote: async (connection, ask, key) => {
      if (get().trade.step === 'placing') return;
      set({ trade: { step: 'quoting', key } });
      const got = await predictEnv().engine.quote({
        eventId: ask.eventId,
        venueMarketId: ask.marketId,
        outcomeId: ask.outcomeId,
        side: ask.side,
        ...(ask.side === 'buy' ? { spendUsd: ask.spendUsd } : { sellShares: ask.sellShares }),
        locale: 'en',
        mode: 'live',
      });
      if (get().trade.step !== 'quoting' || (get().trade as { key: string }).key !== key || !mine(connection.address)) return;
      if (!got.ok) return set({ trade: { step: 'failed', key, text: failureWords(got.failure.code) } });
      // A Review priced for another wallet's account than the one connected here is never confirmed from this ticket.
      if (got.value.wallet !== connection.address) return set({ trade: { step: 'failed', key, text: failureWords('WALLET_MISMATCH') } });
      const review = readReview(got.value);
      // A Review that is not for real money is never shown as one.
      if (!review || !review.live) return set({ trade: { step: 'failed', key, text: failureWords('UNAVAILABLE') } });
      set({ trade: { step: 'review', key, review, ask } });
    },
    place: async (askedFor) => {
      const trade = get().trade;
      if (trade.step !== 'review' || !trade.review.canPlace) return;
      const owner = get().owner;
      const { key, review, ask } = trade;
      set({ trade: { step: 'placing', key, review, ask } });
      // The line shows from the press on: on its way, until the engine says what became of it.
      const line: OrderLine = {
        quoteId: review.quoteId,
        eventId: ask.eventId,
        marketId: ask.marketId,
        outcomeId: ask.outcomeId,
        title: askedFor?.title ?? '',
        label: review.label,
        side: review.side,
        totalUsd: review.totalUsd,
        shares: review.shares,
        price: review.price,
        state: 'submitted',
        status: 'pending',
        at: new Date(predictEnv().now()).toISOString(),
      };
      const mark = (state: OrderState) => set({ recent: get().recent.map((o) => (o.quoteId === line.quoteId ? { ...o, state, status: statusOf(state) } : o)) });
      set({ recent: [line, ...get().recent.filter((o) => o.quoteId !== line.quoteId)].slice(0, 20) });
      const got = await predictEnv().engine.place(review.quoteId);
      // The wallet switched while the order was out: the new wallet's ticket starts clean; the order is read on its own account.
      if (owner && !mine(owner)) return;
      if (!got.ok && NOTHING_SENT.has(got.failure.code)) {
        mark('failed');
        return set({ trade: { step: 'failed', key, text: failureWords(got.failure.code) } });
      }
      let order = got.ok ? readOrder(got.value) : null;
      // The engine waits a while for the fill, and an answer may be lost on the way: the rest is read back by the quote.
      for (let i = 0; (!order || order.state === 'submitted') && i < POLL_TIMES; i++) {
        await wait(POLL_MS);
        const again = await predictEnv().engine.order(review.quoteId);
        if (again.ok) order = readOrder(again.value) ?? order;
      }
      if (owner && !mine(owner)) return;
      // Read back still as reviewed: the engine freed the Review, nothing was sent.
      if (order?.state === 'reviewed') {
        mark('failed');
        set({ trade: { step: 'failed', key, text: failureWords('ORDER_REFUSED') } });
      } else {
        mark(order?.state ?? 'submitted');
        set({ trade: { step: 'done', key, review, state: order?.state ?? 'submitted' } });
      }
      if (owner) void get().refresh(owner);
    },
    collect: async (outcomeIds) => {
      const owner = get().owner;
      if (!owner || get().collecting === 'sending' || !outcomeIds.length) return;
      set({ collecting: 'sending' });
      const got = await predictEnv().engine.redeem(outcomeIds);
      if (!mine(owner)) return;
      set({ collecting: got.ok ? 'idle' : 'failed' });
      await get().refresh(owner);
    },
    resetTrade: () => {
      if (get().trade.step !== 'placing') set({ trade: { step: 'idle' } });
    },
    previewWithdraw: async (body) => {
      const owner = get().owner;
      set({ withdraw: { step: 'pricing' } });
      const got = await predictEnv().engine.withdrawPreview(body);
      // A price asked for another wallet's account is never shown to the one connected now.
      if (get().owner !== owner || get().withdraw.step !== 'pricing') return;
      if (!got.ok) return set({ withdraw: { step: 'failed', text: failureWords(got.failure.code) } });
      const preview = readWithdrawPreview(got.value);
      if (!preview) return set({ withdraw: { step: 'failed', text: failureWords('UNAVAILABLE') } });
      // The id is made when the Review opens: the same confirmation sent again carries the same id.
      set({ withdraw: { step: 'review', preview, requestId: uuid() } });
    },
    confirmWithdraw: async () => {
      const w = get().withdraw;
      if (w.step !== 'review' || !w.preview.quoted || !w.preview.receiveRaw) return;
      const owner = get().owner;
      set({ withdraw: { step: 'sending', preview: w.preview, requestId: w.requestId } });
      const got = await predictEnv().engine.withdraw({ requestId: w.requestId, amountRaw: w.preview.amountRaw, reviewedReceiveRaw: w.preview.receiveRaw, reviewedFeeRaw: w.preview.feeRaw });
      // The wallet switched while it was sent: the old account's record is read when that wallet is back.
      if (owner && !mine(owner)) return;
      if (!got.ok) {
        // A lost answer is no refusal: the record is read on the next refresh and asked about under the same id.
        if (!NOTHING_SENT.has(got.failure.code) && got.failure.code !== 'WITHDRAWAL_OPEN') set({ withdraw: { step: 'sent', requestId: w.requestId, phase: 'unknown' } });
        else set({ withdraw: { step: 'failed', text: failureWords(got.failure.code) } });
        if (owner) void get().refresh(owner);
        return;
      }
      if (got.value.outcome === 'repriced') {
        const preview = readWithdrawPreview(got.value);
        return set({ withdraw: preview ? { step: 'review', preview, requestId: uuid() } : { step: 'failed', text: failureWords('QUOTE_EXPIRED') } });
      }
      const phase = (got.value.withdrawal as { phase?: unknown } | undefined)?.phase;
      if (phase === 'refused' || phase === 'failed') set({ withdraw: { step: 'failed', text: wordsNow(PREDICT_TEXT).withdrawalFailed } });
      else set({ withdraw: { step: 'sent', requestId: w.requestId, phase: typeof phase === 'string' ? phase : 'unknown' } });
      if (owner) void get().refresh(owner);
    },
    resetWithdraw: () => {
      if (get().withdraw.step !== 'sending') set({ withdraw: { step: 'idle' } });
    },
    forget: () => set({ owner: null, live: null, funding: null, liveRead: 'none', opening: null, openError: null, trade: { step: 'idle' }, recent: [], collecting: 'idle', withdraw: { step: 'idle' } }),
  };
});

/** Whether real money is in flight — an order placed, a withdrawal sent, the account opening: the window does not close over it. */
export function realBusy(): boolean {
  const r = useReal.getState();
  return r.trade.step === 'placing' || r.withdraw.step === 'sending' || r.opening !== null || r.collecting === 'sending';
}

/** Every live order to show: this visit's lines the engine does not hold yet, then the engine's records, newest first. */
export function orderLines(st: Pick<Store, 'recent' | 'live'>): readonly OrderLine[] {
  const engine = st.live?.orders ?? [];
  const known = new Set(engine.map((o) => o.quoteId));
  return [...st.recent.filter((o) => !known.has(o.quoteId)), ...engine];
}

/** A withdrawal of the account still on its way, when there is one. */
export function movingWithdrawal(funding: Funding | null) {
  return funding?.withdrawals.find(moving) ?? null;
}

if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') Object.assign(window, { __predictReal: useReal });
