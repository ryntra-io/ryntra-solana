/**
 * A launch's flow (L3), read: the market as its page reads it (`readLaunchMarketFacts` — every trade from a swap event,
 * every balance from a token account), who first funded the wallets that bought it, the survival the store keeps, and
 * the creator's earlier Ryntra coins. The facts are counted by `flow.ts`.
 *
 * The funding trails are the Growth line's: its reader of a wallet's first money (`readFunding`), and — where its
 * signal key is configured — the trails its protection run already keeps and the sources its reviewers marked as hubs.
 * Read only: nothing is written into the Growth line's store. A trail read here is kept in this process for a day.
 *
 * One read of the chain is bounded: the earliest buyers first, a few at a time, inside a short budget; what the budget
 * does not reach stays not traced and the counts say they are a floor. One answer serves everyone for a while, and a
 * read in flight is joined, never started twice.
 *
 * Server-only. Nothing here signs, sends or moves anything.
 */

import { readHubs, readFundingNodes } from "../../growth/review-store.ts";
import { signalHash, signalKeyFrom, type FundingNode } from "../../growth/protect.ts";
import { readFunding, type FundingRead } from "../../growth/protect-chain.server.ts";
import { jsonRpc } from "../../growth/pool-share-read.server.ts";
import type { LaunchFlowResponse } from "../../api/v1/contract.ts";
import { survivalProves, type SurvivalOutcome } from "../../core/launch/survival-stats.ts";
import { launchPair } from "../config.server.ts";
import { readLaunchRecord, type LaunchRecord } from "../flow.server.ts";
import type { HealthDeps } from "../health.server.ts";
import { readLaunchMarketFacts, type LaunchMarketFacts } from "../market.server.ts";
import { launchHealthDeps } from "../runtime.server.ts";
import { keptLaunchSurvival } from "../survival.server.ts";
import { launchMarketReader } from "../trade-index.server.ts";
import { launchClusters } from "./clusters.ts";
import { flowBuyers, launchFlow, type FlowPastLaunch, type FlowSurvival } from "./flow.ts";
import { FLOW_RULES } from "./rules.ts";

export type FlowDeps = HealthDeps &
  Readonly<{
    /** Who sent a wallet its first money; absent — no wallet is traced, and every count says it is a floor. */
    funding?: (wallet: string) => Promise<FundingRead>;
    /** The Growth line's signal key: its kept trails and its hubs are read with it; absent — neither is. */
    signalKey?: Uint8Array | null;
    /** The market's read; a test hands in its own. */
    facts?: (token: string) => Promise<LaunchMarketFacts | null>;
    /** The trades of one transaction on this token, for a survival proof's trader; a test hands in its own. */
    transaction?: (token: string, facts: LaunchMarketFacts, signature: string) => Promise<readonly Readonly<{ trader: string; payer: string }>[] | null>;
  }>;

/** How long one answer is served; how long a read may take; how many trails at once and at most. */
const ANSWER_FRESH_MS = 2 * 60 * 1000;
const ANSWER_STUCK_MS = 75_000;
const FUNDING_BUDGET_MS = 10_000;
const AT_ONCE = 3;
const BUYERS_TRACED = 60;
const CREATORS_TRACED = 20;
/** A trail read from the chain is kept this long in this process: a wallet's first money never changes. */
const TRAIL_MS = 24 * 60 * 60 * 1000;
const TRAILS_MAX = 5_000;

const ANSWERS = new Map<string, Readonly<{ at: number; settled: boolean; value: Promise<LaunchFlowResponse | null> }>>();
const TRAILS = new Map<string, Readonly<{ at: number; read: FundingRead }>>();

/** The deployment's flow reader: Launch's own reads, the Growth line's funding reader over Launch's node, its key where set. */
export function launchFlowDeps(env: Readonly<Record<string, string | undefined>> = process.env): FlowDeps | null {
  const deps = launchHealthDeps();
  if (!deps) return null;
  const rpc = jsonRpc(deps.connection.rpcEndpoint, { attempts: 2, timeoutMs: 8_000 });
  return { ...deps, funding: (wallet) => readFunding(rpc, wallet), signalKey: signalKeyFrom(env) };
}

