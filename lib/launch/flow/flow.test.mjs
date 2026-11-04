// L3: a launch's flow — the launch slot, same-slot bundles, the creator's strip, buyers counted once per funding cluster
// (a wallet farm and a one-dollar trade make no signal), the graduation, survival proofs against the creator's party and
// the creator's earlier coins — from fixtures of trades and funding trails. Synthetic addresses and signatures only.
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../../guard/store.ts";
import { PROTECT_RULES } from "../../growth/protect.ts";
import { LaunchFlowResponseSchema } from "../../api/v1/contract.ts";
import { launchClusters, independentCount } from "./clusters.ts";
import { clusterAwareCounts, clusterAwareRings, ringOf } from "./counts.ts";
import { flowBuyers, launchFlow, pastSurvived, sameSlotBundles } from "./flow.ts";
import { assembleLaunchFlow } from "./flow.server.ts";
import { FLOW_RULES } from "./rules.ts";

const NOW = 1_770_000_000;
const DAY = 86_400;
const addr = (name) => name.padEnd(44, "1").slice(0, 44);
const sig = (name) => name.padEnd(88, "2").slice(0, 88);
const iso = (seconds) => new Date(seconds * 1000).toISOString();

const TOKEN = addr("Token");
const CREATOR = addr("Creator");
const RYNTRA = addr("RyntraOwn");
const FARMER = addr("FarmFunder");
const EXCHANGE = addr("ExchangeHub");
const OLD = addr("OldMoney");
const SUPPLY = 1_000_000_000_000_000n; // 1e9 tokens, 6 decimals
const PAIR = { decimals: 6, usdPrice: 1, dollar: true };
const CREATED = { slot: 1000, at: NOW - 3 * DAY };

let n = 0;
/** A trade as the market reader decodes it; amounts raw — dollars in micro-units, tokens in micro-tokens. */
function trade(over) {
  n += 1;
  const usd = over.usd ?? 10;
  return {
    signature: over.signature ?? sig(`Tx${n}`),
    slot: over.slot ?? 2000 + n,
    at: over.at ?? CREATED.at + 600 + n,
    side: over.side ?? "buy",
    venue: over.venue ?? "curve",
    trader: over.trader,
    payer: over.payer ?? over.trader,
    account: null,
    tokensRaw: String(over.tokens ?? 1_000_000_000_000n),
    pairRaw: String(Math.round(usd * 1_000_000)),
    feeRaw: String(Math.round(usd * 10_000)),
    priceAfter: 0.00001,
  };
}

/** Funding trails as the Growth line keeps them: each wallet's first funder, the funders read as old wallets of their own. */
function graphOf(funders) {
  const graph = new Map();
  const old = { state: "DEEP", funder: null, firstAt: iso(NOW - 400 * DAY), lastAt: iso(NOW - DAY) };
  for (const [wallet, funder] of Object.entries(funders)) {
    graph.set(wallet, { state: "FOUND", funder, firstAt: iso(NOW - 5 * DAY), lastAt: iso(NOW - DAY) });
    if (!graph.has(funder)) graph.set(funder, old);
  }
  graph.set(OLD, old);
  return graph;
}

const farm = Array.from({ length: 6 }, (_, i) => addr(`Farm${i}`));
const people = Array.from({ length: 4 }, (_, i) => addr(`Person${i}`));
const peopleFunders = people.map((_, i) => addr(`Funder${i}`));
const SECOND = addr("CreatorSecond");
const DUST = addr("DustBuyer");
const UNTRACED = addr("Untraced");
const ROUND = addr("RoundTrip");

