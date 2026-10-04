// Run from repo root: node --test lib/autoinvest/payments.test.mjs
/**
 * «З кожної оплати»: the third kind of «Автоінвест» rule takes its share of
 * the wallet's own USDC payments and incoming transfers on Solana — a
 * round-up to $1 or $5, a sum from every payment, a per cent of what comes
 * in — and reminds once the sum reaches the minimum. What an event is and what never is (a swap, Ryntra's
 * own purchase, a bridge, a transfer between the person's own accounts), the
 * round-up, the per cent, each event once, the queue, the budget, the price
 * condition, the order route, the watch, the chain read, the tick and the
 * words. A memory store, a fixed clock, transactions built as the chain
 * states them; nothing reaches a network or a wallet.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AutoinvestRuleSchema, RuleCreateRequestSchema, RulePaymentsRequestSchema } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { listInbox, outboxOf, preferencesOf } from "../monitoring/store.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import { chainTransaction, fixtureAddress, fixtureSignature, usdc, usdcTransfer } from "./payment-fixtures.ts";
import { foldMovements, freshWatch, markOwnAccount, readPaymentWatch, refreshPaymentWatch, ryntraSignaturesOf, writePaymentWatch } from "./payment-watch.ts";
import { advanceRule, gatherPayments, judgeRuleOrder, releaseOwnEvents, usdToUsdcRaw } from "./model.ts";
import { classifyMovement, cleanMemo, contributionCents, PAYMENTS_USDC_MINT } from "./payments.ts";
import { readUsdcMovements } from "./payments-chain.server.ts";
import { createRule, listRules, markOwnPaymentAccount, setBudget, setRuleStatus } from "./service.ts";
import { readRule } from "./store.ts";
import { tickAutoinvest } from "./tick.ts";
import { eventsCountWord, paymentsLine, paymentsReminderWords, pctWord, ruleWhenLine } from "./words.ts";

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const OWNER_USDC = fixtureAddress("the owner's USDC account");
const OWNER_SECOND_USDC = fixtureAddress("the owner's second USDC account");
const SHOP = fixtureAddress("a shop");
const SHOP_USDC = fixtureAddress("the shop's USDC account");
const FRIEND = fixtureAddress("a friend");
const FRIEND_USDC = fixtureAddress("the friend's USDC account");
const OWN_OTHER_WALLET = fixtureAddress("the owner's other wallet");
const OWN_OTHER_USDC = fixtureAddress("the owner's other wallet's USDC account");
const POOL = fixtureAddress("a pool");
const POOL_USDC = fixtureAddress("the pool's USDC account");
const POOL_AAPLX = fixtureAddress("the pool's AAPLx account");
const OWNER_AAPLX = fixtureAddress("the owner's AAPLx account");
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const RULE_ID = "rule_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const KYIV = "Europe/Kyiv";
const MINUTE = 60_000;
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
/* Wednesday 16 September 2026, 10:00 in Kyiv — the rule is turned on. */
const SINCE = Date.parse("2026-09-16T07:00:00.000Z");
const sec = (ms) => Math.floor(ms / 1000);
const ROUNDUP_1 = { mode: "roundup", roundToUsd: 1, fixedUsd: null, percent: null };

/** The owner pays `amountUsd` to the shop at `atMs`. */
function payment(seed, amountUsd, atMs, { slot = 1000, memo, before = 100, to = SHOP, toAccount = SHOP_USDC } = {}) {
  return usdcTransfer({ signature: fixtureSignature(seed), slot, blockTime: sec(atMs), from: OWNER, fromAccount: OWNER_USDC, fromBefore: before, to, toAccount, toBefore: 10, amountUsd, memo });
}

/** A friend sends the owner `amountUsd` at `atMs`. */
function incoming(seed, amountUsd, atMs, { slot = 1000, before = 100 } = {}) {
  return usdcTransfer({ signature: fixtureSignature(seed), slot, blockTime: sec(atMs), from: FRIEND, fromAccount: FRIEND_USDC, fromBefore: 500, to: OWNER, toAccount: OWNER_USDC, toBefore: before, amountUsd });
}

function appleRow() {
  return {
    representation: {
      mint: AAPLX,
      symbol: "AAPLx",
      name: "Apple xStock",
      issuer: { id: "xstocks", label: "xStocks" },
      underlying: { symbol: "AAPL", name: "Apple Inc." },
      decimals: 8,
      instrument: { class: "listed-equity", unitBasis: "share" },
      tradingHalted: false,
    },
    lifecycle: { tradable: true },
    market: { priceUsd: 230, observedAt: iso(SINCE) },
    multiplier: { current: 1, pending: null, effectiveAt: null },
  };
}

const deps = (atMs, extra = {}) => ({
  now: () => new Date(atMs),
  findRow: async () => ({ ok: true, row: appleRow(), universe: null }),
  lifecycle: () => null,
  ruleId: () => RULE_ID,
  ledger: async () => [],
  usdcAccount: async () => OWNER_USDC,
  ...extra,
});

/** A watch view as the tick hands it to a rule. */
function watchOf(events, ownAccounts = []) {
  return { events, ownAccounts };
}

function watchEvent(seq, tx, overrides = {}) {
  const verdict = classifyMovement(tx, OWNER, OWNER_USDC);
  assert.ok(verdict.counted, `fixture ${seq} is an event`);
  return {
    seq,
    signature: tx.signature,
    slot: tx.slot,
    at: iso(tx.blockTime * 1000),
    direction: verdict.movement.direction,
    amountMicro: verdict.movement.amountMicro.toString(),
    counterparty: verdict.movement.counterparty,
    memo: verdict.movement.memo,
    ...overrides,
  };
}

