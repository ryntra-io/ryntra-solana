import { relayAfterSigning, type CollateralRelay } from '../../../lib/phoenix/collateral-model.ts';
import { fillsSummary, orderOutcomeOf, orderRelayAfterSigning, tifRests, type OrderOutcome, type OrderRelay, type OrderReview, type PerpFill } from '../../../lib/phoenix/orders-model.ts';
import { MAX_SIGNABLE_WINDOW_MS, mayOpenWallet, signableWindowClosed } from '../../../lib/solana/blockhash-life.ts';
import type { EngineResult } from '../trade/engine.ts';
import type { CollateralReview, CollateralSignatureState, ExchangeEngine, OrderSignatureState } from './engine.ts';

/**
 * One Exchange action from a Review the person has read to the chain's answer — an order or a move of collateral: the
 * wallet signs the Review's exact bytes in one prompt, the engine's relay sends them once, and an answer that never
 * came back is asked of the chain, never sent again. Bytes that aged out while the wallet was open are not sent: the
 * window builds a fresh Review instead.
 *
 * Which refusals mean «nothing was sent» is the engine's own list (`orderRelayAfterSigning`, `relayAfterSigning`), and
 * what the landed order did is the engine's reading of Phoenix's record (`orderOutcomeOf`, `fillsSummary`).
 */

/** The wallet's answer: the signed bytes, a no, or — `timedOut` — no answer before the bytes could no longer be sent. */
export type SignOne = (unsignedWireBase64: string) => Promise<Readonly<{ ok: true; signed: string }> | Readonly<{ ok: false; timedOut?: boolean }>>;

export type FlowDeps = Readonly<{
  engine: ExchangeEngine;
  sign: SignOne;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** How long the chain and Phoenix are asked about a signature nobody answered for. */
  followMs?: number;
  followEveryMs?: number;
  /** The wallet signed and the bytes are on their way to the relay — not yet on Solana. */
  onSigned?: (signature: string) => void;
}>;

export type Sent<R> =
  /** The bytes aged out before they could be sent: nothing was sent, review again. */
  | Readonly<{ kind: 'aged' }>
  /** Nothing was sent: the wallet said no, or the relay refused before its send. */
  | Readonly<{ kind: 'refused'; code: string; message: string | null }>
  /** Signed and handed to the relay: the relay's answer, followed on the chain. */
  | Readonly<{ kind: 'sent'; signature: string; relay: R }>;

export const FOLLOW_MS = 120_000;
export const FOLLOW_EVERY_MS = 4_000;

/** How long from arriving a Review's bytes may still be signed; a Review without the figure gets the longest window. */
export const signableMsOf = (review: Pick<OrderReview, 'signableMs'>): number => (Number.isFinite(review.signableMs) ? review.signableMs : MAX_SIGNABLE_WINDOW_MS);

