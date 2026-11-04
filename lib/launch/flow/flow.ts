/**
 * A launch's flow (L3): who bought it in its first block, what its creator bought and sold, what became of the
 * creator's earlier coins, how many independent buyers it has and how many graduated it — each a fact of the chain with
 * the transaction it rests on, counted by the rules of `rules.ts`. Never a verdict: no «safe», no «scam», only what
 * happened and how it was counted. Whatever was not read is said as not read.
 *
 * Pure: the chain and the stores are read by `flow.server.ts`; the clusters are the Growth line's rules (`clusters.ts`).
 */

import type { LaunchFlowResponse } from "../../api/v1/contract.ts";
import { roundTripTrades, type PoolTrade } from "../../growth/protect.ts";
import { SURVIVAL_HORIZONS_DAYS, type SurvivalOutcome } from "../../core/launch/survival-stats.ts";
import { creatorActivity, shareBps, type LaunchTrade } from "../../core/venues/meteora-dbc/market.ts";
import { independentCount, type Clusters } from "./clusters.ts";
import { BUNDLE_REASONS, FLOW_LISTED, FLOW_RULES, type BundleReason, type CreatorLink } from "./rules.ts";

export type FlowPair = Readonly<{ decimals: number; usdPrice: number; dollar: boolean }>;

/** A survival outcome of this token, with who made the trade that proves it — read from that transaction; null when not read. */
export type FlowSurvival = SurvivalOutcome & Readonly<{ prover: Readonly<{ trader: string; payer: string }> | null }>;

export type FlowPastLaunch = Readonly<{ token: string; symbol: string; launchedAt: string; outcomes: readonly SurvivalOutcome[]; link: CreatorLink }>;

export type FlowInput = Readonly<{
  network: LaunchFlowResponse["network"];
  token: string;
  creator: string;
  supplyRaw: bigint;
  /** The creation's block and time; null when the history read did not reach it. */
  created: Readonly<{ slot: number; at: number | null }> | null;
  /** Every trade read, the oldest first. */
  trades: readonly LaunchTrade[];
  historyComplete: boolean;
  creatorTradesComplete: boolean;
  /** What the creator holds now, their lock included, of the supply. */
  creatorHoldsBps: number;
  /** What each wallet the read found holds now, raw. */
  holdings: ReadonlyMap<string, bigint>;
  pair: FlowPair;
  migrated: boolean;
  /** What the curve must take in to move to its pool, raw in the pair currency; "0" when not read. */
  thresholdRaw: string;
  graduated: Readonly<{ at: number; signature: string }> | null;
  /** Ryntra's own wallets: their trades are never a buyer's. */
  own: ReadonlySet<string>;
  clusters: Clusters;
  /** Whether every buyer's funding was asked: false — some were past the read's limit or time, and stand as not traced. */
  fundingWhole: boolean;
  survival: readonly FlowSurvival[];
  past: readonly FlowPastLaunch[];
  /** Every past launch of the creator's cluster was found: false — some creators' starts were not read. */
  pastWhole: boolean;
  now: number;
}>;

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** A trade's pair amount in micro-dollars; null on a pair that is not a dollar. */
export function usdMicros(pairRaw: string, pair: FlowPair): bigint | null {
  if (!pair.dollar) return null;
  if (pair.decimals === 6 && pair.usdPrice === 1) return BigInt(pairRaw);
  return BigInt(Math.floor((Number(pairRaw) / 10 ** pair.decimals) * pair.usdPrice * 1_000_000));
}

/** The buys that are halves of a round trip — bought and sold back within a day for about nothing (the Growth line's S6). */
export function roundTripSignatures(trades: readonly LaunchTrade[], pair: FlowPair): ReadonlySet<string> {
  const pool: PoolTrade[] = trades.map((trade) => ({ wallet: trade.trader, side: trade.side, usdMicros: usdMicros(trade.pairRaw, pair), at: iso(trade.at), tx: `${trade.signature}:${trade.side}:${trade.trader}` }));
  return roundTripTrades(pool);
}

/**
 * The buyers: wallets other than the creator and Ryntra's own with a buy of at least the floor that is not half of a
 * round trip, in the order of their first such buy. `curveOnly`: the curve's buys alone; `before`: buys before that time.
 */
