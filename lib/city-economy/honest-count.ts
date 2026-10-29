import { fundingLink, PROTECT_RULES, type PartyAncestry } from "../growth/protect.ts";
import { weekRange, weekStartOf, within, type WeekRange } from "../growth/weeks.ts";
import type { WorldEvent } from "../world/contract.ts";

/**
 * The city's honest count: which trades the city may count, and why not.
 *
 * The city pays nothing of its own. What it gives for a trade is standing —
 * points, a place on a billboard, the score of a district war, a prestige
 * street — and, through the engine's own shares, the quarter host's part. All
 * of these are worth faking, and the cheapest fake is to trade with yourself
 * from a second wallet. So the rule is one:
 *
 * **a trade counts for nothing when the buyer and anyone it would credit —
 * the coin's creator, the quarter's host, the friend named on the trade — are
 * one wallet cluster.**
 *
 * ## What makes a trade «inside»
 *
 * Checked here, because the trade itself shows it:
 * - the same wallet — the buyer is the creator, the host or the friend;
 * - the same signer — the transaction was signed by one of them, whoever the
 *   buyer is said to be.
 *
 * Checked by the Growth line, which reads the chain and the devices
 * (`lib/growth/protect.ts`): a shared funder, money between the two, a shared
 * withdrawal address, a shared device, a wallet linked to the other. The city
 * only asks the question («are these two one cluster?») through
 * {@link WalletClusters} and never reads the evidence.
 *
 * ## Not known means not counted
 *
 * Until the Growth line answers, every pair is «not known», and a trade that
 * is not known to be between two people counts for nothing. That is also why
 * the host's part stays off: it can only ever be paid on a trade the check
 * has seen as outside.
 *
 * A trade that names nobody besides the buyer — no creator, no host, no
 * friend — has no pair to check, so nothing shows it is between two people:
 * one wallet buying and selling back to itself looks just like it. It is not
 * known, and counts for nothing (`no_party`) until a check of the buyer's own
 * round trips exists.
 *
 * ## One trade is one trade
 *
 * The amount only decides whether a trade is real activity at all — at least
 * a dollar, the same floor the Growth line uses for an activated creator. It
 * never weighs anything: the answer carries no amount, so nothing built on it
 * can add up volume, and nothing here knows how many coins anyone launched.
 *
 * Pure apart from {@link judgeCityTrade}, which only waits for the answers.
 */

export const HONEST_COUNT_VERSION = "city-honest-1.0.0";

/** What the city could count a trade in. */
export const CITY_USES = ["points", "billboards", "war", "prestige", "host_share"] as const;
export type CityUse = (typeof CITY_USES)[number];

/** Whom a trade would credit besides the buyer. */
export const TRADE_PARTIES = ["creator", "host", "friend"] as const;
export type TradeParty = (typeof TRADE_PARTIES)[number];

/** The least trade that is activity — the Growth line's floor of one dollar, read from its rules. */
export const MIN_TRADE_USD_MICROS: bigint = PROTECT_RULES.activation.minTradeUsdMicros;

export type CityTrade = Readonly<{
  /** The transaction's signature. */
  tx: string;
  /** When it happened on chain. */
  at: string;
  /** The coin. */
  mint: string;
  /** The wallet that bought. */
  buyer: string;
  /** Every wallet that signed the transaction, the fee payer first. */
  signers: readonly string[];
  /** The coin's creator; null when the coin was not launched through Ryntra. */
  creator: string | null;
  /** The owner of the quarter the trade started in; null when it started elsewhere. */
  host: string | null;
  /** The friend the engine credits on this trade; null when nobody is. */
  friend: string | null;
  /** The dollar side of the trade; null when the pair has no dollar figure. */
  usdMicros: bigint | null;
}>;

/* ------------------------------------------------------------------------------------------------
 * What the city needs from the Growth line
 * --------------------------------------------------------------------------------------------- */

/** Why the Growth line sees two wallets as one person. */
export const CLUSTER_REASONS = ["shared_funder", "direct_funds", "shared_withdrawal", "shared_device", "linked_wallet"] as const;
export type ClusterReason = (typeof CLUSTER_REASONS)[number];

