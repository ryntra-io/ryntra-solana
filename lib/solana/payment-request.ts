/**
 * A payment request, as a Solana Pay URL.
 *
 * The whole surface of Receive is two things: an address somebody can pay, and
 * a request for a specific amount of a specific token. The second is a URL,
 * and a QR code is only a picture of it — which is why nothing here imports a
 * QR library, and why the wallet SDK is not needed either. A transfer request
 * is a URI with a handful of query parameters, and building it correctly is
 * about encoding and refusals rather than about protocol machinery.
 *
 * ## The shape
 *
 *   solana:<recipient>?amount=&spl-token=&reference=&label=&message=&memo=
 *
 * `recipient` is the account that receives. For SOL that is the wallet itself;
 * for a token it is still the wallet, and the paying wallet derives the
 * associated token account from `spl-token`. Ryntra never puts a token account
 * in the recipient position — a payer who read it literally would send to an
 * account that cannot receive anything else, and a payer who did not would
 * derive an account from an account.
 *
 * `amount` is in **display units**, not base units. This is the one place in
 * the Solana lane where that is true, and it is the spec's decision rather than
 * ours, so the conversion happens here, exactly once, and refuses more
 * precision than the token can hold instead of rounding it.
 *
 * `reference` is a public key that appears in the transaction as a read-only
 * account and moves nothing. It is what makes "did this exact request get
 * paid?" answerable: a wallet address alone cannot distinguish two invoices for
 * the same amount, and matching on amount is how somebody else's payment gets
 * credited to your invoice.
 *
 * Pure and total: no clock, no network, no throw. Everything that could be
 * wrong comes back as a named refusal.
 */

import { parseHumanAmount } from "./amounts.ts";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const PAYMENT_REQUEST_FAILURES = [
  "RECIPIENT_INVALID",
  "MINT_INVALID",
  "REFERENCE_INVALID",
  "AMOUNT_INVALID",
  "LABEL_TOO_LONG",
  "MESSAGE_TOO_LONG",
  "MEMO_TOO_LONG",
] as const;
export type PaymentRequestFailure = (typeof PAYMENT_REQUEST_FAILURES)[number];

export type PaymentRequestInput = Readonly<{
  /** The wallet being paid. Never a token account. */
  recipient: string;
  /** Display-unit amount, exactly as a person typed it. Omitted for an open request. */
  amount?: string | null;
  /** Mint of the token being requested, or null for native SOL. */
  splToken?: string | null;
  /** Decimals of that token. Required whenever an amount is given. */
  decimals?: number | null;
  /** The read-only key that identifies this exact request on chain. */
  reference?: string | null;
  /** Who is asking. Shown by the paying wallet. */
  label?: string | null;
  /** What it is for. Shown by the paying wallet. */
  message?: string | null;
  /** Included in the transaction itself, unlike label and message. */
  memo?: string | null;
}>;

export type PaymentRequestResult =
  | Readonly<{ ok: true; url: string; amountRaw: string | null }>
  | Readonly<{ ok: false; code: PaymentRequestFailure; reason: string }>;

/* Wallets render these; long strings are truncated by some and dropped by
   others, and either way a paragraph in a QR code is a larger QR code. */
const LABEL_MAX = 64;
const MESSAGE_MAX = 128;
const MEMO_MAX = 128;

function fail(code: PaymentRequestFailure, reason: string): PaymentRequestResult {
  return { ok: false, code, reason };
}

/**
 * Trim a display amount to its shortest exact spelling.
 *
 * `1.50` and `1.5` are the same number, and a QR that encodes the first is
 * needlessly larger. Trailing zeros only — no rounding, ever.
 */
function tidyAmount(value: string): string {
  if (!value.includes(".")) return value;
  const trimmed = value.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" ? "0" : trimmed;
}

