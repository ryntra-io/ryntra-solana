// Run from repo root: node --test lib/autoinvest/dip-budget.test.mjs
/**
 * «Якщо впаде» and «Бюджет місяця» (`RYN-INVEST-SIMPLE-001`, session 4;
 * canon v5.1 §4.1, §11): a rule that falls from the price its company's page
 * shows, one note per crossing, the reference point that moves after a
 * purchase; a month's ceiling that counts only proof, holds what it does not
 * cover — one note that it is spent, the rules standing until the 1st — and
 * lets the purchase through the moment it fits again; the order route's
 * refusal; what the monitoring surface says of every reminder. A memory
 * store, a fixed clock, prices handed in, a fake bot; nothing reaches a
 * wallet.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AutoinvestRuleSchema, MonitoringSurfaceResponseSchema, RuleBudgetRequestSchema, RuleBudgetSchema, RuleCreateRequestSchema, RuleListResponseSchema } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { deliverOutbox } from "../monitoring/deliver.ts";
import { resolveInboxLink } from "../monitoring/inbox.ts";
import { listInbox } from "../monitoring/store.ts";
import { composeMonitoringSurface } from "../monitoring/surface.ts";
import { listSolanaWalletActions, recordSolanaAction } from "../solana/action-ledger.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import { budgetMonth, remainingOf, spendInMonth } from "./budget.ts";
import { dipTriggerUsd, purchasePriceUsd } from "./dip.ts";
import { budgetMonitorId } from "./links.ts";
import { judgeRuleOrder, usdToUsdcRaw } from "./model.ts";
import { clearBudget, createRule, listRules, readBudget, reminderStates, setBudget, setRuleStatus } from "./service.ts";
import { readBudgetRecord, readRule } from "./store.ts";
import { tickAutoinvest, writeBudgetNote } from "./tick.ts";

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a21";
const DIP_ID = "rule_d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1";
const WEEK_ID = "rule_0123456789abcdef0123456789abcdef";
const KYIV = "Europe/Kyiv";
/* Thursday 24 September 2026, 00:29 in Kyiv. */
const NOW = Date.parse("2026-09-23T21:29:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const MINUTE = 60_000;
const HOUR = 3_600_000;
const WEEKLY_THU_19 = { cadence: "weekly", weekday: 4, monthDay: null, time: "19:00", timeZone: KYIV };
/* The Thursday due, 19:00 Kyiv. */
const DUE = Date.parse("2026-09-24T16:00:00.000Z");

let signatureSeed = 0;
const nextSignature = () => String(++signatureSeed).padStart(2, "0").replace(/0/g, "A").padEnd(87, "5");

function stockRow(price = 200, observedAt = iso(NOW)) {
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
    market: { priceUsd: price, observedAt },
    multiplier: { current: 1, pending: null, effectiveAt: null },
  };
}

function deps(overrides = {}) {
  return {
    now: () => new Date(overrides.nowMs ?? NOW),
    findRow: overrides.findRow ?? (async (mint) => ({ ok: true, row: mint === AAPLX ? stockRow("price" in overrides ? overrides.price : 200, overrides.observedAt) : null, universe: null })),
    lifecycle: () => null,
    ruleId: () => overrides.ruleId ?? DIP_ID,
    ...(overrides.ledger ? { ledger: overrides.ledger } : {}),
  };
}

/** The tick's prices, handed in: one company, the price and when it was read, the multiplier. */
function marketsAt(price, atMs, multiplier = 1) {
  return async (mints) => new Map(mints.map((mint) => [mint, { price: price === null ? null : { usd: price, observedAtMs: atMs }, multiplier }]));
}

async function writeDip(store, overrides = {}) {
  const created = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: overrides.amountUsd ?? 20, kind: "dip", dip: { dropPct: overrides.dropPct ?? 5, timeZone: KYIV }, locale: overrides.locale ?? "uk" }, deps(overrides));
  assert.ok(created.ok, JSON.stringify(created));
  return created.rule;
}

async function writeWeekly(store, overrides = {}) {
  const created = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: overrides.amountUsd ?? 10, schedule: WEEKLY_THU_19, locale: "uk" }, deps({ ...overrides, ruleId: WEEK_ID }));
  assert.ok(created.ok, JSON.stringify(created));
  return created.rule;
}

