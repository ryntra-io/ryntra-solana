import assert from "node:assert/strict";
import test from "node:test";

import { ASSET_CAP_PCT, CAPS_FROM_USD, judgePortfolioRisk, PRIVATE_CAP_PCT, USDC_MINT, weekendAhead, weekendInNewYork } from "./portfolio-risk.ts";

/*
 * «Ризик портфеля» and its caps: «Нормальний» only on full data and no broken
 * rule; «Увага: <причина>» names every broken rule, the most urgent first;
 * «Не вдалося перевірити» when something is missing and nothing known breaks
 * a rule.
 */

const asset = (key, kind, valueUsd, over = {}) => ({ key, mint: `${key}Mint1111111111111111111111111111`, symbol: key, name: key, kind, valueUsd, ...over });
const position = (symbol, over = {}) => ({ mint: `${symbol}Mint1111111111111111111111111111`, symbol, name: symbol, kind: "company", state: "on-plan", reason: "between", hasLimit: true, weekendAhead: false, ...over });

/* A $1 000 wallet: four companies at 20 % each and $200 of dollars. */
const BALANCED = [asset("AAPL", "company", 200), asset("NVDA", "company", 200), asset("TSLA", "company", 200), asset("SPY", "company", 200), asset("USDC", "dollar", 200, { mint: USDC_MINT })];
const POSITIONS = ["AAPL", "NVDA", "TSLA", "SPY"].map((symbol) => position(symbol));

test("every figure read and no rule broken: «Нормальний», the caps judged on the whole wallet", () => {
  const risk = judgePortfolioRisk({ positions: POSITIONS, assets: BALANCED, gaps: [] });
  assert.equal(risk.state, "normal");
  assert.deepEqual(risk.findings, []);
  assert.deepEqual(risk.gaps, []);
  assert.equal(risk.totalUsd, 1000);
  assert.equal(risk.capsApplied, true);
});

test("a missing figure never reads «Нормальний»: «Не вдалося перевірити», and no share is judged on a partial total", () => {
  for (const gap of ["holdings", "market", "exits", "balance", "prices"]) {
    const risk = judgePortfolioRisk({ positions: POSITIONS, assets: BALANCED, gaps: [gap] });
    assert.equal(risk.state, "unknown", gap);
    assert.deepEqual(risk.gaps, [gap]);
    assert.equal(risk.totalUsd, null);
    assert.equal(risk.capsApplied, false);
  }
  /* One company is 80 % of what was read — but what was not read could be most of the wallet: no share is claimed. */
  const partial = judgePortfolioRisk({ positions: [position("NVDA")], assets: [asset("NVDA", "company", 800), asset("USDC", "dollar", 200)], gaps: ["prices"] });
  assert.equal(partial.state, "unknown");
  assert.deepEqual(partial.findings, []);
  /* Gaps are named once each, in a fixed order. */
  assert.deepEqual(judgePortfolioRisk({ positions: [], assets: [], gaps: ["prices", "exits", "holdings", "prices"] }).gaps, ["holdings", "exits", "prices"]);
});

test("a position in «Дія» is «Увага» — certain on its own price, even when something else could not be read", () => {
  const positions = [position("TSLA", { state: "action", reason: "limit" }), position("AAPL", { state: "action", reason: "target" }), ...POSITIONS.slice(1)];
  const risk = judgePortfolioRisk({ positions, assets: BALANCED, gaps: [] });
  assert.equal(risk.state, "attention");
  assert.deepEqual(risk.findings.map((row) => [row.reason, row.symbol, row.watchReason]), [["action", "TSLA", "limit"], ["action", "AAPL", "target"]]);
  const unread = judgePortfolioRisk({ positions, assets: BALANCED, gaps: ["balance"] });
  assert.equal(unread.state, "attention");
  assert.deepEqual(unread.gaps, ["balance"]);
});

