import assert from "node:assert/strict";
import test from "node:test";

import { fundingVerdict, NO_CLUSTER_CHECK } from "../city-economy/honest-count.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { clusterVerdict, NOTHING_READ } from "./cluster-check.ts";
import { walletClusters } from "./cluster-check.server.ts";
import { partyAncestry, PROTECT_RULES, signalHash } from "./protect.ts";
import { writeFundingNode } from "./review-store.ts";

/*
 * The Growth line answers one question for the city: were these two wallets one person? A wrong «separate» hands a
 * billboard and a host's share to someone trading with themselves; a wrong «same» takes a real person's standing
 * away. So the tests hold both sides: nothing but a finding says «same», and nothing but a complete reading says
 * «separate».
 */

const KEY = new Uint8Array(32).fill(7);
const hash = (value) => signalHash(KEY, "address", value);
const RULES = PROTECT_RULES.version;

const complete = (hashes, chain = [], ancestors = []) => ({ hashes, chain, ancestors, complete: true, deep: false });

const whole = (over = {}) => ({
  funding: { left: complete([hash("A")]), right: complete([hash("B")]) },
  moneyBetween: false,
  withdrawals: { left: [hash("x1")], right: [hash("x2")] },
  devices: { left: [`device:${hash("d1")}`], right: [`device:${hash("d2")}`] },
  linked: { left: [hash("A")], right: [hash("B")] },
  ...over,
});

/* ----------------------------------------------------------------------------------------- the verdict */

test("nothing read is unknown — never «separate», and never counted", () => {
  assert.deepEqual(clusterVerdict(NOTHING_READ), { verdict: "unknown", why: "no_links" });
});

test("every check ran and found nothing: «separate», with the rules that said so", () => {
  assert.deepEqual(clusterVerdict(whole()), { verdict: "separate", rules: RULES });
});

test("one unread check is enough to withhold «separate», and it says which", () => {
  const cases = [
    [{ linked: null }, "no_links"],
    [{ funding: null }, "no_funding"],
    [{ funding: { left: { ...complete([hash("A")]), complete: false }, right: complete([hash("B")]) } }, "funding_incomplete"],
    [{ funding: { left: { ...complete([hash("A")]), deep: true }, right: complete([hash("B")]) } }, "funding_deep"],
    [{ moneyBetween: null }, "no_money_check"],
    [{ withdrawals: null }, "no_withdrawals"],
    [{ devices: null }, "no_devices"],
  ];
  for (const [over, why] of cases) assert.deepEqual(clusterVerdict(whole(over)), { verdict: "unknown", why }, why);
});

test("a wallet the person signed for is the same person, whatever else was read", () => {
  const shared = hash("evm");
  const verdict = clusterVerdict(whole({ linked: { left: [hash("A"), shared], right: [hash("B"), shared] }, funding: null, devices: null, withdrawals: null, moneyBetween: null }));
  assert.deepEqual(verdict, { verdict: "same", reason: "linked_wallet", rules: RULES });
});

test("one funded the other, or money moved between them — «direct_funds» either way", () => {
  const funded = clusterVerdict(whole({ funding: { left: complete([hash("A")], [hash("B")]), right: complete([hash("B")]) } }));
  assert.deepEqual(funded, { verdict: "same", reason: "direct_funds", rules: RULES });
  assert.deepEqual(clusterVerdict(whole({ moneyBetween: true })), { verdict: "same", reason: "direct_funds", rules: RULES });
});

test("the same withdrawal address, and the same device, each say «same»", () => {
  const out = hash("exchange-deposit");
  assert.deepEqual(clusterVerdict(whole({ withdrawals: { left: [out], right: [out] } })), { verdict: "same", reason: "shared_withdrawal", rules: RULES });
  const device = `device:${hash("one-laptop")}`;
  assert.deepEqual(clusterVerdict(whole({ devices: { left: [device], right: [device] } })), { verdict: "same", reason: "shared_device", rules: RULES });
});

test("a shared source is the weakest reason, and a marked hub is no reason at all", () => {
  const source = hash("source");
  const shared = whole({ funding: { left: complete([hash("A")], [source], [source]), right: complete([hash("B")], [source], [source]) } });
  assert.deepEqual(clusterVerdict(shared), { verdict: "same", reason: "shared_funder", rules: RULES });
  /* `ancestors` stops at a hub the reviewer marked, so an exchange's hot wallet never joins two people. */
  const hubbed = whole({ funding: { left: complete([hash("A")], [source], []), right: complete([hash("B")], [source], []) } });
  assert.deepEqual(clusterVerdict(hubbed), { verdict: "separate", rules: RULES });
});

test("the strongest finding is the one reported", () => {
  const everything = whole({
    linked: { left: [hash("A"), hash("evm")], right: [hash("B"), hash("evm")] },
    moneyBetween: true,
    withdrawals: { left: [hash("out")], right: [hash("out")] },
    devices: { left: ["device:d"], right: ["device:d"] },
  });
  assert.equal(clusterVerdict(everything).reason, "linked_wallet");
  assert.equal(clusterVerdict({ ...everything, linked: null }).reason, "direct_funds");
  assert.equal(clusterVerdict({ ...everything, linked: null, moneyBetween: false, funding: null }).reason, "shared_withdrawal");
  assert.equal(clusterVerdict({ ...everything, linked: null, moneyBetween: false, funding: null, withdrawals: null }).reason, "shared_device");
});

