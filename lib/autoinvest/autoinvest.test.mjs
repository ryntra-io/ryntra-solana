// Run from repo root: node --test lib/autoinvest/autoinvest.test.mjs
/**
 * «Автоінвест» from the rule to the receipt: a rule written for a confirmed
 * company, the tick that reminds of it once, the reminder's Telegram message
 * and deep link, the purchase read back from History, the reminder that
 * passes into «Пропущено» and is never caught up, and the order route's check
 * of `origin.rule`. A memory store, a fixed clock, a fake bot; nothing
 * reaches a wallet.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AutoinvestRuleSchema, MonitoringSurfaceResponseSchema, RULE_LIST_LIMIT, RuleCreateRequestSchema } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { deliverOutbox } from "../monitoring/deliver.ts";
import { resolveInboxLink } from "../monitoring/inbox.ts";
import { listInbox, outboxOf } from "../monitoring/store.ts";
import { composeMonitoringSurface } from "../monitoring/surface.ts";
import { recordSolanaAction } from "../solana/action-ledger.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import { dueOfIdentity, reminderIdentity, rulePurchaseHref, ruleMonitorId, symbolOfIdentity } from "./links.ts";
import { judgeRuleOrder, openOccurrenceOf, projectRule, usdToUsdcRaw } from "./model.ts";
import { createRule, deleteRule, getRule, listRules, setRuleStatus } from "./service.ts";
import { insertRule, readRule } from "./store.ts";
import { tickAutoinvest } from "./tick.ts";

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const OTHER = "BxoQfrYTkfgFbNpgXGSoGSWvvcJCZqcxpierDrt1h7gZ";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const ACCOUNT = "3f2c1a9e-6d2b-4c1e-9a7f-0b8e5d4c3a21";
const SIGNATURE = "5".repeat(87);
const RULE_ID = "rule_0123456789abcdef0123456789abcdef";
/* Thursday 24 September 2026, 00:29 in Kyiv. */
const NOW = Date.parse("2026-09-23T21:29:00.000Z");
const iso = (ms) => new Date(ms).toISOString();
const WEEKLY_THU_19 = { cadence: "weekly", weekday: 4, monthDay: null, time: "19:00", timeZone: "Europe/Kyiv" };
/* The Thursday due, 19:00 Kyiv. */
const DUE = Date.parse("2026-09-24T16:00:00.000Z");

function stockRow(overrides = {}) {
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
      ...overrides.representation,
    },
    lifecycle: { tradable: true, ...overrides.lifecycle },
  };
}

function deps(overrides = {}) {
  return {
    now: () => new Date(overrides.nowMs ?? NOW),
    findRow: overrides.findRow ?? (async (mint) => ({ ok: true, row: mint === AAPLX ? stockRow(overrides.row) : null, universe: null })),
    lifecycle: overrides.lifecycle ?? (() => null),
    ruleId: overrides.ruleId ?? (() => RULE_ID),
    ...(overrides.ledger ? { ledger: overrides.ledger } : {}),
  };
}

async function writeRule(store, overrides = {}) {
  const created = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 10, schedule: WEEKLY_THU_19, locale: "uk", ...overrides.input }, deps(overrides));
  assert.ok(created.ok, JSON.stringify(created));
  return created.rule;
}

async function seedTelegramChannel(store) {
  await store.collection("notificationChannels").set(ACCOUNT, {
    schema: "ryntra.notification-channel",
    schemaVersion: "1.0.0",
    version: 0,
    accountId: ACCOUNT,
    telegramId: 700000001,
    username: "owner",
    connectedAt: iso(NOW),
  });
}

function fakeTelegram(sent) {
  return {
    accountByWallet: async (_chain, address) => (address === OWNER ? ACCOUNT : null),
    send: async (chatId, text, keyboard) => {
      sent.push({ chatId, text, keyboard });
      return { message_id: sent.length };
    },
  };
}

/** A settled purchase under the reminder, as the execute route writes History: the rule binding on the row's origin. */
async function settlePurchase(store, dueAt, outcome = "DONE", at = DUE + 10 * 60_000) {
  return recordSolanaAction(store, {
    network: "mainnet",
    wallet: OWNER,
    actionId: SIGNATURE,
    lane: "SWAP",
    outcome,
    out: { mint: SOLANA_MAINNET_USDC_MINT, amountRaw: "10000000", decimals: null, symbol: null },
    in: { mint: AAPLX, amountRaw: "2976190", decimals: null, symbol: null },
    signature: SIGNATURE,
    origin: { surface: "SPOT", side: "BUY", rule: { ruleId: RULE_ID, dueAt } },
    now: iso(at),
  });
}