async function writtenRule(store, terms = ROUNDUP_1, { amountUsd = 1, priceCondition = null, at = SINCE } = {}) {
  const created = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd, kind: "payments", payments: { ...terms, timeZone: KYIV }, priceCondition, locale: "uk" }, deps(at));
  assert.ok(created.ok, created.ok ? "" : created.message);
  const record = await readRule(store, OWNER, RULE_ID);
  assert.ok(record);
  return record;
}

/* ------------------------------------------------------------------ what an event is */

test("a payment is the wallet's USDC to another owner, signed by the wallet — the sum, the other side and the Solana Pay label", () => {
  const verdict = classifyMovement(payment("pay", 3.4, SINCE + HOUR, { memo: "Order 4821" }), OWNER, OWNER_USDC);
  assert.ok(verdict.counted);
  assert.deepEqual(verdict.movement, { direction: "out", amountMicro: 3_400_000n, counterparty: SHOP, memo: "Order 4821" });
});

test("money that came in is USDC from another owner the wallet did not sign for", () => {
  const verdict = classifyMovement(incoming("in", 50, SINCE + HOUR), OWNER, OWNER_USDC);
  assert.ok(verdict.counted);
  assert.deepEqual(verdict.movement, { direction: "in", amountMicro: 50_000_000n, counterparty: FRIEND, memo: null });
});

test("a swap is never a payment — another token of the wallet moved, or the wallet came out with more SOL", () => {
  const intoApple = chainTransaction({
    signature: fixtureSignature("swap into Apple"),
    slot: 2000,
    blockTime: sec(SINCE + HOUR),
    signers: [OWNER],
    tokens: [
      { address: OWNER_USDC, owner: OWNER, before: usdc(100), after: usdc(90) },
      { address: POOL_USDC, owner: POOL, before: usdc(10_000), after: usdc(10_010) },
      { address: OWNER_AAPLX, owner: OWNER, mint: AAPLX, before: 0n, after: 4_300_000n },
      { address: POOL_AAPLX, owner: POOL, mint: AAPLX, before: 1_000_000_000n, after: 995_700_000n },
    ],
  });
  assert.deepEqual(classifyMovement(intoApple, OWNER, OWNER_USDC), { counted: false, reason: "swap" });
  const intoSol = chainTransaction({
    signature: fixtureSignature("swap into SOL"),
    slot: 2001,
    blockTime: sec(SINCE + HOUR),
    signers: [OWNER],
    tokens: [
      { address: OWNER_USDC, owner: OWNER, before: usdc(100), after: usdc(80) },
      { address: POOL_USDC, owner: POOL, before: usdc(10_000), after: usdc(10_020) },
    ],
    lamports: { [OWNER]: 130_000_000 },
  });
  assert.deepEqual(classifyMovement(intoSol, OWNER, OWNER_USDC), { counted: false, reason: "sol-in" });
});

test("a transfer between the wallet's own accounts, a bridge's burn and its arrival are never events", () => {
  const between = chainTransaction({
    signature: fixtureSignature("between own accounts"),
    slot: 2002,
    blockTime: sec(SINCE + HOUR),
    signers: [OWNER],
    tokens: [
      { address: OWNER_USDC, owner: OWNER, before: usdc(100), after: usdc(60) },
      { address: OWNER_SECOND_USDC, owner: OWNER, before: usdc(0), after: usdc(40) },
    ],
  });
  assert.deepEqual(classifyMovement(between, OWNER, OWNER_USDC), { counted: false, reason: "own" });
  const burn = chainTransaction({ signature: fixtureSignature("bridge burn"), slot: 2003, blockTime: sec(SINCE + HOUR), signers: [OWNER], tokens: [{ address: OWNER_USDC, owner: OWNER, before: usdc(100), after: usdc(75) }] });
  assert.deepEqual(classifyMovement(burn, OWNER, OWNER_USDC), { counted: false, reason: "no-counterparty" });
  const arrival = chainTransaction({ signature: fixtureSignature("bridge arrival"), slot: 2004, blockTime: sec(SINCE + HOUR), signers: [FRIEND], tokens: [{ address: OWNER_USDC, owner: OWNER, before: usdc(75), after: usdc(100) }] });
  assert.deepEqual(classifyMovement(arrival, OWNER, OWNER_USDC), { counted: false, reason: "no-counterparty" });
});

test("USDC that arrives in a transaction the wallet signed is the person's own act; USDC that leaves without its signature is a delegate's; under a cent nothing; a failed transaction nothing", () => {
  const withdrawal = usdcTransfer({ signature: fixtureSignature("a withdrawal"), slot: 2005, blockTime: sec(SINCE + HOUR), from: POOL, fromAccount: POOL_USDC, fromBefore: 1000, to: OWNER, toAccount: OWNER_USDC, toBefore: 1, amountUsd: 20, feePayer: OWNER });
  assert.deepEqual(classifyMovement(withdrawal, OWNER, OWNER_USDC), { counted: false, reason: "signed-inflow" });
  const delegated = usdcTransfer({ signature: fixtureSignature("a delegate's transfer"), slot: 2006, blockTime: sec(SINCE + HOUR), from: OWNER, fromAccount: OWNER_USDC, fromBefore: 100, to: SHOP, toAccount: SHOP_USDC, toBefore: 1, amountUsd: 5 });
  const unsigned = { ...delegated, accountKeys: delegated.accountKeys.map((key) => ({ ...key, signer: key.pubkey === SHOP })) };
  assert.deepEqual(classifyMovement(unsigned, OWNER, OWNER_USDC), { counted: false, reason: "not-signed" });
  assert.deepEqual(classifyMovement(payment("dust", 0.004, SINCE + HOUR), OWNER, OWNER_USDC), { counted: false, reason: "dust" });
  assert.deepEqual(classifyMovement({ ...payment("failed", 3, SINCE + HOUR), failed: true }, OWNER, OWNER_USDC), { counted: false, reason: "failed" });
});

