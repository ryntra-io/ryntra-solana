import assert from "node:assert/strict";
import test from "node:test";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { NETWORK_RULES_V1, networkDay, networkShareBps, validateNetworkRules } from "../rewards/network-rules.ts";
import { rankStanding, rankSummary, RankEventSchema } from "../rewards/rank.ts";
import { listRankEvents, readRankStanding } from "../rewards/rank-store.ts";
import { ranksReached } from "./achievements.ts";
import { computePoolLines, decodeDbcPoolCounters, entryStates, NETWORK_ENTRY_COLLECTION, NetworkEntrySchema } from "./network.ts";
import { accrueNetwork, approveFoundingPartner, checkNetworkLedger, readFoundingSeats, readNetworkLedger, readPartnerNetwork } from "./network-store.ts";
import { PARTNER_RULES_VERSION } from "./partner.ts";
import { appendPoolShareRows, recordStream1 } from "./pool-share-store.ts";

const registry = ATTRIBUTION_REGISTRY;
const SAFE = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const PROTECTED = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
const MICRO = "3xh95YxdDBDiR35mWJo4E3hVoXNDqW4hdXemuWwsBD8w";
const DEMO = "GVDLyxgHraJcbmzds6i6hMgb3jSUUhSaHq5XVFnq6AS5";
const EXECUTOR = "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU";
const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const POOL_2 = "AFoxY8SRfJ2SmCYNRWgXsMN27PpJyy2iUk2zGYsrXc7K";
const DEMO_POOL = "9qyVyLMRoCwGxDRscUJ6Ae8QV1vUKoQRy8NZch3XvRaX";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CREATOR = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const PARTNER = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TRADER = "TraderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const INVITER = "InviterBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const TX = "5".repeat(88);
const DAY = 86_400_000;
const T0 = "2026-10-20T00:00:00.000Z";
const at = (days, hours = 0) => new Date(Date.parse(T0) + days * DAY + hours * 3_600_000).toISOString();

const clean = { profileOf: async () => null, team: async () => new Set() };
const team = (...wallets) => ({ profileOf: async () => null, team: async () => new Set(wallets) });

const binding = (over = {}) => ({
  schema: 1, network: "solana", factory: PROTECTED, pool: POOL, creator: CREATOR, creationTx: TX, launchedAt: at(-1), partner: PARTNER, partnerCode: "BCDFGHJKLMNP",
  source: "inviter", decided: true, rulesVersion: PARTNER_RULES_VERSION, checks: { status: "measured", reasons: [], at: at(-1) }, recordedAt: at(-1), version: 1, ...over,
});
/* The creator counts from before the pool earns — protection (GR-07) is tested on its own; here the money follows as soon as its hold allows. */
async function activate(store, row, when = at(-1)) {
  await store.versioned("growthActivations").compareAndSet(`pool:${row.network}:${row.pool}`, null, {
    version: 1, network: row.network, pool: row.pool, creator: row.creator, activatedAt: when, recordedAt: when, rulesVersion: "protect-1.0.0",
    last: { at: when, independent: 3, external: 3, unknown: 0, volumeUsdMicros: "3000000", teamVolumeUsdMicros: "0", insiderVolumeUsdMicros: "0", roundTripVolumeUsdMicros: "0", unvaluedTrades: 0, tradesComplete: true, partiesComplete: true, sharedSources: [] },
  });
}
async function bind(store, over = {}, { activated = true } = {}) {
  const row = binding(over);
  await store.collection("growthPoolPartners").set(`pool:${row.network}:${row.pool}`, row);
  if (activated && row.partner) await activate(store, row);
  return row;
}

let serial = 0;
const claim = (when, usd, over = {}) => ({
  kind: "CLAIM", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, venuePool: null, config: PROTECTED, creator: CREATOR, source: "curve", claimer: SAFE,
  claim: { tx: `claim${++serial}`, index: "1.0", block: serial, at: when, finality: "finalized" },
  asset: { mint: USDC, symbol: "USDC", decimals: 6 }, claimedRaw: usd, receivedRaw: usd, tokenRaw: "0", rule: "ALL", usdMicros: usd,
  valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null }, allocation: null, recordedAt: when, ...over,
});
const stream1 = (when, usd, venue = "curve", over = {}) => ({
  kind: "STREAM1", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, config: PROTECTED, venue, operationRef: `trade${++serial}`, trader: TRADER, entries: 2,
  usdMicros: usd, settledAt: when, recordedAt: when, ...over,
});
async function journal(store, rows) {
  const written = await appendPoolShareRows(store, rows);
  assert.equal(written.refused.length, 0, JSON.stringify(written.refused));
}
async function entries(store) {
  return (await store.collection(NETWORK_ENTRY_COLLECTION).valuesWithPrefix("")).map((row) => NetworkEntrySchema.parse(row));
}
const sum = (rows, field = "usdMicros") => rows.reduce((total, row) => total + BigInt(row[field]), 0n);

/* --------------------------------------------------------------------------------------------- rules */

test("policy 1.0: Standard 20 % for 180 days from the first received fee, then 10 %; Founding 30 · 15 · 10 %; cap 40 %", () => {
  assert.equal(NETWORK_RULES_V1.version, PARTNER_RULES_VERSION, "a binding and an entry carry the same version");
  assert.equal(NETWORK_RULES_V1.poolCapBps, 4000);
  assert.equal(NETWORK_RULES_V1.foundingSeats, 20);
  assert.equal(NETWORK_RULES_V1.holdDays, 14);
  const share = (tier, day) => networkShareBps(NETWORK_RULES_V1, tier, day);
  assert.deepEqual([1, 180, 181, 2000].map((day) => share("STANDARD", day)), [2000, 2000, 1000, 1000]);
  assert.deepEqual([1, 90, 91, 365, 366].map((day) => share("FOUNDING", day)), [3000, 3000, 1500, 1500, 1000]);
  assert.equal(networkDay(T0, T0), 1);
  assert.equal(networkDay(T0, at(0, 23)), 1);
  assert.equal(networkDay(T0, at(179, 23)), 180);
  assert.equal(networkDay(T0, at(180)), 181);
  assert.throws(() => validateNetworkRules({ ...NETWORK_RULES_V1, version: "network-9.0.0", schedules: { ...NETWORK_RULES_V1.schedules, STANDARD: [{ untilDay: null, bps: 5000 }] } }), /above the pool cap/);
  assert.throws(() => validateNetworkRules({ ...NETWORK_RULES_V1, version: "network-9.0.0", schedules: { ...NETWORK_RULES_V1.schedules, FOUNDING: [{ untilDay: 90, bps: 3000 }] } }), /end open/);
});

/* ------------------------------------------------------------------------------------------------ R1 */

const coreEntry = (type, recipient, usdMicros, sig, settledAt) => ({
  version: 0, type, recipient, rateBps: type === "CASHBACK" ? 5_000 : 1_000, shareRaw: "10", usdMicros,
  valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null },
  source: { mechanism: "METEORA_LAUNCH", operationRef: sig, trader: TRADER, grossRaw: "20", asset: USDC, symbol: "USDC", decimals: 6, settledAt },
  createdAt: settledAt, claimId: null, signature: null,
});

