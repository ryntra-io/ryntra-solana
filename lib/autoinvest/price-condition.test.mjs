// Run from repo root: node --test lib/autoinvest/price-condition.test.mjs
/**
 * «Умова ціни»: a rule buys only when the price is not above its reference
 * by more than the person's limit and the data are fresh; otherwise «Купівлю
 * відкладено» with the reason, the figure and the data's time, and the rule
 * judges it again while the occurrence is open. The limit, the freshness,
 * wait-or-buy through the tick for «Регулярно» and «Якщо впаде», the order
 * route's own judgement, the note, the deep link and the contract. A memory
 * store, a fixed clock, facts handed in; nothing reaches a wallet.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AutoinvestRuleSchema, MonitoringSurfaceResponseSchema, RuleConditionCheckSchema, RuleCreateRequestSchema, RULE_OCCURRENCE_STATES } from "../api/v1/contract.ts";
import { createMemoryGuardStore } from "../guard/store.ts";
import { resolveInboxLink } from "../monitoring/inbox.ts";
import { listInbox, outboxOf } from "../monitoring/store.ts";
import { composeMonitoringSurface } from "../monitoring/surface.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import { deferralIdentity, dueOfIdentity, isDeferralIdentity, reminderIdentity, symbolOfIdentity } from "./links.ts";
import { judgeRuleOrder, projectRule, usdToUsdcRaw } from "./model.ts";
import {
  PRICE_CONDITION_DEFAULT_PCT,
  PRICE_CONDITION_MAX_AGE_MS,
  checkPriceCondition,
  conditionLine,
  deferralWords,
  deviationOf,
  priceFactsOf,
  referenceKindOf,
} from "./price-condition.ts";
import { createRule, listRules, reminderStates, setBudget } from "./service.ts";
import { readRule } from "./store.ts";
import { tickAutoinvest } from "./tick.ts";

const OWNER = "F9pV233uBksW4U1BKiK7u9qShgXkwoR6F8MzU4FZYPUv";
const OPENAI = "PreXw8Zq2vGm5hT3sD9kLpN4rB6cY7eF1aJuWxQzRs";
const AAPLX = "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp";
const RULE_ID = "rule_c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0";
const KYIV = "Europe/Kyiv";
const MINUTE = 60_000;
const HOUR = 3_600_000;
const iso = (ms) => new Date(ms).toISOString();
/* Thursday 24 September 2026, 00:29 in Kyiv. */
const NOW = Date.parse("2026-09-23T21:29:00.000Z");
const WEEKLY_THU_19 = { cadence: "weekly", weekday: 4, monthDay: null, time: "19:00", timeZone: KYIV };
/* The Thursday due, 19:00 Kyiv. */
const DUE = Date.parse("2026-09-24T16:00:00.000Z");

/** OpenAI through PreStocks: priced per token, PreStocks' valuation of one token beside it. */
function openaiRow({ price = 1300, mark = 1000, observedAt = iso(NOW), fetchedAt = iso(NOW), stale = false } = {}) {
  return {
    representation: {
      mint: OPENAI,
      symbol: "OPENAI",
      name: "OpenAI PreStock",
      issuer: { id: "prestocks", label: "PreStocks" },
      underlying: { symbol: "OPENAI", name: "OpenAI" },
      decimals: 9,
      instrument: { class: "pre-ipo", unitBasis: "token" },
      tradingHalted: false,
    },
    lifecycle: { tradable: true },
    market: { priceUsd: price, observedAt },
    multiplier: { current: 1, pending: null, effectiveAt: null },
    tokenPerShareUsd: null,
    reference: { state: "unavailable", perShare: null, currency: "USD", source: { id: "none", label: "" }, observedAt: null, fetchedAt: null, note: null },
    issuerMark: { source: { id: "issuer-prestocks", label: "PreStocks" }, perUnit: mark, valuationUsd: null, impliedValuationUsd: null, supply: null, holders: null, observedAt: null, fetchedAt, stale },
  };
}

/** Apple through xStocks: priced per share against the issuer's reference per share. */
function appleRow({ price = 200.8, reference = 200, observedAt = iso(NOW), referenceAt = iso(NOW), state = "current", source = "issuer-xstocks" } = {}) {
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
    tokenPerShareUsd: price,
    reference: { state, perShare: reference, currency: "USD", source: { id: source, label: "xStocks" }, observedAt: null, fetchedAt: referenceAt, note: null },
    issuerMark: null,
  };
}

