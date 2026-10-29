import type { LiquidityRelay, LiquidityReview } from '../../../../lib/liquidity/studio/actions.ts';
import { MAX_SIGNABLE_WINDOW_MS, mayOpenWallet, signableWindowClosed } from '../../../../lib/solana/blockhash-life.ts';
import type { HarborEngine } from './engine.ts';

/**
 * One pool action from a Review the person has read to the chain's answer: the wallet signs the Review's bytes in one
 * prompt, the engine's relay sends them once each, and an answer that never came back is asked of the chain — never
 * sent again. Bytes that aged out while the wallet was open are not sent: the card builds a fresh Review instead.
 */

export type SignMany = (unsignedWireBase64: readonly string[]) => Promise<Readonly<{ ok: true; signed: readonly string[] }> | Readonly<{ ok: false }>>;

export type FlowDeps = Readonly<{
  engine: HarborEngine;
  sign: SignMany;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** How long the chain is asked about signatures nobody answered for. */
  followMs?: number;
  followEveryMs?: number;
}>;

export type ActionOutcome =
  /** Every transaction landed. */
  | Readonly<{ kind: 'done'; signatures: readonly string[] }>
  /** Some landed and a later one did not: what landed stays done, the rest needs a fresh Review. */
  | Readonly<{ kind: 'partial'; signatures: readonly string[] }>
  /** It reached the chain and failed: only the network's fee was spent. */
  | Readonly<{ kind: 'failed'; signature: string | null }>
  /** Nothing was sent: the relay refused, or the wallet said no. */
  | Readonly<{ kind: 'refused'; code: string }>
  /** The bytes aged out before they could be sent; nothing was sent, build again. */
  | Readonly<{ kind: 'aged' }>
  /** Sent, and the chain has not said yet. Never send again; read it later. */
  | Readonly<{ kind: 'unknown'; signatures: readonly string[] }>;

/** How long from arriving a Review's bytes may still be signed; an engine that sends no figure gets the longest window. */
export function signableMsOf(review: LiquidityReview): number {
  return Number.isFinite(review.signableMs) ? review.signableMs : MAX_SIGNABLE_WINDOW_MS;
}

/** Whether a Review on the card may still open the wallet, or must be built again first. */
export function reviewFresh(review: LiquidityReview, receivedAt: number, now: number): boolean {
  return mayOpenWallet({ receivedAtMs: receivedAt, signableMs: signableMsOf(review), nowMs: now });
}

/** No answer at all — the request dropped, or a gateway's page — leaves the outcome to the chain. */
const unanswered = (code: string) => code === 'NETWORK' || code === 'TIMEOUT' || /^HTTP_5\d\d$/.test(code);

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

/** A signed transaction's id: its first signature, after the one-byte count. */
export function signatureOfWire(wireBase64: string): string {
  const bytes = Uint8Array.from(atob(wireBase64), (character) => character.charCodeAt(0));
  return base58(bytes.subarray(1, 65));
}

/** The relay's results as one outcome. */
export function outcomeOf(relay: LiquidityRelay): ActionOutcome {
  const results = relay.results;
  const signatures = results.map((result) => result.signature);
  if (results.length > 0 && results.every((result) => result.state === 'LANDED')) return { kind: 'done', signatures };
  if (results.some((result) => result.state === 'UNKNOWN')) return { kind: 'unknown', signatures };
  const failed = results.find((result) => result.state === 'FAILED');
  if (results.some((result) => result.state === 'LANDED')) return { kind: 'partial', signatures };
  return { kind: 'failed', signature: failed?.signature ?? null };
}

/** Ask the chain about the signatures nobody answered for, every few seconds, until it knows or the time is up. */
export async function follow(relay: LiquidityRelay, deps: FlowDeps): Promise<LiquidityRelay> {
  let current = relay;
  const until = deps.now() + (deps.followMs ?? 120_000);
  while (current.results.some((result) => result.state === 'UNKNOWN') && deps.now() < until) {
    await deps.sleep(deps.followEveryMs ?? 4_000);
    const answer = await deps.engine.status(current.results.map((result) => result.signature));
    if (!answer.ok || !Array.isArray(answer.value.results)) continue;
    const results = current.results.map((result, index) => {
      const seen = answer.value.results[index];
      return seen && seen.signature === result.signature && seen.state !== 'UNKNOWN' ? { ...result, state: seen.state, reason: seen.reason } : result;
    });
    current = { results, settled: results.every((result) => result.state === 'LANDED') };
  }
  return current;
}

/** Sign the Review's bytes and hand them to the relay, once. */
export async function signAndSend(review: LiquidityReview, receivedAt: number, deps: FlowDeps): Promise<ActionOutcome> {
  if (!reviewFresh(review, receivedAt, deps.now())) return { kind: 'aged' };
  const signed = await deps.sign(review.transactions.map((tx) => tx.wireBase64));
  if (!signed.ok) return { kind: 'refused', code: 'WALLET_REFUSED' };
  if (signed.signed.length !== review.transactions.length) return { kind: 'refused', code: 'WALLET_REFUSED' };
  // The wallet stayed open past the bytes' life: the network would refuse them, so they are not sent.
  if (signableWindowClosed({ receivedAtMs: receivedAt, signableMs: signableMsOf(review), nowMs: deps.now() })) return { kind: 'aged' };
  const relayed = await deps.engine.submit(review.ticket, signed.signed);
  if (relayed.ok) return outcomeOf(await follow(relayed.value, deps));
  if (relayed.failure.code === 'TICKET_EXPIRED') return { kind: 'aged' };
  // The relay words a refusal only before its first send: a worded refusal means nothing moved.
  if (!unanswered(relayed.failure.code)) return { kind: 'refused', code: relayed.failure.code };
  const unknown: LiquidityRelay = { results: signed.signed.map((wire) => ({ signature: signatureOfWire(wire), state: 'UNKNOWN' as const, reason: null })), settled: false };
  return outcomeOf(await follow(unknown, deps));
}