test("R1 on a pool with cashback: the base is the claim less stream 1 of the curve's trades; the graduated pool's referral and a position's fees are not netted", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  /* The rewards core's own rows of one curve trade: cashback $1.00 and the friend's $0.20, before the claim. */
  const sig = "launchTradeSig1";
  await store.versioned("rewardAccruals").compareAndSet(`METEORA_LAUNCH:${sig}`, null, { version: 0, trader: TRADER, entries: [coreEntry("CASHBACK", TRADER, "1000000", sig, at(0, 1)), coreEntry("REFERRAL_L1", INVITER, "200000", sig, at(0, 1))] });
  await store.collection("launchTradeRecords").set(`mainnet:${sig}`, { cluster: "mainnet", signature: sig, wallet: TRADER, venue: "curve", curve: POOL, config: PROTECTED, state: "DONE", settledAt: at(0, 1) });
  assert.equal((await recordStream1(store, { registry })).created, 1);
  await journal(store, [
    stream1(at(0, 2), "300000", "pool"),
    claim(at(0, 3), "10000000"),
    claim(at(0, 4), "2000000", { source: "lp", venuePool: POOL_2 }),
  ]);
  const run = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.equal(run.pools[0].state, "WRITTEN");
  const rows = await entries(store);
  assert.deepEqual(rows.map((row) => [row.line.source, row.baseUsdMicros, row.usdMicros, row.rateBps]).sort(), [
    ["curve", "8800000", "1760000", 2000],
    ["lp", "2000000", "400000", 2000],
  ]);
  /* One dollar, one payout: what the trades got back plus what the partner gets never exceeds what Ryntra received. */
  assert.ok(1_200_000n + 300_000n + sum(rows) <= 12_000_000n);
  assert.equal((await readRankStanding(store, PARTNER, at(14))).fromPartners, 0n, "a base still in its hold lifts no rank");
  /* A base is written once its hold has passed — by the first run after it. */
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(16)) });
  const standing = await readRankStanding(store, PARTNER, at(16));
  assert.equal(standing.fromPartners, 10n, "one point per whole dollar of base, $10.80, once its hold has passed");
  assert.equal(rankSummary(standing).fromFriends, "10", "read with the friends on the page until it has its own line");
});

/* -------------------------------------------------------------------------------------------- repeat */

test("a repeated run writes nothing; a run that crashed between an entry and its points is finished by the next", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000"), claim(at(3), "1000000")]);
  const first = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(4)) });
  assert.equal(first.pools[0].written, 2);
  assert.deepEqual([first.points.recorded, first.points.held], [0, 2], "a point is written once its hold has passed, never ahead");
  const matured = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(18)) });
  assert.equal(matured.points.recorded, 2);
  const second = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(19)) });
  assert.equal(second.pools[0].state, "UNCHANGED");
  assert.equal(second.pools[0].written, 0);
  assert.deepEqual(second.points, { recorded: 0, existing: 2, skipped: 0, held: 0 });
  assert.equal((await entries(store)).length, 2);
  /* The crash: one entry stands without its point. */
  const events = await listRankEvents(store, PARTNER);
  await store.collection("rankEvents").delete(`${PARTNER}:PARTNER_POOL:${events[0].ref}`);
  const mended = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(20)) });
  assert.equal(mended.points.recorded, 1);
  assert.equal((await listRankEvents(store, PARTNER)).length, 2);
  assert.equal((await checkNetworkLedger(store, { registry })).ok, true);
});

test("partner points lift the rank — and with it a friend's share — only once their hold has passed; a base reversed within the hold never lifts it", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await bind(store, { pool: POOL_2, creator: OTHER });
  await journal(store, [claim(T0, "150000000"), claim(T0, "150000000", { pool: POOL_2, creator: OTHER })]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  /* The second pool turns out to be the partner's own on day 5, inside the hold. */
  await accrueNetwork(store, { profileOf: async (_family, wallet) => (wallet === OTHER || wallet === PARTNER ? "profile-1" : null), team: async () => new Set() }, { registry, clock: () => Date.parse(at(5)) });
  const rank = async (when) => {
    const standing = await readRankStanding(store, PARTNER, when);
    return [standing.fromPartners, standing.rank, standing.referralL1Bps];
  };
  assert.deepEqual(await rank(at(10)), [0n, "BRONZE", 1000]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(16)) });
  /* This store never started the rules, so the rank is read by the ladder of the rules in force for it — 1.0.0's. */
  assert.deepEqual(await rank(at(16)), [150n, "SILVER", 1500]);
});

/* ------------------------------------------------------------------------------------------- versions */

const V2 = { ...NETWORK_RULES_V1, version: "network-2.0.0", effectiveFrom: at(10), schedules: { ...NETWORK_RULES_V1.schedules, STANDARD: [{ untilDay: 180, bps: 2500 }, { untilDay: null, bps: 1000 }] } };

test("a new version computes only what arrives after it; an earned line keeps the version it was earned under", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "1000000"), claim(at(12), "1000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(13)), history: [NETWORK_RULES_V1, validateNetworkRules(V2)] });
  const rows = (await entries(store)).sort((a, b) => a.line.at.localeCompare(b.line.at));
  assert.deepEqual(rows.map((row) => [row.rulesVersion, row.usdMicros]), [["network-1.0.0", "200000"], ["network-2.0.0", "250000"]]);
  /* A version dated back over an earned line changes nothing already earned. */
  const back = { ...V2, version: "network-3.0.0", effectiveFrom: at(-30), schedules: { ...V2.schedules, STANDARD: [{ untilDay: null, bps: 500 }] } };
  const rerun = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(14)), history: [NETWORK_RULES_V1, V2, validateNetworkRules(back)] });
  assert.equal(rerun.pools[0].state, "UNCHANGED");
  assert.equal((await entries(store)).length, 2);
});

/* -------------------------------------------------------------------------------------- self-referral */

test("self-referral: a binding with a reason earns nothing and counts no point", async () => {
  const store = createMemoryGuardStore();
  await bind(store, { checks: { status: "measured", reasons: ["SAME_WALLET"], at: at(-1) } });
  await journal(store, [claim(T0, "5000000")]);
  const run = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.equal(run.pools[0].state, "BLOCKED");
  assert.deepEqual(await entries(store), []);
  assert.equal((await readRankStanding(store, PARTNER, at(2))).fromPartners, 0n);
  const view = await readPartnerNetwork(store, PARTNER, { now: at(2) });
  assert.deepEqual([view.pools[0].status, view.pools[0].reasons, view.pools[0].firstReceivedAt, view.pools[0].day], ["REVIEW", [], null, null]);
  const ledger = (await readNetworkLedger(store, { now: at(2) })).partners[0].pools[0];
  assert.deepEqual([ledger.status, ledger.reasons], ["BLOCKED", ["SAME_WALLET"]]);
});

