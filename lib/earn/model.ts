/**
 * Earn — what a person's own dollars do while they sit still.
 *
 * One asset is supplied to a lending market and a yield-bearing token comes back; the rate floats with the
 * market, and the way out depends on the liquidity standing in it at that moment. Ryntra is the interface and
 * the adapter: the money stays in the person's wallet until they sign, the protocol holds it afterwards, and
 * **Ryntra takes nothing from it** — neither provider offers an integrator fee, so there is no fee to take and
 * no fee is invented.
 *
 * This module is the shared half: the shapes a market, a position and a Review have, the arithmetic over
 * amounts, and the three judgements that keep a Review honest — whether the market can actually pay the
 * withdrawal, whether the rate still is what the person read, and what «available» means for a position. No
 * Node module and no provider call here, so the page imports it; the providers are `jupiter.ts` and
 * `kamino.ts`, the chain and the API are the `.server.ts` files beside them.
 *
 * ## Two words this file is careful with
 *
 * **Rate.** A supply rate is an annual per cent that moves every block. A Review therefore quotes it rather
 * than promising it, and the figure the person read is sealed with the Review so the submit lane can refuse
 * bytes whose rate has walked away from the one on screen ({@link rateDrift}).
 *
 * **Available.** Supplying is instant; the way back is not always. A lending market can be lent out to the
 * point where only part of a position can leave today, so a position carries what is in it *and* what the
 * market can pay out now, as two figures rather than one optimistic one ({@link withdrawPlan}).
 */

/** The providers this corner knows, Kamino second. */
export const EARN_PROVIDER_IDS = ["jupiter", "kamino"] as const;
export type EarnProviderId = (typeof EARN_PROVIDER_IDS)[number];

/** The provider's own name, as it writes it; never translated. */
export const EARN_PROVIDER_NAMES: Readonly<Record<EarnProviderId, string>> = {
  jupiter: "Jupiter Lend",
  kamino: "Kamino Lend",
};

export type EarnAction = "deposit" | "withdraw";

/**
 * Ryntra's cut of what a person earns here: nothing, and nothing is the honest figure rather than a kindness.
 *
 * Neither Jupiter Lend nor Kamino Lend pays an integrator a share of supply interest, so a fee would have to
 * be taken out of the person's own deposit or yield to exist at all. The Review says so in words, and this
 * constant is what the surfaces read, so «no fee» cannot drift into «a fee nobody mentioned» by an edit
 * somewhere else. Should a provider ever open a referrer share, the rate is the founder's to set — a decision,
 * not a default.
 */
export const EARN_FEE_BPS = 0;

/**
 * The amounts travel as base units in a string of digits: a `bigint` does not survive JSON, and a `number`
 * loses the tail of a six-decimal balance long before a wallet does.
 */
const DIGITS = /^\d{1,32}$/;
export const WALLET_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** What a market is, after a provider's answer has been read into the product's own words. */
export type EarnMarket = Readonly<{
  provider: EarnProviderId;
  /** The provider's own id for the market, whatever shape it has; carried so a later call names the same one. */
  id: string;
  /** The asset supplied — USDC, SOL — by mint and ticker. */
  asset: Readonly<{ mint: string; symbol: string; decimals: number }>;
  /** The yield-bearing token the deposit comes back as (a jlToken on Jupiter Lend). */
  share: Readonly<{ mint: string; symbol: string; decimals: number }>;
  /** The supply rate, per cent a year, as the provider states it now; null when it was not read. */
  rateAnnualPercent: number | null;
  /** Everything supplied to the market, base units of the asset; null when it was not read. */
  suppliedRaw: string | null;
  /** What the market can pay out right now, base units of the asset; null when it was not read. */
  liquidRaw: string | null;
  /** The least this product will supply here, base units; null when the asset's price was not read. */
  minimumRaw: string | null;
  /** The asset's price in dollars, as the provider stated it; null when it was not read. */
  priceUsd: number | null;
  /** When this was read, ISO. */
  readAt: string;
}>;

/** A person's position in one market — the chain's figures, not the interface's memory. */
export type EarnPosition = Readonly<{
  provider: EarnProviderId;
  marketId: string;
  asset: EarnMarket["asset"];
  /**
   * The yield-bearing tokens the wallet holds, base units of the share token; `null` when the chain could not
   * be read. Null rather than «0», because «we could not look» and «there is nothing there» are different
   * facts and only one of them should ever be drawn as an empty position.
   */
  sharesRaw: string | null;
  /** What those shares are worth in the asset now, base units; null when the exchange rate was not read. */
  underlyingRaw: string | null;
  /**
   * What was put in, net of what was taken out, base units; null when the provider did not say. Earned is
   * `underlying − deposited`, which is why a missing deposit figure leaves earned unknown rather than zero.
   */
  depositedRaw: string | null;
  /** What this position has earned so far, base units; null when either side of the subtraction is unknown. */
  earnedRaw: string | null;
  /** What can leave today — the position, or the market's liquidity if that is smaller. */
  availableRaw: string | null;
  /** When this was read, ISO, and from where — the chain's host or the provider's name. */
  readAt: string;
  readFrom: string;
}>;

