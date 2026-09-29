// Run from repo root: node --test app/app/invest/autoinvest-model.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import { RULE_MAXIMUM_USD } from "../../../lib/api/v1/contract.ts";
import { budgetSpentWords, cadenceWord, dipLine, dipReminderWords, dueWords, pctWord, priceWord, reminderWords, ruleLine, ruleWhenLine, usdWord, whenPhrase } from "../../../lib/autoinvest/words.ts";
import { budgetOfInput, budgetView, byNextPurchase, defaultSchedule, firstDue, fitsMonth, heldByBudget, lastSettled, monthUse, occurrenceAt, openOccurrence, reminderOpenNow, RULE_MAX_USD, ruleForMint, timeOfInput, withCadence } from "./autoinvest-model.ts";
import { buyByRuleWord, INVEST_WORDS, plainLeavesOpenLine } from "./invest-words.ts";

/* Thursday 24 September 2026, 00:29 in Kyiv. */
const NOW = Date.parse("2026-09-23T21:29:00.000Z");
const iso = (ms) => new Date(ms).toISOString();

test("a new rule starts weekly, today, at the next full hour — the first reminder near enough to see it work", () => {
  const schedule = defaultSchedule(NOW, "Europe/Kyiv");
  assert.deepEqual(schedule, { cadence: "weekly", weekday: 4, monthDay: null, time: "01:00", timeZone: "Europe/Kyiv" });
  assert.equal(iso(firstDue(schedule, NOW)), "2026-09-23T22:00:00.000Z", "01:00 Kyiv, half an hour from now");
  /* 23:40 on a Sunday: the next full hour is past midnight, so the day is Monday. */
  const late = defaultSchedule(Date.parse("2026-09-27T20:40:00.000Z"), "Europe/Kyiv");
  assert.deepEqual([late.weekday, late.time], [1, "00:00"]);
});

test("changing how often keeps the time and takes the day the cadence needs", () => {
  const weekly = defaultSchedule(NOW, "Europe/Kyiv");
  const monthly = withCadence(weekly, "monthly", NOW);
  assert.deepEqual([monthly.weekday, monthly.monthDay, monthly.time], [null, 24, "01:00"]);
  const daily = withCadence(monthly, "daily", NOW);
  assert.deepEqual([daily.weekday, daily.monthDay], [null, null]);
  assert.equal(withCadence(daily, "weekly", NOW).weekday, 4);
  assert.equal(timeOfInput("19:05"), "19:05");
  assert.equal(timeOfInput("7:05"), null);
  assert.equal(firstDue({ ...weekly, time: "25:00" }, NOW), null, "an unreadable schedule gives no first purchase");
});

test("the page's bound on a rule's sum is the contract's", () => {
  assert.equal(RULE_MAX_USD, RULE_MAXIMUM_USD);
});

test("a company's rule: the one that is on first; its open reminder, the one a link names, and the last that is over", () => {
  const occurrence = (dueAt, state) => ({ dueAt, openUntil: iso(Date.parse(dueAt) + 86_400_000), state, remindedAt: dueAt, signature: null, spentUsd: null, boughtAt: null });
  const rule = (id, mint, status, occurrences) => ({ id, asset: { mint }, status, occurrences });
  const paused = rule("rule_a", "M1", "paused", []);
  const on = rule("rule_b", "M1", "active", [occurrence("2026-09-24T16:00:00.000Z", "due"), occurrence("2026-09-17T16:00:00.000Z", "missed")]);
  assert.equal(ruleForMint([paused, on, rule("rule_c", "M2", "active", [])], "M1").id, "rule_b");
  assert.equal(ruleForMint([paused], "M1").id, "rule_a");
  assert.equal(ruleForMint([paused], "M9"), null);
  assert.equal(openOccurrence(on).dueAt, "2026-09-24T16:00:00.000Z");
  assert.equal(openOccurrence({ ...on, status: "paused" }), null, "a paused rule offers no purchase");
  assert.equal(occurrenceAt(on, "2026-09-17T19:00:00+03:00").state, "missed", "the same instant, however it is written");
  assert.equal(lastSettled(on).state, "missed");
});

