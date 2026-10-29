/**
 * Public payment requests — the model.
 *
 * Three records, kept apart because they hold three kinds of data that must
 * not be one row:
 *
 * - {@link PaymentRequestRecord} is the **public** request: what `/pay/:id`
 *   shows anyone with the link. It carries the Solana Pay reference key and
 *   the recipient because a payer's wallet needs both; it carries no creator
 *   account, session or database identity.
 * - {@link PaymentRequestOwner} is the **private** creator association: which
 *   proven wallet (and, when one exists, which account) made the request. It is
 *   read only behind proof of ownership and never reaches the payer page.
 * - {@link PaymentRequestSettlement} is the **observation**: what the chain was
 *   seen to do about this request's reference. It alone may turn a request
 *   into `Paid`, and only through {@link derivePaymentStatus}.
 *
 * Everything in this file is pure: no clock it does not receive, no network,
 * no store. Ids are the one place randomness enters, and it is asked for
 * explicitly through `crypto.getRandomValues` / `crypto.subtle`.
 */

import { z } from "zod";

import { parseHumanAmount } from "../solana/amounts.ts";
import { base58Encode } from "../solana/mint.ts";
import { matchPayment, type ObservedPayment, type PaymentMatchState } from "../solana/payment-request.ts";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PUBLIC_ID = /^[1-9A-HJ-NP-Za-km-z]{14,20}$/;
const RAW_AMOUNT = /^(0|[1-9][0-9]*)$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export const PAYMENT_REQUEST_NETWORK = "mainnet" as const;

/** What a person may type as "what is it for". Wallets truncate longer notes. */
export const PAYMENT_DESCRIPTION_MAX = 120;

/**
 * Expiration presets. The server clamps to this list rather than accepting a
 * free timestamp, so a request cannot be made "valid forever" by a client.
 */
export const PAYMENT_EXPIRATIONS = ["1h", "24h", "7d", "30d"] as const;
export type PaymentExpiration = (typeof PAYMENT_EXPIRATIONS)[number];
export const DEFAULT_PAYMENT_EXPIRATION: PaymentExpiration = "7d";

const EXPIRATION_MS: Readonly<Record<PaymentExpiration, number>> = {
  "1h": 60 * 60 * 1_000,
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
};