test("the team: a creator of the team earns its partner nothing, and the partner is never told it was the team", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000")]);
  const run = await accrueNetwork(store, team(CREATOR), { registry, clock: () => Date.parse(at(1)) });
  assert.equal(run.pools[0].state, "BLOCKED");
  assert.deepEqual(run.pools[0].reasons, ["TEAM"]);
  assert.deepEqual(await entries(store), []);
  /* The partner's own read: not earning while it is looked at — the same state as a check not run yet. */
  const own = (await readPartnerNetwork(store, PARTNER, { now: at(2) })).pools[0];
  assert.deepEqual([own.status, own.reasons, own.shareBps, own.shareUntil, own.inPoolUsdMicros], ["REVIEW", [], 0, null, null]);
  const pending = createMemoryGuardStore();
  await bind(pending, { checks: { status: "unavailable", reasons: [], at: at(-1) } });
  const unchecked = (await readPartnerNetwork(pending, PARTNER, { now: at(2) })).pools[0];
  assert.deepEqual([unchecked.status, unchecked.reasons, unchecked.shareBps, unchecked.shareUntil, unchecked.inPoolUsdMicros], [own.status, own.reasons, own.shareBps, own.shareUntil, own.inPoolUsdMicros]);
  const ledger = (await readNetworkLedger(store, { now: at(2) })).partners[0].pools[0];
  assert.deepEqual([ledger.status, ledger.reasons], ["BLOCKED", ["TEAM"]]);
});

test("a pool that turns out to be the team's reads exactly like one found to be the partner's own: under review, nothing earned, no day", async () => {
  const shown = async (deps) => {
    const store = createMemoryGuardStore();
    await bind(store);
    await journal(store, [claim(T0, "5000000")]);
    await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
    assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(2) })).pools[0].status, "EARNING");
    await accrueNetwork(store, deps, { registry, clock: () => Date.parse(at(3)) });
    const { status, reasons, firstReceivedAt, day, shareBps, shareUntil, inPoolUsdMicros, baseUsdMicros, earnedUsdMicros, pendingUsdMicros, availableUsdMicros } = (await readPartnerNetwork(store, PARTNER, { now: at(4) })).pools[0];
    return { status, reasons, firstReceivedAt, day, shareBps, shareUntil, inPoolUsdMicros, baseUsdMicros, earnedUsdMicros, pendingUsdMicros, availableUsdMicros };
  };
  const teamLater = await shown(team(CREATOR));
  const ownLater = await shown({ profileOf: async () => "profile-1", team: async () => new Set() });
  assert.equal(teamLater.status, "REVIEW");
  assert.deepEqual(teamLater, ownLater);
});

test("a reason found after the launch reverses what was earned with negative entries; it stays found when the lookup fails later", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.equal(sum(await entries(store)), 1_000_000n);
  const oneProfile = { profileOf: async () => "profile-1", team: async () => new Set() };
  const run = await accrueNetwork(store, oneProfile, { registry, clock: () => Date.parse(at(2)) });
  assert.equal(run.pools[0].state, "BLOCKED");
  assert.deepEqual(run.pools[0].reasons, ["SAME_PROFILE"]);
  const rows = await entries(store);
  const reversal = rows.find((row) => row.seq === 1);
  assert.equal(reversal.kind, "REVERSAL");
  assert.equal(reversal.reason, "SELF_REFERRAL");
  assert.equal(reversal.usdMicros, "-1000000");
  assert.equal(reversal.baseUsdMicros, "-5000000");
  assert.equal(sum(rows), 0n);
  assert.equal((await readRankStanding(store, PARTNER, at(3))).fromPartners, 0n);
  const down = { profileOf: async () => undefined, team: async () => null };
  const later = await accrueNetwork(store, down, { registry, clock: () => Date.parse(at(3)) });
  assert.equal(later.pools[0].state, "BLOCKED", "a found reason needs no lookup to stay");
  assert.equal((await entries(store)).length, 2);
});

test("a check that cannot run earns nothing yet — the next run tries again", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000")]);
  const down = { profileOf: async () => undefined, team: async () => new Set() };
  assert.equal((await accrueNetwork(store, down, { registry, clock: () => Date.parse(at(1)) })).pools[0].state, "UNAVAILABLE");
  assert.deepEqual(await entries(store), []);
  assert.equal((await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(2)) })).pools[0].state, "WRITTEN");
});

/* ----------------------------------------------------------------------------------------------- cap */

test("the cap: everything paid out of one pool stays within 40 % of its base, checked on the pool's running sums", () => {
  const greedy = { ...NETWORK_RULES_V1, version: "network-9.0.0", schedules: { ...NETWORK_RULES_V1.schedules, STANDARD: [{ untilDay: null, bps: 5000 }] } };
  const computed = computePoolLines({ binding: binding(), claims: [claim(T0, "1000000"), claim(at(1), "3000000")], stream1: [], seat: null, eligible: true, configs: null, history: [greedy] });
  assert.equal(computed.state, "OK");
  assert.deepEqual(computed.lines.map((line) => [line.usdMicros.toString(), line.capped]), [["400000", true], ["1200000", true]]);
  const paid = computed.lines.reduce((total, line) => total + line.usdMicros, 0n);
  const base = computed.lines.reduce((total, line) => total + line.baseUsdMicros, 0n);
  assert.ok(paid * 10_000n <= base * 4000n);
});

/* --------------------------------------------------------------------------------------------- reversal */

test("сторно: stream 1 written late for a trade before an earned claim lowers the line by a negative entry; pending and available follow", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(at(0, 3), "10000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.equal(sum(await entries(store)), 2_000_000n);
  await journal(store, [stream1(at(0, 1), "1000000")]);
  const run = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(3)) });
  assert.equal(run.pools[0].state, "WRITTEN");
  const rows = await entries(store);
  const reversal = rows.find((row) => row.seq === 1);
  assert.equal(reversal.kind, "REVERSAL");
  assert.equal(reversal.reason, "RECOMPUTED");
  assert.equal(reversal.usdMicros, "-200000");
  assert.equal(reversal.baseUsdMicros, "-1000000");
  assert.equal(sum(rows), 1_800_000n);
  /* The hold runs from the entry; the reversal takes from the oldest part first. */
  const states = (now) => entryStates(rows, now);
  assert.deepEqual([states(at(14)).pendingUsdMicros, states(at(14)).availableUsdMicros], [1_800_000n, 0n]);
  assert.equal(states(at(14)).nextAvailableAt, at(15));
  assert.deepEqual([states(at(15)).pendingUsdMicros, states(at(15)).availableUsdMicros, states(at(15)).earnedUsdMicros], [0n, 1_800_000n, 1_800_000n]);
  assert.equal((await checkNetworkLedger(store, { registry })).ok, true);
});

/* ---------------------------------------------------------------------------------------------- Founding */

