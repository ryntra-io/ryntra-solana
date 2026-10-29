import assert from "node:assert/strict";
import test from "node:test";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { readReserveLedger, heldUsdMicros } from "../rewards/reserve.ts";
import { accrueNetwork, checkNetworkLedger } from "./network-store.ts";
import { PARTNER_RULES_VERSION } from "./partner.ts";
import { readPartnerPage } from "./partner-page-store.ts";
import {
  canarySlotKey,
  claimPartnerPayout,
  observePayout,
  payoutSlotKey,
  planPartnerPayout,
  readPayoutGate,
  readPayoutSlot,
  readPayoutPause,
  readReceipts,
  sendCanaryPayout,
  setPayoutPause,
} from "./partner-payout.ts";
import { appendPoolShareRows } from "./pool-share-store.ts";
import { poolSubject, walletSubject } from "./review.ts";
import { actOnCase, raiseSignals } from "./review-store.ts";

const registry = ATTRIBUTION_REGISTRY;
const SAFE = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const PROTECTED = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
const POOL = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const POOL_2 = "AFoxY8SRfJ2SmCYNRWgXsMN27PpJyy2iUk2zGYsrXc7K";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const CREATOR = "6dNVSFwbC6RGDCyEXBuMBpBHVpPTGqJnGG8kk9EMXbLp";
const CREATOR_2 = "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T";
const PARTNER = "3EjkPWNaQmDLNKYAP6sHKZgLMxYPjQnfPdBbEjNzXZQL";
const TESTER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const TRADER = "TraderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const TX = "5".repeat(88);
const DAY = 86_400_000;
const T0 = "2026-10-20T00:00:00.000Z";
const at = (days, hours = 0) => new Date(Date.parse(T0) + days * DAY + hours * 3_600_000).toISOString();
const clean = { profileOf: async () => null, team: async () => new Set() };

async function bind(store, over = {}) {
  const row = {
    schema: 1, network: "solana", factory: PROTECTED, pool: POOL, creator: CREATOR, creationTx: TX, launchedAt: at(-1), partner: PARTNER, partnerCode: "BCDFGHJKLMNP",
    source: "inviter", decided: true, rulesVersion: PARTNER_RULES_VERSION, checks: { status: "measured", reasons: [], at: at(-1) }, recordedAt: at(-1), version: 1, ...over,
  };
  await store.collection("growthPoolPartners").set(`pool:${row.network}:${row.pool}`, row);
  await store.versioned("growthActivations").compareAndSet(`pool:${row.network}:${row.pool}`, null, {
    version: 1, network: row.network, pool: row.pool, creator: row.creator, activatedAt: at(-1), recordedAt: at(-1), rulesVersion: "protect-1.0.0",
    last: { at: at(-1), independent: 3, external: 3, unknown: 0, volumeUsdMicros: "3000000", teamVolumeUsdMicros: "0", insiderVolumeUsdMicros: "0", roundTripVolumeUsdMicros: "0", unvaluedTrades: 0, tradesComplete: true, partiesComplete: true, sharedSources: [] },
  });
  return row;
}

let serial = 0;
const claim = (when, usd, over = {}) => ({
  kind: "CLAIM", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, venuePool: null, config: PROTECTED, creator: CREATOR, source: "curve", claimer: SAFE,
  claim: { tx: `claim${++serial}`, index: "1.0", block: serial, at: when, finality: "finalized" },
  asset: { mint: USDC, symbol: "USDC", decimals: 6 }, claimedRaw: usd, receivedRaw: usd, tokenRaw: "0", rule: "ALL", usdMicros: usd,
  valuation: { basis: "STABLECOIN_PAR", price: null, sourceRef: null, observedAt: null }, allocation: null, recordedAt: when, ...over,
});
const stream1 = (when, usd) => ({
  kind: "STREAM1", schema: 1, network: "solana", chain: "solana:mainnet", pool: POOL, config: PROTECTED, venue: "curve", operationRef: `trade${++serial}`, trader: TRADER, entries: 2,
  usdMicros: usd, settledAt: when, recordedAt: when,
});
async function journal(store, rows) {
  const written = await appendPoolShareRows(store, rows);
  assert.equal(written.refused.length, 0, JSON.stringify(written.refused));
}

