import assert from "node:assert/strict";
import test from "node:test";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { listRankEvents, readRankStanding } from "../rewards/rank-store.ts";
import { NETWORK_ENTRY_COLLECTION, NetworkEntrySchema } from "./network.ts";
import { accrueNetwork, checkNetworkLedger, readNetworkLedger, readPartnerNetwork } from "./network-store.ts";
import { PARTNER_RULES_VERSION } from "./partner.ts";
import { appendPoolShareRows } from "./pool-share-store.ts";
import {
  activationOf,
  ancestryOf,
  availableFrom,
  holdState,
  ipPrefix,
  needsReview,
  PROTECT_RULES,
  roundTripTrades,
  signalHash,
  signalKeyFrom,
  trimToLimits,
  trustScore,
} from "./protect.ts";
import { protectNetwork, registryWallets, revealSource } from "./protect-store.ts";
import { caseOf, poolSubject, REVIEW_EVENT_COLLECTION, walletSubject } from "./review.ts";
import { actOnCase, heldPartnerPools, markHub, purgeExpired, readEvidence, readHubLog, readHubs, readSubjectEvents, recordDevice, walletHeld, walletHold } from "./review-store.ts";

const registry = ATTRIBUTION_REGISTRY;
const SAFE = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const PROTECTED = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CREATOR = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const PARTNER = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const TX = "5".repeat(88);
const DAY = 86_400_000;
const T0 = "2026-10-20T00:00:00.000Z";
const at = (days, hours = 0) => new Date(Date.parse(T0) + days * DAY + hours * 3_600_000).toISOString();
const KEY = Buffer.alloc(32, 7);
const h = (wallet) => signalHash(KEY, "address", wallet);

/** A valid-looking base58 address from a tag. */
const addr = (tag) => `${tag}${"x".repeat(44)}`.slice(0, 44);
const [E1, E2, E3, E4, E5] = ["Ext1", "Ext2", "Ext3", "Ext4", "Ext5"].map(addr);
const [F1, F2, F3, F4, FC] = ["Fund1", "Fund2", "Fund3", "Fund4", "FundC"].map(addr);
const TEAM_WALLET = addr("Team");
const EXCHANGE = addr("Exchange");

const binding = (over = {}) => ({
  schema: 1, network: "solana", factory: PROTECTED, pool: POOL, creator: CREATOR, creationTx: TX, launchedAt: at(-1), partner: PARTNER, partnerCode: "BCDFGHJKLMNP",
  source: "inviter", decided: true, rulesVersion: PARTNER_RULES_VERSION, checks: { status: "measured", reasons: [], at: at(-1) }, recordedAt: at(-1), version: 1, ...over,
});
async function bind(store, over = {}) {
  const row = binding(over);
  await store.collection("growthPoolPartners").set(`pool:${row.network}:${row.pool}`, row);
  return row;
}
let serial = 0;
const claim = (when, usd) => ({
  kind: "CLAIM", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, venuePool: null, config: PROTECTED, creator: CREATOR, source: "curve", claimer: SAFE,
  claim: { tx: `claim${++serial}`, index: "1.0", block: serial, at: when, finality: "finalized" },
  asset: { mint: USDC, symbol: "USDC", decimals: 6 }, claimedRaw: usd, receivedRaw: usd, tokenRaw: "0", rule: "ALL", usdMicros: usd,
  valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null }, allocation: null, recordedAt: when,
});
const trade = (wallet, when, usd = 5_000_000n, side = "buy") => ({ wallet, side, usdMicros: usd, at: when, tx: `t${++serial}` });

/** The chain as the test says it is: who funded whom, deep histories, the curve's trades, transfers. */
function chain({ funders = {}, deep = [], trades = [], transfers = {}, team = [TEAM_WALLET], young = [], failing = [] } = {}) {
  const calls = { funding: 0, transfers: 0, curve: 0 };
  return {
    calls,
    deps: {
      key: KEY,
      profileOf: async () => null,
      team: async () => new Set(team),
      funding: async (wallet) => {
        calls.funding += 1;
        if (failing.includes(wallet)) return { state: "UNAVAILABLE", funder: null, firstAt: null, lastAt: null };
        if (deep.includes(wallet)) return { state: "DEEP", funder: null, firstAt: null, lastAt: at(0) };
        const span = young.includes(wallet) ? [at(-1), at(0, 2)] : [at(-200), at(0)];
        return funders[wallet] ? { state: "FOUND", funder: funders[wallet], firstAt: span[0], lastAt: span[1] } : { state: "UNKNOWN", funder: null, firstAt: span[0], lastAt: span[1] };
      },
      transfers: async (wallet) => {
        calls.transfers += 1;
        return { items: transfers[wallet] ?? [], complete: true };
      },
      curveTrades: async () => {
        calls.curve += 1;
        return { trades, complete: true };
      },
    },
  };
}
const independent = { [E1]: F1, [E2]: F2, [E3]: F3, [CREATOR]: FC, [PARTNER]: F4 };
const three = [trade(E1, at(0, 1)), trade(E2, at(1)), trade(E3, at(2))];
async function journal(store, rows) {
  const written = await appendPoolShareRows(store, rows);
  assert.equal(written.refused.length, 0, JSON.stringify(written.refused));
}
async function events(store, subject = poolSubject("solana", POOL)) {
  return (await readSubjectEvents(store, subject)).events;
}

/* ------------------------------------------------------------------------------------------- rules */

test("hashes: keyed, equal for equal values, never the value; no key, nothing to hash with", () => {
  assert.match(h(E1), /^h1:[A-Za-z0-9_-]{32}$/);
  assert.equal(h(E1), h(` ${E1} `));
  assert.notEqual(h(E1), h(E2));
  assert.notEqual(h(E1), signalHash(Buffer.alloc(32, 8), "address", E1), "another key, another hash");
  assert.notEqual(signalHash(KEY, "ip24", "10.1.2.0/24"), signalHash(KEY, "device", "10.1.2.0/24"));
  assert.ok(!h(E1).includes(E1.slice(0, 8)));
  assert.equal(signalKeyFrom({}), null);
  assert.equal(signalKeyFrom({ BETA_TOKEN_SECRET: "short" }), null);
  assert.equal(signalKeyFrom({ BETA_TOKEN_SECRET: "a".repeat(32) }).length, 32);
  assert.deepEqual([ipPrefix("203.0.113.77, 10.0.0.1"), ipPrefix("2001:db8:abcd:12::1"), ipPrefix("nonsense"), ipPrefix("300.1.1.1")], ["203.0.113.0/24", "2001:db8:abcd::/48", null, null]);
});

test("S10 and the trust score: one hard signal or two soft ones open a case", () => {
  assert.equal(needsReview(["S5_YOUNG_WALLETS"]), false);
  assert.equal(needsReview(["S5_YOUNG_WALLETS", "S6_ROUND_TRIP"]), true);
  assert.equal(needsReview(["S1_SHARED_FUNDING"]), true);
  assert.equal(needsReview(["S6_ROUND_TRIP", "S6_ROUND_TRIP"]), false, "one signal twice is one signal");
  assert.deepEqual([trustScore([]), trustScore(["S5_YOUNG_WALLETS"]), trustScore(["S1_SHARED_FUNDING", "S2_DIRECT_FUNDS", "S4_SHARED_DEVICE"])], [100, 85, 0]);
});

test("the funding graph: two steps back; only a hub the reviewer marked ends the shared trail; an unread step is incomplete", () => {
  const graph = new Map([
    [h(E1), { state: "FOUND", funder: h(F1), firstAt: null, lastAt: null }],
    [h(F1), { state: "FOUND", funder: h(F2), firstAt: null, lastAt: null }],
    [h(F2), { state: "FOUND", funder: h(F3), firstAt: null, lastAt: null }],
    [h(E2), { state: "FOUND", funder: h(EXCHANGE), firstAt: null, lastAt: null }],
    [h(EXCHANGE), { state: "DEEP", funder: null, firstAt: at(-500), lastAt: null }],
    [h(E3), { state: "FOUND", funder: h(F4), firstAt: null, lastAt: null }],
  ]);
  assert.deepEqual(ancestryOf(h(E1), graph, new Set()), { chain: [h(F1), h(F2)], ancestors: [h(F1), h(F2)], complete: true, deep: false, since: null });
  assert.deepEqual(ancestryOf(h(E2), graph, new Set()).ancestors, [h(EXCHANGE)], "a long history is no hub by itself: only the reviewer says so");
  assert.deepEqual(ancestryOf(h(E2), graph, new Set([h(EXCHANGE)])).ancestors, [], "a marked hub is nobody's shared source");
  assert.deepEqual(ancestryOf(h(E1), graph, new Set([h(F1)])), { chain: [h(F1), h(F2)], ancestors: [], complete: true, deep: false, since: null }, "the trail stays: who funded a wallet directly owns it");
  assert.equal(ancestryOf(h(E3), graph, new Set()).complete, false, "the funder was not read: incomplete");
  assert.equal(ancestryOf(h(E4), graph, new Set()).complete, false);
  assert.deepEqual(ancestryOf(h(EXCHANGE), graph, new Set()), { chain: [], ancestors: [], complete: true, deep: true, since: at(-500) });
});

