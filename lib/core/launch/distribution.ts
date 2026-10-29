/**
 * «Кампанія розподілу» — a vesting or an airdrop campaign from its draft to its
 * report, with the claim in the recipient's own hands (spec §10.2–§10.5).
 *
 * The whole of it in one line: a campaign publishes a list and a root, locks
 * exactly what the list adds up to, and then does nothing — each recipient takes
 * their own allocation out of the program with their own signature. Ryntra holds
 * no key, the campaign's owner signs nothing at the moment of a payout, and a
 * repeated claim is impossible in the chain rather than in an interface
 * (`distribution-merkle.ts` says how).
 *
 * ## The eleven stages
 *
 * `DISTRIBUTION_STAGES` is spec §10.2's cycle, and a campaign is always at
 * exactly one of them: draft → snapshot → eligibility → calculation → review →
 * funding and lock → root → claim → reconcile → recover → report. The chain's
 * own order inside the sixth and seventh is the reverse of the words': the root
 * is written first (`create_root_escrow`) and the money follows
 * (`fund_root_escrow`), both in the one window the owner signs, because a root
 * escrow has nowhere to put money before it knows what it may ever pay.
 *
 * ## The protocol is the operator's, not this module's
 *
 * **Met Lock
 * holds all vesting, and Streamflow serves only the open community airdrop.**
 * `protocolFor` is that sentence as code and nothing more — vesting, a known
 * list, partners, milestones, Launch-to-Rewards and the Boost payout are Met
 * Lock; an open community campaign is Met Lock too unless it asks for the two
 * things Met Lock has no instruction for — an expiry with the remainder
 * returned, or an identity check — and only then is it Streamflow.
 *
 * The second protocol is **not open yet**, and this module says so rather than
 * pretending: the same report conditioned it on a lawyer's reading of a GPL/AGPL
 * SDK, on a decision about the audit of the version that carries those two
 * features, on its per-recipient service fee standing as its own row in the
 * Review, and on the chain's own answer about who may upgrade it
 * (`STREAMFLOW_MISSING`). A draft that needs it is refused with that list, so
 * nobody is told a campaign will expire when nothing would make it.
 *
 * ## What Met Lock cannot do, said out loud
 *
 * A root escrow has no expiry and no instruction that empties it. Two things
 * follow, and both are in the Review before a signature:
 * - a row nobody ever claims stays claimable for ever — unclaimed is not
 *   recovered, it is simply still theirs;
 * - **money funded above the list is stranded.** `fund_root_escrow` caps at the
 *   list's total, so a campaign cannot overpay by accident; but it also cannot
 *   take back what it put in, so the funding plan is the list and nothing more.
 * What can come back is the unvested part of an escrow that was already made,
 * and only where the campaign published that its owner may cancel
 * (`cancelMode`) — the recipient keeps everything that had vested by then.
 *
 * ## Launch-to-Rewards
 *
 * A share reserved before a launch becomes a live campaign only after a proven
 * exit to a DEX (spec §10.3): the curve's own migration read from the chain,
 * with the pool and the signature that moved it. A status, a plan or a full
 * curve is not an exit — `launchToRewardsGate` opens on the chain's answer or
 * says what is still missing.
 *
 * Pure and client-safe: no chain, no store, no network, no clock unless given.
 * The transactions and the reads are `../../launch/distribution.server.ts`.
 */

import { distributionAllocations, type AllocationRow, type AllocationRules, type EligibilityRow, type EligibilityRules, type SnapshotSpec } from "./distribution-audience.ts";
import { MET_LOCK_ACTOR_MODE, MET_LOCK_PROGRAM, U64_MAX, nodeEndsAt, nodeTotalRaw, unlockedRaw, type MetLockActor, type VestingNode } from "./distribution-merkle.ts";

export { MET_LOCK_PROGRAM };

const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const RAW = /^(0|[1-9][0-9]{0,29})$/;
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const amount = (raw: string): bigint | null => (typeof raw === "string" && RAW.test(raw) ? BigInt(raw) : null);

/* ------------------------------------------------------------ the cycle */

export const DISTRIBUTION_STAGES = [
  "draft",
  "snapshot",
  "eligibility",
  "calculation",
  "review",
  "funding",
  "root",
  "claim",
  "reconcile",
  "recover",
  "report",
] as const;
export type DistributionStage = (typeof DISTRIBUTION_STAGES)[number];

export const DISTRIBUTION_STAGE_NAMES: Readonly<Record<DistributionStage, Readonly<{ uk: string; en: string }>>> = Object.freeze({
  draft: { uk: "Чернетка", en: "Draft" },
  snapshot: { uk: "Знімок власників", en: "Snapshot" },
  eligibility: { uk: "Право на участь", en: "Eligibility" },
  calculation: { uk: "Розрахунок", en: "Calculation" },
  review: { uk: "Перевірка", en: "Review" },
  funding: { uk: "Фінансування й блокування", en: "Funding and lock" },
  root: { uk: "Корінь опубліковано", en: "Root published" },
  claim: { uk: "Claim", en: "Claim" },
  reconcile: { uk: "Звірка", en: "Reconcile" },
  recover: { uk: "Повернення залишків", en: "Recover leftovers" },
  report: { uk: "Звіт", en: "Report" },
});