/**
 * A chain that answers as a test asks: every payout `pay` builds is broadcast and confirmed unless the test says
 * otherwise. `sent` is every broadcast, so a payout made twice shows as two.
 */
function chain({ treasury: start = 100_000_000n, outcome = "CONFIRMED" } = {}) {
  let treasury = start;
  const sent = [];
  const statuses = new Map();
  let mode = outcome;
  const reads = {
    readStatus: async (signature) => statuses.get(signature) ?? { seen: false },
    blockhashValid: async () => true,
  };
  return {
    sent,
    statuses,
    setOutcome: (next) => { mode = next; },
    setTreasury: (next) => { treasury = next; },
    deps: (now) => ({
      ...reads,
      clock: () => Date.parse(now),
      readTreasuryUsdMicros: async () => treasury,
      pay: async ({ wallet, usdMicros, beforeSubmit }) => {
        if (mode === "BUILD_FAILED") return { ok: false, code: "BUILD_FAILED", reason: "the build failed" };
        const signature = `payout${sent.length + 1}${"x".repeat(40)}`;
        const destination = `${wallet.slice(0, 40)}USDC`;
        if (!(await beforeSubmit({ signature, destination, blockhash: "B".repeat(44), lastValidBlockHeight: "100" }))) return { ok: false, code: "NOT_ARMED", reason: "not armed" };
        sent.push({ wallet, usdMicros, signature });
        if (mode === "CONFIRMED") statuses.set(signature, { seen: true, confirmationStatus: "confirmed", err: null });
        if (mode === "UNKNOWN") return { ok: false, code: "SUBMIT_UNKNOWN", reason: "timeout", signature, destination };
        return { ok: true, signature, destination };
      },
    }),
  };
}

const canary = (c, now = at(0)) => sendCanaryPayout(createdStore.current, c.deps(now), { wallet: TESTER, usdMicros: 1_500_000n, basis: "Canary GR-09: a voluntary test wallet", requestedBy: "admin:owner" });
const createdStore = { current: null };

/** A partner with $5.00 earned on one pool on day 1, available from day 15. */
async function earning(store, usd = "25000000") {
  await bind(store);
  await journal(store, [claim(at(0, 3), usd)]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
}

/* --------------------------------------------------------------------------------------------- canary */

test("before the canary nothing is paid; the canary is $1–2, once, and its paid receipt opens partner payouts", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  assert.deepEqual(await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER }), { state: "NOT_OPEN" }, "shadow accounting until the canary");
  assert.equal(c.sent.length, 0);

  for (const usdMicros of [999_999n, 2_000_001n]) {
    assert.deepEqual(await sendCanaryPayout(store, c.deps(at(16)), { wallet: TESTER, usdMicros, basis: "x", requestedBy: "admin" }), { state: "INVALID" });
  }
  assert.deepEqual(await sendCanaryPayout(store, c.deps(at(16)), { wallet: TESTER, usdMicros: 1_500_000n, basis: " ", requestedBy: "admin" }), { state: "INVALID" }, "the canary says why");
  const paid = await canary(c, at(16));
  assert.equal(paid.state, "PAID");
  assert.deepEqual(c.sent.map((row) => [row.wallet, row.usdMicros]), [[TESTER, 1_500_000n]]);
  const [receipt] = await readReceipts(store, "solana", TESTER);
  assert.equal(receipt.kind, "CANARY");
  assert.equal(receipt.usdMicros, "1500000");
  assert.equal(receipt.signature, c.sent[0].signature, "the receipt names the payout's transaction");
  assert.equal(receipt.basis, "Canary GR-09: a voluntary test wallet");
  assert.equal(receipt.requestedBy, "admin:owner");
  assert.deepEqual(receipt.lines, [], "the canary pays no line of the ledger");
  const gate = await readPayoutGate(store, "solana");
  assert.equal(gate.claimId, receipt.claimId);
  assert.deepEqual(await canary(c, at(16)), { state: "ALREADY_OPEN" }, "one canary, ever");
  assert.equal(c.sent.length, 1);
  /* The reserve hold of the canary is spent, not released. */
  const ledger = await readReserveLedger(store);
  assert.equal(ledger.holds.find((hold) => hold.claimId === receipt.claimId).state, "SETTLING");

  const claimed = await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER });
  assert.equal(claimed.state, "PAID", "after the canary's receipt the partner's claim is automatic");
  assert.equal(claimed.usdMicros, "5000000");
});

