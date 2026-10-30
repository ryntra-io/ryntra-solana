import { MAX_SIGNABLE_WINDOW_MS, mayOpenWallet, signableWindowClosed } from '../../../lib/solana/blockhash-life.ts';
import { DEPOSIT_NETWORK_LABEL, DEPOSIT_NETWORKS, type DepositNetwork } from '../../../lib/relay/deposit-address.ts';
import { bridgeSubmitNeedsRecovery } from '../../../lib/swap/bridge-client-state.ts';
import { SOLANA_USDC_MINT, type SwapNetwork } from '../../../lib/swap/catalog.ts';
import { classifySwapRoute, type SwapRouteClassification } from '../../../lib/swap/classify.ts';
import type { CrossSwapQuote } from '../../../lib/swap/cross-swap-quote.ts';
import { serviceFeeText } from '../../../lib/swap/service-fee.ts';
import { ask, TIMEOUT_MS, type EngineFailure, type FetchLike } from './engine.ts';
import { wordsNow } from '../i18n/dict.ts';
import type { SignResult } from './send.ts';
import { BRIDGE_WORDS as WORDS, ORDER_WORDS as ORDER } from './words.ts';

/**
 * Bridge out of Solana from the city: USDC in this wallet → USDC on another network, to an address the person types,
 * through the engine's cross-network lane (`/api/solana/cross-swap/*`, the rail the engine names for the pair). One
 * Solana signature; the engine quotes, builds and checks the transaction, sends it once and follows the order until
 * the money lands or comes back, then issues the receipt. Bringing money in is not a signature at all: it is an
 * address on the other network (Top up, SOL-W1).
 *
 * The networks are the ones money also comes in from, so the two directions name the same places.
 */

export const BRIDGE_NETWORKS: readonly DepositNetwork[] = DEPOSIT_NETWORKS;
export const NETWORK_LABEL: Readonly<Record<DepositNetwork, string>> = DEPOSIT_NETWORK_LABEL;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The key the web's Bridge keeps its one open order under: an order started in the city resumes there and back. */
export const RUN_KEY = 'ryntra.solana.cross-swap-run.v1';

type CrossRoute = Extract<SwapRouteClassification, { kind: 'CROSS_SWAP' }>;

/** The engine's route for Solana USDC → USDC on `network`, or null when it carries none. */
export function bridgeRoute(network: DepositNetwork): CrossRoute | null {
  const route = classifySwapRoute({ network: 'solana', asset: SOLANA_USDC_MINT }, { network, asset: 'USDC' });
  return route.ok && route.kind === 'CROSS_SWAP' ? route : null;
}

export type DestinationProblem = 'EMPTY' | 'NOT_EVM' | 'SOLANA';

/** The address on the other network: a 0x address. A Solana one is a Send, not a Bridge. */
export function readDestination(typed: string): Readonly<{ ok: true; address: string }> | Readonly<{ ok: false; problem: DestinationProblem; text: string }> {
  const w = wordsNow(WORDS);
  const value = typed.trim();
  if (value === '') return { ok: false, problem: 'EMPTY', text: w.destEmpty };
  if (EVM_ADDRESS.test(value)) return { ok: true, address: value };
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) return { ok: false, problem: 'SOLANA', text: w.destSolana };
  return { ok: false, problem: 'NOT_EVM', text: w.destNotEvm };
}

export type QuoteBody = Readonly<{ quote: CrossSwapQuote; buildable: boolean; lane: string }>;

function isQuote(value: unknown): value is QuoteBody {
  const body = value as Record<string, unknown> | null;
  const quote = body?.quote as Record<string, unknown> | undefined;
  return !!quote && typeof (quote.to as Record<string, unknown> | undefined)?.minimumRaw === 'string' && typeof body?.buildable === 'boolean';
}

export type BridgeAsk = Readonly<{ route: CrossRoute; amountRaw: string; owner: string; destination: string }>;