function fixture() {
  n = 0;
  const trades = [
    // The creation: the creator's own first purchase, and two wallets in the same block — one the creator paid for.
    trade({ trader: CREATOR, slot: CREATED.slot, at: CREATED.at, usd: 20, tokens: 12_000_000_000_000n, signature: sig("Creation") }),
    trade({ trader: SECOND, payer: CREATOR, slot: CREATED.slot, at: CREATED.at, usd: 15, tokens: 9_000_000_000_000n }),
    trade({ trader: farm[0], slot: CREATED.slot, at: CREATED.at, usd: 15, tokens: 8_000_000_000_000n }),
    // A farm: six wallets from one funder, three of them in one later block.
    ...farm.slice(1, 4).map((wallet) => trade({ trader: wallet, slot: 1500, at: CREATED.at + 30, usd: 5 })),
    ...farm.slice(4).map((wallet) => trade({ trader: wallet, usd: 3 })),
    // Four people with their own funders; one of them in the farm's block, tied to nobody.
    trade({ trader: people[0], slot: 1500, at: CREATED.at + 30, usd: 40 }),
    ...people.slice(1).map((wallet) => trade({ trader: wallet, usd: 25 })),
    // A one-dollar-short trade, a wallet no one could trace, a round trip and Ryntra's own wallet.
    trade({ trader: DUST, usd: 0.5 }),
    trade({ trader: UNTRACED, usd: 30 }),
    trade({ trader: ROUND, usd: 50, at: CREATED.at + 5000 }),
    trade({ trader: ROUND, usd: 49.5, side: "sell", at: CREATED.at + 6000 }),
    trade({ trader: RYNTRA, usd: 100 }),
    // The creator sells a quarter of what they bought.
    trade({ trader: CREATOR, side: "sell", usd: 6, tokens: 3_000_000_000_000n, signature: sig("CreatorSale") }),
  ];
  const graph = graphOf({
    ...Object.fromEntries(farm.map((wallet) => [wallet, FARMER])),
    ...Object.fromEntries(people.map((wallet, i) => [wallet, peopleFunders[i]])),
    [CREATOR]: OLD,
    [SECOND]: CREATOR,
    [DUST]: addr("DustFunder"),
    [ROUND]: addr("RoundFunder"),
  });
  return { trades, graph };
}

function clustersOf(trades, graph, hubs = new Set()) {
  return launchClusters({
    wallets: [...new Set(trades.map((t) => t.trader))],
    creator: CREATOR,
    paid: trades.filter((t) => t.payer !== t.trader).map((t) => [t.payer, t.trader]),
    graph,
    hubs,
    idOf: (wallet) => wallet,
    now: NOW,
  });
}

function input(over = {}) {
  const { trades, graph } = fixture();
  return {
    network: "solana:devnet",
    token: TOKEN,
    creator: CREATOR,
    supplyRaw: SUPPLY,
    created: CREATED,
    trades,
    historyComplete: true,
    creatorTradesComplete: true,
    creatorHoldsBps: 900,
    holdings: new Map([[CREATOR, 9_000_000_000_000n], [SECOND, 9_000_000_000_000n], [farm[0], 8_000_000_000_000n]]),
    pair: PAIR,
    migrated: false,
    thresholdRaw: String(60_000 * 1_000_000),
    graduated: null,
    own: new Set([RYNTRA]),
    clusters: clustersOf(trades, graph),
    fundingWhole: true,
    survival: [7, 30, 90].map((days) => ({ days, state: "young", proof: null, prover: null })),
    past: [],
    pastWhole: true,
    now: NOW,
    ...over,
  };
}

test("the rules are the Growth line's: the one-dollar floor, the trail's hops and the age a long history needs", () => {
  assert.equal(BigInt(FLOW_RULES.floorUsdMicros), PROTECT_RULES.activation.minTradeUsdMicros);
  assert.equal(FLOW_RULES.hops, PROTECT_RULES.funding.hops);
  assert.equal(FLOW_RULES.deepAgeDays, PROTECT_RULES.funding.deepAgeDays);
});

test("a wallet farm is one buyer, the creator's party none, an untraced wallet none, a dust trade and a round trip none", () => {
  const { trades, graph } = fixture();
  const clusters = clustersOf(trades, graph);
  const buyers = flowBuyers(trades, { creator: CREATOR, own: new Set([RYNTRA]), pair: PAIR });
  assert.ok(!buyers.includes(DUST), "half a dollar is no buyer");
  assert.ok(!buyers.includes(ROUND), "a round trip is no buyer");
  assert.ok(!buyers.includes(RYNTRA) && !buyers.includes(CREATOR));
  assert.equal(clusters.standing(SECOND), "creator", "a wallet the creator paid for is the creator's");
  assert.equal(clusters.standing(UNTRACED), "unknown");
  assert.equal(clusters.standing(farm[3]), "independent");
  assert.equal(new Set(farm.map((wallet) => clusters.clusterOf(wallet))).size, 1, "six wallets from one funder are one cluster");
  // The farm once, the four people once each.
  assert.equal(independentCount(buyers, clusters), 5);
});

