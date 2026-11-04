import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { bindProposal, creditedOf, listStatements, prepareWeeks, proposalMatches, readOpenWeek, readStatement, settleWeek } from "./store.server.ts";
import {
  closedWeeks,
  earningsOf,
  feeEventsOf,
  minimumMicros,
  nextWeek,
  pairKey,
  pairsOf,
  PAYOUTS_FIRST_WEEK,
  payoutsOf,
  prepareStatement,
  shareAt,
  tradedBy,
  usdOfMicros,
  weekOf,
} from "./week.ts";

const ALICE = "A1iceParTner1111111111111111111111111111111";
const BOB = "BobParTner222222222222222222222222222222222";
const P1 = "Pers0n1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const P2 = "Pers0n2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const P3 = "Pers0n3cccccccccccccccccccccccccccccccccccc";
const STRAY = "StrayWa11etddddddddddddddddddddddddddddddddd";

const bound = (referrer, referredAt) => ({ referrer, referredAt, previousReferrer: null, previousReferredAt: null });
const ACCOUNTS = new Map([
  [P1, bound(ALICE, "2026-10-01T00:00:00.000Z")], // bound 32 days before the first week: 40 % until 30.12
  [P2, bound(ALICE, "2026-06-01T00:00:00.000Z")], // past 90 days: 30 %
  [P3, bound(BOB, "2026-11-01T00:00:00.000Z")],
  [STRAY, null],
]);

/* The counting alone: every pair clear and every partner past the bar. The guard's own cases are below. */
const CLEAR = { pairs: { get: () => "PAYS" }, traded: { has: () => true } };
const allPay = async (pairs) => new Map(pairs.map((pair) => [pairKey(pair.partner, pair.person), "PAYS"]));

let n = 0;
const op = (wallet, at, usd, extra = {}) => ({
  id: `JUPITER:${++n}`,
  product: "SWAP",
  status: "CONFIRMED",
  verification: "VERIFIED",
  internal: false,
  wallet,
  confirmedAt: at,
  fee: { collected: true, ryntraUsd: usd },
  ...extra,
});

/* The partners' own trades, before the first week: each has met the bar, and nothing of theirs is a share. */
const OWN = () => [op(ALICE, "2026-10-20T00:00:00Z", 1), op(BOB, "2026-10-20T00:00:00Z", 1)];

test("weeks: Monday 2.11.2026 is the first; a week is counted only once closed", () => {
  assert.equal(PAYOUTS_FIRST_WEEK, "2026-11-02");
  assert.equal(weekOf(Date.parse("2026-11-02T00:00:00Z")), "2026-11-02");
  assert.equal(weekOf(Date.parse("2026-11-08T23:59:59Z")), "2026-11-02");
  assert.equal(weekOf(Date.parse("2026-11-09T00:00:00Z")), "2026-11-09");
  assert.equal(nextWeek("2026-12-28"), "2027-01-04");
  assert.deepEqual(closedWeeks(Date.parse("2026-11-08T12:00:00Z")), []);
  assert.deepEqual(closedWeeks(Date.parse("2026-11-16T00:00:00Z")), ["2026-11-02", "2026-11-09"]);
});

test("the share: 40 % for each person's first 90 days with the partner, then 30 %; never the wallet's own", () => {
  assert.deepEqual(shareAt(P1, ACCOUNTS.get(P1), "2026-11-03T00:00:00Z"), { partner: ALICE, bps: 4000 });
  assert.deepEqual(shareAt(P1, ACCOUNTS.get(P1), "2026-12-30T00:00:00Z"), { partner: ALICE, bps: 3000 });
  assert.deepEqual(shareAt(P2, ACCOUNTS.get(P2), "2026-11-03T00:00:00Z"), { partner: ALICE, bps: 3000 });
  assert.equal(shareAt(STRAY, null, "2026-11-03T00:00:00Z"), null);
  assert.equal(shareAt(ALICE, bound(ALICE, "2026-10-01T00:00:00Z"), "2026-11-03T00:00:00Z"), null, "a self-referral earns nothing");
  assert.equal(shareAt(P3, ACCOUNTS.get(P3), "2026-10-31T00:00:00Z"), null, "an operation before the binding is nobody's");
});

