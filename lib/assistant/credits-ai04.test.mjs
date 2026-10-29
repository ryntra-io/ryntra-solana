// Run from repo root: node --test lib/assistant/credits-ai04.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { accountHolder, grantCredits, HOLDS_MAX, readBalance, readCredits, readEntries, reserveCredits, settleCredits, walletHolder } from "./credits/ledger.ts";
import { resolveHolder } from "./credits/holder.ts";
import { DEFAULT_CREDIT_PRICES, resolveCreditsConfig, CREDITS_ENV } from "./credits/prices.ts";
import { claimWelcome, welcomeEligible } from "./credits/welcome.ts";

/**
 * AI-04 «Кредити без грошей»: the ledger's properties — races, repeats,
 * refunds and never a minus — on the store's own compare-and-set, with the
 * clock in the test's hand.
 */

const NOW = Date.parse("2026-10-20T10:00:00.000Z");
const WALLET = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const OTHER = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ACCOUNT = "4b1c2d3e-0000-4000-8000-00000000abcd";
const config = (patch = {}) => ({ ...resolveCreditsConfig({}), ...patch });
const holder = walletHolder(WALLET);

/** A small seeded generator: the same sequence every run, so a failing case is a case one can replay. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** The entries replay to the balance: what was granted, less what was taken, plus what came back. */
async function assertReplays(store, who) {
  const balance = await readBalance(store, who);
  const entries = await readEntries(store, who, 100_000);
  const sum = entries.reduce((acc, entry) => ({ bonus: acc.bonus + entry.delta.bonus, paid: acc.paid + entry.delta.paid }), { bonus: 0, paid: 0 });
  assert.equal(sum.bonus, balance?.bonus ?? 0, "the welcome credits replay from the entries");
  assert.equal(sum.paid, balance?.paid ?? 0, "the bought credits replay from the entries");
  const seqs = entries.map((entry) => entry.seq).sort((a, b) => a - b);
  assert.deepEqual(seqs, seqs.map((_, index) => index + 1), "the entries are one unbroken sequence");
  assert.equal(balance?.seq ?? 0, seqs.length);
}

test("the prices and the allowances: the plan's table by default, each overridable by its setting, a bad override ignored", () => {
  const defaults = resolveCreditsConfig({});
  assert.deepEqual(defaults.prices, DEFAULT_CREDIT_PRICES);
  assert.deepEqual([defaults.freeDaily, defaults.welcome, defaults.prices.question, defaults.prices.plan], [20, 100, 2, 130]);
  const custom = resolveCreditsConfig({ [CREDITS_ENV.prices]: JSON.stringify({ question: 3, plan: 0, nope: 5 }), [CREDITS_ENV.freeDaily]: "30" });
  assert.equal(custom.prices.question, 3);
  assert.equal(custom.prices.plan, 130, "a paid action never costs zero by a setting");
  assert.equal(custom.freeDaily, 30);
  assert.deepEqual(resolveCreditsConfig({ [CREDITS_ENV.prices]: "{not json" }).prices, DEFAULT_CREDIT_PRICES);
});

test("free credits go first and start again each UTC day; past them nothing is taken without the price shown", async () => {
  const store = createMemoryGuardStore();
  const cfg = config();
  for (let i = 0; i < 10; i += 1) {
    const held = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: null, idem: `q-${i}`, config: cfg, nowMs: NOW });
    assert.equal(held.ok, true);
    assert.deepEqual(held.parts, { free: 2, bonus: 0, paid: 0 });
    assert.equal((await settleCredits(store, holder, { holdId: held.holdId, charged: 2, idem: `s-${i}`, nowMs: NOW })).ok, true);
  }
  const view = await readCredits(store, holder, cfg, NOW);
  assert.deepEqual([view.free.used, view.free.left], [20, 0]);
  const unshown = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: null, idem: "q-11", config: cfg, nowMs: NOW });
  assert.equal(unshown.code, "PRICE_NOT_SHOWN");
  const empty = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: 2, idem: "q-12", config: cfg, nowMs: NOW });
  assert.equal(empty.code, "CREDITS_EXHAUSTED", "no minus: an empty balance refuses");
  const tomorrow = NOW + 86_400_000;
  const again = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: null, idem: "q-13", config: cfg, nowMs: tomorrow });
  assert.equal(again.ok, true, "a new day, new free credits");
  assert.equal((await readCredits(store, holder, cfg, tomorrow)).free.left, 18);
  await assertReplays(store, holder);
});