export function flowBuyers(trades: readonly LaunchTrade[], args: Readonly<{ creator: string; own: ReadonlySet<string>; pair: FlowPair; before?: number | null; curveOnly?: boolean }>): string[] {
  const roundTrips = roundTripSignatures(trades, args.pair);
  const floor = BigInt(FLOW_RULES.floorUsdMicros);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const trade of trades) {
    if (trade.side !== "buy" || trade.trader === args.creator || args.own.has(trade.trader) || args.own.has(trade.payer)) continue;
    if (args.curveOnly && trade.venue !== "curve") continue;
    if (args.before !== undefined && args.before !== null && trade.at >= args.before) continue;
    if (roundTrips.has(`${trade.signature}:buy:${trade.trader}`)) continue;
    const usd = usdMicros(trade.pairRaw, args.pair);
    if (usd !== null && usd < floor) continue;
    if (seen.has(trade.trader)) continue;
    seen.add(trade.trader);
    out.push(trade.trader);
  }
  return out;
}

/** The same-slot bundles on the curve, the launch slot first; each group with what tied it. */
export function sameSlotBundles(input: Pick<FlowInput, "trades" | "creator" | "own" | "created" | "clusters">): {
  slot: number;
  at: number;
  wallets: readonly string[];
  buys: readonly LaunchTrade[];
  why: readonly BundleReason[];
}[] {
  const bySlot = new Map<number, LaunchTrade[]>();
  for (const trade of input.trades) {
    if (trade.side !== "buy" || trade.venue !== "curve" || input.own.has(trade.trader)) continue;
    bySlot.set(trade.slot, [...(bySlot.get(trade.slot) ?? []), trade]);
  }
  const groups: ReturnType<typeof sameSlotBundles> = [];
  for (const [slot, buys] of [...bySlot.entries()].sort((a, b) => a[0] - b[0])) {
    const launchSlot = input.created !== null && slot === input.created.slot;
    /* The creator's own first purchase is the creation itself; the rest of that block was arranged ahead. */
    const others = launchSlot ? buys.filter((trade) => trade.trader !== input.creator) : buys;
    const wallets = [...new Set(others.map((trade) => trade.trader))];
    if (launchSlot) {
      if (!wallets.length) continue;
      /* The creator's own buy counts for the ties: a wallet they paid for in their own block is theirs. */
      groups.push({ slot, at: others[0]!.at, wallets, buys: others, why: ["launch_slot", ...linksAmong(buys, input.clusters)] });
      continue;
    }
    if (wallets.length < 2) continue;
    /* Any other block: wallets tied by one transaction, one payer or one cluster — a busy block alone ties nobody. */
    const parent = new Map(wallets.map((wallet) => [wallet, wallet]));
    const find = (wallet: string): string => (parent.get(wallet) === wallet ? wallet : find(parent.get(wallet)!));
    const tie = (a: string, b: string) => parent.set(find(a), find(b));
    for (let i = 0; i < others.length; i += 1) {
      for (let j = i + 1; j < others.length; j += 1) {
        const a = others[i]!;
        const b = others[j]!;
        if (a.trader !== b.trader && tiedBy(a, b, input.clusters).length) tie(a.trader, b.trader);
      }
    }
    const components = new Map<string, string[]>();
    for (const wallet of wallets) components.set(find(wallet), [...(components.get(find(wallet)) ?? []), wallet]);
    for (const members of components.values()) {
      if (members.length < 2) continue;
      const tied = others.filter((trade) => members.includes(trade.trader));
      groups.push({ slot, at: tied[0]!.at, wallets: members, buys: tied, why: linksAmong(tied, input.clusters) });
    }
  }
  return groups;
}

function tiedBy(a: LaunchTrade, b: LaunchTrade, clusters: Clusters): BundleReason[] {
  const why: BundleReason[] = [];
  if (a.signature === b.signature) why.push("same_tx");
  if (a.payer === b.payer || a.payer === b.trader || b.payer === a.trader) why.push("same_payer");
  if (clusters.clusterOf(a.trader) === clusters.clusterOf(b.trader)) why.push("same_cluster");
  return why;
}

function linksAmong(buys: readonly LaunchTrade[], clusters: Clusters): BundleReason[] {
  const why = new Set<BundleReason>();
  for (let i = 0; i < buys.length; i += 1) {
    for (let j = i + 1; j < buys.length; j += 1) {
      if (buys[i]!.trader === buys[j]!.trader) continue;
      for (const reason of tiedBy(buys[i]!, buys[j]!, clusters)) why.add(reason);
    }
  }
  return BUNDLE_REASONS.filter((reason) => reason !== "launch_slot" && why.has(reason));
}

