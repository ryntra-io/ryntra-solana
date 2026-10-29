import { swapFailureCopy } from '../../../lib/solana/swap-failure-copy.ts';
import { MAX_SIGNABLE_WINDOW_MS } from '../../../lib/solana/blockhash-life.ts';
import { assessSwapWalletAdoption } from '../../../lib/solana/swap-adoption.ts';
import {
  assessSwapClientReview,
  readSwapClientSignature,
  transitionSwapClientAttempt,
  type SwapClientAttempt,
} from '../../../lib/solana/swap-client-safety.ts';
import { pressRoute, walletAnswerRoute } from '../../../lib/solana/swap-press.ts';
import { inspectJupiterSwapTransaction } from '../../../lib/solana/swap-transaction-check.ts';
import type { Engine, EngineFailure, ExecuteBody, OrderBody, RecoverBody } from './engine.ts';
import { orderMatchesReview } from './figures.ts';
import type { Side } from './tiles.ts';

/**
 * One trade from the card, end to end, on the engine's own safety rules: the exact order is built for the wallet,
 * the person signs it in their own wallet, the signed bytes are checked against what was shown and sent once, and the
 * outcome is read from the chain. Once a signature exists, an unclear answer is only ever read back by that
 * signature — never signed or sent again. Nothing here holds a key or decides a price.
 */

export type Intent = Readonly<{ side: Side; inputMint: string; outputMint: string; amountRaw: string; taker: string }>;

export type SignResult = Readonly<{ ok: true; signedWireBase64: string }> | Readonly<{ ok: false; reason: string }>;

/** Where the one open signature of this browser tab is kept, so a reload still reads it back. */
export type AttemptStore = Readonly<{
  read: () => SwapClientAttempt | null;
  write: (attempt: SwapClientAttempt) => void;
  clear: () => void;
}>;

export type FlowPhase = 'preparing' | 'wallet' | 'sending' | 'checking';

export type FlowDeps = Readonly<{
  engine: Engine;
  /** The person's wallet, asked to sign these exact bytes. In tests, a stub. */
  sign: (unsignedWireBase64: string) => Promise<SignResult>;
  attempts: AttemptStore;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** How long the wallet may take: resolves when the time is up; cancelled when the wallet answers first. */
  walletDeadline?: (ms: number) => Readonly<{ done: Promise<void>; cancel: () => void }>;
  onPhase?: (phase: FlowPhase) => void;
}>;

/** A trade that reached the chain and was read back: what left the wallet and what arrived. */
export type SettledTrade = Readonly<{
  signature: string;
  inputMint: string;
  outputMint: string;
  /** Null when the engine answered from a stored receipt without the amounts. */
  inputRaw: string | null;
  outputRaw: string | null;
}>;

export type Refusal = Readonly<{ code: string; message: string; retryable: boolean }>;

export type PrepareOutcome =
  | Readonly<{ kind: 'ready'; order: OrderBody; receivedAt: number }>
  | Readonly<{ kind: 'refused'; refusal: Refusal }>
  /** The wallet has a signature out already: it is read back before anything new. */
  | Readonly<{ kind: 'locked'; attempt: SwapClientAttempt }>;

export type TradeOutcome =
  | PrepareOutcome
  /** Fresh figures to read before the wallet opens; nothing was signed or sent. */
  | Readonly<{ kind: 'review'; order: OrderBody; receivedAt: number; note: string }>
  /** The wallet said no, or did not answer; nothing was sent. */
  | Readonly<{ kind: 'cancelled'; message: string }>
  | Readonly<{ kind: 'settled'; trade: SettledTrade }>
  /** The transaction landed and failed: only the network fee moved. */
  | Readonly<{ kind: 'failed'; signature: string }>
  /** Nothing moved, and nothing can now. */
  | Readonly<{ kind: 'nothing'; message: string }>
  /** Still not known after reading for a while: keep the signature, never send another. */
  | Readonly<{ kind: 'unknown'; signature: string; message: string }>;