/** A purchase under a rule's reminder as the execute route writes History. */
async function purchase(store, ruleId, dueAt, { outcome = "DONE", usd = 20, inRaw = "10000000", at } = {}) {
  const signature = nextSignature();
  await recordSolanaAction(store, {
    network: "mainnet",
    wallet: OWNER,
    actionId: signature,
    lane: "SWAP",
    outcome,
    out: { mint: SOLANA_MAINNET_USDC_MINT, amountRaw: String(Math.round(usd * 1e6)), decimals: null, symbol: null },
    in: outcome === "DONE" ? { mint: AAPLX, amountRaw: inRaw, decimals: null, symbol: null } : null,
    signature,
    origin: { surface: "SPOT", side: "BUY", rule: { ruleId, dueAt } },
    now: iso(at ?? Date.parse(dueAt) + 5 * MINUTE),
  });
  return signature;
}

async function rows(store) {
  return (await listSolanaWalletActions(store, { network: "mainnet", wallet: OWNER })).actions;
}

test("a «Якщо впаде» rule falls from the price the company's page shows: the reference point, the trigger, no schedule; a price nobody could read writes nothing", async () => {
  const store = createMemoryGuardStore();
  const rule = await writeDip(store);
  assert.ok(AutoinvestRuleSchema.safeParse(rule).success, JSON.stringify(AutoinvestRuleSchema.safeParse(rule).error?.issues?.[0]));
  assert.equal(rule.kind, "dip");
  assert.equal(rule.schedule, null);
  assert.equal(rule.nextDueAt, null, "the price decides, not a clock");
  assert.deepEqual({ ...rule.dip }, { dropPct: 5, timeZone: KYIV, anchorUsd: 200, anchorAt: iso(NOW), anchorFrom: "enabled", triggerUsd: 190, armed: true, heldAt: null });
  const blind = await createRule(createMemoryGuardStore(), { owner: OWNER, mint: AAPLX, amountUsd: 20, kind: "dip", dip: { dropPct: 5, timeZone: KYIV }, locale: "en" }, deps({ price: null }));
  assert.equal(blind.code, "UNAVAILABLE");
  const stale = await createRule(createMemoryGuardStore(), { owner: OWNER, mint: AAPLX, amountUsd: 20, kind: "dip", dip: { dropPct: 5, timeZone: KYIV }, locale: "en" }, deps({ observedAt: iso(NOW - 2 * HOUR) }));
  assert.equal(stale.code, "UNAVAILABLE", "a price read two hours ago is no reference point");
  /* The request: «Регулярно» by default, a fall of whole per cent from 1 to 50, never both a schedule and a fall. */
  const ask = { asset: { mint: AAPLX }, amountUsd: 20 };
  assert.ok(RuleCreateRequestSchema.safeParse({ ...ask, schedule: WEEKLY_THU_19 }).success, "a 1.12.0 request still reads");
  assert.equal(RuleCreateRequestSchema.parse({ ...ask, schedule: WEEKLY_THU_19 }).kind, "schedule");
  assert.ok(RuleCreateRequestSchema.safeParse({ ...ask, kind: "dip", dip: { dropPct: 5, timeZone: KYIV } }).success);
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ask, kind: "dip" }).success, "a fall named");
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ask, kind: "dip", dip: { dropPct: 5, timeZone: KYIV }, schedule: WEEKLY_THU_19 }).success, "never both");
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ask, dip: { dropPct: 5, timeZone: KYIV } }).success, "a «Регулярно» rule names no fall");
  for (const dropPct of [0, 51, 5.5]) assert.ok(!RuleCreateRequestSchema.safeParse({ ...ask, kind: "dip", dip: { dropPct, timeZone: KYIV } }).success, `${dropPct} %`);
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ask, kind: "dip", dip: { dropPct: 5, timeZone: "Mars/Olympus" } }).success);
});