/** Why a provider is not answering, in the four shapes a surface has to draw differently. */
export type EarnUnavailable =
  /** The key the provider's API needs is not configured here. The operator's to add; never a silent empty list. */
  | "NO_KEY"
  /** Configured and switched off on purpose — Kamino until that decision is made. */
  | "DISABLED"
  /** Asked and it refused or did not answer: a status, a timeout, an unreadable body. */
  | "PROVIDER_DOWN"
  /** Answered, and the answer did not carry the figures a market needs. */
  | "UNREADABLE";

export type EarnProviderState =
  | Readonly<{ provider: EarnProviderId; ok: true; markets: readonly EarnMarket[] }>
  | Readonly<{ provider: EarnProviderId; ok: false; code: EarnUnavailable; reason: string }>;

/* ------------------------------------------------------------------ amounts */

/** Base units from dollars-and-cents as a person types them («12.5», «12,50»); null for anything else. */
export function rawFromText(text: string, decimals: number): bigint | null {
  const clean = text.trim().replace(/\s/g, "").replace(",", ".");
  const match = new RegExp(`^(\\d{1,18})(?:\\.(\\d{0,${Math.max(decimals, 1)}}))?$`).exec(clean);
  if (!match) return null;
  const whole = BigInt(match[1]!) * 10n ** BigInt(decimals);
  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  return whole + (fraction.length > 0 ? BigInt(fraction) : 0n);
}

/** Base units as a plain decimal, trailing zeros dropped; `maxFraction` cuts the tail a field never shows. */
export function textFromRaw(raw: bigint | string, decimals: number, maxFraction = decimals): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const unit = 10n ** BigInt(decimals);
  const whole = value / unit;
  const rest = (value % unit).toString().padStart(decimals, "0").slice(0, Math.max(0, maxFraction)).replace(/0+$/, "");
  return rest.length > 0 ? `${whole}.${rest}` : whole.toString();
}

/** A string of digits as a `bigint`; null for anything that is not one, so a malformed field is never a 0. */
export function rawOf(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return DIGITS.test(clean) ? BigInt(clean) : null;
}

/** Base units in dollars, by the asset's own price; null when either figure is missing. */
export function usdOf(raw: bigint | string | null, decimals: number, priceUsd: number | null): number | null {
  if (raw === null || priceUsd === null || !Number.isFinite(priceUsd)) return null;
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  return (Number(value) / 10 ** decimals) * priceUsd;
}

/**
 * The least this product supplies to a market: the asset's amount worth {@link MIN_EARN_USD} by the price the
 * provider stated.
 *
 * A minimum in whole tokens cannot be one rule for USDC and for wrapped BTC, and a minimum of «whatever the
 * protocol takes» is dust a network fee eats. Without a price there is no honest figure, so the market
 * carries `null` and the form says the minimum was not read instead of inventing one.
 */
export const MIN_EARN_USD = 1;

export function minimumRawFor(decimals: number, priceUsd: number | null): bigint | null {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd <= 0) return null;
  const units = (MIN_EARN_USD / priceUsd) * 10 ** decimals;
  /* Rounded up: a minimum rounded down is a minimum the provider may refuse. */
  return BigInt(Math.max(1, Math.ceil(units)));
}

/* ------------------------------------------------------------------- the rate */

/**
 * How far a rate has moved since the Review was built, in basis points of annual per cent.
 *
 * Not a share of the old rate: 4 % → 2 % and 0.04 % → 0.02 % are both «half», and only one of them is worth
 * stopping a signature for. The difference in points is what a person would notice on the line they read.
 */
export function rateDrift(quotedPercent: number | null, freshPercent: number | null): number | null {
  if (quotedPercent === null || freshPercent === null) return null;
  if (!Number.isFinite(quotedPercent) || !Number.isFinite(freshPercent)) return null;
  return Math.round((freshPercent - quotedPercent) * 100);
}

/**
 * How far the rate may fall between the Review and the signature before the bytes are held back: half a
 * point of annual per cent.
 *
 * A rate that rose is not a reason to stop anybody — the person gets more than they read. A rate that fell is
 * the one the Review would have been wrong about, and 50 bp is the smallest move a person reading «4.12 %»
 * would call a different number.
 */
export const EARN_RATE_TOLERANCE_BPS = 50;

/** How long a Review may be read before its figures are stale. The bytes' own life is the blockhash's. */
export const EARN_REVIEW_WINDOW_MS = 45_000;

/* --------------------------------------------------------------- withdrawals */

export type WithdrawPlan = Readonly<{
  /** What will actually leave, base units. */
  amountRaw: bigint;
  /** What the person asked for, base units. */
  askedRaw: bigint;
  /** True when the market could not pay the whole ask today and the rest stays in the position. */
  partial: boolean;
  /** What stays in the position afterwards, base units; null when the position's worth was not read. */
  leftRaw: bigint | null;
}>;

export type WithdrawRefusal = Readonly<{ ok: false; code: "NOTHING_IN_POSITION" | "OVER_POSITION" | "NO_LIQUIDITY" | "NOT_READ"; reason: string }>;