test("a balance the chain states without its owner is still the wallet's when it is the wallet's own account", () => {
  const tx = payment("ownerless", 3.4, SINCE + HOUR);
  const stripped = { ...tx, preTokenBalances: tx.preTokenBalances.map(({ owner, ...rest }) => (owner === OWNER ? rest : { ...rest, owner })), postTokenBalances: tx.postTokenBalances.map(({ owner, ...rest }) => (owner === OWNER ? rest : { ...rest, owner })) };
  assert.equal(classifyMovement(stripped, OWNER, OWNER_USDC).counted, true);
  assert.deepEqual(classifyMovement(stripped, OWNER, null), { counted: false, reason: "no-usdc" });
});

test("the Solana Pay label is cleaned: invisible characters out, whitespace collapsed, at most 64 characters", () => {
  assert.equal(cleanMemo("  Order\u0000 4821\n  "), "Order 4821");
  assert.equal(cleanMemo("\u200b\u202e"), null);
  assert.equal(cleanMemo(null), null);
  const long = cleanMemo("x".repeat(100));
  assert.equal(long.length, 64);
  assert.ok(long.endsWith("…"));
});

/* ------------------------------------------------------------------ what a rule takes */

test("the round-up to $1: $3.40 → $0.60, $2.30 → $0.70, together $1.30; a payment on the dollar rounds up nothing", () => {
  const out = (amount) => ({ direction: "out", amountMicro: usdc(amount) });
  assert.equal(contributionCents(ROUNDUP_1, out(3.4)), 60);
  assert.equal(contributionCents(ROUNDUP_1, out(2.3)), 70);
  assert.equal(contributionCents(ROUNDUP_1, out(3.4)) + contributionCents(ROUNDUP_1, out(2.3)), 130);
  assert.equal(contributionCents(ROUNDUP_1, out(4)), 0);
  assert.equal(contributionCents(ROUNDUP_1, { direction: "out", amountMicro: 3_456_789n }), 54, "$0.543211 is 54 cents, half up");
  assert.equal(contributionCents(ROUNDUP_1, { direction: "in", amountMicro: usdc(3.4) }), 0, "money that came in is not a payment");
});

test("the round-up to $5, a fixed sum from every payment and a per cent of what comes in", () => {
  const five = { mode: "roundup", roundToUsd: 5, fixedUsd: null, percent: null };
  assert.equal(contributionCents(five, { direction: "out", amountMicro: usdc(3.4) }), 160);
  assert.equal(contributionCents(five, { direction: "out", amountMicro: usdc(2.3) }), 270);
  assert.equal(contributionCents(five, { direction: "out", amountMicro: usdc(10) }), 0);
  const fixed = { mode: "fixed", roundToUsd: null, fixedUsd: 2, percent: null };
  assert.equal(contributionCents(fixed, { direction: "out", amountMicro: usdc(0.5) }), 200, "$2 from every payment, whatever its size");
  assert.equal(contributionCents(fixed, { direction: "in", amountMicro: usdc(50) }), 0);
  const tenth = { mode: "percent", roundToUsd: null, fixedUsd: null, percent: 10 };
  assert.equal(contributionCents(tenth, { direction: "in", amountMicro: usdc(50) }), 500);
  assert.equal(contributionCents(tenth, { direction: "in", amountMicro: 12_345_678n }), 123);
  assert.equal(contributionCents(tenth, { direction: "out", amountMicro: usdc(50) }), 0, "a payment is not money that came in");
  assert.equal(contributionCents(tenth, { direction: "in", amountMicro: 9_000n }), 0, "under a cent is no event");
});

/* ------------------------------------------------------------------ the rule: gather, once, remind */

test("two payments gather $0.60 then $1.30 — one reminder «З оплат: $1,30 → Apple» on exactly that sum; the same events again add nothing", async () => {
  const store = createMemoryGuardStore();
  const record = await writtenRule(store);
  assert.equal(record.kind, "payments");
  const first = watchEvent(1, payment("3.40", 3.4, SINCE + 4 * HOUR, { memo: "Order 4821" }));
  const second = watchEvent(2, payment("2.30", 2.3, SINCE + 8 * HOUR, { slot: 1100, before: 96.6 }));

  const one = advanceRule(record, { rows: [], remainingUsd: null, payments: watchOf([first]) }, SINCE + 4 * HOUR + 5 * MINUTE);
  assert.equal(one.remind, null);
  assert.deepEqual([one.record.payments.gatheredCents, one.record.payments.gatheredCount, one.record.payments.lastSeq], [60, 1, 1]);
  assert.equal(one.record.payments.events[0].label, "Order 4821");

  const afterOne = { ...record, ...one.record, version: record.version + 1 };
  const again = advanceRule(afterOne, { rows: [], remainingUsd: null, payments: watchOf([first]) }, SINCE + 4 * HOUR + 10 * MINUTE);
  assert.equal(again.changed, false, "an event already taken is never taken twice");

  const twoAt = SINCE + 8 * HOUR + 5 * MINUTE;
  const two = advanceRule(afterOne, { rows: [], remainingUsd: null, payments: watchOf([first, second]) }, twoAt);
  assert.ok(two.remind, "the sum reached the dollar");
  assert.deepEqual([two.remind.state, two.remind.amountUsd, two.remind.events, two.remind.dueAt, two.remind.openUntil], ["due", 1.3, 2, iso(twoAt), iso(twoAt + 24 * HOUR)]);
  assert.deepEqual([two.record.payments.gatheredCents, two.record.payments.gatheredCount], [0, 0], "what the reminder took waits no more");
  assert.ok(two.record.payments.events.every((event) => event.dueAt === iso(twoAt)));
});