export function stageAfter(stage: DistributionStage): DistributionStage | null {
  const at = DISTRIBUTION_STAGES.indexOf(stage);
  return at >= 0 && at + 1 < DISTRIBUTION_STAGES.length ? DISTRIBUTION_STAGES[at + 1]! : null;
}

/* ------------------------------------------------------------ the scenarios and the protocol */

/** Spec §10.1's scenarios, with §10.3's Launch-to-Rewards and the Boost payout the Meteora review moved here. */
export const DISTRIBUTION_SCENARIOS = [
  "communityAirdrop",
  "snapshotDrop",
  "loyaltyRewards",
  "teamVesting",
  "investorVesting",
  "merkleClaim",
  "milestone",
  "partnerRewards",
  "launchToRewards",
  "boostPayout",
] as const;
export type DistributionScenario = (typeof DISTRIBUTION_SCENARIOS)[number];

/** What a reader is told the campaign is. A key is an id for the code; a page and a report use these. */
export const DISTRIBUTION_SCENARIO_NAMES: Readonly<Record<DistributionScenario, Readonly<{ uk: string; en: string }>>> = Object.freeze({
  communityAirdrop: { uk: "Аірдроп громаді", en: "Community airdrop" },
  snapshotDrop: { uk: "Розподіл за знімком", en: "Snapshot drop" },
  loyaltyRewards: { uk: "Винагорода за вірність", en: "Loyalty rewards" },
  teamVesting: { uk: "Вестинг команди", en: "Team vesting" },
  investorVesting: { uk: "Вестинг інвесторів", en: "Investor vesting" },
  merkleClaim: { uk: "Claim за списком", en: "Merkle claim" },
  milestone: { uk: "Розподіл за етапами", en: "Milestone distribution" },
  partnerRewards: { uk: "Винагорода партнерам", en: "Partner rewards" },
  launchToRewards: { uk: "Від лаунчу до винагород", en: "Launch-to-Rewards" },
  boostPayout: { uk: "Виплата бонусу від творця", en: "Creator bonus payout" },
});

/** The open campaigns — a list of strangers — are the only ones a second protocol may ever serve. */
const OPEN_COMMUNITY: readonly DistributionScenario[] = Object.freeze(["communityAirdrop", "snapshotDrop", "loyaltyRewards"]);

/** Where a campaign's list comes from: a snapshot of the chain, or a list the campaign's owner writes. */
export const SNAPSHOT_SCENARIOS: readonly DistributionScenario[] = Object.freeze(["communityAirdrop", "snapshotDrop", "loyaltyRewards", "launchToRewards"]);

export function audienceOf(scenario: DistributionScenario): "snapshot" | "list" {
  return SNAPSHOT_SCENARIOS.includes(scenario) ? "snapshot" : "list";
}

export const DISTRIBUTION_PROTOCOLS = ["metLock", "streamflow"] as const;
export type DistributionProtocol = (typeof DISTRIBUTION_PROTOCOLS)[number];

export const PROTOCOL_REASONS = ["VESTING_IS_MET_LOCK", "KNOWN_LIST_IS_MET_LOCK", "OPEN_LIST_IS_MET_LOCK", "EXPIRY_NEEDS_STREAMFLOW", "KYC_NEEDS_STREAMFLOW"] as const;
export type ProtocolReason = (typeof PROTOCOL_REASONS)[number];

/** What the second protocol still waits for — the conditions the DROP-1 report put on variant А, not a wish list. */
export const STREAMFLOW_MISSING: readonly string[] = Object.freeze([
  "a lawyer's reading of the SDK's licence, or instructions written against the program's interface instead",
  "a decision on the audit of the program version that carries the expiry and the identity check",
  "the per-recipient service fee as its own row of the Review, beside the network's own cost",
  "who may upgrade the program, read from the chain",
  "one campaign through it on devnet with a Token-2022 token of ours",
]);

/** The environment key that would open it; it is not set anywhere, and until the list above is empty it must not be. */
export const STREAMFLOW_GATE_KEY = "RYNTRA_DISTRIBUTION_STREAMFLOW";

export type ProtocolChoice = Readonly<{
  protocol: DistributionProtocol;
  why: ProtocolReason;
  /** Whether this protocol may be used here and now. */
  open: boolean;
  missing: readonly string[];
}>;

/**
 * Which protocol a campaign runs on, by the operator's variant А. `needs`: whether the campaign asks for an expiry with
 * the remainder returned, and whether it asks for an identity check — the two things Met Lock has no instruction for.
 */
export function protocolFor(
  scenario: DistributionScenario,
  needs: Readonly<{ expiry: boolean; kyc: boolean }>,
  env: Readonly<Record<string, string | undefined>> = {},
): ProtocolChoice {
  const open = OPEN_COMMUNITY.includes(scenario);
  if (open && (needs.expiry || needs.kyc)) {
    const why: ProtocolReason = needs.expiry ? "EXPIRY_NEEDS_STREAMFLOW" : "KYC_NEEDS_STREAMFLOW";
    const allowed = env[STREAMFLOW_GATE_KEY] === "open" && STREAMFLOW_MISSING.length === 0;
    return Object.freeze({ protocol: "streamflow", why, open: allowed, missing: allowed ? Object.freeze([]) : STREAMFLOW_MISSING });
  }
  const why: ProtocolReason = open ? "OPEN_LIST_IS_MET_LOCK" : scenario === "teamVesting" || scenario === "investorVesting" ? "VESTING_IS_MET_LOCK" : "KNOWN_LIST_IS_MET_LOCK";
  return Object.freeze({ protocol: "metLock", why, open: true, missing: Object.freeze([]) });
}