export function expirationAt(preset: PaymentExpiration, now: Date): string {
  return new Date(now.getTime() + EXPIRATION_MS[preset]).toISOString();
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

export const PaymentRequestRecordSchema = z
  .object({
    schema: z.literal("ryntra.pay.request"),
    schemaVersion: z.literal("1.0.0"),
    /** The opaque id in the URL. Random, never sequential, never derived. */
    id: z.string().regex(PUBLIC_ID),
    network: z.literal(PAYMENT_REQUEST_NETWORK),
    /** The wallet being paid. A wallet, never a token account. */
    recipient: z.string().regex(BASE58),
    /** The Solana Pay reference key that makes this request findable on chain. */
    reference: z.string().regex(BASE58),
    /** Mint of the requested token, or null for native SOL. */
    mint: z.string().regex(BASE58).nullable(),
    decimals: z.number().int().min(0).max(18),
    symbol: z.string().min(1).max(24),
    /** Base units asked for, or null for an open request (the payer chooses). */
    amountRaw: z.string().regex(RAW_AMOUNT).nullable(),
    /** The same amount as the creator typed it, for display; null when open. */
    amountDisplay: z.string().min(1).max(40).nullable(),
    description: z.string().min(1).max(PAYMENT_DESCRIPTION_MAX).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type PaymentRequestRecord = z.output<typeof PaymentRequestRecordSchema>;

export const PaymentRequestOwnerSchema = z
  .object({
    schema: z.literal("ryntra.pay.owner"),
    schemaVersion: z.literal("1.0.0"),
    id: z.string().regex(PUBLIC_ID),
    network: z.literal(PAYMENT_REQUEST_NETWORK),
    /** The proven wallet that created the request. Equals the recipient by construction. */
    wallet: z.string().regex(BASE58),
    /** The account the proof session belonged to, when the wallet is linked to one. */
    accountId: z.string().min(1).max(64).nullable(),
    /** The proof session that authorized creation. Never shown anywhere. */
    proofSessionId: z.string().min(1).max(64).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type PaymentRequestOwner = z.output<typeof PaymentRequestOwnerSchema>;

export const SETTLEMENT_STATES = [
  "NONE",
  "PENDING",
  "PAID",
  "UNDERPAID",
  "OVERPAID",
  "WRONG_TOKEN",
] as const;
export type SettlementState = (typeof SETTLEMENT_STATES)[number];

export const PaymentRequestSettlementSchema = z
  .object({
    schema: z.literal("ryntra.pay.settlement"),
    schemaVersion: z.literal("1.0.0"),
    id: z.string().regex(PUBLIC_ID),
    /** What the chain was seen to do. `PENDING` = a submit went out and is not yet observed. */
    state: z.enum(SETTLEMENT_STATES),
    signature: z.string().regex(SIGNATURE).nullable(),
    /** Base units credited to the recipient in the requested mint, summed over every payment seen. */
    creditedRaw: z.string().regex(RAW_AMOUNT).nullable(),
    /**
     * Of that, what a Token-2022 mint's own transfer fee withheld on the way
     * (FIX-PAY-1). Absent on settlements written before it was read.
     */
    feeWithheldRaw: z.string().regex(RAW_AMOUNT).nullable().optional(),
    /**
     * True while transactions carrying the reference are still unread
     * (FIX-PAY-1): the verdict is a lower bound, and the page says «checking»
     * unless what was read already pays the request.
     */
    partial: z.boolean().optional(),
    /** The wallet that paid, when the transaction names one fee payer. */
    payer: z.string().regex(BASE58).nullable(),
    /** Block time of the settling transaction, when the ledger reports one. */
    paidAt: z.string().datetime({ offset: true }).nullable(),
    /** The last successful read of the reference, whatever it found. */
    observedAt: z.string().datetime({ offset: true }).nullable(),
    /** The last read attempt, successful or not. */
    checkedAt: z.string().datetime({ offset: true }),
    /** Consecutive reads that failed since the last successful one. */
    failures: z.number().int().min(0).max(1_000),
    lastError: z.string().max(400).nullable(),
  })
  .strict();
export type PaymentRequestSettlement = z.output<typeof PaymentRequestSettlementSchema>;

export function emptySettlement(id: string, checkedAt: string): PaymentRequestSettlement {
  return {
    schema: "ryntra.pay.settlement",
    schemaVersion: "1.0.0",
    id,
    state: "NONE",
    signature: null,
    creditedRaw: null,
    feeWithheldRaw: null,
    payer: null,
    paidAt: null,
    observedAt: null,
    checkedAt,
    failures: 0,
    lastError: null,
  };
}

/* ------------------------------------------------------------------ *
 * Ids
 * ------------------------------------------------------------------ */

/** Base58 of 12 bytes is at most 17 characters: 2^96 < 58^17. */
export const PUBLIC_ID_LENGTH = 17;

/**
 * The public id: 12 random bytes as base58, always 17 characters. Nothing
 * about the creator, the wallet, the time or a row count is encoded in it, so
 * knowing one link says nothing about any other.
 *
 * Base58 spells a small value shorter: a draw whose first byte was zero and the
 * rest small came out at 15 characters (about one in 16 000; the id test drew
 * 200 and failed about once in 80 runs). The spelling is left-padded
 * with "1", base58's zero, to the full length: still one id per byte string
 * (a number's own spelling never starts with "1"), and the length never says
 * anything about the bytes.
 */
export function newPublicId(random: (bytes: Uint8Array) => Uint8Array = fillRandom): string {
  const bytes = random(new Uint8Array(12));
  return base58Encode(bytes).padStart(PUBLIC_ID_LENGTH, "1");
}

export function isPublicId(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_ID.test(value);
}

/**
 * A fresh Solana Pay reference: an Ed25519 public key whose private half is
 * thrown away the moment it is made. It is a read-only account in the paying
 * transaction and can never sign, hold or move anything.
 */
export async function newReferenceKey(): Promise<string> {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  if (raw.length !== 32) throw new Error("An Ed25519 public key is 32 bytes.");
  return base58Encode(raw);
}

function fillRandom(bytes: Uint8Array): Uint8Array {
  crypto.getRandomValues(bytes);
  return bytes;
}

/* ------------------------------------------------------------------ *
 * Creation input
 * ------------------------------------------------------------------ */

export const CreatePaymentRequestInputSchema = z
  .object({
    mint: z.string().regex(BASE58).nullable(),
    amount: z.string().max(40).nullable(),
    description: z.string().max(PAYMENT_DESCRIPTION_MAX).nullable(),
    expiration: z.enum(PAYMENT_EXPIRATIONS).default(DEFAULT_PAYMENT_EXPIRATION),
  })
  .strict();
export type CreatePaymentRequestInput = z.output<typeof CreatePaymentRequestInputSchema>;

export type AssembleFailure = Readonly<{ ok: false; code: "AMOUNT_INVALID" | "DESCRIPTION_INVALID"; reason: string }>;

/**
 * Turn validated input plus the facts only the server knows (the proven
 * recipient, the mint's decimals and symbol, a fresh id and reference, the
 * clock) into the public record. Pure: the caller resolves everything else.
 */
export function assemblePaymentRequest(args: {
  id: string;
  reference: string;
  recipient: string;
  input: CreatePaymentRequestInput;
  decimals: number;
  symbol: string;
  now: Date;
}): Readonly<{ ok: true; request: PaymentRequestRecord }> | AssembleFailure {
  const amount = args.input.amount?.trim() || null;
  let amountRaw: string | null = null;
  if (amount !== null) {
    const parsed = parseHumanAmount(amount, args.decimals);
    if (!parsed.ok) return { ok: false, code: "AMOUNT_INVALID", reason: parsed.reason };
    if (parsed.raw === "0") return { ok: false, code: "AMOUNT_INVALID", reason: "An amount must be more than zero, or left empty." };
    amountRaw = parsed.raw;
  }
  const description = args.input.description?.trim().replace(/\s+/g, " ") || null;
  if (description !== null && description.length > PAYMENT_DESCRIPTION_MAX) {
    return { ok: false, code: "DESCRIPTION_INVALID", reason: `Keep the description to ${PAYMENT_DESCRIPTION_MAX} characters or fewer.` };
  }
  const request: PaymentRequestRecord = {
    schema: "ryntra.pay.request",
    schemaVersion: "1.0.0",
    id: args.id,
    network: PAYMENT_REQUEST_NETWORK,
    recipient: args.recipient,
    reference: args.reference,
    mint: args.input.mint,
    decimals: args.decimals,
    symbol: args.symbol,
    amountRaw,
    amountDisplay: amount === null ? null : tidyAmount(amount),
    description,
    createdAt: args.now.toISOString(),
    expiresAt: expirationAt(args.input.expiration, args.now),
  };
  const checked = PaymentRequestRecordSchema.safeParse(request);
  if (!checked.success) {
    return { ok: false, code: "AMOUNT_INVALID", reason: checked.error.issues[0]?.message ?? "The request could not be assembled." };
  }
  return { ok: true, request: checked.data };
}

function tidyAmount(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.includes(".")) return trimmed;
  const tidy = trimmed.replace(/0+$/, "").replace(/\.$/, "");
  return tidy === "" ? "0" : tidy;
}

/* ------------------------------------------------------------------ *
 * Status — the only way a request is ever called Paid
 * ------------------------------------------------------------------ */

export const PUBLIC_PAYMENT_STATUSES = ["AWAITING", "PAID", "EXPIRED", "CHECKING", "UNKNOWN"] as const;
export type PublicPaymentStatus = (typeof PUBLIC_PAYMENT_STATUSES)[number];

export type PublicPaymentStatusView = Readonly<{
  status: PublicPaymentStatus;
  /**
   * A mismatch the page should say out loud instead of pretending nothing
   * arrived: money came in the wrong token, or less than asked. Null when
   * nothing needs saying.
   */
  note: "UNDERPAID" | "WRONG_TOKEN" | "OVERPAID" | null;
  expired: boolean;
}>;

/**
 * Whether a settlement says the request is paid: PAID or OVERPAID **with** a
 * positive credit in the requested mint. Before FIX-PAY-1 a transaction that
 * moved nothing could leave PAID with a credit of "0"; such a settlement is
 * not a payment, is read again, and never shows «Paid».
 */
export function settlementPaid(
  settlement: Pick<PaymentRequestSettlement, "state" | "creditedRaw"> | null | undefined,
): settlement is Pick<PaymentRequestSettlement, "state" | "creditedRaw"> & { state: "PAID" | "OVERPAID"; creditedRaw: string } {
  if (!settlement || !(settlement.state === "PAID" || settlement.state === "OVERPAID")) return false;
  return typeof settlement.creditedRaw === "string" && /^[1-9][0-9]*$/.test(settlement.creditedRaw);
}

/** After this many consecutive failed reads the page stops saying "Checking". */
export const UNKNOWN_AFTER_FAILURES = 3;

/**
 * Derive what the payer page says from the record and its observation.
 *
 * `Paid` comes only from a settlement whose state is PAID or OVERPAID, and a
 * settlement reaches those states only through {@link settlementFromMatch},
 * which is fed by the reference-keyed observation — never by an amount seen
 * on the recipient's balance. Expiry is a server clock comparison here, not a
 * label the page computes for itself: a payer page that trusted its own clock
 * could be talked into inviting a payment the creator no longer wants.
 */
export function derivePaymentStatus(args: {
  request: Pick<PaymentRequestRecord, "expiresAt">;
  settlement: PaymentRequestSettlement | null;
  now: Date;
}): PublicPaymentStatusView {
  const expired = args.now.getTime() >= Date.parse(args.request.expiresAt);
  const settlement = args.settlement;
  if (settlementPaid(settlement)) {
    return { status: "PAID", note: settlement.state === "OVERPAID" ? "OVERPAID" : null, expired };
  }
  const note =
    settlement?.state === "UNDERPAID" ? "UNDERPAID" : settlement?.state === "WRONG_TOKEN" ? "WRONG_TOKEN" : null;
  if (expired) return { status: "EXPIRED", note, expired };
  /* Part of the history unread: not «awaiting» — it may already be paid. */
  if (settlement?.partial) return { status: "CHECKING", note, expired };
  if (settlement && settlement.observedAt === null && settlement.failures > 0) {
    return { status: settlement.failures >= UNKNOWN_AFTER_FAILURES ? "UNKNOWN" : "CHECKING", note, expired };
  }
  if (settlement && settlement.failures >= UNKNOWN_AFTER_FAILURES) {
    return { status: "UNKNOWN", note, expired };
  }
  if (settlement && settlement.failures > 0) {
    return { status: "CHECKING", note, expired };
  }
  return { status: "AWAITING", note, expired };
}

/**
 * Fold a reference-keyed observation into a settlement record.
 *
 * The observation is a list of payments that carried this request's reference,
 * oldest first, already reduced to "what was credited to the recipient in
 * which mint". The pure `matchPayment` from the Receive lane decides what that
 * means; this function only records it: the settling signature, and what
 * arrived in the requested mint summed over every payment. A read that failed keeps the previous
 * verdict and counts the failure, so a page never regresses from Paid to
 * Awaiting because one RPC call timed out.
 */
export function settlementFromMatch(args: {
  previous: PaymentRequestSettlement;
  request: Pick<PaymentRequestRecord, "amountRaw" | "mint" | "expiresAt">;
  observed: readonly (ObservedPayment & { payer: string | null; blockTime: string | null })[];
  now: Date;
  /** Transactions carrying the reference are still unread: what was read is a lower bound. */
  partial?: boolean;
}): PaymentRequestSettlement {
  const nowIso = args.now.toISOString();
  const match = matchPayment({
    expectedRaw: args.request.amountRaw,
    expectedMint: args.request.mint,
    observed: args.observed,
    expired: args.now.getTime() >= Date.parse(args.request.expiresAt),
  });
  const state = settlementStateFrom(match.state, args.previous.state);
  const payment = match.payment ? args.observed.find((entry) => entry.signature === match.payment?.signature) ?? null : null;
  /* What arrived in the requested mint, summed over every payment; another
     token's amount is not a credit of this request. */
  const counted = match.payments > 0;
  return {
    ...args.previous,
    state,
    signature: payment?.signature ?? (state === "PENDING" ? args.previous.signature : null),
    creditedRaw: counted ? match.receivedRaw : null,
    feeWithheldRaw: counted && match.feeWithheldRaw !== "0" ? match.feeWithheldRaw : null,
    payer: payment?.payer ?? null,
    paidAt: payment?.blockTime ?? (payment ? nowIso : null),
    observedAt: nowIso,
    checkedAt: nowIso,
    failures: 0,
    lastError: null,
    partial: args.partial === true && !(state === "PAID" || state === "OVERPAID"),
  };
}

function settlementStateFrom(match: PaymentMatchState, previous: SettlementState): SettlementState {
  switch (match) {
    case "PAID":
      return "PAID";
    case "OVERPAID":
      return "OVERPAID";
    case "UNDERPAID":
      return "UNDERPAID";
    case "WRONG_TOKEN":
      return "WRONG_TOKEN";
    case "AWAITING":
    case "EXPIRED":
      /* Nothing carrying the reference has landed. A submit that went out and
         has not shown up yet stays PENDING; otherwise there is nothing. */
      return previous === "PENDING" ? "PENDING" : "NONE";
  }
}

export function settlementAfterFailedRead(previous: PaymentRequestSettlement, now: Date, error: string): PaymentRequestSettlement {
  return {
    ...previous,
    checkedAt: now.toISOString(),
    failures: previous.failures + 1,
    lastError: error.slice(0, 400),
  };
}

/* ------------------------------------------------------------------ *
 * Public projection — what leaves the server
 * ------------------------------------------------------------------ */

export type PublicPaymentRequest = Readonly<{
  id: string;
  network: "mainnet";
  status: PublicPaymentStatus;
  note: PublicPaymentStatusView["note"];
  token: Readonly<{ symbol: string; mint: string | null; decimals: number }>;
  amount: Readonly<{ raw: string; display: string }> | null;
  description: string | null;
  recipient: Readonly<{ abbreviated: string; address: string }>;
  reference: string;
  createdAt: string;
  expiresAt: string;
  paid: Readonly<{ signature: string; creditedRaw: string; paidAt: string | null }> | null;
  /**
   * What reached the recipient in the requested token so far, summed over
   * every payment that carried the reference, and what the token's own
   * transfer fee withheld of it (null when it withheld nothing). Null while
   * nothing in that token arrived. 1.78.0 (FIX-PAY-1): the page and the
   * creator's list say how much came, not only a word.
   */
  received: Readonly<{ raw: string; feeWithheldRaw: string | null }> | null;
}>;

export function abbreviateAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/**
 * The projection the payer page and its API hand out. It carries the facts a
 * payer needs (recipient, reference, mint, amount) and nothing about the
 * creator's account, session, store keys or observation internals. The
 * recipient's full address is present because a wallet cannot pay an
 * abbreviation; the page *displays* the abbreviation.
 */
export function projectPublicPaymentRequest(args: {
  request: PaymentRequestRecord;
  settlement: PaymentRequestSettlement | null;
  now: Date;
}): PublicPaymentRequest {
  const view = derivePaymentStatus(args);
  const paid =
    view.status === "PAID" && args.settlement?.signature && args.settlement.creditedRaw
      ? { signature: args.settlement.signature, creditedRaw: args.settlement.creditedRaw, paidAt: args.settlement.paidAt }
      : null;
  const settled = args.settlement?.state;
  const received =
    args.settlement?.creditedRaw && args.settlement.creditedRaw !== "0" && (settled === "PAID" || settled === "OVERPAID" || settled === "UNDERPAID" || settled === "PENDING")
      ? { raw: args.settlement.creditedRaw, feeWithheldRaw: args.settlement.feeWithheldRaw ?? null }
      : null;
  return {
    id: args.request.id,
    network: args.request.network,
    status: view.status,
    note: view.note,
    token: { symbol: args.request.symbol, mint: args.request.mint, decimals: args.request.decimals },
    amount:
      args.request.amountRaw !== null && args.request.amountDisplay !== null
        ? { raw: args.request.amountRaw, display: args.request.amountDisplay }
        : null,
    description: args.request.description,
    recipient: { abbreviated: abbreviateAddress(args.request.recipient), address: args.request.recipient },
    reference: args.request.reference,
    createdAt: args.request.createdAt,
    expiresAt: args.request.expiresAt,
    paid,
    received,
  };
}

/** Keys a public payload must never carry. Tested, not remembered. */
export const FORBIDDEN_PUBLIC_KEYS: readonly string[] = [
  "accountId",
  "proofSessionId",
  "sessionId",
  "wallet",
  "owner",
  "storeKey",
  "lastError",
  "failures",
  "checkedAt",
  "partial",
];
