/**
 * Spot limits on Solana (B3, «Спот-ліміти 1.13») — the pure part.
 *
 * Two on-chain venues, both non-custodial: the person's tokens leave the
 * wallet into an account the venue's program holds for this order alone, and
 * only the person's signature takes them back.
 *
 * | Venue           | Program                         | Who fills                 | Ryntra fee                     |
 * |-----------------|---------------------------------|---------------------------|--------------------------------|
 * | Jupiter Trigger | `j1o2qRpj…` (limit_order_2)     | Jupiter's keeper, swapping | fee policy v2 by the pair, in the output token, on top of what the person gets |
 * | Meteora DLMM    | `LBUZKhRx…` (lb_clmm 0.12.0)    | the pool itself, when the price crosses the bin | none — the maker earns half of the bin's swap fees instead |
 *
 * ## Jupiter Trigger V1, as read off mainnet on 2026-10-15
 *
 * - The order keeps `fee_bps` and `fee_account`. With no fee account the program
 *   charges its own fee from the PDA `fee` (`27ZASRji…`): 10 bps, 3 on pairs
 *   it counts as stable, to Jupiter.
 * - A fee account must be a referral token account whose token authority is
 *   the referral project «Limit Order» `45ruCy…` — the program refuses an
 *   ordinary token account and the Ultra project's accounts alike
 *   (`ConstraintTokenOwner`, simulated). The project's `default_share_bps` is
 *   10 000: the referrer claims the whole fee.
 * - The referral token account is the PDA `["referral_ata", referral, mint]` of
 *   the referral program; derived and found on chain for live referrals.
 * - The fee is `fee_bps × takingAmount`, in the output token, **on top**: a
 *   filled order delivered exactly its `takingAmount` and the fee account got
 *   81 bps of it (a filled mainnet order: 6 518 397 450 000 → 52 799 019 345). So
 *   the keeper fills only when the market pays `takingAmount × (1 + fee)`; the
 *   fee raises the price at which the order fills, and the Review says so.
 * - The order's minimum is 5 USD of the input (Jupiter's 400 says so).
 *
 * ## Meteora DLMM limit orders
 *
 * `place_limit_order` deposits one side into chosen bins of a pool that allows
 * limit orders (`functionType` LimitOrder, or Undetermined without rewards);
 * when the price crosses a bin the deposit converts at that bin's price and
 * stays converted. Up to 50 bins; the order account is a fresh keypair that
 * signs once; `cancel_limit_order` returns what is left and what was swapped.
 *
 * Pure and client-safe: no network, no `process.env`, no clock.
 */

import { FEE_POLICY_V2, discountedFeeBps, type FeeFlow } from "../../core/fee-policy.ts";

export const TRIGGER_V1_BASE_URL = "https://api.jup.ag/trigger/v1";
export const TRIGGER_V1_PROGRAM = "j1o2qRpjcyUwEvwtcfhEQefh773ZgjxcVRry7LDqg5X";
/** The referral project «Limit Order»; its token accounts are the only fee accounts the program takes. */
export const TRIGGER_V1_REFERRAL_PROJECT = "45ruCyfdRkWpRNGEqWzjCiXRHkZs8WXCLQ67Pnpye7Hp";
export const JUPITER_REFERRAL_PROGRAM_ID = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";
/** The program's own fee when no referral is named, read from its `fee` PDA on 2026-10-15. */
export const TRIGGER_V1_JUPITER_FEE_BPS = Object.freeze({ normal: 10, stable: 3 });
/** A referral fee below the program's normal fee is refused on chain (`FeeBpsTooLow`). */
export const TRIGGER_V1_MIN_REFERRAL_FEE_BPS = 10;
export const TRIGGER_V1_MIN_ORDER_USD = 5;

export const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
/**
 * Lighthouse: the assertion program a wallet such as Phantom may append to what
 * it signs. Its instructions only check balances and fail the transaction if
 * they changed unexpectedly; they move nothing, so a wallet's addition of them
 * is not a reason to refuse the signed bytes.
 */
export const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
export const DLMM_LIMIT_MAX_BINS = 50;
/** The share of a filled bin's swap fee that goes to the limit order, per cent (`LIMIT_ORDER_FEE_SHARE` 5000). */
export const DLMM_LIMIT_MAKER_FEE_SHARE_PERCENT = 50;

