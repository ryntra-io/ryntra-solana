/**
 * Who a distribution campaign pays, and how much: the snapshot that can be
 * taken again and give the same answer, the right to take part, and the
 * arithmetic of one allocation.
 *
 * ## The snapshot has to be repeatable
 *
 * Spec §10.5 asks that a published root be reproducible from an open snapshot.
 * That needs more than a list: the slot it was taken at, the finality it was
 * taken with, which wallets the rules left out and why, and one spelling for
 * every amount. `snapshotDigest` is that statement hashed — anyone with the
 * same slot and the same rules reaches the same digest, and a campaign whose
 * digest does not match the one it published is not the campaign it published.
 *
 * ## A sign, never a verdict
 *
 * The protection rules of the Ryntra Network already decide what a shared
 * funding source, a shared device, a young wallet or a round trip mean
 * (`lib/growth/protect.ts`), and this module does not write a second set: the
 * campaign hands protection's own signals and its own two decisions — whether a
 * case opens and what the wallet's trust is — into `eligibilityRows`, which is
 * why `EligibilityJudge` is an argument rather than an import. What the campaign
 * adds is only what a campaign can know: its minimum, whether tokens that came
 * by a transfer count, how long a wallet has held, how many wallets of one
 * cluster it will pay, and whether it asks for an identity check.
 *
 * And the line those rules draw holds here too: **a protection signal never
 * takes money away.** It sends the row to review, where a person decides and the
 * wallet can argue; only the campaign's own published rules exclude, and every
 * row says in codes which rule it fell to. Nothing here is a judgement about a
 * person.
 *
 * ## The money
 *
 * Allocations are whole base units. Where a pot divides unevenly the largest
 * remainder takes the odd unit, first row first, so the same list always gives
 * the same amounts and the rows add up to the pot itself. A cap or a floor can
 * leave the pot unspent; what is unspent is leftover and stays with the
 * campaign's owner — it is never quietly spread over the others, because a
 * reader saw the cap before the campaign was funded.
 *
 * Pure and client-safe: no chain, no store, no clock unless given.
 */

import type { SignalCode } from "../../growth/protect.ts";

import { SNAPSHOT_EXCLUSIONS, type SnapshotExclusion } from "./creator-split.ts";

const RAW = /^(0|[1-9][0-9]{0,29})$/;

const amount = (raw: string): bigint | null => (typeof raw === "string" && RAW.test(raw) ? BigInt(raw) : null);

/* ------------------------------------------------------------ the snapshot */

export { SNAPSHOT_EXCLUSIONS };
export type { SnapshotExclusion };

/**
 * How a snapshot was taken, in full, so that it can be taken again: the mint, the slot, the finality, the rules'
 * version and which exclusions were applied. `finality` is `finalized` for anything a campaign is funded against —
 * a confirmed slot can still be rolled back, and a root published over one is a root over a guess.
 */
export type SnapshotSpec = Readonly<{
  mint: string;
  slot: number;
  finality: "finalized" | "confirmed";
  /** When the slot was read, unix seconds — a fact about the reading, never an input to the rules. */
  takenAt: number;
  exclusions: readonly SnapshotExclusion[];
}>;

/** The version of the hashing rules below: a campaign states it, so a later change cannot silently restate an old root. */
export const SNAPSHOT_DIGEST_VERSION = "ryntra-snapshot-1";

export type SnapshotRow = Readonly<{ wallet: string; holdingRaw: string }>;

const hex = (bytes: Uint8Array) => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/**
 * One text for a snapshot: the version, the spec's fields in a fixed order, then each row as `wallet:amount`, the rows
 * sorted by wallet. Sorted, because the order a chain read returns accounts in is not a fact about the snapshot.
 */
export function snapshotText(spec: SnapshotSpec, rows: readonly SnapshotRow[]): string {
  const head = [SNAPSHOT_DIGEST_VERSION, spec.mint, String(spec.slot), spec.finality, [...spec.exclusions].sort().join("+")].join("|");
  const body = [...rows]
    .map((row) => `${row.wallet}:${BigInt(row.holdingRaw).toString()}`)
    .sort()
    .join("\n");
  return `${head}\n${body}\n`;
}