/**
 * The answer about two wallets at a moment:
 * - `same` — one cluster, and the strongest reason;
 * - `separate` — every check ran on both and found nothing;
 * - `unknown` — something could not be read, or there is no check yet.
 * `rules` names the Growth line's rules that gave the answer.
 */
export type ClusterVerdict =
  | Readonly<{ verdict: "same"; reason: ClusterReason; rules: string }>
  | Readonly<{ verdict: "separate"; rules: string }>
  | Readonly<{ verdict: "unknown"; why: string }>;

/** The one question the city asks: were `a` and `b` one cluster at `at`? Read-only on the Growth side. */
export type WalletClusters = Readonly<{ check(a: string, b: string, at: string): Promise<ClusterVerdict> }>;

/** Until the Growth line answers: every pair is not known, so no trade counts. */
export const NO_CLUSTER_CHECK: WalletClusters = Object.freeze({
  check: async (): Promise<ClusterVerdict> => ({ verdict: "unknown", why: "no_check" }),
});

/**
 * What the Growth line's funding trail already says about two wallets: one
 * funded the other, or both share a source that is not an exchange. A clean
 * trail is no proof of two people — devices and withdrawals are not in it —
 * so this never answers `separate`.
 */
export function fundingVerdict(left: PartyAncestry, right: PartyAncestry): ClusterVerdict {
  const link = fundingLink(left, right);
  if (link === "DIRECT") return { verdict: "same", reason: "direct_funds", rules: PROTECT_RULES.version };
  if (link === "SHARED") return { verdict: "same", reason: "shared_funder", rules: PROTECT_RULES.version };
  return { verdict: "unknown", why: "funding_only" };
}

/* ------------------------------------------------------------------------------------------------
 * The rules
 * --------------------------------------------------------------------------------------------- */

/** Why a trade is inside one cluster. */
export type InsideWhy = "same_wallet" | "same_signer" | ClusterReason;

/** Why a trade is not counted in a use, the first that applies. */
export const NOT_COUNTED = ["malformed", "self_trade", "same_signer", "cluster", "no_party", "unverified", "no_amount", "dust", "no_host"] as const;
export type NotCounted = (typeof NOT_COUNTED)[number];

export type UseVerdict = Readonly<{ counted: true }> | Readonly<{ counted: false; reason: NotCounted }>;

export type TradeJudgement = Readonly<{
  tx: string;
  /** When the trade happened on chain, as the trade says; the week it counts in. */
  at: string;
  /** The fact about the trade: between two people, inside one cluster, or not known. */
  cluster: "outside" | "inside" | "unknown";
  /** Inside: which party and why. */
  inside: Readonly<{ party: TradeParty; why: InsideWhy }> | null;
  counts: Readonly<Record<CityUse, UseVerdict>>;
  rules: string;
}>;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

function readable(trade: CityTrade): boolean {
  if (!Array.isArray(trade.signers) || trade.signers.length === 0) return false;
  const named = [trade.creator, trade.host, trade.friend].filter((wallet) => wallet !== null);
  return (
    typeof trade.tx === "string" && SIGNATURE.test(trade.tx) &&
    typeof trade.at === "string" && Number.isFinite(Date.parse(trade.at)) &&
    [trade.buyer, trade.mint, ...trade.signers, ...named].every((wallet) => typeof wallet === "string" && SOLANA_ADDRESS.test(wallet)) &&
    (trade.usdMicros === null || (typeof trade.usdMicros === "bigint" && trade.usdMicros >= 0n))
  );
}

/** The parties a trade names, each with its wallet. */
function partiesOf(trade: CityTrade): Array<{ party: TradeParty; wallet: string }> {
  return TRADE_PARTIES.flatMap((party) => (trade[party] === null ? [] : [{ party, wallet: trade[party] }]));
}

/** The wallets acting on the trade: the buyer, then every signer that is not the buyer. */
function actorsOf(trade: CityTrade): string[] {
  return [...new Set([trade.buyer, ...trade.signers])];
}