test("one note per crossing: the first read at or below the trigger reminds once; a hovering price stays silent; back above and down again is a new crossing", async () => {
  const store = createMemoryGuardStore();
  await writeDip(store);
  const tick = (price, atMs) => tickAutoinvest(store, atMs, { ledger: async () => [], markets: marketsAt(price, atMs) });
  assert.equal((await tick(195, NOW + 5 * MINUTE)).reminded, 0, "above the trigger");
  assert.equal((await tick(null, NOW + 10 * MINUTE)).reminded, 0, "no price, no decision");
  assert.equal((await tickAutoinvest(store, NOW + 15 * MINUTE, { ledger: async () => [], markets: marketsAt(150, NOW - HOUR) })).reminded, 0, "a price read an hour ago decides nothing");
  const crossing = NOW + 20 * MINUTE;
  assert.equal((await tick(189, crossing)).reminded, 1, "the crossing reminds");
  assert.equal((await tick(188, crossing + 5 * MINUTE)).reminded, 0, "the reminder is open: nothing more");
  assert.equal((await tick(191, crossing + 10 * MINUTE)).reminded, 0);
  assert.equal((await tick(189.9, crossing + 15 * MINUTE)).reminded, 0, "one reminder at a time, however the price hovers");
  let record = await readRule(store, OWNER, DIP_ID);
  assert.deepEqual(record.occurrences.map((row) => [row.state, row.dueAt, row.openUntil, row.trigger]), [["due", iso(crossing), iso(crossing + 24 * HOUR), { priceUsd: 189, anchorUsd: 200 }]]);
  assert.equal(record.dip.armed, false);
  const [note] = await listInbox(store, OWNER);
  assert.equal(note.title, "Apple −5,5 % · докупити $20?");
  assert.equal(note.reason, "Ціна $189,00 — на 5,5 % нижча за точку відліку $200,00. Один дотик — свіжа «Перевірка», купує лише твій підпис.");
  assert.equal(note.cta, "Купити $20");
  assert.equal(note.text.en.title, "Apple −5.5% · buy $20 more?");
  assert.deepEqual(note.subject, { kind: "autoinvest-rule", id: DIP_ID });
  /* The day passes unsigned: missed. The price keeps falling — the same crossing, no note. */
  await tick(180, crossing + 25 * HOUR);
  record = await readRule(store, OWNER, DIP_ID);
  assert.equal(record.occurrences.at(-1).state, "missed");
  assert.equal((await tick(170, crossing + 26 * HOUR)).reminded, 0, "a missed crossing is not reminded again while the price stays down");
  /* Back above the trigger arms the rule; the next fall below it is a new crossing. */
  assert.equal((await tick(192, crossing + 27 * HOUR)).reminded, 0);
  assert.equal((await readRule(store, OWNER, DIP_ID)).dip.armed, true);
  assert.equal((await tick(189.5, crossing + 28 * HOUR)).reminded, 1, "a new crossing, a new note");
  assert.equal((await listInbox(store, OWNER)).length, 2);
});

test("after a purchase under a crossing the reference point moves to what that purchase paid; the next reminder waits for a fall from there", async () => {
  const store = createMemoryGuardStore();
  await writeDip(store);
  const crossing = NOW + 20 * MINUTE;
  await tickAutoinvest(store, crossing, { ledger: async () => [], markets: marketsAt(189, crossing) });
  /* $20 bought 0.10582010 of a share: $189.00 a share. */
  await purchase(store, DIP_ID, iso(crossing), { usd: 20, inRaw: "10582010", at: crossing + 2 * MINUTE });
  await tickAutoinvest(store, crossing + 5 * MINUTE, { markets: marketsAt(189.2, crossing + 5 * MINUTE) });
  let record = await readRule(store, OWNER, DIP_ID);
  assert.equal(record.occurrences[0].state, "bought");
  assert.equal(record.dip.anchorFrom, "purchase");
  assert.ok(Math.abs(record.dip.anchorUsd - 189) < 0.01, `the point is what the purchase paid: ${record.dip.anchorUsd}`);
  assert.equal(record.dip.anchorAt, record.occurrences[0].boughtAt);
  /* The price above the new trigger (179.55) arms the rule; the old trigger (190) is gone. */
  assert.equal((await tickAutoinvest(store, crossing + 10 * MINUTE, { markets: marketsAt(185, crossing + 10 * MINUTE) })).reminded, 0);
  record = await readRule(store, OWNER, DIP_ID);
  assert.equal(record.dip.armed, true);
  assert.equal((await tickAutoinvest(store, crossing + HOUR, { markets: marketsAt(179, crossing + HOUR) })).reminded, 1, "a fall of 5 % from the purchase reminds");
  /* The purchase's price per unit counts the Scaled UI multiplier; a missing figure falls back to the price that opened the reminder. */
  const [row] = await rows(store);
  assert.ok(Math.abs(purchasePriceUsd(row, 8, 1) - 189) < 0.01);
  assert.ok(Math.abs(purchasePriceUsd(row, 8, 2) - 94.5) < 0.01);
  assert.equal(purchasePriceUsd(row, null, 1), null);
  assert.equal(dipTriggerUsd(200, 5), 190);
  const fallback = createMemoryGuardStore();
  await writeDip(fallback);
  await tickAutoinvest(fallback, crossing, { ledger: async () => [], markets: marketsAt(188, crossing) });
  await purchase(fallback, DIP_ID, iso(crossing), { usd: 20, inRaw: "10582010" });
  await tickAutoinvest(fallback, crossing + 10 * MINUTE, { markets: marketsAt(189, crossing + 10 * MINUTE, null) });
  assert.equal((await readRule(fallback, OWNER, DIP_ID)).dip.anchorUsd, 188, "no multiplier read: the price that opened the reminder");
});