test("one asset above 25 % of the wallet — a company counted once across its tokens, named by its largest", () => {
  const assets = [asset("NVDA", "company", 150, { mint: "NVDAxMint", symbol: "NVDAx", name: "NVIDIA" }), asset("NVDA", "company", 120, { mint: "NVDAonMint", symbol: "NVDAon", name: "NVIDIA" }), asset("AAPL", "company", 230), asset("USDC", "dollar", 500, { mint: USDC_MINT })];
  const risk = judgePortfolioRisk({ positions: [], assets, gaps: [] });
  assert.equal(risk.state, "attention");
  assert.deepEqual(risk.findings, [{ reason: "concentration", kind: "company", mint: "NVDAxMint", symbol: "NVDAx", name: "NVIDIA", sharePct: 27, capPct: ASSET_CAP_PCT, watchReason: null }]);
  /* Exactly at the cap, and at the cap after rounding to the figure shown, is within it. */
  assert.equal(judgePortfolioRisk({ positions: [], assets: [asset("A", "company", 250), asset("USDC", "dollar", 750)], gaps: [] }).state, "normal");
  assert.equal(judgePortfolioRisk({ positions: [], assets: [asset("A", "company", 250.4), asset("USDC", "dollar", 749.6)], gaps: [] }).state, "normal");
  assert.equal(judgePortfolioRisk({ positions: [], assets: [asset("A", "company", 250.6), asset("USDC", "dollar", 749.4)], gaps: [] }).findings[0].sharePct, 25.1);
});

test("dollars are in the total and outside the caps; a coin is an asset like any other", () => {
  assert.equal(judgePortfolioRisk({ positions: [], assets: [asset("USDC", "dollar", 900, { mint: USDC_MINT }), asset("AAPL", "company", 100)], gaps: [] }).state, "normal");
  const sol = judgePortfolioRisk({ positions: [], assets: [asset("SOL", "crypto", 600, { name: "Solana" }), asset("USDC", "dollar", 400)], gaps: [] });
  assert.deepEqual(sol.findings.map((row) => [row.reason, row.kind, row.name, row.sharePct]), [["concentration", "crypto", "Solana", 60]]);
});

test("the private companies together above 10 % — one reason for the class, besides any one of them above 25 %", () => {
  const assets = [asset("SPACEX", "private", 80), asset("OPENAI", "private", 70), asset("AAPL", "company", 200), asset("USDC", "dollar", 650)];
  const risk = judgePortfolioRisk({ positions: [], assets, gaps: [] });
  assert.deepEqual(risk.findings, [{ reason: "private-share", kind: "private", mint: null, symbol: null, name: null, sharePct: 15, capPct: PRIVATE_CAP_PCT, watchReason: null }]);
  const heavy = judgePortfolioRisk({ positions: [], assets: [asset("SPACEX", "private", 300), asset("USDC", "dollar", 700)], gaps: [] });
  assert.deepEqual(heavy.findings.map((row) => [row.reason, row.sharePct]), [["concentration", 30], ["private-share", 30]]);
});

test("below a $500 wallet the one-asset cap waits — a first $20 in one company is not a warning; the private companies' cap does not wait", () => {
  const small = judgePortfolioRisk({ positions: [position("NVDA")], assets: [asset("NVDA", "company", 20), asset("USDC", "dollar", 5)], gaps: [] });
  assert.equal(small.state, "normal");
  assert.equal(small.capsApplied, false);
  assert.equal(small.totalUsd, 25);
  assert.equal(judgePortfolioRisk({ positions: [], assets: [asset("NVDA", "company", CAPS_FROM_USD)], gaps: [] }).state, "attention");
  /* A $200 wallet three-quarters in SpaceX: a sale of it may not go through — said at any size. */
  const spacex = judgePortfolioRisk({ positions: [], assets: [asset("SPACEX", "private", 150), asset("USDC", "dollar", 50)], gaps: [] });
  assert.deepEqual(spacex.findings.map((row) => [row.reason, row.sharePct]), [["private-share", 75]]);
  assert.equal(spacex.capsApplied, false);
});