export function buildSolanaPayUrl(input: PaymentRequestInput): PaymentRequestResult {
  const recipient = input.recipient.trim();
  if (!BASE58.test(recipient)) {
    return fail("RECIPIENT_INVALID", "That is not a Solana address.");
  }

  const splToken = input.splToken?.trim() || null;
  if (splToken !== null && !BASE58.test(splToken)) {
    return fail("MINT_INVALID", "That is not a token address.");
  }

  const reference = input.reference?.trim() || null;
  if (reference !== null && !BASE58.test(reference)) {
    return fail("REFERENCE_INVALID", "The request identifier is not a Solana address.");
  }

  const params = new URLSearchParams();
  let amountRaw: string | null = null;

  const amount = input.amount?.trim() || null;
  if (amount !== null) {
    const decimals = input.decimals;
    if (typeof decimals !== "number" || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      return fail("AMOUNT_INVALID", "This token's decimals are unknown, so an amount cannot be requested for it.");
    }
    /* The same parser the Send and Bridge amount fields use, so "how much may
       I ask for" and "how much may I send" cannot disagree — including its
       refusal to round away precision the chain cannot represent. */
    const parsed = parseHumanAmount(amount, decimals);
    if (!parsed.ok) return fail("AMOUNT_INVALID", parsed.reason);
    amountRaw = parsed.raw;
    params.set("amount", tidyAmount(amount));
  }

  if (splToken !== null) params.set("spl-token", splToken);
  if (reference !== null) params.set("reference", reference);

  const label = input.label?.trim() || null;
  if (label !== null) {
    if (label.length > LABEL_MAX) return fail("LABEL_TOO_LONG", `Keep the name to ${LABEL_MAX} characters or fewer.`);
    params.set("label", label);
  }

  const message = input.message?.trim() || null;
  if (message !== null) {
    if (message.length > MESSAGE_MAX) return fail("MESSAGE_TOO_LONG", `Keep the note to ${MESSAGE_MAX} characters or fewer.`);
    params.set("message", message);
  }

  const memo = input.memo?.trim() || null;
  if (memo !== null) {
    if (memo.length > MEMO_MAX) return fail("MEMO_TOO_LONG", `Keep the memo to ${MEMO_MAX} characters or fewer.`);
    params.set("memo", memo);
  }

  const query = params.toString();
  /* `URLSearchParams` spells a space as `+`, which is correct for a form body
     and wrong for a URI query a wallet will percent-decode. Everything else it
     encodes is already right. */
  const encoded = query.replace(/\+/g, "%20");
  return { ok: true, url: `solana:${recipient}${encoded ? `?${encoded}` : ""}`, amountRaw };
}

/* ------------------------------------------------------------------ *
 * Matching a payment against the request
 * ------------------------------------------------------------------ */

export const PAYMENT_MATCH_STATES = [
  "AWAITING",
  "PAID",
  "UNDERPAID",
  "OVERPAID",
  "WRONG_TOKEN",
  "EXPIRED",
] as const;
export type PaymentMatchState = (typeof PAYMENT_MATCH_STATES)[number];

export type ObservedPayment = Readonly<{
  signature: string;
  /** Base units credited to the recipient by this transaction. */
  creditedRaw: string;
  /** The mint that moved, or null when native SOL did. */
  mint: string | null;
  /**
   * Base units of that mint the token's own transfer fee withheld in this
   * transaction (Token-2022 `TransferFeeConfig`): what the payer sent and the
   * recipient did not receive. Absent or "0" for a token without the fee.
   */
  feeWithheldRaw?: string;
  /** How many payments this entry stands for, when a long history folded several into one (summed). Absent: one. */
  count?: number;
}>;

export type PaymentMatch = Readonly<{
  state: PaymentMatchState;
  detail: string;
  /**
   * The payment this verdict is about, when one was seen: the one that brought
   * the requested mint's sum to the asked amount, or the latest one counted.
   */
  payment: ObservedPayment | null;
  /** Base units of the requested mint credited to the recipient across every counted payment. */
  receivedRaw: string;
  /** Of those payments, what the token's own transfer fee withheld on the way. */
  feeWithheldRaw: string;
  /** How many transactions credited the recipient in the requested mint. */
  payments: number;
}>;

/** A credit is a positive whole number of base units; anything else credited nobody. */
function positiveRaw(value: string | undefined): bigint {
  if (value === undefined || !/^[0-9]+$/.test(value)) return 0n;
  return BigInt(value);
}