/* ------------------------------------------------------------ the draft */

/** How one row unlocks: nothing before the cliff, then an equal share each period until the end. Both in whole days. */
export type VestingTerms = Readonly<{
  /** When the schedule starts counting, unix seconds. */
  startsAt: number;
  cliffDays: number;
  /** Everything is unlocked by this many days after the start; at most the cliff — everything at the cliff. */
  unlockDays: number;
  /** Hours between periods; ignored when nothing vests by periods. */
  periodHours: number;
}>;

/** Everything at once the moment the campaign opens — an airdrop's own schedule. */
export const AT_ONCE: Omit<VestingTerms, "startsAt"> = Object.freeze({ cliffDays: 0, unlockDays: 0, periodHours: 24 });

export type DistributionCurrency = Readonly<{ mint: string; decimals: number; symbol: string }>;

export type DistributionDraft = Readonly<{
  scenario: DistributionScenario;
  /** The launch this campaign belongs to. */
  token: string;
  /** Who owns the campaign — the creator's wallet, or the team's Squads treasury. */
  owner: string;
  /** Where the unvested part of a cancelled row goes back to; never a wallet of Ryntra's. */
  leftoverRecipient: string;
  /** What is distributed: the launched token, or the pair currency when a Boost payout is. */
  currency: DistributionCurrency;
  snapshot: SnapshotSpec | null;
  eligibility: EligibilityRules;
  calculation: AllocationRules;
  vesting: VestingTerms;
  /** Who may cancel a row's escrow afterwards and take the unvested part back. */
  cancel: MetLockActor;
  /** A claim window's end, unix seconds; Met Lock keeps none, so anything but null asks for the second protocol. */
  expiry: number | null;
  kyc: boolean;
  /** Launch-to-Rewards: the campaign waits for a proven exit to a DEX. */
  afterDex: boolean;
}>;

export const DISTRIBUTION_PROBLEMS = [
  "TOKEN_NOT_AN_ADDRESS",
  "OWNER_NOT_AN_ADDRESS",
  "LEFTOVER_NOT_AN_ADDRESS",
  "LEFTOVER_IS_RYNTRA",
  "CURRENCY_NOT_AN_ADDRESS",
  "DECIMALS_OUT_OF_BOUNDS",
  "SNAPSHOT_MISSING",
  "SNAPSHOT_NOT_FINAL",
  "VESTING_NOT_WHOLE",
  "VESTING_TOO_LONG",
  "CLIFF_AFTER_UNLOCK",
  "PERIOD_OUT_OF_BOUNDS",
  "CANCEL_UNKNOWN",
  "EXPIRY_IN_PAST",
  "EXPIRY_NOT_ENFORCED",
  "PROTOCOL_NOT_OPEN",
] as const;
export type DistributionProblem = (typeof DISTRIBUTION_PROBLEMS)[number];

/** Ten years, as the allocation step of a team's launch bounds a lock. */
export const VESTING_MAX_DAYS = 10 * 365;

/**
 * What breaks a draft, each once, before anything is counted; empty when it holds. `ryntra`: Ryntra's own wallets —
 * a campaign's leftovers never come to us. `now`: unix seconds.
 */
export function distributionProblems(
  draft: DistributionDraft,
  now: number,
  ryntra: ReadonlySet<string> = new Set(),
  env: Readonly<Record<string, string | undefined>> = {},
): readonly DistributionProblem[] {
  const problems = new Set<DistributionProblem>();
  if (!BASE58.test(draft.token)) problems.add("TOKEN_NOT_AN_ADDRESS");
  if (!BASE58.test(draft.owner)) problems.add("OWNER_NOT_AN_ADDRESS");
  if (!BASE58.test(draft.leftoverRecipient)) problems.add("LEFTOVER_NOT_AN_ADDRESS");
  else if (ryntra.has(draft.leftoverRecipient)) problems.add("LEFTOVER_IS_RYNTRA");
  if (!BASE58.test(draft.currency.mint)) problems.add("CURRENCY_NOT_AN_ADDRESS");
  if (!Number.isInteger(draft.currency.decimals) || draft.currency.decimals < 0 || draft.currency.decimals > 12) problems.add("DECIMALS_OUT_OF_BOUNDS");

  /* A campaign over a snapshot needs the snapshot, and a root is funded against a finalized slot: a confirmed one can
     still be rolled back, and then the list is a list of something that did not happen. */
  if (audienceOf(draft.scenario) === "snapshot" && !draft.snapshot) problems.add("SNAPSHOT_MISSING");
  if (draft.snapshot && draft.snapshot.finality !== "finalized") problems.add("SNAPSHOT_NOT_FINAL");

  const { cliffDays, unlockDays, periodHours, startsAt } = draft.vesting;
  if (!Number.isInteger(cliffDays) || !Number.isInteger(unlockDays) || !Number.isInteger(startsAt) || cliffDays < 0 || unlockDays < 0 || startsAt < 0) problems.add("VESTING_NOT_WHOLE");
  else {
    if (cliffDays > VESTING_MAX_DAYS || unlockDays > VESTING_MAX_DAYS) problems.add("VESTING_TOO_LONG");
    if (unlockDays > 0 && unlockDays < cliffDays) problems.add("CLIFF_AFTER_UNLOCK");
  }
  if (!Number.isFinite(periodHours) || periodHours <= 0 || periodHours > 24 * 366) problems.add("PERIOD_OUT_OF_BOUNDS");
  if (MET_LOCK_ACTOR_MODE[draft.cancel] === undefined) problems.add("CANCEL_UNKNOWN");
  if (draft.expiry !== null && (!Number.isInteger(draft.expiry) || draft.expiry <= now)) problems.add("EXPIRY_IN_PAST");
  const protocol = protocolFor(draft.scenario, { expiry: draft.expiry !== null, kyc: draft.kyc }, env);
  /* A window nothing closes is worse than no window: Met Lock has no instruction for one, so a campaign on it may not
     promise one — whatever an interface would have drawn. */
  if (draft.expiry !== null && protocol.protocol === "metLock") problems.add("EXPIRY_NOT_ENFORCED");
  if (!protocol.open) problems.add("PROTOCOL_NOT_OPEN");
  return [...problems];
}