test("the month's budget counts only proof: a settled purchase under a rule, a signed one not settled yet, never a failed one, a plain purchase or another month", async () => {
  const store = createMemoryGuardStore();
  const september = budgetMonth(NOW, KYIV);
  assert.equal(september.key, "2026-09");
  assert.equal(iso(september.startMs), "2026-08-31T21:00:00.000Z", "1 September 00:00 in Kyiv");
  assert.equal(iso(september.endMs), "2026-09-30T21:00:00.000Z", "1 October 00:00 in Kyiv");
  assert.equal(budgetMonth(Date.parse("2026-09-30T20:59:00.000Z"), KYIV).key, "2026-09");
  assert.equal(budgetMonth(Date.parse("2026-09-30T21:01:00.000Z"), KYIV).key, "2026-10", "past midnight on the person's clock is the next month");
  const due = iso(DUE);
  await purchase(store, WEEK_ID, due, { outcome: "DONE", usd: 10 });
  await purchase(store, WEEK_ID, "2026-09-25T16:00:00.000Z", { outcome: "IN_FLIGHT", usd: 12.5, at: Date.parse("2026-09-25T16:05:00.000Z") });
  await purchase(store, WEEK_ID, "2026-09-26T16:00:00.000Z", { outcome: "FAILED", usd: 50, at: Date.parse("2026-09-26T16:05:00.000Z") });
  await purchase(store, WEEK_ID, "2026-08-27T16:00:00.000Z", { outcome: "DONE", usd: 40, at: Date.parse("2026-08-27T16:05:00.000Z") });
  const plain = nextSignature();
  await recordSolanaAction(store, { network: "mainnet", wallet: OWNER, actionId: plain, lane: "SWAP", outcome: "DONE", out: { mint: SOLANA_MAINNET_USDC_MINT, amountRaw: "99000000", decimals: null, symbol: null }, in: null, signature: plain, origin: { surface: "SPOT", side: "BUY" }, now: iso(NOW) });
  const spend = spendInMonth(await rows(store), september);
  assert.deepEqual(spend, { spentUsd: 10, unknownUsd: 12.5 });
  assert.equal(remainingOf(100, spend), 77.5);
  assert.equal(remainingOf(20, spend), 0, "never below nothing");
});

