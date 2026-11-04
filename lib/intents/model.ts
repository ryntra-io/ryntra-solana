/**
 * A prepared action (CITY-161, contract 1.90.0): what an agent, a chat or a partner site may ask a person to sign —
 * a swap or a transfer, with its coin, amount, side and a deadline — and what Ryntra keeps of it.
 *
 * The intent is a request, never an authority. It carries no transaction, no text for the person to read and no
 * address to send anyone to: the city builds the exact transaction from these few fields at the moment the person
 * presses, shows the engine's own live quote, and the person's own wallet signs. Ryntra never signs for the person: the
 * swap engine accepts only the bytes it built and pinned for that wallet, and sends them once.
 *
 * Phase 1 (the engineering review of 31.10, `docs/research/ryntra-system-2026-10-31/critics/engineering.md` M1): every
 * beneficiary is the signer — a swap's coins land in the signing wallet — and a transfer to another address prepared by
 * an outside client is closed (`RYNTRA_INTENTS_TRANSFER`, closed unless the owner opens it). An intent may be bound to
 * one wallet (`for`); only that wallet can confirm it. Who prepared it is a name the client chose, never verified here,
 * and the sheet says so.
 *
 * Three properties hold it together:
 * - **Frozen.** The fields the person acts on (`IntentBody`) never change after creation; their SHA-256 digest is kept
 *   beside them, checked on every read and echoed by every step, so a body edited in storage without its digest is
 *   refused, not shown (and the production table's trigger refuses any edit of them at all).
 * - **Once.** A claim holds one wallet for a short lease. Before any bytes can leave, the wallet's signed bytes mark the
 *   claim (`claim.signature`, the wallet's own ed25519 signature checked by the server): from then on the claim is never
 *   let go, the same wallet pressing again is told to read that signature back rather than sign anew, and only a receipt
 *   for that signature ends the intent. A marked claim whose lease ran out is final (`LAPSED`) — no one can know then
 *   whether money moved. A claim that ran out unmarked sent nothing, and the intent is open again.
 * - **Until.** An intent that nobody claimed by its deadline is expired.
 *
 * Pure: no clock, no network, no store. Relative imports with their extension only.
 */

import { isAddress } from "../solana/allowances/model.ts";

export const INTENT_SCHEMA = "ryntra.intent" as const;
export const INTENT_SCHEMA_VERSION = "1.0.0" as const;
export const INTENT_NETWORK = "solana:mainnet" as const;

export const INTENT_ACTIONS = ["swap", "transfer"] as const;
export type IntentAction = (typeof INTENT_ACTIONS)[number];

export const INTENT_SIDES = ["buy", "sell"] as const;
export type IntentSide = (typeof INTENT_SIDES)[number];

/** What a swap is priced against: the coin is bought with it or sold into it. */
export const INTENT_PAY_ASSETS = ["SOL", "USDC"] as const;
export type IntentPayAsset = (typeof INTENT_PAY_ASSETS)[number];

/** The mint the swap engine trades for each pay asset (SOL is traded as wrapped SOL). */
export const PAY_MINTS: Readonly<Record<IntentPayAsset, string>> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

/** Native SOL in a transfer. */
export const NATIVE_SOL = "SOL" as const;

export const INTENT_ORIGIN_KINDS = ["agent", "chat", "partner"] as const;
export type IntentOriginKind = (typeof INTENT_ORIGIN_KINDS)[number];

/** Seconds an intent may wait for its person: one minute to one day, fifteen minutes when not said. */
export const INTENT_EXPIRY = { minSeconds: 60, maxSeconds: 86_400, defaultSeconds: 900 } as const;

/** How long one wallet holds a claimed intent: enough for a review, the wallet and the send, no more. */
export const CLAIM_LEASE_MS = 10 * 60_000;

/** 16 random bytes, base64url: unguessable, and the whole capability a link carries. */
export const INTENT_ID = /^[A-Za-z0-9_-]{22}$/;
/** The creator's key: 24 random bytes, base64url, shown once; only its SHA-256 is kept. */
export const CREATOR_KEY = /^[A-Za-z0-9_-]{32}$/;
/** Open intents one wallet may be bound to at once. */
export const OPEN_PER_WALLET = 20;
export const DIGEST = /^[0-9a-f]{64}$/;
/** A Solana transaction signature: 64 bytes in base58. */
export const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
/** A raw amount in the token's smallest unit: a positive whole number that fits a u64. */
export const AMOUNT_RAW = /^[1-9]\d{0,19}$/;
const U64_MAX = 18_446_744_073_709_551_615n;

/**
 * The name of whoever prepared it, as the sheet says «Prepared by …». Plain ASCII letters, digits, spaces, dots,
 * dashes and underscores, up to 32 characters: no link, no look-alike letters, no line breaks.
 */
export const ORIGIN_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9 ._-]{0,30}[A-Za-z0-9])?$/;

/**
 * Names no one but Ryntra or the wallet itself may say: an intent that claims to come from them is refused, so «Prepared
 * by Ryntra Support» never stands over someone else's request. Compared with every non-letter removed, case folded.
 */
const RESERVED_NAMES = ["ryntra", "official", "support", "admin", "phantom", "solflare", "backpack", "jupiter", "solana", "seeker", "wallet", "security", "verified"];

export type IntentSpec =
  | Readonly<{ action: "swap"; coin: string; side: IntentSide; pay: IntentPayAsset; amountRaw: string }>
  | Readonly<{ action: "transfer"; coin: string; amountRaw: string; to: string }>;

export type IntentOrigin = Readonly<{ kind: IntentOriginKind; name: string }>;