/**
 * What a withdrawal of `askedRaw` would actually do.
 *
 * Three honest answers and one refusal, in this order: nothing to withdraw; more than the position holds; the
 * market has nothing to pay with today; otherwise the amount, cut to the market's liquidity when that is
 * smaller — which is a *partial* withdrawal stated as one, never a whole one that half-fails on chain.
 */
export function withdrawPlan(args: {
  askedRaw: bigint;
  positionRaw: bigint | null;
  liquidRaw: bigint | null;
}): Readonly<{ ok: true; plan: WithdrawPlan }> | WithdrawRefusal {
  const { askedRaw, positionRaw, liquidRaw } = args;
  if (positionRaw === null) return { ok: false, code: "NOT_READ", reason: "This position's worth was not read, so a withdrawal cannot be sized." };
  if (positionRaw <= 0n) return { ok: false, code: "NOTHING_IN_POSITION", reason: "There is nothing in this position to withdraw." };
  if (askedRaw <= 0n || askedRaw > positionRaw) return { ok: false, code: "OVER_POSITION", reason: "The amount is more than this position holds." };
  if (liquidRaw === null) return { ok: false, code: "NOT_READ", reason: "The market's liquidity was not read, so a withdrawal cannot be sized." };
  if (liquidRaw <= 0n) return { ok: false, code: "NO_LIQUIDITY", reason: "The market has no liquidity to pay a withdrawal right now." };
  const amountRaw = askedRaw <= liquidRaw ? askedRaw : liquidRaw;
  return { ok: true, plan: { amountRaw, askedRaw, partial: amountRaw < askedRaw, leftRaw: positionRaw - amountRaw } };
}

/** What a deposit of `askedRaw` is refused for, before a provider is asked to build anything. */
export type DepositRefusal = Readonly<{ ok: false; code: "BELOW_MINIMUM" | "OVER_WALLET" | "NOT_READ"; reason: string }>;

export function depositCheck(args: {
  askedRaw: bigint;
  minimumRaw: bigint | null;
  walletRaw: bigint | null;
}): Readonly<{ ok: true }> | DepositRefusal {
  const { askedRaw, minimumRaw, walletRaw } = args;
  if (askedRaw <= 0n) return { ok: false, code: "BELOW_MINIMUM", reason: "A deposit needs an amount." };
  if (minimumRaw !== null && askedRaw < minimumRaw) return { ok: false, code: "BELOW_MINIMUM", reason: "The amount is below this market's minimum." };
  if (walletRaw === null) return { ok: false, code: "NOT_READ", reason: "The wallet's balance was not read, so a deposit cannot be checked against it." };
  if (askedRaw > walletRaw) return { ok: false, code: "OVER_WALLET", reason: "The wallet holds less than this." };
  return { ok: true };
}

/* -------------------------------------------------------------- the position */

/**
 * The earned figure, and why it is a subtraction rather than a field.
 *
 * A yield-bearing token does not grow in count; its worth per token grows. So «earned» is what the shares are
 * worth now less what was put in, and both sides come from outside this product — the exchange rate from the
 * chain, the net deposit from the provider's own record of this wallet. Either one missing leaves the answer
 * `null`, which a surface draws as «not read». Zero would be a claim.
 */
export function earnedRawOf(underlyingRaw: bigint | null, depositedRaw: bigint | null): bigint | null {
  if (underlyingRaw === null || depositedRaw === null) return null;
  return underlyingRaw - depositedRaw;
}

/** What of a position can leave today: the position, or the market's liquidity when that is smaller. */
export function availableRawOf(underlyingRaw: bigint | null, liquidRaw: bigint | null): bigint | null {
  if (underlyingRaw === null) return null;
  if (liquidRaw === null) return null;
  return underlyingRaw <= liquidRaw ? underlyingRaw : liquidRaw;
}

/* ------------------------------------------------------------------- the risk */

/**
 * What is at stake here, as a band rather than a score.
 *
 * The honest risk of supplying to a lending market is three things: the protocol's own code, the rate moving,
 * and the queue at the door when everybody leaves at once. Only the last is measurable from a market's
 * figures, and it is the one that decides whether a person can get out today — so that is what the band
 * states, and the words beside it name the other two.
 */
export type EarnLiquidityBand = "full" | "partial" | "none" | "unknown";

export function liquidityBand(market: Pick<EarnMarket, "liquidRaw" | "suppliedRaw">): EarnLiquidityBand {
  const liquid = market.liquidRaw === null ? null : BigInt(market.liquidRaw);
  if (liquid === null) return "unknown";
  if (liquid <= 0n) return "none";
  const supplied = market.suppliedRaw === null ? null : BigInt(market.suppliedRaw);
  if (supplied === null || supplied <= 0n) return "unknown";
  /* A tenth of the market standing liquid is the line: above it an ordinary position leaves whole, below it
     a large one does not, and «partial» is the word that prepares a person for the plan they will be shown. */
  return liquid * 10n >= supplied ? "full" : "partial";
}