/** A price for moving `amountRaw` out: what arrives at least, the fees, the time. Read-only; nothing is built. */
export async function quoteBridge(fetchImpl: FetchLike, input: BridgeAsk, signal?: AbortSignal): Promise<Readonly<{ ok: true; body: QuoteBody }> | Readonly<{ ok: false; failure: EngineFailure }>> {
  const answer = await ask<unknown>(fetchImpl, '/api/solana/cross-swap/quote', {
    body: {
      from: { network: input.route.from.network, asset: input.route.from.asset },
      to: { network: input.route.to.network, asset: input.route.to.asset },
      amountRaw: input.amountRaw,
      destinationAddress: input.destination,
      sourceAddress: input.owner,
    },
    signal,
  });
  if (!answer.ok) return answer;
  if (!isQuote(answer.value)) return { ok: false, failure: { code: 'QUOTE_UNREADABLE', message: 'The price could not be read.', status: 200, extra: {} } };
  return { ok: true, body: answer.value };
}

export type QuoteFacts = Readonly<{
  /** What arrives at least — signed into the order. */
  minimumRaw: string;
  expectedRaw: string;
  decimals: number;
  symbol: string;
  etaSeconds: number;
  /** What moving it costs on the rail, in dollars, as the provider says; null when it says nothing. */
  providerUsd: number | null;
  /** Ryntra's own fee, named. */
  ryntraFee: string;
  /** The Solana network fee, in dollars, paid on top; null when unknown. */
  networkUsd: number | null;
}>;

/** The quote's figures as the window says them. Nothing is added up that the engine says is already inside another. */
export function quoteFacts(quote: CrossSwapQuote): QuoteFacts {
  return {
    minimumRaw: quote.to.minimumRaw,
    expectedRaw: quote.to.expectedRaw,
    decimals: quote.to.decimals,
    symbol: quote.to.symbol,
    etaSeconds: quote.etaSeconds,
    // `relayerUsd` is the parent of the relayer gas and the protocol fee: one figure, never their sum.
    providerUsd: quote.fees.relayerUsd ?? quote.fees.protocolUsd,
    ryntraFee: serviceFeeText(quote.serviceFee, wordsNow(WORDS).none),
    networkUsd: quote.fees.sourceGasUsd,
  };
}

export function etaWords(seconds: number): string {
  const w = wordsNow(WORDS);
  if (!Number.isFinite(seconds) || seconds <= 0) return w.etaMinute;
  return seconds < 60 ? w.etaSeconds(Math.max(1, Math.round(seconds))) : w.etaMinutes(Math.round(seconds / 60));
}

/** Whether the Bridge form takes edits: at rest, or while a price is asked for — never once a transfer is being built. */
export function bridgeEditable(phase: string): boolean {
  return phase === 'idle' || phase === 'quoting';
}

export type BridgePlan = Readonly<{
  intentDigest: string;
  quote: CrossSwapQuote;
  unsignedWireBase64: string;
  reviewExpiresAt: string;
  signableMs: number;
  /** When the plan arrived here: its bytes' signable window counts from this. */
  receivedAt: number;
}>;

/** The exact Solana transaction for the reviewed quote. The engine refuses a quote that moved too far. */
export async function planBridge(
  fetchImpl: FetchLike,
  input: BridgeAsk,
  reviewed: CrossSwapQuote,
  now: () => number,
): Promise<Readonly<{ ok: true; plan: BridgePlan }> | Readonly<{ ok: false; failure: EngineFailure; fresh: CrossSwapQuote | null }>> {
  const answer = await ask<Record<string, unknown>>(fetchImpl, '/api/solana/cross-swap/plan', {
    body: {
      from: { network: input.route.from.network, asset: input.route.from.asset },
      to: { network: input.route.to.network, asset: input.route.to.asset },
      amountRaw: input.amountRaw,
      owner: input.owner,
      destination: input.destination,
      reviewed: { route: reviewed.route, amountRaw: reviewed.from.amountRaw, minimumRaw: reviewed.to.minimumRaw },
    },
    timeoutMs: TIMEOUT_MS.plan,
  });
  if (!answer.ok) {
    const fresh = answer.failure.extra.quote;
    return { ok: false, failure: answer.failure, fresh: fresh && typeof fresh === 'object' ? (fresh as CrossSwapQuote) : null };
  }
  const value = answer.value;
  const plan = value.plan as Record<string, unknown> | undefined;
  // Only a Solana plan is signed here: one wallet, the person's Solana one (SOL-W1).
  if (plan?.origin !== 'solana' || typeof plan.unsignedWireBase64 !== 'string' || typeof value.intentDigest !== 'string' || !isQuote({ quote: value.quote, buildable: true })) {
    return { ok: false, failure: { code: 'BUILD_FAILED', message: 'The transfer could not be built.', status: 200, extra: {} }, fresh: null };
  }
  return {
    ok: true,
    plan: {
      intentDigest: value.intentDigest,
      quote: value.quote as CrossSwapQuote,
      unsignedWireBase64: plan.unsignedWireBase64,
      reviewExpiresAt: typeof value.reviewExpiresAt === 'string' ? value.reviewExpiresAt : new Date(now() + 45_000).toISOString(),
      signableMs: typeof value.signableMs === 'number' ? value.signableMs : MAX_SIGNABLE_WINDOW_MS,
      receivedAt: now(),
    },
  };
}