test("events before the rule was turned on, to or from the person's own accounts, or of the other direction add nothing — and each still moves the rule past it", async () => {
  const store = createMemoryGuardStore();
  const record = await writtenRule(store);
  const before = watchEvent(1, payment("before", 3.4, SINCE - HOUR));
  const own = watchEvent(2, payment("to my other wallet", 2.3, SINCE + HOUR, { to: OWN_OTHER_WALLET, toAccount: OWN_OTHER_USDC }));
  const cameIn = watchEvent(3, incoming("came in", 40, SINCE + 2 * HOUR));
  const step = advanceRule(record, { rows: [], remainingUsd: null, payments: watchOf([before, own, cameIn], [OWN_OTHER_WALLET]) }, SINCE + 3 * HOUR);
  assert.deepEqual([step.record.payments.gatheredCents, step.record.payments.lastSeq, step.remind], [0, 3, null]);
});

test("a paused rule gathers nothing; turned on again, it counts from then", async () => {
  const store = createMemoryGuardStore();
  await writtenRule(store);
  const paused = await setRuleStatus(store, OWNER, RULE_ID, "paused", deps(SINCE + HOUR));
  assert.ok(paused.ok);
  const record = await readRule(store, OWNER, RULE_ID);
  const during = watchEvent(1, payment("during the pause", 3.4, SINCE + 2 * HOUR));
  const step = advanceRule(record, { rows: [], remainingUsd: null, payments: watchOf([during]) }, SINCE + 2 * HOUR + MINUTE);
  assert.equal(step.changed, false);
  const resumed = await setRuleStatus(store, OWNER, RULE_ID, "active", deps(SINCE + 3 * HOUR));
  assert.ok(resumed.ok);
  assert.equal(resumed.rule.payments.since, iso(SINCE + 3 * HOUR));
  const back = await readRule(store, OWNER, RULE_ID);
  const next = advanceRule(back, { rows: [], remainingUsd: null, payments: watchOf([during]) }, SINCE + 3 * HOUR + MINUTE);
  assert.equal(next.record.payments.gatheredCents, 0, "the pause's payment is not the rule's");
});

test("one reminder at a time: what gathers while one is open waits for the next; a reminder nobody bought is missed and never gathered again", async () => {
  const store = createMemoryGuardStore();
  const record = await writtenRule(store);
  const events = [watchEvent(1, payment("a", 3.4, SINCE + HOUR)), watchEvent(2, payment("b", 2.3, SINCE + 2 * HOUR, { slot: 1100 }))];
  const openedAt = SINCE + 2 * HOUR + MINUTE;
  const opened = advanceRule(record, { rows: [], remainingUsd: null, payments: watchOf(events) }, openedAt);
  assert.ok(opened.remind);
  const withOpen = { ...record, ...opened.record, version: 2 };
  const third = watchEvent(3, payment("c", 1.5, SINCE + 3 * HOUR, { slot: 1200 }));
  const while1 = advanceRule(withOpen, { rows: [], remainingUsd: null, payments: watchOf([...events, third]) }, SINCE + 3 * HOUR + MINUTE);
  assert.equal(while1.remind, null, "no second reminder while one is open");
  assert.deepEqual([while1.record.payments.gatheredCents, while1.record.occurrences.length], [50, 1]);
  /* A day later, nobody bought: the reminder is missed; the $0.50 that came after it waits for its own minimum. */
  const later = { ...withOpen, ...while1.record, version: 3 };
  const dayAfter = advanceRule(later, { rows: [], remainingUsd: null, payments: watchOf([...events, third]) }, openedAt + 25 * HOUR);
  assert.equal(dayAfter.record.occurrences[0].state, "missed");
  assert.equal(dayAfter.remind, null);
  assert.equal(dayAfter.record.payments.gatheredCents, 50, "the missed $1.30 is not gathered again");
});

test("the month's budget: a sum it does not cover is held — nothing reminded, nothing carried", async () => {
  const store = createMemoryGuardStore();
  const record = await writtenRule(store);
  const events = [watchEvent(1, payment("a", 3.4, SINCE + HOUR)), watchEvent(2, payment("b", 2.3, SINCE + 2 * HOUR, { slot: 1100 }))];
  const step = advanceRule(record, { rows: [], remainingUsd: 1, payments: watchOf(events) }, SINCE + 2 * HOUR + MINUTE);
  assert.equal(step.remind, null);
  assert.equal(step.held, true);
  assert.deepEqual([step.record.occurrences[0].state, step.record.occurrences[0].amountUsd, step.record.payments.gatheredCents], ["held", 1.3, 0]);
  const unknown = advanceRule(record, { rows: [], remainingUsd: null, budgetUnknown: true, payments: watchOf(events) }, SINCE + 2 * HOUR + MINUTE);
  assert.deepEqual([unknown.record.occurrences.length, unknown.record.payments.gatheredCents], [0, 130], "a spend nobody could read opens nothing; the sum waits");
});