test("a purchase the budget does not cover is held, never reminded; one note says the budget is spent and the rules stand until the 1st; on the 1st they remind again", async () => {
  const store = createMemoryGuardStore();
  await writeWeekly(store);
  const set = await setBudget(store, OWNER, { capUsd: 10, timeZone: KYIV, locale: "uk" }, deps());
  assert.ok(set.ok);
  assert.ok(RuleBudgetSchema.safeParse(set.budget).success);
  assert.deepEqual([set.budget.capUsd, set.budget.remainingUsd, set.budget.exhausted], [10, 10, false]);
  /* Last Thursday's purchase under the rule settled: the month's $10 is spent. */
  await purchase(store, WEEK_ID, "2026-09-17T16:00:00.000Z", { usd: 10, at: Date.parse("2026-09-17T16:05:00.000Z") });
  await store.collection("notificationChannels").set(ACCOUNT, { schema: "ryntra.notification-channel", schemaVersion: "1.0.0", version: 0, accountId: ACCOUNT, telegramId: 700000001, username: "owner", connectedAt: iso(NOW) });
  const first = await tickAutoinvest(store, DUE + 2 * MINUTE);
  assert.deepEqual([first.reminded, first.held], [0, 1], "held, not reminded");
  const record = await readRule(store, OWNER, WEEK_ID);
  assert.deepEqual(record.occurrences.map((row) => [row.dueAt, row.state, row.remindedAt]), [[iso(DUE), "held", null]]);
  assert.equal(record.nextDueAt, "2026-10-01T16:00:00.000Z", "the schedule goes on");
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1, "one note: the budget, not the reminder");
  const [note] = notes;
  assert.deepEqual(note.subject, { kind: "autoinvest-budget", id: "budget:2026-09" });
  assert.equal(note.monitorId, budgetMonitorId(OWNER));
  assert.match(note.monitorId, /^mon_[0-9a-f]{24}$/);
  assert.equal(note.title, "Бюджет місяця вичерпано");
  assert.equal(note.reason, "Витрачено $10 з $10. Правила стоять до 1-го числа — або зміни бюджет.");
  assert.equal(note.cta, "Змінити бюджет");
  assert.equal(note.text.en.title, "This month's autoinvest budget is spent");
  /* The note opens the budget's sheet on Home, in the inbox and in Telegram alike. */
  assert.equal(await resolveInboxLink(store, OWNER, note.id), "/app/home?budget=edit&from=monitoring");
  const sent = [];
  await deliverOutbox(store, DUE + 2 * MINUTE, { telegram: { accountByWallet: async () => ACCOUNT, send: async (chatId, text, keyboard) => sent.push({ text, keyboard }) } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "Ryntra\nБюджет місяця вичерпано\nВитрачено $10 з $10. Правила стоять до 1-го числа — або зміни бюджет.\n\nhttps://ryntra.io/app/home?budget=edit");
  assert.deepEqual(sent[0].keyboard, [[{ text: "Змінити бюджет", url: "https://ryntra.io/app/home?budget=edit" }]]);
  /* The rule list says it: $10 of $10, spent. */
  const listed = await listRules(store, OWNER, deps({ nowMs: DUE + 3 * MINUTE }));
  assert.ok(RuleListResponseSchema.safeParse({ address: OWNER, rules: [...listed.rules], total: listed.total, budget: listed.budget }).success);
  assert.deepEqual([listed.budget.spentUsd, listed.budget.unknownUsd, listed.budget.remainingUsd, listed.budget.exhausted], [10, 0, 0, true]);
  assert.equal(listed.rules[0].occurrences[0].state, "held");
  /* The order route refuses what the budget does not cover, and a held occurrence buys nothing. */
  const read = await readRule(store, OWNER, WEEK_ID);
  const order = { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: AAPLX, amountRaw: usdToUsdcRaw(10) };
  assert.equal(judgeRuleOrder(read, { ruleId: WEEK_ID, dueAt: iso(DUE) }, order, [], DUE + 5 * MINUTE).code, "RULE_NOT_DUE");
  /* 1 October: a new month, and the rule reminds on its day. */
  const october = Date.parse("2026-10-01T16:02:00.000Z");
  const next = await tickAutoinvest(store, october);
  assert.deepEqual([next.reminded, next.held], [1, 0]);
  assert.equal((await listInbox(store, OWNER)).length, 2);
  assert.equal((await readBudget(store, OWNER, deps({ nowMs: october }))).exhausted, false);
});