test("S6: a buy sold back within a day for about nothing is a round trip; a real exit is not", () => {
  const trips = roundTripTrades([
    { wallet: E1, side: "buy", usdMicros: 10_000_000n, at: at(0), tx: "a" },
    /* A curve takes 1 % each way: an empty round trip comes back 2 % and more short — still about nothing. */
    { wallet: E1, side: "sell", usdMicros: 9_780_000n, at: at(0, 5), tx: "b" },
    { wallet: E2, side: "buy", usdMicros: 10_000_000n, at: at(0), tx: "c" },
    { wallet: E2, side: "sell", usdMicros: 14_000_000n, at: at(0, 5), tx: "d" },
    { wallet: E3, side: "buy", usdMicros: 10_000_000n, at: at(0), tx: "e" },
    { wallet: E3, side: "sell", usdMicros: 10_000_000n, at: at(2), tx: "f" },
  ]);
  assert.deepEqual([...trips].sort(), ["a", "b"]);
});

test("fixed money: S7 hold, S9 waiting, S8 limits trimmed oldest first — a kind without a limit grants nothing", () => {
  assert.equal(holdState("TASK", at(0), null, at(2)), "WAITING");
  assert.equal(holdState("TASK", at(0), null, at(3)), "MET");
  assert.equal(holdState("BONUS", at(0), at(3), at(10)), "BROKEN");
  assert.equal(holdState("BONUS", at(0), at(8), at(10)), "MET");
  assert.deepEqual([availableFrom("BONUS", at(0)), availableFrom("FRIEND", at(0))], [at(7), at(14)]);
  const req = (id, wallet, usd, when, kind = "BONUS") => ({ id, wallet, kind, usdMicros: usd, at: when });
  const out = trimToLimits(
    [req("a", E1, 5_000_000n, at(0)), req("b", E1, 5_000_000n, at(1)), req("c", E2, 5_000_000n, at(1)), req("d", E3, 5_000_000n, at(2)), req("e", E3, 1n, at(2), "TASK")],
    { perWalletMonth: { BONUS: { count: 1, usdMicros: 5_000_000n } }, budgetUsdMicros: 12_000_000n },
  );
  assert.deepEqual(out.granted, [{ id: "a", usdMicros: 5_000_000n }, { id: "c", usdMicros: 5_000_000n }, { id: "d", usdMicros: 2_000_000n }]);
  assert.deepEqual(out.trimmed.map((row) => [row.id, row.reason, row.usdMicros]), [["b", "MONTH_COUNT", 5_000_000n], ["d", "BUDGET", 3_000_000n], ["e", "KIND_UNLIMITED", 1n]]);
});

/* -------------------------------------------------------------------------------- the activated creator */

const graphOf = (funders, deep = []) => {
  const graph = new Map();
  for (const [wallet, funder] of Object.entries(funders)) graph.set(h(wallet), { state: "FOUND", funder: h(funder), firstAt: at(-200), lastAt: at(0) });
  for (const funder of new Set(Object.values(funders))) if (!graph.has(h(funder))) graph.set(h(funder), { state: "UNKNOWN", funder: null, firstAt: at(-300), lastAt: at(-1) });
  for (const wallet of deep) graph.set(h(wallet), { state: "DEEP", funder: null, firstAt: at(-200), lastAt: at(0) });
  return graph;
};
const activation = (trades, funders = independent, over = {}) =>
  activationOf({ launchedAt: at(-1), now: at(40), creator: { wallet: CREATOR, linked: [] }, partner: { wallet: PARTNER, linked: [] }, team: new Set([TEAM_WALLET]), trades, hash: h, graph: graphOf(funders, over.deep), hubs: new Set(), ...over });

test("three addresses: three independent external addresses with real trades within 30 days activate the creator — at the third", () => {
  assert.equal(activation(three.slice(0, 2)).activated, false);
  const read = activation(three);
  assert.deepEqual([read.activated, read.at, read.independent, read.external], [true, at(2), 3, 3]);
  /* Thirty days apart are not "within thirty days". */
  const spread = activation([trade(E1, at(0)), trade(E2, at(15)), trade(E3, at(31))]);
  assert.deepEqual([spread.activated, spread.independent], [false, 2]);
  /* A trade under a dollar, or half of a round trip, is not activity. */
  assert.equal(activation([...three.slice(0, 2), trade(E3, at(2), 999_999n)]).activated, false);
  const trip = activation([...three.slice(0, 2), trade(E3, at(2), 5_000_000n, "buy"), trade(E3, at(2, 3), 5_000_000n, "sell")]);
  assert.equal(trip.activated, false);
});

test("the team: its trades stay in the volume, marked — never activity, never an external address", () => {
  const read = activation([...three.slice(0, 2), trade(TEAM_WALLET, at(2), 7_000_000n)]);
  assert.deepEqual([read.activated, read.independent, read.volumeUsdMicros, read.teamVolumeUsdMicros], [false, 2, 17_000_000n, 7_000_000n]);
  assert.equal(read.traders.find((trader) => trader.hash === h(TEAM_WALLET)).kind, "TEAM");
});

test("a cluster: addresses sharing a funding source count once; one sharing the creator's source is the creator's own", () => {
  const sameSource = activation(three, { ...independent, [E3]: F1 });
  assert.deepEqual([sameSource.activated, sameSource.independent, sameSource.external], [false, 2, 3]);
  assert.deepEqual(sameSource.sharedSources, [{ hash: h(F1), wallets: 2 }], "the reviewer sees the source that joined them");
  const creatorsOwn = activation(three, { ...independent, [E3]: FC });
  assert.deepEqual([creatorsOwn.activated, creatorsOwn.external, creatorsOwn.insiderVolumeUsdMicros], [false, 2, 5_000_000n]);
  /* Funded straight from the partner's wallet: the partner's own. */
  assert.equal(activation(three, { ...independent, [E3]: PARTNER }).activated, false);
  /* Two funded from one exchange are one, until the reviewer marks it a hub. */
  const exchange = { ...independent, [E2]: EXCHANGE, [E3]: EXCHANGE };
  assert.equal(activation(three, exchange, { deep: [EXCHANGE] }).activated, false);
  assert.equal(activation(three, exchange, { deep: [EXCHANGE], hubs: new Set([h(EXCHANGE)]) }).activated, true);
  /* An address with a long life of its own counts alone; one whose funding was not read does not count. */
  assert.equal(activation(three, { [E1]: F1, [E2]: F2, [CREATOR]: FC, [PARTNER]: F4 }, { deep: [E3] }).activated, true);
  const unread = activation(three, { [E1]: F1, [E2]: F2, [CREATOR]: FC, [PARTNER]: F4 }, { graph: new Map([...graphOf({ [E1]: F1, [E2]: F2, [CREATOR]: FC, [PARTNER]: F4 })]) });
  assert.deepEqual([unread.activated, unread.unknown], [false, 1]);
});