export const LIMIT_SIDES = ["buy", "sell"] as const;
export type LimitSide = (typeof LIMIT_SIDES)[number];
export const LIMIT_VENUES = ["trigger", "dlmm"] as const;
export type LimitVenue = (typeof LIMIT_VENUES)[number];

export type LimitPair = Readonly<{
  /** What the person buys or sells. */
  baseMint: string;
  baseDecimals: number;
  /** What the price is counted in — USDC, SOL. */
  quoteMint: string;
  quoteDecimals: number;
}>;

/** A positive decimal written with digits and at most one dot. */
const DECIMAL = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

/** A decimal string as an integer scaled by 10^scale, rounded down; null when it is not a plain positive decimal. */
export function scaledDecimal(value: string, scale: number): bigint | null {
  const text = value.trim();
  if (!DECIMAL.test(text)) return null;
  const [whole = "", fraction = ""] = text.split(".");
  const digits = `${whole}${fraction.slice(0, scale).padEnd(scale, "0")}`.replace(/^0+(?=\d)/, "");
  return BigInt(digits === "" ? "0" : digits);
}

/** Six significant digits, the way a price is typed — never an exponent, never an integer's own zeros dropped. */
export function typedPrice(value: number): string {
  if (!(value > 0) || !Number.isFinite(value)) return "";
  const digits = Math.min(Math.max(0, 6 - Math.floor(Math.log10(value)) - 1), 18);
  const fixed = value.toFixed(digits);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  return trimmed === "0" ? "" : trimmed;
}

/** Raw units as a plain decimal string, trailing zeros trimmed. */
export function rawToDecimal(raw: bigint | string, decimals: number): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Price precision kept through the arithmetic: 18 places, more than any mint's decimals. */
const PRICE_SCALE = 18;

export type LimitAmounts = Readonly<{
  inputMint: string;
  outputMint: string;
  /** What leaves the wallet into the order, raw units of the input. */
  makingRaw: string;
  /** What the order must deliver, raw units of the output. */
  takingRaw: string;
}>;

/**
 * The two amounts of an order from the side, the amount the person typed and
 * the price in quote per base. A buy spends the quote and takes the base; a
 * sell gives the base and takes the quote. Rounding favours the person: what
 * the order asks for is rounded up, so it never fills a unit below the price
 * typed.
 */
