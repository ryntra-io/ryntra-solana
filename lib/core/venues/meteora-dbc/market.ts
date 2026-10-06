/**
 * A Ryntra launch's market as the chain shows it — the pure half.
 *
 * Every number here comes from the programs' own record: each trade is the
 * swap event Meteora's program wrote (DBC on the curve, DAMM v2 after it), with
 * the price it left behind; each balance is a token account read now. This
 * module only arranges them — the price and market cap, the labels a holder
 * earns by what they did, the facts of risk with what each rests on, the chart
 * — and never adds a verdict: no «safe», no «guaranteed», only what happened
 * and where anyone can see it.
 *
 * Labels, by what a wallet did on this token's curve:
 * - **creator** — the curve's creator, as the curve names it;
 * - **bundle** — another wallet that bought in the same block as the creation,
 *   or whose purchase the creator's wallet paid for as the swap's payer: the
 *   creator's first purchase is capped in the creation itself (a Ryntra rule),
 *   and a second wallet is how a cap is walked around, so it is shown. A second
 *   wallet the creator first funded by a transfer, which then buys on its own,
 *   is not seen by this rule;
 * - **sniper** — bought in the first two minutes after the curve opened, before
 *   the market had a chance to form;
 * - **curve**, **pool**, **lock** — not people: the curve's vault, the
 *   graduated pool's vault, the creator's lock.
 *
 * Pure and client-safe: no clock unless given, no network.
 */

export const LAUNCH_HOLDER_LABELS = ["creator", "sniper", "bundle", "curve", "pool", "lock"] as const;
export type LaunchHolderLabel = (typeof LAUNCH_HOLDER_LABELS)[number];

/** A buyer in this many seconds after the curve opened is a sniper. */
export const SNIPER_SECONDS = 120;

export const LAUNCH_TRADE_SIDES = ["buy", "sell"] as const;
export type LaunchTradeSide = (typeof LAUNCH_TRADE_SIDES)[number];

/** Where a trade ran: on the bonding curve, or in the DAMM v2 pool it graduated into. */
export const LAUNCH_TRADE_VENUES = ["curve", "pool"] as const;
export type LaunchTradeVenue = (typeof LAUNCH_TRADE_VENUES)[number];

/** One trade, from the program's swap event. Amounts raw; the price after it in the pair currency per token. */
export type LaunchTrade = Readonly<{
  signature: string;
  slot: number;
  /** Unix seconds — the program's own clock in the event. */
  at: number;
  side: LaunchTradeSide;
  venue: LaunchTradeVenue;
  /** Whose tokens moved: the owner of the account that received them on a buy, that gave them on a sale. */
  trader: string;
  /** Who paid for it: the swap's signer, or the transaction's fee payer when the swap ran inside another program. */
  payer: string;
  /** The trader's token account the tokens went into on a buy, came out of on a sale — where they are held, whatever its kind. */
  account: string | null;
  tokensRaw: string;
  /** What the buyer paid in the pair currency, every fee included; what the seller received, every fee taken. */
  pairRaw: string;
  /** Every fee of the trade in the pair currency: the curve's or the pool's, Meteora's, the referral, Ryntra's own in the same transaction. */
  feeRaw: string;
  /** The price the trade left, pair currency per token. */
  priceAfter: number;
}>;

/** One swap as its transaction shows it — the program's event and the accounts its instruction named — before it is a trade. */
export type SwapSeen = Readonly<{
  signature: string;
  slot: number;
  at: number;
  venue: LaunchTradeVenue;
  side: LaunchTradeSide;
  /** The swap's input with its own fee, and its output — raw, as the event says. */
  inRaw: bigint;
  outRaw: bigint;
  /** The swap's own fees in the pair currency. */
  feesRaw: bigint;
  /** The swap's input and output token accounts and their owners as the transaction's balances name them; null where not named. */
  input: Readonly<{ account: string | null; owner: string | null }>;
  output: Readonly<{ account: string | null; owner: string | null }>;
  payer: string;
  /** Ryntra's own fee moved into its fee wallet in the same transaction, raw in the pair currency; 0 when none. */
  ryntraFeeRaw: bigint;
  priceAfter: number;
}>;