test("the price condition: not met, the gathered purchase is deferred and says why; met on a later pass, it reminds", async () => {
  const store = createMemoryGuardStore();
  const record = await writtenRule(store, ROUNDUP_1, { priceCondition: { limitPct: 5 } });
  const events = [watchEvent(1, payment("a", 3.4, SINCE + HOUR)), watchEvent(2, payment("b", 2.3, SINCE + 2 * HOUR, { slot: 1100 }))];
  const at = SINCE + 2 * HOUR + MINUTE;
  const facts = (priceUsd) => ({ reference: "issuer", priceUsd, priceAtMs: at, referenceUsd: 200, referenceAtMs: at, referenceStale: false });
  const above = advanceRule(record, { rows: [], remainingUsd: null, payments: watchOf(events), market: { price: null, multiplier: 1, condition: facts(230) } }, at);
  assert.equal(above.remind, null);
  assert.ok(above.defer);
  assert.deepEqual([above.defer.state, above.defer.amountUsd, above.defer.condition.verdict], ["deferred", 1.3, "above"]);
  const waiting = { ...record, ...above.record, version: 2 };
  const within = advanceRule(waiting, { rows: [], remainingUsd: null, payments: watchOf(events), market: { price: null, multiplier: 1, condition: { ...facts(204), priceAtMs: at + 5 * MINUTE, referenceAtMs: at + 5 * MINUTE } } }, at + 5 * MINUTE);
  assert.ok(within.remind);
  assert.deepEqual([within.remind.state, within.remind.amountUsd], ["due", 1.3]);
});

test("the order route buys exactly what the reminder gathered: $1.30, never the rule's $1 minimum", async () => {
  const store = createMemoryGuardStore();
  const record = await writtenRule(store);
  const events = [watchEvent(1, payment("a", 3.4, SINCE + HOUR)), watchEvent(2, payment("b", 2.3, SINCE + 2 * HOUR, { slot: 1100 }))];
  const at = SINCE + 2 * HOUR + MINUTE;
  const opened = advanceRule(record, { rows: [], remainingUsd: null, payments: watchOf(events) }, at);
  const withOpen = { ...record, ...opened.record, version: 2 };
  const binding = { ruleId: RULE_ID, dueAt: iso(at) };
  const order = (amountUsd) => ({ inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: AAPLX, amountRaw: usdToUsdcRaw(amountUsd) });
  assert.equal(judgeRuleOrder(withOpen, binding, order(1), [], at + MINUTE).code, "RULE_MISMATCH");
  assert.equal(judgeRuleOrder(withOpen, binding, order(1.3), [], at + MINUTE).ok, true);
  assert.equal(judgeRuleOrder(withOpen, binding, order(1.3), [], at + MINUTE, 1).code, "RULE_BUDGET_EXHAUSTED");
});

test("«це мій рахунок» takes a waiting event out of the sum; one a reminder took stays with it", () => {
  const payments = {
    mode: "roundup",
    roundToUsd: 1,
    fixedUsd: null,
    percent: null,
    timeZone: KYIV,
    since: iso(SINCE),
    lastSeq: 3,
    gatheredCents: 90,
    gatheredCount: 2,
    events: [
      { seq: 1, signature: fixtureSignature("taken"), direction: "out", amountUsd: 3.4, addCents: 60, at: iso(SINCE + HOUR), label: null, dueAt: iso(SINCE + 2 * HOUR) },
      { seq: 2, signature: fixtureSignature("waiting mine"), direction: "out", amountUsd: 2.3, addCents: 70, at: iso(SINCE + 3 * HOUR), label: null, dueAt: null },
      { seq: 3, signature: fixtureSignature("waiting shop"), direction: "out", amountUsd: 4.8, addCents: 20, at: iso(SINCE + 4 * HOUR), label: null, dueAt: null },
    ],
  };
  const released = releaseOwnEvents(payments, new Set([fixtureSignature("waiting mine"), fixtureSignature("taken")]));
  assert.equal(released.changed, true);
  assert.deepEqual([released.payments.gatheredCents, released.payments.gatheredCount, released.payments.events.length], [20, 1, 2]);
  assert.equal(releaseOwnEvents(payments, new Set([fixtureSignature("nothing")])).changed, false);
});

test("gathering lists every waiting event and the last twelve a reminder took; an unlisted waiting event still counts", () => {
  const base = { mode: "fixed", roundToUsd: null, fixedUsd: 0.1, percent: null, timeZone: KYIV, since: iso(SINCE), lastSeq: 0, gatheredCents: 0, gatheredCount: 0, events: [] };
  const many = Array.from({ length: 120 }, (_, index) => watchEvent(index + 1, payment(`small ${index}`, 0.5, SINCE + (index + 1) * MINUTE, { slot: 5000 + index })));
  const gathered = gatherPayments(base, watchOf(many));
  assert.deepEqual([gathered.payments.gatheredCents, gathered.payments.gatheredCount, gathered.payments.events.length], [1200, 120, 100]);
});

/* ------------------------------------------------------------------ the watch */