/** A snapshot's digest: sha256 of `snapshotText`, lowercase hex. Anyone with the slot and the rules reaches the same one. */
export async function snapshotDigest(spec: SnapshotSpec, rows: readonly SnapshotRow[]): Promise<string> {
  const bytes = new TextEncoder().encode(snapshotText(spec, rows));
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/* ------------------------------------------------------------ the right to take part */

export const ELIGIBILITY_VERDICTS = ["ELIGIBLE", "REVIEW", "EXCLUDED"] as const;
export type EligibilityVerdict = (typeof ELIGIBILITY_VERDICTS)[number];

/**
 * Why a row is not simply eligible. The campaign's own rules — the ones a reader saw before it was funded — exclude;
 * everything protection raises sends the row to review, where a person decides and the wallet can argue.
 */
export const ELIGIBILITY_REASONS = [
  /** The campaign's list leaves this wallet out: the owner, a wallet linked to it, a program's address, Ryntra's own. */
  "EXCLUDED_WALLET",
  /** Below the campaign's minimum holding. */
  "BELOW_MIN",
  /** Holds the token, but bought none of it on the market — what came by a transfer earns nothing. */
  "NOT_BOUGHT",
  /** Has not held since the slot the campaign asks for, or that was not read. */
  "HELD_TOO_SHORT",
  /** The campaign asks for an identity check and this wallet has not passed one. */
  "KYC_MISSING",
  /** One wallet of this cluster is paid and this is not it — a shared funding source or a shared device. */
  "CLUSTER_CAPPED",
  /** The protection rules opened a case: the row waits for a person, and nothing is taken away. */
  "UNDER_REVIEW",
  /** Trust below what the campaign pays without a look. */
  "LOW_TRUST",
] as const;
export type EligibilityReason = (typeof ELIGIBILITY_REASONS)[number];

/** Only a rule the campaign published can exclude; everything else waits for a person. */
const EXCLUDING: readonly EligibilityReason[] = Object.freeze(["EXCLUDED_WALLET", "BELOW_MIN", "NOT_BOUGHT", "HELD_TOO_SHORT", "KYC_MISSING"]);

export type EligibilityRules = Readonly<{
  /** The least a wallet holds to take part, raw. */
  minHoldingRaw: string;
  /** Whether only what a wallet bought on the market counts. */
  requireBought: boolean;
  /** The slot a wallet must have held since; null — the campaign does not ask. */
  heldSinceSlot: number | null;
  /** Pay one wallet of a funding cluster, of a device, or at most this many of a cluster; 0 — no bound. */
  oneWalletPerFundingSource: boolean;
  oneWalletPerDevice: boolean;
  maxPerCluster: number;
  kyc: boolean;
  /** Trust at or above this is paid without a look; below it the row waits. 0 — the campaign does not ask. */
  minTrust: number;
}>;

export const DEFAULT_ELIGIBILITY: EligibilityRules = Object.freeze({
  minHoldingRaw: "0",
  requireBought: true,
  heldSinceSlot: null,
  oneWalletPerFundingSource: true,
  oneWalletPerDevice: true,
  maxPerCluster: 1,
  kyc: false,
  minTrust: 0,
});

export type Candidate = Readonly<{
  wallet: string;
  /** What the snapshot says the wallet holds, raw. */
  holdingRaw: string;
  /** What it bought on the market less what it sold there, raw — tokens that arrived by a transfer are not in it. */
  boughtRaw: string;
  /** The slot it has held without a break since; null — not read. */
  heldSinceSlot: number | null;
  /** Protection's keyed hashes for this wallet: its funding sources and the devices seen with it. Never the values. */
  fundingHashes: readonly string[];
  deviceHashes: readonly string[];
  /** The signals protection raised for this wallet. */
  signals: readonly SignalCode[];
  /** Whether a person behind the wallet passed the identity check; null — none was taken. */
  kyc: boolean | null;
  /** The campaign's own list, when it leaves the wallet out. */
  excluded: SnapshotExclusion | null;
}>;

/** Protection's own two decisions, handed in rather than restated: `lib/growth/protect.ts`'s `needsReview` and `trustScore`. */
export type EligibilityJudge = Readonly<{
  needsReview(codes: readonly SignalCode[]): boolean;
  trustScore(codes: readonly SignalCode[]): number;
}>;

export type EligibilityRow = Readonly<{
  wallet: string;
  verdict: EligibilityVerdict;
  /** What counts for this wallet when the pot is divided, raw — its holding, or what it bought when that is the rule. */
  basisRaw: string;
  /** Every reason, each once, in the order above. */
  reasons: readonly EligibilityReason[];
  /** Protection's score, for the person who looks at a review. */
  trust: number;
  /** Whether a decision here can be argued: a review can, a published rule cannot. */
  appealable: boolean;
}>;

/**
 * Every candidate's verdict. Rows come back in the order given, so a caller's own ordering (largest first, earliest
 * first) survives. The cluster rules are applied last and by basis — the largest wallet of a cluster is the one paid,
 * ties by address, so the same list always picks the same wallet.
 */
export function eligibilityRows(candidates: readonly Candidate[], rules: EligibilityRules, judge: EligibilityJudge): readonly EligibilityRow[] {
  const minHolding = amount(rules.minHoldingRaw) ?? 0n;
  const reasonsOf = new Map<string, Set<EligibilityReason>>();
  const basisOf = new Map<string, bigint>();
  const trustOf = new Map<string, number>();

  for (const candidate of candidates) {
    const reasons = new Set<EligibilityReason>();
    const holding = amount(candidate.holdingRaw) ?? 0n;
    const bought = amount(candidate.boughtRaw) ?? 0n;
    const counted = rules.requireBought ? (bought < holding ? bought : holding) : holding;
    if (candidate.excluded) reasons.add("EXCLUDED_WALLET");
    /* Holding tokens that only ever arrived by a transfer is its own answer: the campaign's minimum is not the point. */
    if (rules.requireBought && bought <= 0n && holding > 0n) reasons.add("NOT_BOUGHT");
    else if (counted <= 0n || counted < minHolding) reasons.add("BELOW_MIN");
    if (rules.heldSinceSlot !== null && (candidate.heldSinceSlot === null || candidate.heldSinceSlot > rules.heldSinceSlot)) reasons.add("HELD_TOO_SHORT");
    if (rules.kyc && candidate.kyc !== true) reasons.add("KYC_MISSING");
    if (judge.needsReview(candidate.signals)) reasons.add("UNDER_REVIEW");
    const trust = judge.trustScore(candidate.signals);
    if (rules.minTrust > 0 && trust < rules.minTrust) reasons.add("LOW_TRUST");
    reasonsOf.set(candidate.wallet, reasons);
    basisOf.set(candidate.wallet, counted);
    trustOf.set(candidate.wallet, trust);
  }

  /* The clusters: a wallet is in one for each hash it shares. Only wallets no published rule has excluded compete for
     a cluster's places — a wallet nobody may pay does not take the place of one who could be. */
  const cap = rules.maxPerCluster > 0 ? rules.maxPerCluster : Number.POSITIVE_INFINITY;
  const standing = candidates.filter((candidate) => ![...reasonsOf.get(candidate.wallet)!].some((reason) => EXCLUDING.includes(reason)));
  const ordered = [...standing].sort((a, b) => {
    const left = basisOf.get(a.wallet)!;
    const right = basisOf.get(b.wallet)!;
    return right > left ? 1 : right < left ? -1 : a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0;
  });
  const taken = new Map<string, number>();
  for (const candidate of ordered) {
    const keys: string[] = [];
    if (rules.oneWalletPerFundingSource) for (const hash of candidate.fundingHashes) keys.push(`f:${hash}`);
    if (rules.oneWalletPerDevice) for (const hash of candidate.deviceHashes) keys.push(`d:${hash}`);
    const full = keys.filter((key) => (taken.get(key) ?? 0) >= cap);
    if (full.length) {
      reasonsOf.get(candidate.wallet)!.add("CLUSTER_CAPPED");
      continue;
    }
    for (const key of keys) taken.set(key, (taken.get(key) ?? 0) + 1);
  }

  return Object.freeze(
    candidates.map((candidate) => {
      const reasons = ELIGIBILITY_REASONS.filter((reason) => reasonsOf.get(candidate.wallet)!.has(reason));
      const excluded = reasons.some((reason) => EXCLUDING.includes(reason));
      const verdict: EligibilityVerdict = excluded ? "EXCLUDED" : reasons.length ? "REVIEW" : "ELIGIBLE";
      return Object.freeze({
        wallet: candidate.wallet,
        verdict,
        basisRaw: basisOf.get(candidate.wallet)!.toString(),
        reasons: Object.freeze(reasons),
        trust: trustOf.get(candidate.wallet)!,
        appealable: verdict === "REVIEW",
      });
    }),
  );
}

/** How many rows each verdict holds, and what the campaign is holding back while people are looked at. */
export function eligibilityTotals(rows: readonly EligibilityRow[]): Readonly<{ eligible: number; review: number; excluded: number; eligibleBasisRaw: string; reviewBasisRaw: string }> {
  let eligibleBasis = 0n;
  let reviewBasis = 0n;
  let eligible = 0;
  let review = 0;
  let excluded = 0;
  for (const row of rows) {
    if (row.verdict === "ELIGIBLE") {
      eligible += 1;
      eligibleBasis += BigInt(row.basisRaw);
    } else if (row.verdict === "REVIEW") {
      review += 1;
      reviewBasis += BigInt(row.basisRaw);
    } else excluded += 1;
  }
  return Object.freeze({ eligible, review, excluded, eligibleBasisRaw: eligibleBasis.toString(), reviewBasisRaw: reviewBasis.toString() });
}

/* ------------------------------------------------------------ the arithmetic */

export const CALCULATION_MODES = ["equal", "proRata", "tiered"] as const;
export type CalculationMode = (typeof CALCULATION_MODES)[number];

/** A band of a tiered campaign: everyone holding at least `fromRaw` has this weight. Bands are read largest first. */
export type Tier = Readonly<{ fromRaw: string; weight: number }>;

export type AllocationRules = Readonly<{
  mode: CalculationMode;
  /** Everything the campaign divides, raw. */
  potRaw: string;
  /** The most one wallet takes, raw; null — no cap. */
  capPerWalletRaw: string | null;
  /** Below this a wallet is not paid at all — rent and fees would cost more than the allocation is worth. */
  floorPerWalletRaw: string;
  /** The most wallets one campaign's list holds; a root escrow is bounded by its own `max_escrow`. */
  maxWallets: number;
  tiers: readonly Tier[];
}>;

export const ALLOCATION_PROBLEMS = ["POT_EMPTY", "NOT_AN_AMOUNT", "CAP_BELOW_FLOOR", "NO_WALLETS", "TOO_MANY_WALLETS", "TIERS_MISSING", "TIER_WEIGHT", "TIER_REPEATED"] as const;
export type CalculationProblem = (typeof ALLOCATION_PROBLEMS)[number];

/** What breaks the arithmetic before it is run, each once; empty when it holds. */
export function calculationProblems(rules: AllocationRules, wallets: number): readonly CalculationProblem[] {
  const problems = new Set<CalculationProblem>();
  const pot = amount(rules.potRaw);
  const floor = amount(rules.floorPerWalletRaw);
  const cap = rules.capPerWalletRaw === null ? null : amount(rules.capPerWalletRaw);
  if (pot === null || floor === null || (rules.capPerWalletRaw !== null && cap === null)) problems.add("NOT_AN_AMOUNT");
  if (pot !== null && pot <= 0n) problems.add("POT_EMPTY");
  if (cap !== null && floor !== null && cap < floor) problems.add("CAP_BELOW_FLOOR");
  if (wallets <= 0) problems.add("NO_WALLETS");
  if (!Number.isInteger(rules.maxWallets) || rules.maxWallets <= 0 || wallets > rules.maxWallets) problems.add("TOO_MANY_WALLETS");
  if (rules.mode === "tiered") {
    if (!rules.tiers.length) problems.add("TIERS_MISSING");
    const seen = new Set<string>();
    for (const tier of rules.tiers) {
      if (amount(tier.fromRaw) === null) problems.add("NOT_AN_AMOUNT");
      if (!Number.isInteger(tier.weight) || tier.weight <= 0) problems.add("TIER_WEIGHT");
      if (seen.has(tier.fromRaw)) problems.add("TIER_REPEATED");
      seen.add(tier.fromRaw);
    }
  }
  return [...problems];
}

export type AllocationRow = Readonly<{ wallet: string; basisRaw: string; amountRaw: string }>;

export type Allocations = Readonly<{
  rows: readonly AllocationRow[];
  /** What the rows add up to, and what the pot keeps — the leftover stays with the campaign's owner. */
  totalRaw: string;
  leftoverRaw: string;
  /** Wallets whose share fell below the floor and are not in the list. */
  belowFloor: number;
}>;

/** The weight of one wallet: one for `equal`, its basis for `proRata`, its band's weight for `tiered`. */
function weightOf(row: Pick<EligibilityRow, "basisRaw">, rules: AllocationRules): bigint {
  if (rules.mode === "equal") return 1n;
  if (rules.mode === "proRata") return BigInt(row.basisRaw);
  const basis = BigInt(row.basisRaw);
  const bands = [...rules.tiers].sort((a, b) => (BigInt(b.fromRaw) > BigInt(a.fromRaw) ? 1 : BigInt(b.fromRaw) < BigInt(a.fromRaw) ? -1 : 0));
  const band = bands.find((tier) => basis >= BigInt(tier.fromRaw));
  return band ? BigInt(band.weight) : 0n;
}

/**
 * The pot divided over the rows by the campaign's mode, whole base units, the largest remainder taking the odd unit so
 * that the rows add up to the pot itself. A cap holds a wallet down and a floor drops one out; what either leaves
 * unspent is leftover and stays with the owner — the cap a reader saw is not rebated to the other wallets.
 */
export function distributionAllocations(rows: readonly Pick<EligibilityRow, "wallet" | "basisRaw">[], rules: AllocationRules): Allocations {
  const pot = BigInt(rules.potRaw);
  const floor = BigInt(rules.floorPerWalletRaw);
  const cap = rules.capPerWalletRaw === null ? null : BigInt(rules.capPerWalletRaw);
  const weights = rows.map((row) => ({ row, weight: weightOf(row, rules) }));
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0n);
  if (pot <= 0n || total <= 0n) return Object.freeze({ rows: Object.freeze([]), totalRaw: "0", leftoverRaw: pot > 0n ? pot.toString() : "0", belowFloor: 0 });

  const shares = weights.map((entry) => {
    const exact = pot * entry.weight;
    return { row: entry.row, units: exact / total, remainder: exact % total };
  });
  /* The odd units: largest remainder first, ties to the row written first, so one list always gives one answer. */
  let left = pot - shares.reduce((sum, share) => sum + share.units, 0n);
  const order = [...shares.keys()].sort((a, b) => {
    const diff = shares[b]!.remainder - shares[a]!.remainder;
    return diff > 0n ? 1 : diff < 0n ? -1 : a - b;
  });
  for (const index of order) {
    if (left <= 0n) break;
    shares[index]!.units += 1n;
    left -= 1n;
  }

  const out: AllocationRow[] = [];
  let paid = 0n;
  let belowFloor = 0;
  for (const share of shares) {
    const capped = cap !== null && share.units > cap ? cap : share.units;
    if (capped < floor || capped <= 0n) {
      if (share.units > 0n) belowFloor += 1;
      continue;
    }
    out.push({ wallet: share.row.wallet, basisRaw: share.row.basisRaw, amountRaw: capped.toString() });
    paid += capped;
  }
  return Object.freeze({ rows: Object.freeze(out), totalRaw: paid.toString(), leftoverRaw: (pot - paid).toString(), belowFloor });
}
