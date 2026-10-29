import {
  accrualRef,
  isParMint,
  rawAmount,
  priceRatio,
  RewardValuationSchema,
  shareOfGross,
  usdMicrosFromStated,
  usdMicrosOf,
  type RewardEntry,
  type RewardValuation,
  type RewardWindow,
} from "./model.ts";
import { isServiceFeeIncome, type RyntraServiceFee } from "../swap/service-fee.ts";
import { FIRST_TEN_CEILING_BPS, hasWindows, payoutCeilingBps, REWARD_RULES_V1, type RewardRank, type RewardRules, storedVersion } from "./rules.ts";

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
   * without a dollar figure is `Pending`.
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
  /**
   * The rules version this operation is computed by. Absent means `1.0.0`,
   * the gross-based programme, so a caller that predates ranks keeps its
   * arithmetic exactly; `record.server.ts` chooses by when the operation
   * settled.
   */
  rules?: RewardRules;
  /** The inviter's rank when the trade settled. Absent means Bronze. */
  referrerL1Rank?: RewardRank | null;
  /**
   * The windows of rules `2.1.0` this trade falls in, as `record.server.ts` read them from the trader's record
   * (`first-ten.ts`). Ignored under any other rules.
   *
   * `firstTen` — inside «First $10 back»: `remainingUsdMicros` is what may still come back before the cap;
   * `"FROZEN"` is the layout of a row first written without a price — the ordinary half and the inviter's zero,
   * never the rest — so that pricing it later cannot change what was written. `inviter` — inside the inviter's
   * 90 days from this trader's first trade.
   */
  window?: Readonly<{ firstTen?: Readonly<{ remainingUsdMicros: bigint }> | "FROZEN" | null; inviter?: boolean }>;
}>;

export type AccrualRefusal = Readonly<{ ok: false; reason: string }>;

export type AccrualResult =
  | Readonly<{
      ok: true;
      entries: readonly RewardEntry[];
      ref: string;
      /** Inside «First $10 back»: what came back to the trader on this trade, and of it the rest held for the check, USD micro-units — known amounts only. */
      firstTen?: Readonly<{ returnedUsdMicros: bigint; restUsdMicros: bigint }>;
    }>
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

/**
 * What reached Ryntra of a gross, or the reason it is not known.
 *
 * The settlement's own `ryntraRaw` first — read or derived from the
 * provider's documented cut by the code that read the chain. Failing that,
 * gross minus the provider's stated share. Never more than the gross, and
 * never a guess: an unknown received amount accrues nothing under a rule
 * whose whole point is that payouts stay inside it.
 */
function receivedOf(fee: RyntraServiceFee, gross: bigint): bigint | string {
  const settlement = fee.settlement;
  const stated = settlement?.ryntraRaw ?? null;
  const received = stated !== null
    ? rawAmount(stated, "The received fee")
    : settlement?.providerRaw != null
      ? gross - rawAmount(settlement.providerRaw, "The provider's share")
      : null;
  if (received === null) return "The settlement does not state what reached Ryntra, so a share of it cannot be computed.";
  if (received < 0n || received > gross) return "The received fee is outside the gross the person paid.";
  return received;
}

