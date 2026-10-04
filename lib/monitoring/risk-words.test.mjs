import assert from "node:assert/strict";
import test from "node:test";

import { RISK_REASONS, RISK_STATES } from "./portfolio-risk.ts";
import { RISK_STATE_WORDS, RISK_WORDS, riskFindingLine, riskGapLine, riskMoreWord } from "./risk-words.ts";

/*
 * The words of «Ризик портфеля»: the three state names, every reason in both
 * languages with its figures, what could not be read, and never «ордер»,
 * «Захищено», the persona or advice to sell.
 */

const pct = (value) => `${String(value).replace(".", ",")}%`;
const finding = (reason, over = {}) => ({ reason, name: "NVIDIA", symbol: "NVDAx", sharePct: null, capPct: null, watchReason: null, ...over });

test("the three state names: «Нормальний» · «Увага» · «Не вдалося перевірити», each in both languages", () => {
  assert.deepEqual(Object.keys(RISK_STATE_WORDS).sort(), [...RISK_STATES].sort());
  assert.equal(RISK_STATE_WORDS.normal.uk, "Нормальний");
  assert.equal(RISK_STATE_WORDS.attention.uk, "Увага");
  assert.equal(RISK_STATE_WORDS.unknown.uk, "Не вдалося перевірити");
  assert.equal(RISK_WORDS.title.uk, "Ризик портфеля");
});

test("every reason reads in both languages with the figures it stands on", () => {
  for (const reason of RISK_REASONS) {
    for (const lang of ["en", "uk"]) assert.ok(riskFindingLine(finding(reason, { sharePct: 42.3, capPct: 25 }), lang, pct).length > 10, `${reason} ${lang}`);
  }
  assert.equal(riskFindingLine(finding("action", { watchReason: "limit" }), "uk", pct), "NVIDIA: ціна дійшла до межі збитку");
  assert.equal(riskFindingLine(finding("action", { watchReason: "target" }), "en", pct), "NVIDIA: the price reached your target");
  assert.equal(riskFindingLine(finding("weekend-no-limit"), "uk", pct), "NVIDIA: без межі збитку на вихідні");
  assert.equal(riskFindingLine(finding("concentration", { sharePct: 42.3, capPct: 25 }), "uk", pct), "NVIDIA — 42,3% гаманця, понад 25%");
  assert.equal(riskFindingLine(finding("private-share", { name: null, symbol: null, sharePct: 14, capPct: 10 }), "en", pct), "Private companies are 14% of the wallet — above 10%");
});

test("what could not be read is named by the gap that stands behind the rest", () => {
  assert.equal(riskGapLine(["prices", "holdings"], "uk"), "частину гаманця не прочитано");
  assert.equal(riskGapLine(["prices", "exits"], "uk"), "межі позицій не прочитано");
  assert.equal(riskGapLine(["prices"], "en"), "a fresh price is missing");
  assert.equal(riskGapLine([], "en"), null);
  assert.equal(riskMoreWord(2, "uk"), "ще 2");
});

test("no forbidden word: no «ордер», no «Захищено», no persona, no advice to sell", () => {
  const all = [
    ...Object.values(RISK_STATE_WORDS).flatMap((word) => [word.en, word.uk]),
    ...Object.values(RISK_WORDS).flatMap((word) => [word.en, word.uk]),
    ...RISK_REASONS.flatMap((reason) => ["en", "uk"].map((lang) => riskFindingLine(finding(reason, { sharePct: 30, capPct: 25 }), lang, pct))),
  ].join(" \n ");
  assert.doesNotMatch(all, /ордер|\border\b|Захищено|Protected|(^|[^A-Za-z])Ryn(?![a-z])|Продавай|Sell now|гарантовано|guaranteed/i);
});