test("fee events: only confirmed, chain-verified, valued fees of people — no bridge, no Ryntra's own wallets", () => {
  const events = feeEventsOf([
    op(P1, "2026-11-03T10:00:00Z", 1.5),
    op(P1, "2026-11-03T11:00:00Z", 2, { verification: "PENDING" }),
    op(P1, "2026-11-03T12:00:00Z", 2, { internal: true }),
    op(P1, "2026-11-03T13:00:00Z", 2, { product: "BRIDGE" }),
    op(P1, "2026-11-03T14:00:00Z", 2, { status: "FAILED" }),
    op(P1, "2026-11-03T15:00:00Z", null),
    op(P1, "2026-11-03T16:00:00Z", 0.4, { product: "LAUNCH" }),
  ]);
  assert.deepEqual(
    events.map((event) => [event.product, event.feeMicros]),
    [
      ["SWAP", 1_500_000n],
      ["LAUNCH", 400_000n],
    ],
  );
});

test("a statement: shares floored, $5 minimum, the rest carried; never more than Ryntra received", () => {
  const events = feeEventsOf([
    op(P1, "2026-11-03T10:00:00Z", 10), // 40 % → 4.00
    op(P2, "2026-11-04T10:00:00Z", 5.555555), // 30 % → 1.666666
    op(P3, "2026-11-05T10:00:00Z", 3), // Bob 40 % → 1.20 → under $5, carried
    op(STRAY, "2026-11-05T11:00:00Z", 100),
    op(P1, "2026-11-09T00:00:00Z", 50), // the next week
  ]);
  const statement = prepareStatement({ cluster: "devnet", week: "2026-11-02", events, accounts: ACCOUNTS, credited: new Set(), previous: null, voided: [], sanctioned: new Set(), guard: CLEAR, now: "2026-11-09T00:20:00Z" });
  const alice = statement.lines.find((line) => line.partner === ALICE);
  const bob = statement.lines.find((line) => line.partner === BOB);
  assert.equal(alice.accruedMicros, "5666666");
  assert.equal(alice.payMicros, "5666666");
  assert.equal(alice.people, 2);
  assert.equal(alice.held, null);
  assert.equal(bob.accruedMicros, "1200000");
  assert.equal(bob.payMicros, "0");
  assert.equal(bob.carriedOutMicros, "1200000");
  assert.equal(bob.held, "MINIMUM");
  assert.equal(statement.totals.payMicros, "5666666");
  assert.equal(statement.totals.feeMicros, "18555555");
  assert.equal(statement.minimumMicros, minimumMicros().toString());
  assert.deepEqual(payoutsOf(statement), [{ to: ALICE, amountRaw: 5_666_666n }]);
  assert.ok(BigInt(statement.totals.accruedMicros) * 10n <= BigInt(statement.totals.feeMicros) * 4n);
  assert.throws(() => prepareStatement({ cluster: "devnet", week: "2026-11-02", events, accounts: ACCOUNTS, credited: new Set(), previous: null, voided: [], sanctioned: new Set(), guard: CLEAR, now: "2026-11-08T23:00:00Z" }), /has not closed/);
  assert.throws(() => prepareStatement({ cluster: "devnet", week: "2026-10-26", events, accounts: ACCOUNTS, credited: new Set(), previous: null, voided: [], sanctioned: new Set(), guard: CLEAR, now: "2026-11-09T00:20:00Z" }), /before the first payout week/);
});