test("gaming the activation: a creator with a long history funding the traders, a linked wallet funding them, a few days made to look long", () => {
  /* The creator's own history is too long to read, and it funded all three: they are the creator's, not external. */
  const deepCreator = graphOf({ [E1]: CREATOR, [E2]: CREATOR, [E3]: CREATOR, [PARTNER]: F4 }, [CREATOR]);
  const direct = activationOf({ launchedAt: at(-1), now: at(40), creator: { wallet: CREATOR, linked: [] }, partner: { wallet: PARTNER, linked: [] }, team: new Set(), trades: three, hash: h, graph: deepCreator, hubs: new Set([h(CREATOR)]) });
  assert.deepEqual([direct.activated, direct.external], [false, 0], "even a creator marked a hub owns the wallets it funded");
  /* A wallet linked to the partner funds them. */
  const LINKED = addr("Linked");
  const viaLink = activationOf({ launchedAt: at(-1), now: at(40), creator: { wallet: CREATOR, linked: [] }, partner: { wallet: PARTNER, linked: [LINKED, "0x00000000000000000000000000000000000000aa"] }, team: new Set(), trades: three, hash: h, graph: graphOf({ [E1]: LINKED, [E2]: LINKED, [E3]: LINKED, [CREATOR]: FC, [PARTNER]: F4, [LINKED]: F2 }), hubs: new Set() });
  assert.deepEqual([viaLink.activated, viaLink.external], [false, 0]);
  /* Three wallets made "deep" with a few days of noise: their history does not reach thirty days before the trade. */
  const noisy = graphOf({ [CREATOR]: FC, [PARTNER]: F4 });
  for (const wallet of [E1, E2, E3]) noisy.set(h(wallet), { state: "DEEP", funder: null, firstAt: at(-5), lastAt: at(0) });
  const fresh = activationOf({ launchedAt: at(-1), now: at(40), creator: { wallet: CREATOR, linked: [] }, partner: { wallet: PARTNER, linked: [] }, team: new Set(), trades: three, hash: h, graph: noisy, hubs: new Set() });
  assert.deepEqual([fresh.activated, fresh.unknown], [false, 3]);
  /* Round trips are no volume. */
  const trips = activation([...three, trade(E4, at(3), 10_000_000n), trade(E4, at(3, 1), 9_800_000n, "sell")], { ...independent, [E4]: addr("Fund6") });
  assert.deepEqual([trips.volumeUsdMicros, trips.roundTripVolumeUsdMicros], [15_000_000n, 19_800_000n]);
});

/* -------------------------------------------------------------------------------------- the run */

test("the run: three independent addresses activate the creator once; no signal, no case; the money follows", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const { deps } = chain({ funders: independent, trades: three });
  const run = await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([run.pools[0].state, run.pools[0].activated, run.pools[0].independent, run.pools[0].signals, run.pools[0].review], ["CHECKED", true, 3, [], "NONE"]);
  assert.deepEqual(await events(store), []);
  await journal(store, [claim(at(1), "5000000")]);
  await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(4)) });
  const pool = (await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0];
  assert.deepEqual([pool.status, pool.activated, pool.availableUsdMicros, pool.heldUsdMicros], ["EARNING", true, "1000000", "0"]);
  /* Activation is written once: a later run with fewer trades never takes it back. */
  const later = chain({ funders: independent, trades: [] });
  const again = await protectNetwork(store, later.deps, { registry, clock: () => Date.parse(at(50)) });
  assert.equal(again.pools[0].activated, true);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(50) })).pools[0].activated, true);
});

test("not activated: earned and pending as before, but nothing becomes available and no point counts — until the creator is", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(1), "5000000")]);
  const two = chain({ funders: independent, trades: three.slice(0, 2) });
  await protectNetwork(store, two.deps, { registry, clock: () => Date.parse(at(2)) });
  const run = await accrueNetwork(store, two.deps, { registry, clock: () => Date.parse(at(2)) });
  assert.equal(run.pools[0].protection, "AWAITING_ACTIVATION");
  assert.ok(run.points.held > 0);
  const waiting = (await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0];
  assert.deepEqual([waiting.activated, waiting.earnedUsdMicros, waiting.availableUsdMicros, waiting.heldUsdMicros], [false, "1000000", "0", "1000000"]);
  assert.equal((await readRankStanding(store, PARTNER, at(20))).fromPartners, 0n);
  /* The third address on day 21: the money follows at once, the points from the moment the run saw it. */
  const all = chain({ funders: independent, trades: [...three.slice(0, 2), trade(E3, at(21))] });
  await protectNetwork(store, all.deps, { registry, clock: () => Date.parse(at(22)) });
  await accrueNetwork(store, all.deps, { registry, clock: () => Date.parse(at(22)) });
  const paid = (await readPartnerNetwork(store, PARTNER, { now: at(22) })).pools[0];
  assert.deepEqual([paid.activated, paid.availableUsdMicros, paid.heldUsdMicros], [true, "1000000", "0"]);
  const [event] = await listRankEvents(store, PARTNER);
  assert.equal(event.at, at(22), "the point counts from the moment the money may follow — never dated back");
  assert.equal((await readRankStanding(store, PARTNER, at(21))).fromPartners, 0n);
  assert.equal((await readRankStanding(store, PARTNER, at(23))).fromPartners, 5n);
});

test("a cluster between the creator and the partner (S1) opens a case; the repeat writes nothing; the queue lets nothing through", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(1), "5000000")]);
  const shared = chain({ funders: { ...independent, [CREATOR]: F1, [PARTNER]: F1, [E1]: addr("Fund9") }, trades: three });
  const run = await protectNetwork(store, shared.deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([run.pools[0].activated, run.pools[0].signals, run.pools[0].review], [true, ["S1_SHARED_FUNDING"], "OPENED"]);
  /* The repeat: the same signals write nothing, and the chain is read from the cache. */
  const before = (await store.collection(REVIEW_EVENT_COLLECTION).valuesWithPrefix("")).length;
  const reads = shared.calls.funding;
  const repeat = await protectNetwork(store, shared.deps, { registry, clock: () => Date.parse(at(4)) });
  assert.equal(repeat.pools[0].review, "UNCHANGED");
  assert.equal((await store.collection(REVIEW_EVENT_COLLECTION).valuesWithPrefix("")).length, before);
  assert.equal(shared.calls.funding, reads, "funding facts come from the cache");
  /* The evidence is the shared source's hash, never its address, and it expires. */
  const evidence = await readEvidence(store, poolSubject("solana", POOL), at(5));
  assert.deepEqual(evidence.map((row) => [row.code, row.hash]), [["S1_SHARED_FUNDING", h(F1)]]);
  assert.ok(!JSON.stringify(await store.collection("growthSignals").valuesWithPrefix("")).includes(F1));
  assert.ok(!JSON.stringify(await store.collection("growthFunding").valuesWithPrefix("")).includes(F1));
  assert.deepEqual(await readEvidence(store, poolSubject("solana", POOL), at(3 + PROTECT_RULES.retentionDays + 1)), []);

  /* The queue lets nothing through: earned, pending, then held — never available while the case is open, however long. */
  await accrueNetwork(store, shared.deps, { registry, clock: () => Date.parse(at(4)) });
  for (const day of [20, 60, 400]) {
    const pool = (await readPartnerNetwork(store, PARTNER, { now: at(day) })).pools[0];
    assert.deepEqual([pool.status, pool.availableUsdMicros, pool.heldUsdMicros, pool.reasons], ["REVIEW", "0", "1000000", []], `day ${day}`);
  }
  /* A run after the hold, the case still open: the base is not written, so no point counts. */
  await accrueNetwork(store, shared.deps, { registry, clock: () => Date.parse(at(19)) });
  assert.equal((await readRankStanding(store, PARTNER, at(30))).fromPartners, 0n, "no point while under review");
  /* Ріст 3: the Rewards read asks only for the pools its points name, by key — the same answer as reading every binding. */
  const named = await heldPartnerPools(store, PARTNER, at(30), [{ network: "solana", pool: POOL }, { network: "solana", pool: POOL }, { network: "nowhere", pool: POOL }]);
  assert.deepEqual([...named], [`solana:${POOL}:`]);
  assert.deepEqual([...named], [...(await heldPartnerPools(store, PARTNER, at(30)))]);
  assert.deepEqual([...(await heldPartnerPools(store, PARTNER, at(30), []))], []);
  /* The reviewer sees why, when it is due and the trust score; the partner sees none of it. */
  const ledger = (await readNetworkLedger(store, { now: at(5) })).partners[0].pools[0];
  assert.deepEqual([ledger.status, ledger.review.effect, ledger.review.pool.signals, ledger.review.pool.trust, ledger.review.pool.dueAt, ledger.review.pool.overdue], ["REVIEW", "HOLD", ["S1_SHARED_FUNDING"], 60, at(6), false]);
  assert.equal((await readNetworkLedger(store, { now: at(7) })).partners[0].pools[0].review.pool.overdue, true);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(5) })).pools[0].review, null);

  /* The reviewer clears it, with a reason: the money follows; the same signal never reopens it. */
  const cleared = await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "Friends from one city, separate people.", seen: 0 }, by: "admin:owner", now: at(20) });
  assert.equal(cleared.ok, true);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(21) })).pools[0].availableUsdMicros, "1000000");
  await accrueNetwork(store, shared.deps, { registry, clock: () => Date.parse(at(21)) });
  assert.equal((await listRankEvents(store, PARTNER))[0].at, at(20), "the point counts from the decision that let the money go — never dated back over the case");
  const third = await protectNetwork(store, shared.deps, { registry, clock: () => Date.parse(at(22)) });
  assert.equal(third.pools[0].review, "UNCHANGED");
});

