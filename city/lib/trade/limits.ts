import { MAX_SIGNABLE_WINDOW_MS, mayOpenWallet, signableWindowClosed } from '../../../lib/solana/blockhash-life.ts';
import { TRIGGER_V1_MIN_ORDER_USD, type LimitSide, type LimitVenue } from '../../../lib/solana/limits/model.ts';
import type { LimitReview } from '../../../lib/solana/limits/review.server.ts';
import type { LimitOrderView } from '../../../lib/solana/limits/sync.server.ts';
import { signFreshBytes } from '../../../lib/solana/sign-fresh.ts';
import { postJson, type EngineFailure, type EngineResult, type FetchLike, type Timers } from './engine.ts';
import type { Refusal, SignResult } from './flow.ts';

/**
 * The city's line to Ryntra's spot limits engine — the same five routes the rest of Ryntra uses, on the same origin.
 * The engine reads the pair's price, builds the order at Jupiter (Trigger V1: the coins wait in a program account of
 * this order alone, only the wallet's signature takes them back), proves the bytes by reading and simulating them,
 * writes the order down before the bytes leave, relays them once and reads the outcome from the chain. The city only
 * asks, shows and carries the wallet's signature; it never changes what the engine answers.
 *
 * - `market` — the pair's price now, in the quote;
 * - `review` — the exact order: amounts, the price it fills at, every fee on its own line, the unsigned bytes;
 * - `submit` — the signed placement or cancellation, relayed once;
 * - `cancel` — the unsigned cancellation of one order;
 * - `orders` — «My orders»: a wallet's orders at the venue and Ryntra's records of them.
 */

export type { LimitReview, LimitOrderView };

export type LimitMarket = Readonly<{
  /** Quote per base now: Jupiter's dollar prices of both sides, or the pool's own price. */
  price: number | null;
  baseUsd: number | null;
  quoteUsd: number | null;
  observedAt?: string;
}>;

export type LimitToken = Readonly<{ symbol: string | null; decimals: number | null }>;

export type LimitOrders = Readonly<{ orders: readonly LimitOrderView[]; tokens: Readonly<Record<string, LimitToken>>; complete: boolean }>;

export type LimitBuild = Readonly<{ transactionBase64: string; requestId: string | null; signableMs?: number }>;

export type SubmitAnswer = Readonly<{ state: string; signature: string; settled: boolean }>;

export type SubmitBody = Readonly<{
  kind: 'place' | 'cancel';
  venue: LimitVenue;
  owner: string;
  order: string;
  requestId: string | null;
  signedTransactionBase64: string;
  terms: Readonly<{
    side: LimitSide;
    baseMint: string;
    quoteMint: string;
    inputMint: string;
    outputMint: string;
    makingRaw: string;
    takingRaw: string;
    price: string;
    fillPrice: number;
    pool: string | null;
    fee: Readonly<{ ryntraBps: number; venueBps: number; account: string | null }>;
  }> | null;
}>;

/** The order the city asks for: always at Jupiter, the venue whose fee is the engine's fee policy. */
export const CITY_LIMIT_VENUE: LimitVenue = 'trigger';

export type LimitIntent = Readonly<{
  owner: string;
  side: LimitSide;
  baseMint: string;
  quoteMint: string;
  /** What is spent, as a plain decimal: the quote on a buy, the base on a sale. */
  amount: string;
  /** Quote per base, as a plain decimal. */
  price: string;
  /** The quote's dollar price when the engine said it: the venue's minimum is in dollars. */
  quoteUsd: number | null;
}>;

export type LimitsApi = Readonly<{
  market: (args: Readonly<{ owner: string | null; baseMint: string; quoteMint: string }>) => Promise<EngineResult<LimitMarket>>;
  review: (intent: LimitIntent) => Promise<EngineResult<Readonly<{ review: LimitReview }>>>;
  orders: (owner: string) => Promise<EngineResult<LimitOrders>>;
  cancel: (args: Readonly<{ owner: string; venue: LimitVenue; order: string }>) => Promise<EngineResult<LimitBuild>>;
  submit: (body: SubmitBody) => Promise<EngineResult<SubmitAnswer>>;
}>;