/* ------------------------------------------------------------ the rows the chain takes */

/**
 * One allocation as a row of the tree: the schedule from the campaign's terms, the amount split into an equal share
 * per period with what does not divide unlocking at the cliff, so the escrow holds the allocation exactly. Nobody may
 * ever be swapped for the recipient (`updateRecipientMode` 0) — a campaign that could redirect a claim is not a claim.
 */
export function vestingNodeFor(row: Pick<AllocationRow, "wallet" | "amountRaw">, terms: VestingTerms, cancel: MetLockActor): VestingNode {
  const total = BigInt(row.amountRaw);
  const cliffTime = terms.startsAt + terms.cliffDays * DAY;
  const vestHours = Math.max(0, terms.unlockDays - terms.cliffDays) * 24;
  const periods = terms.unlockDays > terms.cliffDays ? Math.max(1, Math.floor(vestHours / terms.periodHours)) : 0;
  const perPeriod = periods > 0 ? total / BigInt(periods) : 0n;
  return Object.freeze({
    recipient: row.wallet,
    vestingStartTime: terms.startsAt,
    cliffTime,
    frequency: periods > 0 ? Math.round(terms.periodHours * HOUR) : 0,
    cliffUnlockRaw: (total - perPeriod * BigInt(periods)).toString(),
    amountPerPeriodRaw: perPeriod.toString(),
    numberOfPeriod: periods,
    updateRecipientMode: MET_LOCK_ACTOR_MODE.nobody,
    cancelMode: MET_LOCK_ACTOR_MODE[cancel],
  });
}

/** The campaign's whole list as rows of the tree, in the list's own order. */
export function vestingNodesFor(rows: readonly Pick<AllocationRow, "wallet" | "amountRaw">[], terms: VestingTerms, cancel: MetLockActor): readonly VestingNode[] {
  return Object.freeze(rows.map((row) => vestingNodeFor(row, terms, cancel)));
}

/* ------------------------------------------------------------ the Review */

/** Who pays what, each as its own row: the Review never adds a cost into a total a reader cannot take apart. */
export type DistributionFee = Readonly<{ what: string; payer: "owner" | "recipient"; amountRaw: string | null; currency: "token" | "sol" }>;

/** A statement and what makes it true: a program, or Ryntra's own server. The difference is the whole point of a Review. */
export type EnforcedFact = Readonly<{ fact: string; by: "program" | "ryntra" }>;

export const DISTRIBUTION_WARNINGS = [
  /** Met Lock has no instruction that empties a root escrow: anything funded above the list stays there for ever. */
  "OVERFUNDING_STRANDS",
  /** Met Lock keeps no claim window: a row nobody takes stays theirs, and the rent of its escrow with it. */
  "NO_EXPIRY",
  /** Rows waiting for a person are not in this root; they need a campaign of their own afterwards. */
  "REVIEW_HELD_BACK",
  /** The campaign waits for a proven exit to a DEX and cannot be funded before it. */
  "AFTER_DEX_WAITING",
  /** The owner may cancel a row and take its unvested part back; a reader must see that before they claim. */
  "OWNER_MAY_CANCEL",
  /** Some wallets' shares fell below the floor and are not in the list. */
  "BELOW_FLOOR_DROPPED",
] as const;
export type DistributionWarning = (typeof DISTRIBUTION_WARNINGS)[number];

/** The rent one escrow costs, in lamports as Met Lock's own accounts need it — the figure the DROP-1 report measured. */
export const ESCROW_RENT_LAMPORTS = 5_000_000;

export type DistributionReview = Readonly<{
  protocol: ProtocolChoice;
  /** The published root, and the two bounds the program will hold the campaign to for ever. */
  root: string | null;
  maxClaimAmountRaw: string;
  maxEscrow: number;
  /** What the list adds up to and what must therefore be funded — the same number, by construction. */
  allocatedRaw: string;
  fundingRaw: string;
  /** What the pot keeps because of a cap or a floor: it stays with the owner and was never funded. */
  leftoverRaw: string;
  wallets: number;
  fees: readonly DistributionFee[];
  enforced: readonly EnforcedFact[];
  warnings: readonly DistributionWarning[];
}>;

