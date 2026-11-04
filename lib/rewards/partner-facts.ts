import { PARTNER_TERMS, termsSet, type PartnerTerms } from "../../city/lib/partners/terms.ts";
import { PROTECT_RULES } from "../growth/protect.ts";
import { REFERRAL_GUARD_RULES } from "../growth/referral-guard.ts";
import { formatUsdMicros, REWARD_MINIMUM_CLAIM_USD_MICROS, USD_MICROS_PER_USD } from "./model.ts";
import { NETWORK_TIERS, type NetworkRules } from "./network-rules.ts";
import {
  FIRST_TEN_CEILING_BPS,
  hasWindows,
  payoutCeilingBps,
  RANK_POINTS_PER_USD,
  RANK_WINDOW_DAYS,
  rankThresholdsOf,
  REWARD_RANKS,
  type RewardRank,
  type RewardRules,
} from "./rules.ts";
import { PAYOUTS_FIRST_WEEK, SHARED_PRODUCTS } from "../partner-payouts/week.ts";

/**
 * Ryntra Partners, R2: the programme's facts as one read-only answer — the programme as the operator set it, what the
 * engine counts today, how far apart the two are, the guard and whether partner money is paid now.
 *
 * ## Two sources, never a figure typed here
 *
 * - **The programme** — the operator's terms, decision 93 (31.10.2026): 40 % of Ryntra's fee for each brought person's
 *   first 90 days, then 30 %, for good; 10 % off the fee for the person brought; $5 at least, USDC, weekly; one
 *   level. They live in one place, `city/lib/partners/terms.ts` (`PARTNER_TERMS`), which the partner page, its PDFs
 *   and the city's «Partners» window read too; this reads the same object, so the four can never disagree.
 * - **The engine** — what the accrual writes today: the traders' rules in force (`rules.ts`), the Network's rules of
 *   the moment (`network-rules.ts`), the claim floor and what a claim pays in (`treasury.server.ts`).
 *
 * ## Who pays a partner
 *
 * A partner's share is paid by the weekly payouts (CITY-128, `lib/partner-payouts/week.ts`), which count it from
 * `PARTNER_TERMS` itself — the programme is what is paid there, never a copy. `payouts` says whether they run on this
 * deployment (`RYNTRA_PARTNER_PAYOUTS=on` and its treasury), from which week, on which products, and whether the
 * friend's discount is taken off trades (CITY-182).
 *
 * ## The reconciliation
 *
 * The traders' rewards engine (cashback, ranks, «First $10 back») writes an inviter's share of its own under its
 * rules. It is not the programme, and it counts nothing until rewards start (`rewards.countingFrom`). Until a rules
 * version carries decision 93 into it, the two
 * differ, and the answer says where, term by term (`gaps`). Nothing is papered over.
 */

/** `OPEN` — the weekly partner payouts run here; `COUNTED` — shares are counted and kept, not paid yet. */
export type PaidAsStatus = "OPEN" | "COUNTED";

/** `live` — earns and pays now; `none` — no share. */
export type ProductStatus = "live" | "pending" | "none";

export const PARTNER_PRODUCTS = ["swap", "launch", "perps", "predictions", "pools", "agents"] as const;
export type PartnerProduct = (typeof PARTNER_PRODUCTS)[number];

/** The terms of decision 93, in the order `terms.ts` prints them, that the engine either counts or does not. */
export const PARTNER_TERM_KEYS = ["firstShare", "afterShare", "attribution", "refereeDiscount", "levels", "minimumPayout", "payoutAsset", "cadence"] as const;
export type PartnerTermKey = (typeof PARTNER_TERM_KEYS)[number];

type Share = Readonly<{ bps: number; percent: number }>;

/** One term where the engine counts something other than the programme: both sides as their own code holds them. */
export type PartnerTermGap = Readonly<{ term: PartnerTermKey; programme: string; engine: string }>;

export type PartnerProgramme = Readonly<{
  /** The decision that set the numbers (`PARTNER_TERMS.decided`). */
  decided: string;
  first: Share & Readonly<{ days: number }>;
  after: Share;
  attribution: "lifetime" | number;
  refereeDiscount: Share;
  minimumPayoutUsd: number;
  payoutAsset: "USDC" | "SOL";
  cadence: "weekly" | "monthly";
  levels: number;
}>;