const ATTEMPT_SCHEMA = { schema: 'ryntra.solana.swap-client-attempt', schemaVersion: '1.0.0' } as const;

/** Reading a signature back: every few seconds, for as long as a blockhash could still carry it. */
export const RECOVERY_DEADLINE_MS = 150_000;
export const RECOVERY_INTERVAL_MS = 3_000;
/** A wallet answering on the last second still wins the race. */
const WALLET_GRACE_MS = 5_000;

function timerDeadline(ms: number): Readonly<{ done: Promise<void>; cancel: () => void }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { done, cancel: () => clearTimeout(timer) };
}

const LATE = 'Your wallet answered after the price stopped holding. Nothing was sent. Check the new figures.';
const MOVED = 'The price moved. Nothing was sent. Check the new figures.';

function refusalOf(failure: EngineFailure): Refusal {
  const copy = swapFailureCopy(failure.code, (english) => english);
  return { code: failure.code, message: copy.message, retryable: copy.retryable };
}

function lockedAttempt(failure: EngineFailure, taker: string, now: number): SwapClientAttempt | null {
  const lock = failure.ownerLock;
  if (!lock?.signature) return null;
  return { ...ATTEMPT_SCHEMA, requestId: lock.requestId, signature: lock.signature, taker, state: 'SUBMITTED_UNKNOWN', recordedAt: new Date(now).toISOString() };
}