test("Founding by days: 30 % on days 1–90, 15 % on 91–365, then 10 % — from the approval on, never before it", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const approved = await approveFoundingPartner(store, clean, { wallet: PARTNER, approvedBy: "review", clock: () => Date.parse(at(0, 12)) });
  assert.deepEqual(approved.ok && [approved.seat.seat, approved.created], [1, true]);
  await journal(store, [claim(T0, "1000000"), claim(at(1), "1000000"), claim(at(89), "1000000"), claim(at(90), "1000000"), claim(at(364), "1000000"), claim(at(365), "1000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(400)) });
  const rows = (await entries(store)).sort((a, b) => a.line.at.localeCompare(b.line.at));
  assert.deepEqual(rows.map((row) => [row.day, row.tier, row.rateBps, row.usdMicros]), [
    [1, "STANDARD", 2000, "200000"],
    [2, "FOUNDING", 3000, "300000"],
    [90, "FOUNDING", 3000, "300000"],
    [91, "FOUNDING", 1500, "150000"],
    [365, "FOUNDING", 1500, "150000"],
    [366, "FOUNDING", 1000, "100000"],
  ]);
  const view = await readPartnerNetwork(store, PARTNER, { now: at(400) });
  assert.deepEqual([view.founding?.seat, view.pools[0].tier, view.pools[0].shareBps, view.pools[0].shareUntil], [1, "FOUNDING", 1000, null]);
});

test("Founding seats: the first 20 approved, one each, never the team; approving again returns the same seat", async () => {
  const store = createMemoryGuardStore();
  const wallet = (n) => `${"Fa".repeat(10)}${"123456789ABCDEFGHJKLMNPQRSTUVWXYZ"[n]}${"b".repeat(21)}`;
  assert.deepEqual(await approveFoundingPartner(store, team(OTHER), { wallet: OTHER, approvedBy: "review", clock: () => Date.parse(T0) }), { ok: false, code: "TEAM" });
  assert.deepEqual(await approveFoundingPartner(store, { team: async () => null }, { wallet: OTHER, approvedBy: "review", clock: () => Date.parse(T0) }), { ok: false, code: "UNAVAILABLE" });
  /* A wallet once linked to a wallet of the team is the team's too. */
  const EVM = `0x${"1".repeat(40)}`;
  await store.collection("growthWalletLinks").set(`history:${CREATOR}:${T0}:${EVM}`, { schema: 1, solana: CREATOR, evm: EVM, linkedAt: T0, signedAt: T0, version: 1 });
  assert.deepEqual(await approveFoundingPartner(store, team(EVM), { wallet: CREATOR, approvedBy: "review", clock: () => Date.parse(T0) }), { ok: false, code: "TEAM" });
  for (let n = 1; n <= 19; n += 1) assert.equal((await approveFoundingPartner(store, clean, { wallet: wallet(n), approvedBy: "review", clock: () => Date.parse(at(n)) })).ok, true, `seat ${n}`);
  /* Two approvals at once for the last seat: one wins it, the other finds the seats full. */
  const race = await Promise.all([20, 21].map((n) => approveFoundingPartner(store, clean, { wallet: wallet(n), approvedBy: "review", clock: () => Date.parse(at(n)) })));
  assert.deepEqual(race.map((outcome) => outcome.ok).sort(), [false, true]);
  assert.deepEqual(race.find((outcome) => !outcome.ok), { ok: false, code: "FULL" });
  assert.deepEqual(await approveFoundingPartner(store, clean, { wallet: OTHER, approvedBy: "review", clock: () => Date.parse(at(30)) }), { ok: false, code: "FULL" });
  const again = await approveFoundingPartner(store, clean, { wallet: wallet(7), approvedBy: "review", clock: () => Date.parse(at(31)) });
  assert.deepEqual(again.ok && [again.seat.seat, again.created, again.seat.approvedAt], [7, false, at(7)]);
  assert.equal((await readFoundingSeats(store)).seats.length, 20);
  /* A record that exists and cannot be read is never "no seats". */
  const broken = createMemoryGuardStore();
  await broken.versioned("growthFoundingPartners").compareAndSet("seats", null, { version: 1, seats: [{ seat: 1 }] });
  await assert.rejects(readFoundingSeats(broken));
});

/* -------------------------------------------------------------------------------------- reconciliation */

test("reconciliation: what was earned is the share of the base, line by line, and within the cap on every pool", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await bind(store, { pool: POOL_2, creator: OTHER });
  await journal(store, [
    stream1(at(0, 1), "333333"),
    claim(at(0, 2), "1234567"),
    claim(at(2), "7654321", { source: "migration" }),
    claim(at(181), "999999"),
    claim(at(1), "4444444", { pool: POOL_2, creator: OTHER }),
  ]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(200)) });
  const check = await checkNetworkLedger(store, { registry });
  assert.equal(check.ok, true);
  for (const pool of check.pools) {
    assert.equal(pool.writtenUsdMicros, pool.expectedUsdMicros);
    assert.equal(pool.writtenBaseUsdMicros, pool.expectedBaseUsdMicros);
    assert.ok(pool.withinCap);
  }
  const first = check.pools.find((pool) => pool.pool === POOL);
  /* (1 234 567 − 333 333) × 20 % + 7 654 321 × 20 % + 999 999 × 10 %, each floored. */
  assert.equal(first.writtenUsdMicros, (180246n + 1530864n + 99999n).toString());
  assert.equal(first.writtenBaseUsdMicros, (901234n + 7654321n + 999999n).toString());
  /* A drifted ledger is caught: an entry written by hand. */
  await store.collection(NETWORK_ENTRY_COLLECTION).insertIfAbsent("forged", { ...(await entries(store))[0], seq: 9, kind: "CORRECTION", reason: "RECOMPUTED", usdMicros: "1", baseUsdMicros: "0" });
  assert.equal((await checkNetworkLedger(store, { registry })).ok, false);
});

/* ---------------------------------------------------------------------------- Micro, demo, Community */

test("Micro gives Ryntra's three quarters only; the demo market and an uncounted config give nothing; an unvalued claim earns nothing", async () => {
  const store = createMemoryGuardStore();
  await bind(store, { factory: MICRO });
  await bind(store, { pool: POOL_2, factory: DEMO, creator: OTHER });
  await journal(store, [
    claim(T0, "100", { config: MICRO, claimer: EXECUTOR, claimedRaw: "100", receivedRaw: "75", usdMicros: "75", rule: "MICRO_REVENUE" }),
    claim(at(1), "1000000", { pool: POOL_2, config: DEMO, claimer: EXECUTOR, creator: OTHER }),
    claim(at(2), "500", { config: MICRO, claimer: EXECUTOR, usdMicros: null, valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null }, rule: "MICRO_REVENUE" }),
  ]);
  const run = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(3)) });
  const micro = run.pools.find((pool) => pool.pool === POOL);
  const demo = run.pools.find((pool) => pool.pool === POOL_2);
  assert.deepEqual([micro.state, micro.unvalued], ["WRITTEN", 1]);
  assert.deepEqual([demo.state, demo.written, demo.excluded], ["UNCHANGED", 0, 1]);
  const rows = await entries(store);
  assert.deepEqual(rows.map((row) => [row.pool, row.baseUsdMicros, row.usdMicros]), [[POOL, "75", "15"]]);
});