/** Everything the person acts on, frozen at creation and digested. */
export type IntentBody = Readonly<{
  schema: typeof INTENT_SCHEMA;
  schemaVersion: typeof INTENT_SCHEMA_VERSION;
  id: string;
  network: typeof INTENT_NETWORK;
  spec: IntentSpec;
  origin: IntentOrigin;
  /** The one wallet that may confirm it; null when any wallet may. */
  for: string | null;
  createdAt: string;
  expiresAt: string;
}>;

/** One wallet's hold on the intent; `signature` once that wallet's signed bytes marked it, before they could leave. */
export type IntentClaim = Readonly<{ wallet: string; until: string; signature: string | null }>;

/** How the server checked the receipt's signature: on chain, or not at all (a stand without a chain). */
export const RECEIPT_CHAIN = ["CONFIRMED", "FAILED", "UNCHECKED"] as const;
export type ReceiptChain = (typeof RECEIPT_CHAIN)[number];

export type IntentReceipt = Readonly<{ wallet: string; signature: string; at: string; chain: ReceiptChain }>;

export type IntentRecord = Readonly<{
  body: IntentBody;
  digest: string;
  /** SHA-256 (hex) of the creator's key; the key itself was shown once and is kept nowhere. */
  creatorKeyHash: string;
  /** Grows with every change of `claim`, `receipt` or `cancelledAt`; every change names the one it was decided on. */
  version: number;
  claim: IntentClaim | null;
  receipt: IntentReceipt | null;
  /** When its creator withdrew it, before anyone claimed it. */
  cancelledAt: string | null;
}>;

export const INTENT_STATUSES = ["OPEN", "CLAIMED", "DONE", "EXPIRED", "LAPSED", "CANCELLED"] as const;
export type IntentStatus = (typeof INTENT_STATUSES)[number];

/**
 * Where an intent stands now. A receipt is final; so is a withdrawal by its creator (`CANCELLED`); a marked claim whose
 * lease ran out without a receipt is final too (`LAPSED`) — its signature still receipts it. A claim that ran out
 * unmarked counts as none: the intent is `OPEN` again until its deadline, then `EXPIRED`. A claim's lease never runs past
 * the deadline.
 */
export function statusOf(record: Pick<IntentRecord, "body" | "claim" | "receipt" | "cancelledAt">, now: Date): IntentStatus {
  if (record.receipt) return "DONE";
  if (record.cancelledAt) return "CANCELLED";
  if (record.claim && Date.parse(record.claim.until) > now.getTime()) return "CLAIMED";
  if (record.claim?.signature) return "LAPSED";
  return Date.parse(record.body.expiresAt) > now.getTime() ? "OPEN" : "EXPIRED";
}

/** Whether an intent still holds one of its wallet's open places: not ended, not past its deadline or its lease. */
export function holdsPlace(record: Pick<IntentRecord, "body" | "claim" | "receipt" | "cancelledAt">, now: Date): boolean {
  const status = statusOf(record, now);
  return status === "OPEN" || status === "CLAIMED";
}

export function isAmountRaw(value: unknown): value is string {
  return typeof value === "string" && AMOUNT_RAW.test(value) && BigInt(value) <= U64_MAX;
}

export function isSolanaAddress(value: unknown): value is string {
  return typeof value === "string" && isAddress(value);
}

/** Digits that stand in for letters in a borrowed name: «Ryntr4 Supp0rt», «Phant0m». */
const LOOKALIKE_DIGITS: Readonly<Record<string, string>> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g" };

/** Null when the name may be said; otherwise why not. */
export function originNameRefusal(name: string): "SHAPE" | "RESERVED" | null {
  if (!ORIGIN_NAME.test(name) || /\s{2,}/.test(name)) return "SHAPE";
  const folded = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Anything that reads as an address: a scheme, «www», or a name ending in a dot and letters («jup.ag», «pump.fun»).
  if (/^(https?|www)/.test(folded) || /\.[a-z]{2,}$/i.test(name)) return "SHAPE";
  const letters = folded.replace(/[0-9]/g, (digit) => LOOKALIKE_DIGITS[digit] ?? digit);
  const seen = (word: string) => folded.includes(word) || letters.includes(word) || letters.replace(/l/g, "i").includes(word);
  return RESERVED_NAMES.some(seen) ? "RESERVED" : null;
}

/** The mint a transfer moves; null for native SOL. */
export function transferMint(spec: Extract<IntentSpec, { action: "transfer" }>): string | null {
  return spec.coin === NATIVE_SOL ? null : spec.coin;
}

/** The swap the engine is asked to price and build: what leaves the wallet, what arrives, and how much leaves. */
export function swapLeg(spec: Extract<IntentSpec, { action: "swap" }>): Readonly<{ inputMint: string; outputMint: string; amountRaw: string }> {
  const pay = PAY_MINTS[spec.pay];
  return spec.side === "buy"
    ? { inputMint: pay, outputMint: spec.coin, amountRaw: spec.amountRaw }
    : { inputMint: spec.coin, outputMint: pay, amountRaw: spec.amountRaw };
}

/** Why a spec that passed the schema still cannot be an intent; null when it can. */
export function specRefusal(spec: IntentSpec): string | null {
  if (!isAmountRaw(spec.amountRaw)) return "amountRaw: a positive whole number of the token's smallest unit.";
  if (spec.action === "swap") {
    if (!isSolanaAddress(spec.coin)) return "coin: a Solana mint address.";
    if (spec.coin === PAY_MINTS[spec.pay]) return "coin: the coin and what it is priced against are the same.";
    return null;
  }
  if (spec.coin !== NATIVE_SOL && !isSolanaAddress(spec.coin)) return "coin: \"SOL\" or a Solana mint address.";
  if (!isSolanaAddress(spec.to)) return "to: a Solana address.";
  if (spec.to === spec.coin) return "to: a mint is not a recipient.";
  return null;
}
