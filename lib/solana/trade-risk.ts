/**
 * The risk verdict a trade is judged by before anyone signs it — every trade,
 * not only a swap.
 *
 * The swap card has carried a verdict over the token a person would receive
 * since the thirteen-rule review (`policy.ts`) was written: four words, with
 * `NO_KNOWN_BLOCKER` at the bottom and no word for "safe" anywhere in them.
 * This module is that same vocabulary, widened to the thirteen facts the
 * specification asks a trade to be judged by (§12.3) and shaped so a spot
 * order, a perpetual, a launch purchase and a swap all reach it the same way.
 * It does not replace the review: where the caller holds one, its refusals are
 * folded in and named, so a token the review blocks is blocked here too.
 *
 * Four states, aggregated with a written precedence rather than a judgement:
 *
 *   BLOCKED  >  INCOMPLETE  >  REVIEW_REQUIRED  >  NO_KNOWN_BLOCKER
 *
 * A refusal outranks missing evidence — what is forbidden stays forbidden
 * whatever else is unknown — and missing evidence outranks "a person should
 * look", because looking presumes there is a whole picture to look at. The
 * bottom of the ladder reports the absence of known blockers and nothing more.
 * It is not "safe", it is not a recommendation, and no caller may render it as
 * one.
 *
 * There is no score. A trade's state comes from named facts, each one carrying
 * the source that produced it and the time it was read, and a person reading a
 * Review can see which fact put it where it is. The thresholds a few of those
 * facts compare against are written out in `TRADE_RISK_LIMITS` and travel
 * inside the verdict, so a number that moved a state is never invisible.
 *
 * What is not read is never filled in. A gateway that is silent, a family the
 * chain would not serve, a quote with no time on it — each is `INCOMPLETE`
 * with the missing thing named, and the verdict as a whole is `INCOMPLETE`.
 * Silence is not `NO_KNOWN_BLOCKER`.
 *
 * It performs no network call, holds no key and signs nothing.
 */

import { z } from "zod";

import { HONEST_STATES } from "../core/authority-matrix.ts";
import type { SolanaPolicyVerdict } from "./contracts.ts";
import type { TokenRiskFacts, TokenRiskReading } from "./risk-facts.ts";

/**
 * The two word lists of the review over a mint (`contracts.ts`), written out
 * here rather than imported: this module is read by the published contract,
 * which is read in a browser, and importing them would pull an RPC client into
 * that bundle for four words. A test asserts the two sides are the same lists,
 * so they cannot drift apart in silence.
 */