test("the Community pair: valued at the claim's moment it is a base; without a price it is no data and earns nothing — and still starts the pool's days", () => {
  const unvalued = { usdMicros: null, valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null }, asset: { mint: "CommunityToken1111111111111111111111111111", symbol: "CMT", decimals: 9 } };
  const priced = { usdMicros: "2000000", valuation: { basis: "PRICED_AT_SETTLEMENT", price: "0.5", sourceRef: "catalog", observedAt: at(200) }, asset: unvalued.asset };
  const computed = computePoolLines({ binding: binding(), claims: [claim(T0, "4000000000", unvalued), claim(at(200), "4000000000", priced)], stream1: [], seat: null, eligible: true, configs: null });
  assert.equal(computed.state, "OK");
  assert.equal(computed.firstReceivedAt, T0);
  assert.equal(computed.unvalued.length, 1);
  assert.deepEqual(computed.lines.map((line) => [line.day, line.rateBps, line.usdMicros.toString()]), [[201, 1000, "200000"]]);
});

test("a pool whose stream 1 is not all known yet is no data — nothing is written until it is", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const sig = "launchTradeSig2";
  await store.versioned("rewardAccruals").compareAndSet(`METEORA_LAUNCH:${sig}`, null, { version: 0, trader: TRADER, entries: [{ ...coreEntry("CASHBACK", TRADER, null, sig, at(0, 1)), valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } }] });
  await store.collection("launchTradeRecords").set(`mainnet:${sig}`, { cluster: "mainnet", signature: sig, wallet: TRADER, venue: "curve", curve: POOL, config: PROTECTED, state: "DONE", settledAt: at(0, 1) });
  await journal(store, [claim(at(0, 3), "10000000")]);
  const run = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.equal(run.pools[0].state, "NO_DATA");
  assert.deepEqual(await entries(store), []);
});

/* ---------------------------------------------------------------------------------------------- reads */

test("the partner's read: pools, sums by state and the version; the in-pool estimate from the pool's counters, or null when not read", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000"), stream1(at(1), "100000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(2)) });
  const counters = new Map([[`solana:${POOL}`, { receivedRaw: "600000", mint: USDC, receivedUsdMicros: "600000", readAt: at(20) }]]);
  const view = await readPartnerNetwork(store, PARTNER, { now: at(20), counters });
  assert.equal(view.rulesVersion, "network-1.0.0");
  assert.equal(view.founding, null);
  const [pool] = view.pools;
  assert.deepEqual(
    [pool.status, pool.firstReceivedAt, pool.day, pool.shareBps, pool.shareUntil, pool.baseUsdMicros, pool.earnedUsdMicros, pool.pendingUsdMicros, pool.availableUsdMicros, pool.capUsdMicros, pool.withinCap],
    ["EARNING", T0, 21, 2000, at(180), "5000000", "1000000", "0", "1000000", "2000000", true],
  );
  /* What is still in the pool, less stream 1 not netted yet, at today's share: (600 000 − 100 000) × 20 %. */
  assert.equal(pool.inPoolUsdMicros, "100000");
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(20) })).totals.inPoolUsdMicros, null);
  assert.deepEqual((await readPartnerNetwork(store, OTHER, { now: at(20) })).pools, []);
  const ledger = await readNetworkLedger(store, { now: at(20), counters });
  assert.deepEqual([ledger.partners.length, ledger.totals.earnedUsdMicros, ledger.totals.availableUsdMicros, ledger.totals.inPoolUsdMicros], [1, "1000000", "1000000", "100000"]);
});

test("the pool's counters are read where the program keeps them", () => {
  const data = new Uint8Array(424);
  const view = Buffer.from(data.buffer);
  view.writeBigUInt64LE(19926n, 256);
  view.writeBigUInt64LE(47824n, 272);
  data.set(Uint8Array.from({ length: 32 }, (_, index) => index + 1), 72);
  const decoded = decodeDbcPoolCounters(data);
  assert.equal(decoded.partnerQuoteRaw, 47824n);
  assert.equal(decoded.partnerBaseRaw, 0n);
  assert.deepEqual([...decoded.config.slice(0, 3)], [1, 2, 3]);
  assert.equal(decodeDbcPoolCounters(new Uint8Array(100)), null);
});

/* --------------------------------------------------------------------------------------------- ranks */

test("a partner's rank event carries dollars, a launch's points; the window floors the partners' sum once, as achievements do", () => {
  const base = { wallet: PARTNER, ref: "solana:pool:tx:1:0", createdAt: T0, at: T0 };
  assert.equal(RankEventSchema.safeParse({ ...base, kind: "PARTNER_POOL", points: "5", usdMicros: "1", rulesVersion: "network-1.0.0" }).success, false);
  assert.equal(RankEventSchema.safeParse({ ...base, kind: "LAUNCH_GRADUATED", points: "250", usdMicros: "1", rulesVersion: "2.0.0" }).success, false);
  assert.equal(RankEventSchema.safeParse({ ...base, kind: "LAUNCH_GRADUATED", points: "250", rulesVersion: "network-1.0.0" }).success, false);
  const events = [
    { ...base, kind: "PARTNER_POOL", points: "0", usdMicros: "60000000", rulesVersion: "network-1.0.0" },
    { ...base, ref: "solana:pool:tx2:1:0", at: at(1), kind: "PARTNER_POOL", points: "0", usdMicros: "40500000", rulesVersion: "network-1.0.0" },
  ].map((event) => RankEventSchema.parse(event));
  const standing = rankStanding({ wallet: PARTNER, entries: [], events, at: at(2) });
  /* 100 points is exactly Gold on the ladder in force (rules 2.2.0) — the floor of the partners' sum, once. */
  assert.deepEqual([standing.fromPartners, standing.fromLaunches, standing.points, standing.rank], [100n, 0n, 100n, "GOLD"]);
  const reached = ranksReached({ wallet: PARTNER, entries: [], events, at: at(2), since: at(-1) });
  assert.equal(reached.find((step) => step.rank === "SILVER").at, base.at, "the first pool alone passes Silver");
  assert.equal(reached.find((step) => step.rank === "GOLD").at, at(1), "Gold needs both, floored once");
});

/* --------------------------------------------------------------------------------- inputs not read */

test("a registry that was not read, does not name a pool's config or cannot place it is no data — nothing earned is reversed", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.equal(sum(await entries(store)), 1_000_000n);
  const claimer = registry.find((row) => row.role === "LAUNCH_FEE_CLAIMER");
  const broken = [
    [],
    registry.filter((row) => row.address !== PROTECTED),
    /* The registry names the config but cannot place it: two fee claimers, or none. */
    [...registry, { ...claimer, id: `${claimer.id}-second`, address: "SecondC1aimerSafe11111111111111111111111111" }],
    registry.filter((row) => row.role !== "LAUNCH_FEE_CLAIMER"),
  ];
  for (const partial of broken) {
    const run = await accrueNetwork(store, clean, { registry: partial, clock: () => Date.parse(at(20)) });
    assert.equal(run.pools[0].state, "NO_DATA");
  }
  const rows = await entries(store);
  assert.equal(rows.length, 1);
  assert.equal(entryStates(rows, at(20)).availableUsdMicros, 1_000_000n);
  assert.equal((await readRankStanding(store, PARTNER, at(16))).fromPartners, 5n);
});