/** A launch's flow, served again for a while; a read in flight is joined, one stuck past its time is made again. */
export function readLaunchFlow(deps: FlowDeps, token: string): Promise<LaunchFlowResponse | null> {
  const key = `${deps.network.cluster}:${token}`;
  const now = deps.now().getTime();
  const hit = ANSWERS.get(key);
  if (hit && now - hit.at < (hit.settled ? ANSWER_FRESH_MS : ANSWER_STUCK_MS)) return hit.value;
  const value = assembleLaunchFlow(deps, token);
  ANSWERS.set(key, { at: now, settled: false, value });
  if (ANSWERS.size > 500) ANSWERS.delete(ANSWERS.keys().next().value as string);
  value.then(
    (answer) => {
      if (ANSWERS.get(key)?.value !== value) return;
      /* «Not found» is not kept: the launch may be confirmed a moment later. */
      if (answer) ANSWERS.set(key, { at: deps.now().getTime(), settled: true, value });
      else ANSWERS.delete(key);
    },
    () => {
      if (ANSWERS.get(key)?.value === value) ANSWERS.delete(key);
    },
  );
  return value;
}

/** One answer made now. */
export async function assembleLaunchFlow(deps: FlowDeps, token: string): Promise<LaunchFlowResponse | null> {
  const record = await readLaunchRecord(deps, deps.network.cluster, token);
  if (!record || record.state === "PENDING") return null;
  const facts = await (deps.facts ?? ((mint: string) => readLaunchMarketFacts(deps, mint)))(token);
  if (!facts) return null;
  const now = deps.now();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const creator = record.creator;
  const own = await deps.ryntraWallets().catch(() => ({ wallets: new Set<string>() as ReadonlySet<string>, complete: false }));
  const pairRead = (() => {
    try {
      return launchPair(deps.network, record.preset, record.pairMint);
    } catch {
      return null;
    }
  })();
  const pair = pairRead ? { decimals: pairRead.decimals, usdPrice: pairRead.usdPrice, dollar: pairRead.dollar } : { decimals: facts.state.pairDecimals, usdPrice: 0, dollar: false };

  /* This token's survival as the store keeps it, and who made each proof's trade. */
  const kept = (await keptLaunchSurvival(deps, [record]).catch(() => new Map<string, SurvivalOutcome[]>())).get(token) ?? [];
  const excluded = new Set([creator, ...own.wallets]);
  const transaction = deps.transaction ?? defaultTransaction(deps);
  const survival: FlowSurvival[] = await Promise.all(
    kept.map(async (outcome): Promise<FlowSurvival> => {
      if (outcome.state !== "alive" || !outcome.proof) return { ...outcome, prover: null };
      const trades = await transaction(token, facts, outcome.proof.signature).catch(() => null);
      const prover = trades?.find((trade) => survivalProves({ signature: outcome.proof!.signature, at: outcome.proof!.at, trader: trade.trader, payer: trade.payer }, excluded)) ?? null;
      return { ...outcome, prover: prover ? { trader: prover.trader, payer: prover.payer } : null };
    }),
  );

  /* The creator's earlier coins: their own wallet's, and the other creators of this network whose trails may join theirs. */
  const launches = (await deps.store.collection<LaunchRecord>("launches").valuesWithPrefix(`solana:${deps.network.cluster}:`).catch(() => [] as LaunchRecord[]))
    .filter((entry) => entry.state !== "PENDING" && (entry.cluster ?? deps.network.cluster) === deps.network.cluster && entry.token !== token && Date.parse(entry.launchedAt) <= Date.parse(record.launchedAt));
  const otherCreators = [...new Set(launches.map((entry) => entry.creator).filter((wallet) => wallet !== creator && !own.wallets.has(wallet)))].slice(0, CREATORS_TRACED);
  const otherCreatorsAll = new Set(launches.map((entry) => entry.creator).filter((wallet) => wallet !== creator && !own.wallets.has(wallet))).size;

  /* Who first funded whom: the creator, the survival provers, the earliest buyers, the other creators — in that order, as far as the budget goes. */
  const buyers = flowBuyers(facts.trades, { creator, own: own.wallets, pair });
  const provers = survival.flatMap((entry) => (entry.prover ? [entry.prover.trader, entry.prover.payer] : []));
  const queue = [...new Set([creator, ...provers, ...buyers.slice(0, BUYERS_TRACED), ...otherCreators])];
  const trails = await traceWallets(deps, queue, now.toISOString());
  const traders = [...new Set(facts.trades.map((trade) => trade.trader))];
  const paid = facts.trades.filter((trade) => trade.payer !== trade.trader && !own.wallets.has(trade.payer)).map((trade) => [trade.payer, trade.trader] as const);
  const clusters = launchClusters({ wallets: [...traders, ...provers, ...otherCreators], creator, paid, graph: trails.graph, hubs: trails.hubs, idOf: trails.idOf, now: nowSeconds });

  const pastRecords = launches.filter((entry) => entry.creator === creator || clusters.standing(entry.creator) === "creator");
  const pastKept = await keptLaunchSurvival(deps, pastRecords).catch(() => new Map<string, SurvivalOutcome[]>());
  const past: FlowPastLaunch[] = pastRecords.map((entry) => ({
    token: entry.token,
    symbol: entry.symbol,
    launchedAt: entry.launchedAt,
    outcomes: pastKept.get(entry.token) ?? [],
    link: entry.creator === creator ? "same_wallet" : "same_cluster",
  }));

  const holdings = new Map<string, bigint>();
  for (const balance of facts.foundHolders) holdings.set(balance.owner, (holdings.get(balance.owner) ?? 0n) + BigInt(balance.amountRaw));

  const flow = launchFlow({
    network: deps.network.chain,
    token,
    creator,
    supplyRaw: BigInt(facts.supplyRaw),
    created: facts.created,
    trades: facts.trades,
    historyComplete: facts.historyComplete,
    creatorTradesComplete: facts.creatorTradesComplete,
    creatorHoldsBps: facts.response.holders.groups.creatorBps,
    holdings,
    pair,
    migrated: facts.response.progress.migrated,
    thresholdRaw: facts.response.progress.thresholdRaw,
    graduated: facts.graduated,
    own: own.wallets,
    clusters,
    fundingWhole: trails.whole && buyers.length <= BUYERS_TRACED,
    survival,
    past,
    pastWhole: trails.whole && otherCreatorsAll <= CREATORS_TRACED && otherCreators.every((wallet) => clusters.traced(wallet)),
    now: nowSeconds,
  });
  return { ...flow, observedAt: now.toISOString() };
}

