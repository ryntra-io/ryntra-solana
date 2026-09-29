import type { SolanaWalletAction } from "../solana/action-ledger.ts";
import { isSpotOrigin } from "../solana/action-origin.ts";
import { movementUsdMicros } from "../solana/action-value.ts";
import {
  pointsEventId,
  usdMicrosFromDecimalText,
  utcDayOf,
  type PointsEntry,
  type PointsSurface,
  type PointsValuation,
} from "./model.ts";
import { levelFor, volumePoints, POINTS_POLICY_V1, type PointsPolicy } from "./policy.ts";

/**
 * One settled operation becomes up to three points rows, or nothing at all.
 *
 * This function decides *what is earned*. It writes nothing, reads no store
 * and takes no clock of its own, so the whole of the policy arithmetic can be
 * checked against worked examples rather than against a database. The caller
 * (`record.server.ts`) reads the world — the day's prior rows, the internal
 * wallet list, the inviter — and hands it in.
 *
 * ## The gates before a single point accrues
 *
 * 1. **The operation must be settled.** Only a `DONE` row. A quote, a Review,
 *    an in-flight or failed operation is not activity; it is an intention or
 *    an accident, and neither is genuine.
 * 2. **It must be a trade.** The `SWAP` lane (Swap or Spot) or the
 *    `CROSS_SWAP` lane (Bridge). Send, Receive and the CCTP transfer lane
 *    earn nothing; a self-transfer is a self-transfer whatever it is called.
 * 3. **It must change the asset.** A cross-chain move of the same asset —
 *    USDC on Base to USDC on Solana — is a transfer wearing a bridge's name,
 *    and the cheapest way to manufacture volume. It earns nothing.
 * 4. **The wallet must be external.** The owner's own test wallets earn
 *    nothing, checked here again after the caller already excluded them, so a
 *    future caller cannot route around it.
 *
 * ## What a missing dollar figure does
 *
 * The trade is still counted — a `TRADE_VOLUME` row with zero points and no
 * volume — because it happened, and completed trades and active days are
 * facts about a person's activity that do not depend on a price. What it does
 * not do is invent a figure. Unvalued is unvalued.
 */

export type PointsStatedUsd = Readonly<{
  /** The provider's own decimal dollar figure for the leg that left. Never a quote of a different amount. */
  value: string;
  sourceRef: string;
}>;

export type PointsAccrualInput = Readonly<{
  action: SolanaWalletAction;
  /** The provider's dollar figure for this exact operation, when it states one. */
  statedUsd: PointsStatedUsd | null;
  /** True when the trader is on the internal list. Refused here as well as by the caller. */
  internal: boolean;
  /** The trader's rows for the settlement day, before this operation. */
  dayEntries: readonly PointsEntry[];
  /** How many active-day rows the trader has ever earned, before this operation. */
  priorActiveDays: number;
  /** Who invited the trader, if anybody. Receives the qualified-referral bonus. */
  referrerL1: string | null;
  /** True when the inviter already earned the bonus for this trader. */
  referrerAlreadyQualified: boolean;
  settledAt: string;
  now: string;
  policy?: PointsPolicy;
}>;

export type PointsAccrualResult =
  | Readonly<{ ok: true; entries: readonly PointsEntry[]; day: string }>
  | Readonly<{ ok: false; reason: string }>;

/** Which surface a row belongs to, in the words the ledger uses. */
export function surfaceOf(action: SolanaWalletAction): PointsSurface | null {
  if (action.lane === "CROSS_SWAP") return "BRIDGE";
  if (action.lane === "SWAP") return isSpotOrigin(action.origin) ? "SPOT" : "SWAP";
  return null;
}

/** A cross-chain row whose two legs are the same asset moved somewhere else. */
export function isSameAssetMove(action: SolanaWalletAction): boolean {
  if (!action.out || !action.in) return false;
  if (action.out.mint !== null && action.in.mint !== null) return action.out.mint === action.in.mint;
  const left = action.out.symbol?.toUpperCase() ?? null;
  const arrived = action.in.symbol?.toUpperCase() ?? null;
  return left !== null && arrived !== null && left === arrived;
}

/**
 * The eligible volume of a settled trade and where its figure came from.
 *
 * Par first, because a stablecoin leg is exact; the provider's own dollar
 * figure second, because it measured this exact operation; and for a
 * cross-chain fill without either, the fee the provider reported collecting,
 * which at the lane's fixed rate is a measurement of the input. Anything past
 * that is unvalued rather than approximately valued.
 */
