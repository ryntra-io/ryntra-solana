/**
 * «Шлях компанії» (`RYN-COMPANY-PATH-001`): the steps, the dates, the sources
 * and the swap deadline on the clock — from the registry only.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COMPANY_PATH_STEPS, companyPathFor } from "./company-path.ts";
import { COMPANY_PATHS, LIFECYCLE_EVENTS, LIFECYCLE_EVENTS_VERSION, PRIVATE_SINCE, PRESTOCKS_SWAP_RULE, companyPathRecordFor } from "./lifecycle-events.ts";
import { PRESTOCKS_PAGES } from "./issuer-pages.ts";

const SPACEX = "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh";
const SPCXX = "Xs3oZwbHvqis4NYcf4YKWmEia2eC84wSiVrcYcTqpH8";
const OPENAI = "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF";
const XAI = "PreC1KtJ1sBPPqaeeqL6Qb15GTLCYVvyYEwxhdfTwfx";
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const NOW = Date.parse("2026-09-25T18:00:00.000Z");
const AFTER = Date.parse("2027-03-13T00:00:00.000Z");

const spacex = (nowMs = NOW) => companyPathFor({ mint: SPACEX, symbol: "SPACEX", issuerId: "prestocks", instrumentClass: "pre-ipo" }, nowMs);
const spcxx = (nowMs = NOW) => companyPathFor({ mint: SPCXX, symbol: "SPCXx", issuerId: "xstocks", instrumentClass: "listed-equity" }, nowMs);

test("SpaceX: every step passed, in order, with the days and figures its filings state", () => {
  const path = spacex();
  assert.ok(path);
  assert.deepEqual(path.steps.map((step) => step.step), [...COMPANY_PATH_STEPS]);
  assert.deepEqual(path.steps.map((step) => step.state), ["passed", "passed", "passed", "current"]);
  const [privateStep, ipo, exchange, solana] = path.steps;
  assert.equal(privateStep.date, "2025-09-16");
  assert.deepEqual(privateStep.token, { mint: SPACEX, symbol: "SPACEX" });
  assert.equal(ipo.date, "2026-06-12", "the first trading day in the pricing term sheet");
  assert.equal(ipo.priceUsd, 135, "the offering price in the 424B4");
  assert.equal(exchange.exchange, "Nasdaq");
  assert.equal(exchange.ticker, "SPCX");
  assert.equal(exchange.date, "2026-06-12");
  assert.equal(solana.date, "2026-06-12");
  assert.deepEqual(solana.token, { mint: SPCXX, symbol: "SPCXx" });
  assert.equal(path.swapMonths, null, "the rule for a private company does not apply once it went public");
  assert.equal(path.version, LIFECYCLE_EVENTS_VERSION);
});

test("SPACEX and SPCXx are one company at two steps, each naming the other", () => {
  const a = spacex();
  const b = spcxx();
  assert.equal(a.at, "private");
  assert.equal(b.at, "solana");
  assert.deepEqual(a.steps, b.steps, "the same path on both pages");
  assert.deepEqual(a.swap, b.swap, "the same deadline under both strips");
  assert.equal(companyPathRecordFor(SPACEX), companyPathRecordFor(SPCXX));
});

test("the swap deadline is the issuer's, and the clock closes it", () => {
  const open = spacex().swap;
  assert.deepEqual(open, { from: { mint: SPACEX, symbol: "SPACEX" }, into: { mint: SPCXX, symbol: "SPCXx" }, deadline: "2027-03-12T23:59:00.000Z", open: true });
  assert.equal(spacex(Date.parse("2027-03-12T23:58:59.000Z")).swap.open, true, "open until the issuer's minute");
  assert.equal(spacex(Date.parse("2027-03-12T23:59:00.000Z")).swap.open, false, "closed at the cut-off");
  assert.equal(spcxx(AFTER).swap.open, false, "the listed token's page says it too");
  assert.equal(spcxx(AFTER).steps.at(-1).state, "current", "the company's path does not change with the window");
});

test("the sources: the filings, the issuer's notice and the report, each dated and read", () => {
  const path = spacex();
  const urls = path.sources.map((source) => source.url);
  assert.ok(urls.some((url) => url.includes("000162828026042639")), "the 424B4");
  assert.ok(urls.some((url) => url.includes("000162828026042466")), "the pricing term sheet");
  assert.ok(urls.includes("https://www.prestocks.com/spacex"), "the issuer's notice");
  assert.ok(urls.includes(`https://jup.ag/tokens/${SPACEX}`), "the private step's date");
  for (const source of path.sources) {
    assert.match(source.readAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(source.publishedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(source.publishedAt));
    assert.match(source.url, /^https:\/\//);
  }
});

test("a PreStocks company that announced nothing: the first step current, the rest not announced, nine months after an IPO", () => {
  const path = companyPathFor({ mint: OPENAI, symbol: "OPENAI", issuerId: "prestocks", instrumentClass: "pre-ipo" }, NOW);
  assert.ok(path);
  assert.equal(path.at, "private");
  assert.deepEqual(path.steps.map((step) => step.state), ["current", "unannounced", "unannounced", "unannounced"]);
  assert.equal(path.steps[0].date, "2025-09-16");
  assert.deepEqual(path.steps[0].token, { mint: OPENAI, symbol: "OPENAI" });
  for (const step of path.steps.slice(1)) assert.deepEqual([step.date, step.priceUsd, step.exchange, step.ticker, step.token], [null, null, null, null, null]);
  assert.equal(path.swap, null);
  assert.equal(path.swapMonths, 9);
  assert.equal(PRESTOCKS_SWAP_RULE.months, 9);
  assert.ok(path.sources.some((source) => source.url === "https://www.prestocks.com/faq"));
});

test("every token PreStocks lists has its first step's day; a new one stands at the first step without a day", () => {
  for (const page of PRESTOCKS_PAGES.filter((entry) => entry.symbol !== "XAI")) assert.match(PRIVATE_SINCE[page.mint] ?? "", /^\d{4}-\d{2}-\d{2}$/, page.symbol);
  const fresh = companyPathFor({ mint: "PreNewToken1111111111111111111111111111111", symbol: "NEWCO", issuerId: "prestocks", instrumentClass: "pre-ipo" }, NOW);
  assert.equal(fresh.steps[0].date, null);
  assert.equal(fresh.steps[0].state, "current");
  assert.deepEqual(fresh.sources.map((source) => source.url), ["https://www.prestocks.com/faq"]);
});

test("no strip where it has nothing to say: a bought company's token, another listed company", () => {
  assert.equal(companyPathFor({ mint: XAI, symbol: "XAI", issuerId: "prestocks", instrumentClass: "pre-ipo" }, NOW), null, "xAI was bought, not listed");
  assert.equal(companyPathFor({ mint: NVDAX, symbol: "NVDAx", issuerId: "xstocks", instrumentClass: "listed-equity" }, NOW), null);
});

test("the path's data live in the registry alone, and the public registry names no private company but by its mint", () => {
  assert.equal(COMPANY_PATHS.length, 1, "only a company that left the private step has a record");
  assert.ok(LIFECYCLE_EVENTS.some((event) => event.mint === COMPANY_PATHS[0].privateMint && event.watch?.cause.kind === "ipo"));
  const registry = readFileSync(new URL("./lifecycle-events.ts", import.meta.url), "utf8");
  assert.doesNotMatch(registry, /anthropic/i, "the public registry never carries that name");
  assert.doesNotMatch(registry, /oura/i, "Oura has no row until OURAx is in the xStocks catalogue");
});
