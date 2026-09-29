import { z } from "zod";

import type { ServiceFeeMechanism } from "../swap/service-fee.ts";

/**
 * What a reward is, in the only units that can be added up without lying.
 *
 * ## Why nothing here is a JavaScript number
 *
 * A reward is a liability. `0.1 + 0.2` is the reason this module carries no
 * floating point at all: every amount is either a raw base-unit integer of the
 * asset it is denominated in, or an integer count of USD micro-units — a
 * millionth of a dollar, which is also exactly one raw unit of USDC, the asset
 * a Claim is paid in. The two representations meet only through a price that
 * arrived as a decimal *string* and is turned into an exact rational, never
 * through `parseFloat`.
 *
 * The one number that arrives as a double is a provider's own dollar figure for
 * a fee it actually took, and `usdMicrosFromStated` converts it through text
 * rather than arithmetic. A **quoted** dollar figure is never used for
 * anything: it is a display estimate, and a display estimate is not a thing to
 * owe somebody money against.
 *
 * ## What is being divided
 *
 * The **gross** service fee — what the person actually paid — is the base for
 * all three shares. Not what reached Ryntra, and not the quote. The owner's own
 * worked example fixes this: on a $5.00 gross where Jupiter keeps $1.00, the
 * trader gets $2.50, L1 gets $0.50, L2 gets $0.25, and Ryntra keeps the $0.75
 * that is left of its own $4.00. Taking the shares off Ryntra's residual
 * instead would pay the trader $2.00 and quietly rename the programme.
 *
 * The provider's share is untouched by any of this. It left before Ryntra saw
 * it.
 */

/** Basis points of the gross service fee, by owner decision of 2026-09-10. */
export const REWARD_RATE_BPS = {
  CASHBACK: 5000,
  REFERRAL_L1: 1000,
  REFERRAL_L2: 500,
} as const;

/** The three that accrue against an operation. `CLAIM` and `ADJUSTMENT` do not. */
export const REWARD_ACCRUAL_TYPES = ["CASHBACK", "REFERRAL_L1", "REFERRAL_L2"] as const;

export const REWARD_TYPES = [...REWARD_ACCRUAL_TYPES, "CLAIM", "ADJUSTMENT"] as const;

export type RewardAccrualType = (typeof REWARD_ACCRUAL_TYPES)[number];
export type RewardType = (typeof REWARD_TYPES)[number];

/** One US dollar, in the integer unit everything here counts in. */
export const USD_MICROS_PER_USD = 1_000_000n;

/**
 * The Claim floor: **$1.00**, the owner's decision of 2026-09-10 taken against
 * $10 explicitly. Below it the control is disabled and says why; it is never
 * hidden, because a person who has earned $0.40 is owed the sentence that
 * explains what happens next.
 */
export const REWARD_MINIMUM_CLAIM_USD_MICROS = 1_000_000n;

/** Rewards are paid in USDC on Solana, whose raw unit is already a USD micro. */
export const REWARD_PAYOUT_DECIMALS = 6;

const RAW_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const DECIMAL_PRICE = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/;

/**
 * How a reward came to have a dollar figure at all.
 *
 * `STABLECOIN_PAR` — the fee was already denominated in a US dollar stablecoin
 * this product knows by mint, so the raw amount **is** the figure and no price
 * was consulted. Exact, and the only basis that cannot drift.
 *
 * `PRICED_AT_SETTLEMENT` — the fee was in some other asset and a price was read
 * from the same catalog the rest of the product prices with, close enough to
 * settlement to be about that moment.
 *
 * `PROVIDER_STATED_USD` — the provider stated a dollar figure for this exact
 * fee on this exact fill. Relay does, on `paidAppFees`. It is a measurement of
 * the thing itself at the moment it happened, which is strictly better than a
 * price looked up afterwards, and it is labelled separately so a reader can
 * see which of the two a figure came from.
 *
 * `UNVALUED` — no price this product trusts was available. The share of the fee
 * asset is still recorded exactly; the dollar figure is absent, and an absent
 * figure is `Pending` rather than a guess. This is the whole of the owner's
 * instruction that a reward without a reliable valuation stays Pending rather
 * than being invented.
 */
export const REWARD_VALUATION_BASES = ["STABLECOIN_PAR", "PROVIDER_STATED_USD", "PRICED_AT_SETTLEMENT", "UNVALUED"] as const;