/** A row written without a dollar figure on purpose — not "value it as usual". */
const NO_DOLLARS = Symbol("no dollars");

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
  const rules = input.rules ?? REWARD_RULES_V1;
  const received = rules.base === "RECEIVED" ? receivedOf(fee, gross.raw) : gross.raw;
  if (typeof received === "string") return { ok: false, reason: received };
  if (received === 0n) return { ok: false, reason: "Nothing reached Ryntra, so there is nothing to share." };
  const base = received;

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
      /* The **rate**, not the share. The provider's figure is the gross, so it
         is scaled to the base (received ÷ gross, which is 1 under the gross
         rules) and by the rate in one integer expression — recovering the
         ratio from `shareRaw` would be a floating-point operation in the one
         module that must not contain any. */
      return ((statedMicros * base * BigInt(rateBps)) / (gross.raw * 10_000n)).toString();
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

  /**
   * Any part of the base in dollars, from its raw amount — for the rows whose share is not a whole rate of the
   * base (the rest of «First $10 back»). Null when the fee has no dollar figure.
   */
  const valueOfRaw = (raw: bigint): bigint | null => {
    if (par) return raw;
    if (statedMicros !== null && valuation.basis === "PROVIDER_STATED_USD") return (statedMicros * raw) / gross.raw;
    if (!priced?.price) return null;
    try {
      return usdMicrosOf({ raw, decimals: gross.decimals, price: priced.price });
    } catch {
      return null;
    }
  };

  const entries: RewardEntry[] = [];
  const l1Rank: RewardRank = input.referrerL1Rank ?? "BRONZE";
  const windows = hasWindows(rules) ? input.window ?? null : null;
  const firstTen = windows?.firstTen ?? null;
  const inviterWindow = windows?.inviter === true ? rules.inviterWindow ?? null : null;
  /**
   * One row. `part` — the part of the base the row is a share of, when a trade is split at the cap of «First $10
   * back»; its dollars are then read from its own raw amount. Without it the row is a share of the whole base, valued
   * exactly as before 2.1.0.
   */
  const add = (
    type: "CASHBACK" | "REFERRAL_L1" | "REFERRAL_L2",
    recipient: string,
    rateBps: number,
    marks: Readonly<{ window?: RewardWindow; shareRaw?: bigint; usdMicros?: string | typeof NO_DOLLARS; keepZero?: boolean; part?: bigint }> = {},
  ): RewardEntry | null => {
    const partBase = marks.part ?? base;
    const shareRaw = marks.shareRaw ?? shareOfGross(partBase, rateBps);
    if (shareRaw === 0n && !marks.keepZero) return null;
    const partValue = marks.part !== undefined ? valueOfRaw(shareRaw) : undefined;
    const entry: RewardEntry = {
      type,
      recipient,
      rateBps,
      shareRaw: shareRaw.toString(),
      usdMicros: marks.usdMicros === NO_DOLLARS ? null : marks.usdMicros ?? (partValue !== undefined ? (partValue === null ? null : partValue.toString()) : valueOf(shareRaw, rateBps)),
      valuation,
      source,
      createdAt: input.now,
      claimId: null,
      signature: null,
      ...(rules.base === "RECEIVED"
        ? { rules: { version: storedVersion(rules), base: "RECEIVED" as const, baseRaw: partBase.toString(), rank: type === "REFERRAL_L1" ? l1Rank : null } }
        : {}),
      /* Every row of 2.1.0 says where its money comes from; rows of earlier rules keep the shape they had. */
      ...(hasWindows(rules) ? { fundedBy: "fee" as const } : {}),
      ...(marks.window ? { window: marks.window } : {}),
    };
    entries.push(entry);
    return entry;
  };

  /* The ordinary shares of a base, or of its part past «First $10 back»: cashback, the inviter (the 90 days' share,
     or the rank's), the second level. */
  const ordinary = (part?: bigint, cashbackWindow?: RewardWindow): void => {
    add("CASHBACK", input.trader, rules.cashbackBps, { part, window: cashbackWindow });
    /* Self-referral is refused where a referrer is bound, and refused again here.
       The first refusal is the rule; this one is the guard that keeps a future
       caller from routing around it. */
    if (input.referrerL1 && input.referrerL1 !== input.trader) {
      if (inviterWindow) add("REFERRAL_L1", input.referrerL1, inviterWindow.bps, { part, window: "INVITER_90" });
      else add("REFERRAL_L1", input.referrerL1, rules.referralL1BpsByRank[l1Rank], { part });
    }
    if (
      input.referrerL2 &&
      input.referrerL2 !== input.trader &&
      input.referrerL2 !== input.referrerL1
    ) {
      add("REFERRAL_L2", input.referrerL2, rules.referralL2Bps, { part });
    }
  };

  /* How much of the base is inside «First $10 back» — all of it, or the part that brings what came back to the cap. */
  let windowRaw = 0n;
  let firstTenResult: Readonly<{ returnedUsdMicros: bigint; restUsdMicros: bigint }> | undefined;
  if (firstTen) {
    const baseUsd = firstTen === "FROZEN" ? null : valueOfRaw(base);
    if (firstTen === "FROZEN" || baseUsd === null || baseUsd <= firstTen.remainingUsdMicros) {
      windowRaw = base;
    } else {
      /* The cap falls inside this trade: the window is the part whose whole refund reaches it, floored so its dollars
         never pass it; the rest of the trade is ordinary — the inviter's share, the second level, the points. */
      windowRaw = (base * firstTen.remainingUsdMicros) / baseUsd;
      while (windowRaw > 0n && (valueOfRaw(windowRaw) ?? 0n) > firstTen.remainingUsdMicros) windowRaw -= 1n;
    }
  }
  if (windowRaw > 0n && firstTen) {
    /*
     * «First $10 back»: all of the window's part back to the trader, in two rows. The ordinary half is the trader's
     * as on any trade; the rest waits for the cluster check. A fee with no dollar figure yet is written whole, both
     * rows without dollars: when it is priced, `record.server.ts` measures its rest against what is left of the cap.
     */
    const whole = windowRaw === base;
    const half = add("CASHBACK", input.trader, rules.cashbackBps, { window: "FIRST_TEN", ...(whole ? {} : { part: windowRaw }) });
    const halfRaw = shareOfGross(windowRaw, rules.cashbackBps);
    const halfUsd = halfRaw === 0n ? 0n : half?.usdMicros != null ? BigInt(half.usdMicros) : null;
    let restUsd = 0n;
    const restRaw = windowRaw - halfRaw;
    if (restRaw > 0n) {
      const usd = halfUsd === null ? null : valueOfRaw(restRaw);
      /* Priced now: inside the cap by construction — or, for a row first written without a price (`FROZEN`), measured
         against the cap by the caller. Not priced: no dollars here. */
      if (usd === null || usd > 0n) {
        add("CASHBACK", input.trader, Number((restRaw * 10_000n) / base), { window: "FIRST_TEN_REST", shareRaw: restRaw, usdMicros: usd === null ? NO_DOLLARS : usd.toString() });
        restUsd = usd ?? 0n;
      }
    }
    if (whole) {
      /* The trade happened, and the inviter is told so by a row of nothing: boards and badges count a friend's trade
         by its level-1 row, and the inviter's share in the window is zero by the rules. No second level. */
      if (input.referrerL1 && input.referrerL1 !== input.trader) {
        add("REFERRAL_L1", input.referrerL1, 0, { window: "FIRST_TEN", shareRaw: 0n, usdMicros: "0", keepZero: true });
      }
    } else {
      ordinary(base - windowRaw, "FIRST_TEN_AFTER");
    }
    firstTenResult = { returnedUsdMicros: (halfUsd ?? 0n) + restUsd, restUsdMicros: restUsd };
  } else {
    ordinary();
  }

  /* The rule of a received base, checked on the figures themselves rather
     than trusted to the rates: everything one fee pays out stays inside its
     ceiling of what reached Ryntra — all of its part inside «First $10 back»,
     and of the rest all of it under 2.0.0, 85 % under 2.1.0. */
  if (rules.base === "RECEIVED") {
    const paid = entries.reduce((sum, entry) => sum + BigInt(entry.shareRaw ?? "0"), 0n);
    const allowed = windowRaw * BigInt(FIRST_TEN_CEILING_BPS) + (base - windowRaw) * BigInt(payoutCeilingBps(rules));
    if (paid * 10_000n > allowed) return { ok: false, reason: "These shares would pay out more than their ceiling of what Ryntra received." };
  }

  return { ok: true, entries, ref, ...(firstTenResult ? { firstTen: firstTenResult } : {}) };
}