test("a canary whose build fails sends nothing and may be started again; one not yet confirmed opens nothing", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  const c = chain({ outcome: "BUILD_FAILED" });
  assert.equal((await canary(c)).state, "FAILED");
  assert.equal(c.sent.length, 0);
  assert.equal(heldUsdMicros(await readReserveLedger(store), at(0)), 0n, "a failed build gives the reserve back");
  assert.equal(await readPayoutGate(store, "solana"), null);
  c.setOutcome("UNKNOWN");
  assert.equal((await canary(c)).state, "SUBMITTED_UNKNOWN");
  assert.equal(await readPayoutGate(store, "solana"), null, "an unknown outcome opens nothing");
  assert.equal((await canary(c)).state, "SUBMITTED_UNKNOWN", "and starts no second canary");
  assert.equal(c.sent.length, 1);
  c.statuses.set(c.sent[0].signature, { seen: true, confirmationStatus: "finalized", err: null });
  const settled = await observePayout(store, c.deps(at(0)), canarySlotKey("solana"));
  assert.equal(settled.state, "PAID");
  assert.ok(await readPayoutGate(store, "solana"), "the receipt read back from the chain opens payouts");
});

/* --------------------------------------------------------------------------------------- the minimum */

test("the minimum is $1: below it nothing opens and nothing is held", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store, "4500000"); // $0.90
  const c = chain();
  await canary(c);
  assert.deepEqual(await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER }), { state: "NOT_CLAIMABLE", usdMicros: "900000" });
  assert.equal(await readPayoutSlot(store, payoutSlotKey("solana", PARTNER)), null);
  assert.equal(c.sent.length, 1, "only the canary was sent");
  /* Still in its hold, nothing is available at all. */
  assert.equal((await claimPartnerPayout(store, c.deps(at(5)), { wallet: PARTNER })).state, "NOT_CLAIMABLE");
});

/* ------------------------------------------------------------------------------------------- receipt */

test("the receipt: one line per line paid — pool, rules version, claim transaction, amount — and the payout's transaction; paid = Σ receipts", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await bind(store);
  await bind(store, { pool: POOL_2, creator: CREATOR_2 });
  await journal(store, [claim(at(0, 3), "10000000"), claim(at(0, 5), "15000000", { pool: POOL_2, creator: CREATOR_2 })]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  const c = chain();
  await canary(c);
  const out = await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER });
  assert.equal(out.state, "PAID");
  const receipts = (await readReceipts(store, "solana", PARTNER)).filter((row) => row.kind === "PARTNER");
  assert.equal(receipts.length, 1);
  const [receipt] = receipts;
  assert.equal(receipt.usdMicros, "5000000");
  assert.equal(receipt.signature, c.sent[1].signature);
  assert.deepEqual(receipt.lines.map((line) => [line.pool, line.rulesVersion, line.claim.source, line.usdMicros]), [
    [POOL, PARTNER_RULES_VERSION, "curve", "2000000"],
    [POOL_2, PARTNER_RULES_VERSION, "curve", "3000000"],
  ]);
  assert.ok(receipt.lines.every((line) => /^claim[0-9]+$/.test(line.claim.tx)), "each line names the claim it was earned from");
  /* The page reads paid from the receipts, and available after it. */
  const page = await readPartnerPage(store, { launchesOf: async () => [] }, { wallet: PARTNER, referral: null, now: at(16) });
  assert.deepEqual([page.money.paidUsdMicros, page.money.availableUsdMicros, page.money.payoutsOpen], ["5000000", "0", true]);
  assert.equal(page.payout.receipts.length, 1);
  assert.equal((await checkNetworkLedger(store, { registry })).ok, true, "a payout writes no entry of the shadow ledger");
});

