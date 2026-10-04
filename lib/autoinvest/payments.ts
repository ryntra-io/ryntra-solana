/**
 * «З кожної оплати» — what a wallet's own USDC movement is, and what a rule
 * takes from it.
 *
 * **Only real events of the person's own spending.** The first source
 * is the wallet itself on Solana: a transaction in which the wallet's USDC
 * went down and someone else's went up, signed by the wallet, is a payment; a
 * transaction in which the wallet's USDC went up and someone else's went
 * down, signed by somebody else, is money that came in. Nothing else is:
 *
 * - a swap — any other token of the wallet moved in the same transaction, or
 *   the wallet came out of it with more SOL (a sale into SOL);
 * - Ryntra's own purchase — it is a swap, and History names its signature too
 *   (the watch drops those before a rule sees them);
 * - a transfer between the person's own accounts — the wallet's USDC moving
 *   between its own token accounts, USDC that leaves or arrives with nobody
 *   on the other side (a bridge, a burn, a mint), and a transfer to or from an
 *   account the person has named as their own;
 * - USDC that arrives in a transaction the wallet signed itself — a swap into
 *   USDC, a withdrawal, a claim: the person's own act, not money coming in;
 * - USDC that leaves without the wallet's signature — a delegate's act, not
 *   the person's payment;
 * - a movement under a cent.
 *
 * **Each event once.** An event is a transaction, named by its signature; a
 * rule counts events in the order the watch numbered them and remembers the
 * last number it took, so no retried pass, re-read or second endpoint counts
 * a payment twice.
 *
 * **No shop is ever named.** The other side is kept only so the person can
 * say «це мій рахунок»; what a person reads is the sum, the time and — where
 * the payment carries one — its Solana Pay label, the memo it was sent with.
 *
 * **What a rule takes** is in whole cents: the round-up of a payment to the
 * next $1 or $5 (a payment already on the dollar rounds up nothing), a fixed
 * sum from every payment, or a per cent of every USDC that comes in. The money
 * stays in the wallet; the sum gathers until the rule's minimum and then goes
 * the way every rule's purchase goes — the reminder, a fresh Review with the
 * price condition, the person's signature, the receipt.
 *
 * Pure and client-safe: the transaction, the owner and the rule's terms are
 * arguments.
 */

import { PAYMENT_EVENT_MIN_USD } from "./limits.ts";

/** Circle-issued USDC on Solana Mainnet — the one currency these rules read. */
export const PAYMENTS_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** `roundup` — the round-up of every payment · `fixed` — a sum from every payment · `percent` — a per cent of every USDC that comes in. */
export const RULE_PAYMENT_MODES = ["roundup", "fixed", "percent"] as const;
export type RulePaymentMode = (typeof RULE_PAYMENT_MODES)[number];

/** Which way the wallet's USDC moved: `out` a payment, `in` money that came in. */
export const PAYMENT_DIRECTIONS = ["out", "in"] as const;
export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

/** Why a transaction is not an event, for the tests and the watch's own count. */
export const NOT_COUNTED_REASONS = ["failed", "no-usdc", "own", "swap", "sol-in", "no-counterparty", "signed-inflow", "not-signed", "dust"] as const;
export type NotCountedReason = (typeof NOT_COUNTED_REASONS)[number];

/** A rule's terms: the mode and the one figure it names. */
export type PaymentTerms = Readonly<{ mode: RulePaymentMode; roundToUsd: number | null; fixedUsd: number | null; percent: number | null }>;

/** A token balance as the chain states it before or after a transaction. */
export type ChainTokenBalance = Readonly<{
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: Readonly<{ amount: string; decimals: number }>;
}>;

/** A transaction trimmed to what the classification reads. */
export type ChainTransaction = Readonly<{
  signature: string;
  slot: number;
  /** Seconds since the epoch, as the chain states the block's time; null where it does not. */
  blockTime: number | null;
  failed: boolean;
  accountKeys: readonly Readonly<{ pubkey: string; signer: boolean }>[];
  /** Lamports of every account key, before and after. */
  preBalances: readonly number[];
  postBalances: readonly number[];
  preTokenBalances: readonly ChainTokenBalance[];
  postTokenBalances: readonly ChainTokenBalance[];
  /** The texts of the transaction's memo instructions, in order. */
  memos: readonly string[];
}>;

