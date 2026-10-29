// Run from repo root: node --test app/app/ryn/credits-meter.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { creditCompact, creditNumber, creditsWord, publishCredits, questionsOf, questionsWord } from "./credits-store.ts";

/**
 * AI-06b: «де вже побачити ці мої кредити? … сторінка чистенька і
 * зрозуміла». The balance is one large figure at the top of the assistant's page with «Поповнити», the same figure is
 * a small badge on the header's button, the page is one conversation with the brief and the credits as tabs — and
 * credits are never in Portfolio: they are not money and not a token.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const PAGE = read("./page.tsx");
const METER = read("./credits-meter.tsx");
const BADGE = read("./assistant-badge.tsx");
const PANEL = read("./assistant-panel.tsx");
const SURFACE = read("./ryn-surface.tsx");
const CREDITS = read("./credits-panel.tsx");
const BRIEF = read("./brief-panel.tsx");
const STORE = read("./credits-store.ts");
const WORDS = read("./ryn-words.ts");

const credits = (balance, freeLeft, price = 2, daily = 20) => ({
  unit: "credits",
  balance,
  welcome: 0,
  bought: balance,
  free: { used: daily - freeLeft, left: freeLeft, daily, resetsAt: "2026-10-21T00:00:00.000Z" },
  reserved: 0,
  dailySpend: { used: 0, cap: 2000, resetsAt: "2026-10-21T00:00:00.000Z" },
  prices: { question: price, alertExplain: 2, tokenReport: 5, priceMove: 5, voice: 6, deep: 60, plan: 130 },
  welcomeOffer: "taken",
  holder: "wallet",
});

test("the balance in a person's words: credits, the questions they pay for, the day's free ones", () => {
  assert.deepEqual(questionsOf(credits(2000, 20)), { balance: 1000, free: 10 });
  assert.deepEqual(questionsOf(credits(3, 1)), { balance: 1, free: 0 }, "what is left over a whole question is not promised");
  assert.deepEqual(questionsOf(credits(500, 20, 0)), { balance: 0, free: 0 }, "no price, no promise");
  assert.equal(creditNumber(2000, "uk").replace(/\s/g, " "), "2 000");
  assert.equal(creditNumber(2000, "en"), "2,000");
  assert.equal(creditCompact(9999, "en"), "9,999");
  assert.match(creditCompact(28750, "en"), /^28.8s?[kK]$/, "the badge has the room of a word");
  assert.deepEqual([1, 2, 5, 11, 21, 22, 2000].map((n) => creditsWord(n, "uk")), ["кредит", "кредити", "кредитів", "кредитів", "кредит", "кредити", "кредитів"]);
  assert.deepEqual([1, 2, 10, 1000].map((n) => questionsWord(n, "uk")), ["питання", "питання", "питань", "питань"]);
  assert.deepEqual([1, 10].map((n) => questionsWord(n, "en")), ["question", "questions"]);
});

test("one copy of the figures for every place: a publish of the same figures again tells nobody", () => {
  const figures = credits(2000, 20);
  assert.doesNotThrow(() => publishCredits("Owner1111111111111111111111111111111111111", figures));
  assert.doesNotThrow(() => publishCredits("Owner1111111111111111111111111111111111111", figures));
  assert.doesNotThrow(() => publishCredits("Owner1111111111111111111111111111111111111", null), "switched off is said, not waited for");
  assert.match(STORE, /owner !== null && current\?\.owner === owner \? current\.credits : undefined/, "another wallet's figures are never shown for this one");
  assert.match(STORE, /error\?\.code === "CAPABILITY_UNAVAILABLE"\) publishCredits\(owner, null\)/, "only «switched off» hides the figure; a failed read stays unknown");
});

test("the page: the heading with «?», the balance beside it, the conversation first and the brief and the credits as tabs", () => {
  assert.match(PAGE, /<PageTitle id="ryn-title" title=\{word\("title"\)\} help=/, "the explanation is behind «?», not a line under the heading");
  assert.match(PAGE, /<CreditsMeter locale=\{locale\} \/>/);
  assert.doesNotMatch(PAGE, /contextNone|styles\.lead/, "no badge «Усе, що читає Ryntra», no printed lead");
  assert.match(WORDS, /title: \["Ryntra assistant", "Помічник Ryntra"\]/);
  assert.match(SURFACE, /role="tablist"/);
  assert.match(SURFACE, /\["chat", "tabChat", Sparkle, null\],\s*\["watch", "tabWatch", Bell, watchStatus\],\s*\["tasks", "tabTasks", ClockCountdown, null\],\s*\["plans", "tabPlans", NotePencil, null\],\s*\["brief", "tabBrief", SunHorizon, briefStatus\],\s*\.\.\.\(budget\.credits \? \(\[\["credits", "tabCredits", Coins, null\]\] as const\) : \[\]\)/, "AI-06, AI-20: Розмова · Стежу · Доручення · Плани · Огляди · Кредити; the credits' tab only where credits are served");
  assert.match(SURFACE, /const shown = tabs\.some\(\(\[id\]\) => id === tab\) \? tab : "chat";/, "a tab that is gone falls back to the conversation");
  assert.match(SURFACE, /const inPlace = readyRef\.current && \(options\.fresh === true \|\| options\.sessionId !== undefined\);/, "«Нова розмова» switches inside the page, the tabs stay");
  assert.match(SURFACE, /useState<AssistantTab>\(initialTab && TABS\.includes\(initialTab\) \? initialTab : watchId \? "watch" : briefDay \? "brief" : "chat"\)/, "a press, a watch's note and a brief's note open their tabs");
  assert.doesNotMatch(BRIEF, /<details className=\{styles\.briefFold\}/, "the brief is a tab, not a fold");
  assert.doesNotMatch(CREDITS, /<details className=\{styles\.briefFold\}/, "the credits are a tab, not a fold");
  assert.ok(CREDITS.indexOf("<CreditsBuy") < CREDITS.indexOf('word("creditsHistory")') && CREDITS.indexOf('word("creditsHistory")') < CREDITS.indexOf('word("creditsPrices")'), "buying first, then the history, then the prices");
});

test("«Поповнити» opens the credits' tab at its packages; the meter never buys by itself", () => {
  assert.match(METER, /onClick=\{\(\) => askTopUp\(\)\}/);
  assert.match(SURFACE, /window\.addEventListener\(CREDITS_TOP_UP_EVENT, onTopUp\)/);
  assert.match(SURFACE, /setTab\("credits"\)/);
  assert.match(SURFACE, /#credits-buy \[role=group\] button:not\(\[disabled\]\)/);
  assert.doesNotMatch(METER, /fetch\(|credits\/orders/, "the meter shows and points; the order is opened only by a package's press");
});

test("the free ones are counted in questions on both lines — never «20 з 20» under «10 питань»", () => {
  assert.match(WORDS, /creditsFreeNow: \["free · \{freeQ\} left free today", "безкоштовно · сьогодні ще \{freeQ\}"\]/);
  assert.match(WORDS, /creditsWhat: \["Credits pay for the model's answers: \{n\} \{q\} free every day/, "the credits' tab says the free ones in questions too, with the server's number");
  assert.doesNotMatch(WORDS, /20 безкоштовних щодня|20 free every day/);
  assert.match(CREDITS, /freeQ: `\$\{freeQuestions\} \$\{questionsWord\(freeQuestions, locale\)\}`/);
  assert.match(METER, /questions\.free > 0\s*\? fill\(word\("meterFree"\)/);
});

test("the header's button carries the balance on every page that has it, only for a proven wallet with credits", () => {
  assert.match(PANEL, /<AssistantCreditsBadge locale=\{locale\} pathname=\{pathname\} \/>/);
  assert.match(PANEL, /if \(!open\) return badge;/, "drawn with the panel closed too");
  assert.match(BADGE, /proof\.state\.status === "proven" && proof\.state\.address === address \? address : null/);
  assert.match(BADGE, /if \(!button \|\| !credits \|\| credits\.balance <= 0\) return null;/);
  assert.match(BADGE, /createPortal\(/);
});

test("credits are not in Portfolio: not money and not a token (PLAN §9)", () => {
  for (const path of ["../portfolio/page.tsx", "../wallet-view-model.ts"]) {
    let source = "";
    try {
      source = read(path);
    } catch {
      continue;
    }
    assert.doesNotMatch(source, /CreditsMeter|AssistantCreditsBadge|assistant\/credits/);
  }
});

test("no file of the page's new parts signs, sends, trades or reads a key", () => {
  for (const source of [METER, BADGE, STORE, PAGE]) {
    assert.doesNotMatch(source, /signTransaction|sendTransaction|signMessage|privateKey|secretKey|\/api\/v1\/(spot|swap|send)/);
  }
});