/**
 * The Review the owner reads before the one signature that writes the root and locks the money. `heldBack`: how many
 * rows wait for a person; `belowFloor`: how many shares were too small to pay.
 */
export function distributionReview(
  draft: DistributionDraft,
  nodes: readonly VestingNode[],
  totals: Readonly<{ root: string | null; maxClaimAmountRaw: string; maxEscrow: number; leftoverRaw: string; heldBack: number; belowFloor: number }>,
  env: Readonly<Record<string, string | undefined>> = {},
): DistributionReview {
  const protocol = protocolFor(draft.scenario, { expiry: draft.expiry !== null, kyc: draft.kyc }, env);
  const warnings = new Set<DistributionWarning>(["OVERFUNDING_STRANDS", "NO_EXPIRY"]);
  if (totals.heldBack > 0) warnings.add("REVIEW_HELD_BACK");
  if (totals.belowFloor > 0) warnings.add("BELOW_FLOOR_DROPPED");
  if (draft.cancel === "owner" || draft.cancel === "either") warnings.add("OWNER_MAY_CANCEL");
  if (draft.afterDex) warnings.add("AFTER_DEX_WAITING");

  const fees: DistributionFee[] = [
    { what: "Ryntra's own fee for a campaign", payer: "owner", amountRaw: "0", currency: "token" },
    { what: "Met Lock's own fee for a campaign", payer: "owner", amountRaw: "0", currency: "token" },
    { what: "the rent of one escrow, paid by whoever creates it — the recipient when they take their own", payer: "recipient", amountRaw: String(ESCROW_RENT_LAMPORTS), currency: "sol" },
    { what: "the network's fee for the claim's own transaction", payer: "recipient", amountRaw: null, currency: "sol" },
  ];

  const enforced: EnforcedFact[] = [
    { fact: "a second claim of the same row cannot exist: its escrow is created, not written to", by: "program" },
    { fact: "only the recipient's own signature takes a row's money out", by: "program" },
    { fact: "the campaign can never pay more than the list it published, whatever is funded into it", by: "program" },
    { fact: "the root cannot be changed once it is written: the program has no instruction for it", by: "program" },
    { fact: "a row cannot be replayed with another amount or another cliff: its own hash commits to the whole schedule", by: "program" },
    { fact: "the snapshot can be taken again at the same slot and give the same digest", by: "ryntra" },
    { fact: "a wallet whose protection case is open is held back, and nothing is taken from it", by: "ryntra" },
    { fact: draft.cancel === "nobody" ? "nobody may cancel a row once it exists — not the owner, not Ryntra" : "the owner may cancel a row and take back only what has not vested", by: "program" },
  ];

  return Object.freeze({
    protocol,
    root: totals.root,
    maxClaimAmountRaw: totals.maxClaimAmountRaw,
    maxEscrow: totals.maxEscrow,
    allocatedRaw: nodes.reduce((sum, node) => sum + nodeTotalRaw(node), 0n).toString(),
    fundingRaw: totals.maxClaimAmountRaw,
    leftoverRaw: totals.leftoverRaw,
    wallets: nodes.length,
    fees: Object.freeze(fees),
    enforced: Object.freeze(enforced),
    warnings: Object.freeze(DISTRIBUTION_WARNINGS.filter((warning) => warnings.has(warning))),
  });
}

/* ------------------------------------------------------------ Launch-to-Rewards */

export const AFTER_DEX_REASONS = ["OPEN", "NOT_MIGRATED", "NO_SIGNATURE", "NOT_READ"] as const;
export type AfterDexReason = (typeof AFTER_DEX_REASONS)[number];

/**
 * Whether a campaign that waits for the token's exit to a DEX may open. The exit has to be the chain's own answer: the
 * curve migrated, the pool it migrated into, and the signature that moved it. A read that failed is `NOT_READ` and the
 * gate stays shut — an unread chain is never a yes.
 */
export function launchToRewardsGate(
  exit: Readonly<{ read: boolean; migrated: boolean; pool: string | null; graduation: Readonly<{ signature: string; at: number }> | null }> | null,
): Readonly<{ open: boolean; reason: AfterDexReason; at: number | null }> {
  if (!exit || !exit.read) return Object.freeze({ open: false, reason: "NOT_READ", at: null });
  if (!exit.migrated || !exit.pool) return Object.freeze({ open: false, reason: "NOT_MIGRATED", at: null });
  if (!exit.graduation) return Object.freeze({ open: false, reason: "NO_SIGNATURE", at: null });
  return Object.freeze({ open: true, reason: "OPEN", at: exit.graduation.at });
}

/* ------------------------------------------------------------ the Boost payout as a claim */

/**
 * A Boost campaign's counted payout as a distribution campaign's list (the Meteora review of 22.10): the holder takes
 * their bonus themselves, and the creator signs nothing at the moment of a payout. The schedule is everything at once
 * from the moment the budget unlocked, so a row is claimable as soon as its escrow exists.
 */