test("a rule is said the same on the page, in the note and in Telegram", () => {
  const weekly = { cadence: "weekly", weekday: 4, monthDay: null, time: "19:00", timeZone: "Europe/Kyiv" };
  const monthly = { cadence: "monthly", weekday: null, monthDay: 1, time: "10:00", timeZone: "Europe/Kyiv" };
  const daily = { cadence: "daily", weekday: null, monthDay: null, time: "08:30", timeZone: "Europe/Kyiv" };
  assert.equal(ruleLine(weekly, "uk"), "Щотижня · чт о 19:00");
  assert.equal(ruleLine(weekly, "en"), "Every week · Thu at 19:00");
  assert.equal(whenPhrase(monthly, "uk"), "1-го о 10:00");
  assert.equal(whenPhrase(monthly, "en"), "on the 1st at 10:00");
  assert.equal(whenPhrase({ ...monthly, monthDay: 22 }, "en"), "on the 22nd at 10:00");
  assert.equal(whenPhrase({ ...monthly, monthDay: 13 }, "en"), "on the 13th at 10:00");
  assert.equal(ruleLine(daily, "uk"), "Щодня · о 08:30");
  assert.equal(cadenceWord("monthly", "uk"), "Щомісяця");
  assert.equal(usdWord(10, "uk"), "$10");
  assert.equal(usdWord(12.5, "uk"), "$12,50");
  assert.equal(usdWord(12.5, "en"), "$12.50");
  assert.equal(dueWords(Date.parse("2026-09-24T16:00:00.000Z"), "Europe/Kyiv", "uk"), "чт, 24 вер. о 19:00");
  assert.equal(dueWords(Date.parse("2026-09-24T16:00:00.000Z"), "Europe/Kyiv", "en"), "Thu, Sep 24 at 19:00");
  const words = reminderWords({ name: "Apple", amountUsd: 10, schedule: weekly });
  assert.equal(words.uk.title, "Час твоєї покупки: $10 в Apple");
  assert.equal(words.uk.cta, "Купити $10");
  for (const locale of ["en", "uk"]) {
    for (const text of Object.values(words[locale])) {
      assert.doesNotMatch(text, /\bRyn\b|DCA|trigger|автоматично|automatically/i, "never the words the canon forbids");
    }
  }
});

test("«Якщо впаде» and the month's budget are said the same on the page, on Home and in the note — never the words the canon forbids", () => {
  assert.equal(dipLine(5, "uk"), "Якщо впаде на 5 %");
  assert.equal(dipLine(5, "en"), "If it falls 5%");
  assert.equal(pctWord(5.46, "uk", 1), "5,5 %");
  assert.equal(priceWord(335.95, "uk"), "$335,95");
  assert.equal(priceWord(335.95, "en"), "$335.95");
  assert.equal(priceWord(0.6281, "en"), "$0.6281");
  const weekly = { cadence: "weekly", weekday: 4, monthDay: null, time: "19:00", timeZone: "Europe/Kyiv" };
  assert.equal(ruleWhenLine({ schedule: weekly, dip: null }, "uk"), "Щотижня · чт о 19:00");
  assert.equal(ruleWhenLine({ schedule: null, dip: { dropPct: 10 } }, "uk"), "Якщо впаде на 10 %");
  const fall = dipReminderWords({ name: "NVIDIA", amountUsd: 20, priceUsd: 170.5, anchorUsd: 180 });
  assert.equal(fall.uk.title, "NVIDIA −5,3 % · докупити $20?");
  assert.equal(fall.en.cta, "Buy $20");
  const spent = budgetSpentWords({ capUsd: 100, countedUsd: 100 });
  assert.equal(spent.uk.title, "Бюджет місяця вичерпано");
  assert.match(spent.uk.reason, /Правила стоять до 1-го числа/);
  assert.equal(spent.uk.cta, "Змінити бюджет");
  for (const words of [fall, spent]) {
    for (const locale of ["en", "uk"]) {
      for (const text of Object.values(words[locale])) assert.doesNotMatch(text, /\bRyn\b|DCA|trigger|автоматично|automatically/i);
    }
  }
});

test("a purchase fits the month to the cent; a rule the budget holds says so; the bar's share and a typed ceiling", () => {
  const budget = { capUsd: 100, timeZone: "Europe/Kyiv", monthStartsAt: "2026-08-31T21:00:00.000Z", monthEndsAt: "2026-09-30T21:00:00.000Z", spentUsd: 45, unknownUsd: 10, remainingUsd: 45, exhausted: false, updatedAt: null };
  assert.equal(fitsMonth({ amountUsd: 45 }, budget), true);
  assert.equal(fitsMonth({ amountUsd: 45.01 }, budget), false);
  assert.equal(fitsMonth({ amountUsd: 1000 }, null), true, "no budget read, nothing held");
  assert.equal(fitsMonth({ amountUsd: 1000 }, { ...budget, capUsd: null, remainingUsd: null }), true, "no ceiling");
  assert.equal(heldByBudget({ amountUsd: 50, status: "active" }, budget), true);
  assert.equal(heldByBudget({ amountUsd: 50, status: "paused" }, budget), false, "a paused rule is paused, not held");
  assert.deepEqual(monthUse(budget), { countedUsd: 55, share: 0.55 });
  assert.deepEqual(monthUse({ ...budget, spentUsd: 120, unknownUsd: 0 }), { countedUsd: 120, share: 1 });
  assert.equal(monthUse({ ...budget, capUsd: null }).share, null);
  assert.equal(budgetOfInput(100), 100);
  /* From a dollar (canon v5.5 В35, contract 1.16.0): «щодня по $1» for the longest month is $31. */
  assert.equal(budgetOfInput(0.99), null);
  assert.equal(budgetOfInput(1), 1);
  assert.equal(budgetOfInput(31), 31);
  assert.equal(budgetOfInput(12.345), 12.35);
  assert.equal(budgetOfInput(null), null);
  assert.equal(budgetOfInput(2_000_000), null);
});