export type RewardValuationBasis = (typeof REWARD_VALUATION_BASES)[number];

export const RewardValuationSchema = z
  .object({
    basis: z.enum(REWARD_VALUATION_BASES),
    /** The decimal price string exactly as the source stated it. Null at par. */
    price: z.string().regex(DECIMAL_PRICE).nullable(),
    /** Where the price came from, so a figure can be traced rather than trusted. */
    sourceRef: z.string().min(1).max(200).nullable(),
    observedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type RewardValuation = z.output<typeof RewardValuationSchema>;

/** The fee this reward is a share of, kept in the fee's own asset and units. */
export const RewardSourceSchema = z
  .object({
    /** Which provider's mechanism collected it. */
    mechanism: z.string().min(1).max(40),
    /**
     * The provider's own signature or request id.
     *
     * This is the whole of the duplicate defence. Reading a finished operation
     * again — a reload, a webhook retry, a status poll — produces the same
     * reference, so the second read writes the same key and inserts nothing.
     */
    operationRef: z.string().min(1).max(200),
    /** The wallet whose operation earned it. Equal to the recipient for cashback. */
    trader: z.string().min(32).max(64),
    /** Gross fee, raw base units of the fee asset. The base for every share. */
    grossRaw: z.string().regex(RAW_INTEGER),
    asset: z.string().min(1).max(80).nullable(),
    symbol: z.string().min(1).max(40).nullable(),
    decimals: z.number().int().min(0).max(24),
    settledAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type RewardSource = z.output<typeof RewardSourceSchema>;

export const RewardEntrySchema = z
  .object({
    version: z.number().int().nonnegative().optional(),
    /** An append-only valuation of an earlier unvalued accrual. */
    valuationOf: z.object({ key: z.string().min(1).max(400), type: z.enum(REWARD_ACCRUAL_TYPES) }).strict().optional(),
    type: z.enum(REWARD_TYPES),
    /** The Solana wallet this reward belongs to. The ledger's leading key. */
    recipient: z.string().min(32).max(64),
    /** Basis points of the gross applied. Zero for a claim. */
    rateBps: z.number().int().min(0).max(10_000),
    /** This reward's share of the fee asset, raw. Null for a claim. */
    shareRaw: z.string().regex(RAW_INTEGER).nullable(),
    /**
     * The signed figure that balances add up.
     *
     * Positive for an accrual, **negative** for a claim, and null when the fee
     * asset could not be valued. A null is not a zero: a zero would be a
     * measured nothing, and this is an unmeasured something.
     */
    usdMicros: z.string().regex(/^-?(?:0|[1-9][0-9]*)$/).nullable(),
    valuation: RewardValuationSchema,
    source: RewardSourceSchema.nullable(),
    createdAt: z.string().datetime({ offset: true }),
    /** Set on a claim entry: the claim it belongs to, and its payout signature. */
    claimId: z.string().min(1).max(80).nullable(),
    signature: z.string().min(1).max(120).nullable(),
  })
  .strict();

export type RewardEntry = z.output<typeof RewardEntrySchema>;

/* ------------------------------------------------------------------ amounts */

/** Parse a raw base-unit string, refusing anything that is not one. */
export function rawAmount(value: string, label: string): bigint {
  if (!RAW_INTEGER.test(value)) throw new Error(`${label} must be a canonical non-negative integer.`);
  return BigInt(value);
}

/**
 * A decimal price string as an exact rational.
 *
 * Copied in spirit from the Send canary's valuation, and for its reason: a
 * price that arrives as `"142.37"` is exact, and the only way to keep it exact
 * is to never let it become a `number`. Exponent notation is refused rather
 * than parsed, because a price nobody can read in the source is a price nobody
 * can check.
 */
export function priceRatio(value: string): Readonly<{ numerator: bigint; denominator: bigint }> {
  const match = DECIMAL_PRICE.exec(value);
  if (!match) throw new Error("A price must be a canonical decimal without exponent notation.");
  const fraction = match[1] ?? "";
  const numerator = BigInt(value.replace(".", ""));
  if (numerator <= 0n) throw new Error("A price must be greater than zero.");
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

/**
 * A share of the gross, floored.
 *
 * Floored rather than rounded because the remainder is Ryntra's, and a rounding
 * rule that can pay out more than was collected turns a 65% programme into a
 * 65.0001% one on small amounts. On the amounts this actually runs on the
 * difference is a single base unit; the direction of the difference is the
 * point.
 */
export function shareOfGross(grossRaw: bigint, rateBps: number): bigint {
  if (grossRaw < 0n) throw new Error("A gross fee cannot be negative.");
  if (!Number.isInteger(rateBps) || rateBps < 0 || rateBps > 10_000) {
    throw new Error("A reward rate must be whole basis points between 0 and 10000.");
  }
  return (grossRaw * BigInt(rateBps)) / 10_000n;
}

/**
 * Raw base units of an asset, in USD micro-units, at an exact decimal price.
 *
 * Floored, for the same reason `shareOfGross` is: this figure becomes a debt.
 */
export function usdMicrosOf(args: Readonly<{ raw: bigint; decimals: number; price: string }>): bigint {
  if (!Number.isInteger(args.decimals) || args.decimals < 0 || args.decimals > 24) {
    throw new Error("Asset decimals must be a whole number between 0 and 24.");
  }
  const { numerator, denominator } = priceRatio(args.price);
  return (args.raw * numerator * USD_MICROS_PER_USD) / (denominator * 10n ** BigInt(args.decimals));
}

/**
 * The US dollar stablecoins on Solana whose raw unit is a US dollar micro.
 *
 * Deliberately a short, explicit list of mints rather than a symbol match. A
 * token can call itself `USDC` — the cross-swap catalog work of 2026-09-09
 * found four impostors under that exact symbol on Solana alone — and valuing a
 * reward at par because a string matched is how a fake token becomes a real
 * payout.
 */
export const REWARD_PAR_MINTS: Readonly<Record<string, number>> = {
  /* USDC, Circle. */
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6,
  /* USDT, Tether. */
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6,
};

/** True when this exact mint is a dollar this product will count at par. */
export function isParMint(asset: string | null, decimals: number): boolean {
  if (!asset) return false;
  const known = REWARD_PAR_MINTS[asset];
  return known !== undefined && known === decimals;
}

/**
 * A provider's stated dollar figure, as exact integer micro-dollars.
 *
 * The figure arrives as a JavaScript number because that is how JSON carries
 * it, and this is the one place it is allowed to. Its decimal text is scaled
 * with integers and floored. Rounding to six decimal places would turn a
 * fraction of a micro-dollar into an extra unit of payout liability.
 *
 * Refuses anything that is not a finite, non-negative, representable amount,
 * because a reward valued from `NaN` would be a reward valued from nothing.
 */
export function usdMicrosFromStated(usd: number): bigint | null {
  if (!Number.isFinite(usd) || usd < 0 || usd >= 1e21) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(usd));
  if (!match) return null;
  const fraction = match[2] ?? "";
  const digits = BigInt(match[1] + fraction);
  const scale = 6 + Number(match[3] ?? 0) - fraction.length;
  return scale >= 0 ? digits * 10n ** BigInt(scale) : digits / 10n ** BigInt(-scale);
}

/* --------------------------------------------------------------- formatting */

/**
 * USD micro-units as the string a person reads.
 *
 * Two decimals, sign kept, and no locale rounding: `1234567n` is `"1.23"`, not
 * `"1.235"` and not `"1.24"`. The page adds the currency word; this returns a
 * number so a caller cannot accidentally print `$` twice.
 */
export function formatUsdMicros(micros: bigint): string {
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const whole = absolute / USD_MICROS_PER_USD;
  const cents = (absolute % USD_MICROS_PER_USD) / 10_000n;
  return `${negative ? "-" : ""}${whole}.${cents.toString().padStart(2, "0")}`;
}

/** The ledger key. Leads with the wallet so one person's rewards can be scanned. */
export function rewardEntryKey(
  args: Readonly<{ recipient: string; type: RewardType; ref: string }>,
): string {
  return `${args.recipient}:${args.type}:${args.ref}`;
}

/** Everything belonging to one wallet, for `valuesWithPrefix`. */
export function rewardEntryPrefix(recipient: string): string {
  return `${recipient}:`;
}

/** The reference half of an accrual key: which provider, which operation. */
export function accrualRef(mechanism: ServiceFeeMechanism, operationRef: string): string {
  return `${mechanism}:${operationRef}`;
}