export function boostDistributionRows(payout: Readonly<{ rows: readonly Readonly<{ wallet: string; bonusRaw: string }>[] }>): readonly AllocationRow[] {
  return Object.freeze(payout.rows.filter((row) => BigInt(row.bonusRaw) > 0n).map((row) => Object.freeze({ wallet: row.wallet, basisRaw: row.bonusRaw, amountRaw: row.bonusRaw })));
}

/** A Boost payout's terms: nothing is held back, so the cliff is the unlock moment itself and nobody may cancel a row. */
export function boostDistributionTerms(unlocksAt: number): VestingTerms {
  return Object.freeze({ startsAt: unlocksAt, ...AT_ONCE });
}

/* ------------------------------------------------------------ the claim panel */

export const CLAIM_STATES = [
  /** This wallet is not in the published list. */
  "NOT_IN_LIST",
  /** In the list, but nothing has unlocked yet. */
  "WAITING",
  /** There is something to take now. */
  "CLAIMABLE",
  /** Some was taken, more will unlock. */
  "PARTLY_CLAIMED",
  /** Everything of this row has been taken. */
  "CLAIMED",
  /** The root is published but the escrow does not hold what the list promises: nothing is built. */
  "NOT_FUNDED",
  /** A protection case is open on this wallet: the row waits for a person, and can be argued. */
  "UNDER_REVIEW",
  /** The campaign waits for the token's proven exit to a DEX. */
  "AFTER_DEX",
  /** The campaign's owner cancelled this row: what had vested went to the recipient, the rest back. */
  "CANCELLED",
  /** A read of the chain failed: nothing above is stated as a figure. */
  "UNREAD",
] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];

/** One claim the chain recorded: what it moved and when. */
export type ClaimReceipt = Readonly<{ signature: string; amountRaw: string; at: number }>;

export type ClaimPanel = Readonly<{
  state: ClaimState;
  /** What the row is for in all, what has been taken, and what is still owed. */
  owedRaw: string | null;
  takenRaw: string | null;
  leftRaw: string | null;
  /** What can be taken right now. */
  claimableRaw: string | null;
  /** When more unlocks, and when the row finishes unlocking; null when nothing more will. */
  nextUnlockAt: number | null;
  endsAt: number | null;
  receipts: readonly ClaimReceipt[];
  /** Whether the row's escrow exists on chain — once it does, no second one can. */
  escrow: string | null;
}>;

/**
 * The claim panel for one wallet: what belongs to it, what it has taken and what is left, with the chain's own
 * receipts. `node` null — the wallet is not in the list; `funded` false — the escrow does not hold the list's promise
 * and nothing is offered; `read` false — nothing is stated. `now`: unix seconds.
 */
export function claimPanel(
  args: Readonly<{
    node: VestingNode | null;
    /** The row's escrow and what it has already paid, from the chain; null — no escrow exists yet. */
    escrow: Readonly<{ address: string; claimedRaw: string; cancelled: boolean }> | null;
    receipts: readonly ClaimReceipt[];
    read: boolean;
    funded: boolean;
    underReview: boolean;
    afterDex: boolean;
    now: number;
  }>,
): ClaimPanel {
  const empty = { owedRaw: null, takenRaw: null, leftRaw: null, claimableRaw: null, nextUnlockAt: null, endsAt: null, receipts: Object.freeze([]), escrow: null } as const;
  if (!args.read) return Object.freeze({ state: "UNREAD", ...empty });
  if (args.afterDex) return Object.freeze({ state: "AFTER_DEX", ...empty });
  if (args.underReview) return Object.freeze({ state: "UNDER_REVIEW", ...empty });
  if (!args.node) return Object.freeze({ state: "NOT_IN_LIST", ...empty });

  const owed = nodeTotalRaw(args.node);
  const taken = args.escrow ? BigInt(args.escrow.claimedRaw) : 0n;
  const left = owed > taken ? owed - taken : 0n;
  const unlocked = unlockedRaw(args.node, args.now);
  /* An escrow that does not hold the list's promise, or a row its owner cancelled, offers nothing now — the row is
     still owed, and the figures above say so, but there is nothing to build a claim against. */
  const claimable = args.funded && !args.escrow?.cancelled && unlocked > taken ? unlocked - taken : 0n;
  const ends = nodeEndsAt(args.node);
  const next = nextUnlockOf(args.node, args.now);

  const state: ClaimState = args.escrow?.cancelled
    ? "CANCELLED"
    : !args.funded
      ? "NOT_FUNDED"
      : left <= 0n
        ? "CLAIMED"
        : claimable > 0n
          ? taken > 0n
            ? "PARTLY_CLAIMED"
            : "CLAIMABLE"
          : taken > 0n
            ? "PARTLY_CLAIMED"
            : "WAITING";

  return Object.freeze({
    state,
    owedRaw: owed.toString(),
    takenRaw: taken.toString(),
    leftRaw: left.toString(),
    claimableRaw: claimable.toString(),
    nextUnlockAt: next,
    endsAt: ends,
    receipts: Object.freeze([...args.receipts].sort((a, b) => a.at - b.at)),
    escrow: args.escrow?.address ?? null,
  });
}

/** When the next part of a row unlocks; null once nothing more will. */
export function nextUnlockOf(node: VestingNode, at: number): number | null {
  if (at < node.cliffTime) return node.cliffTime;
  if (node.frequency === 0 || node.numberOfPeriod === 0) return null;
  const passed = Math.floor((at - node.cliffTime) / node.frequency);
  return passed >= node.numberOfPeriod ? null : node.cliffTime + (passed + 1) * node.frequency;
}