/* ------------------------------------------------------------------------------------- R1, edges */

test("R1: an unvalued curve claim is taken to carry none of the open stream 1 — the next valued one nets it all, never too large a base; stream 1 above a claim carries to the next", () => {
  const unvalued = { usdMicros: null, valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } };
  const first = computePoolLines({
    binding: binding(),
    claims: [claim(at(0, 2), "900", unvalued), claim(at(5), "1000000"), claim(at(6), "400000", { source: "migration" }), claim(at(7), "50000000")],
    stream1: [stream1(at(0, 1), "800000"), stream1(at(4), "100000")],
    seat: null, eligible: true, configs: null,
  });
  assert.equal(first.unvalued.length, 1);
  assert.deepEqual(first.lines.map((line) => [line.source, line.offsetUsdMicros.toString(), line.baseUsdMicros.toString(), line.usdMicros.toString()]), [
    ["curve", "900000", "100000", "20000"],
    ["migration", "0", "400000", "80000"],
    ["curve", "0", "50000000", "10000000"],
  ]);
  /* With no stream 1 open at it, an unvalued claim holds nothing back. */
  const clear = computePoolLines({ binding: binding(), claims: [claim(at(0, 2), "900", unvalued), claim(at(5), "1000000")], stream1: [stream1(at(4), "100000")], seat: null, eligible: true, configs: null });
  assert.deepEqual(clear.lines.map((line) => [line.offsetUsdMicros.toString(), line.baseUsdMicros.toString()]), [["100000", "900000"]]);
  const carried = computePoolLines({
    binding: binding(),
    claims: [claim(at(1), "500000"), claim(at(2), "2000000"), claim(at(3), "700000", { source: "migration" })],
    stream1: [stream1(at(0, 1), "800000")],
    seat: null, eligible: true, configs: null,
  });
  assert.deepEqual(carried.lines.map((line) => [line.source, line.offsetUsdMicros.toString(), line.baseUsdMicros.toString()]), [
    ["curve", "500000", "0"],
    ["curve", "300000", "1700000"],
    ["migration", "0", "700000"],
  ]);
  assert.equal(carried.openOffsetUsdMicros, 0n);
});

test("a blocked pool is taken back from its entries alone — even when the registry is not read", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "10000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  const run = await accrueNetwork(store, team(CREATOR), { registry: [], clock: () => Date.parse(at(20)) });
  assert.equal(run.pools[0].state, "BLOCKED");
  assert.equal(sum(await entries(store)), 0n);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(40) })).totals.availableUsdMicros, "0");
});

test("a run needs a readable clock; a pool whose check could not run at the launch reads as checked once a run has checked it", async () => {
  const store = createMemoryGuardStore();
  await bind(store, { checks: { status: "unavailable", reasons: [], at: at(-1) } });
  await assert.rejects(accrueNetwork(store, clean, { registry, clock: () => Number.NaN }));
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(1) })).pools[0].status, "REVIEW");
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(2) })).pools[0].status, "WAITING");
});

test("an entry that cannot be read leaves its pool to nobody: no data, nothing written over it", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  const [entry] = await entries(store);
  await store.collection(NETWORK_ENTRY_COLLECTION).set(`${PARTNER}:solana:${POOL}:${entry.line.tx}:${entry.line.index}:0`, { ...entry, usdMicros: "not a number" });
  const run = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(2)) });
  assert.equal(run.pools[0].state, "NO_DATA");
  assert.equal((await store.collection(NETWORK_ENTRY_COLLECTION).valuesWithPrefix("")).length, 1);
  await assert.rejects(readPartnerNetwork(store, PARTNER, { now: at(3) }), /could not be read/);
  assert.equal((await checkNetworkLedger(store, { registry })).ok, false);
});

test("two runs at once write each line once: the loser reads again and finds it done", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await bind(store, { pool: POOL_2, creator: OTHER });
  await journal(store, [claim(T0, "5000000"), claim(at(1), "3000000"), claim(at(1), "4000000", { pool: POOL_2, creator: OTHER })]);
  const runs = await Promise.all([accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(2)) }), accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(2)) })]);
  assert.ok(runs.flatMap((run) => run.pools).every((pool) => ["WRITTEN", "UNCHANGED"].includes(pool.state)));
  const rows = await entries(store);
  assert.equal(rows.length, 3);
  assert.equal(sum(rows), 2_400_000n);
  assert.equal((await listRankEvents(store, PARTNER)).length, 0, "no point before its hold");
  await Promise.all([accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(20)) }), accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(20)) })]);
  assert.equal((await listRankEvents(store, PARTNER)).length, 3);
  assert.equal((await checkNetworkLedger(store, { registry })).ok, true);
});

test("the review ledger names the pools still holding Ryntra's part unclaimed — the reminder that a claim is due", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await bind(store, { pool: POOL_2, creator: OTHER });
  await bind(store, { pool: DEMO_POOL, creator: INVITER });
  const counters = new Map([
    [`solana:${POOL}`, { receivedRaw: "47824", mint: USDC, receivedUsdMicros: "47824", readAt: T0 }],
    [`solana:${POOL_2}`, { receivedRaw: "0", mint: USDC, receivedUsdMicros: "0", readAt: T0 }],
    [`solana:${DEMO_POOL}`, { receivedRaw: "5000", mint: "CommunityToken1111111111111111111111111111", receivedUsdMicros: null, readAt: T0 }],
  ]);
  const ledger = await readNetworkLedger(store, { now: T0, counters });
  assert.deepEqual(ledger.awaitingClaim.map((row) => [row.pool, row.receivedRaw, row.receivedUsdMicros]).sort(), [[DEMO_POOL, "5000", null], [POOL, "47824", "47824"]].sort());
  assert.deepEqual((await readNetworkLedger(store, { now: T0 })).awaitingClaim, []);
});

/* ------------------------------------------------------------------------------ rank dating, the cap */

test("rank: a correction then a reversal inside the hold never lift the rank; each part of a decrease leaves with the base it cancels", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  /* Day 1: a $100 claim less $50 of stream 1 — a $50 base. Day 10: an earlier curve claim journaled late takes that
     stream 1 instead, and the line rises to a $100 base (a correction). */
  await journal(store, [claim(at(0, 3), "100000000"), stream1(at(0, 1), "50000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  await journal(store, [claim(at(0, 2), "50000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(10)) });
  /* Day 12: the pool turns out to be the partner's own. */
  await accrueNetwork(store, { profileOf: async () => "profile-1", team: async () => new Set() }, { registry, clock: () => Date.parse(at(12)) });
  const rows = await entries(store);
  assert.deepEqual(rows.map((row) => [row.kind, row.baseUsdMicros]).sort(), [["CORRECTION", "50000000"], ["EARNED", "50000000"], ["REVERSAL", "-100000000"]].sort());
  assert.equal(sum(rows), 0n);
  for (const day of [14, 16, 25, 30, 44, 46, 50, 54, 60]) assert.equal((await readRankStanding(store, PARTNER, at(day))).fromPartners, 0n, `day ${day}`);
});