test("carried until it reaches $5; a listed partner is held, never paid; a credited operation never counts twice", () => {
  const first = feeEventsOf([op(P3, "2026-11-05T10:00:00Z", 3)]);
  const week1 = prepareStatement({ cluster: "devnet", week: "2026-11-02", events: first, accounts: ACCOUNTS, credited: new Set(), previous: null, voided: [], sanctioned: new Set(), guard: CLEAR, now: "2026-11-16T00:20:00Z" });
  const second = [...first, ...feeEventsOf([op(P3, "2026-11-10T10:00:00Z", 10)])];
  const week2 = prepareStatement({ cluster: "devnet", week: "2026-11-09", events: second, accounts: ACCOUNTS, credited: creditedOf([week1]), previous: week1, voided: [], sanctioned: new Set(), guard: CLEAR, now: "2026-11-16T00:20:00Z" });
  const bob = week2.lines.find((line) => line.partner === BOB);
  assert.equal(bob.carriedInMicros, "1200000");
  assert.equal(bob.accruedMicros, "4000000", "the first operation is not counted again");
  assert.equal(bob.payMicros, "5200000");
  const held = prepareStatement({ cluster: "devnet", week: "2026-11-09", events: second, accounts: ACCOUNTS, credited: creditedOf([week1]), previous: week1, voided: [], sanctioned: new Set([BOB]), guard: CLEAR, now: "2026-11-16T00:20:00Z" });
  const heldBob = held.lines.find((line) => line.partner === BOB);
  assert.equal(heldBob.payMicros, "0");
  assert.equal(heldBob.held, "SANCTIONS");
  assert.equal(heldBob.carriedOutMicros, "5200000");
});

test("a void week's pay is owed again on the next statement", () => {
  const events = feeEventsOf([op(P1, "2026-11-03T10:00:00Z", 20)]);
  const week1 = prepareStatement({ cluster: "devnet", week: "2026-11-02", events, accounts: ACCOUNTS, credited: new Set(), previous: null, voided: [], sanctioned: new Set(), guard: CLEAR, now: "2026-11-16T00:20:00Z" });
  const voided = { ...week1, state: "VOID" };
  const week2 = prepareStatement({ cluster: "devnet", week: "2026-11-09", events, accounts: ACCOUNTS, credited: creditedOf([week1]), previous: voided, voided: [voided], sanctioned: new Set(), guard: CLEAR, now: "2026-11-16T00:20:00Z" });
  assert.equal(week2.lines.find((line) => line.partner === ALICE).payMicros, "8000000");
});

test("the partner's own figures: counted, paid by executed weeks, the rest owed", () => {
  const events = feeEventsOf([op(P1, "2026-11-03T10:00:00Z", 20), op(P1, "2026-11-10T10:00:00Z", 5, { product: "LAUNCH" })]);
  const week1 = { ...prepareStatement({ cluster: "devnet", week: "2026-11-02", events, accounts: ACCOUNTS, credited: new Set(), previous: null, voided: [], sanctioned: new Set(), guard: CLEAR, now: "2026-11-16T00:20:00Z" }), state: "PAID" };
  const week2 = prepareStatement({ cluster: "devnet", week: "2026-11-09", events, accounts: ACCOUNTS, credited: creditedOf([week1]), previous: week1, voided: [], sanctioned: new Set(), guard: CLEAR, now: "2026-11-16T00:20:00Z" });
  assert.equal(week2.lines[0].launchMicros, "2000000", "the launch's part of the week's share");
  assert.deepEqual(earningsOf(ALICE, [week1, week2], { accrued: 1_000_000n, launch: 0n }), { accruedMicros: "11000000", launchMicros: "2000000", paidMicros: "8000000", pendingMicros: "3000000", lastPaidWeek: "2026-11-02" });
  assert.deepEqual(earningsOf(STRAY, [week1, week2]), { accruedMicros: "0", launchMicros: "0", paidMicros: "0", pendingMicros: "0", lastPaidWeek: null });
  assert.equal(usdOfMicros("5666666"), "5.66");
  assert.equal(usdOfMicros("9999"), "<0.01");
  assert.equal(usdOfMicros(0n), "0.00");
});