/* -------------------------------------------------------------------------------------------- repeat */

test("repeat: a second claim after a paid one pays nothing; a claim still deciding is read back, never sent again", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  await canary(c);
  assert.equal((await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER })).state, "PAID");
  assert.deepEqual(await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER }), { state: "NOT_CLAIMABLE", usdMicros: "0" });
  assert.equal(c.sent.length, 2);

  const other = (createdStore.current = createMemoryGuardStore());
  await earning(other);
  const d = chain();
  await canary(d);
  d.setOutcome("UNKNOWN");
  const first = await claimPartnerPayout(other, d.deps(at(16)), { wallet: PARTNER });
  assert.equal(first.state, "SUBMITTED_UNKNOWN");
  for (let i = 0; i < 3; i += 1) assert.equal((await claimPartnerPayout(other, d.deps(at(16)), { wallet: PARTNER })).state, "SUBMITTED_UNKNOWN");
  assert.equal(d.sent.length, 2, "the canary and one payout — an unknown outcome is never sent again");
  const page = await readPartnerPage(other, { launchesOf: async () => [] }, { wallet: PARTNER, referral: null, now: at(16) });
  assert.equal(page.money.availableUsdMicros, "0", "money a payout still deciding is spoken for");
  d.statuses.set(d.sent[1].signature, { seen: true, confirmationStatus: "confirmed", err: null });
  assert.equal((await claimPartnerPayout(other, d.deps(at(16)), { wallet: PARTNER })).state, "PAID", "the next claim reads it back and stops there");
  assert.equal((await readReceipts(other, "solana", PARTNER)).filter((row) => row.kind === "PARTNER").length, 1);
});

test("two claims at once: one payout, one receipt", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  await canary(c);
  const results = await Promise.all([claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER }), claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER })]);
  assert.equal(results.filter((row) => row.state === "PAID").length, 1, JSON.stringify(results));
  assert.equal(c.sent.length, 2);
  assert.equal((await readReceipts(store, "solana", PARTNER)).filter((row) => row.kind === "PARTNER").length, 1);
});

test("a payout the chain refused is failed and its reserve given back; the next claim pays the same lines", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  await canary(c);
  c.setOutcome("UNKNOWN");
  assert.equal((await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER })).state, "SUBMITTED_UNKNOWN");
  c.statuses.set(c.sent[1].signature, { seen: true, confirmationStatus: "confirmed", err: { InstructionError: [1, "Custom"] } });
  assert.equal((await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER })).state, "FAILED");
  const failedId = (await readPayoutSlot(store, payoutSlotKey("solana", PARTNER))).claimId;
  assert.equal((await readReserveLedger(store)).holds.some((hold) => hold.claimId === failedId), false);
  c.setOutcome("CONFIRMED");
  const again = await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER });
  assert.deepEqual([again.state, again.usdMicros], ["PAID", "5000000"]);
});

/* ------------------------------------------------------------------------------------- сторно після виплати */

