import type { ClusterVerdict } from "../city-economy/honest-count.ts";
import type { RewardEntry } from "../rewards/model.ts";
import { needsReview, PROTECT_RULES, type SignalCode } from "./protect.ts";

/**
 * Protection of a friend's trade (Ryntra Partners, R3): the swap inviter's share and the rank points it carries —
 * the rules alone, no store and no chain.
 *
 * ## The three attacks it answers
 *
 * 1. **A second own wallet as «friend».** The wallet trades, its own other wallet is its inviter: the trader's own
 *    share plus the inviter's — under rules 2.2.0 up to 85 % of every fee back to one person, and the partner's share
 *    of decision 93 (`city/lib/partners/terms.ts`) on top of the brought person's discount. A pair whose two wallets
 *    the cluster check finds to be one person (`cluster-check.ts`: a signed link, money between them, a shared
 *    withdrawal address, a shared device, a common funder) is a case for a person, never a payout.
 * 2. **Wash-trading to a rank.** A friend's fee is a point to the inviter, and a rank is a share: the cheapest way to
 *    Diamond was the same second wallet. Its trades earn the inviter no point until the pair is clear.
 * 3. **Circular trades.** A buy sold back by the same wallet within a day for about what it cost (S6, the same
 *    window and tolerance as the Network's protection) is volume for its own sake: neither half earns a rank point —
 *    the trader's own nor its inviter's. The fee is real, so the trader's own cashback stays; nothing else moves.
 *
 * ## A sign, never a verdict
 *
 * Nothing here bans a wallet or takes money that was earned. A flagged pair opens a case on the inviter's wallet in
 * the review queue (S10); while it is open the pair's share waits — earned, not available — and a person decides:
 * paid as earned, or never paid (the share stays with Ryntra, and the pair's next trades write none). A pair that has
 * not been checked yet waits too: «not known» is never «clear».
 *
 * ## The referrer bar
 *
 * A link is anyone's for the asking. A payout of a friend's share is not: the inviter's own wallet must have made at
 * least one real trade through Ryntra — a fee Ryntra received that was not half of a circular trade. The bar is on the
 * payout, never on the link, and the claim itself already needs the wallet's proof.
 */

export const REFERRAL_GUARD_RULES = {
  version: "referral-guard-1.0.0",
  /** The least own trades an inviter needs before a friend's share can be paid out. */
  referrerBar: { ownTrades: 1 },
  /** S6 for swaps: the Network's round-trip window and tolerance. */
  circular: { windowHours: PROTECT_RULES.roundTrip.windowHours, toleranceBps: PROTECT_RULES.roundTrip.toleranceBps },
  /** At most this many circular operations are kept on a pair's record — the oldest drop out of the rank window first. */
  keptCircular: 200,
} as const;

/* ------------------------------------------------------------------------------------------------
 * The pair check
 * --------------------------------------------------------------------------------------------- */

/**
 * - `PENDING` — not checked yet, or a read did not answer: the share waits, no point counts;
 * - `CLEAR` — every check ran and none matched, no soft signals enough for a case: paid, points count;
 * - `REVIEW` — signals found: a case on the inviter's wallet; the share waits for a person.
 */
export const REFERRAL_PAIR_STATES = ["PENDING", "CLEAR", "REVIEW"] as const;
export type ReferralPairState = (typeof REFERRAL_PAIR_STATES)[number];

export type ReferralPairFinding = Readonly<{ state: "CLEAR" | "REVIEW" | "WAIT"; codes: readonly SignalCode[] }>;

/** The cluster check's reason as the review queue names it — the same codes as the Network's and «First $10 back». */
const REASON_CODES: Readonly<Record<string, SignalCode>> = {
  linked_wallet: "S2_DIRECT_FUNDS",
  direct_funds: "S2_DIRECT_FUNDS",
  shared_withdrawal: "S3_SHARED_WITHDRAWAL",
  shared_device: "S4_SHARED_DEVICE",
  shared_funder: "S1_SHARED_FUNDING",
};

/** Unknowns that come from a read which did not answer: asked again later, never decided. */
const READ_GAPS = new Set(["no_check", "no_links", "no_funding", "funding_incomplete", "no_money_check", "no_withdrawals", "no_devices"]);