/**
 * A swap as a trade. The trader is whose tokens moved — the owner of the account that received them on a buy, that gave
 * them on a sale — not who signed: a creator who pays for a buy delivered to another wallet is the payer, and the other
 * wallet the trader. What moved in the pair currency includes Ryntra's own fee of the same transaction: what the buyer
 * paid in all, what the seller kept in all.
 */
export function tradeOf(seen: SwapSeen): LaunchTrade {
  const buy = seen.side === "buy";
  const tokens = buy ? seen.output : seen.input;
  const pair = buy ? seen.inRaw + seen.ryntraFeeRaw : seen.outRaw - seen.ryntraFeeRaw;
  return {
    signature: seen.signature,
    slot: seen.slot,
    at: seen.at,
    side: seen.side,
    venue: seen.venue,
    trader: tokens.owner ?? seen.payer,
    payer: seen.payer,
    account: tokens.account,
    tokensRaw: (buy ? seen.outRaw : seen.inRaw).toString(),
    pairRaw: (pair > 0n ? pair : 0n).toString(),
    feeRaw: (seen.feesRaw + seen.ryntraFeeRaw).toString(),
    priceAfter: seen.priceAfter,
  };
}

/**
 * The price a Q64.64 square root names, quote per base in whole units:
 * `(sqrt / 2^64)^2 · 10^(baseDecimals − quoteDecimals)`. A float: for showing
 * and charting, never for an amount anyone is paid.
 */
export function priceFromSqrtX64(sqrtPriceX64: bigint | string, baseDecimals: number, quoteDecimals: number): number {
  const sqrt = Number(BigInt(sqrtPriceX64)) / 2 ** 64;
  return sqrt * sqrt * 10 ** (baseDecimals - quoteDecimals);
}

/** A raw amount in whole units, as a float — for figures and charts only. */
export function uiAmount(raw: bigint | string, decimals: number): number {
  return Number(BigInt(raw)) / 10 ** decimals;
}

/** A share in basis points of a whole, rounded down; 0 of nothing. */
export function shareBps(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  return Number((part * 10_000n) / whole);
}

/**
 * The labels each wallet earns by what it did on this curve. `createdSlot` and
 * `createdAt` are the creation's block and time; unknown, no wallet is called a
 * bundle or a sniper on a guess.
 */
export function walletLabels(
  args: Readonly<{ trades: readonly LaunchTrade[]; creator: string; createdSlot: number | null; createdAt: number | null }>,
): Map<string, LaunchHolderLabel[]> {
  const labels = new Map<string, LaunchHolderLabel[]>();
  const add = (wallet: string, label: LaunchHolderLabel) => {
    const list = labels.get(wallet) ?? [];
    if (!list.includes(label)) list.push(label);
    labels.set(wallet, list);
  };
  add(args.creator, "creator");
  for (const trade of args.trades) {
    if (trade.side !== "buy" || trade.trader === args.creator) continue;
    /* Tokens the creator paid for, delivered to another wallet: the creator's second wallet, wherever and whenever. */
    if (trade.payer === args.creator) add(trade.trader, "bundle");
    if (trade.venue !== "curve") continue;
    if (args.createdSlot !== null && trade.slot === args.createdSlot) add(trade.trader, "bundle");
    else if (args.createdAt !== null && trade.at - args.createdAt < SNIPER_SECONDS) add(trade.trader, "sniper");
  }
  return labels;
}

/** What the creator did with the token: bought (the first purchase included), sold, and each sale. */
export type CreatorActivity = Readonly<{
  boughtRaw: bigint;
  soldRaw: bigint;
  sales: readonly LaunchTrade[];
}>;

export function creatorActivity(trades: readonly LaunchTrade[], creator: string): CreatorActivity {
  let boughtRaw = 0n;
  let soldRaw = 0n;
  const sales: LaunchTrade[] = [];
  for (const trade of trades) {
    if (trade.trader !== creator) continue;
    if (trade.side === "buy") boughtRaw += BigInt(trade.tokensRaw);
    else {
      soldRaw += BigInt(trade.tokensRaw);
      sales.push(trade);
    }
  }
  return { boughtRaw, soldRaw, sales };
}

/**
 * How much the creator sold: the share of what they bought here, or — when they sold more than they bought here, the
 * rest having come to them another way — the share of the supply. Null when they sold nothing. Never «100 %» on a guess.
 */