test("prepared once: a second pass writes nothing, carries in order, and keeps the running week's snapshot", async () => {
  const store = createMemoryGuardStore();
  const operations = [...OWN(), op(P1, "2026-11-03T10:00:00Z", 20), op(P3, "2026-11-04T10:00:00Z", 3), op(P3, "2026-11-11T10:00:00Z", 10), op(P1, "2026-11-17T10:00:00Z", 1)];
  let now = new Date("2026-11-17T12:00:00Z");
  let reads = 0;
  const deps = {
    store,
    cluster: "devnet",
    now: () => now,
    readOperations: async () => {
      reads += 1;
      return operations;
    },
    readAccount: async (wallet) => ACCOUNTS.get(wallet) ?? null,
    screen: async () => "clear",
    pairs: allPay,
  };
  const pass1 = await prepareWeeks(deps);
  assert.deepEqual(pass1.prepared, ["2026-11-02", "2026-11-09"]);
  const pass2 = await prepareWeeks(deps);
  assert.deepEqual(pass2.prepared, []);
  assert.deepEqual(pass2.existing, ["2026-11-02", "2026-11-09"]);
  const statements = await listStatements(store, "devnet");
  assert.equal(statements.length, 2);
  assert.equal(statements[1].lines.find((line) => line.partner === BOB).payMicros, "5200000");
  assert.equal(creditedOf(statements).size, 3);
  const open = await readOpenWeek(store, "devnet");
  assert.equal(open.week, "2026-11-16");
  assert.deepEqual(open.partners, { [ALICE]: "400000" });
  assert.deepEqual(open.launch, {});
  assert.ok(reads >= 2);
  now = new Date("2026-11-24T00:30:00Z");
  const pass3 = await prepareWeeks(deps);
  assert.deepEqual(pass3.prepared, ["2026-11-16"]);
  assert.equal((await readStatement(store, "devnet", "2026-11-16")).lines.find((line) => line.partner === ALICE).carriedOutMicros, "400000");
});

test("one proposal: bound, seen on chain, executed — then never built again; a stranger at the number unbinds", async () => {
  const store = createMemoryGuardStore();
  const deps = { store, cluster: "devnet", now: () => new Date("2026-11-09T01:00:00Z"), readOperations: async () => [...OWN(), op(P1, "2026-11-03T10:00:00Z", 20)], readAccount: async (wallet) => ACCOUNTS.get(wallet) ?? null, screen: async () => "clear", pairs: allPay };
  await prepareWeeks(deps);
  const statement = await readStatement(store, "devnet", "2026-11-02");
  const proposal = (state, raw = "8000000", count = 1) => ({ index: "7", type: "payouts", state, stateAt: null, approved: [], rejected: [], cancelled: [], executableAt: null, payouts: { count, done: 0, items: 1, sums: [{ asset: "USDC", raw }] }, changes: null, claims: null, readable: true });
  assert.equal(proposalMatches(statement, proposal("active")), true);
  assert.equal(proposalMatches(statement, proposal("active", "8000001")), false);
  assert.equal(proposalMatches(statement, proposal("active", "8000000", 2)), false);

  await bindProposal(store, "devnet", "2026-11-02", { multisig: "M", index: "7", buildId: "b" }, new Date("2026-11-09T01:00:00Z"));
  const stranger = await settleWeek(store, "devnet", "2026-11-02", async () => proposal("active", "1"), new Date("2026-11-09T01:01:00Z"));
  assert.equal(stranger.state, "PREPARED");
  assert.equal(stranger.proposal, null);

  await bindProposal(store, "devnet", "2026-11-02", { multisig: "M", index: "7", buildId: "c" }, new Date("2026-11-09T01:02:00Z"));
  const notYet = await settleWeek(store, "devnet", "2026-11-02", async () => null, new Date("2026-11-09T01:03:00Z"));
  assert.equal(notYet.proposal.index, "7", "a build signed a moment ago keeps its number");
  const seen = await settleWeek(store, "devnet", "2026-11-02", async () => proposal("approved"), new Date("2026-11-09T01:04:00Z"));
  assert.equal(seen.state, "PROPOSED");
  await assert.rejects(() => bindProposal(store, "devnet", "2026-11-02", { multisig: "M", index: "8", buildId: "d" }, new Date()), /PROPOSED/);
  const paid = await settleWeek(store, "devnet", "2026-11-02", async () => ({ ...proposal("executed"), payouts: { count: 0, done: 1, items: 1, sums: [] } }), new Date("2026-11-09T02:00:00Z"));
  assert.equal(paid.state, "PAID");
  assert.equal(paid.proposal.executedAt, "2026-11-09T02:00:00.000Z");
  const again = await settleWeek(store, "devnet", "2026-11-02", async () => proposal("cancelled"), new Date());
  assert.equal(again.state, "PAID", "a paid week stays paid");
});