/**
 * One pair — a trader and the wallet paid for bringing it — from the cluster verdict and the two soft signals.
 *
 * `same` is never decided here: whatever made the two look like one person opens a case. `unknown` waits while a read
 * is missing; a funding trail too long to read is `UNVERIFIED` (as «First $10 back» names it) and goes to a person.
 * `separate` is clear unless soft signals add up to a case (S10: two soft signals).
 */
export function referralPairFinding(
  input: Readonly<{ verdict: ClusterVerdict; youngTrader: boolean; circularTrades: number }>,
): ReferralPairFinding {
  const { verdict } = input;
  if (verdict.verdict === "same") return { state: "REVIEW", codes: [REASON_CODES[verdict.reason] ?? "UNVERIFIED"] };
  if (verdict.verdict === "unknown") return READ_GAPS.has(verdict.why) ? { state: "WAIT", codes: [] } : { state: "REVIEW", codes: ["UNVERIFIED"] };
  const codes: SignalCode[] = [];
  if (input.youngTrader) codes.push("S5_YOUNG_WALLETS");
  if (input.circularTrades > 0) codes.push("S6_ROUND_TRIP");
  return needsReview(codes) ? { state: "REVIEW", codes } : { state: "CLEAR", codes };
}

/** What a stored pair does to its money now, after the reviewer's word on the inviter's case. */
export type ReferralPairEffect = "PAYS" | "WAITS" | "STOPPED";

/**
 * A pair's record against the inviter's case: a `REVIEW` pair is let go only by a decision taken after it was
 * flagged — paid (`CLEAR`, `ADJUST`: the wallet's own hold keeps any ceiling) or stopped (`CANCEL`). Before that, and
 * for a pair never checked, the share waits.
 */
export function referralPairEffect(
  pair: Readonly<{ state: ReferralPairState; flaggedAt: string | null }> | null,
  decision: Readonly<{ kind: "CLEAR" | "ADJUST" | "CANCEL"; at: string }> | null,
): ReferralPairEffect {
  if (!pair || pair.state === "PENDING") return "WAITS";
  if (pair.state === "CLEAR") return "PAYS";
  if (!decision || !pair.flaggedAt || !(Date.parse(decision.at) >= Date.parse(pair.flaggedAt))) return "WAITS";
  return decision.kind === "CANCEL" ? "STOPPED" : "PAYS";
}

/* ------------------------------------------------------------------------------------------------
 * Circular trades
 * --------------------------------------------------------------------------------------------- */

/** A swap as the action ledger keeps it: what left the wallet and what came in. */
export type SwapLeg = Readonly<{ ref: string; at: string; outMint: string; outRaw: bigint; inMint: string; inRaw: bigint }>;

/** The swaps of a ledger's rows, by their reference (the signature an accrual names as its operation). */
export function swapLegsOf(
  actions: readonly Readonly<{ lane: string; outcome: string; actionId: string; signature: string | null; startedAt: string; out: { mint: string | null; amountRaw: string } | null; in: { mint: string | null; amountRaw: string } | null }>[],
): SwapLeg[] {
  const legs: SwapLeg[] = [];
  for (const action of actions) {
    if (action.lane !== "SWAP" || action.outcome !== "DONE" || !action.out?.mint || !action.in?.mint) continue;
    legs.push({ ref: action.signature ?? action.actionId, at: action.startedAt, outMint: action.out.mint, outRaw: BigInt(action.out.amountRaw), inMint: action.in.mint, inRaw: BigInt(action.in.amountRaw) });
  }
  return legs;
}

const within = (value: bigint, target: bigint, toleranceBps: number): boolean =>
  target > 0n && value * 10_000n >= target * BigInt(10_000 - toleranceBps) && value * 10_000n <= target * BigInt(10_000 + toleranceBps);

/**
 * The swaps that are halves of a circular trade: `A → B`, then `B → A` by the same wallet within the window, the
 * second selling back about what the first bought and getting back about what the first spent. Each swap pairs once,
 * with the earliest return that matches it.
 */
