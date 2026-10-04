/**
 * «Шлях компанії» in words: the days as the page writes them, the deadline
 * with the issuer's minute, what each token is, and no judgement anywhere.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { companyPathFor } from "../../../lib/stocks/company-path.ts";
import { PATH_WORDS, pathDay, pathDeadline, sourceLine, stepLines, stepName, swapLines, swapRuleLine, tokenNature } from "./[ticker]/company-path-words.ts";

const NOW = Date.parse("2026-09-25T18:00:00.000Z");
const spacex = (nowMs = NOW) => companyPathFor({ mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh", symbol: "SPACEX", issuerId: "prestocks", instrumentClass: "pre-ipo" }, nowMs);
const openai = companyPathFor({ mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF", symbol: "OPENAI", issuerId: "prestocks", instrumentClass: "pre-ipo" }, NOW);

test("the days: «12.06.2026» in Ukrainian, «Jun 12, 2026» in English; the deadline with its minute in UTC", () => {
  assert.equal(pathDay("2026-06-12", "uk"), "12.06.2026");
  assert.equal(pathDay("2026-06-12", "en"), "Jun 12, 2026");
  assert.equal(pathDeadline("2027-03-12T23:59:00.000Z", "uk"), "12.03.2027, 23:59 UTC");
  assert.equal(pathDeadline("2027-03-12T23:59:00.000Z", "en"), "Mar 12, 2027, 23:59 UTC");
});

test("SpaceX's steps in both languages", () => {
  const [privateStep, ipo, exchange, solana] = spacex().steps;
  assert.deepEqual([privateStep, ipo, exchange, solana].map((step) => stepName(step.step, "uk")), ["Приватна · PreStocks", "IPO", "Біржа", "Solana"]);
  assert.deepEqual(stepLines(privateStep, "uk"), ["з 16.09.2025"]);
  assert.deepEqual(stepLines(ipo, "uk"), ["12.06.2026", "$135 за акцію"]);
  assert.deepEqual(stepLines(ipo, "en"), ["Jun 12, 2026", "$135 a share"]);
  assert.deepEqual(stepLines(exchange, "uk"), ["Nasdaq · SPCX", "з 12.06.2026"]);
  assert.deepEqual(stepLines(solana, "en"), ["since Jun 12, 2026"]);
});

test("what each token is: SPACEX not a share with the issuer's fee, SPCXx backed 1:1 with no vote", () => {
  assert.equal(tokenNature("private", "uk", 100), "не акція · комісія 1%");
  assert.equal(tokenNature("private", "en", 100), "not a share · 1% fee");
  assert.equal(tokenNature("private", "uk", null), "не акція");
  assert.equal(tokenNature("solana", "uk", null), "1:1 до акції · без голосу");
  assert.equal(tokenNature("solana", "en", null), "backed 1:1 · no vote");
});

test("the swap line: what a SPACEX holder does, by the issuer's minute; closed by the clock", () => {
  const open = swapLines(spacex().swap, "uk");
  assert.equal(open.everyone, "Власникам SPACEX: обміняти на SPCXx до 12.03.2027, 23:59 UTC — після строку SPACEX згорить.");
  assert.equal(open.holder, "Обміняй SPACEX на SPCXx до 12.03.2027, 23:59 UTC — після строку токен згорить.");
  assert.equal(swapLines(spacex().swap, "en").everyone, "SPACEX holders: swap for SPCXx by Mar 12, 2027, 23:59 UTC — after the deadline SPACEX expires worthless.");
  const closed = swapLines(spacex(Date.parse("2027-03-13T00:00:00.000Z")).swap, "uk");
  assert.equal(closed.everyone, "Строк обміну SPACEX минув 12.03.2027 — емітент більше не підтримує токен.");
  assert.equal(closed.holder, closed.everyone);
});

test("a private company: the first step now with its day, the rest not announced, the issuer's nine months", () => {
  const [first, ...rest] = openai.steps;
  assert.deepEqual(stepLines(first, "uk"), ["з 16.09.2025"]);
  for (const step of rest) assert.deepEqual(stepLines(step, "uk"), [PATH_WORDS.notAnnounced.uk]);
  assert.equal(swapRuleLine(openai.swapMonths, "uk"), "Після IPO — до 9 місяців, щоб обміняти токен.");
  assert.equal(swapRuleLine(openai.swapMonths, "en"), "After an IPO — up to 9 months to swap the token.");
});

test("a source says its document's day and Ryntra's read", () => {
  const filing = spacex().sources.find((source) => source.url.includes("000162828026042639"));
  assert.equal(sourceLine(filing, "uk"), "SEC · 424B4 (prospectus) · 12.06.2026 · прочитано 25.09.2026");
  assert.equal(sourceLine(filing, "en"), "SEC · 424B4 (prospectus) · Jun 12, 2026 · read Sep 25, 2026");
});

test("no judgement, target, venue link or superlative in any line", () => {
  const lines = [];
  for (const lang of ["uk", "en"]) {
    for (const path of [spacex(), openai]) {
      for (const step of path.steps) lines.push(stepName(step.step, lang), ...stepLines(step, lang));
      if (path.swap) lines.push(...Object.values(swapLines(path.swap, lang)));
      if (path.swapMonths) lines.push(swapRuleLine(path.swapMonths, lang));
      for (const source of path.sources) lines.push(sourceLine(source, lang), source.url);
    }
    lines.push(tokenNature("private", lang, 100), tokenNature("solana", lang, null));
  }
  const text = lines.join("\n");
  assert.doesNotMatch(text, /добр|поган|вигідн|варто|перш|єдин|good|bad|worth it|first|only|target|ціль|kraken|oura/i);
});
