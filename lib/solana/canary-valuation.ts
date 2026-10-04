import {
  SOLANA_MAINNET_USDC_MINT,
  type SolanaCanaryIntent,
} from "./canary-policy.ts";
import { TOKEN_2022_PROGRAM_ID } from "./send-kinds.ts";
import type { TransferPlan } from "./transaction.ts";

const DECIMAL_PRICE = /^(?:0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/;
const RAW_INTEGER = /^(?:0|[1-9][0-9]*)$/;
const LAMPORTS_PER_SOL = 1_000_000_000n;
const USD_MICROS_PER_USD = 1_000_000n;
const VALUATION_LIFETIME_MS = 60_000;

export type SendCanaryValuation = Readonly<
  Pick<
    SolanaCanaryIntent,
    "principalUsdMicros" | "feeReserveUsdMicros" | "usdMicros" | "valuation"
  >
>;

function rawInteger(value: string | null, label: string): bigint {
  if (value === null || !RAW_INTEGER.test(value)) {
    throw new Error(`${label} must be a canonical non-negative integer.`);
  }
  return BigInt(value);
}

function decimalRatio(value: string): Readonly<{ numerator: bigint; denominator: bigint }> {
  const match = DECIMAL_PRICE.exec(value);
  if (!match) throw new Error("The SOL USD price must be a canonical decimal without exponent notation.");
  const fraction = match[1] ?? "";
  const numerator = BigInt(value.replace(".", ""));
  if (numerator <= 0n) throw new Error("The SOL USD price must be greater than zero.");
  return { numerator, denominator: 10n ** BigInt(fraction.length) };
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function exactInstant(value: string): number {
  if (!/T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(value)) {
    throw new Error("The valuation time must include a timezone-qualified instant.");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("The valuation time is invalid.");
  return parsed;
}

/**
 * Value a nominal classic-USDC Send plan without floating-point arithmetic.
 *
 * The principal is already denominated in USD micros because classic mainnet
 * USDC has six decimals. Every SOL-denominated cost is converted from lamports
 * with the provider's decimal quote and rounded upward, so the canary never
 * understates the amount it reserves.
 */
export function buildSendCanaryValuation(args: {
  plan: TransferPlan;
  solUsdPrice: string;
  sourceRef: string;
  observedAt: string;
}): SendCanaryValuation {
  const { plan } = args;
  if (
    plan.network !== "mainnet" ||
    plan.mint !== SOLANA_MAINNET_USDC_MINT ||
    plan.decimals !== 6 ||
    plan.actionKind === "NATIVE_SOL"
  ) {
    throw new Error("Exact Send canary valuation is available only for classic mainnet USDC.");
  }
  if (plan.actionKind === "TOKEN_ATA_CREATE" && plan.ataRentLamports === null) {
    throw new Error("An ATA-creation valuation requires the exact rent lamports from the built plan.");
  }

  const principal = rawInteger(plan.amountRaw, "USDC amount");
  const baseFee = rawInteger(plan.baseFeeLamports, "Base fee");
  const priorityFee = rawInteger(plan.priorityFeeLamports, "Priority fee");
  const ataRent = plan.ataRentLamports === null ? 0n : rawInteger(plan.ataRentLamports, "ATA rent");
  const price = decimalRatio(args.solUsdPrice);
  const sourceRef = args.sourceRef.trim();
  if (sourceRef.length === 0 || sourceRef.length > 256) {
    throw new Error("The SOL USD price source reference is missing or too long.");
  }
  const observedAtMs = exactInstant(args.observedAt);

  const feeLamports = baseFee + priorityFee + ataRent;
  const feeReserve = ceilDivide(
    feeLamports * price.numerator * USD_MICROS_PER_USD,
    LAMPORTS_PER_SOL * price.denominator,
  );

  return {
    principalUsdMicros: principal.toString(),
    feeReserveUsdMicros: feeReserve.toString(),
    usdMicros: (principal + feeReserve).toString(),
    valuation: {
      method: "PROVIDER_QUOTE",
      sourceRef,
      observedAt: args.observedAt,
      validUntil: new Date(observedAtMs + VALUATION_LIFETIME_MS).toISOString(),
    },
  };
}

/* ------------------------------------------------------------------------- *
 * Token-2022 canary valuation
 * ------------------------------------------------------------------------- */

/**
 * One price, and where it came from.
 *
 * There is no `price: number` anywhere below, on purpose. A binary double
 * cannot hold `2.7166520970575237e-8` and `0.999928429652753` and give the same
 * answer twice, and an owner-canary exposure that is not reproducible is not
 * evidence. Prices arrive as canonical decimal strings and become exact
 * rationals, the same way every other amount in this module does.
 */
export type CanaryPriceQuote = Readonly<{
  /** USD for one whole token, canonical decimal, no exponent notation. */
  usdPrice: string;
  /** Provider and endpoint, exactly as the reader will see it. */
  sourceRef: string;
  /** Timezone-qualified instant this price was read. */
  observedAt: string;
}>;

export const TOKEN_CANARY_VALUATION_FAILURES = [
  "PRICE_ABSENT",
  "PRICE_INVALID",
  "PRICE_STALE",
  "PRICE_FROM_FUTURE",
  "PRICE_CONFLICTING",
  "PLAN_NOT_TOKEN_2022",
  "PLAN_MISMATCH",
  "RENT_UNREADABLE",
  "PRINCIPAL_ABOVE_CAP",
] as const;
export type TokenCanaryValuationFailureCode = (typeof TOKEN_CANARY_VALUATION_FAILURES)[number];

export type TokenCanaryValuationResult =
  | Readonly<{ ok: true; valuation: SendCanaryValuation }>
  | Readonly<{ ok: false; code: TokenCanaryValuationFailureCode; reason: string }>;

/**
 * A refusal here is returned, not thrown, unlike its classic-USDC sibling.
 *
 * The difference is not stylistic. `buildSendCanaryValuation` throws because
 * each of its refusals is a programming error: it was handed a plan it was
 * never meant to value. Every refusal below except the plan checks is a runtime
 * fact about the world — the feed was down, the quote was a minute old, two
 * readers disagreed — and each has to reach a person as a sentence on the
 * Review. An exception is a poor carrier for a sentence somebody must read.
 */
function tokenValuationFailure(
  code: TokenCanaryValuationFailureCode,
  reason: string,
): TokenCanaryValuationResult {
  return { ok: false, code, reason };
}

/** USD micros for `amountRaw` base units of a `decimals`-place token, rounded up. */
function principalUsdMicrosOf(amountRaw: bigint, decimals: number, price: string): bigint {
  const ratio = decimalRatio(price);
  return ceilDivide(
    amountRaw * ratio.numerator * USD_MICROS_PER_USD,
    10n ** BigInt(decimals) * ratio.denominator,
  );
}

/**
 * The USD figure a person actually reads, in whole cents.
 *
 * Two prices agree, and a reviewed price has not drifted, exactly when the
 * number printed on the Review is the same number. That is the one threshold
 * here which is not arbitrary: a basis-point tolerance would be a figure
 * somebody picked, while this one is defined by what the human was shown and
 * therefore by what they authorized.
 */
function displayCents(usdMicros: bigint): bigint {
  /* Rounded, not truncated. Truncation puts the seam in the wrong place: a
     move from $1.8999 to $1.8904 is very nearly a whole cent and both floor to
     189, so a drift a person would notice on screen would have passed as no
     drift at all. Rounding puts the comparison where the eye is. */
  return (usdMicros + 5_000n) / 10_000n;
}

function priceInstant(quote: CanaryPriceQuote): number | null {
  if (!/T.*(?:Z|[+-][0-9]{2}:[0-9]{2})$/.test(quote.observedAt)) return null;
  const parsed = Date.parse(quote.observedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Value one exact Token-2022 canary transfer.
 *
 * Nothing is assumed about the asset. A stablecoin is not taken to be worth a
 * dollar: PYUSD reads `0.999928429652753` and that is the number used, because
 * "it is a stablecoin" describes an intention and this canary is meant to
 * measure the world. The 2 USD ceiling is passed in rather than written here,
 * so the owner policy stays the single place that limit lives.
 *
 * Both prices are required. The principal needs the token price and the fee
 * reserve needs SOL, and there is no lawful way to publish a total that
 * silently omits one — a USD value is never invented for a network fee or for
 * rent, so when SOL cannot be priced this refuses rather than returning a
 * principal that reads like a complete exposure.
 */
export function buildTokenCanaryValuation(args: {
  plan: TransferPlan;
  tokenPrice: CanaryPriceQuote | null;
  solPrice: CanaryPriceQuote | null;
  /**
   * An independent second read of the token price, when the caller has one.
   * A provider answer is not proof on its own, and two readers that disagree
   * produce `UNKNOWN`, never a number picked from one of them.
   */
  corroboratingTokenPrice?: CanaryPriceQuote | null;
  /** The owner policy ceiling for this family, in USD micros. */
  maximumPrincipalUsdMicros: string;
  now: Date;
}): TokenCanaryValuationResult {
  const { plan } = args;

  if (plan.network !== "mainnet" || plan.tokenProgram !== TOKEN_2022_PROGRAM_ID) {
    return tokenValuationFailure(
      "PLAN_NOT_TOKEN_2022",
      "A Token-2022 canary valuation values only a mainnet plan on the Token-2022 program.",
    );
  }
  if (plan.actionKind !== "TOKEN_2022") {
    return tokenValuationFailure(
      "PLAN_NOT_TOKEN_2022",
      `This plan is classified ${plan.actionKind}, and a Token-2022 canary valuation values only the TOKEN_2022 action family.`,
    );
  }
  if (!RAW_INTEGER.test(plan.amountRaw) || BigInt(plan.amountRaw) === 0n) {
    return tokenValuationFailure(
      "PLAN_MISMATCH",
      "The transfer amount must be a canonical non-zero base-unit integer.",
    );
  }
  if (!Number.isInteger(plan.decimals) || plan.decimals < 0 || plan.decimals > 255) {
    return tokenValuationFailure(
      "PLAN_MISMATCH",
      "The decimals of this mint must be an integer the token program can hold.",
    );
  }
  /* Rent is part of the exposure, so an unread rent is an unknown exposure and
     not a zero one. M1B paid this rent for real; guessing it here would place a
     fabricated number inside the figure an owner signs against. */
  if (plan.createsRecipientAccount && plan.ataRentLamports === null) {
    return tokenValuationFailure(
      "RENT_UNREADABLE",
      "This transfer creates the recipient token account and the exact rent did not read, so its cost is unknown rather than zero.",
    );
  }

  if (args.tokenPrice === null) {
    return tokenValuationFailure("PRICE_ABSENT", "No USD price for this mint was read, and none is assumed.");
  }
  if (args.solPrice === null) {
    return tokenValuationFailure(
      "PRICE_ABSENT",
      "No USD price for SOL was read, so the network fee and any rent cannot be valued and no total is published.",
    );
  }

  const quotes: readonly (readonly [CanaryPriceQuote, string])[] = [
    [args.tokenPrice, "token"],
    [args.solPrice, "SOL"],
    ...(args.corroboratingTokenPrice
      ? ([[args.corroboratingTokenPrice, "corroborating token"]] as const)
      : []),
  ];

  const nowMs = args.now.getTime();
  if (!Number.isFinite(nowMs)) {
    return tokenValuationFailure("PRICE_INVALID", "The evaluation instant is not a valid time.");
  }

  let oldestObservedAt = Number.POSITIVE_INFINITY;
  for (const [quote, label] of quotes) {
    if (!DECIMAL_PRICE.test(quote.usdPrice) || BigInt(quote.usdPrice.replace(".", "")) <= 0n) {
      return tokenValuationFailure(
        "PRICE_INVALID",
        `The ${label} USD price must be a canonical positive decimal without exponent notation.`,
      );
    }
    const sourceRef = quote.sourceRef.trim();
    if (sourceRef.length === 0 || sourceRef.length > 96) {
      return tokenValuationFailure(
        "PRICE_INVALID",
        `The ${label} price source reference is missing or too long.`,
      );
    }
    const observedAtMs = priceInstant(quote);
    if (observedAtMs === null) {
      return tokenValuationFailure(
        "PRICE_INVALID",
        `The ${label} price needs a timezone-qualified observation instant.`,
      );
    }
    if (observedAtMs > nowMs) {
      return tokenValuationFailure(
        "PRICE_FROM_FUTURE",
        `The ${label} price is dated after the moment it is being used.`,
      );
    }
    if (nowMs - observedAtMs > VALUATION_LIFETIME_MS) {
      return tokenValuationFailure(
        "PRICE_STALE",
        `The ${label} price was read ${Math.round((nowMs - observedAtMs) / 1_000)} seconds ago and this canary accepts at most ${VALUATION_LIFETIME_MS / 1_000}.`,
      );
    }
    oldestObservedAt = Math.min(oldestObservedAt, observedAtMs);
  }

  const amountRaw = BigInt(plan.amountRaw);
  const principal = principalUsdMicrosOf(amountRaw, plan.decimals, args.tokenPrice.usdPrice);

  if (args.corroboratingTokenPrice) {
    const second = principalUsdMicrosOf(
      amountRaw,
      plan.decimals,
      args.corroboratingTokenPrice.usdPrice,
    );
    if (displayCents(second) !== displayCents(principal)) {
      return tokenValuationFailure(
        "PRICE_CONFLICTING",
        `Two independent reads value this amount differently: ${args.tokenPrice.sourceRef} gives ${displayCents(principal)} US cents and ${args.corroboratingTokenPrice.sourceRef} gives ${displayCents(second)}. A disagreement is not resolved by choosing one of them.`,
      );
    }
  }

  if (!RAW_INTEGER.test(args.maximumPrincipalUsdMicros)) {
    return tokenValuationFailure("PLAN_MISMATCH", "The family ceiling must be a canonical USD-micro integer.");
  }
  const maximum = BigInt(args.maximumPrincipalUsdMicros);
  if (principal > maximum) {
    return tokenValuationFailure(
      "PRINCIPAL_ABOVE_CAP",
      `This transfer values at ${principal} USD micros and this canary family allows at most ${maximum}.`,
    );
  }

  const feeLamports =
    rawInteger(plan.baseFeeLamports, "Base fee") +
    rawInteger(plan.priorityFeeLamports, "Priority fee") +
    (plan.ataRentLamports === null ? 0n : rawInteger(plan.ataRentLamports, "Recipient account rent"));
  const solRatio = decimalRatio(args.solPrice.usdPrice);
  const feeReserve = ceilDivide(
    feeLamports * solRatio.numerator * USD_MICROS_PER_USD,
    LAMPORTS_PER_SOL * solRatio.denominator,
  );

  return {
    ok: true,
    valuation: {
      principalUsdMicros: principal.toString(),
      feeReserveUsdMicros: feeReserve.toString(),
      usdMicros: (principal + feeReserve).toString(),
      valuation: {
        method: "PROVIDER_QUOTE",
        sourceRef: `${args.tokenPrice.sourceRef.trim()} + ${args.solPrice.sourceRef.trim()}`,
        /* The older of the reads, and the earlier of the expiries. A total is
           exactly as fresh as its stalest input. */
        observedAt: new Date(oldestObservedAt).toISOString(),
        validUntil: new Date(oldestObservedAt + VALUATION_LIFETIME_MS).toISOString(),
      },
    },
  };
}

export const CANARY_VALUATION_DRIFT_STATES = [
  "CURRENT",
  "EXPIRED",
  "MATERIAL_DRIFT",
  "REPRICE_UNAVAILABLE",
] as const;
export type CanaryValuationDriftState = (typeof CANARY_VALUATION_DRIFT_STATES)[number];

export type CanaryValuationDrift = Readonly<{
  state: CanaryValuationDriftState;
  detail: string;
  /** The freshly computed valuation, when one could be computed at all. */
  rebuilt: SendCanaryValuation | null;
}>;

/**
 * Does the Review a person is looking at still describe what they would sign?
 *
 * Time was already handled: the policy refuses a valuation past its
 * `validUntil`. Price was not. A quote can be four seconds old and still value
 * the same transfer at a different number than the one on screen, and the
 * signature would then authorize a figure nobody was shown. So the reviewed
 * valuation is rebuilt from fresh prices and compared on the figure the person
 * actually read.
 *
 * `MATERIAL_DRIFT` and `REPRICE_UNAVAILABLE` mean the same thing to the caller
 * — this Review is spent, build another — and are separate states because a
 * person deserves to know whether the price moved or the feed went quiet.
 */
export function assessTokenCanaryValuationDrift(args: {
  reviewed: SendCanaryValuation;
  plan: TransferPlan;
  tokenPrice: CanaryPriceQuote | null;
  solPrice: CanaryPriceQuote | null;
  corroboratingTokenPrice?: CanaryPriceQuote | null;
  maximumPrincipalUsdMicros: string;
  now: Date;
}): CanaryValuationDrift {
  const reviewedPrincipal = args.reviewed.principalUsdMicros;
  const reviewedValuation = args.reviewed.valuation;
  if (reviewedPrincipal === null || reviewedValuation === null) {
    return {
      state: "REPRICE_UNAVAILABLE",
      detail: "The reviewed action carries no valuation, so there is nothing to re-check it against.",
      rebuilt: null,
    };
  }

  const validUntil = Date.parse(reviewedValuation.validUntil);
  if (!Number.isFinite(validUntil) || args.now.getTime() >= validUntil) {
    return {
      state: "EXPIRED",
      detail: "The reviewed valuation has passed its own expiry and cannot carry a signature.",
      rebuilt: null,
    };
  }

  const rebuilt = buildTokenCanaryValuation({
    plan: args.plan,
    tokenPrice: args.tokenPrice,
    solPrice: args.solPrice,
    corroboratingTokenPrice: args.corroboratingTokenPrice ?? null,
    maximumPrincipalUsdMicros: args.maximumPrincipalUsdMicros,
    now: args.now,
  });
  if (!rebuilt.ok) {
    return {
      state: "REPRICE_UNAVAILABLE",
      detail: `The reviewed valuation could not be re-checked: ${rebuilt.reason}`,
      rebuilt: null,
    };
  }

  const before = displayCents(BigInt(reviewedPrincipal));
  const after = displayCents(BigInt(rebuilt.valuation.principalUsdMicros ?? "0"));
  if (before !== after) {
    return {
      state: "MATERIAL_DRIFT",
      detail: `This transfer was reviewed at ${before} US cents and now values at ${after}. The figure the Review states is no longer the figure a signature would authorize.`,
      rebuilt: rebuilt.valuation,
    };
  }

  return {
    state: "CURRENT",
    detail: "The reviewed valuation still states what this transfer is worth.",
    rebuilt: rebuilt.valuation,
  };
}