/** How long each route may take: a little over the route's own limit, so the server's answer wins the race. */
const LIMITS_TIMEOUT_MS = { market: 22_000, review: 32_000, orders: 32_000, cancel: 32_000, submit: 62_000 } as const;

export function createLimits(fetchImpl: FetchLike = (url, init) => fetch(url, init), timers?: Timers): LimitsApi {
  return {
    market: (args) => postJson(fetchImpl, '/api/solana/limits/market', args, LIMITS_TIMEOUT_MS.market, timers),
    review: (intent) =>
      postJson(
        fetchImpl,
        '/api/solana/limits/review',
        { owner: intent.owner, venue: CITY_LIMIT_VENUE, side: intent.side, baseMint: intent.baseMint, quoteMint: intent.quoteMint, amount: intent.amount, price: intent.price, quoteUsd: intent.quoteUsd },
        LIMITS_TIMEOUT_MS.review,
        timers,
      ),
    orders: (owner) => postJson(fetchImpl, '/api/solana/limits/orders', { owner }, LIMITS_TIMEOUT_MS.orders, timers),
    cancel: (args) => postJson(fetchImpl, '/api/solana/limits/cancel', args, LIMITS_TIMEOUT_MS.cancel, timers),
    submit: (body) => postJson(fetchImpl, '/api/solana/limits/submit', body, LIMITS_TIMEOUT_MS.submit, timers),
  };
}

export type LimitDeps = Readonly<{
  api: LimitsApi;
  /** The person's wallet, asked to sign these exact bytes. In tests, a stub. */
  sign: (unsignedWireBase64: string) => Promise<SignResult>;
  now: () => number;
  onPhase?: (phase: 'reviewing' | 'wallet' | 'sending') => void;
}>;

/** The engine's refusal in the person's words: the routes answer in English for logs, the card speaks by the code. */
export function limitRefusal(failure: EngineFailure): Refusal {
  const words: Record<string, string> = {
    RATE_LIMITED: 'Too many requests. Try again in a moment.',
    SWAP_PAUSED: 'Trading is turned off right now.',
    BELOW_MINIMUM: `Limit orders start at ${TRIGGER_V1_MIN_ORDER_USD} USD.`,
    INVALID_TERMS: 'The amount or the price is not a positive number.',
    SAME_TOKEN: 'A pair needs two different coins.',
    MINT_UNREADABLE: 'This coin could not be read from the chain. Try again.',
    SIMULATION_FAILED: 'The network would refuse this order. Check your balance and SOL for fees.',
    TRIGGER_BUSY: 'Jupiter is busy right now. Try again in a moment.',
    TRIGGER_REFUSED: 'Jupiter would not take this order.',
    NOT_CANCELLABLE: 'This order is already closed or being closed.',
    ALREADY_SUBMITTED: 'This order was already sent.',
    WALLET_MISMATCH: 'This order belongs to another wallet.',
    TIMEOUT: 'The server did not answer in time. Nothing was sent.',
    NETWORK: 'No answer from Ryntra. Nothing was sent.',
  };
  const message = words[failure.code] ?? 'The order could not be built right now. Nothing was sent.';
  return { code: failure.code, message, retryable: failure.code !== 'WALLET_MISMATCH' && failure.code !== 'SAME_TOKEN' };
}