/** Whether a Review on screen may still open the wallet, or must be built again first. */
export const reviewFresh = (review: Pick<OrderReview, 'signableMs'>, receivedAt: number, now: number): boolean => mayOpenWallet({ receivedAtMs: receivedAt, signableMs: signableMsOf(review), nowMs: now });

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = '';
  while (value > 0n) {
    text = ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

/**
 * A signed transaction's id, either format: legacy and v0 lead with the signature count and the signatures; v1
 * (`0x81`, SIMD-0385) puts them at the tail, one per signer, the first the wallet's.
 */
export function signatureOfWire(wireBase64: string): string {
  const bytes = Uint8Array.from(atob(wireBase64), (character) => character.charCodeAt(0));
  if (bytes[0] === 0x81) {
    const signers = bytes[1] ?? 1;
    const start = bytes.length - signers * 64;
    return base58(bytes.subarray(start, start + 64));
  }
  return base58(bytes.subarray(1, 65));
}

/** A compact-u16 (Solana's short vector length) at `at`: the value and where the bytes after it start; null past the end. */
function shortU16(bytes: Uint8Array, at: number): readonly [number, number] | null {
  let value = 0;
  for (let index = 0; index < 3; index += 1) {
    const byte = bytes[at + index];
    if (byte === undefined) return null;
    value |= (byte & 0x7f) << (7 * index);
    if ((byte & 0x80) === 0) return [value, at + index + 1];
  }
  return null;
}

/**
 * The connected wallet's own signature on the bytes it handed back — the city swap's rule (`readSwapClientSignature`
 * with the taker): the wallet must be the transaction's fee payer, its first signer, and its signature must be there.
 * Null otherwise, and such bytes are never sent. The engine's relay holds the same bytes to the Review's seal and checks
 * every signature (`checkSigned`); this is the page's own check before anything leaves it.
 *
 * Legacy and v0 lead with the signatures and keep the signers first in the message's static accounts (v0 after its
 * version byte); v1 (`0x81`, SIMD-0385) leads with the message — the header, a four-byte config mask, the lifetime and
 * two counts, then the static accounts — and puts one signature per signer at the tail.
 */
export function walletSignature(wireBase64: string, wallet: string): string | null {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(wireBase64), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
  let payer: Uint8Array;
  let signature: Uint8Array;
  if (bytes[0] === 0x81) {
    const signers = bytes[1] ?? 0;
    const payerAt = 1 + 3 + 4 + 32 + 1 + 1;
    const tail = bytes.length - signers * 64;
    if (signers < 1 || tail < payerAt + 32 * signers) return null;
    payer = bytes.subarray(payerAt, payerAt + 32);
    signature = bytes.subarray(tail, tail + 64);
  } else {
    const count = shortU16(bytes, 0);
    if (!count || count[0] < 1) return null;
    const [signatures, signaturesAt] = count;
    let at = signaturesAt + signatures * 64;
    if (bytes[at] === undefined) return null;
    if ((bytes[at]! & 0x80) !== 0) at += 1;
    const required = bytes[at];
    const keys = shortU16(bytes, at + 3);
    if (required !== signatures || !keys || keys[0] < required || bytes.length < keys[1] + 32) return null;
    payer = bytes.subarray(keys[1], keys[1] + 32);
    signature = bytes.subarray(signaturesAt, signaturesAt + 64);
  }
  if (payer.length !== 32 || signature.length !== 64 || signature.every((byte) => byte === 0)) return null;
  return base58(payer) === wallet ? base58(signature) : null;
}

const asAnswer = <T>(result: EngineResult<T>): Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: string }> =>
  result.ok ? { ok: true, value: result.value } : { ok: false, code: result.failure.code };

/** Sign one Review's bytes, hand them to the relay once, and keep the relay's answer — or the chain's, if it was lost. */
async function signAndRelay<R>(
  review: Pick<OrderReview, 'signableMs' | 'ticket' | 'transaction'>,
  receivedAt: number,
  owner: string,
  deps: FlowDeps,
  submit: (ticket: string, signed: readonly string[]) => Promise<EngineResult<R>>,
  afterSigning: (relayed: Readonly<{ ok: true; value: R }> | Readonly<{ ok: false; code: string }>, signatures: readonly string[]) => Readonly<{ ok: true; value: R }> | Readonly<{ ok: false; code: string }>,
): Promise<Sent<R>> {
  if (!reviewFresh(review, receivedAt, deps.now())) return { kind: 'aged' };
  const signed = await deps.sign(review.transaction.wireBase64);
  if (!signed.ok) return signed.timedOut ? { kind: 'aged' } : { kind: 'refused', code: 'WALLET_REFUSED', message: null };
  // The wallet stayed open past the bytes' life: the network would refuse them, so they are not sent.
  if (signableWindowClosed({ receivedAtMs: receivedAt, signableMs: signableMsOf(review), nowMs: deps.now() })) return { kind: 'aged' };
  // Bytes that are not a transaction, or not signed by the connected wallet as their payer, are never sent.
  const signature = walletSignature(signed.signed, owner);
  if (signature === null) return { kind: 'refused', code: 'NOT_SIGNED', message: null };
  deps.onSigned?.(signature);
  const relayed = await submit(review.ticket, [signed.signed]);
  if (!relayed.ok && relayed.failure.code === 'TICKET_EXPIRED') return { kind: 'aged' };
  const settled = afterSigning(asAnswer(relayed), [signature]);
  if (!settled.ok) return { kind: 'refused', code: settled.code, message: relayed.ok ? null : relayed.failure.message };
  // A relay answer without its results is no answer: the chain is asked, as for a lost one.
  const value = settled.value as R & { results?: unknown };
  const relay = Array.isArray(value?.results) ? settled.value : ({ results: [{ signature, state: 'UNKNOWN', reason: null }], settled: false } as unknown as R);
  return { kind: 'sent', signature, relay };
}