test("the watch numbers each event once, leaves out Ryntra's own swaps and what it read before, and says when a read could not prove itself", () => {
  const base = freshWatch(OWNER, OWNER_USDC, SINCE);
  const pay = payment("watched", 3.4, SINCE + HOUR, { slot: 3000 });
  const ryntra = payment("ryntra's own", 2.3, SINCE + HOUR, { slot: 3001 });
  const read = { ok: true, transactions: [pay, ryntra], cursor: { signature: ryntra.signature, slot: 3001 }, balanceRaw: "94300000", complete: true, more: false, hosts: ["test"] };
  const folded = foldMovements(base, read, new Set([ryntra.signature]), SINCE + HOUR + MINUTE);
  assert.deepEqual(folded.events.map((event) => [event.seq, event.signature, event.amountMicro]), [[1, pay.signature, "3400000"]]);
  assert.deepEqual([folded.nextSeq, folded.readState, folded.cursor.slot], [2, "ok", 3001]);
  const twice = foldMovements(folded, read, null, SINCE + HOUR + 2 * MINUTE);
  assert.equal(twice.events.length, 1, "a transaction read before is never numbered again");
  assert.equal(foldMovements(folded, { ...read, transactions: [], complete: false }, null, SINCE + 2 * HOUR).readState, "partial");
  assert.equal(foldMovements(folded, { ok: false, reason: "down" }, null, SINCE + 2 * HOUR).readState, "unavailable");
  const ownRows = ryntraSignaturesOf([{ lane: "SWAP", signature: "s1" }, { lane: "SEND", signature: "s2" }, { lane: "BRIDGE", signature: "s3" }, { lane: "CROSS_SWAP", signature: "s4" }, { lane: "RECEIVE", signature: "s5" }]);
  assert.deepEqual([...ownRows].sort(), ["s1", "s3", "s4"], "a send and a receive through Ryntra are payments; its swaps and bridges are not");
});

test("«це мій рахунок» names an event's other side on the watch; the route's service takes it out of every rule's sum", async () => {
  const store = createMemoryGuardStore();
  await writtenRule(store);
  const toMine = payment("to my other wallet", 2.3, SINCE + HOUR, { slot: 4000, to: OWN_OTHER_WALLET, toAccount: OWN_OTHER_USDC });
  const existing = await readPaymentWatch(store, OWNER);
  assert.ok(existing, "writing the rule readied the wallet's watch");
  const watch = foldMovements(existing, { ok: true, transactions: [toMine], cursor: { signature: toMine.signature, slot: 4000 }, balanceRaw: null, complete: true, more: false, hosts: [] }, null, SINCE + HOUR + MINUTE);
  assert.ok(await writePaymentWatch(store, existing, watch));
  await tickAutoinvest(store, SINCE + HOUR + 2 * MINUTE, { ledger: async () => [], paymentWatch: async (s, owner) => readPaymentWatch(s, owner) });
  assert.equal((await readRule(store, OWNER, RULE_ID)).payments.gatheredCents, 70);
  assert.deepEqual(await markOwnAccount(store, OWNER, fixtureSignature("nobody's"), SINCE + 2 * HOUR), { ok: false, code: "EVENT_NOT_FOUND" });
  const marked = await markOwnPaymentAccount(store, OWNER, toMine.signature, deps(SINCE + 2 * HOUR));
  assert.ok(marked.ok);
  assert.deepEqual([marked.rules[0].payments.gatheredUsd, marked.rules[0].payments.gatheredCount], [0, 0]);
  assert.deepEqual((await readPaymentWatch(store, OWNER)).ownAccounts, [OWN_OTHER_WALLET]);
  assert.ok(!JSON.stringify(marked).includes(OWN_OTHER_WALLET), "the account is never named back");
});

/* ------------------------------------------------------------------ the chain read */

function fakeTransport(byHost, transactions, { balance = "0" } = {}) {
  const endpoints = Object.keys(byHost).map((host) => ({ host, url: `https://${host}` }));
  return {
    endpoints,
    call: async (endpoint, method, params) => {
      if (method === "getSignaturesForAddress") {
        const [, options] = params;
        const rows = byHost[endpoint.host];
        if (rows === null) throw new Error(`${endpoint.host} is down`);
        const until = options.until ? rows.findIndex((row) => row.signature === options.until) : -1;
        return (until >= 0 ? rows.slice(0, until) : rows).slice(0, options.limit);
      }
      if (method === "getTransaction") {
        const tx = transactions.get(params[0]);
        if (!tx) return null;
        return {
          slot: tx.slot,
          blockTime: tx.blockTime,
          meta: { err: tx.failed ? { InstructionError: [0, "x"] } : null, preBalances: tx.preBalances, postBalances: tx.postBalances, preTokenBalances: tx.preTokenBalances, postTokenBalances: tx.postTokenBalances, innerInstructions: [] },
          transaction: { message: { accountKeys: tx.accountKeys, instructions: tx.memos.map((memo) => ({ program: "spl-memo", parsed: memo })) } },
        };
      }
      if (method === "getTokenAccountBalance") return { value: { amount: balance } };
      throw new Error(`unexpected ${method}`);
    },
  };
}

const sigRow = (tx) => ({ signature: tx.signature, slot: tx.slot, blockTime: tx.blockTime, err: null });

test("the chain read is the union of every endpoint, oldest first, and proves itself by the chain of balances", async () => {
  const a = payment("chain a", 3.4, SINCE + HOUR, { slot: 5000, before: 100 });
  const b = payment("chain b", 2.3, SINCE + 2 * HOUR, { slot: 5100, before: 96.6 });
  const txs = new Map([a, b].map((tx) => [tx.signature, tx]));
  /* One operator knows only the newest signature — the union still reads both. */
  const transport = fakeTransport({ truncated: [sigRow(b)], archive: [sigRow(b), sigRow(a)] }, txs);
  const read = await readUsdcMovements({ account: OWNER_USDC, cursor: null, balanceRaw: null, sinceSec: sec(SINCE) }, transport);
  assert.ok(read.ok);
  assert.deepEqual(read.transactions.map((tx) => tx.signature), [a.signature, b.signature]);
  assert.deepEqual([read.complete, read.more, read.balanceRaw, read.cursor.signature], [true, false, "94300000", b.signature]);
  assert.equal(read.transactions[0].memos.length, 0);
});