/** When a trade is inside for more than one reason, the plainest one is named. */
const STRONGEST: readonly InsideWhy[] = ["same_wallet", "same_signer", "direct_funds", "linked_wallet", "shared_device", "shared_withdrawal", "shared_funder"];

function judged(trade: CityTrade, cluster: TradeJudgement["cluster"], inside: TradeJudgement["inside"], reason: NotCounted | null): TradeJudgement {
  const counts = Object.fromEntries(
    CITY_USES.map((use): [CityUse, UseVerdict] => {
      if (reason) return [use, { counted: false, reason }];
      if (use === "host_share" && trade.host === null) return [use, { counted: false, reason: "no_host" }];
      return [use, { counted: true }];
    }),
  ) as Record<CityUse, UseVerdict>;
  return {
    tx: typeof trade.tx === "string" ? trade.tx : "",
    at: typeof trade.at === "string" ? trade.at : "",
    cluster,
    inside,
    counts,
    rules: HONEST_COUNT_VERSION,
  };
}

/**
 * Judge one trade with the Growth line's answers already in hand: `verdictOf(actor, wallet)` for each acting wallet
 * and each party's wallet that is not the same wallet.
 */
export function judgeTrade(trade: CityTrade, verdictOf: (actor: string, wallet: string) => ClusterVerdict): TradeJudgement {
  if (!readable(trade)) return judged(trade, "unknown", null, "malformed");
  const parties = partiesOf(trade);
  /* Nobody to check against: not known to be between two people, so not counted — whatever the clusters say. */
  if (!parties.length) return judged(trade, "unknown", null, "no_party");
  const found: Array<{ party: TradeParty; why: InsideWhy }> = [];

  for (const { party, wallet } of parties) {
    if (wallet === trade.buyer) found.push({ party, why: "same_wallet" });
    else if (trade.signers.includes(wallet)) found.push({ party, why: "same_signer" });
  }
  let unknown = false;
  if (!found.length) {
    for (const { party, wallet } of parties) {
      for (const actor of actorsOf(trade)) {
        const answer = verdictOf(actor, wallet);
        if (answer.verdict === "same" && (CLUSTER_REASONS as readonly string[]).includes(answer.reason)) found.push({ party, why: answer.reason });
        else if (answer.verdict !== "separate") unknown = true;
      }
    }
  }

  if (found.length) {
    const inside = [...found].sort((a, b) => STRONGEST.indexOf(a.why) - STRONGEST.indexOf(b.why))[0]!;
    const reason: NotCounted = inside.why === "same_wallet" ? "self_trade" : inside.why === "same_signer" ? "same_signer" : "cluster";
    return judged(trade, "inside", inside, reason);
  }
  if (unknown) return judged(trade, "unknown", null, "unverified");
  if (trade.usdMicros === null) return judged(trade, "outside", null, "no_amount");
  if (trade.usdMicros < MIN_TRADE_USD_MICROS) return judged(trade, "outside", null, "dust");
  return judged(trade, "outside", null, null);
}

/**
 * Judge one trade, asking the Growth line about every pair it needs — none when the trade itself already shows it is
 * inside or unreadable. A failed question is a pair not known.
 */
export async function judgeCityTrade(trade: CityTrade, clusters: WalletClusters = NO_CLUSTER_CHECK): Promise<TradeJudgement> {
  /* What the trade itself shows needs no question. */
  const plain = judgeTrade(trade, () => ({ verdict: "unknown", why: "not_asked" }));
  if (plain.cluster === "inside" || !readable(trade)) return plain;
  const pairs = new Map<string, readonly [string, string]>();
  for (const actor of actorsOf(trade)) {
    for (const { wallet } of partiesOf(trade)) if (wallet !== actor) pairs.set(`${actor}|${wallet}`, [actor, wallet]);
  }
  const answers = new Map<string, ClusterVerdict>();
  await Promise.all(
    [...pairs].map(async ([key, [actor, wallet]]) => {
      answers.set(key, await clusters.check(actor, wallet, trade.at).catch((): ClusterVerdict => ({ verdict: "unknown", why: "check_failed" })));
    }),
  );
  return judgeTrade(trade, (actor, wallet) => answers.get(`${actor}|${wallet}`) ?? { verdict: "unknown", why: "not_asked" });
}