/* ------------------------------------------------------------------ orders */

/** Whether a landed order has fills to wait for: one that trades now — a market order, a cut, a close. */
export function expectsFills(review: Pick<OrderReview, 'kind' | 'tif'>): boolean {
  if (review.kind === 'reduce') return true;
  return review.kind === 'open' && review.tif !== null && !tifRests(review.tif);
}

const orderUnsettled = (fills: boolean) => (result: OrderRelay['results'][number]) => result.state === 'UNKNOWN' || (fills && result.state === 'LANDED' && result.fills == null);

/** An order's relay with the chain's and Phoenix's newer word merged in; a signature they do not know yet stays as it was. */
function mergeOrder(current: OrderRelay, seen: readonly OrderSignatureState[]): OrderRelay {
  const results = current.results.map((result, index) => {
    const read = seen[index];
    if (!read || read.signature !== result.signature || read.state === 'UNKNOWN') return result;
    const fills = read.fills ?? result.fills;
    return { ...result, state: read.state, reason: read.reason, ...(fills === undefined ? {} : { fills }) };
  });
  return { results, settled: results.every((result) => result.state === 'LANDED') };
}

/** One read of an order's signature — the receipt's «Check again», or one round of a follow. Reading only. */
export async function checkOrder(relay: OrderRelay, owner: string, engine: ExchangeEngine): Promise<OrderRelay> {
  const signature = relay.results[0]?.signature;
  if (!signature) return relay;
  const answer = await engine.orderStatus(owner, signature);
  return answer.ok && Array.isArray(answer.value.results) ? mergeOrder(relay, answer.value.results) : relay;
}

/** The chain's and Phoenix's word on an order, every few seconds, until it is known (with its fills) or the time is up. */
export async function followOrder(relay: OrderRelay, owner: string, fills: boolean, deps: FlowDeps): Promise<OrderRelay> {
  let current = relay;
  const unsettled = orderUnsettled(fills);
  const until = deps.now() + (deps.followMs ?? FOLLOW_MS);
  while (current.results.some(unsettled) && deps.now() < until) {
    await deps.sleep(deps.followEveryMs ?? FOLLOW_EVERY_MS);
    current = await checkOrder(current, owner, deps.engine);
  }
  return current;
}

/** Sign an order's Review and send it once; the outcome is followed on the chain and in Phoenix's record. */
export async function sendOrder(review: OrderReview, receivedAt: number, owner: string, deps: FlowDeps): Promise<Sent<OrderRelay>> {
  const sent = await signAndRelay(review, receivedAt, owner, deps, deps.engine.submitOrder, orderRelayAfterSigning);
  if (sent.kind !== 'sent') return sent;
  return { ...sent, relay: await followOrder(sent.relay, owner, expectsFills(review), deps) };
}

export type OrderReceipt = Readonly<{
  outcome: OrderOutcome;
  signature: string | null;
  /** Why it failed, the chain's word; null otherwise. */
  reason: string | null;
  /** What Phoenix's record says it filled, summed by the engine; null before the record came or when nothing filled. */
  fills: Readonly<{ sizeUnits: number; averageUsd: number | null; feeUsd: number | null; realizedPnlUsd: number | null }> | null;
}>;

