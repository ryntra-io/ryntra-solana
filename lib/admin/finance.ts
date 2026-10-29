/**
 * Ryntra's financial panel (SOL-F1) — the projection. Pure and client-safe; the reads are `finance.server.ts`.
 *
 * Eight sums, each put beside the chain's own record of it, and the launch business's figures:
 *
 * - **earned** — Ryntra's part of every fee, as it accrues: on each launch the partner's part of the curve's fees, the
 *   referral Meteora pays on trades through Ryntra, the partner's migration fee, the surplus and the fees of the locked
 *   position — split into revenue and the market's budget by one rule (`../core/launch/revenue-rule.ts`, the DefiLlama
 *   adapter's too); and the terminal's own fee on Swap, Spot and stocks, as the operations ledger records it;
 * - **claimable** — what waits in Meteora's programs for Ryntra's claimer, and in the terminal's referral accounts;
 * - **claimed** — every claim of Ryntra's claimers the chain shows;
 * - **paid to creators** — what the creators' side took out, by the programs' own counters;
 * - **cashback** and **friends' rewards** — the reward ledger (read only, through `lib/rewards`), and its payouts;
 * - **costs** — the network fees Ryntra's wallets paid, and the growth budget's spending;
 * - **net** — revenue less cashback, friends' rewards and costs.
 *
 * How a sum is checked against the chain:
 * - a launch's curve — the swap events read one by one against Meteora's counter of the curve's trading fee; the
 *   claims seen against what the counter says was taken out; a flag that says «withdrawn» against its claim;
 * - Ryntra's records — the executor's claims into a market's budget, the trades sent through Ryntra, the creators'
 *   claims made through Ryntra, the terminal's collected fees, the reward payouts — each against its transaction;
 * - a figure that could not be read is `UNREAD` and a floor (`atLeast`), never a zero; a mismatch is a difference
 *   listed by name, never folded into a total quietly.
 *
 * Amounts are dollars: a launch's pair is USDC (six decimals, par); a pair that is not a dollar, and tokens, are
 * counted apart as not valued.
 */

import { INCOME_SOURCES, incomeSplit, type IncomeSource } from "../core/launch/revenue-rule.ts";
import type { CreatorFeesRead } from "../core/launch/creator-earnings.ts";
import { creatorGraduationFeeRaw, creatorSurplusRaw } from "../core/launch/creator-earnings.ts";
import type { BudgetSource } from "../core/launch/budget.ts";
import type { RewardEntry } from "../rewards/model.ts";
import { manualCostMicros, manualMonths, type ManualCostEntry, type ManualCostLine } from "./finance-manual.ts";
import { projectSuccess, type SuccessInputs, type SuccessModel } from "./success.ts";

/* ------------------------------------------------------------------ scope */