export function circularSwapRefs(legs: readonly SwapLeg[]): Set<string> {
  const windowMs = REFERRAL_GUARD_RULES.circular.windowHours * 3_600_000;
  const tolerance = REFERRAL_GUARD_RULES.circular.toleranceBps;
  const sorted = [...legs].filter((leg) => Number.isFinite(Date.parse(leg.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const used = new Set<number>();
  const out = new Set<string>();
  for (let i = 0; i < sorted.length; i += 1) {
    if (used.has(i)) continue;
    const first = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (used.has(j)) continue;
      const back = sorted[j]!;
      if (Date.parse(back.at) - Date.parse(first.at) > windowMs) break;
      if (back.outMint !== first.inMint || back.inMint !== first.outMint) continue;
      if (!within(back.outRaw, first.inRaw, tolerance) || !within(back.inRaw, first.outRaw, tolerance)) continue;
      used.add(i).add(j);
      out.add(first.ref).add(back.ref);
      break;
    }
  }
  return out;
}

/* ------------------------------------------------------------------------------------------------
 * What the guard does to rows: the rank, the bar, the held share
 * --------------------------------------------------------------------------------------------- */

/** One wallet's guard, as the readers of its rows need it. */
export type ReferralGuard = Readonly<{
  /** The wallet's own swaps that are halves of a circular trade. */
  ownCircular: ReadonlySet<string>;
  /** Each trader this wallet is paid for: what the pair does to the money, and that trader's circular swaps. */
  pairs: ReadonlyMap<string, Readonly<{ effect: ReferralPairEffect; circular: ReadonlySet<string> }>>;
}>;

/** No guard read: nothing counts and nothing pays — the reading for a store that did not answer. */
export const NO_REFERRAL_GUARD: ReferralGuard = Object.freeze({ ownCircular: new Set<string>(), pairs: new Map() });

/**
 * The rows a rank may count: the wallet's own cashback unless the trade was half of a circular one; a friend's level-1
 * row only while the pair pays and the friend's trade was not half of a circular one. Every other row passes as it
 * is — a rank is read from cashback and level-1 rows only (`rank.ts`).
 */
export function rankCountedEntries(entries: readonly RewardEntry[], wallet: string, guard: ReferralGuard): RewardEntry[] {
  return entries.filter((entry) => {
    if (!entry.source || entry.recipient !== wallet) return true;
    if (entry.type === "CASHBACK" && entry.source.trader === wallet) return !guard.ownCircular.has(entry.source.operationRef);
    if (entry.type === "REFERRAL_L1" && entry.source.trader !== wallet) {
      const pair = guard.pairs.get(entry.source.trader);
      return pair?.effect === "PAYS" && !pair.circular.has(entry.source.operationRef);
    }
    return true;
  });
}

/** The referrer bar: at least one own trade that paid Ryntra a fee and was not half of a circular trade. */
export function referrerBarMet(entries: readonly RewardEntry[], wallet: string, ownCircular: ReadonlySet<string>): boolean {
  let trades = 0;
  const seen = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "CASHBACK" || entry.recipient !== wallet || entry.source?.trader !== wallet) continue;
    if (entry.shareRaw === null || BigInt(entry.shareRaw) <= 0n || ownCircular.has(entry.source.operationRef)) continue;
    seen.add(entry.source.operationRef);
    trades = seen.size;
  }
  return trades >= REFERRAL_GUARD_RULES.referrerBar.ownTrades;
}

/**
 * What a wallet's friends' shares hold back from its payout, USD micro-units: every level-1 and level-2 row of a pair
 * that does not pay yet (or never will), and all of them while the wallet has not met the referrer bar. Earned, not
 * available — the rows stay as written, so «everything accrued = the sum of receipts» is untouched.
 */
export function referralHeldUsdMicros(entries: readonly RewardEntry[], wallet: string, guard: ReferralGuard, barMet: boolean): bigint {
  let held = 0n;
  for (const entry of entries) {
    if ((entry.type !== "REFERRAL_L1" && entry.type !== "REFERRAL_L2") || entry.recipient !== wallet || !entry.source) continue;
    if (entry.usdMicros === null) continue;
    const value = BigInt(entry.usdMicros);
    if (value <= 0n) continue;
    if (!barMet || guard.pairs.get(entry.source.trader)?.effect !== "PAYS") held += value;
  }
  return held;
}