test("сторно after a payout: the line owes the difference back; it is netted on the next payout as a negative line, never paid twice and never taken from the wallet", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store); // $5.00 on line 1
  const c = chain();
  await canary(c);
  assert.equal((await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER })).usdMicros, "5000000");
  /* Stream 1 for a trade before the paid claim, written late: the line is lowered by $1.00 — after it was paid. */
  await journal(store, [stream1(at(0, 1), "5000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(17)) });
  let page = await readPartnerPage(store, { launchesOf: async () => [] }, { wallet: PARTNER, referral: null, now: at(17) });
  assert.deepEqual([page.money.availableUsdMicros, page.payout.debtUsdMicros], ["0", "1000000"], "a debt, shown to its owner, never a negative available");
  assert.deepEqual(await claimPartnerPayout(store, c.deps(at(17)), { wallet: PARTNER }), { state: "NOT_CLAIMABLE", usdMicros: "0" });

  /* A new claim of the pool earns $3.00; the next payout is $2.00 — the debt netted as a negative line. */
  await journal(store, [claim(at(18), "15000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(18, 1)) });
  const out = await claimPartnerPayout(store, c.deps(at(33)), { wallet: PARTNER });
  assert.deepEqual([out.state, out.usdMicros], ["PAID", "2000000"]);
  const second = (await readReceipts(store, "solana", PARTNER)).filter((row) => row.kind === "PARTNER")[1];
  assert.deepEqual(second.lines.map((line) => line.usdMicros), ["-1000000", "3000000"]);
  page = await readPartnerPage(store, { launchesOf: async () => [] }, { wallet: PARTNER, referral: null, now: at(33) });
  assert.deepEqual([page.money.paidUsdMicros, page.money.availableUsdMicros, page.payout.debtUsdMicros], ["7000000", "0", "0"]);
  /* Paid equals what the ledger holds: $4.00 + $3.00. */
  assert.equal(page.money.earnedUsdMicros, "7000000");
});

test("a pool found to be the partner's own after a payout owes all of it back — netted from another pool's next payout", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await bind(store);
  await bind(store, { pool: POOL_2, creator: CREATOR_2 });
  await journal(store, [claim(at(0, 3), "10000000")]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(1)) });
  const c = chain();
  await canary(c);
  assert.equal((await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER })).usdMicros, "2000000");
  /* The creator turns out to be the partner's own wallet: every line of the pool goes to zero. */
  await accrueNetwork(store, { profileOf: async (_family, wallet) => (wallet === CREATOR || wallet === PARTNER ? "profile-1" : null), team: async () => new Set() }, { registry, clock: () => Date.parse(at(17)) });
  await journal(store, [claim(at(18), "25000000", { pool: POOL_2, creator: CREATOR_2 })]);
  await accrueNetwork(store, clean, { registry, clock: () => Date.parse(at(18, 1)) });
  const out = await claimPartnerPayout(store, c.deps(at(33)), { wallet: PARTNER });
  assert.deepEqual([out.state, out.usdMicros], ["PAID", "3000000"], "$5.00 earned on the other pool, less the $2.00 owed back");
});

/* ---------------------------------------------------------------------------- suspicious: the GR-07 queue */

test("suspicious: a pool with a case open in the review queue is not paid; a frozen or stopped wallet opens no payout", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  await canary(c);
  await raiseSignals(store, { subject: poolSubject("solana", POOL), codes: ["S1_SHARED_FUNDING"], now: at(15) });
  assert.deepEqual(await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER }), { state: "NOT_CLAIMABLE", usdMicros: "0" }, "the pool's case holds its money");
  assert.equal(c.sent.length, 1);

  const other = (createdStore.current = createMemoryGuardStore());
  await earning(other);
  const d = chain();
  await canary(d);
  assert.equal((await actOnCase(other, { subject: walletSubject(PARTNER), action: { kind: "FREEZE", note: "Three wallets on one phone." }, by: "admin", now: at(15) })).ok, true);
  assert.deepEqual(await claimPartnerPayout(other, d.deps(at(16)), { wallet: PARTNER }), { state: "ON_REVIEW" });
  assert.equal(d.sent.length, 1, "only the canary");
});

/* --------------------------------------------------------------------------------------------- reserve */

test("the reserve: a payout is held against the same pot as cashback; short of $1 free nothing opens, otherwise the oldest lines first up to what is free", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  await canary(c);
  c.setTreasury(900_000n);
  assert.deepEqual(await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER }), { state: "RESERVE_SHORT", usdMicros: "5000000" });

  const other = (createdStore.current = createMemoryGuardStore());
  await earning(other);
  const d = chain();
  await canary(d);
  d.setTreasury(3_000_000n);
  const out = await claimPartnerPayout(other, d.deps(at(16)), { wallet: PARTNER });
  assert.deepEqual([out.state, out.usdMicros], ["PAID", "3000000"]);
  const page = await readPartnerPage(other, { launchesOf: async () => [] }, { wallet: PARTNER, referral: null, now: at(16) });
  assert.equal(page.money.availableUsdMicros, "2000000", "the rest waits for the reserve");
});