export type RunStore = Readonly<{
  read: () => Readonly<{ intentDigest: string; tupleId: string }> | null;
  save: (intentDigest: string, tupleId: string) => void;
  clear: () => void;
}>;

export type BridgeDeps = Readonly<{
  fetch: FetchLike;
  sign: (unsignedWireBase64: string) => Promise<SignResult>;
  runs: RunStore;
  now: () => number;
  onPhase?: (phase: 'wallet' | 'sending') => void;
}>;

/** A Review with less than this left is not signed: a wallet and a person need the time. */
export const REVIEW_MARGIN_MS = 10_000;

export type BridgeConfirm =
  /** On its way: follow the order by its digest. */
  | Readonly<{ kind: 'tracking'; intentDigest: string }>
  /** The bytes aged out before or while the wallet was open: never sent; a fresh Review is needed. */
  | Readonly<{ kind: 'stale'; line: string }>
  | Readonly<{ kind: 'cancelled'; line: string }>
  | Readonly<{ kind: 'refused'; line: string; code: string }>;

/** The lane's refusals the window names by their code. */
const REFUSAL_CODES = new Set<string>(['QUOTE_CHANGED', 'IMPACT_NOT_ACKNOWLEDGED', 'CROSS_SWAP_ALREADY_STARTED', 'RATE_LIMITED', 'QUOTE_RATE_LIMITED', 'TIMEOUT', 'NETWORK']);

/** A refusal of the cross-network lane as the window says it. Provider codes are never shown. */
export function bridgeRefusalWords(code: string): string {
  const w = wordsNow(WORDS);
  if (REFUSAL_CODES.has(code)) return (w as unknown as Readonly<Record<string, string>>)[code];
  if (/PAUSED|CLOSED|NOT_PERMITTED|GATE|LANE/.test(code)) return w.paused;
  if (/INSUFFICIENT|BALANCE|AMOUNT|MINIMUM/.test(code)) return w.amountBad;
  if (/ADDRESS|DESTINATION/.test(code)) return w.addressBad;
  return w.stopped;
}

/**
 * The one signature. The bytes are signed only while they still live; the run is kept before they leave, so a reload
 * follows the same order. A refusal that may have crossed the submit boundary is followed, never retried.
 */
export async function confirmBridge(deps: BridgeDeps, plan: BridgePlan, tupleId: string): Promise<BridgeConfirm> {
  if (deps.runs.read()) return { kind: 'refused', line: wordsNow(WORDS).CROSS_SWAP_ALREADY_STARTED, code: 'CROSS_SWAP_ALREADY_STARTED' };
  // The Review is read for a while; past its own time, or its bytes', the figures are asked for again.
  const reviewLeft = Date.parse(plan.reviewExpiresAt) - deps.now();
  if (!(reviewLeft >= REVIEW_MARGIN_MS) || !mayOpenWallet({ receivedAtMs: plan.receivedAt, signableMs: plan.signableMs, nowMs: deps.now() })) {
    return { kind: 'stale', line: wordsNow(WORDS).builtAgo };
  }
  deps.onPhase?.('wallet');
  const signed = await deps.sign(plan.unsignedWireBase64);
  if (!signed.ok) return { kind: 'cancelled', line: /reject|denie|cancel|declin/i.test(signed.reason) ? wordsNow(WORDS).cancelled : wordsNow(WORDS).notApproved };
  if (signableWindowClosed({ receivedAtMs: plan.receivedAt, signableMs: plan.signableMs, nowMs: deps.now() })) {
    return { kind: 'stale', line: wordsNow(WORDS).tooLong };
  }
  deps.onPhase?.('sending');
  deps.runs.save(plan.intentDigest, tupleId);
  const answer = await ask<Record<string, unknown>>(deps.fetch, '/api/solana/cross-swap/submit', {
    body: { phase: 'SOLANA', intentDigest: plan.intentDigest, reviewedTransactionBase64: plan.unsignedWireBase64, signedTransactionBase64: signed.signedWireBase64 },
    timeoutMs: TIMEOUT_MS.settle,
  });
  if (!answer.ok) {
    if (bridgeSubmitNeedsRecovery({ code: answer.failure.code, extra: answer.failure.extra as Record<string, unknown> })) return { kind: 'tracking', intentDigest: plan.intentDigest };
    deps.runs.clear();
    return { kind: 'refused', line: bridgeRefusalWords(answer.failure.code), code: answer.failure.code };
  }
  return { kind: 'tracking', intentDigest: plan.intentDigest };
}