function deps(rows, overrides = {}) {
  return {
    now: () => new Date(overrides.nowMs ?? NOW),
    findRow: async (mint) => ({ ok: true, row: rows[mint] ?? null, universe: { marketsObservedAt: iso(NOW) } }),
    lifecycle: () => null,
    ruleId: () => overrides.ruleId ?? RULE_ID,
    ...(overrides.ledger ? { ledger: overrides.ledger } : {}),
  };
}

/** The facts a condition is judged on: a price `deviation` per cent from a reference of `ref`, each dated. */
function facts({ deviation = 30, ref = 1000, priceAt = DUE, referenceAt = DUE, reference = "prestocks", stale = false } = {}) {
  return { reference, priceUsd: Math.round(ref * (1 + deviation / 100) * 1e6) / 1e6, priceAtMs: priceAt, referenceUsd: ref, referenceAtMs: referenceAt, referenceStale: stale };
}

/** The tick's reads, handed in: the condition's facts, and a «Якщо впаде» rule's price. */
function marketsWith(condition, price = null) {
  return async (mints) => new Map(mints.map((mint) => [mint, { price, multiplier: 1, condition }]));
}

async function writeWeekly(store, { mint = OPENAI, limitPct = 5, amountUsd = 10, rows = { [OPENAI]: openaiRow(), [AAPLX]: appleRow() } } = {}) {
  const created = await createRule(store, { owner: OWNER, mint, amountUsd, schedule: WEEKLY_THU_19, priceCondition: limitPct === null ? null : { limitPct }, locale: "uk" }, deps(rows));
  assert.ok(created.ok, JSON.stringify(created));
  return created.rule;
}

/* ------------------------------------------------------------ the limit and the freshness */

test("the limit: a price up to N % above its reference passes, above it waits; a discount always passes; the figure compared is the one a person reads", () => {
  const at = DUE;
  assert.equal(checkPriceCondition(5, facts({ deviation: 30 }), at).verdict, "above", "OpenAI 30 % above PreStocks' valuation, limit 5 %");
  assert.equal(checkPriceCondition(5, facts({ deviation: 4.9 }), at).verdict, "met");
  assert.equal(checkPriceCondition(5, facts({ deviation: 5 }), at).verdict, "met", "exactly the limit is not more than it");
  assert.equal(checkPriceCondition(5, facts({ deviation: 5.04 }), at).verdict, "met", "«на 5,0 %» never waits on a 5 % limit");
  assert.equal(checkPriceCondition(5, facts({ deviation: 5.06 }), at).verdict, "above", "5.1 % is more than 5 %");
  assert.equal(checkPriceCondition(5, facts({ deviation: -21 }), at).verdict, "met", "SpaceX 21 % below its valuation: a discount passes");
  assert.equal(checkPriceCondition(50, facts({ deviation: 30 }), at).verdict, "met", "the limit is the person's");
  const check = checkPriceCondition(5, facts({ deviation: 30, priceAt: at - MINUTE, referenceAt: at - 5 * MINUTE }), at);
  assert.deepEqual(check, { reference: "prestocks", limitPct: 5, priceUsd: 1300, referenceUsd: 1000, checkedAt: iso(at), deviationPct: 30, dataAt: iso(at - 5 * MINUTE), verdict: "above" });
  assert.ok(RuleConditionCheckSchema.safeParse(check).success, "the contract carries the judgement as it is");
  assert.equal(deviationOf(200.8, 200), 0.4);
  assert.equal(deviationOf(null, 200), null);
  assert.equal(PRICE_CONDITION_DEFAULT_PCT, 5, "«типово 5 %», by default 5 %");
});

