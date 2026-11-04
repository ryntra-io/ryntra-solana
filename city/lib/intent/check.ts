import type { Intent, IntentSpec, IntentSwapSpec, IntentTransferSpec } from '../../../packages/ryntra-api-client/src/types.ts';

/**
 * The prepared action in the city (CITY-161), believed only in the shape the contract gives it, and the checks that
 * stand between it and the person's wallet: what the engine built must be exactly what was prepared — the same coins,
 * the same amount, the same recipient, the person's own wallet as the signer. Anything else is refused before the
 * wallet opens. The sheet never shows the intent's own words: only the engine's quote, the real recipient and who
 * prepared it.
 *
 * Pure. Relative imports with their extension only.
 */

export type { Intent, IntentSpec, IntentSwapSpec, IntentTransferSpec };

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
/** What a native SOL transfer plan names as its «mint»: the system program. */
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const PAY: Readonly<Record<IntentSwapSpec['pay'], string>> = { SOL: SOL_MINT, USDC: USDC_MINT };

const ID = /^[A-Za-z0-9_-]{22}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW = /^[1-9]\d{0,19}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const ORIGIN = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,30}[A-Za-z0-9])?$/;
const STATUSES = new Set(['OPEN', 'CLAIMED', 'DONE', 'EXPIRED', 'LAPSED', 'CANCELLED']);
const KINDS = new Set(['agent', 'chat', 'partner']);

const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const iso = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

function specOf(value: unknown): IntentSpec | null {
  const spec = record(value);
  if (!spec || typeof spec.amountRaw !== 'string' || !RAW.test(spec.amountRaw) || typeof spec.coin !== 'string') return null;
  if (spec.action === 'swap') {
    if (!ADDRESS.test(spec.coin) || (spec.side !== 'buy' && spec.side !== 'sell') || (spec.pay !== 'SOL' && spec.pay !== 'USDC')) return null;
    if (spec.coin === PAY[spec.pay]) return null;
    return { action: 'swap', coin: spec.coin, side: spec.side, pay: spec.pay, amountRaw: spec.amountRaw };
  }
  if (spec.action === 'transfer') {
    if ((spec.coin !== 'SOL' && !ADDRESS.test(spec.coin)) || typeof spec.to !== 'string' || !ADDRESS.test(spec.to)) return null;
    return { action: 'transfer', coin: spec.coin, amountRaw: spec.amountRaw, to: spec.to };
  }
  return null;
}

/**
 * The intent from an answer of `/api/v1/intents/{id}`, or null when it is not one — or not the one the address names.
 * Only the fields the contract gives are kept; nothing else the answer might carry reaches the screen.
 */
export function readIntent(body: unknown, id: string): Intent | null {
  const view = record(record(body)?.intent);
  if (!view || view.id !== id || !ID.test(id)) return null;
  const spec = specOf(view.spec);
  const origin = record(view.origin);
  const links = record(view.links);
  const receipt = record(view.receipt);
  if (!spec || !origin || !links) return null;
  if (typeof view.status !== 'string' || !STATUSES.has(view.status) || view.network !== 'solana:mainnet') return null;
  if (typeof origin.kind !== 'string' || !KINDS.has(origin.kind) || typeof origin.name !== 'string' || !ORIGIN.test(origin.name)) return null;
  if (typeof view.digest !== 'string' || !DIGEST.test(view.digest) || !iso(view.createdAt) || !iso(view.expiresAt)) return null;
  if (view.for !== null && view.for !== undefined && (typeof view.for !== 'string' || !ADDRESS.test(view.for))) return null;
  const chain: 'CONFIRMED' | 'FAILED' | 'UNCHECKED' = receipt?.chain === 'CONFIRMED' || receipt?.chain === 'FAILED' ? receipt.chain : 'UNCHECKED';
  const done =
    receipt && typeof receipt.wallet === 'string' && ADDRESS.test(receipt.wallet) && typeof receipt.signature === 'string' && SIGNATURE.test(receipt.signature) && iso(receipt.at)
      ? { wallet: receipt.wallet, signature: receipt.signature, at: receipt.at, chain }
      : null;
  return {
    id,
    status: view.status as Intent['status'],
    network: 'solana:mainnet',
    spec,
    // Who prepared it is the name its client chose: the city calls it verified only when the engine says so.
    origin: { kind: origin.kind as Intent['origin']['kind'], name: origin.name, verified: origin.verified === true },
    for: typeof view.for === 'string' ? view.for : null,
    createdAt: view.createdAt,
    expiresAt: view.expiresAt,
    digest: view.digest,
    claimedUntil: iso(view.claimedUntil) ? view.claimedUntil : null,
    sentSignature: typeof view.sentSignature === 'string' && SIGNATURE.test(view.sentSignature) ? view.sentSignature : null,
    receipt: done,
    links: { url: String(links.url ?? ''), qr: String(links.qr ?? '') },
  };
}