test("a listed company with no loss limit over the weekend is «Увага»; a private one has no weekend, a limit ends it", () => {
  const weekend = judgePortfolioRisk({ positions: [position("NVDA", { hasLimit: false, state: "exit-not-set", reason: "no-exit", weekendAhead: true })], assets: [asset("NVDA", "company", 20)], gaps: [] });
  assert.deepEqual(weekend.findings.map((row) => [row.reason, row.symbol]), [["weekend-no-limit", "NVDA"]]);
  /* On a weekday the same position is Нагляд's amber line, not the portfolio's. */
  assert.equal(judgePortfolioRisk({ positions: [position("NVDA", { hasLimit: false, state: "exit-not-set", reason: "no-exit" })], assets: [asset("NVDA", "company", 20)], gaps: [] }).state, "normal");
  assert.equal(judgePortfolioRisk({ positions: [position("SPACEX", { kind: "private", hasLimit: false, weekendAhead: true })], assets: [asset("SPACEX", "private", 20), asset("USDC", "dollar", 200)], gaps: [] }).state, "normal");
  assert.equal(judgePortfolioRisk({ positions: [position("NVDA", { weekendAhead: true })], assets: [asset("NVDA", "company", 20)], gaps: [] }).state, "normal");
  /* An exit that could not be read is not an absent one: no weekend warning on it, and «Не вдалося перевірити». */
  const unread = judgePortfolioRisk({ positions: [position("NVDA", { hasLimit: null, state: "exit-not-set", reason: "no-exit", weekendAhead: true })], assets: [asset("NVDA", "company", 20)], gaps: ["exits"] });
  assert.equal(unread.state, "unknown");
  assert.deepEqual(unread.findings, []);
});

test("every broken rule is named, the most urgent first: «Дія», the weekend, one asset, the private companies", () => {
  const positions = [position("NVDA", { hasLimit: false, state: "exit-not-set", reason: "no-exit", weekendAhead: true }), position("TSLA", { state: "action", reason: "limit" })];
  const assets = [asset("NVDA", "company", 400), asset("TSLA", "company", 100), asset("SPACEX", "private", 150), asset("USDC", "dollar", 350)];
  const risk = judgePortfolioRisk({ positions, assets, gaps: [] });
  assert.deepEqual(risk.findings.map((row) => row.reason), ["action", "weekend-no-limit", "concentration", "private-share"]);
});

test("the weekend is New York's Friday to Sunday; a day off is a close that opens more than a day away — never a night's close", () => {
  /* 2026-10-02 is a Friday. Thursday 23:00 in New York is Friday 06:00 in Kyiv — not yet the weekend. */
  assert.equal(weekendInNewYork(Date.parse("2026-10-02T03:00:00Z")), false);
  assert.equal(weekendInNewYork(Date.parse("2026-10-02T14:00:00Z")), true);
  assert.equal(weekendInNewYork(Date.parse("2026-10-04T20:00:00Z")), true, "Sunday afternoon in New York");
  /* Monday 00:30 in Kyiv is still Sunday in New York; Monday 05:00 UTC is Monday there. */
  assert.equal(weekendInNewYork(Date.parse("2026-10-05T03:30:00Z")), true);
  assert.equal(weekendInNewYork(Date.parse("2026-10-05T05:00:00Z")), false);
  /* Tuesday night: the regular session closed, opening in ten hours — a night, not a weekend. */
  const tuesdayNight = Date.parse("2026-09-30T00:30:00Z");
  assert.equal(weekendAhead({ nowMs: tuesdayNight, exchangeClosed: true, closedUntil: "2026-09-30T13:30:00Z" }), false);
  assert.equal(weekendAhead({ nowMs: tuesdayNight, exchangeClosed: true, closedUntil: null }), false, "a close that does not say when it opens is not a day off");
  /* A holiday: closed, and opening more than a day away. */
  assert.equal(weekendAhead({ nowMs: tuesdayNight, exchangeClosed: true, closedUntil: "2026-10-01T13:30:00Z" }), true);
  assert.equal(weekendAhead({ nowMs: tuesdayNight, exchangeClosed: false, closedUntil: null }), false);
});