/* ------------------------------------------------------------ the reconciliation */

export const RECONCILE_STATES = ["OK", "UNDERFUNDED", "OVERFUNDED", "ROOT_MISMATCH", "ESCROW_OVERRUN", "NOT_READ"] as const;
export type ReconcileState = (typeof RECONCILE_STATES)[number];

export type Reconciliation = Readonly<{
  state: ReconcileState;
  /** What the chain says the root escrow holds, has made and has paid out. */
  fundedRaw: string | null;
  distributedRaw: string | null;
  escrowsMade: number | null;
  /** The list's own totals, for the same three. */
  listRaw: string;
  listWallets: number;
  /** What is in the escrow and not yet in anybody's row. */
  unassignedRaw: string | null;
}>;

/**
 * The chain against the list. `chain` null — not read, and nothing is claimed about it. The three ways it can disagree
 * are each their own answer: less funded than promised (claims would fail), more funded than the list (money that
 * cannot leave), a root that is not the published one (every proof of the list fails), or more escrows than the list
 * has rows (which the program's own `max_escrow` should have made impossible).
 */
export function distributionReconcile(
  list: Readonly<{ root: string; totalRaw: string; wallets: number }>,
  chain: Readonly<{ root: string; fundedRaw: string; distributedRaw: string; escrowsMade: number }> | null,
): Reconciliation {
  if (!chain) {
    return Object.freeze({ state: "NOT_READ", fundedRaw: null, distributedRaw: null, escrowsMade: null, listRaw: list.totalRaw, listWallets: list.wallets, unassignedRaw: null });
  }
  const funded = BigInt(chain.fundedRaw);
  const distributed = BigInt(chain.distributedRaw);
  const total = BigInt(list.totalRaw);
  const state: ReconcileState =
    chain.root !== list.root ? "ROOT_MISMATCH" : chain.escrowsMade > list.wallets ? "ESCROW_OVERRUN" : funded < total ? "UNDERFUNDED" : funded > total ? "OVERFUNDED" : "OK";
  return Object.freeze({
    state,
    fundedRaw: funded.toString(),
    distributedRaw: distributed.toString(),
    escrowsMade: chain.escrowsMade,
    listRaw: total.toString(),
    listWallets: list.wallets,
    unassignedRaw: (funded > distributed ? funded - distributed : 0n).toString(),
  });
}

/* ------------------------------------------------------------ what comes back */

export const LEFTOVER_KINDS = ["unspentPot", "cancelledUnvested", "strandedInRoot"] as const;
export type LeftoverKind = (typeof LEFTOVER_KINDS)[number];

export type LeftoverRow = Readonly<{
  kind: LeftoverKind;
  amountRaw: string;
  /** Whether it can come back at all, and what brings it. */
  recoverable: boolean;
  how: string;
}>;

/**
 * What a campaign has left and what of it can come back. Three kinds, and only two of them can:
 * - the pot a cap or a floor never spent — it was never funded, so it is simply still the owner's;
 * - the unvested part of rows the owner cancels, where the campaign published that they may;
 * - whatever was funded into the root escrow above the list — **nothing takes it out**, which is why the funding plan
 *   is the list and the Review says so before the signature.
 */
export function leftoverPlan(
  args: Readonly<{ unspentPotRaw: string; cancellableUnvestedRaw: string; strandedRaw: string; cancel: MetLockActor; leftoverRecipient: string }>,
): readonly LeftoverRow[] {
  const mayCancel = args.cancel === "owner" || args.cancel === "either";
  return Object.freeze([
    { kind: "unspentPot" as const, amountRaw: BigInt(args.unspentPotRaw).toString(), recoverable: true, how: `never funded: it stays with ${args.leftoverRecipient}` },
    {
      kind: "cancelledUnvested" as const,
      amountRaw: mayCancel ? BigInt(args.cancellableUnvestedRaw).toString() : "0",
      recoverable: mayCancel,
      how: mayCancel ? "the owner cancels a row: what has vested goes to the recipient, the rest to the owner" : "the campaign published that nobody may cancel a row",
    },
    {
      kind: "strandedInRoot" as const,
      amountRaw: BigInt(args.strandedRaw).toString(),
      recoverable: false,
      how: "Met Lock has no instruction that empties a root escrow: fund the list and nothing above it",
    },
  ]);
}

/* ------------------------------------------------------------ the report */

export type DistributionLocale = "uk" | "en";

/** A raw amount in whole units for reading: at most four decimals, rounded down, grouped as the reader's language does. */
export function formatAmount(raw: string | bigint, decimals: number, locale: DistributionLocale): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const scale = 10n ** BigInt(decimals);
  const shown = Math.min(decimals, 4);
  const fraction = decimals === 0 ? "" : ((value % scale) / 10n ** BigInt(decimals - shown)).toString().padStart(shown, "0").replace(/0+$/, "");
  const group = locale === "uk" ? " " : ",";
  const grouped = (value / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, group);
  return fraction ? `${grouped}${locale === "uk" ? "," : "."}${fraction}` : grouped;
}