test("a rejected proposal voids the week and the next statement owes it again, once", async () => {
  const store = createMemoryGuardStore();
  let now = new Date("2026-11-09T01:00:00Z");
  const operations = [...OWN(), op(P1, "2026-11-03T10:00:00Z", 20)];
  const deps = { store, cluster: "devnet", now: () => now, readOperations: async () => operations, readAccount: async (wallet) => ACCOUNTS.get(wallet) ?? null, screen: async () => "clear", pairs: allPay };
  await prepareWeeks(deps);
  await bindProposal(store, "devnet", "2026-11-02", { multisig: "M", index: "3", buildId: null }, now);
  const reader = async () => ({ index: "3", type: "payouts", state: "rejected", stateAt: null, approved: [], rejected: [], cancelled: [], executableAt: null, payouts: { count: 1, done: 0, items: 1, sums: [{ asset: "USDC", raw: "8000000" }] }, changes: null, claims: null, readable: true });
  assert.equal((await settleWeek(store, "devnet", "2026-11-02", reader, now)).state, "VOID");
  now = new Date("2026-11-16T00:30:00Z");
  await prepareWeeks(deps);
  const week2 = await readStatement(store, "devnet", "2026-11-09");
  assert.equal(week2.lines.find((line) => line.partner === ALICE).payMicros, "8000000");
  assert.equal((await readStatement(store, "devnet", "2026-11-02")).rolledInto, "2026-11-09");
  now = new Date("2026-11-23T00:30:00Z");
  await prepareWeeks(deps);
  assert.equal((await readStatement(store, "devnet", "2026-11-16")).lines.length, 0, "rolled once, not again");
});

test("the cron is in vercel.json and the store knows the collection", async () => {
  const { readFileSync } = await import("node:fs");
  const crons = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")).crons;
  assert.deepEqual(crons.filter((cron) => cron.path === "/api/cron/partner-payouts"), [{ path: "/api/cron/partner-payouts", schedule: "20 */6 * * *" }]);
  const { GUARD_COLLECTIONS } = await import("../guard/store.ts");
  assert.ok(GUARD_COLLECTIONS.includes("partnerPayoutWeeks"));
});

/* ------------------------------------------------------------------ CITY-125: the guard on the payouts */

const week = (events, guard, extra = {}) =>
  prepareStatement({ cluster: "devnet", week: "2026-11-02", events, accounts: ACCOUNTS, credited: new Set(), previous: null, voided: [], sanctioned: new Set(), guard, now: "2026-11-09T00:20:00Z", ...extra });
const guardOf = (pairs, traded = [ALICE, BOB]) => ({ pairs: new Map(Object.entries(pairs)), traded: new Set(traded) });