/* ------------------------------------------------------------------------------------------------
 * The public number: the share of the week's trades inside one cluster
 * --------------------------------------------------------------------------------------------- */

/**
 * What an engine or market event carries in its payload so the week can be counted from the city's feed: the trade,
 * its own chain time (`at`, the week it belongs to, whenever the report is emitted) and what the check found.
 */
export type HonestCountMark = Readonly<{ v: 1; tx: string; at: string; cluster: TradeJudgement["cluster"] }>;

/** The payload field to put on the event that reports a judged trade. */
export function honestCountMark(judgement: Pick<TradeJudgement, "tx" | "at" | "cluster">): Readonly<{ honestCount: HonestCountMark }> {
  return { honestCount: { v: 1, tx: judgement.tx, at: judgement.at, cluster: judgement.cluster } };
}

function markOf(event: WorldEvent): HonestCountMark | null {
  if (event.source !== "engine" && event.source !== "market") return null;
  const mark = (event.payload as { honestCount?: unknown } | null)?.honestCount as Partial<HonestCountMark> | undefined;
  if (!mark || mark.v !== 1 || typeof mark.tx !== "string" || !SIGNATURE.test(mark.tx)) return null;
  if (typeof mark.at !== "string" || !Number.isFinite(Date.parse(mark.at))) return null;
  if (mark.cluster !== "outside" && mark.cluster !== "inside" && mark.cluster !== "unknown") return null;
  return { v: 1, tx: mark.tx, at: mark.at, cluster: mark.cluster };
}

export type WeeklyClusterShare = Readonly<{
  week: WeekRange;
  /** Trades of the week, each once. */
  trades: number;
  inside: number;
  outside: number;
  /** Not yet known either way. */
  unknown: number;
  /** Inside out of the trades that were checked, in basis points, rounded down; null — nothing checked yet. */
  insideBps: number | null;
  /** Trades not yet checked, out of all, in basis points, rounded down; null — no trades. */
  uncheckedBps: number | null;
}>;

/**
 * The share of the week's trades that were inside one wallet cluster, from the city's events. A trade belongs to
 * the week its own chain time falls in (the mark's `at`; Monday 00:00 UTC to the next Monday) — never the week a
 * report of it was emitted, so a re-check sent days later still counts in the trade's week. An event without a chain
 * time is never shown, so it is not counted either. A trade reported more than once counts once, by its latest
 * report — a re-check replaces «not known».
 */
export function weeklyClusterShare(events: readonly WorldEvent[], anyMomentOfWeek: string): WeeklyClusterShare {
  const week = weekRange(weekStartOf(anyMomentOfWeek));
  const latest = new Map<string, { reported: number; at: string; cluster: HonestCountMark["cluster"] }>();
  for (const event of events) {
    const mark = markOf(event);
    if (!mark || typeof event.sourceAt !== "string") continue;
    const reported = Date.parse(event.at);
    const held = latest.get(mark.tx);
    if (!held || (Number.isFinite(reported) && reported >= held.reported)) {
      latest.set(mark.tx, { reported: Number.isFinite(reported) ? reported : -Infinity, at: mark.at, cluster: mark.cluster });
    }
  }
  const tally = { inside: 0, outside: 0, unknown: 0 };
  let trades = 0;
  for (const { at, cluster } of latest.values()) {
    if (!within(at, week)) continue;
    tally[cluster] += 1;
    trades += 1;
  }
  const checked = tally.inside + tally.outside;
  return {
    week,
    trades,
    ...tally,
    insideBps: checked ? Math.floor((tally.inside * 10_000) / checked) : null,
    uncheckedBps: trades ? Math.floor((tally.unknown * 10_000) / trades) : null,
  };
}
