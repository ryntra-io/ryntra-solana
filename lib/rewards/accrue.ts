import {
  accrualRef,
  isParMint,
  REWARD_RATE_BPS,
  rawAmount,
  priceRatio,
  RewardValuationSchema,
  shareOfGross,
  usdMicrosFromStated,
  usdMicrosOf,
  type RewardEntry,
  type RewardValuation,
} from "./model.ts";
import { isServiceFeeIncome, type RyntraServiceFee } from "../swap/service-fee.ts";

/**
 * One collected service fee becomes up to three rewards, or nothing at all.
 *
 * This function decides *what is owed*. It writes nothing, reads no store and
 * takes no clock of its own, so the whole of the reward arithmetic can be
 * tested against worked examples rather than against a database.
 *
 * ## The four gates before a single unit accrues
 *
 * 1. **The fee must be income.** `isServiceFeeIncome` is the only predicate in
 *    this codebase allowed to call anything revenue, and it answers true only
 *    for `COLLECTED`. A quoted fee is an intention; paying cashback on an
 *    intention is paying out of Ryntra's pocket for money it never received.
 * 2. **There must be a settlement with a gross figure.** `userPaidRaw` is what
 *    the person actually paid, read back off the chain or off the provider's
 *    own record of the fill. It is the base for all three shares.
 * 3. **The operation must have a reference.** Without `operationRef` there is
 *    no key, and without a key the second read of the same swap is new income.
 * 4. **The moment must be after activation.** Checked by the caller through
 *    `eligibleForRewards`, because the activation instant is an environment
 *    fact and this function is pure.
 *
 * ## What a missing referrer does
 *
 * Nothing. The share stays with Ryntra. It is not promoted to the other level
 * and it does not create a third — both were named as non-goals, and both are
 * the kind of rule that looks generous once and then has to be explained
 * forever.
 */
export type AccrualInput = Readonly<{
  fee: RyntraServiceFee;
  /** The wallet whose operation this was. Receives the cashback. */
  trader: string;
  /** Who invited the trader, if anybody. Receives 10%. */
  referrerL1: string | null;
  /** Who invited the referrer, if anybody. Receives 5%. */
  referrerL2: string | null;
  /** When the operation settled. Recorded on every entry as its source moment. */
  settledAt: string;
  /** Now, as the caller sees it. Entries are created at this instant. */
  now: string;
  /**
   * A price for the fee asset, when one was read.
   *
   * Null is an ordinary answer, not a failure: the entries are still created
   * with their exact share of the fee asset and no dollar figure, and a reward
   * without a dollar figure is `Pending`. Inventing a price to avoid a Pending
   * row would be the one thing the owner's instruction forbids by name.
   */
  price: Readonly<{ price: string; sourceRef: string; observedAt: string }> | null;
  /**
   * The provider's own dollar figure for the fee it took, when it states one.
   *
   * Relay does, on `paidAppFees`, and it is a measurement of this exact fee on
   * this exact fill — closer to the truth than a price looked up a moment
   * later, which is why it outranks `price` below. A **quoted** figure must
   * never be passed here; only what a settlement reports as paid.
   */
  providerUsd?: number | null;
}>;

export type AccrualRefusal = Readonly<{ ok: false; reason: string }>;

export type AccrualResult =
  | Readonly<{ ok: true; entries: readonly RewardEntry[]; ref: string }>
  | AccrualRefusal;

/** The gross this fee is a share of, or the reason there is none. */
function grossOf(fee: RyntraServiceFee): Readonly<{ raw: bigint; decimals: number }> | string {
  const settlement = fee.settlement;
  if (!settlement) return "The fee carries no settlement, so nothing has been read back to share.";
  if (settlement.userPaidRaw === null) {
    return "The settlement does not state what the person paid, and a share of an unknown is not a number.";
  }
  const decimals = settlement.decimals ?? fee.decimals;
  if (decimals === null) {
    return "The fee asset's decimals are unknown, so its raw amount cannot be placed on a scale.";
  }
  return { raw: rawAmount(settlement.userPaidRaw, "The gross fee"), decimals };
}