/** A relayed order as the receipt says it: the engine's outcome over the chain's state and Phoenix's fills. */
export function orderReceipt(review: Pick<OrderReview, 'kind' | 'tif' | 'sizeUnits'>, relay: OrderRelay): OrderReceipt {
  const result = relay.results[0];
  if (!result) return { outcome: 'pending', signature: null, reason: null, fills: null };
  const fills: readonly PerpFill[] | null = result.fills ?? null;
  const summary = fills && fills.length ? fillsSummary(fills) : null;
  const sizeUnits = Number(review.sizeUnits);
  const outcome = orderOutcomeOf({ state: result.state, kind: review.kind, tif: review.tif, sizeUnits: Number.isFinite(sizeUnits) ? sizeUnits : 0, filledUnits: fills === null ? null : (summary?.sizeUnits ?? 0) });
  return { outcome, signature: result.signature, reason: result.reason, fills: summary };
}

/* -------------------------------------------------------------- collateral */

const collateralUnsettled = (result: CollateralRelay['results'][number]) => result.state === 'UNKNOWN' || (result.state === 'LANDED' && result.usdcMoved == null);

function mergeCollateral(current: CollateralRelay, seen: readonly CollateralSignatureState[]): CollateralRelay {
  const results = current.results.map((result, index) => {
    const read = seen[index];
    if (!read || read.signature !== result.signature || read.state === 'UNKNOWN') return result;
    const moved = read.usdcMoved ?? result.usdcMoved;
    return { ...result, state: read.state, reason: read.reason, ...(moved === undefined ? {} : { usdcMoved: moved }) };
  });
  return { results, settled: results.every((result) => result.state === 'LANDED') };
}

/** One read of a collateral move's signature, and — landed — the USDC it moved by the chain's record. Reading only. */
export async function checkCollateral(relay: CollateralRelay, engine: ExchangeEngine): Promise<CollateralRelay> {
  const signature = relay.results[0]?.signature;
  if (!signature) return relay;
  const answer = await engine.collateralStatus(signature);
  return answer.ok && Array.isArray(answer.value.results) ? mergeCollateral(relay, answer.value.results) : relay;
}

/** The chain's word on a collateral move until it is known, every few seconds, or the time is up. */
export async function followCollateral(relay: CollateralRelay, deps: FlowDeps): Promise<CollateralRelay> {
  let current = relay;
  const until = deps.now() + (deps.followMs ?? FOLLOW_MS);
  while (current.results.some(collateralUnsettled) && deps.now() < until) {
    await deps.sleep(deps.followEveryMs ?? FOLLOW_EVERY_MS);
    current = await checkCollateral(current, deps.engine);
  }
  return current;
}

export async function sendCollateral(review: CollateralReview, receivedAt: number, owner: string, deps: FlowDeps): Promise<Sent<CollateralRelay>> {
  const sent = await signAndRelay(review, receivedAt, owner, deps, deps.engine.submitCollateral, relayAfterSigning);
  if (sent.kind !== 'sent') return sent;
  return { ...sent, relay: await followCollateral(sent.relay, deps) };
}

export type CollateralReceipt = Readonly<{
  outcome: 'done' | 'failed' | 'pending';
  signature: string | null;
  reason: string | null;
  /** The wallet's USDC as the landed transaction changed it, micro-dollars without the sign; null until the chain shows it. */
  movedMicro: bigint | null;
}>;

export function collateralReceipt(relay: CollateralRelay): CollateralReceipt {
  const result = relay.results[0];
  if (!result) return { outcome: 'pending', signature: null, reason: null, movedMicro: null };
  const moved = typeof result.usdcMoved === 'string' && /^-?\d+$/.test(result.usdcMoved) ? BigInt(result.usdcMoved) : null;
  const outcome = result.state === 'LANDED' ? 'done' : result.state === 'FAILED' || result.state === 'NOT_SENT' ? 'failed' : 'pending';
  return { outcome, signature: result.signature, reason: result.reason, movedMicro: moved === null ? null : moved < 0n ? -moved : moved };
}