/* ------------------------------------------------------------------------------------------------ plan */

test("the plan is pure: payable pools give, a pool that may not pay only owes, debts first, the last line in part", () => {
  const entry = (pool, tx, usd, recordedAt = at(0)) => ({
    schema: 1, kind: "EARNED", reason: "CLAIM", partner: PARTNER, network: "solana", pool, factory: PROTECTED, creator: CREATOR,
    line: { tx, index: "1.0", source: "curve", at: recordedAt }, seq: 0, baseUsdMicros: "1", usdMicros: usd, rateBps: 2000, tier: "STANDARD", day: 1, rulesVersion: PARTNER_RULES_VERSION, recordedAt,
  });
  const entries = [entry(POOL, "a", "3000000"), entry(POOL, "b", "2000000", at(1)), entry(POOL_2, "c", "4000000")];
  const paidLine = (pool, tx, usd) => ({ network: "solana", pool, rulesVersion: PARTNER_RULES_VERSION, claim: { tx, index: "1.0", source: "curve", at: at(0) }, usdMicros: usd });
  const plan = planPartnerPayout({
    network: "solana",
    entries,
    pools: [{ network: "solana", pool: POOL, payable: true }, { network: "solana", pool: POOL_2, payable: false }],
    paid: [paidLine(POOL_2, "c", "5000000")],
    now: at(20),
    limitUsdMicros: 3_500_000n,
  });
  assert.equal(plan.claimableUsdMicros, 4_000_000n, "$5.00 from the payable pool, less $1.00 the other pool owes; its own $4.00 waits");
  assert.equal(plan.debtUsdMicros, 1_000_000n, "the debt is said even when this payout already nets it");
  assert.equal(plan.targetUsdMicros, 3_500_000n);
  assert.deepEqual(plan.lines.map((line) => [line.claim.tx, line.usdMicros]), [["a", "3000000"], ["c", "-1000000"], ["b", "1500000"]]);
  assert.equal(plan.lines.reduce((sum, line) => sum + BigInt(line.usdMicros), 0n), 3_500_000n);
  const owed = planPartnerPayout({ network: "solana", entries: [], pools: [], paid: [paidLine(POOL, "a", "1000000")], now: at(20) });
  assert.deepEqual([owed.claimableUsdMicros, owed.debtUsdMicros, owed.lines.length], [0n, 1_000_000n, 0]);
});

/* ------------------------------------------------------------------------------- critic round 1 */

test("the page offers only what the free reserve holds, as cashback does; an unreadable reserve offers nothing", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  await canary(c);
  const read = (free) => readPartnerPage(store, { launchesOf: async () => [] }, { wallet: PARTNER, referral: null, now: at(16), freeReserveUsdMicros: free });
  let page = await read(3_000_000n);
  assert.deepEqual([page.payout.claimableUsdMicros, page.payout.offerUsdMicros, page.payout.awaitingReserveUsdMicros, page.money.availableUsdMicros], ["5000000", "3000000", "2000000", "3000000"]);
  page = await read(null);
  assert.deepEqual([page.payout.offerUsdMicros, page.money.availableUsdMicros], ["0", "0"], "a reserve not read is never a promise");
  page = await read(9_000_000n);
  assert.equal(page.payout.offerUsdMicros, "5000000");
});