test("a reminder is offered first only while its window is open (canon v5.3 В29)", () => {
  const occurrence = (dueAt, state) => ({ dueAt, openUntil: iso(Date.parse(dueAt) + 86_400_000), state, remindedAt: dueAt, signature: null, spentUsd: null, boughtAt: null, trigger: null });
  const rule = { id: "rule_a", asset: { mint: "M1" }, status: "active", occurrences: [occurrence("2026-09-24T16:00:00.000Z", "due")] };
  assert.equal(reminderOpenNow(rule, Date.parse("2026-09-24T17:00:00.000Z")).dueAt, "2026-09-24T16:00:00.000Z");
  assert.equal(reminderOpenNow(rule, Date.parse("2026-09-25T16:00:00.001Z")), null, "the window passed before the tick wrote it missed");
  assert.equal(reminderOpenNow({ ...rule, status: "paused" }, Date.parse("2026-09-24T17:00:00.000Z")), null, "a paused rule offers no purchase");
  assert.equal(reminderOpenNow({ ...rule, occurrences: [occurrence("2026-09-24T16:00:00.000Z", "bought")] }, Date.parse("2026-09-24T17:00:00.000Z")), null);
});

test("the month's budget is its own line — «Бюджет не задано · Задати» or «$10 з $50» — never the rule's sum (canon v5.3 В29)", () => {
  const month = { timeZone: "Europe/Kyiv", monthStartsAt: "2026-08-31T21:00:00.000Z", monthEndsAt: "2026-09-30T21:00:00.000Z", updatedAt: null };
  assert.equal(budgetView(null), null, "not read yet: no line");
  assert.deepEqual(budgetView({ ...month, capUsd: null, spentUsd: 10, unknownUsd: 0, remainingUsd: null, exhausted: false }), { kind: "unset" });
  assert.deepEqual(budgetView({ ...month, capUsd: 50, spentUsd: 10, unknownUsd: 0, remainingUsd: 40, exhausted: false }), { kind: "capped", countedUsd: 10, capUsd: 50, percent: 20, exhausted: false });
  assert.deepEqual(budgetView({ ...month, capUsd: 50, spentUsd: 45, unknownUsd: 10, remainingUsd: 0, exhausted: true }), { kind: "capped", countedUsd: 55, capUsd: 50, percent: 100, exhausted: true });
  /* The Owner's words, both languages: the sum of a rule is each purchase, the budget's is the month's most. */
  assert.equal(INVEST_WORDS.budgetNotSet.uk, "Бюджет не задано");
  assert.equal(INVEST_WORDS.setShort.uk, "Задати");
  assert.equal(INVEST_WORDS.eachPurchase.uk, "Кожна купівля");
  assert.equal(INVEST_WORDS.eachPurchase.en, "Each purchase");
  assert.equal(INVEST_WORDS.atMostPerMonth.uk, "Не більше на місяць");
  assert.equal(INVEST_WORDS.atMostPerMonth.en, "At most per month");
});

test("a rule's purchase is never mistaken for an ordinary one, and the ordinary one says the reminder stays open (canon v5.3 В29)", () => {
  assert.equal(buyByRuleWord("uk", 20), "Купити $20 за правилом");
  assert.equal(buyByRuleWord("en", 20), "Buy $20 by your rule");
  assert.equal(buyByRuleWord("uk", 10.5), "Купити $10,50 за правилом");
  assert.equal(plainLeavesOpenLine("uk", 20), "Це звичайна купівля: нагадування правила на $20 лишиться відкритим.");
  assert.equal(plainLeavesOpenLine("en", 20), "This is a one-off purchase: your rule's $20 reminder stays open.");
  assert.equal(INVEST_WORDS.plainPurchase.uk, "Звичайна купівля");
  assert.equal(INVEST_WORDS.reminderStaysOpen.uk, "Нагадування правила лишиться відкритим");
  for (const key of ["eachPurchase", "atMostPerMonth", "budgetNotSet", "setShort", "changeShort", "plainPurchase", "reminderStaysOpen", "reminderOpenHere", "plainHereLeavesOpen"]) {
    for (const locale of ["en", "uk"]) assert.doesNotMatch(INVEST_WORDS[key][locale], /\bRyn\b|DCA|trigger|автоматично|automatically/i, `${key}.${locale}`);
  }
});

test("Home's column reads the rules by their nearest purchase: an open reminder, then by time, then a fall, the paused last", () => {
  const rule = (name, { status = "active", nextDueAt = null, due = false } = {}) => ({
    name,
    status,
    nextDueAt,
    occurrences: due ? [{ state: "due", dueAt: iso(NOW - 60_000), openUntil: iso(NOW + 3_600_000) }] : [],
  });
  const ordered = byNextPurchase([
    rule("Paused", { status: "paused", nextDueAt: iso(NOW + 1_000) }),
    rule("Dip"),
    rule("Later", { nextDueAt: iso(NOW + 7 * 86_400_000) }),
    rule("Due now", { nextDueAt: iso(NOW + 86_400_000), due: true }),
    rule("Sooner", { nextDueAt: iso(NOW + 86_400_000) }),
  ], NOW);
  assert.deepEqual(ordered.map((entry) => entry.name), ["Due now", "Sooner", "Later", "Dip", "Paused"]);
});