test("cancel: the reviewer returns what waited — negative entries naming the review, points taken back; adjust: paid up to the amount named", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(1), "5000000"), claim(at(2), "5000000")]);
  const clean = chain({ funders: independent, trades: three });
  await protectNetwork(store, clean.deps, { registry, clock: () => Date.parse(at(3)) });
  await accrueNetwork(store, clean.deps, { registry, clock: () => Date.parse(at(3)) });
  await accrueNetwork(store, clean.deps, { registry, clock: () => Date.parse(at(18)) });
  assert.equal((await readRankStanding(store, PARTNER, at(20))).fromPartners, 10n);
  /* A device shared with the creator, seen later (S4): a case, then a decision. */
  await recordDevice(store, { wallet: CREATOR, signals: [{ kind: "device", hash: signalHash(KEY, "device", "ua+ip") }], now: at(19) });
  await recordDevice(store, { wallet: PARTNER, signals: [{ kind: "device", hash: signalHash(KEY, "device", "ua+ip") }], now: at(19) });
  const run = await protectNetwork(store, clean.deps, { registry, clock: () => Date.parse(at(20)) });
  assert.deepEqual([run.pools[0].signals, run.pools[0].review], [["S4_SHARED_DEVICE"], "OPENED"]);

  const subject = poolSubject("solana", POOL);
  assert.deepEqual(await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "ADJUST", ceilingUsdMicros: "abc", note: "x", seen: 0 }, by: "admin", now: at(21) }), { ok: false, code: "INVALID" });
  assert.deepEqual(await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "ADJUST", ceilingUsdMicros: "1500000", note: "", seen: 0 }, by: "admin", now: at(21) }), { ok: false, code: "INVALID" }, "a decision says why");
  const adjusted = await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "ADJUST", ceilingUsdMicros: "1500000", note: "One of the three is the creator's brother.", seen: 0 }, by: "admin", now: at(21) });
  assert.equal(adjusted.ok, true);
  await accrueNetwork(store, clean.deps, { registry, clock: () => Date.parse(at(22)) });
  let rows = (await store.collection(NETWORK_ENTRY_COLLECTION).valuesWithPrefix("")).map((row) => NetworkEntrySchema.parse(row));
  assert.equal(rows.reduce((sum, row) => sum + BigInt(row.usdMicros), 0n), 1_500_000n);
  assert.ok(rows.filter((row) => BigInt(row.usdMicros) < 0n).every((row) => row.reason === "REVIEW"));
  assert.equal((await checkNetworkLedger(store, { registry })).ok, true, "the reconciliation holds the pool to the reviewer's amount");

  /* An appeal reopens a decided case: held again, due in 72 hours — once until it is answered. */
  const appeal = await actOnCase(store, { subject, action: { kind: "APPEAL", note: "We are two people; here is why." }, by: "person", now: at(23) });
  assert.equal(appeal.ok, true);
  assert.deepEqual([appeal.view.state, appeal.view.dueAt], ["OPEN", at(26)]);
  assert.deepEqual(await actOnCase(store, { subject, action: { kind: "APPEAL", note: "Again." }, by: "person", now: at(23, 1) }), { ok: false, code: "ALREADY_APPEALED" });
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(30) })).pools[0].availableUsdMicros, "1500000", "an appeal holds nothing the decision let go: the amount stands while it is heard");
  /* A decision on what the reviewer did not see is refused. */
  assert.deepEqual(await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "CLEAR", note: "Looks fine.", seen: 1 }, by: "admin", now: at(24) }), { ok: false, code: "STALE" });
  const cancelled = await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "CANCEL", note: "The appeal shows the same device for both.", seen: 2 }, by: "admin", now: at(24) });
  assert.equal(cancelled.ok, true);
  await accrueNetwork(store, clean.deps, { registry, clock: () => Date.parse(at(25)) });
  rows = (await store.collection(NETWORK_ENTRY_COLLECTION).valuesWithPrefix("")).map((row) => NetworkEntrySchema.parse(row));
  assert.equal(rows.reduce((sum, row) => sum + BigInt(row.usdMicros), 0n), 0n);
  assert.equal((await readRankStanding(store, PARTNER, at(40))).fromPartners, 0n, "the points leave with the money");
  const own = (await readPartnerNetwork(store, PARTNER, { now: at(40) })).pools[0];
  assert.deepEqual([own.status, own.earnedUsdMicros, own.availableUsdMicros, own.reasons], ["BLOCKED", "0", "0", []], "a cancelled pool is closed, not a review still to answer");
  /* The audit trail: every step, who, when and why — never rewritten. */
  const log = await events(store);
  assert.deepEqual(log.map((event) => [event.seq, event.kind, event.by]), [[0, "OPENED", "system"], [1, "DECIDED", "admin"], [2, "APPEALED", "person"], [3, "DECIDED", "admin"]]);
  assert.equal((await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "CLEAR", note: "again", seen: 3 }, by: "admin", now: at(26) })).ok, false, "only an open case is decided");
});

test("a check that could not see everything never lets the money go on its own: an UNVERIFIED case holds it — and a creator found to be the team", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(1), "5000000")]);
  const { deps } = chain({ funders: independent, trades: three });
  const noTransfers = { ...deps, transfers: async () => null };
  const first = await protectNetwork(store, noTransfers, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([first.pools[0].activated, first.pools[0].incomplete, first.pools[0].signals, first.pools[0].review], [true, ["transfers"], ["UNVERIFIED"], "OPENED"]);
  await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([(await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0].availableUsdMicros, (await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0].status], ["0", "REVIEW"]);
  /* A whole read later finds nothing new: the case stays for the person, who clears it — then the money follows. */
  assert.equal((await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(4)) })).pools[0].review, "NONE");
  assert.equal((await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "Read the transfers by hand: nothing between them.", seen: 0 }, by: "admin", now: at(5) })).ok, true);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0].availableUsdMicros, "1000000");
  /* Partial transfers: the same. */
  const partial = createMemoryGuardStore();
  await bind(partial);
  const run = await protectNetwork(partial, { ...deps, transfers: async () => ({ items: [], complete: false }) }, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([run.pools[0].signals, run.pools[0].review], [["UNVERIFIED"], "OPENED"]);
  /* The partner's funding unread: no trader can be shown independent of them, so nobody activates at all. */
  const blind = createMemoryGuardStore();
  await bind(blind);
  const unread = await protectNetwork(blind, chain({ funders: independent, trades: three, failing: [PARTNER] }).deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([unread.pools[0].activated, unread.pools[0].incomplete.includes("funding")], [false, true]);
  /* Activation thanks to wallets whose funding is too old to trace: a person confirms it. */
  const deep = createMemoryGuardStore();
  await bind(deep);
  const old = chain({ funders: { [E1]: F1, [E2]: F2, [CREATOR]: FC, [PARTNER]: F4 }, deep: [E3], trades: three });
  const deepRun = await protectNetwork(deep, { ...old.deps, funding: async (wallet) => (wallet === E3 ? { state: "DEEP", funder: null, firstAt: at(-200), lastAt: at(0) } : old.deps.funding(wallet)) }, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([deepRun.pools[0].activated, deepRun.pools[0].signals], [true, ["UNVERIFIED"]]);
  /* The team, found after the binding: no activation is written for it. */
  const later = createMemoryGuardStore();
  await bind(later);
  const teamCreator = chain({ funders: independent, trades: three, team: [TEAM_WALLET, CREATOR] });
  assert.equal((await protectNetwork(later, teamCreator.deps, { registry, clock: () => Date.parse(at(3)) })).pools[0].state, "BLOCKED");
});

test("a decided signal reopens on new evidence: a new withdrawal address, a new transfer between them — never on the same evidence again", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const [X, Y] = [addr("DepositX"), addr("DepositY")];
  const transfers = { [CREATOR]: [{ counterparty: X, direction: "out", at: at(2) }], [PARTNER]: [{ counterparty: X, direction: "out", at: at(2) }] };
  const first = chain({ funders: independent, trades: three, transfers });
  assert.equal((await protectNetwork(store, first.deps, { registry, clock: () => Date.parse(at(3)) })).pools[0].review, "OPENED");
  await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "A shared exchange account of a couple, both real.", seen: 0 }, by: "admin", now: at(4) });
  assert.equal((await protectNetwork(store, first.deps, { registry, clock: () => Date.parse(at(5)) })).pools[0].review, "UNCHANGED");
  const second = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [...transfers[CREATOR], { counterparty: Y, direction: "out", at: at(6) }], [PARTNER]: [...transfers[PARTNER], { counterparty: Y, direction: "out", at: at(6) }] } });
  assert.equal((await protectNetwork(store, second.deps, { registry, clock: () => Date.parse(at(7)) })).pools[0].review, "SIGNALS");
  assert.equal(caseOf(poolSubject("solana", POOL), await events(store), at(7)).state, "OPEN");
});