test("guard: a pair not checked, under review or stopped pays nothing; only a clear pair is credited", () => {
  const events = feeEventsOf([op(P1, "2026-11-03T10:00:00Z", 20), op(P2, "2026-11-04T10:00:00Z", 20)]);
  const clear = week(events, guardOf({ [pairKey(ALICE, P1)]: "PAYS", [pairKey(ALICE, P2)]: "PAYS" }));
  assert.equal(clear.lines[0].refs.length, 2);
  for (const effect of ["WAITS", "STOPPED"]) {
    const held = week(events, guardOf({ [pairKey(ALICE, P1)]: "PAYS", [pairKey(ALICE, P2)]: effect }));
    assert.equal(held.lines[0].refs.length, 1, `${effect}: only the clear pair's operation`);
    assert.equal(held.lines[0].accruedMicros, "8000000");
  }
  /* A pair the guard never named waits too: «not known» is never «clear». */
  assert.equal(week(events, guardOf({})).lines.length, 0);
});

test("guard: a second own wallet as «friend» earns its partner nothing while the pair is reviewed — and later only if a person clears it", () => {
  const events = feeEventsOf([op(P1, "2026-11-03T10:00:00Z", 20), op(P1, "2026-11-10T10:00:00Z", 5)]);
  const reviewed = guardOf({ [pairKey(ALICE, P1)]: "WAITS" });
  const week1 = week(events, reviewed, { now: "2026-11-16T00:20:00Z" });
  assert.equal(week1.totals.accruedMicros, "0");
  /* Cleared by a person in week 2: both operations are credited then — the first week's too, once. */
  const week2 = prepareStatement({ cluster: "devnet", week: "2026-11-09", events, accounts: ACCOUNTS, credited: creditedOf([week1]), previous: week1, voided: [], sanctioned: new Set(), guard: guardOf({ [pairKey(ALICE, P1)]: "PAYS" }), now: "2026-11-16T00:20:00Z" });
  assert.equal(week2.lines[0].refs.length, 2);
  assert.equal(week2.lines[0].accruedMicros, "10000000");
  /* Stopped: nothing, in any week. */
  const stopped = prepareStatement({ cluster: "devnet", week: "2026-11-09", events, accounts: ACCOUNTS, credited: creditedOf([week1]), previous: week1, voided: [], sanctioned: new Set(), guard: guardOf({ [pairKey(ALICE, P1)]: "STOPPED" }), now: "2026-11-16T00:20:00Z" });
  assert.equal(stopped.totals.accruedMicros, "0");
});

test("guard: a partner is paid nothing before their own first trade; the shares wait and count once they trade", () => {
  const people = [op(P1, "2026-11-03T10:00:00Z", 20)];
  const pairs = { [pairKey(ALICE, P1)]: "PAYS" };
  const before = feeEventsOf(people);
  assert.equal(week(before, { pairs: new Map(Object.entries(pairs)), traded: tradedBy(before, Date.parse("2026-11-09T00:20:00Z")) }).totals.accruedMicros, "0");
  const after = feeEventsOf([...people, op(ALICE, "2026-11-05T10:00:00Z", 0.5)]);
  const traded = tradedBy(after, Date.parse("2026-11-09T00:20:00Z"));
  assert.ok(traded.has(ALICE) && !traded.has(BOB));
  assert.equal(week(after, { pairs: new Map(Object.entries(pairs)), traded }).totals.accruedMicros, "8000000");
  /* A trade after the moment does not count yet. */
  assert.equal(tradedBy(after, Date.parse("2026-11-05T09:00:00Z")).has(ALICE), false);
});

test("guard: the pairs a pass asks about — uncredited operations of people a partner brought, never a self-referral", () => {
  const events = feeEventsOf([op(P1, "2026-11-03T10:00:00Z", 1), op(P1, "2026-11-04T10:00:00Z", 1), op(P3, "2026-11-04T10:00:00Z", 1), op(STRAY, "2026-11-04T10:00:00Z", 1), op(P2, "2026-10-20T10:00:00Z", 1)]);
  const pairs = pairsOf(events, ACCOUNTS, new Set([events[2].ref]), Date.parse("2026-11-09T00:00:00Z"));
  assert.deepEqual(pairs, [{ partner: ALICE, person: P1 }]);
});