test("a rule is written for a confirmed company: the company's name, its sum, and the first due on the person's clock", async () => {
  const store = createMemoryGuardStore();
  const rule = await writeRule(store);
  assert.ok(AutoinvestRuleSchema.safeParse(rule).success, "the rule is the contract's shape");
  assert.equal(rule.name, "Apple");
  assert.equal(rule.asset.symbol, "AAPLx");
  assert.equal(rule.status, "active");
  assert.equal(rule.nextDueAt, iso(DUE), "the first reminder is Thursday 19:00 in Kyiv");
  assert.deepEqual(rule.occurrences, []);
  const listed = await listRules(store, OWNER, deps());
  assert.equal(listed.total, 1);
  assert.equal((await listRules(store, OTHER, deps())).total, 0, "another wallet reads nothing");
  assert.equal((await getRule(store, OTHER, RULE_ID, deps())).code, "RULE_NOT_FOUND");
});

test("a rule never names what nobody confirms or nobody sells, and a wallet holds a bounded number of them", async () => {
  const store = createMemoryGuardStore();
  const unknown = await createRule(store, { owner: OWNER, mint: OTHER, amountUsd: 10, schedule: WEEKLY_THU_19, locale: "en" }, deps());
  assert.equal(unknown.code, "ASSET_UNCONFIRMED");
  const halted = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 10, schedule: WEEKLY_THU_19, locale: "en" }, deps({ row: { representation: { tradingHalted: true } } }));
  assert.equal(halted.code, "ASSET_UNCONFIRMED");
  const closed = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 10, schedule: WEEKLY_THU_19, locale: "en" }, deps({ lifecycle: () => ({ state: "conversion-closed", note: "The issuer stopped new purchases." }) }));
  assert.deepEqual([closed.code, closed.message], ["ASSET_UNCONFIRMED", "The issuer stopped new purchases."]);
  const down = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 10, schedule: WEEKLY_THU_19, locale: "en" }, deps({ findRow: async () => ({ ok: false, reason: "The universe did not answer." }) }));
  assert.equal(down.code, "UNAVAILABLE", "a catalogue that did not answer is not a refusal of the company");
  let counter = 0;
  for (let index = 0; index < RULE_LIST_LIMIT; index += 1) {
    const made = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 10, schedule: WEEKLY_THU_19, locale: "en" }, deps({ ruleId: () => `rule_${String(counter++).padStart(32, "0")}` }));
    assert.ok(made.ok);
  }
  const over = await createRule(store, { owner: OWNER, mint: AAPLX, amountUsd: 10, schedule: WEEKLY_THU_19, locale: "en" }, deps({ ruleId: () => "rule_ffffffffffffffffffffffffffffffff" }));
  assert.equal(over.code, "RULE_LIMIT_REACHED");
});

test("the request is dollars and cents from $1, one day for its cadence, and a real time zone", () => {
  const ok = { asset: { mint: AAPLX }, amountUsd: 10, schedule: WEEKLY_THU_19 };
  assert.ok(RuleCreateRequestSchema.safeParse(ok).success);
  assert.equal(RuleCreateRequestSchema.parse(ok).locale, "en");
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ok, amountUsd: 0.99 }).success, "under the minimum");
  /* «Кожний день по долару» (contract 1.16.0): a dollar is a rule's sum. */
  assert.ok(RuleCreateRequestSchema.safeParse({ ...ok, amountUsd: 1, schedule: { cadence: "daily", weekday: null, monthDay: null, time: "09:00", timeZone: "Europe/Kyiv" } }).success, "$1 a day");
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ok, amountUsd: 10.005 }).success, "less than a cent");
  assert.ok(RuleCreateRequestSchema.safeParse({ ...ok, amountUsd: 12.5 }).success);
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ok, schedule: { ...WEEKLY_THU_19, weekday: null } }).success, "a weekly rule without its day");
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ok, schedule: { ...WEEKLY_THU_19, cadence: "daily" } }).success, "a daily rule naming a weekday");
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ok, schedule: { ...WEEKLY_THU_19, timeZone: "Mars/Olympus" } }).success);
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ok, schedule: { ...WEEKLY_THU_19, time: "7pm" } }).success);
});

