/**
 * The Earn Review, and the second look that happens after the wallet has signed.
 *
 * A Review is the last screen before a signature, so everything a person could be surprised by afterwards
 * belongs on it: the amount that will actually move (which on a withdrawal is not always the amount asked
 * for), the rate at the moment of reading, what the market can pay out, the minimum, what stays behind, and
 * the one line that says Ryntra takes nothing. The surface draws it; this module decides what is on it.
 *
 * ## Why there is a check after the signature
 *
 * Between a Review being read and a wallet coming back, a supply rate moves and a market's liquidity can be
 * taken by somebody else. The bytes would still land — and the person would have signed for a figure that is
 * no longer true. So the submit lane asks the provider again and compares: a rate that fell further than
 * {@link EARN_RATE_TOLERANCE_BPS} or liquidity that can no longer pay the withdrawal holds the bytes back and
 * asks for a fresh Review ({@link checkFreshAtSigning}). A rate that *rose* passes — the person gets more
 * than they read, which is not a surprise anybody needs protecting from.
 *
 * Pure, and it takes its clock as an argument: every window in it is tested rather than waited for.
 */

import {
  depositCheck,
  EARN_FEE_BPS,
  EARN_RATE_TOLERANCE_BPS,
  EARN_REVIEW_WINDOW_MS,
  rateDrift,
  withdrawPlan,
  type EarnAction,
  type EarnMarket,
  type EarnProviderId,
} from "./model.ts";

/** One cost line of the Review. Ryntra's is always here and is always nothing. */
export type EarnCostLine = Readonly<{ id: "ryntra" | "provider" | "network"; bps: number | null; note: string }>;

export type EarnReview = Readonly<{
  provider: EarnProviderId;
  action: EarnAction;
  marketId: string;
  asset: EarnMarket["asset"];
  share: EarnMarket["share"];
  /** What will move, base units — on a partial withdrawal, less than `askedRaw`. */
  amountRaw: string;
  askedRaw: string;
  /** True when the market could pay only part of the withdrawal today. */
  partial: boolean;
  /** What the position holds now, base units; null when it was not read. */
  positionRaw: string | null;
  /** What stays in the position after a withdrawal, base units; null for a deposit or when not read. */
  leftRaw: string | null;
  /** The rate the person is reading, per cent a year; null when the provider did not state it. */
  rateAnnualPercent: number | null;
  /** What the market could pay out when the Review was built, base units. */
  liquidRaw: string | null;
  minimumRaw: string | null;
  priceUsd: number | null;
  costs: readonly EarnCostLine[];
  /** The bytes the wallet is asked to sign, and their seal. */
  transaction: Readonly<{ wireBase64: string; messageSha256: string }>;
  /** The sealed Review; the submit lane takes it and nothing else of this object on trust. */
  ticket: string;
  quotedAt: string;
  expiresAt: string;
  /** How long from arriving these figures may still be signed for, ms. */
  signableMs: number;
}>;

/**
 * The cost lines, every time the same three and one of them always zero.
 *
 * «No fee» is a line rather than an absence. A Review that simply omits Ryntra's cut leaves a person to
 * wonder; a line that says nothing is taken answers it, and the registry's condition for this row — Earn
 * without a Ryntra fee — is then visible on the screen where it matters rather than only in a document.
 */
export function earnCosts(provider: EarnProviderId): readonly EarnCostLine[] {
  return [
    { id: "ryntra", bps: EARN_FEE_BPS, note: "Ryntra takes nothing from this: no deposit fee, no share of what it earns." },
    {
      id: "provider",
      bps: null,
      note:
        provider === "jupiter"
          ? "Jupiter Lend charges no deposit or withdrawal fee; the rate is the market's own and moves with it."
          : "The provider's own terms apply to the deposit; Ryntra adds nothing of its own.",
    },
    { id: "network", bps: null, note: "Solana's own network fee, paid by the signing wallet." },
  ];
}

export type EarnReviewRefusal = Readonly<{ ok: false; code: string; reason: string }>;

/**
 * The Review for one action, or the refusal that stops it before a provider is asked for bytes.
 *
 * The order matters: a deposit is checked against the minimum and the wallet, a withdrawal against the
 * position and the market's liquidity, and only then is anything built. A refusal here costs nobody a
 * signature and names the figure that caused it.
 */