function defaultTransaction(deps: FlowDeps): NonNullable<FlowDeps["transaction"]> {
  const reader = launchMarketReader(deps);
  return (token, facts, signature) => reader.transaction({ token, state: facts.state, signature });
}

/**
 * The funding trails of `wallets`, `FLOW_RULES.hops` steps each: what this process read today, then what the Growth
 * line's protection run keeps (by its hash, where its key is set), and only then the chain. A stored step names its
 * funder by hash, so a trail goes on through the store but not back to the chain from there; a step not read leaves the
 * trail open — the wallet is not traced. `whole`: every wallet was walked inside the budget.
 */
async function traceWallets(deps: FlowDeps, wallets: readonly string[], now: string) {
  const key = deps.signalKey ?? null;
  const idOf = key ? (wallet: string) => signalHash(key, "address", wallet) : (wallet: string) => wallet;
  const graph = new Map<string, FundingNode>();
  const hubs = key ? await readHubs(deps.store).catch(() => new Set<string>()) : new Set<string>();
  const funding = deps.funding;
  if (!funding) return { graph, hubs, idOf, whole: wallets.length === 0 };

  const chain = async (address: string): Promise<FundingRead> => {
    const hit = TRAILS.get(address);
    if (hit && Date.now() - hit.at < TRAIL_MS) return hit.read;
    const read = await funding(address).catch((): FundingRead => ({ state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null }));
    /* A failed read is never kept: the next answer reads again. */
    if (read.state !== "UNAVAILABLE") {
      if (TRAILS.size >= TRAILS_MAX) TRAILS.delete(TRAILS.keys().next().value as string);
      TRAILS.set(address, { at: Date.now(), read });
    }
    return read;
  };
  const walk = async (wallet: string) => {
    let address: string | null = wallet;
    let id = idOf(wallet);
    for (let step = 0; step < FLOW_RULES.hops; step += 1) {
      let node = graph.get(id);
      if (!node && key) {
        const stored = (await readFundingNodes(deps.store, [id], now).catch(() => new Map<string, FundingNode>())).get(id);
        if (stored) {
          graph.set(id, stored);
          node = stored;
          address = null;
        }
      }
      if (!node) {
        if (address === null) return;
        const read = await chain(address);
        if (read.state === "UNAVAILABLE") return;
        node = { state: read.state, funder: read.funder ? idOf(read.funder) : null, firstAt: read.firstAt, lastAt: read.lastAt };
        graph.set(id, node);
        address = read.funder;
      }
      if (!node.funder) return;
      id = node.funder;
    }
  };

  const deadline = Date.now() + FUNDING_BUDGET_MS;
  let next = 0;
  let walked = 0;
  const worker = async () => {
    for (;;) {
      if (Date.now() > deadline - 1_000) return;
      const wallet = wallets[next++];
      if (wallet === undefined) return;
      /* A walk the budget does not wait for goes on behind the answer: what it reads is kept for the next one. */
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = await Promise.race([
        walk(wallet).then(() => true),
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), Math.max(0, deadline - Date.now()));
        }),
      ]).finally(() => clearTimeout(timer));
      if (!done) return;
      walked += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, wallets.length) }, worker));
  return { graph, hubs, idOf, whole: walked === wallets.length };
}