test("the tick reminds once when the rule falls due: one note in the inbox, one Telegram and one push delivery, never a second", async () => {
  const store = createMemoryGuardStore();
  await writeRule(store);
  const early = await tickAutoinvest(store, DUE - 60_000, { ledger: async () => [] });
  assert.equal(early.reminded, 0, "nothing before the day and the time");
  const first = await tickAutoinvest(store, DUE + 2 * 60_000, { ledger: async () => [] });
  assert.equal(first.reminded, 1);
  const again = await tickAutoinvest(store, DUE + 7 * 60_000, { ledger: async () => [] });
  assert.equal(again.reminded, 0, "a second pass writes nothing");
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1);
  const note = notes[0];
  assert.equal(note.title, "Час твоєї покупки: $10 в Apple", "written in the rule's language");
  assert.equal(note.reason, "Щотижня · чт о 19:00. Один дотик — свіжа «Перевірка», купує лише твій підпис.");
  assert.equal(note.cta, "Купити $10");
  assert.equal(note.text.en.title, "Time for your purchase: $10 of Apple");
  assert.deepEqual(note.subject, { kind: "autoinvest-rule", id: RULE_ID });
  assert.equal(note.monitorId, ruleMonitorId(RULE_ID));
  assert.equal(note.triggerId, reminderIdentity(RULE_ID, iso(DUE), "AAPLx"));
  assert.equal(symbolOfIdentity(note.triggerId), "AAPLx", "the note keeps its company, whatever becomes of the rule");
  const deliveries = await outboxOf(store).valuesWithPrefix("");
  assert.deepEqual(deliveries.map((row) => row.channel).sort(), ["push", "telegram"]);
  const record = await readRule(store, OWNER, RULE_ID);
  assert.equal(record.nextDueAt, "2026-10-01T16:00:00.000Z", "the next due is a week on");
  assert.deepEqual(record.occurrences.map((row) => [row.dueAt, row.state, row.openUntil]), [[iso(DUE), "due", "2026-09-25T16:00:00.000Z"]]);
  /* The note is the monitoring surface's shape on the wire, in both languages. */
  const surface = { ...composeMonitoringSurface([], notes, "en"), preferences: { telegram: true, push: true, quietHours: null } };
  assert.ok(MonitoringSurfaceResponseSchema.safeParse(surface).success, JSON.stringify(MonitoringSurfaceResponseSchema.safeParse(surface).error?.issues?.[0]));
  assert.equal(surface.recent[0].title, "Time for your purchase: $10 of Apple");
});

test("the reminder reaches Telegram in the rule's words, with the action on the button and the link straight to the purchase", async () => {
  const store = createMemoryGuardStore();
  await writeRule(store);
  await seedTelegramChannel(store);
  await tickAutoinvest(store, DUE + 2 * 60_000, { ledger: async () => [] });
  const sent = [];
  await deliverOutbox(store, DUE + 2 * 60_000, { telegram: fakeTelegram(sent) });
  assert.equal(sent.length, 1);
  const link = `https://ryntra.io/app/stocks/AAPLx?rule=${RULE_ID}&due=${encodeURIComponent(iso(DUE))}`;
  assert.equal(sent[0].text, `Ryntra\nЧас твоєї покупки: $10 в Apple\nЩотижня · чт о 19:00. Один дотик — свіжа «Перевірка», купує лише твій підпис.\n\n${link}`);
  assert.deepEqual(sent[0].keyboard, [[{ text: "Купити $10", url: link }]]);
  assert.doesNotMatch(sent[0].text, /\bRyn\b/);
  const telegram = (await outboxOf(store).valuesWithPrefix("")).find((row) => row.channel === "telegram");
  assert.equal(telegram.state, "sent");
  /* The note's own deep link lands on the same purchase and marks the note read. */
  const [note] = await listInbox(store, OWNER);
  assert.equal(await resolveInboxLink(store, OWNER, note.id), `${rulePurchaseHref({ id: RULE_ID, asset: { symbol: "AAPLx" } }, iso(DUE))}&from=monitoring`);
  assert.equal((await listInbox(store, OWNER))[0].unread, false);
  assert.equal(await resolveInboxLink(store, OTHER, note.id), null, "another wallet's note is not found");
  assert.equal(dueOfIdentity(note.triggerId, RULE_ID), iso(DUE));
  /* The rule removed since: the note leads to its company — a plain purchase — never back to Monitoring in a loop. */
  assert.ok((await deleteRule(store, OWNER, RULE_ID)).ok);
  assert.equal(await resolveInboxLink(store, OWNER, note.id), "/app/stocks/AAPLx");
});