export function limitAmounts(
  args: Readonly<{ pair: LimitPair; side: LimitSide; amount: string; price: string }>,
): LimitAmounts | null {
  const { pair, side } = args;
  const price = scaledDecimal(args.price, PRICE_SCALE);
  if (price === null || price <= 0n) return null;
  if (side === "buy") {
    const making = scaledDecimal(args.amount, pair.quoteDecimals);
    if (making === null || making <= 0n) return null;
    /* base = quote / price, in the base's raw units, rounded up. */
    const taking = ceilDiv(making * 10n ** BigInt(PRICE_SCALE) * 10n ** BigInt(pair.baseDecimals), price * 10n ** BigInt(pair.quoteDecimals));
    if (taking <= 0n) return null;
    return { inputMint: pair.quoteMint, outputMint: pair.baseMint, makingRaw: making.toString(), takingRaw: taking.toString() };
  }
  const making = scaledDecimal(args.amount, pair.baseDecimals);
  if (making === null || making <= 0n) return null;
  /* quote = base × price, in the quote's raw units, rounded up. */
  const taking = ceilDiv(making * price * 10n ** BigInt(pair.quoteDecimals), 10n ** BigInt(PRICE_SCALE) * 10n ** BigInt(pair.baseDecimals));
  if (taking <= 0n) return null;
  return { inputMint: pair.baseMint, outputMint: pair.quoteMint, makingRaw: making.toString(), takingRaw: taking.toString() };
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

/** Quote per base implied by an order's two raw amounts, as a number for display only. */
export function impliedPrice(pair: LimitPair, side: LimitSide, makingRaw: string, takingRaw: string): number {
  const making = Number(makingRaw);
  const taking = Number(takingRaw);
  if (!(making > 0) || !(taking > 0)) return Number.NaN;
  const base = side === "buy" ? taking / 10 ** pair.baseDecimals : making / 10 ** pair.baseDecimals;
  const quote = side === "buy" ? making / 10 ** pair.quoteDecimals : taking / 10 ** pair.quoteDecimals;
  return quote / base;
}

export type TriggerFeeReason =
  /** Ryntra's fee by the pair, to Ryntra's referral token account in the output token. */
  | "RYNTRA"
  /** The pair's flow pays no Ryntra fee (dollar to dollar). */
  | "FLOW_FREE"
  /** No verified referral token account for the output token: the order carries Jupiter's own fee only. */
  | "NO_FEE_ACCOUNT";

export type TriggerFeePlan = Readonly<{
  reason: TriggerFeeReason;
  /** Ryntra's share, basis points of `takingAmount`. */
  ryntraBps: number;
  /** Jupiter's share, basis points of `takingAmount`, expected; the simulation of the order confirms it. */
  jupiterBps: number;
  /** `params.feeBps` to send, or null to send none. */
  feeBpsParam: number | null;
  /** `feeAccount` to send, or null. */
  feeAccount: string | null;
}>;

/**
 * Which fee the order carries. Ryntra's rate is the fee policy's for the pair —
 * the same 10 / 50 / 100 bps a market trade of the pair pays — and it travels
 * only to a referral token account proved for the output mint. Anything else
 * leaves the order with Jupiter's own fee and no Ryntra fee: never a guessed
 * account a keeper could not pay into.
 *
 * A partner's friend pays the rate less their discount (`discountBps`, CITY-182),
 * never below the program's floor: a major coin's 10 bps less 10 % is under it,
 * so that order pays the full rate.
 */
export function triggerFeePlan(
  args: Readonly<{ flow: FeeFlow; stablePair: boolean; referralTokenAccount: string | null; discountBps?: number }>,
): TriggerFeePlan {
  const jupiterOwn = args.stablePair ? TRIGGER_V1_JUPITER_FEE_BPS.stable : TRIGGER_V1_JUPITER_FEE_BPS.normal;
  const bps = discountedFeeBps(FEE_POLICY_V2[args.flow].bps, args.discountBps ?? 0, TRIGGER_V1_MIN_REFERRAL_FEE_BPS);
  if (FEE_POLICY_V2[args.flow].bps === 0) return { reason: "FLOW_FREE", ryntraBps: 0, jupiterBps: jupiterOwn, feeBpsParam: null, feeAccount: null };
  if (!args.referralTokenAccount) {
    return { reason: "NO_FEE_ACCOUNT", ryntraBps: 0, jupiterBps: jupiterOwn, feeBpsParam: null, feeAccount: null };
  }
  const ryntraBps = Math.max(bps, TRIGGER_V1_MIN_REFERRAL_FEE_BPS);
  return { reason: "RYNTRA", ryntraBps, jupiterBps: 0, feeBpsParam: ryntraBps, feeAccount: args.referralTokenAccount };
}

/** The fee of a filled order, raw units of the output: `feeBps × takingAmount`, rounded down (as measured). */
export function triggerFeeRaw(takingRaw: string, feeBps: number): string {
  return ((BigInt(takingRaw) * BigInt(feeBps)) / 10_000n).toString();
}

/**
 * The price the market must reach for the order to fill, quote per base: the
 * keeper must deliver `takingAmount` and the fee on top. A buy fills lower than
 * typed, a sell higher.
 */
export function effectiveTriggerPrice(price: number, side: LimitSide, feeBps: number): number {
  const factor = 1 + feeBps / 10_000;
  return side === "buy" ? price / factor : price * factor;
}

/** Whether a limit price would fill at once against the current price — a market order in disguise. */
export function crossesMarket(side: LimitSide, price: number, marketPrice: number): boolean {
  if (!(price > 0) || !(marketPrice > 0)) return false;
  return side === "buy" ? price >= marketPrice : price <= marketPrice;
}

/** How far the limit sits from the market, per cent, signed: below the market negative. */
export function distanceFromMarketPercent(price: number, marketPrice: number): number {
  if (!(price > 0) || !(marketPrice > 0)) return Number.NaN;
  return ((price - marketPrice) / marketPrice) * 100;
}

/**
 * A DLMM pool orients its pair as X/Y. The person's base may be either side:
 * selling the base is the ask side when the base is X, the bid side when it is Y.
 */
export function dlmmIsAskSide(side: LimitSide, baseIsX: boolean): boolean {
  return side === "sell" ? baseIsX : !baseIsX;
}

/** Price of Y per X from the person's quote-per-base price. */
export function dlmmPoolPrice(price: number, baseIsX: boolean): number {
  return baseIsX ? price : 1 / price;
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 of raw bytes — a signature or a key; leading zero bytes become leading `1`s. */
export function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = BASE58_ALPHABET[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}
