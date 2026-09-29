import { z } from "zod";

import { POINTS_REASONS, type PointsReason } from "./policy.ts";

/**
 * What a points entry is: one row of a ledger that is only ever appended to.
 *
 * ## A ledger, never one mutable number
 *
 * The Owner's rule. A stored total is a second source of truth that drifts
 * silently from the first; a sum over append-only rows cannot. What a person
 * has is therefore always a function of what happened — and *why*, because
 * every row names its reason, the operation it came from, the policy version
 * that priced it and the moment it was written. That is what makes the ledger
 * auditable from the admin surface without a second bookkeeping.
 *
 * ## The key is the duplicate defence
 *
 * `wallet:day:reason:ref`, inserted with `insertIfAbsent`. The `ref` is the
 * operation's own id for a trade, the day for an active-day bonus and the
 * invited wallet for a referral bonus, so a status poll, a reload or a receipt
 * re-issue that reads the same settlement again writes the same key and
 * inserts nothing. The wallet leads so one person's rows can be scanned; the
 * day follows so one day's rows can be — which is what the diminishing
 * returns read.
 */

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RAW_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DECIMAL_TEXT = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/;

/** Which product surface the settled operation came from. */
export const POINTS_SURFACES = ["SWAP", "SPOT", "BRIDGE"] as const;
export type PointsSurface = (typeof POINTS_SURFACES)[number];

/**
 * How the eligible volume came to have a dollar figure.
 *
 * `STABLECOIN_PAR` — a stablecoin leg, exact. `PROVIDER_STATED_USD` — the
 * provider's own dollar figure for this exact operation (Jupiter's valuation
 * of the input it took; Relay's measurement of the fee it collected, which at
 * a fixed rate is a measurement of the input). `UNVALUED` — neither; the
 * trade is counted and earns no volume points, rather than being priced from
 * a guess.
 */
export const POINTS_VALUATION_BASES = ["STABLECOIN_PAR", "PROVIDER_STATED_USD", "UNVALUED"] as const;
export type PointsValuationBasis = (typeof POINTS_VALUATION_BASES)[number];

export const PointsValuationSchema = z
  .object({
    basis: z.enum(POINTS_VALUATION_BASES),
    /** Where the figure came from, so it can be traced rather than trusted. Null when unvalued. */
    sourceRef: z.string().min(1).max(200).nullable(),
  })
  .strict();

export type PointsValuation = z.output<typeof PointsValuationSchema>;

/** The settled operation a row was earned on. Public chain facts only. */
export const PointsSourceSchema = z
  .object({
    lane: z.enum(["SWAP", "CROSS_SWAP"]),
    surface: z.enum(POINTS_SURFACES),
    /** The action ledger's own id for the operation — a signature or an intent digest. */
    actionId: z.string().min(8).max(128),
    /** The on-chain reference where one exists: the Solana signature or the source transaction. */
    operationRef: z.string().min(3).max(128).nullable(),
    /** The wallet whose operation this was. Equal to the row's wallet except on a referral bonus. */
    trader: z.string().regex(BASE58_ADDRESS),
    /** Eligible volume in USD micro-units, or null when unvalued. */
    volumeUsdMicros: z.string().regex(RAW_INTEGER).nullable(),
    valuation: PointsValuationSchema,
    /** The wallet's eligible volume that day before this operation, as the tiers read it. */
    dayVolumeBeforeUsdMicros: z.string().regex(RAW_INTEGER).nullable(),
    settledAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type PointsSource = z.output<typeof PointsSourceSchema>;

export const PointsEntrySchema = z
  .object({
    schema: z.literal("ryntra.points.entry"),
    schemaVersion: z.literal("1.0.0"),
    /** Present on rows committed by the atomic multi-collection writer. */
    version: z.number().int().nonnegative().optional(),
    /** Later valuation of this wallet's earlier unvalued trade event. */
    valuationOf: z.string().min(3).max(200).optional(),
    /** The wallet the points belong to. The ledger's leading key. */
    wallet: z.string().regex(BASE58_ADDRESS),
    /** `reason:ref` — unique for one wallet, and the tail of the store key. */
    eventId: z.string().min(3).max(200),
    reason: z.enum(POINTS_REASONS),
    /** Whole points, never negative. A zero is a counted trade that earned no volume points. */
    points: z.string().regex(RAW_INTEGER),
    policyVersion: z.string().min(1).max(20),
    /** The UTC day the operation settled on. */
    day: z.string().regex(DAY),
    source: PointsSourceSchema.nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type PointsEntry = z.output<typeof PointsEntrySchema>;

/* --------------------------------------------------------------------- keys */

export function pointsEntryKey(args: Readonly<{ wallet: string; day: string; reason: PointsReason; ref: string }>): string {
  return `${args.wallet}:${args.day}:${args.reason}:${args.ref}`;
}

export function pointsEventId(reason: PointsReason, ref: string): string {
  return `${reason}:${ref}`;
}

/** Everything belonging to one wallet, for `valuesWithPrefix`. */
export function pointsWalletPrefix(wallet: string): string {
  return `${wallet}:`;
}

/** One wallet's rows for one UTC day — what the diminishing returns read. */
export function pointsDayPrefix(wallet: string, day: string): string {
  return `${wallet}:${day}:`;
}

/* ------------------------------------------------------------------ amounts */

/** The UTC calendar day of an instant, as the ledger keys it. */
export function utcDayOf(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw new Error("A points day needs a readable instant.");
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * A provider's decimal dollar figure as exact integer micro-dollars, floored.
 *
 * Text in, `bigint` out, and nothing in between is a `number`: the figure is
 * split at its decimal point and padded, which is exact for any decimal a
 * provider can state. Exponent notation and negatives are refused rather than
 * parsed.
 */
export function usdMicrosFromDecimalText(text: string | null | undefined): bigint | null {
  if (typeof text !== "string") return null;
  const match = DECIMAL_TEXT.exec(text.trim());
  if (!match) return null;
  const [whole, fraction = ""] = text.trim().split(".");
  const micros = (fraction + "000000").slice(0, 6);
  return BigInt(whole!) * 1_000_000n + BigInt(micros);
}

/** Whole points as the string a person reads, grouped by thousands with a thin space. */
export function formatPoints(points: bigint): string {
  const digits = points.toString();
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