test("the welcome credits after the free ones; a price shown below the price now is refused, at or above it is taken", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ freeDaily: 0 });
  assert.equal((await grantCredits(store, holder, { credits: 100, bucket: "bonus", reason: "welcome", idem: "welcome:x", nowMs: NOW })).ok, true);
  assert.equal((await reserveCredits(store, holder, { action: "deep", amount: 60, acceptCredits: 50, idem: "d-1", config: cfg, nowMs: NOW })).code, "PRICE_NOT_SHOWN");
  const held = await reserveCredits(store, holder, { action: "deep", amount: 60, acceptCredits: 60, idem: "d-2", config: cfg, nowMs: NOW });
  assert.deepEqual(held.parts, { free: 0, bonus: 60, paid: 0 });
  assert.equal((await readBalance(store, holder)).bonus, 40);
});

test("capture keeps the actual and gives the difference back; release gives all of it back; the bought credits come back first", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ freeDaily: 2 });
  await grantCredits(store, holder, { credits: 10, bucket: "bonus", reason: "welcome", idem: "w", nowMs: NOW });
  await grantCredits(store, holder, { credits: 100, bucket: "paid", reason: "purchase", idem: "p", nowMs: NOW });
  const held = await reserveCredits(store, holder, { action: "voice", amount: 24, acceptCredits: 24, idem: "v-1", config: cfg, nowMs: NOW });
  assert.deepEqual(held.parts, { free: 2, bonus: 10, paid: 12 });
  const settled = await settleCredits(store, holder, { holdId: held.holdId, charged: 6, idem: "v-1:settle", nowMs: NOW });
  assert.deepEqual([settled.charged, settled.returned], [6, 18]);
  const balance = await readBalance(store, holder);
  assert.deepEqual([balance.free.used, balance.bonus, balance.paid, balance.spentTotal], [2, 6, 100, 4], "kept from the free part first, the person's own credits back first");
  const second = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: 2, idem: "q-1", config: cfg, nowMs: NOW });
  await settleCredits(store, holder, { holdId: second.holdId, charged: 0, idem: "q-1:release", nowMs: NOW });
  const after = await readBalance(store, holder);
  assert.deepEqual([after.bonus, after.paid, after.holds.length], [6, 100, 0]);
  await assertReplays(store, holder);
});

test("repeats: the same key takes, gives and settles once and answers the first answer again", async () => {
  const store = createMemoryGuardStore();
  const cfg = config();
  const a = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: null, idem: "same", config: cfg, nowMs: NOW });
  const b = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: null, idem: "same", config: cfg, nowMs: NOW });
  assert.equal(b.repeat, true);
  assert.equal(b.holdId, a.holdId);
  assert.equal((await readBalance(store, holder)).free.used, 2);
  const s1 = await settleCredits(store, holder, { holdId: a.holdId, charged: 2, idem: "settle", nowMs: NOW });
  const s2 = await settleCredits(store, holder, { holdId: a.holdId, charged: 2, idem: "settle", nowMs: NOW });
  assert.deepEqual([s1.ok, s2.ok, s2.repeat], [true, true, true]);
  const s3 = await settleCredits(store, holder, { holdId: a.holdId, charged: 0, idem: "settle-other", nowMs: NOW });
  assert.equal(s3.code, "HOLD_NOT_FOUND", "a settled hold cannot be released afterwards for a refund");
  const g1 = await grantCredits(store, holder, { credits: 2_000, bucket: "paid", reason: "purchase", idem: "order-1", nowMs: NOW });
  const g2 = await grantCredits(store, holder, { credits: 2_000, bucket: "paid", reason: "purchase", idem: "order-1", nowMs: NOW });
  assert.deepEqual([g1.ok, g2.repeat, (await readBalance(store, holder)).paid], [true, true, 2_000], "one order, one credit");
  await assertReplays(store, holder);
});