test("a skipped transaction breaks the chain of balances — the read says it is incomplete; a transaction nobody returns stops the read there", async () => {
  const a = payment("gap a", 3.4, SINCE + HOUR, { slot: 6000, before: 100 });
  const c = payment("gap c", 1, SINCE + 3 * HOUR, { slot: 6200, before: 90 });
  const gap = await readUsdcMovements({ account: OWNER_USDC, cursor: null, balanceRaw: null, sinceSec: sec(SINCE) }, fakeTransport({ only: [sigRow(c), sigRow(a)] }, new Map([[a.signature, a], [c.signature, c]])));
  assert.equal(gap.complete, false, "96.60 after the first, 90 before the next: a transaction between them was not read");
  const missing = await readUsdcMovements({ account: OWNER_USDC, cursor: null, balanceRaw: null, sinceSec: sec(SINCE) }, fakeTransport({ only: [sigRow(c), sigRow(a)] }, new Map([[c.signature, c]])));
  assert.deepEqual([missing.transactions.length, missing.complete, missing.more], [0, false, true]);
});

test("a read past the pass's deadline reads no more transactions and leaves them, unskipped, for the next pass", async () => {
  const a = payment("deadline a", 3.4, SINCE + HOUR, { slot: 9000 });
  const read = await readUsdcMovements({ account: OWNER_USDC, cursor: null, balanceRaw: null, sinceSec: sec(SINCE), deadlineMs: Date.now() - 1 }, fakeTransport({ only: [sigRow(a)] }, new Map([[a.signature, a]])));
  assert.deepEqual([read.transactions.length, read.more, read.complete, read.cursor], [0, true, true, null]);
});

test("a wallet's first read with nothing new starts the chain now: the newest signature and the balance; nothing before `since` is read", async () => {
  const old = payment("old", 5, SINCE - 5 * HOUR, { slot: 7000 });
  const read = await readUsdcMovements({ account: OWNER_USDC, cursor: null, balanceRaw: null, sinceSec: sec(SINCE) }, fakeTransport({ only: [sigRow(old)] }, new Map([[old.signature, old]]), { balance: "95000000" }));
  assert.deepEqual([read.transactions.length, read.cursor.signature, read.balanceRaw, read.complete], [0, old.signature, "95000000", true]);
  const down = await readUsdcMovements({ account: OWNER_USDC, cursor: null, balanceRaw: null, sinceSec: sec(SINCE) }, fakeTransport({ one: null, two: null }, new Map()));
  assert.equal(down.ok, false);
});

/* ------------------------------------------------------------------ the tick, end to end */

test("the tick end to end: two payments from the chain, one reminder note «З оплат: $1,30 → Apple» in the inbox and in Telegram, the watch read once a pass", async () => {
  const store = createMemoryGuardStore();
  await writtenRule(store);
  await preferencesOf(store).compareAndSet(`solana:mainnet:${OWNER}`, null, { version: 0, owner: OWNER, inbox: true, telegram: true, push: false, quietHours: null, updatedAt: iso(SINCE) });
  const first = payment("tick 3.40", 3.4, SINCE + HOUR, { slot: 8000, memo: "Order 4821" });
  const second = payment("tick 2.30", 2.3, SINCE + 2 * HOUR, { slot: 8100, before: 96.6 });
  const all = [first, second];
  let reads = 0;
  const watchAt = (s, owner, nowMs, input) => {
    reads += 1;
    return refreshPaymentWatch(s, owner, nowMs, input, {
      accountOf: async () => OWNER_USDC,
      readMovements: async (query) => {
        const fresh = all.filter((tx) => tx.blockTime * 1000 <= nowMs && tx.blockTime >= query.sinceSec && !query.seen?.has(tx.signature));
        const last = fresh.at(-1);
        return { ok: true, transactions: fresh, cursor: last ? { signature: last.signature, slot: last.slot } : query.cursor, balanceRaw: null, complete: true, more: false, hosts: ["test"] };
      },
    });
  };
  const tickDeps = { ledger: async () => [], paymentWatch: watchAt };
  const one = await tickAutoinvest(store, SINCE + HOUR + 5 * MINUTE, tickDeps);
  assert.deepEqual([one.reminded, reads], [0, 1]);
  const two = await tickAutoinvest(store, SINCE + 2 * HOUR + 5 * MINUTE, tickDeps);
  assert.equal(two.reminded, 1);
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "З оплат: $1,30 → Apple");
  assert.match(notes[0].reason, /Округлення кожної оплати до \$1 · 2 оплати/);
  assert.equal(notes[0].text.en.title, "From payments: $1.30 → Apple");
  assert.equal(notes[0].cta, "Купити $1,30");
  assert.equal((await outboxOf(store).valuesWithPrefix("")).filter((row) => row.channel === "telegram").length, 1);
  const three = await tickAutoinvest(store, SINCE + 2 * HOUR + 10 * MINUTE, tickDeps);
  assert.equal(three.reminded, 0, "a retried pass never reminds twice");
  const listed = await listRules(store, OWNER, deps(SINCE + 3 * HOUR));
  const [rule] = listed.rules;
  assert.deepEqual([rule.occurrences[0].state, rule.occurrences[0].amountUsd, rule.payments.read.state], ["due", 1.3, "ok"]);
});