export type EngineCounts = Readonly<{
  versions: Readonly<{ traders: string; network: string }>;
  /** When the traders' rules in force came into force on this store; null for the first rules (from the start). */
  tradersRulesSince: string | null;
  cashback: Share;
  inviter: Readonly<{
    /** Of the fee Ryntra received (`RECEIVED`) or of the gross the person paid (`GROSS`, rules 1.0.0). */
    base: "RECEIVED" | "GROSS";
    ranks: readonly Readonly<{ rank: RewardRank; fromPoints: number } & Share>[];
    rankWindowDays: number;
    pointsPerUsd: number;
    /** A friend's first days at one share whatever the rank; null under rules without it. */
    friendWindow: (Share & Readonly<{ days: number }>) | null;
  }>;
  secondLevel: Share;
  /** Everything one fee pays out, outside «First $10 back». */
  ceiling: Share;
  firstTen: (Share & Readonly<{ capUsdMicros: string; days: number; walletsPerMonth: number }>) | null;
  /** The least a claim pays, USD micro-units as a string: with the wallet's account open, and without. */
  claimFloor: Readonly<{ withAccountUsdMicros: string; withoutAccountUsdMicros: string }>;
  claimAsset: string;
  network: Readonly<{
    schedules: Readonly<Record<(typeof NETWORK_TIERS)[number], readonly Readonly<{ untilDay: number | null } & Share>[]>>;
    foundingSeats: number;
    poolCap: Share;
    holdDays: number;
  }>;
}>;

export type PartnerFacts = Readonly<{
  schema: 3;
  asOf: string;
  /** The operator's programme (decision 93); null while `terms.ts` has a term without a value. */
  programme: PartnerProgramme | null;
  /** What the accrual writes today. */
  engine: EngineCounts;
  /** Where the engine does not count the programme yet; `matches` only when there is no gap. */
  reconciliation: Readonly<{ matches: boolean; gaps: readonly PartnerTermGap[] }>;
  /** The weekly partner payouts of decision 93 (CITY-128). */
  payouts: Readonly<{
    paidAs: PaidAsStatus;
    /** The first week counted, `YYYY-MM-DD` (its Monday, UTC). */
    firstWeek: string;
    /** The operations whose fee a partner shares, as the payouts name them. */
    products: readonly string[];
    /** The friend's discount is taken off trades on this deployment. */
    discountOn: boolean;
  }>;
  /** The traders' rewards engine: the moment it counts from (the activation instant), or null while it is not set. */
  rewards: Readonly<{ countingFrom: string | null; started: boolean }>;
  guard: Readonly<{ version: string; protect: string; referrerOwnTrades: number; circularWindowHours: number; circularToleranceBps: number; reviewHours: number }>;
  products: Readonly<Record<PartnerProduct, ProductStatus>>;
}>;

const share = (bps: number): Share => ({ bps, percent: Math.round(bps) / 100 });
const pct = (bps: number): string => `${Math.round(bps) / 100}%`;
const usd = (micros: bigint): string => `$${formatUsdMicros(micros)}`;

function stepsOf(network: NetworkRules, tier: (typeof NETWORK_TIERS)[number]) {
  return network.schedules[tier].map((step) => ({ untilDay: step.untilDay, ...share(step.bps) }));
}

export function paidAsStatus(partnerPayoutsOn: boolean): PaidAsStatus {
  return partnerPayoutsOn ? "OPEN" : "COUNTED";
}

/** The programme as numbers, or null while any term of `terms.ts` is still open. */
export function programmeOf(terms: PartnerTerms = PARTNER_TERMS): PartnerProgramme | null {
  if (!termsSet(terms) || !terms.decided) return null;
  const { share: split, attribution, refereeDiscountBps, minimumPayoutUsd, payoutAsset, cadence, levels } = terms;
  if (!split || attribution === null || refereeDiscountBps === null || minimumPayoutUsd === null || !payoutAsset || !cadence || levels === null) return null;
  return {
    decided: terms.decided,
    first: { ...share(split.firstBps), days: split.firstDays },
    after: share(split.afterBps),
    attribution,
    refereeDiscount: share(refereeDiscountBps),
    minimumPayoutUsd,
    payoutAsset,
    cadence,
    levels,
  };
}

/**
 * The terms the engine does not count as the programme says, each side as its own code holds it. The engine's side of
 * a term it has no notion of says so: the accrual pays a person brought no discount (everybody's cashback is not a
 * discount), keeps no cadence (a claim is the wallet's, whenever it asks) and binds an inviter for good.
 */
export function programmeGaps(programme: PartnerProgramme, rules: RewardRules, claim: Readonly<{ floorUsdMicros: bigint; asset: string }>): PartnerTermGap[] {
  const gaps: PartnerTermGap[] = [];
  const add = (term: PartnerTermKey, want: string, have: string) => {
    if (want !== have) gaps.push({ term, programme: want, engine: have });
  };
  const window = rules.inviterWindow;
  add("firstShare", `${pct(programme.first.bps)} × ${programme.first.days} days`, window ? `${pct(window.bps)} × ${window.days} days` : "none");
  const byRank = REWARD_RANKS.map((rank) => rules.referralL1BpsByRank[rank]);
  const low = Math.min(...byRank);
  const high = Math.max(...byRank);
  add("afterShare", pct(programme.after.bps), low === high ? pct(low) : `${pct(low)}–${pct(high)} by rank`);
  /* The engine binds a friend to the inviter for good: no attribution window exists in the account. */
  add("attribution", programme.attribution === "lifetime" ? "lifetime" : `${programme.attribution} days`, "lifetime");
  add("refereeDiscount", pct(programme.refereeDiscount.bps), "none");
  add("levels", String(programme.levels), String(rules.referralL2Bps > 0 ? 2 : 1));
  add("minimumPayout", usd(BigInt(programme.minimumPayoutUsd) * USD_MICROS_PER_USD), usd(claim.floorUsdMicros));
  add("payoutAsset", programme.payoutAsset, claim.asset);
  add("cadence", programme.cadence, "on claim");
  return gaps;
}