/** Why the link no longer opens a sheet: used (or lapsed), past its deadline, withdrawn, unknown, or not what was prepared. */
export type Gone = 'used' | 'expired' | 'cancelled' | 'missing' | 'changed';

export function goneOfStatus(status: Intent['status']): Gone | null {
  if (status === 'LAPSED') return 'used';
  if (status === 'EXPIRED') return 'expired';
  if (status === 'CANCELLED') return 'cancelled';
  return null;
}

export function goneOfCode(code: string): Gone | null {
  if (code === 'INTENT_USED') return 'used';
  if (code === 'INTENT_EXPIRED') return 'expired';
  if (code === 'INTENT_CANCELLED') return 'cancelled';
  if (code === 'INTENT_NOT_FOUND' || code === 'CAPABILITY_UNAVAILABLE') return 'missing';
  if (code === 'INTENT_CHANGED') return 'changed';
  return null;
}

/** The swap the engine is asked to price and build for the connected wallet. */
export function swapLeg(spec: IntentSwapSpec): Readonly<{ inputMint: string; outputMint: string; amountRaw: string }> {
  const pay = PAY[spec.pay];
  return spec.side === 'buy' ? { inputMint: pay, outputMint: spec.coin, amountRaw: spec.amountRaw } : { inputMint: spec.coin, outputMint: pay, amountRaw: spec.amountRaw };
}

/** The pay asset's mint (what the coin is priced against). */
export const payMint = (spec: IntentSwapSpec): string => PAY[spec.pay];

type BuiltOrder = Readonly<{ taker: string; inputMint: string; outputMint: string; inAmountRaw: string }>;

/** Whether the exact order the engine built is the prepared swap, for this wallet: same coins, same amount in, same signer. */
export function orderFitsIntent(order: BuiltOrder, spec: IntentSwapSpec, taker: string): boolean {
  const leg = swapLeg(spec);
  return order.taker === taker && order.inputMint === leg.inputMint && order.outputMint === leg.outputMint && order.inAmountRaw === leg.amountRaw;
}

type BuiltPlan = Readonly<{ actionKind: string; mint: string | null; sender: string; recipient: string; amountRaw: string }>;

/** Whether the exact transfer the engine built is the prepared one, from this wallet: same coin, amount and recipient. */
export function planFitsIntent(plan: BuiltPlan, spec: IntentTransferSpec, sender: string): boolean {
  if (plan.sender !== sender || plan.recipient !== spec.to || plan.amountRaw !== spec.amountRaw) return false;
  if (spec.coin === 'SOL') return plan.actionKind === 'NATIVE_SOL' && (plan.mint === null || plan.mint === SYSTEM_PROGRAM);
  return plan.actionKind !== 'NATIVE_SOL' && plan.mint === spec.coin;
}

/** Whole minutes left before the deadline, at least zero. */
export function minutesLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}

/** The coin the sheet is about: the swap's coin, or the transfer's token (null for native SOL). */
export function coinMintOf(spec: IntentSpec): string | null {
  if (spec.action === 'swap') return spec.coin;
  return spec.coin === 'SOL' ? null : spec.coin;
}