const moment = (seconds: number) => `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** «1 гаманець · 2 гаманці · 5 гаманців»: the Ukrainian form a count takes, so a report reads as a person wrote it. */
function uaPlural(count: number, one: string, few: string, many: string): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return many;
  const last = count % 10;
  return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

const wallets = (count: number, locale: DistributionLocale) =>
  locale === "uk" ? `${count} ${uaPlural(count, "гаманець", "гаманці", "гаманців")}` : `${count} ${count === 1 ? "wallet" : "wallets"}`;

/**
 * The campaign's report, spec §10.2's last stage: what was promised, what was taken, what was not, and what of the rest
 * can come back — in plain words, with no promise the chain does not keep.
 */
export function distributionReportLines(
  args: Readonly<{
    draft: DistributionDraft;
    review: DistributionReview;
    reconcile: Reconciliation;
    leftovers: readonly LeftoverRow[];
    claimed: Readonly<{ wallets: number; amountRaw: string }>;
    at: number;
  }>,
  locale: DistributionLocale,
): readonly string[] {
  const { draft, review, reconcile } = args;
  const sum = (raw: string | null) => (raw === null ? (locale === "uk" ? "не прочитано" : "not read") : `${formatAmount(raw, draft.currency.decimals, locale)} ${draft.currency.symbol}`);
  const unclaimed = reconcile.distributedRaw === null ? null : (BigInt(review.maxClaimAmountRaw) - BigInt(args.claimed.amountRaw)).toString();
  const stranded = args.leftovers.find((row) => row.kind === "strandedInRoot")?.amountRaw ?? "0";
  if (locale === "uk") {
    return [
      `Кампанія «${DISTRIBUTION_SCENARIO_NAMES[draft.scenario][locale]}» на ${review.protocol.protocol === "metLock" ? "Met Lock" : "Streamflow"}: ${wallets(review.wallets, locale)}, ${sum(review.maxClaimAmountRaw)} у списку, корінь ${review.root ?? "не опубліковано"}.`,
      `Профінансовано ${sum(reconcile.fundedRaw)}, звірка — ${reconcile.state}. Забрали ${wallets(args.claimed.wallets, locale)} на ${sum(args.claimed.amountRaw)}; не забрано ${sum(unclaimed)}.`,
      `Не забране лишається за отримувачем: Met Lock не тримає строку claim, і повернути його кампанія не може. Застрягло в корені — ${sum(stranded)}.`,
      `Повторний claim неможливий у ланцюгу: ескроу рядка створюється, а не перезаписується, і забрати з нього може лише підпис самого отримувача. Звіт складено ${moment(args.at)}.`,
    ];
  }
  return [
    `Campaign «${DISTRIBUTION_SCENARIO_NAMES[draft.scenario][locale]}» on ${review.protocol.protocol === "metLock" ? "Met Lock" : "Streamflow"}: ${wallets(review.wallets, locale)}, ${sum(review.maxClaimAmountRaw)} in the list, root ${review.root ?? "not published"}.`,
    `Funded ${sum(reconcile.fundedRaw)}, reconciliation ${reconcile.state}. ${wallets(args.claimed.wallets, locale)} took ${sum(args.claimed.amountRaw)}; ${sum(unclaimed)} was not taken.`,
    `What was not taken stays the recipient's: Met Lock keeps no claim window, and the campaign cannot take it back. Stranded in the root escrow — ${sum(stranded)}.`,
    `A repeated claim is impossible on chain: a row's escrow is created rather than written to, and only the recipient's own signature takes anything out of it. Report made ${moment(args.at)}.`,
  ];
}

/* ------------------------------------------------------------ the whole list in one call */

export type DistributionPlan = Readonly<{
  problems: readonly DistributionProblem[];
  rows: readonly AllocationRow[];
  nodes: readonly VestingNode[];
  leftoverRaw: string;
  belowFloor: number;
  heldBack: number;
}>;

/**
 * A draft and its eligibility rows into the list the chain will take: the pot divided, the rows that wait for a person
 * left out, and each allocation as a row of the tree. `now`: unix seconds.
 */
export function distributionPlan(
  draft: DistributionDraft,
  eligibility: readonly EligibilityRow[],
  now: number,
  ryntra: ReadonlySet<string> = new Set(),
  env: Readonly<Record<string, string | undefined>> = {},
): DistributionPlan {
  const problems = distributionProblems(draft, now, ryntra, env);
  const paying = eligibility.filter((row) => row.verdict === "ELIGIBLE");
  const heldBack = eligibility.filter((row) => row.verdict === "REVIEW").length;
  const allocations = distributionAllocations(paying, draft.calculation);
  return Object.freeze({
    problems,
    rows: allocations.rows,
    nodes: vestingNodesFor(allocations.rows, draft.vesting, draft.cancel),
    leftoverRaw: allocations.leftoverRaw,
    belowFloor: allocations.belowFloor,
    heldBack,
  });
}

/** Whether every amount of a plan fits what the program stores. */
export function planFitsU64(plan: Pick<DistributionPlan, "nodes">): boolean {
  return plan.nodes.reduce((sum, node) => sum + nodeTotalRaw(node), 0n) <= U64_MAX;
}

/** Whether a raw amount reads as one whole number of base units with one spelling. */
export function isRawAmount(text: string): boolean {
  return amount(text) !== null;
}