test("the budget note is written once per month and ceiling; a larger ceiling spent again is a new one; removing the ceiling holds nothing", async () => {
  const store = createMemoryGuardStore();
  const DAILY_ID = "rule_da11da11da11da11da11da11da11da11";
  const daily = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 10, schedule: { cadence: "daily", weekday: null, monthDay: null, time: "19:00", timeZone: KYIV }, locale: "en" }, deps({ ruleId: DAILY_ID }));
  assert.ok(daily.ok);
  await setBudget(store, OWNER, { capUsd: 10, timeZone: KYIV, locale: "en" }, deps());
  await purchase(store, DAILY_ID, "2026-09-10T16:00:00.000Z", { usd: 10, at: Date.parse("2026-09-10T16:05:00.000Z") });
  const budgetNotes = async () => (await listInbox(store, OWNER)).filter((row) => row.subject?.kind === "autoinvest-budget");
  assert.equal((await tickAutoinvest(store, DUE + 2 * MINUTE)).held, 1);
  assert.equal((await budgetNotes()).length, 1);
  /* Friday's due is held too — the same month, the same ceiling: no second note. */
  assert.equal((await tickAutoinvest(store, DUE + 24 * HOUR + 2 * MINUTE)).held, 1);
  assert.equal((await budgetNotes()).length, 1);
  /* A larger ceiling: Saturday fits and reminds; once it is spent too, Sunday's held due writes a new note. */
  await setBudget(store, OWNER, { capUsd: 20, timeZone: KYIV, locale: "en" }, deps());
  assert.equal((await tickAutoinvest(store, DUE + 48 * HOUR + 2 * MINUTE)).reminded, 1);
  await purchase(store, DAILY_ID, iso(DUE + 48 * HOUR), { usd: 10 });
  assert.equal((await tickAutoinvest(store, DUE + 72 * HOUR + 2 * MINUTE)).held, 1);
  const two = await budgetNotes();
  assert.equal(two.length, 2);
  assert.equal(two[0].reason, "$20 of $20 spent. Rules stand until the 1st — or change the budget.");
  const cleared = await clearBudget(store, OWNER, deps());
  assert.ok(cleared.ok);
  assert.deepEqual([cleared.budget.capUsd, cleared.budget.remainingUsd, cleared.budget.exhausted, cleared.budget.timeZone], [null, null, false, KYIV]);
  const reminded = await tickAutoinvest(store, DUE + 96 * HOUR + 2 * MINUTE);
  assert.equal(reminded.reminded, 1, "without a ceiling the rule reminds");
  /* The request: dollars and cents from $1 (1.16.0), a real zone. */
  assert.ok(RuleBudgetRequestSchema.safeParse({ capUsd: 100, timeZone: KYIV }).success);
  assert.equal(RuleBudgetRequestSchema.parse({ capUsd: 100, timeZone: KYIV }).locale, "en");
  assert.ok(RuleBudgetRequestSchema.safeParse({ capUsd: 1, timeZone: KYIV }).success, "a dollar");
  assert.ok(RuleBudgetRequestSchema.safeParse({ capUsd: 31, timeZone: KYIV }).success, "«щодня по $1» for the longest month");
  for (const capUsd of [0.99, 10.005, 2_000_000]) assert.ok(!RuleBudgetRequestSchema.safeParse({ capUsd, timeZone: KYIV }).success, String(capUsd));
  assert.ok(!RuleBudgetRequestSchema.safeParse({ capUsd: 100, timeZone: "Mars/Olympus" }).success);
});

test("a crossing the budget holds is recorded once and reminded the moment the purchase fits — a larger budget, or the 1st", async () => {
  const store = createMemoryGuardStore();
  await writeDip(store, { amountUsd: 20 });
  await setBudget(store, OWNER, { capUsd: 10, timeZone: KYIV, locale: "uk" }, deps());
  const crossing = NOW + 20 * MINUTE;
  const tick = (price, atMs) => tickAutoinvest(store, atMs, { markets: marketsAt(price, atMs) });
  const held = await tick(185, crossing);
  assert.deepEqual([held.reminded, held.held], [0, 1]);
  let record = await readRule(store, OWNER, DIP_ID);
  assert.deepEqual([record.dip.armed, record.dip.heldAt, record.occurrences.at(-1).state], [true, iso(crossing), "held"]);
  assert.equal((await tick(184, crossing + 5 * MINUTE)).held, 0, "the same crossing is held once");
  assert.equal((await readRule(store, OWNER, DIP_ID)).occurrences.length, 1);
  const budgetNotes = (await listInbox(store, OWNER)).filter((row) => row.subject?.kind === "autoinvest-budget");
  assert.equal(budgetNotes.length, 1);
  /* The person raises the ceiling: the next pass reminds. */
  await setBudget(store, OWNER, { capUsd: 50, timeZone: KYIV, locale: "uk" }, deps());
  assert.equal((await tick(184, crossing + 10 * MINUTE)).reminded, 1);
  record = await readRule(store, OWNER, DIP_ID);
  assert.deepEqual([record.dip.armed, record.dip.heldAt, record.occurrences.at(-1).state], [false, null, "due"]);
  /* The order route: what is left decides. */
  const order = { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: AAPLX, amountRaw: usdToUsdcRaw(20) };
  const binding = { ruleId: DIP_ID, dueAt: record.occurrences.at(-1).dueAt };
  assert.ok(judgeRuleOrder(record, binding, order, [], crossing + 11 * MINUTE, 20).ok);
  assert.ok(judgeRuleOrder(record, binding, order, [], crossing + 11 * MINUTE, null).ok, "no ceiling, nothing to judge");
  const refused = judgeRuleOrder(record, binding, order, [], crossing + 11 * MINUTE, 19.99);
  assert.deepEqual([refused.code, refused.status], ["RULE_BUDGET_EXHAUSTED", 409]);
});