export function eligibleVolume(
  action: SolanaWalletAction,
  statedUsd: PointsStatedUsd | null,
): Readonly<{ usdMicros: bigint | null; valuation: PointsValuation }> {
  const par = movementUsdMicros(action.out) ?? movementUsdMicros(action.in);
  if (par !== null) {
    const leg = movementUsdMicros(action.out) !== null ? action.out : action.in;
    return { usdMicros: par, valuation: { basis: "STABLECOIN_PAR", sourceRef: leg?.mint ?? leg?.symbol ?? null } };
  }
  if (statedUsd) {
    const micros = usdMicrosFromDecimalText(statedUsd.value);
    if (micros !== null && micros > 0n) {
      return { usdMicros: micros, valuation: { basis: "PROVIDER_STATED_USD", sourceRef: statedUsd.sourceRef } };
    }
  }
  const fee = action.fee;
  if (fee && fee.collected && typeof fee.usd === "number" && fee.usd > 0 && fee.basisPoints !== null && fee.basisPoints > 0) {
    const feeMicros = usdMicrosFromDecimalText(fee.usd.toFixed(6));
    if (feeMicros !== null && feeMicros > 0n) {
      return {
        usdMicros: (feeMicros * 10_000n) / BigInt(fee.basisPoints),
        valuation: { basis: "PROVIDER_STATED_USD", sourceRef: `fee:${fee.basisPoints}bps` },
      };
    }
  }
  return { usdMicros: null, valuation: { basis: "UNVALUED", sourceRef: null } };
}

/** The day's figures before this operation, read off the rows the caller supplied. */
export function dayBefore(entries: readonly PointsEntry[]): Readonly<{ volumeUsdMicros: bigint; volumePoints: bigint; activeDay: boolean }> {
  let volume = 0n;
  let points = 0n;
  let activeDay = false;
  for (const entry of entries) {
    if (entry.reason === "TRADE_VOLUME" || entry.valuationOf) {
      points += BigInt(entry.points);
      if (entry.source?.volumeUsdMicros) volume += BigInt(entry.source.volumeUsdMicros);
    }
    if (entry.reason === "ACTIVE_DAY") activeDay = true;
  }
  return { volumeUsdMicros: volume, volumePoints: points, activeDay };
}

export function accruePoints(input: PointsAccrualInput): PointsAccrualResult {
  const policy = input.policy ?? POINTS_POLICY_V1;
  const { action } = input;
  if (action.outcome !== "DONE") {
    return { ok: false, reason: `A ${action.outcome} operation is not settled and earns nothing.` };
  }
  const surface = surfaceOf(action);
  if (!surface) return { ok: false, reason: `The ${action.lane} lane is not a trade and earns nothing.` };
  if (isSameAssetMove(action)) {
    return { ok: false, reason: "A move of the same asset is a transfer, not a trade, and earns nothing." };
  }
  if (input.internal) return { ok: false, reason: "An internal wallet earns nothing." };

  const day = utcDayOf(input.settledAt);
  const before = dayBefore(input.dayEntries);
  const volume = eligibleVolume(action, input.statedUsd);
  const earned =
    volume.usdMicros === null
      ? 0n
      : volumePoints(policy, {
          dayVolumeBeforeUsdMicros: before.volumeUsdMicros,
          volumeUsdMicros: volume.usdMicros,
          dayVolumePointsBefore: before.volumePoints,
        });

  const source = {
    lane: action.lane as "SWAP" | "CROSS_SWAP",
    surface,
    actionId: action.actionId,
    operationRef: action.signature ?? action.sourceTx ?? null,
    trader: action.wallet,
    volumeUsdMicros: volume.usdMicros === null ? null : volume.usdMicros.toString(),
    valuation: volume.valuation,
    dayVolumeBeforeUsdMicros: before.volumeUsdMicros.toString(),
    settledAt: input.settledAt,
  } as const;

  const entries: PointsEntry[] = [
    {
      schema: "ryntra.points.entry",
      schemaVersion: "1.0.0",
      wallet: action.wallet,
      eventId: pointsEventId("TRADE_VOLUME", action.actionId),
      reason: "TRADE_VOLUME",
      points: earned.toString(),
      policyVersion: policy.version,
      day,
      source,
      createdAt: input.now,
    },
  ];

  /* The day becomes active once it has reached the floor, counting this
     operation; awarded on the operation that crosses it, once, by key. */
  const dayVolumeAfter = before.volumeUsdMicros + (volume.usdMicros ?? 0n);
  const activeNow = !before.activeDay && dayVolumeAfter >= policy.activeDay.minimumDayVolumeUsdMicros;
  if (activeNow) {
    entries.push({
      schema: "ryntra.points.entry",
      schemaVersion: "1.0.0",
      wallet: action.wallet,
      eventId: pointsEventId("ACTIVE_DAY", day),
      reason: "ACTIVE_DAY",
      points: policy.activeDay.points.toString(),
      policyVersion: policy.version,
      day,
      source,
      createdAt: input.now,
    });
    /* The inviter is paid in points once, when the person they brought has a
       first active day — which is what "qualified" means. Self-referral is
       refused where a referrer is bound and refused again here. */
    if (
      input.priorActiveDays === 0 &&
      input.referrerL1 &&
      input.referrerL1 !== action.wallet &&
      !input.referrerAlreadyQualified
    ) {
      entries.push({
        schema: "ryntra.points.entry",
        schemaVersion: "1.0.0",
        wallet: input.referrerL1,
        eventId: pointsEventId("QUALIFIED_REFERRAL", action.wallet),
        reason: "QUALIFIED_REFERRAL",
        points: policy.qualifiedReferral.points.toString(),
        policyVersion: policy.version,
        day,
        source,
        createdAt: input.now,
      });
    }
  }

  return { ok: true, entries, day };
}

export { levelFor };