test("the tick reads no wallet whose rules of that kind are all paused", async () => {
  const store = createMemoryGuardStore();
  await writtenRule(store);
  await setRuleStatus(store, OWNER, RULE_ID, "paused", deps(SINCE + HOUR));
  let reads = 0;
  await tickAutoinvest(store, SINCE + 2 * HOUR, { ledger: async () => [], paymentWatch: async () => { reads += 1; return null; } });
  assert.equal(reads, 0);
});

/* ------------------------------------------------------------------ the contract and the words */

test("the contract asks each mode for its own figure and nothing else; the request names payments only on that kind", () => {
  const good = { mode: "roundup", roundToUsd: 1, fixedUsd: null, percent: null, timeZone: KYIV };
  assert.ok(RulePaymentsRequestSchema.safeParse(good).success);
  assert.ok(!RulePaymentsRequestSchema.safeParse({ ...good, roundToUsd: 2 }).success, "a round-up goes to $1 or $5");
  assert.ok(!RulePaymentsRequestSchema.safeParse({ ...good, percent: 10 }).success);
  assert.ok(RulePaymentsRequestSchema.safeParse({ mode: "percent", roundToUsd: null, fixedUsd: null, percent: 10, timeZone: KYIV }).success);
  assert.ok(!RulePaymentsRequestSchema.safeParse({ mode: "percent", roundToUsd: null, fixedUsd: null, percent: 51, timeZone: KYIV }).success);
  assert.ok(RulePaymentsRequestSchema.safeParse({ mode: "fixed", roundToUsd: null, fixedUsd: 2, percent: null, timeZone: KYIV }).success);
  assert.ok(!RulePaymentsRequestSchema.safeParse({ mode: "fixed", roundToUsd: null, fixedUsd: 2.005, percent: null, timeZone: KYIV }).success);
  const request = { asset: { mint: AAPLX }, amountUsd: 1, kind: "payments", payments: good };
  assert.ok(RuleCreateRequestSchema.safeParse(request).success);
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...request, kind: "schedule" }).success);
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...request, payments: undefined }).success);
});

test("the words: the rule's line, the count of events and the reminder in both languages", () => {
  assert.equal(paymentsLine(ROUNDUP_1, "uk"), "Округлення кожної оплати до $1");
  assert.equal(paymentsLine({ mode: "roundup", roundToUsd: 5, fixedUsd: null, percent: null }, "en"), "Round every payment up to $5");
  assert.equal(paymentsLine({ mode: "fixed", roundToUsd: null, fixedUsd: 2, percent: null }, "uk"), "$2 з кожної оплати");
  assert.equal(paymentsLine({ mode: "percent", roundToUsd: null, fixedUsd: null, percent: 10 }, "uk"), `${pctWord(10, "uk")} з кожного надходження`);
  assert.equal(paymentsLine({ mode: "percent", roundToUsd: null, fixedUsd: null, percent: 10 }, "en"), "10% of every incoming transfer");
  assert.deepEqual([1, 2, 5, 11, 21, 22].map((count) => eventsCountWord(count, "roundup", "uk")), ["1 оплата", "2 оплати", "5 оплат", "11 оплат", "21 оплата", "22 оплати"]);
  assert.deepEqual([1, 3, 5].map((count) => eventsCountWord(count, "percent", "uk")), ["1 надходження", "3 надходження", "5 надходжень"]);
  assert.equal(eventsCountWord(1, "percent", "en"), "1 incoming transfer");
  assert.equal(ruleWhenLine({ schedule: null, dip: null, payments: ROUNDUP_1 }, "uk"), "Округлення кожної оплати до $1");
  const words = paymentsReminderWords({ name: "Apple", amountUsd: 1.3, events: 2, payments: ROUNDUP_1 });
  assert.equal(words.uk.title, "З оплат: $1,30 → Apple");
  assert.equal(words.en.cta, "Buy $1.30");
  assert.equal(paymentsReminderWords({ name: "Apple", amountUsd: 5, events: 1, payments: { mode: "percent", roundToUsd: null, fixedUsd: null, percent: 10 } }).uk.title, "З надходжень: $5 → Apple");
  for (const text of [words.uk.title, words.uk.reason, words.en.title, words.en.reason]) {
    assert.ok(!/DCA|trigger|автоматично|automatic/i.test(text), `no forbidden word in «${text}»`);
  }
});

test("a rule is written with its terms, counting from now: the least sum a reminder opens at is its amount; nothing waits yet", async () => {
  const store = createMemoryGuardStore();
  const created = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 1, kind: "payments", payments: { mode: "percent", roundToUsd: null, fixedUsd: null, percent: 10, timeZone: KYIV }, locale: "en" }, deps(SINCE));
  assert.ok(created.ok);
  assert.deepEqual([created.rule.kind, created.rule.amountUsd, created.rule.nextDueAt, created.rule.schedule, created.rule.dip], ["payments", 1, null, null, null]);
  assert.deepEqual([created.rule.payments.mode, created.rule.payments.percent, created.rule.payments.since, created.rule.payments.gatheredUsd], ["percent", 10, iso(SINCE), 0]);
  assert.ok(AutoinvestRuleSchema.safeParse(created.rule).success);
  const refused = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 1, kind: "payments", payments: { mode: "percent", roundToUsd: 1, fixedUsd: null, percent: 10, timeZone: KYIV }, locale: "en" }, deps(SINCE));
  assert.equal(refused.ok ? "ok" : refused.code, "VALIDATION_ERROR");
  const budget = await setBudget(store, OWNER, { capUsd: 31, timeZone: KYIV, locale: "uk" }, deps(SINCE));
  assert.ok(budget.ok);
  assert.equal(PAYMENTS_USDC_MINT, SOLANA_MAINNET_USDC_MINT);
});