test("fresh or nothing: a price or a reference older than half an hour, a copy its source calls stale, a figure or a time missing — the rule waits, never buys", () => {
  const at = DUE;
  const edge = at - PRICE_CONDITION_MAX_AGE_MS;
  assert.equal(checkPriceCondition(5, facts({ deviation: 1, priceAt: edge, referenceAt: edge }), at).verdict, "met", "exactly half an hour old still decides");
  assert.equal(checkPriceCondition(5, facts({ deviation: 1, priceAt: edge - 1 }), at).verdict, "stale", "the price is too old");
  assert.equal(checkPriceCondition(5, facts({ deviation: 1, referenceAt: at - 2 * HOUR }), at).verdict, "stale", "the reference is too old");
  assert.equal(checkPriceCondition(5, facts({ deviation: 1, stale: true }), at).verdict, "stale", "PreStocks' catalogue served under grace");
  assert.equal(checkPriceCondition(5, facts({ deviation: 30, priceAt: at - 2 * HOUR }), at).verdict, "stale", "old data are not judged above or below — they are old");
  assert.equal(checkPriceCondition(5, { ...facts({ deviation: 1 }), priceAtMs: null }, at).verdict, "stale", "a price nobody dated is not fresh");
  assert.equal(checkPriceCondition(5, { ...facts(), referenceUsd: null }, at).verdict, "unavailable");
  assert.equal(checkPriceCondition(5, { ...facts(), priceUsd: null }, at).verdict, "unavailable");
  assert.equal(checkPriceCondition(5, { ...facts(), reference: null }, at).verdict, "unavailable", "a company with no reference never passes");
  assert.equal(checkPriceCondition(5, null, at).verdict, "unavailable", "facts that could not be read never pass");
  const old = checkPriceCondition(5, facts({ deviation: 1, priceAt: at - 3 * HOUR, referenceAt: at - MINUTE }), at);
  assert.equal(old.dataAt, iso(at - 3 * HOUR), "the data are as new as their oldest part");
});

test("the facts a stock row states: PreStocks' valuation per token for a private company, the reference per share for a listed one, each with its own time", () => {
  const openai = priceFactsOf(openaiRow({ price: 1300, mark: 1000, observedAt: iso(DUE - MINUTE), fetchedAt: iso(DUE - 7 * MINUTE) }));
  assert.deepEqual(openai, { reference: "prestocks", priceUsd: 1300, priceAtMs: DUE - MINUTE, referenceUsd: 1000, referenceAtMs: DUE - 7 * MINUTE, referenceStale: false });
  assert.equal(priceFactsOf(openaiRow({ stale: true })).referenceStale, true);
  const apple = priceFactsOf(appleRow({ price: 200.8, reference: 200, observedAt: null, referenceAt: iso(DUE - 2 * MINUTE) }), DUE - 3 * MINUTE);
  assert.deepEqual(apple, { reference: "issuer", priceUsd: 200.8, priceAtMs: DUE - 3 * MINUTE, referenceUsd: 200, referenceAtMs: DUE - 2 * MINUTE, referenceStale: false }, "a price the row does not date takes the universe's read time, never the clock");
  assert.equal(priceFactsOf(appleRow({ state: "stale" })).referenceStale, true);
  assert.equal(referenceKindOf(appleRow({ source: "pyth" })), "market");
  assert.equal(referenceKindOf(appleRow({ source: "none" })), null);
  const blind = openaiRow();
  assert.equal(referenceKindOf({ ...blind, issuerMark: null }), null, "a private company without PreStocks' valuation has no reference");
  assert.equal(checkPriceCondition(5, priceFactsOf({ ...appleRow(), tokenPerShareUsd: null }), NOW).verdict, "unavailable", "a listed token whose multiplier nobody read has no per-share price");
});