test("the retention period is kept: expired evidence, funding facts and sightings are removed; the log stays", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const { deps } = chain({ funders: { ...independent, [CREATOR]: F1, [PARTNER]: F1, [E1]: addr("Fund9") }, trades: three });
  await recordDevice(store, { wallet: PARTNER, signals: [{ kind: "device", hash: signalHash(KEY, "device", "phone") }], now: at(0) });
  await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(3)) });
  const count = async (name) => (await store.collection(name).valuesWithPrefix("")).length;
  assert.ok((await count("growthSignals")) > 0 && (await count("growthFunding")) > 0 && (await count("growthDevices")) > 0);
  assert.deepEqual(await purgeExpired(store, at(10)), { removed: 0 });
  await purgeExpired(store, at(3 + PROTECT_RULES.retentionDays + 1));
  assert.deepEqual([await count("growthSignals"), await count("growthFunding"), await count("growthDevices")], [0, 0, 0]);
  assert.equal((await events(store)).length, 1, "the case's log is not evidence: it stays");
});

test("money between the creator and the partner around the launch (S2) and a shared withdrawal address (S3) open a case", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const deposit = addr("Deposit");
  const { deps } = chain({
    funders: independent,
    trades: three,
    transfers: {
      [CREATOR]: [{ counterparty: PARTNER, direction: "in", at: at(-5) }, { counterparty: deposit, direction: "out", at: at(2) }],
      [PARTNER]: [{ counterparty: deposit, direction: "out", at: at(3) }],
    },
  });
  const run = await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(4)) });
  assert.deepEqual(run.pools[0].signals, ["S2_DIRECT_FUNDS", "S3_SHARED_WITHDRAWAL"]);
  const evidence = (await readEvidence(store, poolSubject("solana", POOL), at(5))).map((row) => [row.code, row.hash]);
  assert.deepEqual(evidence.filter(([code]) => code === "S3_SHARED_WITHDRAWAL"), [["S3_SHARED_WITHDRAWAL", h(deposit)]]);
  assert.deepEqual(evidence.filter(([code]) => code === "S2_DIRECT_FUNDS").map(([, hash]) => hash), [h(`${PARTNER}|in|${at(-5)}`)], "the transfer itself is the evidence — a hash of who and when");
  /* Long before the launch, money between two people is no sign. */
  const old = createMemoryGuardStore();
  await bind(old);
  const quiet = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [{ counterparty: PARTNER, direction: "in", at: at(-60) }] } });
  assert.deepEqual((await protectNetwork(old, quiet.deps, { registry, clock: () => Date.parse(at(4)) })).pools[0].signals, []);
});

test("young wallets (S5) and round trips (S6): soft alone, a case together", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const trips = [trade(E4, at(1), 5_000_000n, "buy"), trade(E4, at(1, 2), 5_000_000n, "sell"), trade(E5, at(1), 5_000_000n, "buy"), trade(E5, at(1, 3), 4_950_000n, "sell")];
  const { deps } = chain({ funders: { ...independent, [E4]: addr("Fund6"), [E5]: addr("Fund7") }, trades: [...three, ...trips], young: [E1, E2] });
  const run = await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(4)) });
  assert.deepEqual([run.pools[0].activated, run.pools[0].signals, run.pools[0].review], [true, ["S5_YOUNG_WALLETS"], "NONE"]);
  const more = createMemoryGuardStore();
  await bind(more);
  const both = chain({ funders: { ...independent, [E4]: addr("Fund6"), [E5]: addr("Fund7"), [addr("Ext6")]: addr("Fund8") }, trades: [...three, ...trips, trade(addr("Ext6"), at(1)), trade(addr("Ext6"), at(1, 1), 5_000_000n, "sell")], young: [E1, E2] });
  const second = await protectNetwork(more, both.deps, { registry, clock: () => Date.parse(at(4)) });
  assert.deepEqual([second.pools[0].signals, second.pools[0].review], [["S5_YOUNG_WALLETS", "S6_ROUND_TRIP"], "OPENED"]);
});

test("a hub the reviewer marks is no shared source from then on; the case it opened stays for the reviewer", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const funders = { ...independent, [CREATOR]: EXCHANGE, [PARTNER]: EXCHANGE };
  const { deps } = chain({ funders, trades: three });
  assert.equal((await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(3)) })).pools[0].review, "OPENED");
  assert.deepEqual(await markHub(store, { hash: h(EXCHANGE), note: "A centralised exchange's hot wallet.", by: "admin", now: at(4) }), { ok: true, created: true });
  const next = await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(5)) });
  assert.deepEqual([next.pools[0].signals, next.pools[0].review], [[], "NONE"]);
  assert.equal(caseOf(poolSubject("solana", POOL), await events(store), at(5)).state, "OPEN", "only a person closes a case");
});

test("a read that fails is no evidence: an unread funding keeps an address uncounted; the team list unread is no data", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const { deps } = chain({ funders: independent, trades: three, failing: [E3] });
  const run = await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([run.pools[0].activated, run.pools[0].incomplete], [false, ["funding"]]);
  assert.deepEqual(await store.collection("growthFunding").valuesWithPrefix(h(E3)), [], "a failed read is never kept");
  const blind = { ...deps, team: async () => null };
  assert.equal((await protectNetwork(store, blind, { registry, clock: () => Date.parse(at(3)) })).pools[0].state, "NO_DATA");
  assert.ok(registryWallets(registry).has(SAFE), "the registry's own wallets are the team's");
});

test("a freeze holds every pool of the partner and their payout; an unreadable log holds too", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(1), "5000000")]);
  const { deps } = chain({ funders: independent, trades: three });
  await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(2)) });
  await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(2)) });
  assert.equal(await walletHeld(store, PARTNER, at(3)), false);
  const subject = walletSubject(PARTNER);
  assert.deepEqual(await actOnCase(store, { subject, action: { kind: "UNFREEZE", note: "no" }, by: "admin", now: at(3) }), { ok: false, code: "NOT_FROZEN" });
  const frozen = await actOnCase(store, { subject, action: { kind: "FREEZE", note: "Three wallets on one phone." }, by: "admin", now: at(3) });
  assert.deepEqual([frozen.ok, frozen.view.dueAt], [true, at(6)], "a freeze is answered within 72 hours too");
  assert.equal(await walletHeld(store, PARTNER, at(4)), true);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0].availableUsdMicros, "0");
  assert.equal((await actOnCase(store, { subject, action: { kind: "UNFREEZE", note: "Checked: three family members." }, by: "admin", now: at(5) })).ok, true);
  assert.equal(await walletHeld(store, PARTNER, at(6)), false);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0].availableUsdMicros, "1000000");
  /* A damaged row of the log holds the wallet and the pool — it is never read as "no case". */
  await store.collection(REVIEW_EVENT_COLLECTION).set(`${subject}:000009`, { subject, junk: true });
  assert.equal(await walletHeld(store, PARTNER, at(7)), true);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0].availableUsdMicros, "0");
});