test("rank: a decrease written after the hold takes back only its own base — never another pool's — and leaves when that base leaves", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await bind(store, { pool: POOL_2, creator: OTHER });
  await journal(store, [claim(T0, "150000000", { pool: POOL_2, creator: OTHER })]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  await journal(store, [claim(at(9), "150000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(10)) });
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(16)) });
  /* Day 20: the first pool (earned day 1, counting from day 15) is found to be the partner's own. */
  const ownSecond = { profileOf: async (_family, wallet) => (wallet === OTHER || wallet === PARTNER ? "profile-1" : null), team: async () => new Set() };
  await accrueNetwork(store, ownSecond, { registry, clock: () => Date.parse(at(20)) });
  await accrueNetwork(store, ownSecond, { registry, clock: () => Date.parse(at(25)) });
  const points = async (day) => (await readRankStanding(store, PARTNER, at(day))).fromPartners;
  assert.equal(await points(16), 150n, "the first pool counts after its hold");
  assert.equal(await points(21), 0n, "taken back on day 20; the second is still in its hold");
  assert.equal(await points(25), 150n, "the second counts from day 24");
  assert.equal(await points(46), 150n, "the decrease left with the base it cancels, on day 45");
  assert.equal(await points(55), 0n, "the second leaves on day 54");
});

test("the cap through a run: a version that would pay more than 40 % is held to it, and the reconciliation agrees", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  const greedy = { ...NETWORK_RULES_V1, version: "network-9.0.0", schedules: { ...NETWORK_RULES_V1.schedules, STANDARD: [{ untilDay: null, bps: 5000 }] } };
  await journal(store, [claim(T0, "1000000"), claim(at(1), "3000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(2)), history: [greedy] });
  const rows = await entries(store);
  assert.equal(sum(rows), 1_600_000n);
  assert.ok(sum(rows) * 10_000n <= sum(rows, "baseUsdMicros") * 4000n);
  const check = await checkNetworkLedger(store, { registry, history: [greedy] });
  assert.equal(check.ok, true);
  assert.deepEqual([check.pools[0].capUsdMicros, check.pools[0].withinCap], ["1600000", true]);
});

test("a launch on the demo market reads as not counted: no share is promised", async () => {
  const store = createMemoryGuardStore();
  await bind(store, { pool: DEMO_POOL, factory: DEMO });
  await journal(store, [claim(T0, "1000000", { pool: DEMO_POOL, config: DEMO, claimer: EXECUTOR })]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  const [pool] = (await readPartnerNetwork(store, PARTNER, { now: at(2) })).pools;
  assert.deepEqual([pool.status, pool.shareBps, pool.earnedUsdMicros, pool.firstReceivedAt], ["NOT_COUNTED", 0, "0", null]);
});

test("rank: a point mended after its hold keeps its own moment, so the reversal that follows cancels it exactly — rank and achievements agree", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "150000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(16)) });
  const [event] = await listRankEvents(store, PARTNER);
  await store.collection("rankEvents").delete(`${PARTNER}:PARTNER_POOL:${event.ref}`);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(20)) });
  assert.equal((await listRankEvents(store, PARTNER))[0].at, at(15));
  await accrueNetwork(store, team(CREATOR), { registry, clock: () => Date.parse(at(25)) });
  const events = await listRankEvents(store, PARTNER);
  /* It counted from day 15 until the team was found on day 25 — and never after, though it was written on day 20. */
  assert.equal((await readRankStanding(store, PARTNER, at(16))).fromPartners, 150n);
  for (const day of [26, 30, 44, 46, 49, 60]) assert.equal((await readRankStanding(store, PARTNER, at(day))).fromPartners, 0n, `day ${day}`);
  /* The badge of the rank held from day 15 stays, dated as the rank card would have shown it. */
  const reached = ranksReached({ wallet: PARTNER, entries: [], events, at: at(60), since: at(-1) });
  assert.equal(reached.find((step) => step.rank === "SILVER").at, at(15));
});

test("rank: many partner events are read in one pass", () => {
  const events = [];
  for (let n = 0; n < 8000; n += 1) {
    events.push(RankEventSchema.parse({ wallet: PARTNER, kind: "PARTNER_POOL", ref: `line${n}:0`, points: "0", usdMicros: "1000000", rulesVersion: "network-1.0.0", at: at(n / 100), createdAt: T0 }));
  }
  const started = Date.now();
  const reached = ranksReached({ wallet: PARTNER, entries: [], events, at: at(90), since: at(-1) });
  assert.ok(Date.now() - started < 3000, `took ${Date.now() - started} ms`);
  assert.equal(reached.find((step) => step.rank === "GOLD").reached, true);
  assert.equal(rankStanding({ wallet: PARTNER, entries: [], events, at: at(90) }).fromPartners, 1999n);
});

test("a run that overlaps another acts on the journal and reasons read after each pool's entries — no stale reversal, no blocked pool earned back", async () => {
  const base = createMemoryGuardStore();
  await bind(base);
  await bind(base, { pool: POOL_2, creator: OTHER });
  await journal(base, [claim(T0, "5000000"), claim(T0, "3000000", { pool: POOL_2, creator: OTHER })]);
  await accrueNetwork(base, clean, { registry, clock: () => Date.parse(at(1)) });
  /* After run B has begun, and just before it reads the second pool's entries, a claim lands there and run A writes its line. */
  let fired = false;
  const racing = {
    ...base,
    collection(name) {
      const inner = base.collection(name);
      if (name !== NETWORK_ENTRY_COLLECTION) return inner;
      return {
        ...inner,
        async valuesWithPrefix(prefix) {
          if (!fired && prefix === `${PARTNER}:solana:${POOL_2}:`) {
            fired = true;
            await journal(base, [claim(at(2), "3000000", { pool: POOL_2, creator: OTHER })]);
            await accrueNetwork(base, clean, { registry, clock: () => Date.parse(at(2)) });
          }
          return inner.valuesWithPrefix(prefix);
        },
      };
    },
  };
  await accrueNetwork(racing, clean, { registry, clock: () => Date.parse(at(2)) });
  assert.ok(fired);
  const rows = await entries(base);
  assert.equal(rows.filter((row) => row.kind !== "EARNED").length, 0, "no reversal, no correction");
  assert.equal(sum(rows), 2_200_000n);
  assert.equal((await checkNetworkLedger(base, { registry })).ok, true);
});