function signableMsOf(built: Readonly<{ signableMs?: number }>): number {
  return typeof built.signableMs === 'number' && Number.isFinite(built.signableMs) ? built.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

export type ReviewOutcome = Readonly<{ kind: 'ready'; review: LimitReview; receivedAt: number }> | Readonly<{ kind: 'refused'; refusal: Refusal }>;

/** The exact order for the connected wallet: built and proved by the engine, nothing signed. */
export async function reviewLimit(intent: LimitIntent, deps: LimitDeps): Promise<ReviewOutcome> {
  deps.onPhase?.('reviewing');
  const answer = await deps.api.review(intent);
  if (!answer.ok) return { kind: 'refused', refusal: limitRefusal(answer.failure) };
  const review = answer.value.review;
  if (!review || typeof review.transactionBase64 !== 'string' || review.side !== intent.side || review.pair?.baseMint !== intent.baseMint || review.pair?.quoteMint !== intent.quoteMint) {
    return { kind: 'refused', refusal: { code: 'REVIEW_UNREADABLE', message: 'The order came back unreadable. Nothing was sent.', retryable: true } };
  }
  return { kind: 'ready', review, receivedAt: deps.now() };
}

/** A second Review for the same order: the same coins, amounts and fees — what the person already read. */
export function sameTerms(a: LimitReview, b: LimitReview): boolean {
  return (
    a.inputMint === b.inputMint &&
    a.outputMint === b.outputMint &&
    a.makingRaw === b.makingRaw &&
    a.takingRaw === b.takingRaw &&
    a.fee.ryntraBps === b.fee.ryntraBps &&
    a.fee.venueBps === b.fee.venueBps
  );
}

export type PlaceOutcome =
  /** The engine relayed the order; `settled` false while the chain has not answered yet (the engine reads it later). */
  | Readonly<{ kind: 'placed'; state: string; signature: string; settled: boolean }>
  /** Fresh figures to read before the wallet opens again; nothing was sent. */
  | Readonly<{ kind: 'review'; review: LimitReview; receivedAt: number; note: string }>
  | Readonly<{ kind: 'cancelled'; message: string }>
  | Readonly<{ kind: 'refused'; refusal: Refusal }>
  /** The placement reached the chain and failed: only the network fee moved. */
  | Readonly<{ kind: 'failed'; signature: string | null }>
  /** Sent, and the answer is not clear: the engine's record holds it; never placed again. */
  | Readonly<{ kind: 'unclear'; signature: string | null; message: string }>;

const LATE = 'Signed too late. Nothing was sent. Sign again.';
const MOVED = 'The order changed. Nothing was sent. Check the new figures.';
const UNCLEAR = 'Not confirmed yet. Do not place it again.';

function termsOf(review: LimitReview): SubmitBody['terms'] {
  return {
    side: review.side,
    baseMint: review.pair.baseMint,
    quoteMint: review.pair.quoteMint,
    inputMint: review.inputMint,
    outputMint: review.outputMint,
    makingRaw: review.makingRaw,
    takingRaw: review.takingRaw,
    price: review.price,
    fillPrice: review.fillPrice,
    pool: review.pool,
    fee: { ryntraBps: review.fee.ryntraBps, venueBps: review.fee.venueBps, account: review.fee.account },
  };
}

/**
 * The press over a Review the person can see. Bytes with too little life are built again first and go to the wallet
 * only when the order is the same; bytes the wallet signed after their life are never sent. The signed bytes go to
 * the engine once — an unclear answer is never followed by a second placement.
 */
export async function placeLimit(args: Readonly<{ intent: LimitIntent; review: LimitReview; receivedAt: number }>, deps: LimitDeps): Promise<PlaceOutcome> {
  let review = args.review;
  let receivedAt = args.receivedAt;
  if (!mayOpenWallet({ receivedAtMs: receivedAt, signableMs: signableMsOf(review), nowMs: deps.now() })) {
    const fresh = await reviewLimit(args.intent, deps);
    if (fresh.kind !== 'ready') return fresh;
    if (!sameTerms(review, fresh.review)) return { kind: 'review', review: fresh.review, receivedAt: fresh.receivedAt, note: MOVED };
    review = fresh.review;
    receivedAt = fresh.receivedAt;
  }
  deps.onPhase?.('wallet');
  const signed = await deps.sign(review.transactionBase64);
  if (!signed.ok) return { kind: 'cancelled', message: signed.reason || 'The wallet did not sign. Nothing was sent.' };
  if (signableWindowClosed({ receivedAtMs: receivedAt, signableMs: signableMsOf(review), nowMs: deps.now() })) {
    const fresh = await reviewLimit(args.intent, deps);
    return fresh.kind === 'ready' ? { kind: 'review', review: fresh.review, receivedAt: fresh.receivedAt, note: LATE } : fresh;
  }
  deps.onPhase?.('sending');
  const answer = await deps.api.submit({
    kind: 'place',
    venue: review.venue,
    owner: args.intent.owner,
    order: review.order,
    requestId: review.requestId,
    signedTransactionBase64: signed.signedWireBase64,
    terms: termsOf(review),
  });
  if (answer.ok) return { kind: 'placed', state: answer.value.state, signature: answer.value.signature, settled: answer.value.settled === true };
  const failure = answer.failure;
  if (failure.submitBoundary === 'NOT_CROSSED') return { kind: 'refused', refusal: limitRefusal(failure) };
  if (failure.code === 'PLACEMENT_FAILED') return { kind: 'failed', signature: failure.signature ?? null };
  return { kind: 'unclear', signature: failure.signature ?? null, message: UNCLEAR };
}

export type CancelOutcome =
  | Readonly<{ kind: 'cancelled'; state: string; signature: string; settled: boolean }>
  /** The wallet said no, or every build aged out in the wallet: nothing was sent. */
  | Readonly<{ kind: 'kept'; message: string }>
  | Readonly<{ kind: 'refused'; refusal: Refusal }>
  | Readonly<{ kind: 'unclear'; signature: string | null; message: string }>;

/**
 * Take one order back: the engine builds the cancellation (on Jupiter what has not filled comes back, with the order
 * account's rent), the wallet signs it — built once more if the wallet answered after the bytes' life — and the
 * engine relays it once. Open even while trading is stopped: taking one's own order back is never paused.
 */
export async function cancelLimit(args: Readonly<{ owner: string; venue: LimitVenue; order: string }>, deps: LimitDeps): Promise<CancelOutcome> {
  const fresh = await signFreshBytes<LimitBuild, string, Readonly<{ ok: false; failure: EngineFailure }>>({
    build: async () => {
      const built = await deps.api.cancel(args);
      return built.ok ? { ok: true as const, data: built.value } : { ok: false as const, failure: built.failure };
    },
    signableMsOf: (built) => built.signableMs,
    sign: async (built) => {
      deps.onPhase?.('wallet');
      const signed = await deps.sign(built.transactionBase64);
      return signed.ok ? { ok: true, value: signed.signedWireBase64 } : { ok: false, reason: signed.reason };
    },
    now: deps.now,
  });
  if (!fresh.ok) {
    if (fresh.stage === 'build') return { kind: 'refused', refusal: limitRefusal(fresh.failure.failure) };
    if (fresh.stage === 'sign') return { kind: 'kept', message: 'Not signed. The order stays open.' };
    return { kind: 'kept', message: 'Signed too late. The order stays open.' };
  }
  deps.onPhase?.('sending');
  const answer = await deps.api.submit({ kind: 'cancel', venue: args.venue, owner: args.owner, order: args.order, requestId: fresh.built.requestId, signedTransactionBase64: fresh.signed, terms: null });
  if (answer.ok) return { kind: 'cancelled', state: answer.value.state, signature: answer.value.signature, settled: answer.value.settled === true };
  const failure = answer.failure;
  if (failure.submitBoundary === 'NOT_CROSSED') return { kind: 'refused', refusal: limitRefusal(failure) };
  if (failure.code === 'CANCEL_FAILED') return { kind: 'refused', refusal: { code: failure.code, message: 'Cancel failed. The order stays open.', retryable: true } };
  return { kind: 'unclear', signature: failure.signature ?? null, message: 'Cancellation not confirmed yet.' };
}