export function creatorSoldShare(activity: CreatorActivity, supplyRaw: bigint): Readonly<{ bps: number; of: "bought" | "supply" }> | null {
  if (activity.soldRaw <= 0n) return null;
  return activity.soldRaw <= activity.boughtRaw ? { bps: shareBps(activity.soldRaw, activity.boughtRaw), of: "bought" } : { bps: shareBps(activity.soldRaw, supplyRaw), of: "supply" };
}

/** A holder as the page lists it. */
export type LaunchHolder = Readonly<{ owner: string; amountRaw: string; shareBps: number; labels: readonly LaunchHolderLabel[] }>;

/** The shares of the labelled groups, people only. */
export type HolderGroups = Readonly<{
  creator: Readonly<{ shareBps: number }>;
  snipers: Readonly<{ shareBps: number; wallets: number }>;
  bundle: Readonly<{ shareBps: number; wallets: number }>;
  /** The ten largest holders that are people — not the curve, the pool or the lock. */
  top10: Readonly<{ shareBps: number }>;
}>;

const NOT_PEOPLE: ReadonlySet<LaunchHolderLabel> = new Set(["curve", "pool", "lock"]);

export function isPerson(holder: Pick<LaunchHolder, "labels">): boolean {
  return !holder.labels.some((label) => NOT_PEOPLE.has(label));
}

/**
 * What the people hold, the creator's lock counted as the creator's: the
 * tokens in it are theirs, only not yet free — so the creator's share and the
 * ten largest include it, and a creator whose whole buy is locked is still a
 * holder.
 */
export function peopleHoldings(holders: readonly LaunchHolder[]): Readonly<{ amountRaw: bigint; labels: readonly LaunchHolderLabel[] }>[] {
  const locked = holders.filter((holder) => holder.labels.includes("lock")).reduce((total, holder) => total + BigInt(holder.amountRaw), 0n);
  const people = holders.filter(isPerson).map((holder) => ({ amountRaw: BigInt(holder.amountRaw), labels: holder.labels }));
  if (locked > 0n) {
    const creator = people.find((holder) => holder.labels.includes("creator"));
    if (creator) creator.amountRaw += locked;
    else people.push({ amountRaw: locked, labels: ["creator"] });
  }
  return people.filter((holder) => holder.amountRaw > 0n).sort((a, b) => (b.amountRaw > a.amountRaw ? 1 : b.amountRaw < a.amountRaw ? -1 : 0));
}

export function holderGroups(holders: readonly LaunchHolder[], supplyRaw: bigint): HolderGroups {
  const people = peopleHoldings(holders);
  const sum = (filter: (holder: (typeof people)[number]) => boolean) => people.filter(filter).reduce((total, holder) => total + holder.amountRaw, 0n);
  const count = (filter: (holder: (typeof people)[number]) => boolean) => people.filter(filter).length;
  const sniper = (holder: (typeof people)[number]) => holder.labels.includes("sniper");
  const bundle = (holder: (typeof people)[number]) => holder.labels.includes("bundle");
  return {
    creator: { shareBps: shareBps(sum((holder) => holder.labels.includes("creator")), supplyRaw) },
    snipers: { shareBps: shareBps(sum(sniper), supplyRaw), wallets: count(sniper) },
    bundle: { shareBps: shareBps(sum(bundle), supplyRaw), wallets: count(bundle) },
    top10: { shareBps: shareBps(people.slice(0, 10).reduce((total, holder) => total + holder.amountRaw, 0n), supplyRaw) },
  };
}

export const LAUNCH_RISK_CODES = [
  "CREATOR_SOLD",
  "CREATOR_HOLDS",
  "BUNDLE_HOLDS",
  "SNIPERS_HOLD",
  "TOP10_HOLD",
  "FEW_HOLDERS",
  "HOLDERS_UNCOUNTED",
  "YOUNG",
  "CREATOR_OTHER_CURVES",
  "OPENING_UNREAD",
  "HISTORY_PARTIAL",
] as const;
export type LaunchRiskCode = (typeof LAUNCH_RISK_CODES)[number];

/**
 * How a fact reads beside the others: `attention` — worth a look before a
 * trade; `info` — context. Never a verdict on the token.
 */
export type LaunchRiskLevel = "attention" | "info";