test("a funder a reviewer marked as a hub joins nobody; a wallet the creator funded is theirs whatever the hub", () => {
  const { trades } = fixture();
  const graph = graphOf({ [people[0]]: EXCHANGE, [people[1]]: EXCHANGE, [CREATOR]: OLD, [SECOND]: CREATOR });
  const shared = clustersOf(trades, graph);
  assert.equal(shared.clusterOf(people[0]), shared.clusterOf(people[1]));
  const hubbed = clustersOf(trades, graph, new Set([EXCHANGE]));
  assert.notEqual(hubbed.clusterOf(people[0]), hubbed.clusterOf(people[1]));
  assert.equal(hubbed.standing(SECOND), "creator");
});

test("a history too long to read stands alone only when it reaches thirty days back", () => {
  const graph = new Map([
    [addr("Aged"), { state: "DEEP", funder: null, firstAt: iso(NOW - 45 * DAY), lastAt: iso(NOW) }],
    [addr("Fresh"), { state: "DEEP", funder: null, firstAt: iso(NOW - 3 * DAY), lastAt: iso(NOW) }],
  ]);
  const clusters = launchClusters({ wallets: [addr("Aged"), addr("Fresh")], creator: CREATOR, paid: [], graph, hubs: new Set(), idOf: (w) => w, now: NOW });
  assert.equal(clusters.standing(addr("Aged")), "independent");
  assert.equal(clusters.standing(addr("Fresh")), "unknown");
});

test("the launch slot counts every buy in the creation's block but the creator's own, with its share of supply", () => {
  const flow = launchFlow(input());
  assert.deepEqual({ ...flow.launchSlot, signatures: flow.launchSlot.signatures.length }, { slot: 1000, at: iso(CREATED.at), buys: 2, wallets: 2, supplyBps: 170, signatures: 2 });
  assert.equal(launchFlow(input({ created: null })).launchSlot, null, "a creation not read is not «none»");
});

test("same-slot bundles: the launch slot, and a later block only where the wallets are tied — never by the block alone", () => {
  const { trades, graph } = fixture();
  const groups = sameSlotBundles({ trades, creator: CREATOR, own: new Set([RYNTRA]), created: CREATED, clusters: clustersOf(trades, graph) });
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].why, ["launch_slot", "same_payer", "same_cluster"], "the creator paid for a buy in their own block");
  assert.equal(groups[1].slot, 1500);
  assert.deepEqual(groups[1].why, ["same_cluster"]);
  assert.equal(groups[1].wallets.length, 3, "the person in the farm's block is not in its bundle");
  const flow = launchFlow(input());
  assert.equal(flow.bundles.count, 2);
  assert.equal(flow.bundles.wallets, 5);
  assert.equal(flow.bundles.holdsBps, 170);
});

test("the creator's strip: bought, sold of what they bought, holds, and the wallets of their party", () => {
  const flow = launchFlow(input());
  assert.equal(flow.dev.boughtBps, 120);
  assert.equal(flow.dev.soldBps, 30);
  assert.equal(flow.dev.soldOfBoughtBps, 2500);
  assert.equal(flow.dev.sales, 1);
  assert.equal(flow.dev.lastSale.signature, sig("CreatorSale"));
  assert.equal(flow.dev.holdsBps, 900);
  assert.deepEqual(flow.dev.linked, { wallets: 1, boughtBps: 90, holdsBps: 90 });
});

test("the buyers' counts are a floor while a start is not read, and the answer fits the contract", () => {
  const flow = launchFlow(input());
  assert.deepEqual(flow.buyers, { wallets: 12, independent: 5, merged: 5, creatorLinked: 1, unknown: 1, roundTrips: 1, atLeast: true });
  assert.equal(flow.complete, false);
  LaunchFlowResponseSchema.parse({ ...flow, observedAt: iso(NOW) });
});