test("a purchase under the reminder is read back from History: pending while it travels, bought with its dollars once settled", async () => {
  const store = createMemoryGuardStore();
  await writeRule(store);
  await tickAutoinvest(store, DUE + 2 * 60_000);
  await settlePurchase(store, iso(DUE), "IN_FLIGHT");
  let rule = (await getRule(store, OWNER, RULE_ID, deps({ nowMs: DUE + 5 * 60_000 }))).rule;
  assert.equal(rule.occurrences[0].state, "pending");
  /* The day passes with the purchase still travelling: it is not missed. */
  await tickAutoinvest(store, DUE + 25 * 3_600_000);
  assert.equal((await readRule(store, OWNER, RULE_ID)).occurrences[0].state, "due");
  await settlePurchase(store, iso(DUE), "DONE", DUE + 25 * 3_600_000 + 1_000);
  await tickAutoinvest(store, DUE + 25 * 3_600_000 + 60_000);
  const stored = (await readRule(store, OWNER, RULE_ID)).occurrences[0];
  assert.deepEqual([stored.state, stored.signature, stored.spentUsd], ["bought", SIGNATURE, 10]);
  rule = (await getRule(store, OWNER, RULE_ID, deps({ nowMs: DUE + 26 * 3_600_000 }))).rule;
  assert.equal(rule.occurrences[0].state, "bought");
  assert.ok(AutoinvestRuleSchema.safeParse(rule).success);
});

test("a reminder whose day passes without a signature is «Пропущено»; a service down for weeks reminds only of the latest due, never a backlog", async () => {
  const store = createMemoryGuardStore();
  await writeRule(store);
  await tickAutoinvest(store, DUE + 2 * 60_000, { ledger: async () => [] });
  await tickAutoinvest(store, DUE + 24 * 3_600_000 + 60_000, { ledger: async () => [] });
  assert.equal((await readRule(store, OWNER, RULE_ID)).occurrences[0].state, "missed");
  /* Three weeks of silence, then a tick on the fourth Thursday at 19:03. */
  const later = Date.parse("2026-10-22T16:03:00.000Z");
  const tick = await tickAutoinvest(store, later, { ledger: async () => [] });
  assert.equal(tick.reminded, 1, "one reminder — the latest");
  const record = await readRule(store, OWNER, RULE_ID);
  assert.deepEqual(record.occurrences.map((row) => [row.dueAt, row.state]), [[iso(DUE), "missed"], ["2026-10-22T16:00:00.000Z", "due"]], "the three Thursdays between are never caught up");
  assert.equal((await listInbox(store, OWNER)).length, 2);
  /* A tick that finds the latest due already past its day writes it missed and reminds of nothing. */
  const store2 = createMemoryGuardStore();
  await writeRule(store2);
  const stale = await tickAutoinvest(store2, DUE + 30 * 3_600_000, { ledger: async () => [] });
  assert.equal(stale.reminded, 0);
  assert.equal((await readRule(store2, OWNER, RULE_ID)).occurrences[0].state, "missed");
  assert.equal((await listInbox(store2, OWNER)).length, 0);
});

test("a paused rule reminds of nothing; turned on again, it counts from now", async () => {
  const store = createMemoryGuardStore();
  await writeRule(store);
  const paused = await setRuleStatus(store, OWNER, RULE_ID, "paused", deps());
  assert.deepEqual([paused.rule.status, paused.rule.nextDueAt], ["paused", null]);
  assert.equal((await tickAutoinvest(store, DUE + 2 * 60_000, { ledger: async () => [] })).reminded, 0);
  const resumed = await setRuleStatus(store, OWNER, RULE_ID, "active", deps({ nowMs: DUE + 3 * 3_600_000 }));
  assert.equal(resumed.rule.nextDueAt, "2026-10-01T16:00:00.000Z", "the Thursday it was paused over is not caught up");
  assert.equal((await setRuleStatus(store, OWNER, "rule_ffffffffffffffffffffffffffffffff", "paused", deps())).code, "RULE_NOT_FOUND");
  const removed = await deleteRule(store, OWNER, RULE_ID);
  assert.ok(removed.ok);
  assert.equal(await readRule(store, OWNER, RULE_ID), null);
  assert.equal((await deleteRule(store, OWNER, RULE_ID)).code, "RULE_NOT_FOUND");
});