test("races: many reservations at once never spend more than there is, and every one is accounted", async () => {
  for (const seed of [1, 7, 42]) {
    const store = createMemoryGuardStore();
    const cfg = config({ freeDaily: 4 });
    await grantCredits(store, holder, { credits: 10, bucket: "paid", reason: "purchase", idem: "p", nowMs: NOW });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: 2, idem: `race-${seed}-${i}`, config: cfg, nowMs: NOW })));
    const won = results.filter((result) => result.ok);
    assert.ok(won.length <= 7, `at most (4 free + 10 paid) / 2 = 7 reservations win, got ${won.length}`);
    for (const result of results.filter((r) => !r.ok)) assert.ok(["CREDITS_EXHAUSTED", "UNAVAILABLE"].includes(result.code));
    const balance = await readBalance(store, holder);
    const heldPaid = won.reduce((sum, r) => sum + r.parts.paid, 0);
    const heldFree = won.reduce((sum, r) => sum + r.parts.free, 0);
    assert.equal(balance.paid, 10 - heldPaid);
    assert.equal(balance.free.used, heldFree);
    assert.ok(balance.paid >= 0 && balance.free.used <= 4);
    /* Settled at once, half charged and half released. */
    await Promise.all(won.map((r, i) => settleCredits(store, holder, { holdId: r.holdId, charged: i % 2 === 0 ? 2 : 0, idem: `settle-${seed}-${i}`, nowMs: NOW })));
    const after = await readBalance(store, holder);
    assert.equal(after.holds.length, 0);
    await assertReplays(store, holder);
  }
});

test("property: any sequence of grants, reservations, captures, releases, expiries and days keeps every count at zero or above and the entries replaying", async () => {
  for (const seed of [3, 11, 29, 101, 2026]) {
    const random = rng(seed);
    const store = createMemoryGuardStore();
    const cfg = config({ freeDaily: 6, dailySpendCap: 40 });
    let now = NOW;
    const open = [];
    for (let step = 0; step < 160; step += 1) {
      const roll = random();
      if (roll < 0.1) await grantCredits(store, holder, { credits: 1 + Math.floor(random() * 20), bucket: random() < 0.5 ? "bonus" : "paid", reason: "adjust", idem: `g-${seed}-${step}`, nowMs: now });
      else if (roll < 0.55) {
        const amount = 1 + Math.floor(random() * 8);
        const shown = random() < 0.8 ? amount : random() < 0.5 ? null : amount - 1;
        const held = await reserveCredits(store, holder, { action: "question", amount, acceptCredits: shown, idem: `r-${seed}-${step}`, config: cfg, nowMs: now });
        if (held.ok) open.push(held);
        else assert.ok(["PRICE_NOT_SHOWN", "CREDITS_EXHAUSTED", "CREDITS_LIMIT", "CREDITS_BUSY"].includes(held.code), held.code);
      } else if (roll < 0.85 && open.length > 0) {
        const hold = open.splice(Math.floor(random() * open.length), 1)[0];
        const charged = random() < 0.3 ? 0 : Math.floor(random() * (hold.amount + 3));
        const settled = await settleCredits(store, holder, { holdId: hold.holdId, charged, idem: `s-${seed}-${step}`, nowMs: now });
        assert.ok(settled.ok || settled.code === "HOLD_NOT_FOUND");
        if (settled.ok) assert.ok(settled.charged <= hold.amount, "never charged past the hold");
      } else now += random() < 0.5 ? 150_000 : 86_400_000 / 3;
      const balance = await readBalance(store, holder);
      if (!balance) continue;
      for (const value of [balance.paid, balance.bonus, balance.free.used, balance.spent.credits, balance.spentTotal]) assert.ok(Number.isInteger(value) && value >= 0, `step ${step}: ${JSON.stringify(balance)}`);
      assert.ok(balance.free.used <= cfg.freeDaily, "never past the day's free credits");
      assert.ok(balance.spent.credits <= cfg.dailySpendCap, "never past the day's cap");
      assert.ok(balance.holds.length <= HOLDS_MAX);
    }
    await assertReplays(store, holder);
  }
});