test("the city's own funding-only reading agrees with ours on the pairs it can judge", () => {
  const left = partyAncestry([hash("A")], new Map(), new Set());
  const right = partyAncestry([hash("B")], new Map(), new Set());
  /* Neither wallet was read, so the city's helper says «unknown» and so do we — it never claims two people. */
  assert.equal(fundingVerdict(left, right).verdict, "unknown");
  assert.equal(clusterVerdict({ ...NOTHING_READ, funding: { left, right } }).verdict, "unknown");
});

/* ----------------------------------------------------------------------------------------- the adapter */

const chain = (funders = {}, history = {}) => ({
  funding: async (wallet) => (funders[wallet] === undefined ? { state: "EMPTY", funder: null, firstAt: null, lastAt: null } : { state: "FOUND", funder: funders[wallet], firstAt: "2026-10-01T00:00:00.000Z", lastAt: "2026-10-01T00:00:00.000Z" }),
  transfers: async (wallet) => (history[wallet] === null ? null : { items: history[wallet] ?? [], complete: true }),
});

const NOW = "2026-10-27T12:00:00.000Z";

test("the adapter answers the city's port, and an identical pair is settled without a read", async () => {
  let reads = 0;
  const deps = chain();
  const clusters = walletClusters({ store: createMemoryGuardStore(), key: KEY, funding: async (w) => (reads += 1, deps.funding(w)), transfers: deps.transfers });
  assert.deepEqual(await clusters.check("A", "A", NOW), { verdict: "same", reason: "linked_wallet", rules: RULES });
  assert.equal(reads, 0);
});

test("a wallet that funded the other is found on the chain and kept for the next ask", async () => {
  const store = createMemoryGuardStore();
  let reads = 0;
  const deps = chain({ B: "A" });
  const clusters = walletClusters({ store, key: KEY, funding: async (w) => (reads += 1, deps.funding(w)), transfers: deps.transfers });
  assert.deepEqual(await clusters.check("A", "B", NOW), { verdict: "same", reason: "direct_funds", rules: RULES });
  const first = reads;
  assert.ok(first > 0, "the chain was read");
  await clusters.check("A", "B", NOW);
  assert.equal(reads, first, "the same day's second ask reads nothing again");
});

test("money that moved between the two is «direct_funds», whoever funded whom", async () => {
  const deps = chain({}, { A: [{ counterparty: "B", direction: "out", at: NOW }], B: [] });
  const clusters = walletClusters({ store: createMemoryGuardStore(), key: KEY, ...deps });
  assert.deepEqual(await clusters.check("A", "B", NOW), { verdict: "same", reason: "direct_funds", rules: RULES });
});

test("two wallets that paid out to the same address are one person", async () => {
  const deps = chain({}, { A: [{ counterparty: "X", direction: "out", at: NOW }], B: [{ counterparty: "X", direction: "out", at: NOW }] });
  const clusters = walletClusters({ store: createMemoryGuardStore(), key: KEY, ...deps });
  assert.deepEqual(await clusters.check("A", "B", NOW), { verdict: "same", reason: "shared_withdrawal", rules: RULES });
});

test("a history that could not be read is «unknown», never «separate»", async () => {
  /* Both trails are whole, so only the unread history is left to decide — and it decides nothing. */
  const deps = chain({ A: "fa", B: "fb" }, { A: null, B: [] });
  const clusters = walletClusters({ store: createMemoryGuardStore(), key: KEY, ...deps });
  assert.deepEqual(await clusters.check("A", "B", NOW), { verdict: "unknown", why: "no_money_check" });
});

test("two wallets with nothing in common, every check run: «separate»", async () => {
  const deps = chain({ A: "fa", B: "fb" }, { A: [], B: [] });
  const clusters = walletClusters({ store: createMemoryGuardStore(), key: KEY, ...deps });
  assert.deepEqual(await clusters.check("A", "B", NOW), { verdict: "separate", rules: RULES });
});

test("what the protection run already stored is used, and a wallet it never saw is still read", async () => {
  const store = createMemoryGuardStore();
  await writeFundingNode(store, hash("B"), { state: "FOUND", funder: hash("A"), firstAt: NOW, lastAt: NOW }, NOW);
  const asked = [];
  const deps = chain({}, { A: [], B: [] });
  const clusters = walletClusters({ store, key: KEY, funding: async (w) => (asked.push(w), deps.funding(w)), transfers: deps.transfers });
  assert.deepEqual(await clusters.check("A", "B", NOW), { verdict: "same", reason: "direct_funds", rules: RULES });
  assert.ok(asked.includes("A"), "the wallet with no stored node was read");
});

test("the city's placeholder counts nothing until this adapter is wired in", async () => {
  assert.deepEqual(await NO_CLUSTER_CHECK.check("A", "B", NOW), { verdict: "unknown", why: "no_check" });
});

test("a trader with too long a history is still told apart, once the read reaches far enough back", async () => {
  const old = { state: "DEEP", funder: null, firstAt: "2026-07-01T00:00:00.000Z", lastAt: NOW };
  const fresh = { state: "DEEP", funder: null, firstAt: "2026-10-25T00:00:00.000Z", lastAt: NOW };
  const run = async (read) => {
    const deps = chain({}, { A: [], B: [] });
    const clusters = walletClusters({ store: createMemoryGuardStore(), key: KEY, funding: async () => read, transfers: deps.transfers });
    return clusters.check("A", "B", NOW);
  };
  assert.deepEqual(await run(old), { verdict: "separate", rules: RULES }, "read back past the rule's days: the wallet stands on its own");
  assert.deepEqual(await run(fresh), { verdict: "unknown", why: "funding_deep" }, "a few days of history hide the start as much as none");
});