test("a «Якщо впаде» rule turned on again falls from the price now; a price nobody could read changes nothing", async () => {
  const store = createMemoryGuardStore();
  await writeDip(store);
  const paused = await setRuleStatus(store, OWNER, DIP_ID, "paused", deps());
  assert.equal(paused.rule.status, "paused");
  assert.equal((await tickAutoinvest(store, NOW + HOUR, { markets: marketsAt(150, NOW + HOUR) })).reminded, 0, "a paused rule reminds of nothing");
  const blind = await setRuleStatus(store, OWNER, DIP_ID, "active", deps({ nowMs: NOW + 2 * HOUR, price: null }));
  assert.equal(blind.code, "UNAVAILABLE");
  assert.equal((await readRule(store, OWNER, DIP_ID)).status, "paused");
  const resumed = await setRuleStatus(store, OWNER, DIP_ID, "active", deps({ nowMs: NOW + 2 * HOUR, price: 150, observedAt: iso(NOW + 2 * HOUR) }));
  assert.deepEqual([resumed.rule.status, resumed.rule.dip.anchorUsd, resumed.rule.dip.anchorFrom, resumed.rule.dip.triggerUsd, resumed.rule.dip.armed], ["active", 150, "enabled", 142.5, true]);
});

test("the monitoring surface says what became of each reminder — open, bought, missed — and carries the budget's note, in the contract's shape", async () => {
  const store = createMemoryGuardStore();
  await writeWeekly(store);
  await tickAutoinvest(store, DUE + 2 * MINUTE, { ledger: async () => [] });
  let stateOf = await reminderStates(store, OWNER, DUE + 3 * MINUTE, { ledger: async () => [] });
  let notes = await listInbox(store, OWNER);
  let surface = composeMonitoringSurface([], notes, "uk", stateOf);
  assert.equal(surface.recent[0].ruleState, "due");
  await tickAutoinvest(store, DUE + 25 * HOUR, { ledger: async () => [] });
  stateOf = await reminderStates(store, OWNER, DUE + 25 * HOUR, { ledger: async () => [] });
  surface = composeMonitoringSurface([], await listInbox(store, OWNER), "uk", stateOf);
  assert.equal(surface.recent[0].ruleState, "missed");
  /* A bought reminder, and the budget's note beside it. */
  const bought = createMemoryGuardStore();
  await writeWeekly(bought);
  await tickAutoinvest(bought, DUE + 2 * MINUTE, { ledger: async () => [] });
  await purchase(bought, WEEK_ID, iso(DUE), { usd: 10 });
  await tickAutoinvest(bought, DUE + 10 * MINUTE);
  const written = await setBudget(bought, OWNER, { capUsd: 10, timeZone: KYIV, locale: "uk" }, deps());
  assert.ok(written.ok);
  assert.ok(await writeBudgetNote(bought, await readBudgetRecord(bought, OWNER), 10, DUE + 20 * MINUTE));
  assert.equal(await writeBudgetNote(bought, await readBudgetRecord(bought, OWNER), 10, DUE + 25 * MINUTE), false, "once per month and ceiling");
  stateOf = await reminderStates(bought, OWNER, DUE + HOUR);
  notes = await listInbox(bought, OWNER);
  surface = composeMonitoringSurface([], notes, "en", stateOf);
  const reminder = surface.recent.find((row) => row.subject?.kind === "autoinvest-rule");
  assert.equal(reminder.ruleState, "bought");
  const withPrefs = { ...surface, preferences: { telegram: true, push: true, quietHours: null } };
  assert.ok(MonitoringSurfaceResponseSchema.safeParse(withPrefs).success, JSON.stringify(MonitoringSurfaceResponseSchema.safeParse(withPrefs).error?.issues?.[0]));
  /* A note whose rule is gone says nothing of it. */
  const gone = composeMonitoringSurface([], notes, "en", () => null);
  assert.equal(gone.recent.find((row) => row.subject?.kind === "autoinvest-rule").ruleState, undefined);
});