test("a held wallet is told so before any button; the owner's pause stops partner payouts alone", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  await canary(c);
  assert.equal(await setPayoutPause(store, { network: "solana", paused: true, note: " ", by: "admin", at: at(15) }), false, "a pause says why");
  assert.equal(await setPayoutPause(store, { network: "solana", paused: true, note: "Checking the treasury.", by: "admin:owner", at: at(15) }), true);
  assert.deepEqual(await claimPartnerPayout(store, c.deps(at(16)), { wallet: PARTNER }), { state: "PAUSED" });
  let page = await readPartnerPage(store, { launchesOf: async () => [] }, { wallet: PARTNER, referral: null, now: at(16) });
  assert.equal(page.payout.paused, true);
  assert.equal(await setPayoutPause(store, { network: "solana", paused: false, note: "Treasury checked.", by: "admin:owner", at: at(16) }), true);
  await actOnCase(store, { subject: walletSubject(PARTNER), action: { kind: "FREEZE", note: "Look." }, by: "admin", now: at(16) });
  page = await readPartnerPage(store, { launchesOf: async () => [] }, { wallet: PARTNER, referral: null, now: at(16, 1) });
  assert.deepEqual([page.payout.paused, page.payout.hold], [false, "REVIEW"]);
  assert.equal(c.sent.length, 1, "only the canary");
  /* A pause row this build cannot read pauses. */
  await store.versioned("growthPartnerPayouts").compareAndSet("pause:solana", 1, { junk: true, version: 2 });
  assert.equal((await readPayoutPause(store, "solana")).paused, true);
});

test("sanctions: a wallet the source lists is held, never paid; a screening that did not answer pays", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  await earning(store);
  const c = chain();
  await canary(c);
  const listed = { ...c.deps(at(16)), screen: async () => "sanctioned" };
  assert.deepEqual(await claimPartnerPayout(store, listed, { wallet: PARTNER }), { state: "ON_REVIEW" });
  assert.equal(c.sent.length, 1);
  const down = { ...c.deps(at(16)), screen: async () => { throw new Error("source down"); } };
  assert.equal((await claimPartnerPayout(store, down, { wallet: PARTNER })).state, "PAID");
});

test("the canary never goes to the treasury or an address of the registry; any gate row already there stops it", async () => {
  const store = (createdStore.current = createMemoryGuardStore());
  const c = chain();
  const forbidden = new Set([TESTER]);
  assert.deepEqual(await sendCanaryPayout(store, c.deps(at(0)), { wallet: TESTER, usdMicros: 1_500_000n, basis: "x", requestedBy: "admin", forbidden }), { state: "INVALID" });
  assert.equal(c.sent.length, 0);
  /* A damaged gate row: payouts stay closed, and no canary is sent over it — the owner looks at the row first. */
  await store.versioned("growthPartnerPayouts").compareAndSet("gate:solana", null, { junk: true, version: 0 });
  assert.equal(await readPayoutGate(store, "solana"), null);
  assert.deepEqual(await canary(c), { state: "ALREADY_OPEN" });
  assert.equal(c.sent.length, 0);
});

test("one receipt carries at most 400 lines; the rest is paid by the next payout", () => {
  const entries = Array.from({ length: 450 }, (_, i) => ({
    schema: 1, kind: "EARNED", reason: "CLAIM", partner: PARTNER, network: "solana", pool: POOL, factory: PROTECTED, creator: CREATOR,
    line: { tx: `t${i}`, index: "1.0", source: "curve", at: at(0) }, seq: 0, baseUsdMicros: "1", usdMicros: "10000", rateBps: 2000, tier: "STANDARD", day: 1, rulesVersion: PARTNER_RULES_VERSION, recordedAt: at(0),
  }));
  const plan = planPartnerPayout({ network: "solana", entries, pools: [{ network: "solana", pool: POOL, payable: true }], paid: [], now: at(20) });
  assert.equal(plan.claimableUsdMicros, 4_500_000n);
  assert.equal(plan.lines.length, 400);
  assert.equal(plan.targetUsdMicros, 4_000_000n);
  const next = planPartnerPayout({ network: "solana", entries, pools: [{ network: "solana", pool: POOL, payable: true }], paid: plan.lines, now: at(20) });
  assert.deepEqual([next.lines.length, next.targetUsdMicros], [50, 500_000n]);
});