test("the words: «Купівлю відкладено: OpenAI на 30 % дорожча за оцінку PreStocks (твій ліміт 5 %)», the figures and the data's time; old data and a missing reference say so", () => {
  const at = DUE + MINUTE;
  const above = checkPriceCondition(5, facts({ deviation: 30, priceAt: at - MINUTE, referenceAt: at - 5 * MINUTE }), at);
  const words = deferralWords({ name: "OpenAI", check: above, timeZone: KYIV, nowMs: at });
  assert.equal(words.uk.title, "Купівлю відкладено: OpenAI на 30 % дорожча за оцінку PreStocks (твій ліміт 5 %)");
  assert.equal(words.uk.reason, "Ціна $1 300,00 · Оцінка PreStocks $1 000,00 · дані 18:56. Правило перевірить знову.");
  assert.equal(words.uk.cta, "Подивитись");
  assert.equal(words.en.title, "Purchase deferred: OpenAI is 30% above PreStocks' valuation (your limit 5%)");
  assert.equal(words.en.reason, "Price $1,300.00 · PreStocks' valuation $1,000.00 · data at 18:56. The rule checks again.");
  const listed = deferralWords({ name: "Apple", check: checkPriceCondition(5, facts({ reference: "issuer", ref: 200, deviation: 6.2 }), DUE), timeZone: KYIV, nowMs: DUE });
  assert.equal(listed.uk.title, "Купівлю відкладено: Apple на 6,2 % дорожча за орієнтир емітента (твій ліміт 5 %)");
  const stale = deferralWords({ name: "Apple", check: checkPriceCondition(5, facts({ reference: "issuer", ref: 200, deviation: 1, priceAt: DUE - 26 * HOUR }), DUE), timeZone: KYIV, nowMs: DUE });
  assert.equal(stale.uk.title, "Купівлю відкладено: Apple — дані про ціну застаріли");
  assert.equal(stale.uk.reason, "Останні дані — 23 вер. о 17:00. На старих даних правило не купує. Правило перевірить знову.");
  const none = deferralWords({ name: "Apple", check: checkPriceCondition(5, null, DUE), timeZone: KYIV, nowMs: DUE });
  assert.equal(none.uk.title, "Купівлю відкладено: Apple — зараз немає орієнтира");
  assert.equal(conditionLine(5, "prestocks", "uk"), "Не купувати, якщо дорожче за оцінку PreStocks більш ніж на 5 %");
  assert.equal(conditionLine(5, "issuer", "en"), "Don't buy if it costs more than 5% above the issuer's reference");
  for (const text of [words.uk.title, words.en.title, words.uk.reason, words.en.reason]) assert.doesNotMatch(text, /справедлив|fair price/i, "PreStocks' valuation is never called a fair price");
});

/* ------------------------------------------------------------ wait or buy */

test("a rule on OpenAI with a 5 % limit waits and says why — one note with the figure and its time, no reminder, no Telegram; the order is refused", async () => {
  const store = createMemoryGuardStore();
  const rule = await writeWeekly(store);
  assert.deepEqual(rule.priceCondition, { limitPct: 5 });
  const at = DUE + MINUTE;
  const pass = await tickAutoinvest(store, at, { ledger: async () => [], markets: marketsWith(facts({ deviation: 30, priceAt: at - MINUTE, referenceAt: at - 5 * MINUTE })) });
  assert.equal(pass.deferred, 1);
  assert.equal(pass.reminded, 0, "nothing to buy");
  const record = await readRule(store, OWNER, RULE_ID);
  const [occurrence] = record.occurrences;
  assert.equal(occurrence.state, "deferred");
  assert.equal(occurrence.remindedAt, null);
  assert.equal(occurrence.openUntil, iso(DUE + 24 * HOUR), "it waits as long as a reminder would stay open");
  assert.deepEqual({ verdict: occurrence.condition.verdict, deviationPct: occurrence.condition.deviationPct, limitPct: occurrence.condition.limitPct, reference: occurrence.condition.reference, dataAt: occurrence.condition.dataAt }, { verdict: "above", deviationPct: 30, limitPct: 5, reference: "prestocks", dataAt: iso(at - 5 * MINUTE) });
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].title, "Купівлю відкладено: OpenAI на 30 % дорожча за оцінку PreStocks (твій ліміт 5 %)");
  assert.equal(notes[0].cta, "Подивитись");
  assert.deepEqual(notes[0].subject, { kind: "autoinvest-rule", id: RULE_ID });
  assert.equal(notes[0].triggerId, deferralIdentity(RULE_ID, iso(DUE), "OPENAI"));
  assert.equal((await outboxOf(store).valuesWithPrefix("")).length, 0, "the deferral lives in the inbox — the bell and Home's notifications — not in Telegram");
  /* The rule states it; the purchase is refused. */
  const [projected] = (await listRules(store, OWNER, deps({}, { ledger: async () => [], nowMs: at }))).rules;
  assert.ok(AutoinvestRuleSchema.safeParse(projected).success, JSON.stringify(AutoinvestRuleSchema.safeParse(projected).error?.issues?.[0]));
  assert.equal(projected.occurrences[0].state, "deferred");
  const order = { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: OPENAI, amountRaw: usdToUsdcRaw(10) };
  const refused = judgeRuleOrder(record, { ruleId: RULE_ID, dueAt: iso(DUE) }, order, [], at, null, facts({ deviation: 1, priceAt: at, referenceAt: at }));
  assert.equal(refused.code, "RULE_NOT_DUE", "a deferred occurrence is not open to buy, even if the price moved since");
  /* The note leads to the company with the rule and the occurrence; the surface says «deferred». */
  const link = await resolveInboxLink(store, OWNER, notes[0].id);
  assert.equal(link, `/app/stocks/OPENAI?rule=${RULE_ID}&due=${encodeURIComponent(iso(DUE))}&from=monitoring`);
  const stateOf = await reminderStates(store, OWNER, at, { ledger: async () => [] });
  assert.equal(stateOf(notes[0]), "deferred");
  const surface = composeMonitoringSurface([], notes, "uk", stateOf);
  assert.equal(surface.recent[0].ruleState, "deferred");
  const withPrefs = { ...surface, preferences: { telegram: true, push: true, quietHours: null } };
  assert.ok(MonitoringSurfaceResponseSchema.safeParse(withPrefs).success, JSON.stringify(MonitoringSurfaceResponseSchema.safeParse(withPrefs).error?.issues?.[0]));
});