const POLICY_OUTCOMES = ["ALLOWED", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"] as const;
const POLICY_VERDICTS = ["NO_KNOWN_BLOCKER", "REVIEW_REQUIRED", "BLOCKED", "INCOMPLETE"] as const;
/** The networks a trade can be judged on, the same two the evidence layer reads. */
export const TRADE_RISK_NETWORKS = ["mainnet", "devnet"] as const;
export type TradeRiskNetwork = (typeof TRADE_RISK_NETWORKS)[number];

/** Which kind of trade is being judged. Every one of them is judged. */
export const TRADE_KINDS = ["SWAP", "SPOT_LIMIT", "PERP", "LAUNCH", "BRIDGE_SWAP"] as const;
export type TradeKind = (typeof TRADE_KINDS)[number];

/**
 * The thirteen facts of the specification's risk engine, in the order a Review
 * reads them: the token itself first, then the deal, then the venue, then who
 * stands behind the token, then what the person is allowed to spend.
 */
export const TRADE_RISK_FACTS = [
  "MINT_AND_PROGRAM",
  "TOKEN_EXTENSIONS",
  "MINT_AUTHORITY",
  "FREEZE_AUTHORITY",
  "TOKEN_RESTRICTIONS",
  "SLIPPAGE",
  "LIQUIDITY_PATH",
  "QUOTE_FRESHNESS",
  "VENUE_STATUS",
  "HOLDER_CONCENTRATION",
  "CREATOR_BEHAVIOUR",
  "RWA_ELIGIBILITY",
  "TRADE_BUDGET",
] as const;
export type TradeRiskFact = (typeof TRADE_RISK_FACTS)[number];

export { POLICY_OUTCOMES as TRADE_RISK_OUTCOMES, POLICY_VERDICTS as TRADE_RISK_VERDICTS };
export type TradeRiskOutcome = (typeof POLICY_OUTCOMES)[number];
export type TradeRiskState = (typeof POLICY_VERDICTS)[number];

/**
 * The thresholds the measured facts are read against. Each one is a decision
 * with a reason, written here once and carried inside every verdict — the
 * opposite of a single number that decides everything and explains nothing.
 */
export const TRADE_RISK_LIMITS = {
  /** Slippage a person is asked to look at: a tenth of a percent is noise, three percent is a decision. */
  slippageReviewBps: 300,
  /** Slippage that is no longer a price: a fifth of the quote may be lost on the fill. */
  slippageBlockBps: 2_000,
  /** How long a venue's quote is read as current; past it the Review says so rather than pretending. */
  quoteFreshSeconds: 30,
  /** How old the chain facts may be before the Review says they need re-reading. */
  factsFreshSeconds: 600,
  /** One plain account holding this much of the supply can move the price alone. */
  topPlainHolderReviewShare: 0.2,
  /** Five plain accounts holding this much between them is the same fact, spread. */
  topFivePlainHoldersReviewShare: 0.5,
  /** What the creator still holds of what they created. */
  creatorHoldsReviewShare: 0.1,
  /** A cut the mint itself takes from every transfer, in basis points. */
  transferFeeReviewBps: 100,
} as const;
export type TradeRiskLimits = typeof TRADE_RISK_LIMITS;

const Iso = z.string().datetime({ offset: true });
const Address = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

/** Where one fact came from, and when it was read. Both, always, or the fact is not a fact. */
export const TradeRiskSourceSchema = z
  .object({
    ref: z.string().min(1).max(128),
    label: z.string().min(1).max(256),
    readAt: Iso,
    /** The chain's own clock, where the source has one. */
    slot: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type TradeRiskSource = z.output<typeof TradeRiskSourceSchema>;

export const TradeRiskFindingSchema = z
  .object({
    fact: z.enum(TRADE_RISK_FACTS),
    outcome: z.enum(POLICY_OUTCOMES),
    detail: z.string().min(1).max(2_048),
    /** Null only where nothing was read: an `INCOMPLETE` has no source to name. */
    source: TradeRiskSourceSchema.nullable(),
    /** What exactly is missing, in the words a Review shows. Null unless `INCOMPLETE`. */
    missing: z.string().min(1).max(512).nullable(),
  })
  .strict();
export type TradeRiskFinding = z.output<typeof TradeRiskFindingSchema>;

export const TradeRiskVerdictSchema = z
  .object({
    schema: z.literal("ryntra.solana.trade-risk-verdict"),
    schemaVersion: z.literal("1.0.0"),
    trade: z
      .object({
        kind: z.enum(TRADE_KINDS),
        network: z.enum(TRADE_RISK_NETWORKS),
        /** The mint the person takes on, or puts at risk, in this trade. */
        mint: Address,
      })
      .strict(),
    verdict: z.enum(POLICY_VERDICTS),
    findings: z.array(TradeRiskFindingSchema).length(TRADE_RISK_FACTS.length),
    /** The thresholds this verdict read the measured facts against. */
    limits: z
      .object({
        slippageReviewBps: z.number().int().min(0).max(10_000),
        slippageBlockBps: z.number().int().min(0).max(10_000),
        quoteFreshSeconds: z.number().int().min(1),
        factsFreshSeconds: z.number().int().min(1),
        topPlainHolderReviewShare: z.number().min(0).max(1),
        topFivePlainHoldersReviewShare: z.number().min(0).max(1),
        creatorHoldsReviewShare: z.number().min(0).max(1),
        transferFeeReviewBps: z.number().int().min(0).max(10_000),
      })
      .strict(),
    evaluatedAt: Iso,
  })
  .strict();
export type TradeRiskVerdict = z.output<typeof TradeRiskVerdictSchema>;

/* ---------------------------------------------------------------- the inputs */

/** How a trade's price is bounded, where it is bounded at all. */
export type TradeRiskSlippage =
  | Readonly<{
      kind: "BOUNDED";
      /** What the venue labels. */
      statedBps: number;
      /** What the chain will enforce, worked out from the least the trade may receive; null where the caller has none. */
      enforcedBps: number | null;
      basis: string;
      source: TradeRiskSource;
    }>
  | Readonly<{
      /** An order that fills at its own price or not at all: there is no slippage to bound. */
      kind: "PRICE_IS_THE_LIMIT";
      basis: string;
      source: TradeRiskSource;
    }>;

/** The route the trade takes, as the venue resolved it. */
export type TradeRiskPath = Readonly<{
  hops: readonly Readonly<{ label: string; venue: string }>[];
  source: TradeRiskSource;
}>;

export type TradeRiskQuote = Readonly<{
  readAt: string;
  /** When the quote stops being the one that was judged; null where the venue states none. */
  expiresAt: string | null;
  source: TradeRiskSource;
}>;

export type TradeRiskVenue = Readonly<{
  id: string;
  label: string;
  status: (typeof HONEST_STATES)[number];
  /** The caller's own words for this venue's state — the lane it is on, the key it is using. */
  detail: string;
  source: TradeRiskSource;
}>;

/** What the person is allowed to spend on this trade, and whether this one fits. */
export const TRADE_BUDGET_STATES = ["WITHIN", "EXCEEDED", "NO_LIMIT_SET", "NOT_UNDER_A_LIMIT", "SPEND_UNKNOWN"] as const;
export type TradeBudgetState = (typeof TRADE_BUDGET_STATES)[number];

export type TradeRiskBudget = Readonly<{ state: TradeBudgetState; detail: string; source: TradeRiskSource }>;

/** Whether an issuer-backed token may be traded here at all. */
export const RWA_ELIGIBILITY_STATES = ["NOT_A_REAL_WORLD_ASSET", "OFFERED", "NOT_OFFERED", "ISSUER_WINDOW_CLOSED", "UNKNOWN"] as const;
export type RwaEligibilityState = (typeof RWA_ELIGIBILITY_STATES)[number];

export type TradeRiskRwa = Readonly<{ state: RwaEligibilityState; detail: string; source: TradeRiskSource }>;

/**
 * Everything one trade is judged on. Every field is nullable because a caller
 * that cannot read something says so and gets an `INCOMPLETE` naming it —
 * which is the whole point, and the reason nothing here carries a default.
 */
export type TradeRiskEvidence = Readonly<{
  trade: Readonly<{ kind: TradeKind; network: TradeRiskNetwork; mint: string }>;
  /** The token's chain facts, from the market-data gateway, or its silence. */
  chain: TokenRiskReading;
  /** The thirteen-rule review over the mint, where the caller built one. */
  assetReview: SolanaPolicyVerdict | null;
  slippage: TradeRiskSlippage | null;
  path: TradeRiskPath | null;
  quote: TradeRiskQuote | null;
  venue: TradeRiskVenue | null;
  budget: TradeRiskBudget | null;
  rwa: TradeRiskRwa | null;
}>;

/* ---------------------------------------------------------------- the reading */

const RANK: Readonly<Record<TradeRiskOutcome, number>> = { ALLOWED: 0, REVIEW_REQUIRED: 1, INCOMPLETE: 2, BLOCKED: 3 };

const worse = (a: TradeRiskOutcome, b: TradeRiskOutcome): TradeRiskOutcome => (RANK[b] > RANK[a] ? b : a);

/** A decimal share as the gateway writes it, or null — never 0, which would be a claim. */
function share(text: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

const pct = (value: number): string => `${(value * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

function seconds(from: string, now: Date): number | null {
  const at = Date.parse(from);
  return Number.isFinite(at) ? Math.max(0, Math.round((now.getTime() - at) / 1000)) : null;
}

function chainSource(facts: TokenRiskFacts, slot: number | null): TradeRiskSource {
  return {
    ref: facts.source.id,
    label: facts.source.label,
    readAt: new Date(facts.at).toISOString(),
    slot,
  };
}

/** Why the gateway could not read one family, in its own words, where it said. */
function notReadReason(facts: TokenRiskFacts, family: string): string | null {
  return facts.not_read.find((row) => row.fact === family || row.fact.startsWith(`${family}.`))?.why ?? null;
}

function finding(
  fact: TradeRiskFact,
  outcome: TradeRiskOutcome,
  detail: string,
  source: TradeRiskSource | null,
  missing: string | null = null,
): TradeRiskFinding {
  return { fact, outcome, detail, source, missing: outcome === "INCOMPLETE" ? (missing ?? detail) : null };
}

/** The one shape every unread fact takes: the name of what is missing, and no source. */
function unread(fact: TradeRiskFact, missing: string): TradeRiskFinding {
  return finding(fact, "INCOMPLETE", missing, null, missing);
}

/* ---------------------------------------------------------------- the facts */

function mintAndProgram(evidence: TradeRiskEvidence): TradeRiskFinding {
  const { chain, trade } = evidence;
  if (chain.state !== "READ") return unread("MINT_AND_PROGRAM", `The token's mint account was not read: ${chain.why}`);
  const facts = chain.facts;
  const source = chainSource(facts, facts.slots.mint_account);
  if (!facts.mint_account) {
    return unread(
      "MINT_AND_PROGRAM",
      `${trade.mint} did not read as a mint account of either token program, so nothing else about the token stands either.`,
    );
  }
  const account = facts.mint_account;
  return finding(
    "MINT_AND_PROGRAM",
    "ALLOWED",
    `The mint is an account of ${account.program} (${account.program_id}) with ${account.decimals} decimals and a supply of ${account.supply} in its own smallest units.`,
    source,
  );
}

function tokenExtensions(evidence: TradeRiskEvidence): TradeRiskFinding {
  const { chain } = evidence;
  if (chain.state !== "READ") return unread("TOKEN_EXTENSIONS", `The mint's Token-2022 extensions were not read: ${chain.why}`);
  const facts = chain.facts;
  const source = chainSource(facts, facts.slots.mint_account);
  if (!facts.mint_account) return unread("TOKEN_EXTENSIONS", "The mint account did not read, so its extensions were not read either.");
  const extensions = facts.mint_account.extensions;
  if (facts.mint_account.program === "spl-token") {
    return finding("TOKEN_EXTENSIONS", "ALLOWED", "The mint belongs to the original token program, which has no extensions to carry.", source);
  }
  if (extensions.length === 0) {
    return finding("TOKEN_EXTENSIONS", "ALLOWED", "The Token-2022 mint carries no extensions, so a transfer of it does only what a transfer does.", source);
  }
  return finding(
    "TOKEN_EXTENSIONS",
    "REVIEW_REQUIRED",
    `The Token-2022 mint carries ${extensions.length} extension${extensions.length === 1 ? "" : "s"} — ${extensions.join(", ")} — and each of them changes what a transfer of this token does.`,
    source,
  );
}

function mintAuthority(evidence: TradeRiskEvidence): TradeRiskFinding {
  const { chain } = evidence;
  if (chain.state !== "READ") return unread("MINT_AUTHORITY", `Who may still mint more of the token was not read: ${chain.why}`);
  const facts = chain.facts;
  const source = chainSource(facts, facts.slots.mint_account);
  if (!facts.mint_account) return unread("MINT_AUTHORITY", "The mint account did not read, so its mint authority was not read either.");
  const authority = facts.mint_account.mint_authority;
  return authority === null
    ? finding("MINT_AUTHORITY", "ALLOWED", "Nobody can mint more of this token: the mint authority is gone and the supply is fixed.", source)
    : finding(
        "MINT_AUTHORITY",
        "REVIEW_REQUIRED",
        `${authority} may still mint more of this token, so the supply behind your holding can grow after you buy.`,
        source,
      );
}

function freezeAuthority(evidence: TradeRiskEvidence): TradeRiskFinding {
  const { chain } = evidence;
  if (chain.state !== "READ") return unread("FREEZE_AUTHORITY", `Who may freeze holders' accounts was not read: ${chain.why}`);
  const facts = chain.facts;
  const source = chainSource(facts, facts.slots.mint_account);
  if (!facts.mint_account) return unread("FREEZE_AUTHORITY", "The mint account did not read, so its freeze authority was not read either.");
  const account = facts.mint_account;
  /* Accounts that start frozen are a stopped transfer, not a power someone
     holds: a buyer receives tokens into an account the freeze authority must
     thaw before they can move them. That is a refusal, and it is named here
     beside the authority that caused it. */
  if (account.new_accounts_frozen === true) {
    return finding(
      "FREEZE_AUTHORITY",
      "BLOCKED",
      `New accounts of this mint start frozen${account.freeze_authority ? ` and only ${account.freeze_authority} can thaw them` : ""}: tokens bought now may land where you cannot move them.`,
      source,
    );
  }
  return account.freeze_authority === null
    ? finding("FREEZE_AUTHORITY", "ALLOWED", "Nobody can freeze a holder's account of this token: the freeze authority is gone.", source)
    : finding(
        "FREEZE_AUTHORITY",
        "REVIEW_REQUIRED",
        `${account.freeze_authority} can freeze any holder's account of this token, this one included, and a frozen account cannot sell.`,
        source,
      );
}

function tokenRestrictions(evidence: TradeRiskEvidence): TradeRiskFinding {
  const { chain } = evidence;
  if (chain.state !== "READ") return unread("TOKEN_RESTRICTIONS", `What the mint itself does to a transfer was not read: ${chain.why}`);
  const facts = chain.facts;
  const source = chainSource(facts, facts.slots.mint_account);
  if (!facts.mint_account) return unread("TOKEN_RESTRICTIONS", "The mint account did not read, so its restrictions on a transfer were not read either.");
  const account = facts.mint_account;
  const blockers: string[] = [];
  const looks: string[] = [];
  if (account.non_transferable) blockers.push("the mint is non-transferable, so a trade of it cannot exist");
  if (account.pausable?.paused === true) blockers.push("transfers of this token are paused right now, for every holder");
  if (account.pausable?.paused === null) looks.push("the mint can be paused, and whether it is paused now did not read");
  if (account.permanent_delegate) {
    looks.push(`${account.permanent_delegate} may move or burn any holder's balance without their signature (permanent delegate)`);
  }
  if (account.transfer_hook) looks.push(`every transfer calls the program ${account.transfer_hook.program}, which can make it fail`);
  const fee = account.transfer_fee?.in_force ?? null;
  if (fee && fee.fee_bps >= TRADE_RISK_LIMITS.transferFeeReviewBps) {
    looks.push(`the mint takes ${fee.fee_bps} bps of every transfer, over the ${TRADE_RISK_LIMITS.transferFeeReviewBps} bps this Review reads without comment`);
  }
  if (account.transfer_fee && account.transfer_fee.in_force === null) {
    return finding(
      "TOKEN_RESTRICTIONS",
      "INCOMPLETE",
      `The mint charges a fee on every transfer and which of its two fees is in force did not read${account.transfer_fee.in_force_why ? `: ${account.transfer_fee.in_force_why}` : ""}.`,
      source,
      "which transfer fee this mint charges now",
    );
  }
  if (blockers.length > 0) return finding("TOKEN_RESTRICTIONS", "BLOCKED", `${blockers.join("; ")}.`, source);
  if (looks.length > 0) return finding("TOKEN_RESTRICTIONS", "REVIEW_REQUIRED", `${looks.join("; ")}.`, source);
  return finding("TOKEN_RESTRICTIONS", "ALLOWED", "The mint's own configuration neither stops a transfer of this token nor takes a cut of one.", source);
}

function slippage(evidence: TradeRiskEvidence): TradeRiskFinding {
  const stated = evidence.slippage;
  if (!stated) return unread("SLIPPAGE", "How much this trade's price may move against you was not read from the venue's quote.");
  if (stated.kind === "PRICE_IS_THE_LIMIT") {
    return finding("SLIPPAGE", "ALLOWED", `This order fills at its own price or not at all, so no slippage is taken: ${stated.basis}`, stated.source);
  }
  /*
   * The number that decides what may be lost is the least the trade may
   * receive, which the chain enforces — not the figure the venue labels. Where
   * the two disagree the wider one governs, so a quote that under-labels buys
   * nothing.
   */
  const effective = stated.enforcedBps === null ? stated.statedBps : Math.max(stated.statedBps, stated.enforcedBps);
  const disagrees = stated.enforcedBps !== null && Math.abs(stated.enforcedBps - stated.statedBps) > 1;
  if (effective >= TRADE_RISK_LIMITS.slippageBlockBps) {
    return finding(
      "SLIPPAGE",
      "BLOCKED",
      `This trade allows ${effective} bps between the quote and the least it may receive — at or over the ${TRADE_RISK_LIMITS.slippageBlockBps} bps at which a quote stops being a price. ${stated.basis}`,
      stated.source,
    );
  }
  if (stated.enforcedBps === null) {
    return finding(
      "SLIPPAGE",
      "INCOMPLETE",
      `The venue labels ${stated.statedBps} bps of slippage, and the least this trade may receive — the figure the chain enforces — did not read. ${stated.basis}`,
      stated.source,
      "the least this trade may receive",
    );
  }
  if (disagrees) {
    return finding(
      "SLIPPAGE",
      "REVIEW_REQUIRED",
      `The venue labels ${stated.statedBps} bps of slippage, while the least this trade may receive is ${stated.enforcedBps} bps below the quote. The wider of the two is what the chain enforces. ${stated.basis}`,
      stated.source,
    );
  }
  if (effective > TRADE_RISK_LIMITS.slippageReviewBps) {
    return finding(
      "SLIPPAGE",
      "REVIEW_REQUIRED",
      `This trade allows ${effective} bps between the quote and the least it may receive, over the ${TRADE_RISK_LIMITS.slippageReviewBps} bps this Review reads without comment. ${stated.basis}`,
      stated.source,
    );
  }
  return finding(
    "SLIPPAGE",
    "ALLOWED",
    `This trade allows ${effective} bps between the quote and the least it may receive, and the chain enforces that least. ${stated.basis}`,
    stated.source,
  );
}

function liquidityPath(evidence: TradeRiskEvidence): TradeRiskFinding {
  const path = evidence.path;
  if (!path) return unread("LIQUIDITY_PATH", "The route this trade would take through the market was not read.");
  if (path.hops.length === 0) {
    return unread("LIQUIDITY_PATH", "The venue named no leg for this trade, so the route it would take was not read.");
  }
  const legs = path.hops.map((hop) => `${hop.label} on ${hop.venue}`).join(" → ");
  const chain = evidence.chain;
  /* A token that has never left the curve it was launched on has one place to
     be sold, and that place belongs to its launchpad. The route is still
     named; what changes is whether a person should look at it. */
  if (chain.state === "READ" && chain.facts.pools.length > 0 && chain.facts.pools.every((pool) => pool.kind === "launchpad_account")) {
    return finding(
      "LIQUIDITY_PATH",
      "REVIEW_REQUIRED",
      `${legs}. Every account holding this token's liquidity belongs to its launchpad, so there is no pool of an exchange to sell it in yet.`,
      path.source,
    );
  }
  return finding("LIQUIDITY_PATH", "ALLOWED", `${legs}.`, path.source);
}

function quoteFreshness(evidence: TradeRiskEvidence, now: Date): TradeRiskFinding {
  const quote = evidence.quote;
  if (!quote) return unread("QUOTE_FRESHNESS", "The time this trade's quote was read did not arrive, so its freshness could not be established.");
  const age = seconds(quote.readAt, now);
  if (age === null) {
    return unread("QUOTE_FRESHNESS", "The trade's quote carries no readable time, so its freshness could not be established.");
  }
  const expires = quote.expiresAt === null ? null : Date.parse(quote.expiresAt);
  if (expires !== null && Number.isFinite(expires) && expires <= now.getTime()) {
    return finding(
      "QUOTE_FRESHNESS",
      "BLOCKED",
      `This quote's window closed ${Math.round((now.getTime() - expires) / 1000)}s ago: the numbers judged here are no longer the numbers you would trade on. Ask for a fresh quote.`,
      quote.source,
    );
  }
  if (age > TRADE_RISK_LIMITS.quoteFreshSeconds) {
    return finding(
      "QUOTE_FRESHNESS",
      "REVIEW_REQUIRED",
      `The quote was read ${age}s ago, past the ${TRADE_RISK_LIMITS.quoteFreshSeconds}s this Review reads as current${quote.expiresAt === null ? " and the venue states no expiry of its own" : ""}.`,
      quote.source,
    );
  }
  return finding("QUOTE_FRESHNESS", "ALLOWED", `The quote was read ${age}s ago, inside the ${TRADE_RISK_LIMITS.quoteFreshSeconds}s this Review reads as current.`, quote.source);
}

function venueStatus(evidence: TradeRiskEvidence): TradeRiskFinding {
  const venue = evidence.venue;
  if (!venue) return unread("VENUE_STATUS", "The state of the venue this trade would run on was not read.");
  switch (venue.status) {
    case "LIVE":
      return finding("VENUE_STATUS", "ALLOWED", `${venue.label} is live and taking this trade. ${venue.detail}`, venue.source);
    case "PAPER":
    case "PREVIEW":
      return finding(
        "VENUE_STATUS",
        "REVIEW_REQUIRED",
        `${venue.label} is ${venue.status === "PAPER" ? "on paper" : "a preview"}: nothing here settles on the network. ${venue.detail}`,
        venue.source,
      );
    case "RECOVERY":
      return finding(
        "VENUE_STATUS",
        "REVIEW_REQUIRED",
        `${venue.label} is not on the lane it normally runs on, so a fill may be late or may not come at all. ${venue.detail}`,
        venue.source,
      );
    case "DISABLED":
    case "UNAVAILABLE":
      return finding(
        "VENUE_STATUS",
        "BLOCKED",
        `${venue.label} is ${venue.status === "DISABLED" ? "switched off on this deployment" : "not available right now"}, so this trade cannot run on it. ${venue.detail}`,
        venue.source,
      );
    default:
      return unread("VENUE_STATUS", `The state of ${venue.label} did not read, so whether it can take this trade is unknown. ${venue.detail}`);
  }
}

function holderConcentration(evidence: TradeRiskEvidence): TradeRiskFinding {
  const chain = evidence.chain;
  if (chain.state !== "READ") return unread("HOLDER_CONCENTRATION", `How much of the supply sits in few hands was not read: ${chain.why}`);
  const facts = chain.facts;
  const source = chainSource(facts, facts.slots.holders);
  if (!facts.holders) {
    const why = notReadReason(facts, "holders");
    return unread("HOLDER_CONCENTRATION", `The token's holders were not read${why ? `: ${why}` : "."}`);
  }
  const plain = facts.holders.concentration_plain_accounts;
  const top1 = share(plain.top1);
  const top5 = share(plain.top5);
  if (top1 === null || top5 === null) {
    return unread("HOLDER_CONCENTRATION", "The holders' shares did not read as figures, so the concentration was not established.");
  }
  /* The shares are over the accounts whose owner was read, so where the set is
     not complete every figure is a floor. Saying so is part of the fact: a
     floor read as a total would understate what one account can do. */
  const floor = plain.complete ? "" : ` These are shares over ${plain.over}, so each is a floor rather than the whole truth.`;
  if (top1 > TRADE_RISK_LIMITS.topPlainHolderReviewShare) {
    return finding(
      "HOLDER_CONCENTRATION",
      "REVIEW_REQUIRED",
      `The largest plain account holds ${pct(top1)} of the supply, over the ${pct(TRADE_RISK_LIMITS.topPlainHolderReviewShare)} this Review reads without comment, and a holding that size can move the price on its own.${floor}`,
      source,
    );
  }
  if (top5 > TRADE_RISK_LIMITS.topFivePlainHoldersReviewShare) {
    return finding(
      "HOLDER_CONCENTRATION",
      "REVIEW_REQUIRED",
      `The five largest plain accounts hold ${pct(top5)} of the supply between them, over the ${pct(TRADE_RISK_LIMITS.topFivePlainHoldersReviewShare)} this Review reads without comment.${floor}`,
      source,
    );
  }
  return finding(
    "HOLDER_CONCENTRATION",
    "ALLOWED",
    `The largest plain account holds ${pct(top1)} of the supply and the five largest ${pct(top5)} between them, under the ${pct(TRADE_RISK_LIMITS.topPlainHolderReviewShare)} and ${pct(TRADE_RISK_LIMITS.topFivePlainHoldersReviewShare)} this Review reads without comment.${floor}`,
    source,
  );
}

function creatorBehaviour(evidence: TradeRiskEvidence): TradeRiskFinding {
  const chain = evidence.chain;
  if (chain.state !== "READ") return unread("CREATOR_BEHAVIOUR", `Who created the token and what they still hold was not read: ${chain.why}`);
  const facts = chain.facts;
  const source = chainSource(facts, facts.slots.creator_holds ?? facts.slots.origin);
  const creator = facts.origin.creator;
  if (!creator) {
    const why = facts.origin.why ?? notReadReason(facts, "origin");
    return unread("CREATOR_BEHAVIOUR", `The account that paid to create this token was not read${why ? `: ${why}` : "."}`);
  }
  const where = facts.origin.launchpad ? ` on ${facts.origin.launchpad.name}` : facts.origin.created_by?.name ? ` through ${facts.origin.created_by.name}` : "";
  if (!facts.creator_holds) {
    const why = notReadReason(facts, "creator_holds");
    return unread(
      "CREATOR_BEHAVIOUR",
      `${creator.address} paid to create this token${where}, and what they hold of it now was not read${why ? `: ${why}` : "."}`,
    );
  }
  const held = share(facts.creator_holds.share);
  if (held === null) {
    return unread("CREATOR_BEHAVIOUR", `What ${creator.address} still holds of this token did not read as a figure, so it was not established.`);
  }
  if (held > TRADE_RISK_LIMITS.creatorHoldsReviewShare) {
    return finding(
      "CREATOR_BEHAVIOUR",
      "REVIEW_REQUIRED",
      `${creator.address} paid to create this token${where} and still holds ${pct(held)} of the supply — over the ${pct(TRADE_RISK_LIMITS.creatorHoldsReviewShare)} this Review reads without comment — counted over ${facts.creator_holds.basis}.`,
      source,
    );
  }
  return finding(
    "CREATOR_BEHAVIOUR",
    "ALLOWED",
    `${creator.address} paid to create this token${where} and holds ${pct(held)} of the supply now, counted over ${facts.creator_holds.basis}.`,
    source,
  );
}

function rwaEligibility(evidence: TradeRiskEvidence): TradeRiskFinding {
  const rwa = evidence.rwa;
  if (!rwa) return unread("RWA_ELIGIBILITY", "Whether an issuer stands behind this token, and whether it may be traded here, was not read.");
  switch (rwa.state) {
    case "NOT_A_REAL_WORLD_ASSET":
    case "OFFERED":
      return finding("RWA_ELIGIBILITY", "ALLOWED", rwa.detail, rwa.source);
    case "NOT_OFFERED":
    case "ISSUER_WINDOW_CLOSED":
      return finding("RWA_ELIGIBILITY", "BLOCKED", rwa.detail, rwa.source);
    default:
      return unread("RWA_ELIGIBILITY", rwa.detail);
  }
}

function tradeBudget(evidence: TradeRiskEvidence): TradeRiskFinding {
  const budget = evidence.budget;
  if (!budget) return unread("TRADE_BUDGET", "What this trade is allowed to spend was not read.");
  switch (budget.state) {
    case "WITHIN":
    case "NO_LIMIT_SET":
    case "NOT_UNDER_A_LIMIT":
      return finding("TRADE_BUDGET", "ALLOWED", budget.detail, budget.source);
    case "EXCEEDED":
      return finding("TRADE_BUDGET", "BLOCKED", budget.detail, budget.source);
    default:
      return unread("TRADE_BUDGET", budget.detail);
  }
}

/* ------------------------------------------------- the review over the mint */

/**
 * Which of this engine's facts each rule of the thirteen-rule review belongs
 * to. The review judges what receiving a token would subject any holder to;
 * every one of its rules lands on a fact here, so a refusal it reached cannot
 * go missing in a wider verdict.
 */
const REVIEW_RULE_FACT: Readonly<Record<SolanaPolicyVerdict["findings"][number]["rule"], TradeRiskFact>> = {
  NETWORK_ALLOWED: "MINT_AND_PROGRAM",
  MINT_ALLOWED: "MINT_AND_PROGRAM",
  TOKEN_PROGRAM_ALLOWED: "MINT_AND_PROGRAM",
  NOT_STRUCTURALLY_DOOMED: "TOKEN_RESTRICTIONS",
  PERMANENT_DELEGATE_ACCEPTED: "TOKEN_RESTRICTIONS",
  TRANSFER_HOOK_ALLOWLISTED: "TOKEN_RESTRICTIONS",
  FEE_WITHIN_CAP: "TOKEN_RESTRICTIONS",
  RECIPIENT_ALLOWED: "TOKEN_RESTRICTIONS",
  AMOUNT_WITHIN_LIMIT: "TRADE_BUDGET",
  DEFAULT_FROZEN_ACCEPTED: "FREEZE_AUTHORITY",
  EVIDENCE_FRESH: "MINT_AND_PROGRAM",
  EXTENSIONS_UNDERSTOOD: "TOKEN_EXTENSIONS",
  HUMAN_APPROVAL: "TOKEN_RESTRICTIONS",
};

/**
 * Fold the review's own refusals into the facts. It is taken only where it is
 * worse than what the chain facts said: the review knows the product's policy,
 * which the chain does not, and the chain knows the holders and the creator,
 * which the review does not. Where it bites, it is named as the source — the
 * verdict then says in one line that the review, not the gateway, is what put
 * the fact there.
 */
function foldAssetReview(findings: readonly TradeRiskFinding[], review: SolanaPolicyVerdict): TradeRiskFinding[] {
  const source: TradeRiskSource = {
    ref: review.schema,
    label: "Ryntra · the review over the mint you would hold",
    readAt: new Date(Date.parse(review.evaluatedAt) || Date.now()).toISOString(),
    slot: null,
  };
  return findings.map((found) => {
    const rules = review.findings.filter((row) => REVIEW_RULE_FACT[row.rule] === found.fact && row.outcome !== "ALLOWED");
    if (rules.length === 0) return found;
    const hardest = rules.reduce<TradeRiskOutcome>((carried, row) => worse(carried, row.outcome), "ALLOWED");
    if (RANK[hardest] <= RANK[found.outcome]) return found;
    const said = rules.filter((row) => row.outcome === hardest).map((row) => row.detail).join(" ");
    return finding(
      found.fact,
      hardest,
      `${found.outcome === "ALLOWED" ? `${found.detail} ` : ""}The review over the mint you would hold returned ${hardest} here: ${said}`,
      source,
      hardest === "INCOMPLETE" ? said : null,
    );
  });
}

/* ---------------------------------------------------------------- the verdict */

/**
 * Judge one trade. The same four words whatever the trade is, and the same
 * precedence over the same thirteen named facts — so a person who has read one
 * Review has read them all.
 */
export function evaluateTradeRisk(args: Readonly<{ evidence: TradeRiskEvidence; now?: Date }>): TradeRiskVerdict {
  const { evidence } = args;
  const now = args.now ?? new Date();

  let findings: TradeRiskFinding[] = [
    mintAndProgram(evidence),
    tokenExtensions(evidence),
    mintAuthority(evidence),
    freezeAuthority(evidence),
    tokenRestrictions(evidence),
    slippage(evidence),
    liquidityPath(evidence),
    quoteFreshness(evidence, now),
    venueStatus(evidence),
    holderConcentration(evidence),
    creatorBehaviour(evidence),
    rwaEligibility(evidence),
    tradeBudget(evidence),
  ];
  if (evidence.assetReview) findings = foldAssetReview(findings, evidence.assetReview);

  /*
   * The chain facts can be read and still be too old to decide on. The age is
   * a fact of its own rather than a fourteenth row: it bears on every family
   * the gateway served, so it is read against each of them and leaves the
   * facts that came from elsewhere alone.
   */
  const chain = evidence.chain;
  if (chain.state === "READ") {
    const chainRef = chain.facts.source.id;
    const age = seconds(new Date(chain.facts.at).toISOString(), now);
    if (age !== null && age > TRADE_RISK_LIMITS.factsFreshSeconds) {
      const stale = `The token's chain facts were read ${age}s ago, past the ${TRADE_RISK_LIMITS.factsFreshSeconds}s this Review reads as current; re-read the token before deciding.`;
      findings = findings.map((found) =>
        found.source !== null && found.source.ref === chainRef && found.outcome !== "BLOCKED"
          ? finding(found.fact, "INCOMPLETE", `${found.detail} ${stale}`, found.source, stale)
          : found,
      );
    }
  }

  const outcomes = new Set(findings.map((found) => found.outcome));
  const verdict: TradeRiskState = outcomes.has("BLOCKED")
    ? "BLOCKED"
    : outcomes.has("INCOMPLETE")
      ? "INCOMPLETE"
      : outcomes.has("REVIEW_REQUIRED")
        ? "REVIEW_REQUIRED"
        : "NO_KNOWN_BLOCKER";

  return TradeRiskVerdictSchema.parse({
    schema: "ryntra.solana.trade-risk-verdict",
    schemaVersion: "1.0.0",
    trade: { kind: evidence.trade.kind, network: evidence.trade.network, mint: evidence.trade.mint },
    verdict,
    findings,
    limits: TRADE_RISK_LIMITS,
    evaluatedAt: now.toISOString(),
  });
}