test("devices: a sighting is kept as hashes, once per period, and expires; a crowd of three wallets on one device is S4", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const device = signalHash(KEY, "device", "phone");
  for (const wallet of [PARTNER, E4, E5]) {
    await recordDevice(store, { wallet, signals: [{ kind: "device", hash: device }], now: at(0) });
    await recordDevice(store, { wallet, signals: [{ kind: "device", hash: device }], now: at(1) });
  }
  const rows = await store.collection("growthDevices").valuesWithPrefix("");
  assert.equal(rows.length, 6, "two keys a wallet, once in the period");
  const { deps } = chain({ funders: independent, trades: three });
  const run = await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual(run.pools[0].signals, ["S4_DEVICE_CROWD"]);
  const late = createMemoryGuardStore();
  await bind(late);
  for (const wallet of [PARTNER, E4, E5]) await recordDevice(late, { wallet, signals: [{ kind: "device", hash: device }], now: at(0) });
  assert.deepEqual((await protectNetwork(late, deps, { registry, clock: () => Date.parse(at(PROTECT_RULES.retentionDays + 1)) })).pools[0].signals, [], "after the retention period nothing is left");
});

test("a base written before a case stops lifting the rank while the case holds the pool, and counts again once it is cleared", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(1), "150000000")]);
  const { deps } = chain({ funders: independent, trades: three });
  await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(2)) });
  await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(2)) });
  await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(17)) });
  assert.equal((await readRankStanding(store, PARTNER, at(18))).rank, "SILVER");
  await recordDevice(store, { wallet: CREATOR, signals: [{ kind: "device", hash: signalHash(KEY, "device", "same") }], now: at(18) });
  await recordDevice(store, { wallet: PARTNER, signals: [{ kind: "device", hash: signalHash(KEY, "device", "same") }], now: at(18) });
  assert.equal((await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(19)) })).pools[0].review, "OPENED");
  const held = await readRankStanding(store, PARTNER, at(20));
  assert.deepEqual([held.fromPartners, held.rank, held.referralL1Bps], [0n, "BRONZE", 1000], "a friend's share is never paid at a rank the review has not let stand");
  await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "One shared office network.", seen: 0 }, by: "admin", now: at(21) });
  assert.equal((await readRankStanding(store, PARTNER, at(22))).rank, "SILVER");
});

test("an adjustment never shows more available than the reviewer's amount, even before the run that cuts the entries", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(1), "10000000")]);
  const { deps } = chain({ funders: independent, trades: three });
  await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(2)) });
  await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(2)) });
  await recordDevice(store, { wallet: CREATOR, signals: [{ kind: "device", hash: signalHash(KEY, "device", "same") }], now: at(3) });
  await recordDevice(store, { wallet: PARTNER, signals: [{ kind: "device", hash: signalHash(KEY, "device", "same") }], now: at(3) });
  await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(4)) });
  await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "ADJUST", ceilingUsdMicros: "100000", note: "Mostly their own trades.", seen: 0 }, by: "admin", now: at(5) });
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0].availableUsdMicros, "0", "held until the entries are within the amount");
  await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(6)) });
  const pool = (await readPartnerNetwork(store, PARTNER, { now: at(30) })).pools[0];
  assert.deepEqual([pool.earnedUsdMicros, pool.availableUsdMicros], ["100000", "100000"]);
});

test("hubs: the reviewer marks and lifts a mark, each step logged; a wallet's cancellation holds its payout like a freeze", async () => {
  const store = createMemoryGuardStore();
  assert.deepEqual(await markHub(store, { hash: h(EXCHANGE), note: "An exchange's hot wallet.", by: "admin", now: at(1) }), { ok: true, created: true });
  assert.deepEqual(await markHub(store, { hash: h(EXCHANGE), note: "Again.", by: "admin", now: at(1) }), { ok: true, created: false }, "a step that changes nothing writes nothing");
  assert.deepEqual([...(await readHubs(store))], [h(EXCHANGE)]);
  assert.deepEqual(await markHub(store, { hash: h(EXCHANGE), note: "It was a farmer's distributor.", by: "admin", now: at(2), marked: false }), { ok: true, created: true });
  assert.deepEqual([...(await readHubs(store))], []);
  assert.deepEqual((await readHubLog(store)).map((event) => event.kind), ["MARKED", "UNMARKED"]);
  const subject = walletSubject(PARTNER);
  await actOnCase(store, { subject, action: { kind: "FREEZE", note: "Look." }, by: "admin", now: at(3) });
  await actOnCase(store, { subject, action: { kind: "APPEAL", note: "Why?" }, by: "person", now: at(3, 1) });
  await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "CANCEL", note: "A farm of eleven wallets.", seen: 1 }, by: "admin", now: at(4) });
  await actOnCase(store, { subject, action: { kind: "UNFREEZE", note: "The decision stands on its own." }, by: "admin", now: at(5) });
  assert.equal(await walletHeld(store, PARTNER, at(6)), true);
});

test("revealing a shared source: the address behind the hash, read again from the chain — never kept", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const { deps } = chain({ funders: { ...independent, [E3]: F1 }, trades: three });
  assert.equal(await revealSource(store, deps, { network: "solana", pool: POOL, hash: h(F1), by: "admin:7" }), F1);
  assert.equal(await revealSource(store, deps, { network: "solana", pool: POOL, hash: h(addr("Nobody")), by: "admin:7" }), null);
  assert.deepEqual((await readHubLog(store)).filter((event) => event.hash === h(F1)).map((event) => [event.kind, event.by]), [["VIEWED", "admin:7"]], "who looked is logged; the address is not");
  assert.ok(!JSON.stringify(await store.collection("growthFunding").valuesWithPrefix("")).includes(F1));
});

test("round 3: every pool's check is dated, so a run's budget turns through them; a failed raise leaves new evidence new; a party with a history too long to read is unverified", async () => {
  /* Rotation: a check with the same figures still moves the pool to the back. */
  const store = createMemoryGuardStore();
  await bind(store);
  const { deps } = chain({ funders: independent, trades: three });
  await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(3)) });
  await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(4)) });
  assert.equal((await store.versioned("growthActivations").get(`pool:solana:${POOL}`)).last.at, at(4));

  /* New evidence after a decision, with the raise failing once: it stays new for the next run. */
  const evidence = createMemoryGuardStore();
  await bind(evidence);
  const [X, Y] = [addr("DepositX"), addr("DepositY")];
  const withX = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [{ counterparty: X, direction: "out", at: at(2) }], [PARTNER]: [{ counterparty: X, direction: "out", at: at(2) }] } });
  await protectNetwork(evidence, withX.deps, { registry, clock: () => Date.parse(at(3)) });
  await actOnCase(evidence, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "A couple's shared account.", seen: 0 }, by: "admin", now: at(4) });
  const withY = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [{ counterparty: Y, direction: "out", at: at(5) }], [PARTNER]: [{ counterparty: Y, direction: "out", at: at(5) }] } });
  let failOnce = true;
  const flaky = {
    ...evidence,
    collection(name) {
      const real = evidence.collection(name);
      if (name !== REVIEW_EVENT_COLLECTION) return real;
      return { ...real, insertIfAbsent: async (key, value) => { if (failOnce) { failOnce = false; throw new Error("store down"); } return real.insertIfAbsent(key, value); } };
    },
    versioned: (name) => evidence.versioned(name),
  };
  assert.deepEqual((await protectNetwork(flaky, withY.deps, { registry, clock: () => Date.parse(at(6)) })).pools[0].incomplete, ["error"]);
  assert.equal((await protectNetwork(evidence, withY.deps, { registry, clock: () => Date.parse(at(7)) })).pools[0].review, "SIGNALS");

  /* A creator whose own history is too long to read: who funded it is not known — a person confirms the activation. */
  const deep = createMemoryGuardStore();
  await bind(deep);
  const deepCreator = chain({ funders: { [E1]: F1, [E2]: F2, [E3]: F3, [PARTNER]: F4 }, deep: [CREATOR], trades: three });
  const run = await protectNetwork(deep, deepCreator.deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([run.pools[0].activated, run.pools[0].signals, run.pools[0].review], [true, ["UNVERIFIED"], "OPENED"]);
  /* Once activated and cleared, a later failed read raises nothing new. */
  await actOnCase(deep, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "A long-standing trader, checked by hand.", seen: 0 }, by: "admin", now: at(4) });
  assert.equal((await protectNetwork(deep, { ...deepCreator.deps, transfers: async () => null }, { registry, clock: () => Date.parse(at(40)) })).pools[0].review, "NONE");
});