test("graduation: how many independent buyers filled the curve, and a warning when one buy did it alone", () => {
  const graduated = { at: CREATED.at + 7000, signature: sig("Graduation") };
  const spread = launchFlow(input({ migrated: true, graduated }));
  assert.deepEqual(spread.graduation.buyers, { wallets: 12, independent: 5 });
  assert.equal(spread.graduation.singleTrade, false);
  assert.ok(spread.graduation.largestBuy.thresholdBps < FLOW_RULES.singleTradeBps);

  n = 0;
  const whale = addr("Whale");
  const trades = [trade({ trader: CREATOR, slot: CREATED.slot, at: CREATED.at }), trade({ trader: whale, usd: 45_000 }), trade({ trader: people[0], usd: 20 })];
  const alone = launchFlow(input({ trades, migrated: true, graduated, clusters: clustersOf(trades, graphOf({ [whale]: addr("WhaleFunder"), [people[0]]: peopleFunders[0], [CREATOR]: OLD })) }));
  assert.equal(alone.graduation.singleTrade, true);
  assert.equal(alone.graduation.largestBuy.signature, trades[1].signature);
  assert.equal(alone.graduation.largestBuy.thresholdBps, 7425);
});

test("a survival proof made by the creator's party does not light the ring", () => {
  const proof = { signature: sig("Proof"), at: NOW - DAY };
  const survival = [
    { days: 7, state: "alive", proof, prover: { trader: SECOND, payer: SECOND } },
    { days: 30, state: "alive", proof, prover: { trader: people[1], payer: people[1] } },
    { days: 90, state: "young", proof: null, prover: null },
  ];
  const flow = launchFlow(input({ survival }));
  assert.deepEqual(flow.survival.map((entry) => entry.independent), [false, true, null]);
  assert.deepEqual(flow.survival.map(ringOf), ["unproven", "alive", "young"]);
  assert.deepEqual(clusterAwareRings(["alive", "alive", "young"], flow), ["unproven", "alive", "young"]);
  assert.deepEqual(clusterAwareRings(["alive", "quiet", "young"], null), ["alive", "quiet", "young"]);
  const counts = clusterAwareCounts(flow);
  assert.equal(counts.independentBuyers, 5);
  assert.equal(counts.atLeast, true);
  assert.equal(counts.graduatedBy, null);
});

test("the creator's earlier coins: survived when alive at the longest horizon decided, judged only once decided", () => {
  assert.equal(pastSurvived([{ days: 7, state: "alive" }, { days: 30, state: "quiet" }, { days: 90, state: "young" }]), false);
  assert.equal(pastSurvived([{ days: 7, state: "alive" }, { days: 30, state: "young" }, { days: 90, state: "young" }]), true);
  assert.equal(pastSurvived([{ days: 7, state: "unread" }, { days: 30, state: "young" }, { days: 90, state: "young" }]), null);
  const outcomes = (states) => states.map((state, i) => ({ days: [7, 30, 90][i], state, proof: null }));
  const flow = launchFlow(
    input({
      past: [
        { token: addr("Past1"), symbol: "ONE", launchedAt: iso(NOW - 100 * DAY), outcomes: outcomes(["alive", "alive", "alive"]), link: "same_wallet" },
        { token: addr("Past2"), symbol: "TWO", launchedAt: iso(NOW - 40 * DAY), outcomes: outcomes(["alive", "quiet", "young"]), link: "same_cluster" },
        { token: addr("Past3"), symbol: "THREE", launchedAt: iso(NOW - 2 * DAY), outcomes: outcomes(["young", "young", "young"]), link: "same_wallet" },
      ],
    }),
  );
  assert.deepEqual({ count: flow.creatorRecord.count, judged: flow.creatorRecord.judged, survived: flow.creatorRecord.survived }, { count: 3, judged: 2, survived: 1 });
  assert.equal(flow.creatorRecord.launches[0].symbol, "THREE", "the newest first");
});