/** A past launch survived when it was alive at the longest horizon decided for it; null while none is decided. */
export function pastSurvived(outcomes: readonly Pick<SurvivalOutcome, "days" | "state">[]): boolean | null {
  const decided = outcomes.filter((outcome) => outcome.state === "alive" || outcome.state === "quiet").sort((a, b) => b.days - a.days);
  return decided.length ? decided[0]!.state === "alive" : null;
}

export function launchFlow(input: FlowInput): Omit<LaunchFlowResponse, "observedAt"> {
  const supply = input.supplyRaw;
  const tokensOf = (buys: readonly LaunchTrade[]) => buys.reduce((total, trade) => total + BigInt(trade.tokensRaw), 0n);
  const holdsOf = (wallets: Iterable<string>) => {
    let total = 0n;
    for (const wallet of wallets) total += input.holdings.get(wallet) ?? 0n;
    return total;
  };
  const signatures = (buys: readonly LaunchTrade[]) => [...new Set(buys.map((trade) => trade.signature))].slice(0, FLOW_LISTED.signatures);

  /* The launch slot: every buy in the creation's block besides the creator's own. */
  const slotBuys = input.created ? input.trades.filter((trade) => trade.side === "buy" && trade.slot === input.created!.slot && trade.trader !== input.creator && !input.own.has(trade.trader)) : [];
  const launchSlot = input.created
    ? {
        slot: input.created.slot,
        at: input.created.at === null ? null : iso(input.created.at),
        buys: slotBuys.length,
        wallets: new Set(slotBuys.map((trade) => trade.trader)).size,
        supplyBps: shareBps(tokensOf(slotBuys), supply),
        signatures: signatures(slotBuys),
      }
    : null;

  const groups = sameSlotBundles(input);
  const bundleWallets = new Set(groups.flatMap((group) => group.wallets));
  const bundles = {
    groups: groups.slice(0, FLOW_LISTED.bundles).map((group) => ({
      slot: group.slot,
      at: iso(group.at),
      wallets: group.wallets.length,
      buys: group.buys.length,
      supplyBps: shareBps(tokensOf(group.buys), supply),
      why: [...group.why],
      signatures: signatures(group.buys),
    })),
    count: groups.length,
    wallets: bundleWallets.size,
    supplyBps: shareBps(tokensOf(groups.flatMap((group) => group.buys)), supply),
    holdsBps: shareBps(holdsOf(bundleWallets), supply),
    complete: input.historyComplete,
  };

  /* The creator: what their own wallet bought and sold, what they hold, and the wallets of their party. */
  const activity = creatorActivity(input.trades, input.creator);
  const lastSale = activity.sales.at(-1) ?? null;
  const traders = new Set(input.trades.map((trade) => trade.trader));
  const linked = [...traders].filter((wallet) => wallet !== input.creator && !input.own.has(wallet) && input.clusters.standing(wallet) === "creator");
  const dev = {
    wallet: input.creator,
    boughtBps: shareBps(activity.boughtRaw, supply),
    soldBps: shareBps(activity.soldRaw, supply),
    soldOfBoughtBps: activity.soldRaw > 0n && activity.soldRaw <= activity.boughtRaw ? shareBps(activity.soldRaw, activity.boughtRaw) : null,
    sales: activity.sales.length,
    lastSale: lastSale ? { signature: lastSale.signature, at: iso(lastSale.at) } : null,
    holdsBps: input.creatorHoldsBps,
    linked: {
      wallets: linked.length,
      boughtBps: shareBps(tokensOf(input.trades.filter((trade) => trade.side === "buy" && linked.includes(trade.trader))), supply),
      holdsBps: shareBps(holdsOf(linked), supply),
    },
    complete: input.creatorTradesComplete,
  };

  /* The buyers, each cluster once. */
  const buyerArgs = { creator: input.creator, own: input.own, pair: input.pair };
  const wallets = flowBuyers(input.trades, buyerArgs);
  const roundTrips = roundTripSignatures(input.trades, input.pair);
  const standing = (state: string) => wallets.filter((wallet) => input.clusters.standing(wallet) === state).length;
  const independent = independentCount(wallets, input.clusters);
  const unknown = standing("unknown");
  const buyers = {
    wallets: wallets.length,
    independent,
    merged: standing("independent") - independent,
    creatorLinked: standing("creator"),
    unknown,
    roundTrips: input.trades.filter((trade) => trade.side === "buy" && roundTrips.has(`${trade.signature}:buy:${trade.trader}`)).length,
    atLeast: unknown > 0 || !input.historyComplete || !input.fundingWhole,
  };

  /* The graduation: how many independent buyers filled the curve, and whether one buy did it alone. */
  const threshold = BigInt(input.thresholdRaw || "0");
  const curveBuys = input.trades.filter((trade) => trade.side === "buy" && trade.venue === "curve" && (input.graduated === null || trade.at <= input.graduated.at));
  let largest: LaunchTrade | null = null;
  let largestIn = 0n;
  for (const trade of curveBuys) {
    const into = BigInt(trade.pairRaw) - BigInt(trade.feeRaw);
    if (into > largestIn) {
      largest = trade;
      largestIn = into;
    }
  }
  const largestBps = threshold > 0n && largest ? Math.min(10_000, shareBps(largestIn, threshold)) : null;
  /* Round trips are judged on every trade, the sales after the graduation included. */
  const filledBy = input.migrated ? flowBuyers(input.trades, { ...buyerArgs, curveOnly: true, before: input.graduated ? input.graduated.at + 1 : null }) : null;
  const filledIndependent = filledBy ? independentCount(filledBy, input.clusters) : null;
  const alone = largestBps !== null && largestBps >= FLOW_RULES.singleTradeBps;
  const graduation = {
    graduated: input.migrated,
    at: input.graduated ? iso(input.graduated.at) : null,
    signature: input.graduated?.signature ?? null,
    buyers: filledBy ? { wallets: filledBy.length, independent: filledIndependent! } : null,
    largestBuy: largest && largestBps !== null ? { signature: largest.signature, thresholdBps: largestBps } : null,
    singleTrade: input.migrated && (alone || (input.historyComplete && filledIndependent !== null && filledIndependent <= 1)),
    complete: input.historyComplete,
  };

  /* Survival, each proof checked against the creator's party: a trade of their own wallets proves no demand. */
  const survival = SURVIVAL_HORIZONS_DAYS.map((days) => {
    const outcome = input.survival.find((entry) => entry.days === days);
    const state = outcome?.state ?? "unread";
    const proof = outcome?.proof ?? null;
    const prover = outcome?.prover ?? null;
    const independentProof =
      state !== "alive" || !prover
        ? null
        : input.clusters.standing(prover.trader) === "creator" || input.clusters.standing(prover.payer) === "creator"
          ? false
          : input.clusters.traced(prover.trader)
            ? true
            : null;
    return { days, state, proof: proof ? { signature: proof.signature, at: iso(proof.at) } : null, independent: independentProof };
  });

  /* The creator's earlier coins on Ryntra — their own wallet's and their cluster's — and what became of each. */
  const past = [...input.past].sort((a, b) => Date.parse(b.launchedAt) - Date.parse(a.launchedAt));
  const judged = past.map((launch) => pastSurvived(launch.outcomes));
  const creatorRecord = {
    launches: past.slice(0, FLOW_LISTED.launches).map((launch, index) => ({
      token: launch.token,
      symbol: launch.symbol.slice(0, 16),
      launchedAt: launch.launchedAt,
      link: launch.link,
      outcomes: SURVIVAL_HORIZONS_DAYS.map((days) => ({ days, state: launch.outcomes.find((outcome) => outcome.days === days)?.state ?? "unread" })),
      survived: judged[index]!,
    })),
    count: past.length,
    judged: judged.filter((value) => value !== null).length,
    survived: judged.filter((value) => value === true).length,
    complete: input.pastWhole,
  };

  return {
    network: input.network,
    token: input.token,
    creator: input.creator,
    rules: { version: FLOW_RULES.version, floorUsd: input.pair.dollar ? FLOW_RULES.floorUsdMicros / 1_000_000 : null, singleTradeBps: FLOW_RULES.singleTradeBps, hops: FLOW_RULES.hops },
    launchSlot,
    bundles,
    dev,
    buyers,
    graduation,
    survival,
    creatorRecord,
    complete: input.historyComplete && input.creatorTradesComplete && !buyers.atLeast && input.pastWhole,
  };
}