test("an appeal opens a case of its own where there is none — it holds nothing, the reviewer reads it; newer rules' records stay readable", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(1), "5000000")]);
  const { deps } = chain({ funders: independent, trades: three });
  await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(2)) });
  await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(2)) });
  const appeal = await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "APPEAL", note: "When is it paid?" }, by: "person", now: at(3) });
  assert.deepEqual([appeal.ok, appeal.view.state, appeal.view.dueAt], [true, "OPEN", at(6)]);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(20) })).pools[0].availableUsdMicros, "1000000", "a question holds no money");
  /* A record of a newer version of the rules is read, not a hole that holds everything. */
  const subject = walletSubject(PARTNER);
  await store.collection(REVIEW_EVENT_COLLECTION).set(`${subject}:000000`, { schema: 1, subject, seq: 0, kind: "FROZEN", at: at(4), by: "admin", note: "Newer build.", rulesVersion: "protect-2.0.0" });
  assert.equal(caseOf(subject, (await readSubjectEvents(store, subject)).events, at(5)).frozen?.note, "Newer build.");
  /* A freeze that stays after a decision is still due. */
  await actOnCase(store, { subject, action: { kind: "APPEAL", note: "Why frozen?" }, by: "person", now: at(5) });
  await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "CLEAR", note: "Fine.", seen: 1 }, by: "admin", now: at(6) });
  assert.equal(caseOf(subject, (await readSubjectEvents(store, subject)).events, at(10)).overdue, true, "cleared but left frozen: the queue says so");
});

test("round 4: a node that has not caught up is no independence; codes decided before are not raised again after a reopen; a crowd that grows reopens", async () => {
  /* Traders whose history the node returns empty: not counted — and nothing of them is kept. */
  const lag = createMemoryGuardStore();
  await bind(lag);
  const behind = chain({ funders: independent, trades: three });
  const lagging = { ...behind.deps, funding: async (wallet) => ([E1, E2, E3].includes(wallet) ? { state: "EMPTY", funder: null, firstAt: null, lastAt: null } : behind.deps.funding(wallet)) };
  const run = await protectNetwork(lag, lagging, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([run.pools[0].activated, run.pools[0].independent], [false, 0]);
  assert.deepEqual(await lag.collection("growthFunding").valuesWithPrefix(h(E1)), []);
  /* A partner with no history read: whose wallet funded it is unknown — activation waits for a person. */
  const empty = createMemoryGuardStore();
  await bind(empty);
  const emptyPartner = { ...behind.deps, funding: async (wallet) => (wallet === PARTNER ? { state: "EMPTY", funder: null, firstAt: null, lastAt: null } : behind.deps.funding(wallet)) };
  assert.deepEqual((await protectNetwork(empty, emptyPartner, { registry, clock: () => Date.parse(at(3)) })).pools[0].signals, ["UNVERIFIED"]);

  /* Adjusted on S1 and a device crowd; an appeal reopens; the next run raises nothing the case already held. */
  const store = createMemoryGuardStore();
  await bind(store);
  const device = signalHash(KEY, "device", "phone");
  for (const wallet of [PARTNER, E4, E5]) await recordDevice(store, { wallet, signals: [{ kind: "device", hash: device }], now: at(1) });
  const both = chain({ funders: { ...independent, [CREATOR]: F1, [PARTNER]: F1, [E1]: addr("Fund9") }, trades: three });
  assert.deepEqual((await protectNetwork(store, both.deps, { registry, clock: () => Date.parse(at(3)) })).pools[0].signals, ["S1_SHARED_FUNDING", "S4_DEVICE_CROWD"]);
  const subject = poolSubject("solana", POOL);
  await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "ADJUST", ceilingUsdMicros: "100000", note: "A family phone, one funder.", seen: 0 }, by: "admin", now: at(4) });
  await actOnCase(store, { subject, action: { kind: "APPEAL", note: "Please look again." }, by: "person", now: at(5) });
  assert.equal((await protectNetwork(store, both.deps, { registry, clock: () => Date.parse(at(6)) })).pools[0].review, "UNCHANGED");
  assert.equal((await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "ADJUST", ceilingUsdMicros: "100000", note: "The appeal changes nothing.", seen: 2 }, by: "admin", now: at(7) })).ok, true);
  /* Thirty wallets on the same phone later: new evidence of the crowd — the case opens again. */
  for (let n = 0; n < 30; n += 1) await recordDevice(store, { wallet: addr(`Crowd${String.fromCharCode(65 + (n % 26))}${n}`), signals: [{ kind: "device", hash: device }], now: at(8) });
  assert.equal((await protectNetwork(store, both.deps, { registry, clock: () => Date.parse(at(9)) })).pools[0].review, "SIGNALS");
});

test("round 5: evidence is the things, never a count — a crowd's sighting expiring or a round trip leaving the window reopens nothing; a wallet with nothing held opens no case by appealing; a stopped wallet is told so", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const device = signalHash(KEY, "device", "phone");
  await recordDevice(store, { wallet: E4, signals: [{ kind: "device", hash: device }], now: at(0) });
  for (const wallet of [PARTNER, E5, addr("Ext7")]) await recordDevice(store, { wallet, signals: [{ kind: "device", hash: device }], now: at(80) });
  /* The creator's own two round trips on the pool (S6). */
  const trips = [trade(CREATOR, at(1), 5_000_000n), trade(CREATOR, at(1, 1), 4_950_000n, "sell"), trade(CREATOR, at(2), 5_000_000n), trade(CREATOR, at(2, 1), 4_950_000n, "sell")];
  const { deps } = chain({ funders: independent, trades: [...three, ...trips] });
  const first = await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(81)) });
  assert.deepEqual([first.pools[0].signals, first.pools[0].review], [["S4_DEVICE_CROWD", "S6_ROUND_TRIP"], "OPENED"]);
  const seen = (await events(store)).at(-1).seq;
  await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "A family phone.", seen }, by: "admin", now: at(82) });
  /* Day 91: the first sighting expires, the crowd shrinks from 4 to 3 — still a crowd, nothing new in it. */
  const later = await protectNetwork(store, deps, { registry, clock: () => Date.parse(at(91)) });
  assert.deepEqual([later.pools[0].signals.includes("S4_DEVICE_CROWD"), later.pools[0].review], [true, "UNCHANGED"]);
  /* The round trip leaves the curve's window read: no new evidence either. */
  const narrower = chain({ funders: independent, trades: [...three, ...trips.slice(2)] });
  const narrow = await protectNetwork(store, narrower.deps, { registry, clock: () => Date.parse(at(92)) });
  assert.deepEqual([narrow.pools[0].signals.includes("S6_ROUND_TRIP"), narrow.pools[0].review], [true, "UNCHANGED"]);

  /* A wallet with nothing held: an appeal opens nothing. */
  assert.deepEqual(await actOnCase(store, { subject: walletSubject(E5), action: { kind: "APPEAL", note: "Hello." }, by: "person", now: at(93) }), { ok: false, code: "NO_CASE" });
  /* A wallet whose payouts a decision stopped: told so, not promised an answer. */
  const subject = walletSubject(PARTNER);
  await actOnCase(store, { subject, action: { kind: "FREEZE", note: "Look." }, by: "admin", now: at(94) });
  await actOnCase(store, { subject, action: { kind: "APPEAL", note: "Why?" }, by: "person", now: at(94, 1) });
  await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "CANCEL", note: "A farm.", seen: 1 }, by: "admin", now: at(95) });
  assert.equal(await walletHold(store, PARTNER, at(96)), "REVIEW", "still frozen");
  await actOnCase(store, { subject, action: { kind: "UNFREEZE", note: "The decision stands." }, by: "admin", now: at(96) });
  assert.equal(await walletHold(store, PARTNER, at(97)), "STOPPED");
});