test("the deferred purchase is judged again with the rule: the same reason stays silent, a new reason is kept, the condition met reminds «Купити $X за правилом»", async () => {
  const store = createMemoryGuardStore();
  await writeWeekly(store);
  const tick = (atMs, condition) => tickAutoinvest(store, atMs, { ledger: async () => [], markets: marketsWith(condition) });
  await tick(DUE + MINUTE, facts({ deviation: 30, priceAt: DUE + MINUTE, referenceAt: DUE }));
  const unchanged = (await readRule(store, OWNER, RULE_ID)).version;
  const again = await tick(DUE + 6 * MINUTE, facts({ deviation: 28, priceAt: DUE + 6 * MINUTE, referenceAt: DUE + 5 * MINUTE }));
  assert.equal(again.deferred + again.reminded, 0);
  assert.equal((await readRule(store, OWNER, RULE_ID)).version, unchanged, "still above the limit: nothing is rewritten, no second note");
  /* The data go old: the reason changes, kept on the occurrence, no new note. */
  await tick(DUE + 2 * HOUR, facts({ deviation: 1, priceAt: DUE + 2 * HOUR, referenceAt: DUE }));
  let record = await readRule(store, OWNER, RULE_ID);
  assert.equal(record.occurrences[0].state, "deferred");
  assert.equal(record.occurrences[0].condition.verdict, "stale");
  assert.equal((await listInbox(store, OWNER)).length, 1);
  /* Fresh data within the limit: the reminder, as every reminder. */
  const met = await tick(DUE + 3 * HOUR, facts({ deviation: 3, priceAt: DUE + 3 * HOUR - MINUTE, referenceAt: DUE + 3 * HOUR - 4 * MINUTE }));
  assert.equal(met.reminded, 1);
  record = await readRule(store, OWNER, RULE_ID);
  const [occurrence] = record.occurrences;
  assert.equal(occurrence.state, "due");
  assert.equal(occurrence.remindedAt, iso(DUE + 3 * HOUR));
  assert.equal(occurrence.openUntil, iso(DUE + 24 * HOUR), "the day's reminder keeps the day's end");
  assert.equal(occurrence.condition.verdict, "met");
  assert.equal(occurrence.condition.deviationPct, 3);
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 2);
  const reminder = notes.find((note) => note.triggerId === reminderIdentity(RULE_ID, iso(DUE), "OPENAI"));
  assert.equal(reminder.title, "Час твоєї покупки: $10 в OpenAI");
  assert.equal(reminder.cta, "Купити $10");
  /* The order route judges again on its own facts: met now buys, above or unread is refused. */
  const order = { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: OPENAI, amountRaw: usdToUsdcRaw(10) };
  const binding = { ruleId: RULE_ID, dueAt: iso(DUE) };
  const at = DUE + 3 * HOUR + 2 * MINUTE;
  assert.equal(judgeRuleOrder(record, binding, order, [], at, null, facts({ deviation: 3, priceAt: at, referenceAt: at })).ok, true);
  const dearer = judgeRuleOrder(record, binding, order, [], at, null, facts({ deviation: 8, priceAt: at, referenceAt: at }));
  assert.deepEqual([dearer.status, dearer.code], [409, "RULE_PRICE_CONDITION"]);
  assert.match(dearer.message, /8\.0% above its reference/);
  assert.equal(judgeRuleOrder(record, binding, order, [], at, null, null).code, "RULE_PRICE_CONDITION", "facts the route could not read never pass");
  assert.equal(judgeRuleOrder(record, binding, order, [], at, null, facts({ deviation: 1, priceAt: at - HOUR, referenceAt: at })).code, "RULE_PRICE_CONDITION", "old data never buy");
});