export function accrueRewards(input: AccrualInput): AccrualResult {
  const { fee } = input;
  if (!isServiceFeeIncome(fee)) {
    return { ok: false, reason: `A ${fee.state} fee is not income and accrues nothing.` };
  }
  const settlement = fee.settlement;
  const gross = grossOf(fee);
  if (typeof gross === "string") return { ok: false, reason: gross };
  if (!settlement || !settlement.operationRef) {
    return { ok: false, reason: "The settlement carries no operation reference, so a second read could not be told from new income." };
  }
  if (gross.raw === 0n) {
    return { ok: false, reason: "The person paid no fee, so there is nothing to share." };
  }

  const asset = settlement.asset ?? fee.asset;
  const symbol = settlement.symbol ?? fee.symbol;
  const par = isParMint(asset, gross.decimals);

  /*
   * Three ways to a dollar figure, in order of how close each is to the thing
   * being valued: the fee *is* dollars; the provider measured these dollars on
   * this fill; a price feed says what the asset was worth around then. Anything
   * past that is Pending rather than a guess.
   */
  const statedMicros = typeof input.providerUsd === "number" ? usdMicrosFromStated(input.providerUsd) : null;
  let priced: RewardValuation | null = null;
  if (input.price) {
    try {
      priceRatio(input.price.price);
      priced = RewardValuationSchema.parse({ basis: "PRICED_AT_SETTLEMENT", ...input.price });
    } catch { /* Preserve the raw entitlement when its price is unusable. */ }
  }
  const valuation: RewardValuation = par
    ? { basis: "STABLECOIN_PAR", price: null, sourceRef: asset, observedAt: input.settledAt }
    : statedMicros !== null && statedMicros > 0n
      ? { basis: "PROVIDER_STATED_USD", price: null, sourceRef: fee.mechanism, observedAt: input.settledAt }
      : priced
        ? priced
        : { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null };

  const ref = accrualRef(fee.mechanism, settlement.operationRef);
  const source = {
    mechanism: fee.mechanism,
    operationRef: settlement.operationRef,
    trader: input.trader,
    grossRaw: gross.raw.toString(),
    asset,
    symbol,
    decimals: gross.decimals,
    settledAt: input.settledAt,
  } as const;

  /**
   * A dollar figure for a share, or null.
   *
   * The share is valued rather than the gross, so three shares can never add up
   * to more than the gross through three separate roundings — each is floored
   * against the same price and the remainder stays where it started.
   */
  const valueOf = (shareRaw: bigint, rateBps: number): string | null => {
    if (par) return shareRaw.toString();
    if (statedMicros !== null && valuation.basis === "PROVIDER_STATED_USD") {
      /* The **rate**, not the share. `shareRaw` is already gross x rate / 10000
         in the fee asset, and dividing one by the other to recover that ratio
         would be a floating-point operation in the one module that must not
         contain any — while the exact integer that produced it is in scope. */
      return ((statedMicros * BigInt(rateBps)) / 10_000n).toString();
    }
    if (!priced?.price) return null;
    try {
      return usdMicrosOf({ raw: shareRaw, decimals: gross.decimals, price: priced.price }).toString();
    } catch {
      /* A price this module cannot represent exactly leaves the reward
         unvalued rather than approximately valued. */
      return null;
    }
  };

  const entries: RewardEntry[] = [];
  const add = (type: "CASHBACK" | "REFERRAL_L1" | "REFERRAL_L2", recipient: string, rateBps: number): void => {
    const shareRaw = shareOfGross(gross.raw, rateBps);
    if (shareRaw === 0n) return;
    entries.push({
      type,
      recipient,
      rateBps,
      shareRaw: shareRaw.toString(),
      usdMicros: valueOf(shareRaw, rateBps),
      valuation,
      source,
      createdAt: input.now,
      claimId: null,
      signature: null,
    });
  };

  add("CASHBACK", input.trader, REWARD_RATE_BPS.CASHBACK);

  /* Self-referral is refused where a referrer is bound, and refused again here.
     The first refusal is the rule; this one is the guard that keeps a future
     caller from routing around it. */
  if (input.referrerL1 && input.referrerL1 !== input.trader) {
    add("REFERRAL_L1", input.referrerL1, REWARD_RATE_BPS.REFERRAL_L1);
  }
  if (
    input.referrerL2 &&
    input.referrerL2 !== input.trader &&
    input.referrerL2 !== input.referrerL1
  ) {
    add("REFERRAL_L2", input.referrerL2, REWARD_RATE_BPS.REFERRAL_L2);
  }

  return { ok: true, entries, ref };
}