test("an unsettled hold expires and comes back whole; settling it afterwards finds nothing and charges nothing", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ freeDaily: 0 });
  await grantCredits(store, holder, { credits: 10, bucket: "paid", reason: "purchase", idem: "p", nowMs: NOW });
  const held = await reserveCredits(store, holder, { action: "tokenReport", amount: 5, acceptCredits: 5, idem: "t-1", config: cfg, nowMs: NOW });
  const later = NOW + cfg.holdMs + 1;
  assert.equal((await readCredits(store, holder, cfg, later)).paid, 10, "a read already shows it back");
  await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: 2, idem: "q-1", config: cfg, nowMs: later });
  assert.equal((await settleCredits(store, holder, { holdId: held.holdId, charged: 5, idem: "t-1:settle", nowMs: later })).code, "HOLD_NOT_FOUND");
  assert.equal((await readBalance(store, holder)).paid, 8);
  assert.ok((await readEntries(store, holder)).some((entry) => entry.kind === "expire"));
  await assertReplays(store, holder);
});

test("limits: the day's cap and a watch's own daily and total limits refuse with nothing taken", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ freeDaily: 0, dailySpendCap: 10 });
  await grantCredits(store, holder, { credits: 100, bucket: "paid", reason: "purchase", idem: "p", nowMs: NOW });
  const a = await reserveCredits(store, holder, { action: "tokenReport", amount: 5, acceptCredits: 5, idem: "a", config: cfg, nowMs: NOW });
  const b = await reserveCredits(store, holder, { action: "tokenReport", amount: 5, acceptCredits: 5, idem: "b", config: cfg, nowMs: NOW });
  const c = await reserveCredits(store, holder, { action: "tokenReport", amount: 5, acceptCredits: 5, idem: "c", config: cfg, nowMs: NOW });
  assert.deepEqual([a.ok, b.ok, c.code], [true, true, "CREDITS_LIMIT"]);
  await settleCredits(store, holder, { holdId: b.holdId, charged: 0, idem: "b:release", nowMs: NOW });
  assert.equal((await reserveCredits(store, holder, { action: "tokenReport", amount: 5, acceptCredits: 5, idem: "d", config: cfg, nowMs: NOW })).ok, true, "a release frees the day's room");
  const scoped = config({ freeDaily: 0, dailySpendCap: 1_000 });
  const scope = { id: "watch:bonk-1", daily: 4, total: 6 };
  const s1 = await reserveCredits(store, holder, { action: "alertExplain", amount: 2, acceptCredits: 2, idem: "s1", scope, config: scoped, nowMs: NOW + 86_400_000 });
  const s2 = await reserveCredits(store, holder, { action: "alertExplain", amount: 2, acceptCredits: 2, idem: "s2", scope, config: scoped, nowMs: NOW + 86_400_000 });
  const s3 = await reserveCredits(store, holder, { action: "alertExplain", amount: 2, acceptCredits: 2, idem: "s3", scope, config: scoped, nowMs: NOW + 86_400_000 });
  assert.deepEqual([s1.ok, s2.ok, s3.code], [true, true, "CREDITS_LIMIT"]);
  for (const s of [s1, s2]) await settleCredits(store, holder, { holdId: s.holdId, charged: 2, idem: `${s.holdId}:settle`, nowMs: NOW + 86_400_000 });
  const s4 = await reserveCredits(store, holder, { action: "alertExplain", amount: 2, acceptCredits: 2, idem: "s4", scope, config: scoped, nowMs: NOW + 2 * 86_400_000 });
  const s5 = await reserveCredits(store, holder, { action: "alertExplain", amount: 2, acceptCredits: 2, idem: "s5", scope, config: scoped, nowMs: NOW + 2 * 86_400_000 });
  assert.deepEqual([s4.ok, s5.code], [true, "CREDITS_LIMIT"], "the total limit holds across days");
  await assertReplays(store, holder);
});