export type UsdcMovement = Readonly<{
  direction: PaymentDirection;
  /** The wallet's USDC that left or arrived, in micro-dollars (six places). */
  amountMicro: bigint;
  /** The other side: the owner credited most by a payment, or debited most by money that came in. Never shown — only matched against the person's own accounts. */
  counterparty: string | null;
  /** The Solana Pay label — the memo the transfer carried — cleaned and short; null without one. */
  memo: string | null;
}>;

export type MovementVerdict = Readonly<{ counted: true; movement: UsdcMovement }> | Readonly<{ counted: false; reason: NotCountedReason }>;

const MICRO_PER_CENT = 10_000n;
const MIN_EVENT_MICRO = BigInt(Math.round(PAYMENT_EVENT_MIN_USD * 1_000_000));
const MEMO_MAX = 64;

function rawOf(entry: ChainTokenBalance | undefined): bigint {
  const amount = entry?.uiTokenAmount.amount;
  return typeof amount === "string" && /^\d+$/.test(amount) ? BigInt(amount) : 0n;
}

/**
 * A memo as a person may read it: control characters out, whitespace
 * collapsed, at most 64 characters; null when nothing readable is left.
 */
/** Characters a memo may carry that a person cannot see: controls, zero-width marks, line and direction overrides. */
function isInvisible(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

export function cleanMemo(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  let visible = "";
  for (const char of text) visible += isInvisible(char.codePointAt(0) ?? 0) ? " " : char;
  const plain = visible.replace(/\s+/g, " ").trim();
  if (plain.length === 0) return null;
  return plain.length > MEMO_MAX ? `${plain.slice(0, MEMO_MAX - 1)}\u2026` : plain;
}

/**
 * Each token account's change in one transaction, with the owner the chain
 * names for it. An account missing on one side held nothing there (it was
 * opened or closed in the transaction).
 */
function tokenChanges(tx: ChainTransaction): readonly Readonly<{ owner: string | null; mint: string; delta: bigint; address: string | null }>[] {
  const indices = new Set<number>([...tx.preTokenBalances.map((entry) => entry.accountIndex), ...tx.postTokenBalances.map((entry) => entry.accountIndex)]);
  const changes: { owner: string | null; mint: string; delta: bigint; address: string | null }[] = [];
  for (const index of indices) {
    const pre = tx.preTokenBalances.find((entry) => entry.accountIndex === index);
    const post = tx.postTokenBalances.find((entry) => entry.accountIndex === index);
    const mint = post?.mint ?? pre?.mint;
    if (!mint) continue;
    changes.push({ owner: post?.owner ?? pre?.owner ?? null, mint, delta: rawOf(post) - rawOf(pre), address: tx.accountKeys[index]?.pubkey ?? null });
  }
  return changes;
}

/** Of several owners on one side, the one that moved the most — the other side of the transfer. */
function largest(entries: readonly Readonly<{ owner: string; amount: bigint }>[]): string | null {
  let best: Readonly<{ owner: string; amount: bigint }> | null = null;
  for (const entry of entries) if (!best || entry.amount > best.amount) best = entry;
  return best?.owner ?? null;
}

/**
 * What one transaction is to one wallet: a payment, money that came in, or
 * nothing — with the reason. `ownAccount` is the wallet's own USDC account,
 * so a balance the chain states without its owner is still the wallet's.
 */
export function classifyMovement(tx: ChainTransaction, owner: string, ownAccount: string | null = null): MovementVerdict {
  if (tx.failed) return { counted: false, reason: "failed" };
  const changes = tokenChanges(tx);
  const isOwners = (change: Readonly<{ owner: string | null; address: string | null }>): boolean => change.owner === owner || (change.owner === null && ownAccount !== null && change.address === ownAccount);
  const own = changes.filter(isOwners);
  const ownUsdc = own.filter((change) => change.mint === PAYMENTS_USDC_MINT);
  const net = ownUsdc.reduce((sum, change) => sum + change.delta, 0n);
  if (net === 0n) return { counted: false, reason: ownUsdc.some((change) => change.delta !== 0n) ? "own" : "no-usdc" };
  /* Any other token of the wallet moving beside its USDC is a swap, a deposit or a withdrawal — never a payment. */
  if (own.some((change) => change.mint !== PAYMENTS_USDC_MINT && change.delta !== 0n)) return { counted: false, reason: "swap" };

  const keyIndex = tx.accountKeys.findIndex((key) => key.pubkey === owner);
  const signed = keyIndex >= 0 && tx.accountKeys[keyIndex].signer;
  const lamports = keyIndex >= 0 ? (tx.postBalances[keyIndex] ?? 0) - (tx.preBalances[keyIndex] ?? 0) : 0;
  const others = changes.filter((change) => !isOwners(change) && change.mint === PAYMENTS_USDC_MINT && change.owner !== null && change.owner !== owner);
  const memo = cleanMemo(tx.memos.find((text) => cleanMemo(text) !== null) ?? null);

  if (net < 0n) {
    if (!signed) return { counted: false, reason: "not-signed" };
    /* The wallet came out with more SOL: a sale of USDC into SOL, whatever else it looks like. */
    if (lamports > 0) return { counted: false, reason: "sol-in" };
    const credited = others.filter((change) => change.delta > 0n).map((change) => ({ owner: change.owner as string, amount: change.delta }));
    if (credited.length === 0) return { counted: false, reason: "no-counterparty" };
    const amountMicro = -net;
    if (amountMicro < MIN_EVENT_MICRO) return { counted: false, reason: "dust" };
    return { counted: true, movement: { direction: "out", amountMicro, counterparty: largest(credited), memo } };
  }

  if (signed) return { counted: false, reason: "signed-inflow" };
  const debited = others.filter((change) => change.delta < 0n).map((change) => ({ owner: change.owner as string, amount: -change.delta }));
  if (debited.length === 0) return { counted: false, reason: "no-counterparty" };
  if (net < MIN_EVENT_MICRO) return { counted: false, reason: "dust" };
  return { counted: true, movement: { direction: "in", amountMicro: net, counterparty: largest(debited), memo } };
}

/** The balance one token account held before and after a transaction, in raw units — the chain of balances that proves no transaction was skipped. */
export function accountBalances(tx: ChainTransaction, account: string): Readonly<{ pre: bigint; post: bigint; touched: boolean }> {
  const index = tx.accountKeys.findIndex((key) => key.pubkey === account);
  if (index < 0) return { pre: 0n, post: 0n, touched: false };
  const pre = tx.preTokenBalances.find((entry) => entry.accountIndex === index);
  const post = tx.postTokenBalances.find((entry) => entry.accountIndex === index);
  return { pre: rawOf(pre), post: rawOf(post), touched: true };
}

/** Micro-dollars to whole cents, half up. */
export function centsOfMicro(micro: bigint): number {
  if (micro <= 0n) return 0;
  return Number((micro + MICRO_PER_CENT / 2n) / MICRO_PER_CENT);
}

/**
 * What a rule takes from one event, in whole cents: the round-up of a
 * payment to the next step (nothing when it is already on the step), a fixed
 * sum from a payment, or a per cent of money that came in. An event of the
 * other direction takes nothing.
 */
export function contributionCents(terms: PaymentTerms, movement: Readonly<{ direction: PaymentDirection; amountMicro: bigint }>): number {
  if (movement.amountMicro < MIN_EVENT_MICRO) return 0;
  if (terms.mode === "percent") {
    if (movement.direction !== "in" || terms.percent === null) return 0;
    return centsOfMicro((movement.amountMicro * BigInt(terms.percent)) / 100n);
  }
  if (movement.direction !== "out") return 0;
  if (terms.mode === "fixed") return terms.fixedUsd === null ? 0 : Math.round(terms.fixedUsd * 100);
  if (terms.roundToUsd === null) return 0;
  const step = BigInt(Math.round(terms.roundToUsd)) * 1_000_000n;
  const remainder = movement.amountMicro % step;
  return remainder === 0n ? 0 : centsOfMicro(step - remainder);
}

/** Which direction a mode reads: a payment for the round-up and the fixed sum, money that came in for the per cent. */
export function directionOfMode(mode: RulePaymentMode): PaymentDirection {
  return mode === "percent" ? "in" : "out";
}

/** Micro-dollars as dollars, to the micro-dollar. */
export function usdOfMicro(micro: bigint | string): number {
  const value = typeof micro === "string" ? BigInt(micro) : micro;
  return Number(value) / 1_000_000;
}
