import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { notAStock } from "../../lib/stocks/pool-facts.ts";
import { chipKey, chipOf, factsShown, guardKey, guardOf, timeText } from "./facts-view.ts";
import { STOCK_FACTS } from "./words.ts";

/* A stock's facts on a pool page: what shows, in which words, and how the page mounts it. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MINT = "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB";
const NOW = Date.parse("2026-11-18T15:00:00.000Z");
const HOUR = 60 * 60_000;
const facts = (over = {}) => ({
  mint: MINT,
  isStock: true,
  issuer: { id: "xstocks", label: "xStocks · Backed Finance" },
  session: "open",
  nextChangeAt: new Date(NOW + 6 * HOUR).toISOString(),
  dividendGuard: null,
  termsUrl: "https://assets.backed.fi/legal-documentation",
  ...over,
});

test("a coin that is no stock, or facts not read yet, show nothing", () => {
  assert.equal(factsShown(notAStock(MINT)), false);
  assert.equal(factsShown(null), false);
  assert.equal(factsShown(undefined), false);
  assert.equal(chipOf(notAStock(MINT), NOW), null);
  assert.equal(guardOf(notAStock(MINT), NOW), null);
  assert.equal(factsShown(facts()), true);
});

test("the chip: open in mint, every other state plain, the time only while it is ahead, nothing when no source said", () => {
  assert.deepEqual(chipOf(facts(), NOW), { key: "open", tone: "ok", at: NOW + 6 * HOUR });
  assert.deepEqual(chipOf(facts({ session: "closed" }), NOW), { key: "closed", tone: "plain", at: NOW + 6 * HOUR });
  assert.deepEqual(chipOf(facts({ session: "pre" }), NOW).tone, "plain");
  assert.deepEqual(chipOf(facts({ session: "post" }), NOW).tone, "plain");
  assert.equal(chipOf(facts({ session: "closed", nextChangeAt: null }), NOW).at, null);
  assert.equal(chipOf(facts({ nextChangeAt: new Date(NOW - 1).toISOString() }), NOW).at, null, "a time already passed is not shown");
  assert.equal(chipOf(facts({ session: "unknown" }), NOW), null);
  assert.equal(chipKey(chipOf(facts(), NOW)), "openUntil");
  assert.equal(chipKey(chipOf(facts({ nextChangeAt: null }), NOW)), "open");
});

test("the guard: from when deposits wait while it is ahead, until when while it is on, gone once past", () => {
  const at = NOW + 2 * 24 * HOUR;
  const guard = { from: new Date(at - 24 * HOUR).toISOString(), to: new Date(at + 15 * 60_000).toISOString(), step: "dividend", now: false };
  const ahead = guardOf(facts({ dividendGuard: guard }), NOW);
  assert.deepEqual(ahead, { step: "dividend", now: false, at: at - 24 * HOUR });
  assert.equal(guardKey(ahead), "dividendFrom");
  const on = guardOf(facts({ dividendGuard: guard }), at - HOUR);
  assert.deepEqual(on, { step: "dividend", now: true, at: at + 15 * 60_000 });
  assert.equal(guardKey(on), "dividendUntil");
  assert.equal(guardOf(facts({ dividendGuard: guard }), at + 16 * 60_000), null);
  assert.equal(guardKey({ step: "split", now: true, at }), "splitUntil");
  assert.equal(guardKey({ step: "units", now: false, at }), "stepFrom");
});

test("every key the view names stands in both halves of the words, and the chip reads as the owner set it", () => {
  for (const lang of ["en", "uk"]) {
    const d = STOCK_FACTS[lang];
    for (const key of ["open", "closed", "pre", "post"]) {
      assert.equal(typeof d[key], "string", `${lang}.${key}`);
      assert.equal(typeof d[`${key}Until`], "function", `${lang}.${key}Until`);
    }
    for (const step of ["dividend", "split", "step"]) for (const end of ["From", "Until"]) assert.equal(typeof d[`${step}${end}`], "function", `${lang}.${step}${end}`);
  }
  assert.equal(STOCK_FACTS.uk.closedUntil("пн 15:30"), "Біржа закрита · відкриється о пн 15:30");
  assert.equal(STOCK_FACTS.uk.openUntil("22:00"), "Біржа відкрита · закриється о 22:00");
  assert.equal(STOCK_FACTS.en.closedUntil("Mon 15:30"), "Exchange closed · opens Mon 15:30");
  assert.equal(STOCK_FACTS.uk.terms, "Умови емітента");
  for (const lang of ["en", "uk"]) for (const value of Object.values(STOCK_FACTS[lang])) {
    const said = typeof value === "string" ? value : value("1");
    assert.doesNotMatch(said, /private|приватн|anonym|анонім/i, "no «private stocks» anywhere");
  }
});

test("times are the person's own clock: the time today, the weekday and the time on another day", () => {
  assert.equal(timeText(Date.parse("2026-11-18T21:00:00Z"), NOW, "en", "UTC"), "21:00");
  assert.equal(timeText(Date.parse("2026-11-23T14:30:00Z"), NOW, "en", "UTC"), "Mon 14:30");
  assert.equal(timeText(Date.parse("2026-11-23T14:30:00Z"), NOW, "uk", "UTC"), "пн 14:30");
  assert.equal(timeText(Date.parse("2026-11-18T23:30:00Z"), NOW, "en", "Europe/Kyiv"), "Thu 01:30", "past midnight in Kyiv is another day");
});

test("the detail is one block: the kit's chip and «i», the guard's line, nothing at all for a coin that is no stock", () => {
  const view = code("./StockPoolFacts.tsx");
  assert.match(view, /export function StockPoolFacts\(\{ mint, facts: given \}: \{ mint: string; facts\?: PoolFacts \| null \}\)/);
  assert.match(view, /if \(now === null \|\| !facts\?\.isStock \|\| !facts\.issuer\) return null;/);
  assert.match(view, /import \{ Chip, Icon, Info \} from '@\/terminal\/ui';/, "the kit's parts, nothing drawn of its own");
  assert.match(view, /<Info label=\{d\.terms\}>/, "the issuer's terms behind «i»");
  assert.match(view, /target="_blank" rel="noopener noreferrer"/, "the issuer's document opens apart, nothing of the page is handed to it");
  assert.doesNotMatch(view, /fetch\(/, "the detail reads through its hook alone");
  assert.equal((view.match(/<p\b/g) ?? []).length, 1, "one line under the chip, no paragraphs");
  const hook = code("./useStockPoolFacts.ts");
  assert.equal((hook.match(/fetch\(/g) ?? []).length, 1, "one read");
  assert.match(hook, /fetch\(`\/api\/v1\/stocks\/pool-facts\?mint=\$\{encodeURIComponent\(mint\)\}`/);
  assert.match(hook, /if \(given !== undefined \|\| !mint\) return;/, "facts handed in are never read again");
  assert.match(hook, /export function useOffHoursRisk/);
  assert.match(hook, /RETRY_MS: readonly number\[\] = \[15_000, 30_000, 60_000\]/, "a failed read is asked again, a few times, further apart");
  const sheet = read("./stocks.module.css");
  assert.doesNotMatch(sheet.replace(/\/\*[\s\S]*?\*\//g, ""), /#[0-9a-f]{3,8}\b|rgba?\(/i, "tokens only");
});

test("the terminal's stocks touch no file of the pool page's wave", () => {
  for (const path of ["./StockPoolFacts.tsx", "./useStockPoolFacts.ts", "./facts-view.ts", "./words.ts"]) {
    assert.doesNotMatch(code(path), /from '@\/terminal\/(pool|earn|bots|coin)\//, path);
  }
});