test("the server reads the market, the kept survival, the trails and the creator's cluster — and writes nothing of the Growth line's", async () => {
  const store = createMemoryGuardStore();
  const { trades, graph } = fixture();
  const record = (token, creator, ago) => ({ cluster: "devnet", state: "LAUNCHED", token, pool: addr(`Pool${token.slice(0, 4)}`), creator, symbol: token.slice(0, 4), launchedAt: iso(NOW - ago * DAY), preset: "classic", pairMint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", signature: sig("Creation") });
  await store.collection("launches").set(`solana:devnet:${TOKEN}`, record(TOKEN, CREATOR, 3));
  await store.collection("launches").set(`solana:devnet:${addr("Earuer")}`, record(addr("Earuer"), CREATOR, 60));
  await store.collection("launches").set(`solana:devnet:${addr("Sibting")}`, record(addr("Sibting"), addr("SibtingCreator"), 40));
  await store.collection("launches").set(`solana:devnet:${addr("Stranger")}`, record(addr("Stranger"), addr("StrangerCreator"), 20));
  await store.collection("launchSurvival").set(`devnet:${addr("Earuer")}:7`, { cluster: "devnet", token: addr("Earuer"), days: 7, outcome: { days: 7, state: "alive", proof: { signature: sig("P7"), at: NOW - 55 * DAY } }, decidedAt: iso(NOW) });
  await store.collection("launchSurvival").set(`devnet:${addr("Earuer")}:30`, { cluster: "devnet", token: addr("Earuer"), days: 30, outcome: { days: 30, state: "quiet", proof: null }, decidedAt: iso(NOW) });
  const funders = new Map([...graph].filter(([, node]) => node.state === "FOUND").map(([wallet, node]) => [wallet, node.funder]));
  funders.set(addr("SibtingCreator"), OLD);
  funders.set(addr("StrangerCreator"), addr("StrangerFunder"));
  const asked = [];
  const deps = {
    network: { cluster: "devnet", chain: "solana:devnet", pairs: { classic: { mint: "9gCUiQwyGzSaV5tCvn3jQWJfCqwdKDkhbPYgAG5mZiHB", symbol: "USDC", decimals: 6, usdPrice: 1, dollar: true } }, communities: [] },
    store,
    now: () => new Date(NOW * 1000),
    ryntraWallets: async () => ({ wallets: new Set([RYNTRA]), complete: true }),
    funding: async (wallet) => {
      asked.push(wallet);
      if (wallet === UNTRACED) return { state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null };
      const funder = funders.get(wallet);
      return funder ? { state: "FOUND", funder, firstAt: iso(NOW - 5 * DAY), lastAt: iso(NOW - DAY) } : { state: "DEEP", funder: null, firstAt: iso(NOW - 400 * DAY), lastAt: iso(NOW - DAY) };
    },
    facts: async () => ({
      trades,
      created: CREATED,
      historyComplete: true,
      creatorTradesComplete: true,
      supplyRaw: String(SUPPLY),
      graduated: null,
      state: { pairDecimals: 6 },
      foundHolders: [{ owner: CREATOR, account: addr("A1"), amountRaw: "9000000000000" }],
      response: { holders: { groups: { creatorBps: 900 } }, progress: { migrated: false, thresholdRaw: "60000000000" } },
    }),
    transaction: async () => null,
  };
  const before = (await store.collection("growthFunding").valuesWithPrefix("").catch(() => [])).length;
  const flow = await assembleLaunchFlow(deps, TOKEN);
  LaunchFlowResponseSchema.parse(flow);
  assert.equal(flow.buyers.independent, 5);
  assert.ok(asked.includes(CREATOR) && asked.includes(people[0]));
  // The earlier coin of the same wallet and the coin of a creator from the same funder; never a stranger's.
  assert.deepEqual(flow.creatorRecord.launches.map((launch) => [launch.symbol, launch.link, launch.survived]), [["Sibt", "same_cluster", null], ["Earu", "same_wallet", false]]);
  assert.equal((await store.collection("growthFunding").valuesWithPrefix("").catch(() => [])).length, before);
  assert.equal(await assembleLaunchFlow(deps, addr("Missing")), null);
});