export function partnerFactsOf(
  input: Readonly<{
    now: string;
    rules: RewardRules;
    rulesSince: string | null;
    network: NetworkRules;
    /** The weekly partner payouts run on this deployment: the switch is on and the treasury is named. */
    partnerPayoutsOn: boolean;
    /** The friend's discount is taken off trades (`DISCOUNT_ON`). */
    discountOn: boolean;
    activation: string | null;
    /** What a claim pays in (`REWARD_CLAIM_ASSET`). */
    claimAsset: string;
    /** The programme's terms; `PARTNER_TERMS` unless a test passes others. */
    terms?: PartnerTerms;
  }>,
): PartnerFacts {
  const { rules, network } = input;
  const ladder = rankThresholdsOf(rules);
  const started = input.activation !== null && Date.parse(input.activation) <= Date.parse(input.now);
  const paidAs = paidAsStatus(input.partnerPayoutsOn);
  /* A partner's share of swaps and launches is paid weekly once the payouts run; until then it is counted and waits. */
  const shared = (products: readonly string[]): ProductStatus =>
    products.some((product) => (SHARED_PRODUCTS as readonly string[]).includes(product)) ? (paidAs === "OPEN" ? "live" : "pending") : "none";
  const floor = rules.claimFloor ?? { withAccountUsdMicros: REWARD_MINIMUM_CLAIM_USD_MICROS, withoutAccountUsdMicros: REWARD_MINIMUM_CLAIM_USD_MICROS };
  const programme = programmeOf(input.terms ?? PARTNER_TERMS);
  /* The higher floor is the one a partner can count on: a wallet without its account open waits for it. */
  const gaps = programme ? programmeGaps(programme, rules, { floorUsdMicros: floor.withoutAccountUsdMicros, asset: input.claimAsset }) : [];
  return {
    schema: 3,
    asOf: new Date(Date.parse(input.now)).toISOString(),
    programme,
    engine: {
      versions: { traders: rules.version, network: network.version },
      tradersRulesSince: input.rulesSince,
      cashback: share(rules.cashbackBps),
      inviter: {
        base: rules.base,
        ranks: REWARD_RANKS.map((rank) => ({ rank, fromPoints: Number(ladder[rank]), ...share(rules.referralL1BpsByRank[rank]) })),
        rankWindowDays: RANK_WINDOW_DAYS,
        pointsPerUsd: Number(RANK_POINTS_PER_USD),
        friendWindow: rules.inviterWindow ? { ...share(rules.inviterWindow.bps), days: rules.inviterWindow.days } : null,
      },
      secondLevel: share(rules.referralL2Bps),
      ceiling: share(payoutCeilingBps(rules)),
      firstTen: hasWindows(rules) && rules.firstTen
        ? { ...share(FIRST_TEN_CEILING_BPS), capUsdMicros: rules.firstTen.capUsdMicros.toString(), days: rules.firstTen.days, walletsPerMonth: rules.firstTen.walletsPerMonth }
        : null,
      claimFloor: { withAccountUsdMicros: floor.withAccountUsdMicros.toString(), withoutAccountUsdMicros: floor.withoutAccountUsdMicros.toString() },
      claimAsset: input.claimAsset,
      network: {
        schedules: { STANDARD: stepsOf(network, "STANDARD"), FOUNDING: stepsOf(network, "FOUNDING") },
        foundingSeats: network.foundingSeats,
        poolCap: share(network.poolCapBps),
        holdDays: network.holdDays,
      },
    },
    reconciliation: { matches: programme !== null && gaps.length === 0, gaps },
    payouts: { paidAs, firstWeek: PAYOUTS_FIRST_WEEK, products: [...SHARED_PRODUCTS], discountOn: input.discountOn },
    rewards: { countingFrom: input.activation, started },
    guard: {
      version: REFERRAL_GUARD_RULES.version,
      protect: PROTECT_RULES.version,
      referrerOwnTrades: REFERRAL_GUARD_RULES.referrerBar.ownTrades,
      circularWindowHours: REFERRAL_GUARD_RULES.circular.windowHours,
      circularToleranceBps: REFERRAL_GUARD_RULES.circular.toleranceBps,
      reviewHours: PROTECT_RULES.reviewHours,
    },
    products: { swap: shared(["SWAP", "SPOT", "STOCK"]), launch: shared(["LAUNCH"]), perps: "none", predictions: "none", pools: "none", agents: "none" },
  };
}