export type LaunchRiskFact = Readonly<{
  code: LaunchRiskCode;
  level: LaunchRiskLevel;
  /** The figures the words are built from: shares in basis points, counts, times as unix seconds. */
  values: Readonly<Record<string, number>>;
  /** Where anyone can see it on chain: the transaction or the account; null when it is a count over many. */
  source: Readonly<{ kind: "tx" | "account"; id: string }> | null;
}>;

/** The thresholds a fact turns from context into worth a look; each is said in the words beside it. */
export const RISK_THRESHOLDS = Object.freeze({
  /** The ten largest people holding this much of the supply move the price alone. */
  top10Bps: 3_000,
  /** A creator holding this much can move the price alone. */
  creatorBps: 500,
  /** Fewer holders than this is a thin market. */
  fewHolders: 20,
  /** Younger than this, a token has no history to read. */
  youngSeconds: 24 * 60 * 60,
});

/**
 * The facts of risk with their reasons — what the chain shows, never what it
 * means for the person.
 *
 * - «The creator sold» is the share of the tokens the creator bought that they
 *   sold; when they sold more than they bought here (tokens that came to them
 *   another way), it is the share of the supply instead — never «100 %» on a
 *   guess.
 * - Snipers and the bundle are said only when the token's opening minutes were
 *   read; otherwise `OPENING_UNREAD` says so. A buy the creator's wallet paid
 *   for can come later, so when neither the history nor the creator's own
 *   accounts were read whole the bundle is a floor (`atLeast`).
 * - «Few holders» is said only on a whole count: a lower bound proves nothing
 *   thin, and `HOLDERS_UNCOUNTED` says the count is only «at least».
 */
export function launchRiskFacts(
  args: Readonly<{
    creator: string;
    /** The creator's token account, where what they hold is seen. */
    creatorAccount: string;
    activity: CreatorActivity;
    groups: HolderGroups;
    supplyRaw: bigint;
    /** Whether the token's opening minutes — the snipers' and the bundle's trades — were read. */
    openingRead: boolean;
    holders: Readonly<{ count: number; atLeast: boolean }>;
    createdAt: number | null;
    now: number;
    historyComplete: boolean;
    /**
     * Whether every buy that makes the bundle was read: the creation's block and every buy the creator's wallet paid
     * for — read whole when the history was, or when the creator's own accounts were.
     */
    bundleWhole: boolean;
    tradesRead: number;
    /** DBC curves this creator opened anywhere, this one included; null when it could not be read. */
    creatorCurves: number | null;
  }>,
): LaunchRiskFact[] {
  const facts: LaunchRiskFact[] = [];
  const { activity, groups } = args;
  const sold = creatorSoldShare(activity, args.supplyRaw);
  if (sold) {
    const last = activity.sales.at(-1);
    facts.push({
      code: "CREATOR_SOLD",
      level: "attention",
      values: {
        ...(sold.of === "bought" ? { soldBps: sold.bps } : { supplyBps: sold.bps }),
        sales: activity.sales.length,
        at: last?.at ?? 0,
      },
      source: last ? { kind: "tx", id: last.signature } : null,
    });
  }
  facts.push({
    code: "CREATOR_HOLDS",
    level: groups.creator.shareBps >= RISK_THRESHOLDS.creatorBps ? "attention" : "info",
    values: { shareBps: groups.creator.shareBps },
    source: { kind: "account", id: args.creatorAccount },
  });
  if (args.openingRead) {
    /* A buy the creator's wallet paid for can come at any time: on a history read in part the bundle is a floor. */
    if (groups.bundle.wallets > 0) {
      facts.push({ code: "BUNDLE_HOLDS", level: "attention", values: { shareBps: groups.bundle.shareBps, wallets: groups.bundle.wallets, ...(args.bundleWhole ? {} : { atLeast: 1 }) }, source: null });
    }
    if (groups.snipers.wallets > 0) facts.push({ code: "SNIPERS_HOLD", level: groups.snipers.shareBps > 0 ? "attention" : "info", values: { shareBps: groups.snipers.shareBps, wallets: groups.snipers.wallets }, source: null });
  } else {
    facts.push({ code: "OPENING_UNREAD", level: "info", values: {}, source: null });
  }
  facts.push({ code: "TOP10_HOLD", level: groups.top10.shareBps >= RISK_THRESHOLDS.top10Bps ? "attention" : "info", values: { shareBps: groups.top10.shareBps }, source: null });
  if (!args.holders.atLeast && args.holders.count < RISK_THRESHOLDS.fewHolders) facts.push({ code: "FEW_HOLDERS", level: "attention", values: { count: args.holders.count }, source: null });
  /* Not counted whole: the figure is a floor, and silence would read as «enough». */
  if (args.holders.atLeast) facts.push({ code: "HOLDERS_UNCOUNTED", level: "info", values: { count: args.holders.count }, source: null });
  if (args.createdAt !== null && args.now - args.createdAt < RISK_THRESHOLDS.youngSeconds) {
    facts.push({ code: "YOUNG", level: "info", values: { seconds: Math.max(0, args.now - args.createdAt) }, source: null });
  }
  /* A count over many curves: the creator's launches on Ryntra are listed beside it, each with its own link. */
  if (args.creatorCurves !== null && args.creatorCurves > 1) facts.push({ code: "CREATOR_OTHER_CURVES", level: "info", values: { count: args.creatorCurves - 1 }, source: null });
  /* Context, said beside the facts worth a look: an unknown is not a finding. */
  if (!args.historyComplete) facts.push({ code: "HISTORY_PARTIAL", level: "info", values: { trades: args.tradesRead }, source: null });
  /* The facts worth a look first, each group in the order above. */
  return [...facts.filter((fact) => fact.level === "attention"), ...facts.filter((fact) => fact.level === "info")];
}
/**
 * Whether a figure over a window from `since` (unix seconds) — the day's volume — was counted from every trade in it:
 * the history was read whole, or its lists reach back past `since` and no transaction listed since then went unread.
 * Never judged from the oldest trade read: the creation is read first, and its buy is the oldest of any partial read.
 */