test("one pool under review does not leave the partner's in-pool total unread", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await bind(store, { pool: POOL_2, creator: OTHER, checks: { status: "measured", reasons: ["TEAM"], at: at(-1) } });
  const counters = new Map([[`solana:${POOL}`, { receivedRaw: "500000", mint: USDC, receivedUsdMicros: "500000", readAt: T0 }]]);
  const view = await readPartnerNetwork(store, PARTNER, { now: T0, counters });
  assert.deepEqual(view.pools.map((pool) => [pool.status, pool.inPoolUsdMicros]).sort(), [["REVIEW", null], ["WAITING", "100000"]]);
  assert.equal(view.totals.inPoolUsdMicros, "100000");
});

test("a run that loses a write reads the entries again first, then the journal and reasons — no stale reversal after the race", async () => {
  const base = createMemoryGuardStore();
  await bind(base);
  await journal(base, [claim(T0, "5000000")]);
  let fired = false;
  const racing = {
    ...base,
    collection(name) {
      const inner = base.collection(name);
      if (name !== NETWORK_ENTRY_COLLECTION) return inner;
      return {
        ...inner,
        async insertIfAbsent(key, value) {
          if (!fired) {
            fired = true;
            /* Another run gets there first, after a second claim landed. */
            await journal(base, [claim(at(1), "3000000")]);
            await accrueNetwork(base, clean, { registry, clock: () => Date.parse(at(1)) });
          }
          return inner.insertIfAbsent(key, value);
        },
      };
    },
  };
  const run = await accrueNetwork(racing, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.ok(fired);
  assert.equal(run.pools[0].state, "UNCHANGED");
  const rows = await entries(base);
  assert.deepEqual(rows.map((row) => row.kind), ["EARNED", "EARNED"]);
  assert.equal(sum(rows), 1_600_000n);
  assert.equal((await checkNetworkLedger(base, { registry })).ok, true);
});

test("a pool with an entry that cannot be read gets no rank points written", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  const [entry] = await entries(store);
  await store.collection("rankEvents").delete(`${PARTNER}:PARTNER_POOL:solana:${POOL}:${entry.line.tx}:${entry.line.index}:0`);
  await store.collection(NETWORK_ENTRY_COLLECTION).set(`${PARTNER}:solana:${POOL}:${entry.line.tx}:${entry.line.index}:0`, { ...entry, schema: 2 });
  const run = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(2)) });
  assert.deepEqual([run.pools[0].state, run.points.recorded], ["NO_DATA", 0]);
  assert.deepEqual(await listRankEvents(store, PARTNER), []);
});

test("the reads say no data where an input is missing, and count the claims with no price — never a quiet zero", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await bind(store, { pool: POOL_2, creator: OTHER });
  const sig = "launchTradeSig3";
  await store.versioned("rewardAccruals").compareAndSet(`METEORA_LAUNCH:${sig}`, null, { version: 0, trader: TRADER, entries: [{ ...coreEntry("CASHBACK", TRADER, null, sig, at(0, 1)), valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } }] });
  await store.collection("launchTradeRecords").set(`mainnet:${sig}`, { cluster: "mainnet", signature: sig, wallet: TRADER, venue: "curve", curve: POOL, config: PROTECTED, state: "DONE", settledAt: at(0, 1) });
  const unvalued = { usdMicros: null, valuation: { basis: "UNVALUED", price: null, sourceRef: null, observedAt: null } };
  await journal(store, [claim(at(0, 3), "10000000"), claim(at(0, 3), "900", { pool: POOL_2, creator: OTHER, ...unvalued })]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  const view = await readPartnerNetwork(store, PARTNER, { now: at(2) });
  const by = Object.fromEntries(view.pools.map((pool) => [pool.pool, pool]));
  assert.deepEqual([by[POOL].data, by[POOL].earnedUsdMicros], ["NO_DATA", "0"]);
  assert.deepEqual([by[POOL_2].data, by[POOL_2].unvaluedClaims], ["OK", 1]);
  assert.equal(view.totals.complete, false);
  assert.equal((await readNetworkLedger(store, { now: at(2) })).totals.complete, false);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(2), registry: [] })).pools.every((pool) => pool.data === "NO_DATA"), true);
});

test("a reason row this build cannot read still blocks its pool", async () => {
  const store = createMemoryGuardStore();
  await bind(store);
  await journal(store, [claim(T0, "5000000")]);
  await accrueNetwork(store, { profileOf: async () => "profile-1", team: async () => new Set() }, { registry, clock: () => Date.parse(at(1)) });
  await store.collection("growthPartnerChecks").set(`pool:solana:${POOL}:SAME_PROFILE`, { network: "solana", pool: POOL, partner: PARTNER, reason: "SAME_DEVICE", at: at(1) });
  const run = await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(2)) });
  assert.equal(run.pools[0].state, "BLOCKED");
  assert.equal(sum(await entries(store)), 0n);
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(3) })).pools[0].status, "REVIEW");
  assert.equal((await readPartnerNetwork(store, PARTNER, { now: at(3) })).pools[0].unreadableReason, false);
  const owner = (await readNetworkLedger(store, { now: at(3) })).partners[0].pools[0];
  assert.deepEqual([owner.status, owner.unreadableReason], ["BLOCKED", true]);
  /* A row that lost its network blocks the pool on every network. */
  const damaged = createMemoryGuardStore();
  await bind(damaged);
  await journal(damaged, [claim(T0, "5000000")]);
  await damaged.collection("growthPartnerChecks").set(`pool:solana:${POOL}:SAME_PROFILE`, { pool: POOL, partner: PARTNER, reason: "SAME_PROFILE", at: at(1) });
  assert.equal((await accrueNetwork(damaged, clean, { registry, clock: () => Date.parse(at(2)) })).pools[0].state, "BLOCKED");
  assert.deepEqual(await entries(damaged), []);
});

test("a reason another run finds while this one writes is acted on in this same run", async () => {
  const base = createMemoryGuardStore();
  await bind(base);
  await journal(base, [claim(T0, "5000000")]);
  let fired = false;
  const racing = {
    ...base,
    collection(name) {
      const inner = base.collection(name);
      if (name !== NETWORK_ENTRY_COLLECTION) return inner;
      return {
        ...inner,
        async insertIfAbsent(key, value) {
          const inserted = await inner.insertIfAbsent(key, value);
          if (!fired) {
            fired = true;
            await base.collection("growthPartnerChecks").insertIfAbsent(`pool:solana:${POOL}:LINKED_WALLET`, { network: "solana", pool: POOL, partner: PARTNER, reason: "LINKED_WALLET", at: at(1) });
          }
          return inserted;
        },
      };
    },
  };
  const run = await accrueNetwork(racing, clean, { registry, clock: () => Date.parse(at(1)) });
  assert.ok(fired);
  assert.equal(run.pools[0].state, "BLOCKED");
  const rows = await entries(base);
  assert.deepEqual(rows.map((row) => row.kind).sort(), ["EARNED", "REVERSAL"]);
  assert.equal(sum(rows), 0n);
  assert.equal((await readRankStanding(base, PARTNER, at(20))).fromPartners, 0n);
});