/**
 * Did this exact request get paid, and paid correctly?
 *
 * Four ways to be wrong and one way to be right, and the wrong ones are
 * genuinely different to the person waiting: too little is an incomplete
 * payment, too much is somebody owed a refund, the wrong token is money that
 * arrived and cannot be counted, and an expired request is one nobody should
 * still be paying.
 *
 * **A payment is a credit.** The reference is public — anyone can put it in a
 * transaction that moves nothing — so carrying it proves nothing on its own
 * (SEC-1, FIX-PAY-1). Only base units that reached the recipient in the
 * requested mint count; a transaction that credited nothing is not a payment,
 * not an open request's payment and not a second payment.
 *
 * **The requested mint's credits add up.** No single transaction decides the
 * verdict: a payment short by a token's own transfer fee and the top-up after
 * it are one paid request, and another token arriving first does not stop the
 * requested one being counted after it. Money in another mint is said only
 * when nothing in the requested one arrived.
 *
 * **Duplicate protection is by signature.** Two transactions carrying the same
 * reference are two payments, and the second is not a confirmation of the
 * first: more than the request asked for is an overpayment, said with how many
 * times it was paid, never silently folded into "paid once".
 */
export function matchPayment(args: {
  /** Base units the request asked for, or null for an open request. */
  expectedRaw: string | null;
  /** The mint that was asked for, or null for native SOL. */
  expectedMint: string | null;
  /** Every transaction seen carrying this request's reference, oldest first. */
  observed: readonly ObservedPayment[];
  expired: boolean;
}): PaymentMatch {
  const credits = args.observed.filter((entry) => positiveRaw(entry.creditedRaw) > 0n);
  const counted = credits.filter((entry) => entry.mint === args.expectedMint);
  const foreign = credits.find((entry) => entry.mint !== args.expectedMint) ?? null;
  const none = { receivedRaw: "0", feeWithheldRaw: "0", payments: 0 } as const;

  if (counted.length === 0) {
    /* A payment that landed settles the request even if the clock has since
       run out; another token that landed is said even then. Expiry stops new
       payments being invited; it does not un-receive money that arrived. */
    if (foreign !== null) {
      return { state: "WRONG_TOKEN", detail: "A different token arrived than the one this request asked for.", payment: foreign, ...none };
    }
    return args.expired
      ? { state: "EXPIRED", detail: "This request expired before it was paid.", payment: null, ...none }
      : { state: "AWAITING", detail: "Waiting for the payment.", payment: null, ...none };
  }

  const expected = args.expectedRaw === null ? null : BigInt(args.expectedRaw);
  let received = 0n;
  let fee = 0n;
  let payments = 0;
  let settling: ObservedPayment | null = null;
  for (const entry of counted) {
    received += positiveRaw(entry.creditedRaw);
    fee += positiveRaw(entry.feeWithheldRaw);
    payments += entry.count !== undefined && Number.isSafeInteger(entry.count) && entry.count > 0 ? entry.count : 1;
    if (settling === null && (expected === null || received >= expected)) settling = entry;
  }
  const last = counted[counted.length - 1] ?? null;
  const sums = { receivedRaw: received.toString(), feeWithheldRaw: fee.toString(), payments };
  const times = payments > 1 ? ` This request was paid ${payments} times.` : "";

  if (expected === null) {
    /* An open request: any positive amount of its token pays it, once. */
    if (payments > 1) return { state: "OVERPAID", detail: `This request was paid ${payments} times.`, payment: settling, ...sums };
    return { state: "PAID", detail: "Paid.", payment: settling, ...sums };
  }
  if (received < expected) {
    const byFee = fee > 0n && received + fee >= expected;
    return {
      state: "UNDERPAID",
      detail: byFee
        ? "The full amount was sent, but the token's own transfer fee kept part of it, so less arrived than this request asked for."
        : "Less arrived than this request asked for.",
      payment: last,
      ...sums,
    };
  }
  if (received > expected) {
    return { state: "OVERPAID", detail: `More arrived than this request asked for.${times}`, payment: settling, ...sums };
  }
  return { state: "PAID", detail: "Paid.", payment: settling, ...sums };
}