type Listed = Readonly<{ signature: string }>;

/**
 * Whether the curve's and the graduated pool's signature lists reach their first transaction. A list is whole when it
 * holds its account's first — not when it is shorter than asked: a node that keeps a day of history returns a short list
 * for an older token. The curve's first is the token's creation; the pool's first is the migration, which the curve's
 * whole list holds too. `pool`: null before the token graduated.
 */
export function listsWhole(args: Readonly<{ curve: readonly Listed[]; pool: readonly Listed[] | null; creationSignature: string; limit: number }>): Readonly<{ curveWhole: boolean; poolWhole: boolean }> {
  const curveWhole = args.curve.length < args.limit && args.curve.some((entry) => entry.signature === args.creationSignature);
  if (args.pool === null) return { curveWhole, poolWhole: true };
  const oldestPool = args.pool.at(-1);
  const curveListed = new Set(args.curve.map((entry) => entry.signature));
  return { curveWhole, poolWhole: curveWhole && args.pool.length < args.limit && oldestPool !== undefined && curveListed.has(oldestPool.signature) };
}

/**
 * Whether one account's newest page of signatures reaches past the token's opening, so every trade of the token through
 * that account is on it: the page holds the creation, or a transaction older than `since` (unix seconds), or the
 * account's whole history (`whole`: a short page from the endpoint that keeps it all). A transaction just after the
 * opening proves nothing — the creator's buys of the first seconds may sit beyond the page.
 */
export function accountPageReached(
  args: Readonly<{ page: readonly Readonly<{ signature: string; blockTime?: number | null }>[]; whole: boolean; creationSignature: string | null; since: number | null }>,
): boolean {
  if (args.whole) return true;
  if (args.creationSignature !== null && args.page.some((entry) => entry.signature === args.creationSignature)) return true;
  const since = args.since;
  return since !== null && args.page.some((entry) => typeof entry.blockTime === "number" && entry.blockTime < since);
}

export function windowReadWhole(history: Readonly<{ complete: boolean; coveredFrom: number | null; gaps: readonly number[] }>, since: number): boolean {
  if (history.complete) return true;
  return (history.coveredFrom === null || history.coveredFrom < since) && history.gaps.every((at) => at < since);
}

/** A point of the chart: a time in unix seconds and the market cap in dollars. */
export type MarketPoint = Readonly<{ t: number; marketCapUsd: number }>;

export const LAUNCH_CHART_MARKERS = ["creator-buy", "creator-sell", "graduated"] as const;
export type LaunchChartMarker = Readonly<{ t: number; kind: (typeof LAUNCH_CHART_MARKERS)[number]; signature: string }>;