export function planEarnAction(args: {
  action: EarnAction;
  market: EarnMarket;
  askedRaw: bigint;
  /** The wallet's balance of the asset, base units; needed for a deposit. */
  walletRaw: bigint | null;
  /** What the position is worth, base units; needed for a withdrawal. */
  positionRaw: bigint | null;
}):
  | Readonly<{ ok: true; amountRaw: bigint; askedRaw: bigint; partial: boolean; leftRaw: bigint | null }>
  | EarnReviewRefusal {
  const { action, market, askedRaw, walletRaw, positionRaw } = args;
  if (action === "deposit") {
    const minimum = market.minimumRaw === null ? null : BigInt(market.minimumRaw);
    const checked = depositCheck({ askedRaw, minimumRaw: minimum, walletRaw });
    if (!checked.ok) return { ok: false, code: checked.code, reason: checked.reason };
    return { ok: true, amountRaw: askedRaw, askedRaw, partial: false, leftRaw: null };
  }
  const planned = withdrawPlan({ askedRaw, positionRaw, liquidRaw: market.liquidRaw === null ? null : BigInt(market.liquidRaw) });
  if (!planned.ok) return { ok: false, code: planned.code, reason: planned.reason };
  return { ok: true, ...planned.plan };
}

/** The Review itself, once the action is planned and the provider has handed over the bytes. */
export function buildEarnReview(args: {
  action: EarnAction;
  market: EarnMarket;
  planned: Readonly<{ amountRaw: bigint; askedRaw: bigint; partial: boolean; leftRaw: bigint | null }>;
  positionRaw: bigint | null;
  transaction: Readonly<{ wireBase64: string; messageSha256: string }>;
  ticket: string;
  now: number;
  /** How long the bytes themselves may still be signed for; the window is the smaller of the two. */
  signableMs: number;
}): EarnReview {
  const { action, market, planned, positionRaw, transaction, ticket, now, signableMs } = args;
  return {
    provider: market.provider,
    action,
    marketId: market.id,
    asset: market.asset,
    share: market.share,
    amountRaw: planned.amountRaw.toString(),
    askedRaw: planned.askedRaw.toString(),
    partial: planned.partial,
    positionRaw: positionRaw === null ? null : positionRaw.toString(),
    leftRaw: planned.leftRaw === null ? null : planned.leftRaw.toString(),
    rateAnnualPercent: market.rateAnnualPercent,
    liquidRaw: market.liquidRaw,
    minimumRaw: market.minimumRaw,
    priceUsd: market.priceUsd,
    costs: earnCosts(market.provider),
    transaction,
    ticket,
    quotedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + EARN_REVIEW_WINDOW_MS).toISOString(),
    signableMs: Math.max(0, Math.min(signableMs, EARN_REVIEW_WINDOW_MS)),
  };
}

export type FreshCheck =
  | Readonly<{ ok: true; driftBps: number | null }>
  | Readonly<{ ok: false; code: "RATE_MOVED" | "NO_LIQUIDITY" | "MARKET_GONE"; reason: string; driftBps: number | null }>;

/**
 * The provider asked again, after the signature and before the bytes go anywhere.
 *
 * Three ways this says no. The market is not in the fresh answer at all — the provider no longer lists it, so
 * nothing about the Review can be confirmed. The rate has fallen further than the tolerance — the person
 * signed for a figure that is gone. The market can no longer pay what the Review promised to pay out — a
 * withdrawal would land for less than the screen said, which is the one outcome a partial withdrawal exists
 * to make visible in advance rather than afterwards.
 */
export function checkFreshAtSigning(args: {
  action: EarnAction;
  quotedRatePercent: number | null;
  amountRaw: bigint;
  fresh: EarnMarket | null;
}): FreshCheck {
  const { action, quotedRatePercent, amountRaw, fresh } = args;
  if (fresh === null) {
    return { ok: false, code: "MARKET_GONE", reason: "The provider no longer lists this market. Nothing was sent.", driftBps: null };
  }
  const driftBps = rateDrift(quotedRatePercent, fresh.rateAnnualPercent);
  if (driftBps !== null && driftBps < -EARN_RATE_TOLERANCE_BPS) {
    return { ok: false, code: "RATE_MOVED", reason: "The rate fell while the wallet was open. Nothing was sent; review again.", driftBps };
  }
  if (action === "withdraw") {
    const liquid = fresh.liquidRaw === null ? null : BigInt(fresh.liquidRaw);
    if (liquid === null || liquid < amountRaw) {
      return {
        ok: false,
        code: "NO_LIQUIDITY",
        reason: "The market can no longer pay this withdrawal in full. Nothing was sent; review again.",
        driftBps,
      };
    }
  }
  return { ok: true, driftBps };
}