test("round 6: strangers' sandwiches and a shared network reopen nothing until a new step; new evidence on an open case stales the decision; a trader the creator paid is the creator's", async () => {
  /* Others' round trips: decided once; one more stranger's trip within the same step reopens nothing. */
  const store = createMemoryGuardStore();
  await bind(store);
  const bots = (n) => Array.from({ length: n }, (_, index) => [trade(addr(`Bot${index + 1}`), at(1, index), 5_000_000n), trade(addr(`Bot${index + 1}`), at(1, index + 0.5), 4_950_000n, "sell")]).flat();
  const funders = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [addr(`Bot${index + 1}`), addr(`BotFund${index + 1}`)]));
  const run = (n, day) => protectNetwork(store, chain({ funders: { ...independent, ...funders, [CREATOR]: F1, [PARTNER]: F1, [E1]: addr("Fund9") }, trades: [...three, ...bots(n)] }).deps, { registry, clock: () => Date.parse(at(day)) });
  assert.equal((await run(3, 3)).pools[0].review, "OPENED");
  await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "Bots on the curve, not theirs.", seen: 0 }, by: "admin", now: at(4) });
  assert.equal((await run(4, 5)).pools[0].review, "UNCHANGED", "a fourth stranger's sandwich is no new step");
  assert.equal((await run(10, 6)).pools[0].review, "SIGNALS", "ten is the next step");

  /* New evidence on a case still open: raised at once, so a decision on the old page is refused. */
  const open = createMemoryGuardStore();
  await bind(open);
  const [X, Y] = [addr("DepositX"), addr("DepositY")];
  const withX = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [{ counterparty: X, direction: "out", at: at(2) }], [PARTNER]: [{ counterparty: X, direction: "out", at: at(2) }] } });
  await protectNetwork(open, withX.deps, { registry, clock: () => Date.parse(at(3)) });
  const both = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [{ counterparty: X, direction: "out", at: at(2) }, { counterparty: Y, direction: "out", at: at(3) }], [PARTNER]: [{ counterparty: X, direction: "out", at: at(2) }, { counterparty: Y, direction: "out", at: at(3) }] } });
  assert.equal((await protectNetwork(open, both.deps, { registry, clock: () => Date.parse(at(4)) })).pools[0].review, "SIGNALS");
  assert.deepEqual(await actOnCase(open, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "Seen X only.", seen: 0 }, by: "admin", now: at(5) }), { ok: false, code: "STALE" });
  assert.equal((await protectNetwork(open, both.deps, { registry, clock: () => Date.parse(at(6)) })).pools[0].review, "UNCHANGED", "raised once, not every run");

  /* The creator pays three fresh wallets after they were first funded elsewhere: they are the creator's. */
  const paid = createMemoryGuardStore();
  await bind(paid);
  const creatorPays = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [E1, E2, E3].map((wallet) => ({ counterparty: wallet, direction: "out", at: at(0) })) } });
  const result = await protectNetwork(paid, creatorPays.deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([result.pools[0].activated, result.pools[0].independent], [false, 0]);

  /* A device seen again keeps its sighting from the last time. */
  const devices = createMemoryGuardStore();
  const phone = signalHash(KEY, "device", "phone");
  await recordDevice(devices, { wallet: PARTNER, signals: [{ kind: "device", hash: phone }], now: at(0) });
  await recordDevice(devices, { wallet: PARTNER, signals: [{ kind: "device", hash: phone }], now: at(80) });
  const [row] = await devices.collection("growthDevices").valuesWithPrefix(`w:${PARTNER}:`);
  assert.equal(row.expiresAt, at(80 + PROTECT_RULES.retentionDays));
});

test("round 7: each new young buyer is no new evidence; a stranger's dust to the creator makes nobody theirs; a decision taken before a run could raise new evidence never covers it", async () => {
  /* Young buyers keep coming after S1 was cleared: nothing reopens until the count passes a step. */
  const store = createMemoryGuardStore();
  await bind(store);
  const youngs = Array.from({ length: 6 }, (_, index) => addr(`Young${index + 1}`));
  const funders = { ...independent, [CREATOR]: F1, [PARTNER]: F1, [E1]: addr("Fund9"), ...Object.fromEntries(youngs.map((wallet, index) => [wallet, addr(`YFund${index + 1}`)])) };
  const run = (n, day) => protectNetwork(store, chain({ funders, trades: [...three, ...youngs.slice(0, n).map((wallet, index) => trade(wallet, at(1, index)))], young: youngs }).deps, { registry, clock: () => Date.parse(at(day)) });
  assert.equal((await run(4, 3)).pools[0].review, "OPENED");
  await actOnCase(store, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "Fresh buyers of a fresh token.", seen: (await events(store)).at(-1).seq }, by: "admin", now: at(4) });
  for (const [n, day] of [[5, 5], [6, 6]]) assert.equal((await run(n, day)).pools[0].review, "UNCHANGED", `${n} young buyers`);

  /* A stranger sends the creator a little, then trades: still external, and their trades are nobody's evidence. */
  const dust = createMemoryGuardStore();
  await bind(dust);
  const stranger = addr("Stranger");
  const dusted = chain({ funders: { ...independent, [stranger]: addr("SFund") }, trades: [...three, trade(stranger, at(1)), trade(stranger, at(1, 1), 4_950_000n, "sell")], transfers: { [CREATOR]: [{ counterparty: stranger, direction: "in", at: at(0) }] } });
  const result = await protectNetwork(dust, dusted.deps, { registry, clock: () => Date.parse(at(3)) });
  assert.deepEqual([result.pools[0].activated, result.pools[0].signals.includes("S6_ROUND_TRIP")], [true, false]);

  /* Evidence kept, its raise lost; the reviewer decides on what they see; the next run still raises it. */
  const race = createMemoryGuardStore();
  await bind(race);
  const [X, Y] = [addr("DepositX"), addr("DepositY")];
  const withX = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [{ counterparty: X, direction: "out", at: at(2) }], [PARTNER]: [{ counterparty: X, direction: "out", at: at(2) }] } });
  await protectNetwork(race, withX.deps, { registry, clock: () => Date.parse(at(3)) });
  const withY = chain({ funders: independent, trades: three, transfers: { [CREATOR]: [{ counterparty: X, direction: "out", at: at(2) }, { counterparty: Y, direction: "out", at: at(4) }], [PARTNER]: [{ counterparty: X, direction: "out", at: at(2) }, { counterparty: Y, direction: "out", at: at(4) }] } });
  let failOnce = true;
  const flaky = {
    ...race,
    collection(name) {
      const real = race.collection(name);
      if (name !== REVIEW_EVENT_COLLECTION) return real;
      return { ...real, insertIfAbsent: async (key, value) => { if (failOnce) { failOnce = false; throw new Error("store down"); } return real.insertIfAbsent(key, value); } };
    },
    versioned: (name) => race.versioned(name),
  };
  await protectNetwork(flaky, withY.deps, { registry, clock: () => Date.parse(at(5)) });
  assert.equal((await actOnCase(race, { subject: poolSubject("solana", POOL), action: { kind: "DECIDE", decision: "CLEAR", note: "Saw X only.", seen: 0 }, by: "admin", now: at(5, 1) })).ok, true);
  assert.equal((await protectNetwork(race, withY.deps, { registry, clock: () => Date.parse(at(6)) })).pools[0].review, "SIGNALS");
});

test("round 8: the reviewer decides a freeze without waiting for an appeal — a farm found by hand is stopped", async () => {
  const store = createMemoryGuardStore();
  const subject = walletSubject(PARTNER);
  await actOnCase(store, { subject, action: { kind: "FREEZE", note: "Eleven wallets, one phone." }, by: "admin", now: at(1) });
  assert.equal((await actOnCase(store, { subject, action: { kind: "DECIDE", decision: "CANCEL", note: "A farm.", seen: 0 }, by: "admin", now: at(2) })).ok, true);
  await actOnCase(store, { subject, action: { kind: "UNFREEZE", note: "The decision stands." }, by: "admin", now: at(3) });
  assert.equal(await walletHold(store, PARTNER, at(4)), "STOPPED");
  assert.equal(caseOf(subject, (await readSubjectEvents(store, subject)).events, at(10)).overdue, false, "answered, nothing is due");
});