test("guard on the store: the pass checks each pair — one person waits for review, two people pay, no key pays nobody", async () => {
  const { payoutPairEffects } = await import("../growth/referral-guard-store.ts");
  const { referralPairKey } = await import("../growth/referral-guard-store.ts");
  const at = "2026-11-09T00:20:00.000Z";
  const same = { clusters: { check: async () => ({ verdict: "same", reason: "shared_device", rules: "protect-1.0.0" }) } };
  const separate = { clusters: { check: async () => ({ verdict: "separate", rules: "protect-1.0.0" }) } };
  const pairs = [{ partner: ALICE, person: P1 }];
  const key = referralPairKey(ALICE, P1);
  assert.equal(key, pairKey(ALICE, P1), "one key for the guard and the payouts");

  const sameStore = createMemoryGuardStore();
  assert.equal((await payoutPairEffects(sameStore, pairs, at, same)).get(key), "WAITS");
  /* The quiet run after does not clear what a person has to look at. */
  assert.equal((await payoutPairEffects(sameStore, pairs, "2026-11-10T00:20:00.000Z", separate)).get(key), "WAITS");

  const clearStore = createMemoryGuardStore();
  assert.equal((await payoutPairEffects(clearStore, pairs, at, separate)).get(key), "PAYS");
  /* Asked again within the day, a clear pair is read, not checked. */
  let asked = 0;
  const counting = { clusters: { check: async () => { asked += 1; return { verdict: "separate", rules: "protect-1.0.0" }; } } };
  await payoutPairEffects(clearStore, pairs, "2026-11-09T06:20:00.000Z", counting);
  assert.equal(asked, 0);
  await payoutPairEffects(clearStore, pairs, "2026-11-10T06:20:00.000Z", counting);
  assert.equal(asked, 1);

  /* No signal key on the deployment: every pair waits and nobody is paid. */
  assert.equal((await payoutPairEffects(createMemoryGuardStore(), pairs, at, null)).get(key), "WAITS");
  /* A wallet is never its own partner. */
  assert.equal((await payoutPairEffects(createMemoryGuardStore(), [{ partner: ALICE, person: ALICE }], at, separate)).size, 0);
});

test("guard through a whole pass: the second own wallet's week pays nothing, the honest friend's pays", async () => {
  const store = createMemoryGuardStore();
  const { payoutPairEffects } = await import("../growth/referral-guard-store.ts");
  /* P1 is Alice's own second wallet (the cluster check says so); P3 is Bob's real friend. */
  const clusters = { check: async (trader) => (trader === P1 ? { verdict: "same", reason: "direct_funds", rules: "protect-1.0.0" } : { verdict: "separate", rules: "protect-1.0.0" }) };
  const operations = [...OWN(), op(P1, "2026-11-03T10:00:00Z", 50), op(P3, "2026-11-04T10:00:00Z", 20)];
  const deps = {
    store, cluster: "devnet", now: () => new Date("2026-11-09T00:20:00Z"), readOperations: async () => operations,
    readAccount: async (wallet) => ACCOUNTS.get(wallet) ?? null, screen: async () => "clear",
    pairs: (pairs, now) => payoutPairEffects(store, pairs, now, { clusters }),
  };
  await prepareWeeks(deps);
  const statement = await readStatement(store, "devnet", "2026-11-02");
  assert.deepEqual(statement.lines.map((line) => [line.partner, line.payMicros]), [[BOB, "8000000"]]);
  assert.equal(statement.totals.feeMicros, "20000000", "the reviewed pair's fee is not in the week");
});