function signableMsOf(order: OrderBody): number {
  return typeof order.signableMs === 'number' && Number.isFinite(order.signableMs) ? order.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

function readiness(order: OrderBody, now: number) {
  return assessSwapClientReview({
    // The served verdict is read-only; the check only reads it.
    verdict: { decision: order.policy.verdict.decision, findings: [...order.policy.verdict.findings] },
    proofStatus: order.proof.status,
    simulationStatus: order.simulation.status,
    ownerEffectsStatus: order.simulation.ownerEffects?.status ?? 'MISSING',
    expiresAt: order.expiresAt,
    now: new Date(now),
  });
}

/** The exact order for the connected wallet, checked the way the engine checks it before any wallet may see it. */
export async function prepareOrder(intent: Intent, deps: FlowDeps): Promise<PrepareOutcome> {
  deps.onPhase?.('preparing');
  const ordered = await deps.engine.order(
    { inputMint: intent.inputMint, outputMint: intent.outputMint, amountRaw: intent.amountRaw, taker: intent.taker },
    { surface: 'SPOT', side: intent.side === 'buy' ? 'BUY' : 'SELL' },
  );
  if (!ordered.ok) {
    const attempt = lockedAttempt(ordered.failure, intent.taker, deps.now());
    if (attempt) return { kind: 'locked', attempt };
    return { kind: 'refused', refusal: refusalOf(ordered.failure) };
  }
  const order = ordered.value;
  const ready = readiness(order, deps.now());
  if (!order.preSign?.ready || !ready.ready) return { kind: 'refused', refusal: { code: ready.code, message: ready.reason, retryable: true } };
  return { kind: 'ready', order, receivedAt: deps.now() };
}

/**
 * The press of the card's one button over an order the person can see. Bytes with enough life left go to the wallet
 * at once; dying bytes are built fresh first and go to the wallet only when they are no worse than what is shown —
 * otherwise the fresh figures are shown and nothing is signed.
 */
export async function confirmTrade(args: Readonly<{ intent: Intent; order: OrderBody; receivedAt: number }>, deps: FlowDeps): Promise<TradeOutcome> {
  const shown = readiness(args.order, deps.now());
  const route = pressRoute({ readinessCode: shown.code, ready: shown.ready, receivedAtMs: args.receivedAt, signableMs: signableMsOf(args.order), nowMs: deps.now() });
  if (route === 'REFUSE') return { kind: 'refused', refusal: { code: shown.code, message: shown.reason, retryable: true } };
  if (route === 'WALLET_NOW') return signAndSend(args.intent, args.order, args.receivedAt, deps);
  const fresh = await prepareOrder(args.intent, deps);
  if (fresh.kind !== 'ready') return fresh;
  if (!orderMatchesReview(args.order, fresh.order)) return { kind: 'review', order: fresh.order, receivedAt: fresh.receivedAt, note: MOVED };
  return signAndSend(args.intent, fresh.order, fresh.receivedAt, deps);
}

/** Fresh figures after the wallet answered too late for its bytes: shown, never signed by themselves. */
async function lateReview(intent: Intent, deps: FlowDeps): Promise<TradeOutcome> {
  const fresh = await prepareOrder(intent, deps);
  return fresh.kind === 'ready' ? { kind: 'review', order: fresh.order, receivedAt: fresh.receivedAt, note: LATE } : fresh;
}

async function signAndSend(intent: Intent, order: OrderBody, receivedAt: number, deps: FlowDeps): Promise<TradeOutcome> {
  const wire = order.order.transactionBase64;
  const signableMs = signableMsOf(order);
  deps.onPhase?.('wallet');
  // The wallet may take as long as the person does, but never longer than these bytes can still land.
  const deadline = (deps.walletDeadline ?? timerDeadline)(Math.max(0, Math.min(Date.parse(order.expiresAt), receivedAt + signableMs) - deps.now()) + WALLET_GRACE_MS);
  const signed = await Promise.race([deps.sign(wire), deadline.done.then(() => 'TIMED_OUT' as const)]);
  deadline.cancel();
  if (signed === 'TIMED_OUT') return lateReview(intent, deps);
  if (!signed.ok) return { kind: 'cancelled', message: signed.reason || 'The wallet did not sign. Nothing was sent.' };

  // A wallet may re-price its compute budget and add its guards; anything else is a different transaction.
  const adoption = assessSwapWalletAdoption({ reviewedWireBase64: wire, signedWireBase64: signed.signedWireBase64 });
  if (!adoption.ok) return { kind: 'refused', refusal: { code: adoption.code, message: 'The wallet changed this transaction, so it was not sent.', retryable: true } };
  const returned = await inspectJupiterSwapTransaction({ wireBase64: signed.signedWireBase64, expectedTaker: intent.taker });
  if (!returned.ok) return { kind: 'refused', refusal: { code: `SIGNED_${returned.code}`, message: 'The signed transaction did not pass its check, so it was not sent.', retryable: true } };
  const signature = readSwapClientSignature({ signedWireBase64: signed.signedWireBase64, expectedTaker: intent.taker });
  if (!signature) return { kind: 'refused', refusal: { code: 'SIGNATURE_UNREADABLE', message: 'The wallet signature could not be read. Nothing was sent.', retryable: true } };
  // Bytes that aged out while the wallet was open would be refused by the network: never sent.
  if (walletAnswerRoute({ receivedAtMs: receivedAt, signableMs, answeredAtMs: deps.now() }) === 'FRESH_REVIEW') return lateReview(intent, deps);
  if (!readiness(order, deps.now()).ready) return lateReview(intent, deps);

  // Written down before the send: from here on every unclear answer is read back by this signature.
  const pending: SwapClientAttempt = { ...ATTEMPT_SCHEMA, requestId: order.order.requestId, signature, taker: intent.taker, state: 'SIGNED_NOT_SENT', recordedAt: new Date(deps.now()).toISOString() };
  deps.attempts.write(pending);
  deps.onPhase?.('sending');
  const executed = await deps.engine.execute({
    bundle: order.bundle,
    proof: order.proof,
    signedTransactionBase64: signed.signedWireBase64,
    reviewedTransactionBase64: wire,
  });
  if (!executed.ok) {
    const failure = executed.failure;
    if (failure.submitBoundary === 'NOT_CROSSED') {
      // Refused before the engine claimed the signature: the network never saw it.
      deps.attempts.clear();
      if (/^(ORDER_EXPIRED|REVIEW_NOT_FRESH)$/.test(failure.code)) return lateReview(intent, deps);
      if (failure.code === 'OWNER_SWAP_LOCK_MISMATCH') {
        return { kind: 'refused', refusal: { code: failure.code, message: 'A newer order for this wallet replaced this one. Nothing was sent.', retryable: true } };
      }
      return { kind: 'refused', refusal: refusalOf(failure) };
    }
    if (failure.code === 'LANDED_FAILED') {
      deps.attempts.clear();
      return { kind: 'failed', signature };
    }
    const unknown = transitionSwapClientAttempt(pending, { kind: 'FAILURE' });
    deps.attempts.write(unknown);
    return recoverTrade(unknown, deps);
  }
  const recorded = transitionSwapClientAttempt(pending, { kind: 'SUCCESS', serverState: executed.value.state });
  if (recorded.state !== 'SETTLED') {
    deps.attempts.write(recorded);
    return recoverTrade(recorded, deps);
  }
  deps.attempts.clear();
  return { kind: 'settled', trade: settledFrom(executed.value, order) };
}

function settledFrom(body: ExecuteBody | RecoverBody, order: Pick<OrderBody, 'order'> | null): SettledTrade {
  const observation = 'observation' in body ? body.observation ?? null : null;
  return {
    signature: body.signature,
    inputMint: order?.order.inputMint ?? '',
    outputMint: order?.order.outputMint ?? '',
    inputRaw: observation?.actualInputRaw ?? null,
    outputRaw: observation?.actualOutputRaw ?? null,
  };
}

/**
 * Read a signature back until the chain answers: settled, failed, or never sent. It sends nothing. A signature that is
 * still unclear when time runs out is kept, so the next press reads it again instead of trading twice.
 */
export async function recoverTrade(attempt: SwapClientAttempt, deps: FlowDeps, pair: Readonly<{ inputMint: string; outputMint: string }> | null = null): Promise<TradeOutcome> {
  deps.onPhase?.('checking');
  const deadline = deps.now() + RECOVERY_DEADLINE_MS;
  let missed = 0;
  for (;;) {
    const read = await deps.engine.recover({ owner: attempt.taker, signature: attempt.signature, requestId: attempt.requestId });
    if (!read.ok) {
      if (/^(TIMEOUT|NETWORK|HTTP_50[234])$/.test(read.failure.code) && missed === 0 && deps.now() < deadline) {
        missed += 1;
        await deps.sleep(RECOVERY_INTERVAL_MS);
        continue;
      }
      return { kind: 'unknown', signature: attempt.signature, message: 'Ryntra could not read the network just now. Do not send another; check again.' };
    }
    missed = 0;
    const body = read.value;
    switch (body.state) {
      case 'PENDING':
        if (deps.now() >= deadline) return { kind: 'unknown', signature: attempt.signature, message: 'The outcome is not known yet. Do not send another; check again.' };
        await deps.sleep(RECOVERY_INTERVAL_MS);
        continue;
      case 'SEEN_WITHOUT_RECORD':
        return { kind: 'unknown', signature: attempt.signature, message: 'The network has seen this transaction, but its receipt is not ready. Check the explorer.' };
      case 'UNKNOWN_TO_CHAIN':
        deps.attempts.clear();
        return { kind: 'nothing', message: 'Nothing was sent under this signature. You can trade again.' };
      case 'EXPIRED_BEFORE_SUBMIT':
        deps.attempts.clear();
        return { kind: 'nothing', message: 'The transaction was never sent and its time has passed. Nothing moved.' };
      case 'EXPIRED_AFTER_SUBMIT':
        deps.attempts.clear();
        return { kind: 'nothing', message: 'The transaction never reached the chain and its time has passed. Nothing moved.' };
      case 'FAILED':
        deps.attempts.clear();
        return { kind: 'failed', signature: attempt.signature };
      case 'ALREADY_RECEIPTED':
      case 'RECOVERED': {
        deps.attempts.clear();
        const trade = settledFrom(body, null);
        return { kind: 'settled', trade: { ...trade, inputMint: pair?.inputMint ?? '', outputMint: pair?.outputMint ?? '' } };
      }
      default:
        return { kind: 'unknown', signature: attempt.signature, message: 'The outcome is not known yet. Do not send another; check again.' };
    }
  }
}