export const FINANCE_SCOPES = ["all", "external"] as const;
export type FinanceScope = (typeof FINANCE_SCOPES)[number];
export function isFinanceScope(value: unknown): value is FinanceScope {
  return typeof value === "string" && (FINANCE_SCOPES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ inputs */

export type FinanceTrade = Readonly<{
  signature: string;
  /** Unix seconds. */
  at: number;
  trader: string;
  venue: "curve" | "pool";
  /** Ryntra's part of the trade's fee as the swap event and the transaction show it; absent when not counted. */
  ryntraRaw?: string;
  /** The creator's part of a curve trade's trading fee; absent in the pool and where not counted. */
  creatorRaw?: string;
  /** Of `ryntraRaw`, the terminal's own fee in the same transaction — counted with the terminal's operations; absent when not counted. */
  ownRaw?: string;
  /** The creator, the wallets their buys paid for, Ryntra's own: a market's makers, not its traders. */
  maker: boolean;
}>;

export type FinanceClaimSource = BudgetSource;

/** One claim of the partner's role on a launch, as its transaction and the program's event state it. */
export type FinanceClaim = Readonly<{
  signature: string;
  at: string | null;
  source: FinanceClaimSource;
  /** The pair side the event reports; null when the event was not found. */
  pairRaw: string | null;
  tokenRaw: string | null;
}>;

export type FinancePartnerRead = Readonly<{
  /** The curve's unclaimed partner fee in the pair currency (`partner_quote_fee`). */
  curveUnclaimedRaw: string;
  migrated: boolean;
  migration: Readonly<{ raw: string; withdrawn: boolean }>;
  surplus: Readonly<{ raw: string; withdrawn: boolean }>;
  /** The partner's locked position's unclaimed fees; null before graduation or when it holds none. */
  lp: Readonly<{ pairRaw: string; tokenRaw: string }> | null;
  lpUnread: boolean;
  /** The config's fee claimer — the vault on Classic and Protected, the executor on Micro and the demo market. */
  feeClaimer: string;
}>;

export type FinanceLaunch = Readonly<{
  token: string;
  symbol: string;
  preset: string;
  creator: string;
  /** Launched by one of Ryntra's own wallets. */
  own: boolean;
  launchedAt: string;
  pair: Readonly<{ decimals: number; dollar: boolean }>;
  /** Every trade of the token the read found; null when its market could not be read. */
  trades: readonly FinanceTrade[] | null;
  tradesComplete: boolean;
  /** The creator role's counters — the curve's total trading fee among them; null when not read. */
  counters: CreatorFeesRead | null;
  /** The partner's counters; null when not read. */
  partner: FinancePartnerRead | null;
  /** The partner's claims on this launch the chain shows; null when the claimer's history was not read. */
  claims: readonly FinanceClaim[] | null;
  /** Whether the claimer's history was read to its start. */
  claimsComplete: boolean;
  /**
   * Ryntra's own record of the partner's claims — the executor's budget ledger on Micro and the demo market, the revenue
   * journal of the vault's Squads proposals on the others (SOL-L1d), which names each claim's transaction and leaves its
   * amount to the chain (`pairRaw: null`); null where it was not read.
   */
  ledgerClaims: readonly Readonly<{ signature: string; source: FinanceClaimSource; pairRaw: string | null }>[] | null;
  /** The creators' claims made through Ryntra, as their receipts recorded them. */
  creatorReceipts: readonly Readonly<{ signature: string; receivedRaw: string }>[];
  /** The trades sent through Ryntra, as the operations ledger recorded Ryntra's part. */
  ledgerTrades: readonly Readonly<{ signature: string; ryntraRaw: string | null }>[];
}>;

export type FinanceOperation = Readonly<{
  id: string;
  signature: string | null;
  product: "SWAP" | "SPOT" | "STOCK" | "LAUNCH" | "BRIDGE";
  status: "CONFIRMED" | "IN_FLIGHT" | "NEEDS_YOU" | "FAILED";
  internal: boolean;
  at: string;
  feeCollected: boolean;
  /** Ryntra's share of the fee in dollars after the provider's; null when not valued. */
  ryntraUsd: number | null;
  feeAsset: string | null;
  feeGrossRaw: string | null;
  verification: "VERIFIED" | "PENDING" | "NOT_ATTRIBUTABLE" | "NOT_APPLICABLE";
  /** The whole fee the person paid, in dollars, the provider's share in it (MET-1); null or absent when not valued. */
  grossUsd?: number | null;
  /** The wallet that acted (MET-1's activation and retention); absent where not given. */
  wallet?: string;
  /** When it started, and when its row was confirmed — the latency (MET-1); absent where not given. */
  startedAt?: string;
  confirmedAt?: string | null;
}>;

export type FinanceTerminalChain = Readonly<{
  complete: boolean;
  readAt: string;
  /** Every transaction that credited Ryntra's fee identities, with what it credited, by mint. */
  credits: ReadonlyMap<string, readonly Readonly<{ mint: string; amountRaw: string }>[]>;
  /** What the referral accounts hold now — claimable from the referral program. */
  balances: readonly Readonly<{ mint: string; decimals: number; amountRaw: string }>[];
}>;

export type FinanceRewards = Readonly<{
  /** The ledger's rows as its own rule for a later valuation leaves them (`effectiveRewardEntries`, `lib/rewards`). */
  entries: readonly RewardEntry[];
  /** Each payout's transaction as the chain shows it: landed (null — the node did not give it), and what the recipient received; null when not read. */
  payouts: ReadonlyMap<string, Readonly<{ landed: boolean | null; receivedRaw: string | null }>> | null;
  /** Rows the ledger holds that its own schema does not read — not counted, so the sums are floors. */
  unparsed: number;
  /** The first such row's key and the field its schema refused, for the operator to find it. */
  unparsedHint?: string | null;
}>;

export type FinanceWalletCost = Readonly<{
  role: "executor" | "payer" | "rewards";
  address: string;
  /** Network fees the wallet paid as fee payer, lamports; null when not read. */
  lamports: string | null;
  transactions: number;
  complete: boolean;
}>;

export type FinanceCosts = Readonly<{
  wallets: readonly FinanceWalletCost[];
  /** What the executor's receipts say it spent — fees and rent; null when none were read. */
  executorLedgerLamports: string | null;
  /** The growth budget's spending, in dollars (micros), from the Growth ledger; null when not read. */
  growthSpentMicros: string | null;
}>;

export type FinanceInputs = Readonly<{
  now: string;
  scope: FinanceScope;
  launches: readonly FinanceLaunch[] | null;
  /** Launch records found but not read within the read's time. */
  launchesUnread: number;
  operations: readonly FinanceOperation[] | null;
  terminalChain: FinanceTerminalChain | null;
  rewards: FinanceRewards | null;
  costs: FinanceCosts | null;
  /** Dollar prices by mint, for amounts that are not a dollar; SOL among them. */
  prices: Readonly<Record<string, number>>;
  /** Ryntra's own wallets — the scope «external» leaves them out. */
  internalWallets: ReadonlySet<string>;
  /** Whether that list was read whole; when not, «external» may still hold some of Ryntra's own. */
  internalComplete: boolean;
  /** When the chain and the ledgers were read — the model may be projected from a read kept a minute. */
  readAt: string;
  /** The bills no ledger records yet, entered by hand (MET-1, `finance-manual.ts`); absent — none entered. */
  manualCosts?: readonly ManualCostEntry[];
  /** The assistant's credits paid for — USDC payments the chain showed, each once by its transaction (MET-1); null when not read. */
  credits?: readonly Readonly<{ signature: string; wallet: string; payer?: string | null; amountRaw: string }>[] | null;
  /** What the assistant's calls cost by the model's price, from their receipts (MET-1); null when not read. */
  modelSpend?: Readonly<{ micros: string; unpriced: number }> | null;
  /** The success metrics' records (MET-1); null or absent when not read. */
  success?: SuccessInputs | null;
}>;

/* ------------------------------------------------------------------ the model */

export type FinanceCheck = "MATCH" | "DIFF" | "UNREAD";
export const FINANCE_LINES = ["earned", "claimable", "claimed", "creators", "cashback", "referrals", "costs", "net"] as const;
export type FinanceLineId = (typeof FINANCE_LINES)[number];

export type FinanceFigure = Readonly<{
  /** Dollars; null when nothing of it could be read. */
  usd: number | null;
  /** Read in part: a floor. */
  atLeast: boolean;
  /** What is taken away from it was read in part: a ceiling (the net result only). */
  atMost?: boolean;
}>;

export type FinancePart = Readonly<FinanceFigure & { id: string; check: FinanceCheck }>;

export type FinanceLine = Readonly<
  FinanceFigure & {
    id: FinanceLineId;
    check: FinanceCheck;
    parts: readonly FinancePart[];
    /** Ryntra's records of this sum and the chain's, where both exist. */
    ledgerUsd: number | null;
    chainUsd: number | null;
  }
>;

export const DIFFERENCE_KINDS = [
  "CURVE_EVENTS_VS_COUNTER",
  "PARTNER_CLAIMS_VS_COUNTER",
  "WITHDRAWN_WITHOUT_CLAIM",
  "CLAIM_WITHOUT_WITHDRAWN",
  "LEDGER_CLAIM_NOT_ON_CHAIN",
  "CHAIN_CLAIM_NOT_IN_LEDGER",
  "LEDGER_CLAIM_AMOUNT",
  "LAUNCH_TRADE_NOT_ON_CHAIN",
  "LAUNCH_TRADE_AMOUNT",
  "CREATOR_RECEIPTS_ABOVE_CHAIN",
  "TERMINAL_FEE_NOT_ON_CHAIN",
  "TERMINAL_FEE_AMOUNT",
  "TERMINAL_CHAIN_NOT_IN_LEDGER",
  "REWARD_WITHOUT_OPERATION",
  "REWARD_PAYOUT_NOT_ON_CHAIN",
  "REWARD_PAYOUT_AMOUNT",
] as const;
export type DifferenceKind = (typeof DIFFERENCE_KINDS)[number];

export type FinanceDifference = Readonly<{
  line: FinanceLineId;
  kind: DifferenceKind;
  /** The launch's ticker, or the product, or the wallet's role. */
  subject: string;
  ref: string | null;
  refKind: "tx" | "account" | null;
  /** What Ryntra's records say and what the chain says, in dollars; null where one side has nothing. */
  ledgerUsd: number | null;
  chainUsd: number | null;
}>;

export const UNREAD_KINDS = ["MARKET_MOVED", "LAUNCH_MARKET", "LAUNCH_COUNTERS", "PARTNER", "PARTNER_LP", "CLAIMS", "LAUNCHES_NOT_REACHED", "OPERATIONS", "TERMINAL_CHAIN", "REWARDS", "REWARD_ROWS", "PAYOUTS", "COSTS", "PRICE", "OWN_WALLETS"] as const;
export type UnreadKind = (typeof UNREAD_KINDS)[number];
export type FinanceUnread = Readonly<{ line: FinanceLineId; kind: UnreadKind; subject: string; count?: number; hint?: string }>;

export type FinanceLaunchRow = Readonly<{
  token: string;
  symbol: string;
  preset: string;
  own: boolean;
  creator: string;
  graduated: boolean | null;
  revenue: FinanceFigure;
  budget: FinanceFigure;
  claimable: FinanceFigure;
  claimed: FinanceFigure;
  creators: FinanceFigure;
  check: FinanceCheck;
}>;

export type FinanceMetric = Readonly<{ value: number | null; n: number; atLeast: boolean }>;

export type FinanceMetrics = Readonly<{
  /** Ryntra's revenue on a launch, the median over the launches in scope, dollars. */
  medianRevenuePerLaunch: FinanceMetric;
  /** Creators with a launch in scope launched or traded in the last 30 days. */
  activeCreators: FinanceMetric;
  /** Traders of the launches in scope (makers left out), and those who traded in two transactions or more. */
  traders: FinanceMetric;
  repeatTraders: FinanceMetric;
  /** Of the traders whose first trade is at least N days old, the share who traded again N days or more after it. */
  d7: FinanceMetric;
  d30: FinanceMetric;
  /** Of the operations sent through Ryntra that finished, the share confirmed — over all and by product. */
  executionSuccess: FinanceMetric;
  executionByProduct: Readonly<Record<FinanceOperation["product"], FinanceMetric>>;
}>;

export type FinanceModel = Readonly<{
  generatedAt: string;
  readAt: string;
  scope: FinanceScope;
  lines: Readonly<Record<FinanceLineId, FinanceLine>>;
  /** The revenue part of «earned» and the market's budget part. */
  split: Readonly<{ revenue: FinanceFigure; budget: FinanceFigure; notValued: number }>;
  differences: readonly FinanceDifference[];
  unread: readonly FinanceUnread[];
  launches: readonly FinanceLaunchRow[];
  metrics: FinanceMetrics;
  /** Gross revenue by source and the contribution after costs (MET-1). */
  margin: MarginModel;
  /** What people and Ryntra's automation did — never raw volume (MET-1). */
  success: SuccessModel;
  /** Every sum matched its chain record and everything was read. */
  allMatched: boolean;
}>;

/* ------------------------------------------------------------------ amounts */

/** An amount in dollar micros with how much of it is known: read, a floor (`atLeast`), a ceiling (`atMost`). */
type Amount = { micros: bigint; atLeast: boolean; read: boolean; atMost?: boolean };
const amount = (): Amount => ({ micros: 0n, atLeast: false, read: false });
const known = (micros: bigint): Amount => ({ micros, atLeast: false, read: true });
const UNREAD_AMOUNT: Amount = { micros: 0n, atLeast: true, read: false };

function add(target: Amount, part: Amount): void {
  target.micros += part.micros;
  if (part.read) target.read = true;
  if (part.atLeast || !part.read) target.atLeast = true;
  if (part.atMost) target.atMost = true;
}

/** A sum of parts: read when any part was, a floor when any part was read in part or not at all. */
function sum(...parts: readonly Amount[]): Amount {
  const total = amount();
  if (parts.length === 0) return known(0n);
  for (const part of parts) add(total, part);
  return total;
}

const usd = (micros: bigint) => Number(micros) / 1_000_000;
/*
 * Read in part, a sum is a floor — and a floor of nothing says nothing: it is unread, never «≥ $0». A sum of floors and
 * ceilings together is neither: unread.
 */
const figure = (value: Amount): FinanceFigure =>
  value.read && !(value.atLeast && value.micros === 0n) && !(value.atLeast && value.atMost)
    ? { usd: usd(value.micros), atLeast: value.atLeast, ...(value.atMost ? { atMost: true } : {}) }
    : { usd: null, atLeast: false };
const big = (raw: string | null | undefined) => (raw === null || raw === undefined ? 0n : BigInt(raw));

/** A pair amount in dollar micros: a USDC pair (six decimals) is itself; any other is not valued. */
function pairMicros(launch: FinanceLaunch, raw: bigint): bigint | null {
  if (!launch.pair.dollar) return null;
  if (launch.pair.decimals === 6) return raw;
  const scale = 10n ** BigInt(Math.abs(launch.pair.decimals - 6));
  return launch.pair.decimals > 6 ? raw / scale : raw * scale;
}

function worse(a: FinanceCheck, b: FinanceCheck): FinanceCheck {
  if (a === "DIFF" || b === "DIFF") return "DIFF";
  if (a === "UNREAD" || b === "UNREAD") return "UNREAD";
  return "MATCH";
}

/* ------------------------------------------------------------------ one launch */

type LaunchFigures = {
  row: FinanceLaunchRow;
  earned: Readonly<Record<IncomeSource, Amount>>;
  /** Of each source, Ryntra's revenue — the market's budget left out (MET-1's gross revenue by source). */
  revenueBySource: Readonly<Record<IncomeSource, Amount>>;
  revenue: Amount;
  budget: Amount;
  claimable: Amount;
  claimed: Amount;
  creators: Amount;
  /** The chain's and the ledger's view of the claims Ryntra records (the executor's), for the line's two columns. */
  ledgerClaimedMicros: bigint | null;
  check: Readonly<Record<"earned" | "claimable" | "claimed" | "creators", FinanceCheck>>;
  notValued: number;
};

/**
 * `terminal` — the signatures of the terminal's own operations: a launch trade that is one of them holds the terminal's
 * fee, counted there. `readAt` — the read's moment: a market that traded in the minutes before it may have moved between
 * its events and its counters, which are read apart; a mismatch then is unread, not a difference.
 */
function launchFigures(launch: FinanceLaunch, terminal: ReadonlySet<string>, readAt: number, differences: FinanceDifference[], unread: FinanceUnread[]): LaunchFigures {
  const subject = launch.symbol;
  const latest = (launch.trades ?? []).reduce((newest, trade) => Math.max(newest, trade.at), 0);
  const moving = latest >= readAt - MOVING_SECONDS;
  /* A mismatch on a market that just traded: unread, said as such; otherwise a difference. */
  const mismatch = (line: "earned" | "claimed" | "creators", difference: FinanceDifference) => {
    if (moving) {
      if (!unread.some((entry) => entry.kind === "MARKET_MOVED" && entry.subject === subject)) unread.push({ line, kind: "MARKET_MOVED", subject });
      flag(line, "UNREAD");
      return;
    }
    differences.push(difference);
    flag(line, "DIFF");
  };
  const dollars = (raw: bigint): Amount => {
    const micros = pairMicros(launch, raw);
    return micros === null ? { micros: 0n, atLeast: true, read: false } : known(micros);
  };
  let notValued = launch.pair.dollar ? 0 : 1;
  const check = { earned: "MATCH" as FinanceCheck, claimable: "MATCH" as FinanceCheck, claimed: "MATCH" as FinanceCheck, creators: "MATCH" as FinanceCheck };
  const flag = (line: keyof typeof check, verdict: FinanceCheck) => {
    check[line] = worse(check[line], verdict);
  };

  const trades = launch.trades;
  const curveTrades = trades?.filter((trade) => trade.venue === "curve") ?? [];
  const counters = launch.counters;
  const partner = launch.partner;
  if (!trades) unread.push({ line: "earned", kind: "LAUNCH_MARKET", subject });
  if (!counters) unread.push({ line: "earned", kind: "LAUNCH_COUNTERS", subject });
  if (!partner) unread.push({ line: "claimable", kind: "PARTNER", subject });
  if (partner?.lpUnread) unread.push({ line: "claimable", kind: "PARTNER_LP", subject });
  if (!launch.claims || !launch.claimsComplete) unread.push({ line: "claimed", kind: "CLAIMS", subject });

  /* ---- the curve: events against the counter ---- */
  const tradesWhole = trades !== null && launch.tradesComplete && curveTrades.every((trade) => trade.creatorRaw !== undefined && trade.ryntraRaw !== undefined);
  const eventsCreator = curveTrades.reduce((total, trade) => total + big(trade.creatorRaw), 0n);
  let partnerCurve: Amount = UNREAD_AMOUNT;
  let partnerCurveRaw: bigint | null = null;
  if (counters) {
    const total = big(counters.curve.totalTradingRaw);
    const creatorByCounter = (total * BigInt(counters.curve.creatorPct)) / 100n;
    /* The program rounds each trade's creator part down: the events' sum is at most a unit a trade below the counter's. */
    if (tradesWhole) {
      const gap = creatorByCounter - eventsCreator;
      if (gap < 0n || gap > BigInt(curveTrades.length)) mismatch("earned", { line: "earned", kind: "CURVE_EVENTS_VS_COUNTER", subject, ref: launch.token, refKind: "account", ledgerUsd: usdOf(launch, eventsCreator), chainUsd: usdOf(launch, creatorByCounter) });
      partnerCurveRaw = total - eventsCreator;
      partnerCurve = dollars(partnerCurveRaw);
    } else {
      /* Without every event the partner's part is the counter's less the creator's rounding — at most a unit a trade more. */
      partnerCurveRaw = total - creatorByCounter;
      partnerCurve = { ...dollars(partnerCurveRaw), atLeast: true };
      flag("earned", "UNREAD");
    }
  } else flag("earned", "UNREAD");

  /* ---- the referral (and Ryntra's own fee of the same transaction) ---- */
  let referral: Amount = UNREAD_AMOUNT;
  /*
   * Ryntra's own fee in a trade that is one of the terminal's operations is the terminal's, counted there; in any other
   * trade it stays the launch's. A trade of the terminal's decoded before its own fee was counted apart (`ownRaw` absent;
   * decodes are kept for good) cannot be split: all of it above the partner's part is left out, so the referral is a floor
   * and nothing is counted twice.
   */
  const creatorPct = BigInt(counters?.curve.creatorPct ?? 40);
  let ownTerminal = 0n;
  let legacy = 0;
  for (const trade of trades ?? []) {
    if (!terminal.has(trade.signature)) continue;
    if (trade.ownRaw !== undefined) {
      ownTerminal += big(trade.ownRaw);
      continue;
    }
    legacy += 1;
    const partnerFloor = trade.venue === "curve" && creatorPct > 0n ? (big(trade.creatorRaw) * (100n - creatorPct)) / creatorPct : 0n;
    const rest = big(trade.ryntraRaw) - partnerFloor;
    ownTerminal += rest > 0n ? rest : 0n;
  }
  if (legacy > 0) flag("earned", "UNREAD");
  if (trades && counters && tradesWhole) {
    const ryntraAll = trades.reduce((total, trade) => total + big(trade.ryntraRaw), 0n);
    const raw = ryntraAll - ownTerminal - (partnerCurveRaw ?? 0n);
    /* Below the partner's part means the events and the counter disagree — said above; the referral is then not known. */
    /* Legacy trades may take off up to a unit or two of the partner's part with their own: then nothing is left, a floor of zero. */
    if (raw < 0n && raw >= -3n * BigInt(legacy)) referral = { ...dollars(0n), atLeast: true };
    else if (raw < 0n) {
      referral = UNREAD_AMOUNT;
      flag("earned", "UNREAD");
    } else referral = { ...dollars(raw), atLeast: legacy > 0 };
    if (trades.some((trade) => trade.venue === "pool" && trade.ryntraRaw === undefined)) referral.atLeast = true;
  } else if (trades) {
    const pool = trades
      .filter((trade) => trade.venue === "pool")
      .reduce((total, trade) => total + big(trade.ryntraRaw) - (terminal.has(trade.signature) ? (trade.ownRaw === undefined ? big(trade.ryntraRaw) : big(trade.ownRaw)) : 0n), 0n);
    referral = { ...dollars(pool), atLeast: true };
  }
  /* Each trade sent through Ryntra, against its transaction. */
  if (trades) {
    const bySignature = new Map<string, bigint>();
    const uncounted = new Set<string>();
    for (const trade of trades) {
      bySignature.set(trade.signature, (bySignature.get(trade.signature) ?? 0n) + big(trade.ryntraRaw));
      if (trade.ryntraRaw === undefined) uncounted.add(trade.signature);
    }
    for (const recorded of launch.ledgerTrades) {
      const chain = bySignature.get(recorded.signature);
      if (chain === undefined) {
        if (launch.tradesComplete) {
          differences.push({ line: "earned", kind: "LAUNCH_TRADE_NOT_ON_CHAIN", subject, ref: recorded.signature, refKind: "tx", ledgerUsd: recorded.ryntraRaw === null ? null : usdOf(launch, big(recorded.ryntraRaw)), chainUsd: null });
          flag("earned", "DIFF");
        }
        continue;
      }
      if (uncounted.has(recorded.signature)) {
        flag("earned", "UNREAD");
        continue;
      }
      if (recorded.ryntraRaw !== null && big(recorded.ryntraRaw) !== chain) {
        differences.push({ line: "earned", kind: "LAUNCH_TRADE_AMOUNT", subject, ref: recorded.signature, refKind: "tx", ledgerUsd: usdOf(launch, big(recorded.ryntraRaw)), chainUsd: usdOf(launch, chain) });
        flag("earned", "DIFF");
      }
    }
  }

  /* ---- the partner's claims seen on chain ---- */
  const claims = launch.claims ?? [];
  const claimedBy = (source: FinanceClaimSource) => claims.filter((claim) => claim.source === source).reduce((total, claim) => total + big(claim.pairRaw), 0n);
  const claimsRead = launch.claims !== null && launch.claimsComplete;
  if (!claimsRead) flag("claimed", "UNREAD");
  for (const claim of claims) if (claim.pairRaw === null) flag("claimed", "UNREAD");
  const claimedCurve = claimedBy("curve");
  const claimedMigration = claimedBy("migration");
  const claimedSurplus = claimedBy("surplus");
  const claimedLp = claimedBy("lp");
  const claimedFigure = (raw: bigint): Amount => (claimsRead ? dollars(raw) : { ...dollars(raw), atLeast: true });

  /* The curve's partner fee taken out, by the counters, against the claims seen. */
  if (partner && partnerCurveRaw !== null && claimsRead) {
    const byCounter = partnerCurveRaw - big(partner.curveUnclaimedRaw);
    const gap = claimedCurve - byCounter;
    /*
     * With every event the partner's part is exact, and so is what was taken out. Without them the counter gives a floor
     * — the creator's rounding leaves the partner up to a unit a trade more —, so only less claimed than that floor is a
     * difference; more is not known to be one.
     */
    if (tradesWhole ? gap !== 0n : gap < 0n) mismatch("claimed", { line: "claimed", kind: "PARTNER_CLAIMS_VS_COUNTER", subject, ref: launch.token, refKind: "account", ledgerUsd: usdOf(launch, claimedCurve), chainUsd: usdOf(launch, byCounter > 0n ? byCounter : 0n) });
    else if (gap !== 0n) flag("claimed", "UNREAD");
  }

  /* ---- graduation, surplus, the locked position ---- */
  const migrated = partner?.migrated ?? counters?.graduation.migrated ?? null;
  let graduation: Amount = partner ? (partner.migrated ? dollars(big(partner.migration.raw)) : known(0n)) : UNREAD_AMOUNT;
  let surplus: Amount = partner ? dollars(big(partner.surplus.raw)) : UNREAD_AMOUNT;
  const withdrawnCheck = (read: Readonly<{ raw: string; withdrawn: boolean }>, seen: bigint) => {
    if (!claimsRead) return;
    if (read.withdrawn && seen === 0n && big(read.raw) > 0n) {
      differences.push({ line: "claimed", kind: "WITHDRAWN_WITHOUT_CLAIM", subject, ref: launch.token, refKind: "account", ledgerUsd: null, chainUsd: usdOf(launch, big(read.raw)) });
      flag("claimed", "DIFF");
    } else if (!read.withdrawn && seen > 0n) {
      differences.push({ line: "claimed", kind: "CLAIM_WITHOUT_WITHDRAWN", subject, ref: launch.token, refKind: "account", ledgerUsd: usdOf(launch, seen), chainUsd: null });
      flag("claimed", "DIFF");
    } else if (read.withdrawn && seen !== big(read.raw)) {
      differences.push({ line: "claimed", kind: "PARTNER_CLAIMS_VS_COUNTER", subject, ref: launch.token, refKind: "account", ledgerUsd: usdOf(launch, seen), chainUsd: usdOf(launch, big(read.raw)) });
      flag("claimed", "DIFF");
    }
  };
  if (partner) {
    if (partner.migrated) withdrawnCheck(partner.migration, claimedMigration);
    withdrawnCheck(partner.surplus, claimedSurplus);
  }
  const lpUnclaimed: Amount = partner ? (partner.lpUnread ? UNREAD_AMOUNT : dollars(big(partner.lp?.pairRaw))) : UNREAD_AMOUNT;
  const lp: Amount = sum(claimedFigure(claimedLp), lpUnclaimed);
  if (partner?.lp && big(partner.lp.tokenRaw) > 0n) notValued += 1;
  if (claims.some((claim) => big(claim.tokenRaw) > 0n)) notValued += 1;

  if (!partner) {
    graduation = UNREAD_AMOUNT;
    surplus = UNREAD_AMOUNT;
    flag("claimable", "UNREAD");
  }
  if (partner?.lpUnread) flag("claimable", "UNREAD");

  const earned: Record<IncomeSource, Amount> = { curve: partnerCurve, referral, graduation, surplus, lp };

  /* Revenue and the market's budget, by the one rule. */
  const revenue = amount();
  const budget = amount();
  const revenueBySource = {} as Record<IncomeSource, Amount>;
  for (const source of Object.keys(earned) as IncomeSource[]) {
    const part = earned[source];
    const split = incomeSplit(launch.preset, source, part.micros);
    revenueBySource[source] = { micros: split.revenueRaw, atLeast: part.atLeast, read: part.read };
    add(revenue, revenueBySource[source]);
    add(budget, { micros: split.budgetRaw, atLeast: part.atLeast, read: part.read });
  }

  /* ---- claimable now ---- */
  const claimable = partner
    ? sum(
        dollars(big(partner.curveUnclaimedRaw)),
        partner.migrated && !partner.migration.withdrawn ? dollars(big(partner.migration.raw)) : known(0n),
        !partner.surplus.withdrawn ? dollars(big(partner.surplus.raw)) : known(0n),
        lpUnclaimed,
      )
    : UNREAD_AMOUNT;

  /* ---- claimed ---- */
  const claimed = claimedFigure(claimedCurve + claimedMigration + claimedSurplus + claimedLp);

  /* Ryntra's own record of the executor's claims, against their transactions. */
  let ledgerClaimedMicros: bigint | null = null;
  if (launch.ledgerClaims) {
    let ledgerTotal = 0n;
    const onChain = new Map<string, bigint>();
    for (const claim of claims) onChain.set(claim.signature, (onChain.get(claim.signature) ?? 0n) + big(claim.pairRaw));
    /* A signature the record names without its amount (the vault's journal): the chain's event says what it took. */
    const recorded = new Map<string, bigint | null>();
    for (const claim of launch.ledgerClaims) {
      const before = recorded.get(claim.signature);
      recorded.set(claim.signature, claim.pairRaw === null || before === null ? null : (before ?? 0n) + big(claim.pairRaw));
    }
    for (const [signature, raw] of recorded) {
      const chain = onChain.get(signature);
      ledgerTotal += raw ?? chain ?? 0n;
      if (chain === undefined) {
        if (claimsRead) {
          differences.push({ line: "claimed", kind: "LEDGER_CLAIM_NOT_ON_CHAIN", subject, ref: signature, refKind: "tx", ledgerUsd: raw === null ? null : usdOf(launch, raw), chainUsd: null });
          flag("claimed", "DIFF");
        }
      } else if (raw !== null && chain !== raw) {
        differences.push({ line: "claimed", kind: "LEDGER_CLAIM_AMOUNT", subject, ref: signature, refKind: "tx", ledgerUsd: usdOf(launch, raw), chainUsd: usdOf(launch, chain) });
        flag("claimed", "DIFF");
      }
    }
    for (const [signature, raw] of onChain) {
      if (recorded.has(signature)) continue;
      differences.push({ line: "claimed", kind: "CHAIN_CLAIM_NOT_IN_LEDGER", subject, ref: signature, refKind: "tx", ledgerUsd: null, chainUsd: usdOf(launch, raw) });
      flag("claimed", "DIFF");
    }
    const micros = pairMicros(launch, ledgerTotal);
    ledgerClaimedMicros = micros;
  }

  /* ---- what the creator's side took out ---- */
  let creators: Amount = UNREAD_AMOUNT;
  if (counters) {
    const total = big(counters.curve.totalTradingRaw);
    /*
     * The creator's part rounds down trade by trade, so the counter's share of the total is up to a unit a trade above
     * it: with every event read, their sum is the creator's part; without, the counter's is a ceiling.
     */
    const curveEarned = tradesWhole ? eventsCreator : (total * BigInt(counters.curve.creatorPct)) / 100n;
    if (!tradesWhole) flag("creators", "UNREAD");
    const unclaimed = big(counters.curve.unclaimedRaw);
    const curvePaid = curveEarned > unclaimed ? curveEarned - unclaimed : 0n;
    const graduationPaid = counters.graduation.migrated && counters.graduation.withdrawn ? creatorGraduationFeeRaw(counters.graduation) : 0n;
    const lpPaid = big(counters.lp?.claimedRaw);
    /* The creator's part of the curve's surplus, by the curve's own flag (SOL-L1d). */
    const surplusPaid = counters.surplus?.withdrawn ? creatorSurplusRaw(counters.surplus) : 0n;
    const paidOut = curvePaid + graduationPaid + lpPaid + surplusPaid;
    creators = { ...dollars(paidOut), ...(tradesWhole ? {} : { atMost: true }) };
    const receipts = launch.creatorReceipts.reduce((total, receipt) => total + big(receipt.receivedRaw), 0n);
    /* Receipts are the claims made through Ryntra; a creator may claim elsewhere too — more on chain is no difference. */
    if (receipts > paidOut)
      mismatch("creators", { line: "creators", kind: "CREATOR_RECEIPTS_ABOVE_CHAIN", subject, ref: launch.token, refKind: "account", ledgerUsd: usdOf(launch, receipts), chainUsd: usdOf(launch, paidOut) });
  } else flag("creators", "UNREAD");

  if (!revenue.read || revenue.atLeast) flag("earned", "UNREAD");
  if (!claimable.read || claimable.atLeast) flag("claimable", "UNREAD");

  const row: FinanceLaunchRow = {
    token: launch.token,
    symbol: launch.symbol,
    preset: launch.preset,
    own: launch.own,
    creator: launch.creator,
    graduated: migrated,
    revenue: figure(revenue),
    budget: figure(budget),
    claimable: figure(claimable),
    claimed: figure(claimed),
    creators: figure(creators),
    check: worse(worse(check.earned, check.claimable), worse(check.claimed, check.creators)),
  };
  return { row, earned, revenueBySource, revenue, budget, claimable, claimed, creators, ledgerClaimedMicros, check, notValued };
}

function usdOf(launch: FinanceLaunch, raw: bigint): number | null {
  const micros = pairMicros(launch, raw);
  return micros === null ? null : usd(micros);
}

/* ------------------------------------------------------------------ the terminal */

/**
 * The terminal's operations that hold a fee Ryntra took: confirmed, the fee collected, neither a launch trade (counted
 * with its launch) nor a bridge — each once by its transaction, so a row the ledger holds twice is never a second fee.
 */
export function terminalFeeOperations(operations: readonly FinanceOperation[]): readonly FinanceOperation[] {
  const seen = new Set<string>();
  return operations.filter((op) => {
    if (op.product === "LAUNCH" || op.product === "BRIDGE" || op.status !== "CONFIRMED" || !op.feeCollected) return false;
    const key = op.signature ?? `id:${op.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type TerminalFigures = { earned: Amount; claimable: Amount; check: FinanceCheck; claimableCheck: FinanceCheck; ledgerMicros: bigint; chainMicros: bigint | null };

function terminalFigures(inputs: FinanceInputs, operations: readonly FinanceOperation[] | null, launchSignatures: ReadonlySet<string>, differences: FinanceDifference[], unread: FinanceUnread[]): TerminalFigures {
  const chain = inputs.terminalChain;
  if (!chain) unread.push({ line: "earned", kind: "TERMINAL_CHAIN", subject: "terminal" });
  if (!operations) {
    unread.push({ line: "earned", kind: "OPERATIONS", subject: "terminal" });
    return { earned: UNREAD_AMOUNT, claimable: chain ? claimableOf(inputs, chain, unread) : UNREAD_AMOUNT, check: "UNREAD", claimableCheck: chain ? "MATCH" : "UNREAD", ledgerMicros: 0n, chainMicros: null };
  }
  let check: FinanceCheck = chain ? "MATCH" : "UNREAD";
  const earned = known(0n);
  let chainMicros = 0n;
  const seen = new Set<string>();
  /* A transaction the ledger holds twice is one fee; two rows of it that disagree on Ryntra's part are a difference. */
  const counted = terminalFeeOperations(operations);
  const first = new Map(counted.flatMap((op) => (op.signature ? [[op.signature, op] as const] : [])));
  for (const op of operations) {
    const kept = op.signature ? first.get(op.signature) : undefined;
    if (!kept || kept === op || op.status !== "CONFIRMED" || !op.feeCollected || op.product === "LAUNCH" || op.product === "BRIDGE" || op.ryntraUsd === kept.ryntraUsd) continue;
    differences.push({ line: "earned", kind: "TERMINAL_FEE_AMOUNT", subject: op.product, ref: op.signature, refKind: "tx", ledgerUsd: op.ryntraUsd, chainUsd: kept.ryntraUsd });
    check = "DIFF";
  }
  for (const op of counted) {
    if (op.ryntraUsd === null) earned.atLeast = true;
    const micros = op.ryntraUsd === null ? 0n : BigInt(Math.round(op.ryntraUsd * 1_000_000));
    earned.micros += micros;
    if (!op.signature) continue;
    seen.add(op.signature);
    if (!chain) continue;
    const credits = chain.credits.get(op.signature);
    if (!credits) {
      if (chain.complete && Date.parse(op.at) <= Date.parse(chain.readAt)) {
        differences.push({ line: "earned", kind: "TERMINAL_FEE_NOT_ON_CHAIN", subject: op.product, ref: op.signature, refKind: "tx", ledgerUsd: op.ryntraUsd, chainUsd: null });
        check = "DIFF";
      } else check = worse(check, "UNREAD");
      continue;
    }
    chainMicros += micros;
    if (op.feeAsset && op.feeGrossRaw !== null) {
      const credited = credits.filter((credit) => credit.mint === op.feeAsset).reduce((total, credit) => total + BigInt(credit.amountRaw), 0n);
      if (credited !== BigInt(op.feeGrossRaw)) {
        const ratio = BigInt(op.feeGrossRaw) > 0n ? Number(credited) / Number(BigInt(op.feeGrossRaw)) : null;
        differences.push({ line: "earned", kind: "TERMINAL_FEE_AMOUNT", subject: op.product, ref: op.signature, refKind: "tx", ledgerUsd: op.ryntraUsd, chainUsd: op.ryntraUsd === null || ratio === null ? null : op.ryntraUsd * ratio });
        check = "DIFF";
      }
    }
  }
  if (chain) {
    /* Against every operation the ledger holds — the scope only decides what is counted, not what is recorded. */
    const recorded = new Set((inputs.operations ?? []).flatMap((op) => (op.signature ? [op.signature] : [])));
    for (const signature of chain.credits.keys()) {
      if (seen.has(signature) || launchSignatures.has(signature) || recorded.has(signature)) continue;
      differences.push({ line: "earned", kind: "TERMINAL_CHAIN_NOT_IN_LEDGER", subject: "terminal", ref: signature, refKind: "tx", ledgerUsd: null, chainUsd: null });
      check = "DIFF";
    }
    if (!chain.complete) check = worse(check, "UNREAD");
  }
  return { earned, claimable: chain ? claimableOf(inputs, chain, unread) : UNREAD_AMOUNT, check, claimableCheck: chain ? "MATCH" : "UNREAD", ledgerMicros: earned.micros, chainMicros: chain ? chainMicros : null };
}

const DOLLAR_DECIMALS = 6;
/** A market that traded this close to the read may have moved between its events and its counters. */
const MOVING_SECONDS = 600;

function claimableOf(inputs: FinanceInputs, chain: FinanceTerminalChain, unread: FinanceUnread[]): Amount {
  const total = known(0n);
  for (const balance of chain.balances) {
    const raw = BigInt(balance.amountRaw);
    if (raw === 0n) continue;
    const price = inputs.prices[balance.mint];
    if (price === undefined) {
      total.atLeast = true;
      unread.push({ line: "claimable", kind: "PRICE", subject: balance.mint });
      continue;
    }
    const value = (Number(raw) / 10 ** balance.decimals) * price;
    total.micros += BigInt(Math.round(value * 10 ** DOLLAR_DECIMALS));
  }
  return total;
}

/* ------------------------------------------------------------------ rewards */

type RewardFigures = { cashback: Amount; friends: Amount; payouts: Amount; cashbackCheck: FinanceCheck; friendsCheck: FinanceCheck; ledgerPaidMicros: bigint; chainPaidMicros: bigint | null; fromBudget: Amount };

function rewardFigures(inputs: FinanceInputs, operations: readonly FinanceOperation[] | null, differences: FinanceDifference[], unread: FinanceUnread[]): RewardFigures {
  const rewards = inputs.rewards;
  if (!rewards) {
    unread.push({ line: "cashback", kind: "REWARDS", subject: "rewards" });
    return { cashback: UNREAD_AMOUNT, friends: UNREAD_AMOUNT, payouts: UNREAD_AMOUNT, cashbackCheck: "UNREAD", friendsCheck: "UNREAD", ledgerPaidMicros: 0n, chainPaidMicros: null, fromBudget: UNREAD_AMOUNT };
  }
  const external = inputs.scope === "external";
  const entries = rewards.entries.filter((entry) => !external || !inputs.internalWallets.has(entry.recipient));
  const cashback = known(0n);
  const friends = known(0n);
  if (rewards.unparsed > 0) {
    unread.push({ line: "cashback", kind: "REWARD_ROWS", subject: "rewards", count: rewards.unparsed, ...(rewards.unparsedHint ? { hint: rewards.unparsedHint } : {}) });
    cashback.atLeast = true;
    friends.atLeast = true;
  }
  const fromBudget = known(0n);
  let cashbackCheck: FinanceCheck = operations ? "MATCH" : "UNREAD";
  let friendsCheck: FinanceCheck = operations ? "MATCH" : "UNREAD";
  const verified = new Set<string>();
  const knownRefs = new Set<string>();
  for (const op of operations ?? []) {
    if (!op.signature) continue;
    knownRefs.add(op.signature);
    if (op.verification === "VERIFIED") verified.add(op.signature);
  }
  const unbacked = new Map<string, { micros: bigint; line: "cashback" | "referrals" }>();
  for (const entry of entries) {
    if (entry.type !== "CASHBACK" && entry.type !== "REFERRAL_L1" && entry.type !== "REFERRAL_L2" && !(entry.type === "ADJUSTMENT" && entry.window?.startsWith("FIRST_TEN"))) continue;
    const target = entry.type === "REFERRAL_L1" || entry.type === "REFERRAL_L2" ? friends : cashback;
    if (entry.usdMicros === null) {
      target.atLeast = true;
      continue;
    }
    const micros = BigInt(entry.usdMicros);
    target.micros += micros;
    if (entry.fundedBy === "budget") fromBudget.micros += micros;
    const ref = entry.source?.operationRef ?? null;
    if (!ref || !operations || entry.fundedBy === "budget") continue;
    if (verified.has(ref)) continue;
    const line = target === friends ? "referrals" : "cashback";
    if (knownRefs.has(ref)) {
      if (line === "cashback") cashbackCheck = worse(cashbackCheck, "UNREAD");
      else friendsCheck = worse(friendsCheck, "UNREAD");
      continue;
    }
    const kept = unbacked.get(ref) ?? { micros: 0n, line };
    kept.micros += micros;
    unbacked.set(ref, kept);
  }
  for (const [ref, kept] of unbacked) {
    differences.push({ line: kept.line, kind: "REWARD_WITHOUT_OPERATION", subject: kept.line, ref, refKind: "tx", ledgerUsd: usd(kept.micros), chainUsd: null });
    if (kept.line === "cashback") cashbackCheck = "DIFF";
    else friendsCheck = "DIFF";
  }

  /* Payouts: each claim row against its transaction. */
  let ledgerPaid = 0n;
  let chainPaid = 0n;
  let payoutCheck: FinanceCheck = rewards.payouts ? "MATCH" : "UNREAD";
  if (!rewards.payouts) unread.push({ line: "cashback", kind: "PAYOUTS", subject: "rewards" });
  for (const entry of entries) {
    if (entry.type !== "CLAIM" || entry.usdMicros === null) continue;
    const paid = -BigInt(entry.usdMicros);
    ledgerPaid += paid;
    if (!rewards.payouts) continue;
    const seen = entry.signature ? rewards.payouts.get(entry.signature) : undefined;
    /* A payout whose transaction a node would not give now is unread, not missing. */
    if (entry.signature && (seen === undefined || seen.landed === null)) {
      payoutCheck = worse(payoutCheck, "UNREAD");
      continue;
    }
    if (!seen || !seen.landed) {
      differences.push({ line: "cashback", kind: "REWARD_PAYOUT_NOT_ON_CHAIN", subject: "payout", ref: entry.signature, refKind: entry.signature ? "tx" : null, ledgerUsd: usd(paid), chainUsd: null });
      payoutCheck = "DIFF";
      continue;
    }
    /* Payouts are in a dollar stablecoin of six decimals: its raw is its micros. */
    const received = seen.receivedRaw === null ? null : BigInt(seen.receivedRaw);
    if (received === null) {
      payoutCheck = worse(payoutCheck, "UNREAD");
      continue;
    }
    chainPaid += received;
    if (received !== paid) {
      differences.push({ line: "cashback", kind: "REWARD_PAYOUT_AMOUNT", subject: "payout", ref: entry.signature, refKind: "tx", ledgerUsd: usd(paid), chainUsd: usd(received) });
      payoutCheck = "DIFF";
    }
  }
  return {
    cashback,
    friends,
    payouts: known(ledgerPaid),
    cashbackCheck: worse(worse(cashbackCheck, payoutCheck), rewards.unparsed > 0 ? "UNREAD" : "MATCH"),
    friendsCheck: worse(worse(friendsCheck, payoutCheck), rewards.unparsed > 0 ? "UNREAD" : "MATCH"),
    ledgerPaidMicros: ledgerPaid,
    chainPaidMicros: rewards.payouts ? chainPaid : null,
    fromBudget,
  };
}

/* ------------------------------------------------------------------ costs */

type CostFigures = { network: Amount; growth: Amount; check: FinanceCheck; ledgerMicros: bigint | null; chainMicros: bigint | null; byRole: Record<FinanceWalletCost["role"], Amount> };

const SOL_MINT = "So11111111111111111111111111111111111111112";

function costFigures(inputs: FinanceInputs, unread: FinanceUnread[]): CostFigures {
  const byRole: Record<FinanceWalletCost["role"], Amount> = { executor: UNREAD_AMOUNT, payer: UNREAD_AMOUNT, rewards: UNREAD_AMOUNT };
  const costs = inputs.costs;
  if (!costs) {
    unread.push({ line: "costs", kind: "COSTS", subject: "costs" });
    return { network: UNREAD_AMOUNT, growth: UNREAD_AMOUNT, check: "UNREAD", ledgerMicros: null, chainMicros: null, byRole };
  }
  const sol = inputs.prices[SOL_MINT];
  if (sol === undefined) unread.push({ line: "costs", kind: "PRICE", subject: "SOL" });
  const lamportsUsd = (lamports: bigint): Amount => (sol === undefined ? { micros: 0n, atLeast: true, read: false } : known(BigInt(Math.round((Number(lamports) / 1e9) * sol * 1_000_000))));
  let check: FinanceCheck = "MATCH";
  const network = amount();
  for (const wallet of costs.wallets) {
    if (wallet.lamports === null) {
      unread.push({ line: "costs", kind: "COSTS", subject: wallet.role });
      byRole[wallet.role] = UNREAD_AMOUNT;
      add(network, UNREAD_AMOUNT);
      check = worse(check, "UNREAD");
      continue;
    }
    const value = lamportsUsd(BigInt(wallet.lamports));
    if (!wallet.complete) value.atLeast = true;
    byRole[wallet.role] = value;
    add(network, value);
    if (!wallet.complete || !value.read) check = worse(check, "UNREAD");
  }
  if (costs.wallets.length === 0) Object.assign(network, known(0n));
  /* The executor's receipts say what it spent, rent included, which a closed account returns: shown beside the chain's fees, never netted. */
  const ledgerMicros = costs.executorLedgerLamports !== null && sol !== undefined ? lamportsUsd(BigInt(costs.executorLedgerLamports)).micros : null;
  const growth = costs.growthSpentMicros === null ? UNREAD_AMOUNT : known(BigInt(costs.growthSpentMicros));
  if (costs.growthSpentMicros === null) unread.push({ line: "costs", kind: "COSTS", subject: "growth" });
  return { network, growth, check, ledgerMicros, chainMicros: network.read ? network.micros : null, byRole };
}

/* ------------------------------------------------------------------ metrics */

const DAY = 86_400;

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function retention(firsts: ReadonlyMap<string, readonly number[]>, days: number, now: number, complete: boolean): FinanceMetric {
  let eligible = 0;
  let returned = 0;
  for (const times of firsts.values()) {
    const first = times[0]!;
    if (first > now - days * DAY) continue;
    eligible += 1;
    if (times.some((at) => at >= first + days * DAY)) returned += 1;
  }
  return { value: eligible === 0 ? null : returned / eligible, n: eligible, atLeast: !complete };
}

function metricsOf(inputs: FinanceInputs, launches: readonly FinanceLaunch[], revenues: readonly Amount[], operations: readonly FinanceOperation[] | null): FinanceMetrics {
  /* Launches not read at all leave the counts unknown; some not reached leave them floors. */
  const launchesRead = inputs.launches !== null;
  const someUnread = inputs.launchesUnread > 0;
  const now = Math.floor(Date.parse(inputs.now) / 1000);
  const readRevenues = revenues.filter((revenue) => revenue.read).map((revenue) => usd(revenue.micros));
  const medianRevenue: FinanceMetric = { value: median(readRevenues), n: readRevenues.length, atLeast: revenues.some((revenue) => !revenue.read || revenue.atLeast) };

  const active = new Set<string>();
  const creators = new Set<string>();
  let tradesComplete = !someUnread;
  const times = new Map<string, number[]>();
  const signatures = new Map<string, Set<string>>();
  for (const launch of launches) {
    creators.add(launch.creator);
    if (Date.parse(launch.launchedAt) / 1000 >= now - 30 * DAY) active.add(launch.creator);
    if (!launch.trades || !launch.tradesComplete) tradesComplete = false;
    for (const trade of launch.trades ?? []) {
      if (trade.at >= now - 30 * DAY) active.add(launch.creator);
      if (trade.maker) continue;
      const list = times.get(trade.trader) ?? [];
      list.push(trade.at);
      times.set(trade.trader, list);
      const seen = signatures.get(trade.trader) ?? new Set<string>();
      seen.add(trade.signature);
      signatures.set(trade.trader, seen);
    }
  }
  for (const list of times.values()) list.sort((a, b) => a - b);
  const traders = signatures.size;
  const repeat = [...signatures.values()].filter((set) => set.size >= 2).length;

  const finished = (operations ?? []).filter((op) => op.status === "CONFIRMED" || op.status === "FAILED");
  const share = (list: readonly FinanceOperation[]): FinanceMetric => ({ value: list.length === 0 ? null : list.filter((op) => op.status === "CONFIRMED").length / list.length, n: list.length, atLeast: operations === null });
  const byProduct = {} as Record<FinanceOperation["product"], FinanceMetric>;
  for (const product of ["SWAP", "SPOT", "STOCK", "LAUNCH", "BRIDGE"] as const) byProduct[product] = share(finished.filter((op) => op.product === product));

  const counted = (value: number, n: number): FinanceMetric => (launchesRead ? { value, n, atLeast: !tradesComplete } : { value: null, n: 0, atLeast: false });
  return {
    medianRevenuePerLaunch: launchesRead ? { ...medianRevenue, atLeast: medianRevenue.atLeast || someUnread } : { value: null, n: 0, atLeast: false },
    activeCreators: counted(active.size, creators.size),
    traders: counted(traders, traders),
    repeatTraders: counted(repeat, traders),
    d7: launchesRead ? retention(times, 7, now, tradesComplete) : { value: null, n: 0, atLeast: false },
    d30: launchesRead ? retention(times, 30, now, tradesComplete) : { value: null, n: 0, atLeast: false },
    executionSuccess: operations === null ? { value: null, n: 0, atLeast: true } : share(finished),
    executionByProduct: byProduct,
  };
}

/* ------------------------------------------------------------------ margin (MET-1) */

/*
 * Gross revenue by source, and the contribution after what each flow costs (spec §16.3):
 *
 *   gross = the terminal's fees as the person paid them + Ryntra's revenue from each launch source + the assistant's
 *           credits paid for;
 *   contribution = gross − the provider's share − RPC and data − executors − signing − the model's tokens − delivery −
 *                  support − cashback − friends' rewards − the growth budget.
 *
 * One flow is counted once: a terminal fee by its transaction (`terminalFeeOperations`), a launch's income by its
 * source; Ryntra's own fee inside a launch trade is the terminal's (SOL-F1's rule); claimed and claimable are the
 * earned money's state, and the market's budget is not Ryntra's — each is shown beside the gross, never added to it.
 * Costs no ledger records yet are the bills entered by hand (`finance-manual.ts`); one not entered is «no data», and the
 * contribution is then a ceiling.
 */

export const MARGIN_SOURCES = ["swap", "spot", "stock", "launchCurve", "launchReferral", "launchGraduation", "launchSurplus", "launchLp", "credits", "subscriptions", "usage", "marketplace"] as const;
export type MarginSourceId = (typeof MARGIN_SOURCES)[number];

/** Sources of spec §16.1 that no ledger records yet, and the task that brings each. */
export const MARGIN_SOURCE_TASK: Readonly<Partial<Record<MarginSourceId, string>>> = { subscriptions: "TEAM-1", usage: "DEV-1", marketplace: "PRT-2" };

export type MarginSource = Readonly<{
  id: MarginSourceId;
  /** What the person paid, the provider's share in it; for a launch, Ryntra's revenue. */
  gross: FinanceFigure;
  venue: FinanceFigure;
  /** Ryntra's revenue from it. */
  ryntra: FinanceFigure;
  /** The flows counted — transactions for the terminal, launches for a launch source; null where no ledger records it. */
  flows: number | null;
  /** The task that brings a source no ledger records yet; then every figure is «no data». */
  task: string | null;
}>;

export const MARGIN_COSTS = ["venue", "rpcData", "executors", "signing", "llm", "delivery", "support", "cashback", "referrals", "growth"] as const;
export type MarginCostId = (typeof MARGIN_COSTS)[number];

export type MarginCostPart = Readonly<FinanceFigure & { id: string; manual: boolean; months?: readonly string[] }>;
export type MarginCost = Readonly<FinanceFigure & { id: MarginCostId; manual: boolean; parts: readonly MarginCostPart[] }>;

export type MarginIncentives = Readonly<{
  /** Ryntra's share of the operations the fee-funded rewards were accrued on — the base cashback is counted from. */
  base: FinanceFigure;
  /** The cashback and friends' rewards accrued on those operations. */
  accrued: FinanceFigure;
  /** Accrued over base; null when either is not known. */
  rate: number | null;
  /** Rows of rules 1.0.0, whose base was the gross fee rather than Ryntra's share. */
  grossBaseRows: number;
  /** Rows whose operation the ledger of operations does not hold or did not value — their base is not known. */
  baseUnknownRows: number;
  /** More was accrued than Ryntra received on those operations. */
  aboveReceived: boolean;
}>;

export type MarginModel = Readonly<{
  gross: FinanceFigure;
  sources: readonly MarginSource[];
  /** Read beside the gross and never added to it. */
  notAdded: Readonly<{ claimed: FinanceFigure; claimable: FinanceFigure; budget: FinanceFigure; creators: FinanceFigure }>;
  costs: readonly MarginCost[];
  contribution: FinanceFigure;
  /** Contribution over gross; null when either is not known. */
  share: number | null;
  incentives: MarginIncentives;
  /** Rows of `finance-manual.ts` refused by their shape — not counted. */
  manualRefused: number;
}>;

/**
 * The payout rates the margin is read against, in basis points of what reached Ryntra — never of the venue's whole fee:
 * the terminal's under the reward rules in force (`lib/rewards/rules.ts`, 2.1.0), Launch's as decided on 25.10.
 */
export const INCENTIVE_RATES = {
  terminal: { cashbackBps: 5000, inviterBps: "1000–3000", secondLevelBps: 500, ceilingBps: 8500 },
  launch: { crewBonusBps: 2000, cashbackBps: 3000, friendBps: 1500, creatorPartnerBps: 500, ceilingBps: 7000 },
} as const;

/** `a − b`: a floor when `a` was read in part, a ceiling when `b` was, unknown when both. */
function less(a: Amount, b: Amount): FinanceFigure {
  const aPartial = a.atLeast || !a.read;
  const bPartial = b.atLeast || !b.read;
  if (!a.read || (aPartial && bPartial)) return { usd: null, atLeast: false };
  const value = usd(a.micros - b.micros);
  if (bPartial) return { usd: value, atLeast: false, atMost: true };
  return { usd: value, atLeast: aPartial };
}

const dollarMicros = (value: number) => BigInt(Math.round(value * 1_000_000));
const outsideScope = (inputs: FinanceInputs, wallet: string) => inputs.scope !== "external" || !inputs.internalWallets.has(wallet);

type MarginContext = Readonly<{
  inputs: FinanceInputs;
  operations: readonly FinanceOperation[] | null;
  figures: readonly LaunchFigures[];
  totalOf: (pick: (entry: LaunchFigures) => Amount) => Amount;
  revenue: Amount;
  claimed: Amount;
  claimable: Amount;
  budget: Amount;
  creators: Amount;
  rewards: RewardFigures;
  costs: CostFigures;
}>;

const LAUNCH_SOURCE: Readonly<Record<IncomeSource, MarginSourceId>> = { curve: "launchCurve", referral: "launchReferral", graduation: "launchGraduation", surplus: "launchSurplus", lp: "launchLp" };
const TERMINAL_SOURCE: Readonly<Record<"SWAP" | "SPOT" | "STOCK", MarginSourceId>> = { SWAP: "swap", SPOT: "spot", STOCK: "stock" };

function marginOf(context: MarginContext): MarginModel {
  const { inputs, operations, figures } = context;
  const sources: MarginSource[] = [];

  /* The terminal: each fee once, by its transaction. The provider's share is what the person paid less Ryntra's. */
  const venueTotal: Amount = operations === null ? { ...UNREAD_AMOUNT } : known(0n);
  const grossTotal: Amount = amount();
  const counted = operations === null ? [] : terminalFeeOperations(operations);
  for (const product of ["SWAP", "SPOT", "STOCK"] as const) {
    if (operations === null) {
      sources.push({ id: TERMINAL_SOURCE[product], gross: figure(UNREAD_AMOUNT), venue: figure(UNREAD_AMOUNT), ryntra: figure(UNREAD_AMOUNT), flows: null, task: null });
      add(grossTotal, UNREAD_AMOUNT);
      continue;
    }
    const gross = known(0n);
    const venue = known(0n);
    const ryntra = known(0n);
    let flows = 0;
    for (const op of counted) {
      if (op.product !== product) continue;
      flows += 1;
      const own = op.ryntraUsd === null ? null : dollarMicros(op.ryntraUsd);
      const whole = op.grossUsd === null || op.grossUsd === undefined ? null : dollarMicros(op.grossUsd);
      if (own === null) ryntra.atLeast = true;
      else ryntra.micros += own;
      if (whole === null || own === null || whole < own) {
        /* The whole fee not valued: the gross is at least Ryntra's part, the provider's share not known. */
        gross.micros += own ?? 0n;
        gross.atLeast = true;
        venue.atLeast = true;
        continue;
      }
      gross.micros += whole;
      venue.micros += whole - own;
    }
    add(grossTotal, gross);
    add(venueTotal, venue);
    sources.push({ id: TERMINAL_SOURCE[product], gross: figure(gross), venue: figure(venue), ryntra: figure(ryntra), flows, task: null });
  }

  /* Launch: Ryntra's revenue by source; the provider's part never reached Ryntra, the market's budget is not Ryntra's. */
  for (const source of INCOME_SOURCES) {
    const value = context.totalOf((entry) => entry.revenueBySource[source]);
    add(grossTotal, value);
    const grossFigure = figure(value);
    const flows = inputs.launches === null ? null : figures.filter((entry) => entry.revenueBySource[source].micros > 0n).length;
    sources.push({ id: LAUNCH_SOURCE[source], gross: grossFigure, venue: grossFigure.usd === null ? { usd: null, atLeast: false } : { usd: 0, atLeast: false }, ryntra: grossFigure, flows, task: null });
  }
  /* The assistant's credits: each USDC payment once, by its transaction; no provider takes a share of it. */
  let credits: Amount = UNREAD_AMOUNT;
  let creditFlows: number | null = null;
  if (inputs.credits) {
    const paid = new Map<string, bigint>();
    for (const payment of inputs.credits) {
      if (!outsideScope(inputs, payment.wallet) || (payment.payer && !outsideScope(inputs, payment.payer)) || paid.has(payment.signature)) continue;
      paid.set(payment.signature, BigInt(payment.amountRaw));
    }
    credits = known([...paid.values()].reduce((total, raw) => total + raw, 0n));
    creditFlows = paid.size;
  }
  add(grossTotal, credits);
  sources.push({ id: "credits", gross: figure(credits), venue: figure(inputs.credits ? known(0n) : UNREAD_AMOUNT), ryntra: figure(credits), flows: creditFlows, task: null });
  for (const id of ["subscriptions", "usage", "marketplace"] as const) {
    sources.push({ id, gross: { usd: null, atLeast: false }, venue: { usd: null, atLeast: false }, ryntra: { usd: null, atLeast: false }, flows: null, task: MARGIN_SOURCE_TASK[id] ?? null });
  }

  /* The bills entered by hand. */
  let manualRefused = 0;
  const manual = new Map<string, { micros: bigint; months: Set<string> }>();
  const entered = new Set<string>();
  for (const entry of inputs.manualCosts ?? []) {
    const micros = manualCostMicros(entry);
    /* A bill entered twice — the same line, month and bill — is one bill. */
    const identity = `${entry.line}|${entry.month}|${entry.source.trim()}`;
    if (micros === null || entered.has(identity)) {
      if (micros === null) manualRefused += 1;
      continue;
    }
    entered.add(identity);
    const kept = manual.get(entry.line) ?? { micros: 0n, months: new Set<string>() };
    kept.micros += micros;
    kept.months.add(entry.month);
    manual.set(entry.line, kept);
  }
  /* The panel's whole period: a line is exact only when every month of it has its bill; with some, a floor; with none, no data. */
  const period = manualMonths(inputs.now);
  const manualAmount = (line: ManualCostLine): Amount => {
    const kept = manual.get(line);
    if (!kept) return UNREAD_AMOUNT;
    return { ...known(kept.micros), atLeast: period.some((month) => !kept.months.has(month)) };
  };
  const manualPart = (line: ManualCostLine): MarginCostPart => {
    const kept = manual.get(line);
    return { id: line, ...figure(manualAmount(line)), manual: true, ...(kept ? { months: [...kept.months].sort() } : {}) };
  };
  const chainPart = (id: string, value: Amount): MarginCostPart => ({ id, ...figure(value), manual: false });
  const cost = (id: MarginCostId, parts: readonly MarginCostPart[], value: Amount): MarginCost => ({ id, ...figure(value), manual: parts.every((entry) => entry.manual), parts });

  /* The model's tokens from the calls' own receipts — never also a bill entered by hand, which would count them twice. */
  const spend = inputs.modelSpend;
  const modelSpend: Amount = spend ? { ...known(BigInt(spend.micros)), atLeast: spend.unpriced > 0 } : UNREAD_AMOUNT;
  /* The wallets the costs read: a role with no wallet here pays nothing, and is no unread part either. */
  const roles = inputs.costs ? new Set(inputs.costs.wallets.map((wallet) => wallet.role)) : new Set<FinanceWalletCost["role"]>(["executor", "payer", "rewards"]);
  const roleParts = (["executor", "payer", "rewards"] as const).filter((role) => roles.has(role));
  const executors = sum(...roleParts.map((role) => context.costs.byRole[role]), manualAmount("workers"));
  const costs: MarginCost[] = [
    cost("venue", [chainPart("terminal", venueTotal)], venueTotal),
    cost("rpcData", [manualPart("rpcData")], manualAmount("rpcData")),
    cost("executors", [...roleParts.map((role) => chainPart(role, context.costs.byRole[role])), manualPart("workers")], executors),
    cost("signing", [manualPart("signing")], manualAmount("signing")),
    cost("llm", [chainPart("receipts", modelSpend)], modelSpend),
    cost("delivery", [manualPart("delivery")], manualAmount("delivery")),
    cost("support", [manualPart("support")], manualAmount("support")),
    cost("cashback", [chainPart("accrued", context.rewards.cashback)], context.rewards.cashback),
    cost("referrals", [chainPart("accrued", context.rewards.friends)], context.rewards.friends),
    cost("growth", [chainPart("growth", context.costs.growth)], context.costs.growth),
  ];

  /*
   * The contribution from Ryntra's side of each flow: the gross less the provider's share is Ryntra's revenue — exactly,
   * even where a fee's whole was not valued — so the provider's share read in part never makes the contribution unknown.
   */
  const spent = sum(
    context.costs.network,
    manualAmount("rpcData"),
    manualAmount("workers"),
    manualAmount("signing"),
    modelSpend,
    manualAmount("delivery"),
    manualAmount("support"),
    context.rewards.cashback,
    context.rewards.friends,
    context.costs.growth,
  );
  const contribution = less(sum(context.revenue, credits), spent);
  const gross = figure(grossTotal);
  const share = contribution.usd !== null && gross.usd !== null && gross.usd > 0 && !contribution.atMost && !contribution.atLeast && !gross.atLeast ? contribution.usd / gross.usd : null;

  return {
    gross,
    sources,
    notAdded: { claimed: figure(context.claimed), claimable: figure(context.claimable), budget: figure(context.budget), creators: figure(context.creators) },
    costs,
    contribution,
    share,
    incentives: incentivesOf(inputs, operations),
    manualRefused,
  };
}

/**
 * Cashback from Ryntra's share: every fee-funded accrual against the operation it names, and that operation's Ryntra
 * share — what reached Ryntra, never the venue's whole fee — as its base, each operation once.
 */
function incentivesOf(inputs: FinanceInputs, operations: readonly FinanceOperation[] | null): MarginIncentives {
  const rewards = inputs.rewards;
  if (!rewards || operations === null) return { base: { usd: null, atLeast: false }, accrued: { usd: null, atLeast: false }, rate: null, grossBaseRows: 0, baseUnknownRows: 0, aboveReceived: false };
  const external = inputs.scope === "external";
  const share = new Map<string, number | null>();
  /* A fee-bearing row of a transaction wins over another row of it (a failed attempt, a second lane). */
  for (const op of operations) {
    if (!op.signature) continue;
    const own = op.status === "CONFIRMED" && op.feeCollected ? op.ryntraUsd : null;
    if (!share.has(op.signature) || (share.get(op.signature) === null && own !== null)) share.set(op.signature, own);
  }
  const base = known(0n);
  const accrued = known(0n);
  const bases = new Set<string>();
  let grossBaseRows = 0;
  let baseUnknownRows = 0;
  for (const entry of rewards.entries) {
    if (external && inputs.internalWallets.has(entry.recipient)) continue;
    if (entry.type !== "CASHBACK" && entry.type !== "REFERRAL_L1" && entry.type !== "REFERRAL_L2" && !(entry.type === "ADJUSTMENT" && entry.window?.startsWith("FIRST_TEN"))) continue;
    if (entry.fundedBy === "budget") continue;
    /* A row not valued yet is owed all the same: what was accrued is then a floor. */
    if (entry.usdMicros === null) {
      accrued.atLeast = true;
      continue;
    }
    const ref = entry.source?.operationRef ?? null;
    const own = ref === null ? undefined : share.get(ref);
    if (own === undefined || own === null) {
      baseUnknownRows += 1;
      continue;
    }
    if (!entry.rules) grossBaseRows += 1;
    accrued.micros += BigInt(entry.usdMicros);
    if (!bases.has(ref!)) {
      bases.add(ref!);
      base.micros += dollarMicros(own);
    }
  }
  if (baseUnknownRows > 0) {
    base.atLeast = true;
    accrued.atLeast = true;
  }
  if (rewards.unparsed > 0) accrued.atLeast = true;
  const rate = base.micros > 0n ? Number(accrued.micros) / Number(base.micros) : null;
  return { base: figure(base), accrued: figure(accrued), rate, grossBaseRows, baseUnknownRows, aboveReceived: accrued.micros > base.micros };
}

/* ------------------------------------------------------------------ the projection */

function line(id: FinanceLineId, total: Amount, check: FinanceCheck, parts: readonly FinancePart[], ledger: bigint | null = null, chain: bigint | null = null): FinanceLine {
  return { id, ...figure(total), check: !total.read && check === "MATCH" ? "UNREAD" : check, parts, ledgerUsd: ledger === null ? null : usd(ledger), chainUsd: chain === null ? null : usd(chain) };
}

const part = (id: string, value: Amount, check: FinanceCheck = "MATCH"): FinancePart => ({ id, ...figure(value), check: !value.read && check === "MATCH" ? "UNREAD" : check });

export function projectFinance(inputs: FinanceInputs): FinanceModel {
  const differences: FinanceDifference[] = [];
  const unread: FinanceUnread[] = [];
  const external = inputs.scope === "external";

  const launches = (inputs.launches ?? []).filter((launch) => !external || !launch.own);
  if (external && !inputs.internalComplete) unread.push({ line: "net", kind: "OWN_WALLETS", subject: "scope" });
  if (inputs.launches === null) unread.push({ line: "earned", kind: "LAUNCH_MARKET", subject: "launch" });
  if (inputs.launchesUnread > 0) unread.push({ line: "earned", kind: "LAUNCHES_NOT_REACHED", subject: "launch", count: inputs.launchesUnread });

  /* The operations the terminal counts — the same rule as its sum: only their own fee leaves a launch's figures. */
  const terminalSignatures = new Set(
    (inputs.operations ?? []).flatMap((op) => (op.signature && op.product !== "LAUNCH" && op.product !== "BRIDGE" && op.status === "CONFIRMED" && op.feeCollected ? [op.signature] : [])),
  );
  const readAtSeconds = Math.floor(Date.parse(inputs.readAt) / 1000);
  const figures = launches.map((launch) => launchFigures(launch, terminalSignatures, readAtSeconds, differences, unread));
  const launchCheck = (key: keyof LaunchFigures["check"]) =>
    figures.reduce<FinanceCheck>((verdict, entry) => worse(verdict, entry.check[key]), inputs.launches === null || inputs.launchesUnread > 0 ? "UNREAD" : "MATCH");
  const totalOf = (pick: (entry: LaunchFigures) => Amount) => (inputs.launches === null ? UNREAD_AMOUNT : sum(...figures.map(pick), inputs.launchesUnread > 0 ? UNREAD_AMOUNT : known(0n)));

  const operations = inputs.operations === null ? null : inputs.operations.filter((op) => !external || !op.internal);
  const launchSignatures = new Set<string>();
  for (const launch of inputs.launches ?? []) {
    for (const trade of launch.trades ?? []) launchSignatures.add(trade.signature);
    for (const claim of launch.claims ?? []) launchSignatures.add(claim.signature);
  }
  const terminal = terminalFigures(inputs, operations, launchSignatures, differences, unread);
  const rewards = rewardFigures(inputs, operations, differences, unread);
  const costs = costFigures(inputs, unread);

  /* earned */
  const bySource = (source: IncomeSource) => totalOf((entry) => entry.earned[source]);
  const launchEarned = sum(...(["curve", "referral", "graduation", "surplus", "lp"] as const).map(bySource));
  const earnedCheck = worse(launchCheck("earned"), terminal.check);
  const earned = sum(launchEarned, terminal.earned);
  const revenue = sum(totalOf((entry) => entry.revenue), terminal.earned);
  const budget = totalOf((entry) => entry.budget);

  /* claimable, claimed, creators */
  const launchClaimable = totalOf((entry) => entry.claimable);
  const claimable = sum(launchClaimable, terminal.claimable);
  const claimed = totalOf((entry) => entry.claimed);
  const creators = totalOf((entry) => entry.creators);
  const ledgerClaimed = figures.some((entry) => entry.ledgerClaimedMicros !== null) ? figures.reduce((total, entry) => total + (entry.ledgerClaimedMicros ?? 0n), 0n) : null;
  const chainClaimedForLedger = figures.filter((entry) => entry.ledgerClaimedMicros !== null).reduce((total, entry) => total + entry.claimed.micros, 0n);

  /* net: revenue less every reward Ryntra owes — paid from its fees or from the growth budget alike — and the costs */
  const rewardsOwed = sum(rewards.cashback, rewards.friends);
  const spent = sum(rewardsOwed, costs.network, costs.growth);
  /* Revenue read in part makes the net a floor; what is taken away read in part makes it a ceiling; both — unknown. */
  const netBoth = (revenue.atLeast || !revenue.read) && (spent.atLeast || !spent.read);
  const net: Amount = { micros: revenue.micros - spent.micros, atLeast: revenue.atLeast && !netBoth, read: revenue.read && spent.read && !netBoth };
  const netAtMost = !netBoth && (spent.atLeast || !spent.read) && revenue.read;
  const netCheck = worse(worse(earnedCheck, worse(rewards.cashbackCheck, rewards.friendsCheck)), costs.check);

  const lines: Record<FinanceLineId, FinanceLine> = {
    earned: line(
      "earned",
      earned,
      earnedCheck,
      [
        part("curve", bySource("curve"), launchCheck("earned")),
        part("referral", bySource("referral"), launchCheck("earned")),
        part("graduation", bySource("graduation"), launchCheck("claimed")),
        part("surplus", bySource("surplus"), launchCheck("claimed")),
        part("lp", bySource("lp"), launchCheck("claimed")),
        part("terminal", terminal.earned, terminal.check),
      ],
      terminal.ledgerMicros,
      terminal.chainMicros,
    ),
    claimable: line("claimable", claimable, worse(launchCheck("claimable"), terminal.claimableCheck), [part("launch", launchClaimable, launchCheck("claimable")), part("terminalReferral", terminal.claimable, terminal.claimableCheck)]),
    claimed: line("claimed", claimed, launchCheck("claimed"), [part("launch", claimed, launchCheck("claimed"))], ledgerClaimed, ledgerClaimed === null ? null : chainClaimedForLedger),
    creators: line("creators", creators, launchCheck("creators"), [part("launch", creators, launchCheck("creators"))]),
    cashback: line("cashback", rewards.cashback, rewards.cashbackCheck, [part("accrued", rewards.cashback, rewards.cashbackCheck), part("paidOut", rewards.payouts, rewards.cashbackCheck)], rewards.ledgerPaidMicros, rewards.chainPaidMicros),
    referrals: line("referrals", rewards.friends, rewards.friendsCheck, [part("accrued", rewards.friends, rewards.friendsCheck), part("fromBudget", rewards.fromBudget)]),
    costs: line(
      "costs",
      sum(costs.network, costs.growth),
      costs.check,
      [part("executor", costs.byRole.executor, costs.check), part("payer", costs.byRole.payer, costs.check), part("rewards", costs.byRole.rewards, costs.check), part("growth", costs.growth)],
      costs.ledgerMicros,
      costs.chainMicros,
    ),
    net: line("net", net, worse(netCheck, netAtMost || netBoth ? "UNREAD" : "MATCH"), [part("revenue", revenue, earnedCheck), part("rewards", rewardsOwed, worse(rewards.cashbackCheck, rewards.friendsCheck)), part("costs", sum(costs.network, costs.growth), costs.check)]),
  };

  const metrics = metricsOf(inputs, launches, figures.map((entry) => entry.revenue), operations);
  const notValued = figures.reduce((total, entry) => total + entry.notValued, 0);
  if (netAtMost) lines.net = { ...lines.net, atLeast: false, atMost: true };
  return {
    generatedAt: inputs.now,
    readAt: inputs.readAt,
    scope: inputs.scope,
    lines,
    split: { revenue: figure(revenue), budget: figure(budget), notValued },
    differences,
    unread,
    launches: figures.map((entry) => entry.row),
    metrics,
    margin: marginOf({ inputs, operations, figures, totalOf, revenue, claimed, claimable, budget, creators, rewards, costs }),
    success: projectSuccess({ now: inputs.now, scope: inputs.scope, internalWallets: inputs.internalWallets, operations, success: inputs.success ?? null }),
    allMatched: differences.length === 0 && unread.length === 0 && Object.values(lines).every((entry) => entry.check === "MATCH"),
  };
}