test("a linked wallet's credits move into its account once, with the welcome flag and the day's free credits counted as the larger", async () => {
  const store = createMemoryGuardStore();
  const cfg = config();
  await grantCredits(store, holder, { credits: 100, bucket: "bonus", reason: "welcome", idem: "welcome:w", nowMs: NOW });
  const held = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: null, idem: "q", config: cfg, nowMs: NOW });
  await settleCredits(store, holder, { holdId: held.holdId, charged: 2, idem: "q:s", nowMs: NOW });
  assert.deepEqual(await resolveHolder(store, WALLET, async () => null, NOW), { holder, wallet: WALLET, accountId: null, merged: false, known: true });
  const linked = await resolveHolder(store, WALLET, async () => ACCOUNT, NOW);
  assert.deepEqual([linked.holder, linked.merged], [accountHolder(ACCOUNT), true]);
  const account = await readBalance(store, accountHolder(ACCOUNT));
  assert.deepEqual([account.bonus, account.welcome, account.free.used], [100, true, 2]);
  assert.deepEqual([(await readBalance(store, holder)).bonus, (await readBalance(store, holder)).mergedInto], [0, accountHolder(ACCOUNT)]);
  const again = await resolveHolder(store, WALLET, async () => ACCOUNT, NOW);
  assert.equal(again.merged, false, "moved once");
  const down = await resolveHolder(store, WALLET, async () => undefined, NOW);
  assert.equal(down.holder, accountHolder(ACCOUNT), "the accounts store silent: a merged wallet keeps its account");
  const throws = await resolveHolder(store, OTHER, async () => {
    throw new Error("down");
  }, NOW);
  assert.equal(throws.holder, walletHolder(OTHER));
  await assertReplays(store, holder);
  await assertReplays(store, accountHolder(ACCOUNT));
});

test("the welcome credits: an old active wallet once; a new wallet refused; a second wallet of the same account refused; an unread history is not a refusal", async () => {
  const cfg = config();
  assert.equal(welcomeEligible({ txs: 10, oldestAt: NOW - 31 * 86_400_000 }, cfg, NOW), true);
  assert.equal(welcomeEligible({ txs: 9, oldestAt: NOW - 400 * 86_400_000 }, cfg, NOW), false);
  assert.equal(welcomeEligible({ txs: 500, oldestAt: NOW - 3 * 86_400_000 }, cfg, NOW), false);
  const store = createMemoryGuardStore();
  const old = async () => ({ txs: 40, oldestAt: NOW - 90 * 86_400_000 });
  const account = accountHolder(ACCOUNT);
  const first = await claimWelcome(store, { holder: account, wallet: WALLET, accountId: ACCOUNT, history: old, config: cfg, nowMs: NOW });
  assert.deepEqual(first, { ok: true, credits: 100 });
  const twice = await claimWelcome(store, { holder: account, wallet: WALLET, accountId: ACCOUNT, history: old, config: cfg, nowMs: NOW });
  assert.equal(twice.code, "WELCOME_TAKEN");
  const otherWallet = await claimWelcome(store, { holder: walletHolder(OTHER), wallet: OTHER, accountId: ACCOUNT, history: old, config: cfg, nowMs: NOW });
  assert.equal(otherWallet.code, "WELCOME_TAKEN", "one welcome per account");
  const sameWalletElsewhere = await claimWelcome(store, { holder: walletHolder(WALLET), wallet: WALLET, accountId: null, history: old, config: cfg, nowMs: NOW });
  assert.equal(sameWalletElsewhere.code, "WELCOME_TAKEN", "one welcome per wallet");
  const fresh = createMemoryGuardStore();
  assert.equal((await claimWelcome(fresh, { holder: walletHolder(OTHER), wallet: OTHER, accountId: null, history: async () => ({ txs: 1, oldestAt: NOW - 86_400_000 }), config: cfg, nowMs: NOW })).code, "WELCOME_NOT_ELIGIBLE");
  assert.equal((await claimWelcome(fresh, { holder: walletHolder(OTHER), wallet: OTHER, accountId: null, history: async () => null, config: cfg, nowMs: NOW })).code, "UNAVAILABLE");
  assert.equal((await readBalance(fresh, walletHolder(OTHER))), null, "a refusal writes nothing");
  const races = await Promise.all(Array.from({ length: 6 }, () => claimWelcome(fresh, { holder: walletHolder(WALLET), wallet: WALLET, accountId: null, history: old, config: cfg, nowMs: NOW })));
  assert.equal(races.filter((r) => r.ok).length >= 1, true);
  assert.equal((await readBalance(fresh, walletHolder(WALLET))).bonus, 100, "six claims at once give one welcome");
});

/* ------------------------------------------------------------ the critic's findings, round 1 */