/**
 * The market cap after each trade — one point a second (the last trade of a
 * second wins, as a chart keeps one value a time) — from the launch's opening
 * price, and on to now at the price now.
 */
export function marketSeries(
  args: Readonly<{ trades: readonly LaunchTrade[]; openedAt: number | null; openingPrice: number | null; priceNow: number | null; now: number; supply: number; pairUsd: number | null }>,
): MarketPoint[] {
  if (args.pairUsd === null) return [];
  const mc = (price: number) => price * args.supply * (args.pairUsd ?? 0);
  const bySecond = new Map<number, number>();
  if (args.openedAt !== null && args.openingPrice !== null) bySecond.set(args.openedAt, mc(args.openingPrice));
  for (const trade of [...args.trades].sort((a, b) => a.at - b.at || a.slot - b.slot)) bySecond.set(trade.at, mc(trade.priceAfter));
  const points = [...bySecond.entries()].sort((a, b) => a[0] - b[0]).map(([t, marketCapUsd]) => ({ t, marketCapUsd }));
  const last = points.at(-1);
  if (args.priceNow !== null && last && args.now > last.t) points.push({ t: args.now, marketCapUsd: mc(args.priceNow) });
  return points;
}

/** The creator's trades and the graduation, as marks on the chart. */
export function chartMarkers(trades: readonly LaunchTrade[], creator: string, graduatedAt: Readonly<{ at: number; signature: string }> | null): LaunchChartMarker[] {
  const marks: LaunchChartMarker[] = trades
    .filter((trade) => trade.trader === creator)
    .map((trade) => ({ t: trade.at, kind: trade.side === "buy" ? ("creator-buy" as const) : ("creator-sell" as const), signature: trade.signature }));
  if (graduatedAt) marks.push({ t: graduatedAt.at, kind: "graduated", signature: graduatedAt.signature });
  return marks.sort((a, b) => a.t - b.t);
}

/**
 * Who a trade's fee goes to, in the pair currency. On the curve: the trading
 * fee splits between the creator (`creatorPct` of it) and Ryntra as the
 * config's partner, Meteora keeps the protocol fee, and the referral — Ryntra,
 * when the trade comes through Ryntra — a fifth of Meteora's. In the graduated
 * pool the fee goes to the pool's liquidity (the creator's and Ryntra's locked
 * positions, a share compounded back), Meteora's protocol fee and the referral.
 */
export type LaunchFeeSplit = Readonly<{ totalRaw: string; creatorRaw: string | null; ryntraRaw: string; meteoraRaw: string; liquidityRaw: string | null }>;

export function curveFeeSplit(args: Readonly<{ tradingFeeRaw: bigint; protocolFeeRaw: bigint; referralFeeRaw: bigint; creatorPct: number }>): LaunchFeeSplit {
  const creator = (args.tradingFeeRaw * BigInt(args.creatorPct)) / 100n;
  return {
    totalRaw: (args.tradingFeeRaw + args.protocolFeeRaw + args.referralFeeRaw).toString(),
    creatorRaw: creator.toString(),
    ryntraRaw: (args.tradingFeeRaw - creator + args.referralFeeRaw).toString(),
    meteoraRaw: args.protocolFeeRaw.toString(),
    liquidityRaw: null,
  };
}

export function poolFeeSplit(args: Readonly<{ claimingFeeRaw: bigint; compoundingFeeRaw: bigint; protocolFeeRaw: bigint; referralFeeRaw: bigint }>): LaunchFeeSplit {
  return {
    totalRaw: (args.claimingFeeRaw + args.compoundingFeeRaw + args.protocolFeeRaw + args.referralFeeRaw).toString(),
    creatorRaw: null,
    ryntraRaw: args.referralFeeRaw.toString(),
    meteoraRaw: args.protocolFeeRaw.toString(),
    liquidityRaw: (args.claimingFeeRaw + args.compoundingFeeRaw).toString(),
  };
}

/** The change between two prices in basis points, signed; 0 when either is unknown. */
export function priceMoveBps(before: number, after: number): number {
  if (!(before > 0) || !(after > 0)) return 0;
  return Math.round((after / before - 1) * 10_000);
}