test("a rule on a listed stock within its limit offers «Купити $X за правилом» at once; stale data at the due wait; a rule with no condition reminds as before", async () => {
  const listed = createMemoryGuardStore();
  await writeWeekly(listed, { mint: AAPLX });
  const at = DUE + MINUTE;
  const pass = await tickAutoinvest(listed, at, { ledger: async () => [], markets: marketsWith(facts({ reference: "issuer", ref: 200, deviation: 0.4, priceAt: at - MINUTE, referenceAt: at - 2 * MINUTE })) });
  assert.deepEqual([pass.reminded, pass.deferred], [1, 0]);
  const [occurrence] = (await readRule(listed, OWNER, RULE_ID)).occurrences;
  assert.equal(occurrence.state, "due");
  assert.deepEqual([occurrence.condition.verdict, occurrence.condition.reference, occurrence.condition.deviationPct], ["met", "issuer", 0.4]);
  assert.equal((await listInbox(listed, OWNER))[0].title, "Час твоєї покупки: $10 в Apple");

  const stale = createMemoryGuardStore();
  await writeWeekly(stale, { mint: AAPLX });
  const old = await tickAutoinvest(stale, at, { ledger: async () => [], markets: marketsWith(facts({ reference: "issuer", ref: 200, deviation: 0.4, priceAt: at - 3 * HOUR, referenceAt: at - MINUTE })) });
  assert.deepEqual([old.reminded, old.deferred], [0, 1], "stale data make the rule wait, never buy");
  assert.equal((await listInbox(stale, OWNER))[0].title, "Купівлю відкладено: Apple — дані про ціну застаріли");
  const unread = createMemoryGuardStore();
  await writeWeekly(unread, { mint: AAPLX });
  assert.equal((await tickAutoinvest(unread, at, { ledger: async () => [], markets: async () => new Map() })).deferred, 1, "a company nobody could read waits");

  const plain = createMemoryGuardStore();
  const rule = await writeWeekly(plain, { limitPct: null });
  assert.equal(rule.priceCondition, null);
  const before = await tickAutoinvest(plain, at, { ledger: async () => [], markets: marketsWith(facts({ deviation: 30 })) });
  assert.deepEqual([before.reminded, before.deferred], [1, 0], "no condition, no judgement: the reminder as before");
  assert.equal((await readRule(plain, OWNER, RULE_ID)).occurrences[0].condition, null);
});

test("never met: the deferred purchase is missed at its end, never reminded late; the next due is judged afresh", async () => {
  const store = createMemoryGuardStore();
  await writeWeekly(store);
  const tick = (atMs, condition) => tickAutoinvest(store, atMs, { ledger: async () => [], markets: marketsWith(condition) });
  await tick(DUE + MINUTE, facts({ deviation: 30, priceAt: DUE + MINUTE, referenceAt: DUE }));
  const late = await tick(DUE + 25 * HOUR, facts({ deviation: 1, priceAt: DUE + 25 * HOUR, referenceAt: DUE + 25 * HOUR }));
  assert.equal(late.reminded, 0, "the day ended while it waited");
  let record = await readRule(store, OWNER, RULE_ID);
  assert.equal(record.occurrences[0].state, "missed");
  const week = DUE + 7 * 24 * HOUR;
  assert.equal((await tick(week + MINUTE, facts({ deviation: 2, priceAt: week + MINUTE, referenceAt: week }))).reminded, 1, "the next Thursday, within the limit, reminds");
  record = await readRule(store, OWNER, RULE_ID);
  assert.deepEqual(record.occurrences.map((row) => row.state), ["missed", "due"]);
});