test("the order route buys under a reminder only while it is open, only the rule's own purchase, and never twice", async () => {
  const store = createMemoryGuardStore();
  await writeRule(store);
  await tickAutoinvest(store, DUE + 2 * 60_000, { ledger: async () => [] });
  const record = await readRule(store, OWNER, RULE_ID);
  const order = { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: AAPLX, amountRaw: usdToUsdcRaw(10) };
  const binding = { ruleId: RULE_ID, dueAt: iso(DUE) };
  const now = DUE + 5 * 60_000;
  assert.equal(usdToUsdcRaw(10), "10000000");
  assert.equal(usdToUsdcRaw(12.34), "12340000");
  assert.ok(judgeRuleOrder(record, binding, order, [], now).ok);
  assert.equal(openOccurrenceOf(record, [], now).dueAt, iso(DUE));
  assert.equal(judgeRuleOrder(null, binding, order, [], now).code, "RULE_NOT_FOUND");
  assert.equal(judgeRuleOrder(record, { ...binding, dueAt: "2026-09-17T16:00:00.000Z" }, order, [], now).code, "RULE_NOT_DUE", "a due the rule never had");
  assert.equal(judgeRuleOrder(record, binding, { ...order, amountRaw: "20000000" }, [], now).code, "RULE_MISMATCH", "another sum");
  assert.equal(judgeRuleOrder(record, binding, { ...order, outputMint: OTHER }, [], now).code, "RULE_MISMATCH", "another company");
  assert.equal(judgeRuleOrder(record, binding, order, [], DUE + 25 * 3_600_000).code, "RULE_NOT_DUE", "the day has passed");
  assert.equal(judgeRuleOrder({ ...record, status: "paused" }, binding, order, [], now).code, "RULE_NOT_DUE");
  await settlePurchase(store, iso(DUE), "IN_FLIGHT");
  const { listSolanaWalletActions } = await import("../solana/action-ledger.ts");
  const rows = (await listSolanaWalletActions(store, { network: "mainnet", wallet: OWNER })).actions;
  const onItsWay = judgeRuleOrder(record, binding, order, rows, now);
  assert.equal(onItsWay.code, "RULE_NOT_DUE", "a purchase on its way is not bought twice");
  assert.match(onItsWay.message, /on its way/);
  assert.equal(openOccurrenceOf(record, rows, now), null);
  const projected = projectRule(record, rows, now);
  assert.equal(projected.occurrences[0].state, "pending");
});

/* A token Ryntra no longer supports is named by no new rule, and a rule written on one before reminds of nothing. */
test("a token Ryntra no longer supports: no new rule names it, and an old rule on it opens nothing and reminds of nothing", async () => {
  const RETIRED = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
  const store = createMemoryGuardStore();
  let asked = 0;
  const refused = await createRule(store, { owner: OWNER, mint: RETIRED, amountUsd: 10, schedule: WEEKLY_THU_19, locale: "uk" }, deps({ findRow: async () => { asked += 1; return { ok: true, row: null, universe: null }; } }));
  assert.equal(refused.code, "ASSET_UNCONFIRMED");
  assert.match(refused.message, /No longer supported in Ryntra/);
  assert.equal(asked, 0, "no provider is asked about it");
  /* A rule written before the disconnection, as the store holds it. */
  const written = await writeRule(store);
  const record = await readRule(store, OWNER, written.id);
  const OLD_ID = "rule_ffffffffffffffffffffffffffffff00";
  assert.ok(await insertRule(store, { ...record, id: OLD_ID, asset: { ...record.asset, mint: RETIRED, symbol: "tOpenAI" } }));
  const tick = await tickAutoinvest(store, DUE + 2 * 60_000, { ledger: async () => [] });
  assert.equal(tick.reminded, 1, "the rule on a supported company still reminds");
  const notes = await listInbox(store, OWNER);
  assert.deepEqual(notes.map((note) => note.subject.id), [written.id], "no note names the retired token's rule");
  const old = await readRule(store, OWNER, OLD_ID);
  assert.deepEqual(old.occurrences, [], "nothing was opened on it");
});