test("a question asked before midnight and settled after it: the new day's free credits and cap are not reset, the hold's day gets back what it gave", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ freeDaily: 20 });
  const before = Date.parse("2026-10-20T23:59:59.000Z");
  const after = Date.parse("2026-10-21T00:00:05.000Z");
  const held = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: null, idem: "late", config: cfg, nowMs: before });
  for (let i = 0; i < 10; i += 1) {
    const next = await reserveCredits(store, holder, { action: "question", amount: 2, acceptCredits: null, idem: `new-day-${i}`, config: cfg, nowMs: after });
    await settleCredits(store, holder, { holdId: next.holdId, charged: 2, idem: `new-day-${i}:s`, nowMs: after });
  }
  assert.equal((await readCredits(store, holder, cfg, after)).free.left, 0);
  /* Settled with the clock it was reserved at — yesterday's — and released: the new day keeps its count. */
  await settleCredits(store, holder, { holdId: held.holdId, charged: 0, idem: "late:release", nowMs: before });
  const balance = await readBalance(store, holder);
  assert.deepEqual([balance.free.day, balance.free.used], ["2026-10-21", 20], "never a day back, never yesterday's free credits into today");
  await assertReplays(store, holder);
});

test("two merges at once move once: the account's day spend is not doubled and no empty entries are written", async () => {
  const store = createMemoryGuardStore();
  const cfg = config({ freeDaily: 0 });
  await grantCredits(store, holder, { credits: 100, bucket: "paid", reason: "purchase", idem: "p", nowMs: NOW });
  const held = await reserveCredits(store, holder, { action: "deep", amount: 40, acceptCredits: 60, idem: "d", config: { ...cfg, prices: { ...cfg.prices, deep: 40 } }, nowMs: NOW });
  await settleCredits(store, holder, { holdId: held.holdId, charged: 40, idem: "d:s", nowMs: NOW });
  await Promise.all([resolveHolder(store, WALLET, async () => ACCOUNT, NOW), resolveHolder(store, WALLET, async () => ACCOUNT, NOW)]);
  await resolveHolder(store, WALLET, async () => ACCOUNT, NOW);
  const account = await readBalance(store, accountHolder(ACCOUNT));
  assert.deepEqual([account.paid, account.spent.credits], [60, 40]);
  assert.equal((await readEntries(store, accountHolder(ACCOUNT))).filter((entry) => entry.kind === "merge-in").length, 1);
});

test("credits that reach a merged wallet later move too; a second welcome brought by a merge is not added", async () => {
  const store = createMemoryGuardStore();
  await grantCredits(store, holder, { credits: 100, bucket: "bonus", reason: "welcome", idem: "w1", nowMs: NOW });
  await resolveHolder(store, WALLET, async () => ACCOUNT, NOW);
  await grantCredits(store, holder, { credits: 2_000, bucket: "paid", reason: "purchase", idem: "order", nowMs: NOW });
  const moved = await resolveHolder(store, WALLET, async () => ACCOUNT, NOW);
  assert.equal(moved.merged, true);
  assert.deepEqual([(await readBalance(store, accountHolder(ACCOUNT))).paid, (await readBalance(store, holder)).paid], [2_000, 0]);
  const other = walletHolder(OTHER);
  await grantCredits(store, other, { credits: 100, bucket: "bonus", reason: "welcome", idem: "w2", nowMs: NOW });
  await resolveHolder(store, OTHER, async () => ACCOUNT, NOW);
  assert.equal((await readBalance(store, accountHolder(ACCOUNT))).bonus, 100, "one welcome per account, whichever wallet brought it");
  await assertReplays(store, holder);
  await assertReplays(store, other);
  await assertReplays(store, accountHolder(ACCOUNT));
});

test("the welcome: two asks at once say «given» once and «taken» once; a wallet busy past a thousand transactions is old enough", async () => {
  const cfg = config();
  assert.equal(welcomeEligible({ txs: 1000, oldestAt: NOW - 2 * 86_400_000, full: true }, cfg, NOW), true);
  const store = createMemoryGuardStore();
  const old = async () => ({ txs: 40, oldestAt: NOW - 90 * 86_400_000 });
  const results = await Promise.all([0, 1].map(() => claimWelcome(store, { holder, wallet: WALLET, accountId: null, history: old, config: cfg, nowMs: NOW })));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.code === "WELCOME_TAKEN").length, 1);
});