test("a deferred purchase that meets its condition when the month's budget no longer covers it is held, like any purchase the budget holds", async () => {
  const store = createMemoryGuardStore();
  await writeWeekly(store, { amountUsd: 10 });
  await tickAutoinvest(store, DUE + MINUTE, { ledger: async () => [], markets: marketsWith(facts({ deviation: 30, priceAt: DUE + MINUTE, referenceAt: DUE })) });
  const set = await setBudget(store, OWNER, { capUsd: 5, timeZone: KYIV, locale: "uk" }, deps({}, { ledger: async () => [], nowMs: DUE + 2 * MINUTE }));
  assert.ok(set.ok);
  const at = DUE + HOUR;
  const pass = await tickAutoinvest(store, at, { ledger: async () => [], markets: marketsWith(facts({ deviation: 1, priceAt: at, referenceAt: at })) });
  assert.deepEqual([pass.reminded, pass.held], [0, 1]);
  assert.equal((await readRule(store, OWNER, RULE_ID)).occurrences[0].state, "held");
});

test("«Якщо впаде» with a condition: a crossing above the limit waits; back above the trigger it is over and the rule arms again; the next crossing within the limit reminds", async () => {
  const store = createMemoryGuardStore();
  const created = await createRule(store, { owner: OWNER, mint: OPENAI, amountUsd: 20, kind: "dip", dip: { dropPct: 5, timeZone: KYIV }, priceCondition: { limitPct: 5 }, locale: "uk" }, deps({ [OPENAI]: openaiRow({ price: 1300, mark: 1000 }) }));
  assert.ok(created.ok, JSON.stringify(created));
  const tick = (atMs, usd, condition) => tickAutoinvest(store, atMs, { ledger: async () => [], markets: marketsWith(condition, { usd, observedAtMs: atMs }) });
  /* Down 5.4 % from $1,300 — and still 23 % above PreStocks' valuation. */
  const crossing = NOW + 20 * MINUTE;
  const first = await tick(crossing, 1230, facts({ deviation: 23, priceAt: crossing, referenceAt: crossing }));
  assert.deepEqual([first.reminded, first.deferred], [0, 1]);
  let record = await readRule(store, OWNER, RULE_ID);
  assert.equal(record.occurrences[0].state, "deferred");
  assert.deepEqual(record.occurrences[0].trigger, { priceUsd: 1230, anchorUsd: 1300 });
  assert.equal(record.dip.armed, false, "one open crossing at a time");
  /* Back above the trigger ($1,235) before the condition was met: the crossing is over. */
  await tick(crossing + HOUR, 1240, facts({ deviation: 24, priceAt: crossing + HOUR, referenceAt: crossing + HOUR }));
  record = await readRule(store, OWNER, RULE_ID);
  assert.equal(record.occurrences[0].state, "missed");
  assert.equal(record.dip.armed, true);
  /* A new fall below it, the valuation raised meanwhile: within the limit — the reminder. */
  const second = crossing + 2 * HOUR;
  const again = await tick(second, 1220, facts({ deviation: 1.7, ref: 1200, priceAt: second, referenceAt: second }));
  assert.deepEqual([again.reminded, again.deferred], [1, 0]);
  record = await readRule(store, OWNER, RULE_ID);
  assert.deepEqual(record.occurrences.map((row) => row.state), ["missed", "due"]);
  const notes = await listInbox(store, OWNER);
  assert.equal(notes.length, 2, "one deferral, one reminder");
  assert.ok(notes.some((note) => note.title.startsWith("OpenAI −6,2 % · докупити $20?")));
});