export type OrderView = Readonly<{
  intentDigest: string;
  state: string;
  from: Readonly<{ network: SwapNetwork; symbol: string; decimals: number; amountRaw: string }>;
  to: Readonly<{ network: SwapNetwork; symbol: string; decimals: number; expectedRaw: string; minimumRaw: string }>;
  sourceTxHash: string | null;
  destinationTxHash: string | null;
  refundTxHash: string | null;
  receivedAmount: string | null;
}>;

export type OrderPhase = 'moving' | 'done' | 'refunded' | 'failed' | 'recovery';

/** Where an order stands, in the five words the window uses. Unknown is «moving», never «done». */
export function orderPhase(state: string): OrderPhase {
  if (state === 'COMPLETED') return 'done';
  if (state === 'REFUNDED') return 'refunded';
  if (state === 'SOURCE_FAILED' || state === 'EXPIRED_BEFORE_SUBMIT') return 'failed';
  if (state === 'RECOVERY_REQUIRED') return 'recovery';
  return 'moving';
}

/** The order's one word, large. */
export function orderWord(phase: OrderPhase): string {
  return wordsNow(ORDER)[phase];
}

/** The one line under the word, only where it changes what the person does or believes; none while it simply moves. */
export function orderLine(phase: OrderPhase): string {
  const w = wordsNow(ORDER);
  return phase === 'refunded' ? w.refundedLine : phase === 'failed' ? w.failedLine : phase === 'recovery' ? w.recoveryLine : '';
}

/** The order as the engine follows it. */
export async function readOrder(fetchImpl: FetchLike, intentDigest: string): Promise<OrderView | null> {
  const answer = await ask<Record<string, unknown>>(fetchImpl, '/api/solana/cross-swap/status', { body: { intentDigest } });
  if (!answer.ok) return null;
  const order = answer.value.order as OrderView | undefined;
  return order && order.intentDigest === intentDigest && typeof order.state === 'string' ? order : null;
}

/** The order's receipt, once it has ended. */
export async function readBridgeReceipt(fetchImpl: FetchLike, intentDigest: string): Promise<Record<string, unknown> | null> {
  const answer = await ask<Record<string, unknown>>(fetchImpl, '/api/solana/cross-swap/receipt', { body: { intentDigest } });
  if (!answer.ok) return null;
  const receipt = answer.value.receipt;
  return receipt && typeof receipt === 'object' ? (receipt as Record<string, unknown>) : null;
}

export function browserRuns(storage: () => Storage | null): RunStore {
  const announce = () => {
    try {
      window.dispatchEvent(new Event('ryntra:bridge-run'));
    } catch {
      // Outside a browser nobody listens.
    }
  };
  return {
    read: () => {
      try {
        const parsed = JSON.parse(storage()?.getItem(RUN_KEY) ?? 'null') as { intentDigest?: unknown; tupleId?: unknown } | null;
        return parsed && typeof parsed.intentDigest === 'string' && /^0x[0-9a-f]{64}$/.test(parsed.intentDigest) && typeof parsed.tupleId === 'string'
          ? { intentDigest: parsed.intentDigest, tupleId: parsed.tupleId }
          : null;
      } catch {
        return null;
      }
    },
    save: (intentDigest, tupleId) => {
      try {
        storage()?.setItem(RUN_KEY, JSON.stringify({ intentDigest, tupleId, savedAt: new Date().toISOString() }));
        announce();
      } catch {
        // A browser that refuses storage still gets the transfer; it loses only the reload path.
      }
    },
    clear: () => {
      try {
        storage()?.removeItem(RUN_KEY);
        announce();
      } catch {
        // Nothing to clear.
      }
    },
  };
}