test("a deferred crossing whose condition is met while the price is still down reminds on a fresh day, with the price read now", async () => {
  const store = createMemoryGuardStore();
  const created = await createRule(store, { owner: OWNER, mint: OPENAI, amountUsd: 20, kind: "dip", dip: { dropPct: 5, timeZone: KYIV }, priceCondition: { limitPct: 5 }, locale: "uk" }, deps({ [OPENAI]: openaiRow({ price: 1300, mark: 1000 }) }));
  assert.ok(created.ok);
  const crossing = NOW + 20 * MINUTE;
  await tickAutoinvest(store, crossing, { ledger: async () => [], markets: marketsWith(facts({ deviation: 23, priceAt: crossing, referenceAt: crossing }), { usd: 1230, observedAtMs: crossing }) });
  const later = crossing + 3 * HOUR;
  const pass = await tickAutoinvest(store, later, { ledger: async () => [], markets: marketsWith(facts({ deviation: 2, ref: 1200, priceAt: later, referenceAt: later }), { usd: 1224, observedAtMs: later }) });
  assert.equal(pass.reminded, 1);
  const [occurrence] = (await readRule(store, OWNER, RULE_ID)).occurrences;
  assert.equal(occurrence.state, "due");
  assert.equal(occurrence.openUntil, iso(later + 24 * HOUR));
  assert.deepEqual(occurrence.trigger, { priceUsd: 1224, anchorUsd: 1300 });
});

/* ------------------------------------------------------------ the contract */

test("the contract: the condition on a rule and on its occurrences, the new state, the request from 1 to 50 whole per cent, absent or null for none", () => {
  assert.ok(RULE_OCCURRENCE_STATES.includes("deferred"));
  const ask = { asset: { mint: OPENAI }, amountUsd: 10, schedule: WEEKLY_THU_19 };
  assert.ok(RuleCreateRequestSchema.safeParse(ask).success, "a 1.17.0 request still reads");
  assert.ok(RuleCreateRequestSchema.safeParse({ ...ask, priceCondition: null }).success);
  assert.ok(RuleCreateRequestSchema.safeParse({ ...ask, priceCondition: { limitPct: 5 } }).success);
  for (const limitPct of [0, 51, 5.5, -1]) assert.ok(!RuleCreateRequestSchema.safeParse({ ...ask, priceCondition: { limitPct } }).success, `${limitPct} %`);
  assert.ok(!RuleCreateRequestSchema.safeParse({ ...ask, priceCondition: { limitPct: 5, reference: "fair" } }).success, "strict");
  const record = {
    schema: "ryntra.autoinvest-rule",
    schemaVersion: "1.0.0",
    id: RULE_ID,
    owner: OWNER,
    network: "solana:mainnet",
    kind: "schedule",
    asset: { network: "solana:mainnet", mint: OPENAI, symbol: "OPENAI", issuer: { id: "prestocks", label: "PreStocks" }, underlying: { symbol: "OPENAI", name: "OpenAI" }, decimals: 9, unitBasis: "token" },
    name: "OpenAI",
    amountUsd: 10,
    schedule: WEEKLY_THU_19,
    dip: null,
    priceCondition: { limitPct: 5 },
    status: "active",
    locale: "uk",
    nextDueAt: iso(DUE + 7 * 24 * HOUR),
    occurrences: [{ dueAt: iso(DUE), openUntil: iso(DUE + 24 * HOUR), state: "deferred", remindedAt: null, signature: null, spentUsd: null, boughtAt: null, trigger: null, condition: checkPriceCondition(5, facts(), DUE) }],
    version: 2,
    createdAt: iso(NOW),
    updatedAt: iso(DUE),
  };
  const projected = projectRule(record, [], DUE + HOUR);
  assert.ok(AutoinvestRuleSchema.safeParse(projected).success, JSON.stringify(AutoinvestRuleSchema.safeParse(projected).error?.issues?.[0]));
  assert.equal(projected.occurrences[0].state, "deferred");
  assert.equal(projectRule(record, [], DUE + 25 * HOUR).occurrences[0].state, "missed", "past its end it reads as missed before the tick writes it");
  /* The deferral's identity is read by every reader of a reminder's. */
  const identity = deferralIdentity(RULE_ID, iso(DUE), "OPENAI");
  assert.equal(dueOfIdentity(identity, RULE_ID), iso(DUE));
  assert.equal(symbolOfIdentity(identity), "OPENAI");
  assert.equal(isDeferralIdentity(identity), true);
  assert.equal(isDeferralIdentity(reminderIdentity(RULE_ID, iso(DUE), "OPENAI")), false);
});
