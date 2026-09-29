// Run from repo root: node --test app/app/invest/price-condition-view.test.mjs
/**
 * The price condition's words on the company page (`RYN-PRICE-GUARD-001`;
 * canon v5.5 В37, §4.1): the Review's line — the deviation, the reference,
 * the limit, the data's time — why a purchase waits, how the price stands now
 * under a rule being written; both languages; PreStocks' valuation never a
 * fair price.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { checkPriceCondition } from "../../../lib/autoinvest/price-condition.ts";
import { conditionNowLine, conditionReviewLine, conditionShort, deferralLine } from "./price-condition-view.ts";

const N = " ";
const KYIV = "Europe/Kyiv";
/* Saturday 26 September 2026, 10:32 in Kyiv. */
const AT = Date.parse("2026-09-26T07:32:00.000Z");
const facts = (deviation, { reference = "prestocks", ref = 1000, priceAt = AT, referenceAt = AT } = {}) => ({ reference, priceUsd: Math.round(ref * (1 + deviation / 100) * 1e6) / 1e6, priceAtMs: priceAt, referenceUsd: ref, referenceAtMs: referenceAt, referenceStale: false });

test("the Review's line: the deviation to a tenth, the reference by name, the limit and the data's time, in both languages", () => {
  const listed = checkPriceCondition(5, facts(0.4, { reference: "issuer", ref: 200 }), AT + 60_000);
  assert.equal(conditionReviewLine(listed, AT + 60_000, KYIV, "uk"), `+0,4${N}% до орієнтира емітента $200,00 · ліміт 5${N}% · дані 10:32`);
  assert.equal(conditionReviewLine(listed, AT + 60_000, KYIV, "en"), "+0.4% against the issuer's reference of $200.00 · limit 5% · data at 10:32");
  const discount = checkPriceCondition(5, facts(-21), AT);
  assert.equal(conditionReviewLine(discount, AT, KYIV, "uk"), `−21,0${N}% до оцінки PreStocks $1${N}000,00 · ліміт 5${N}% · дані 10:32`);
});

test("why a purchase waits: the figure and the limit, old data and a missing reference said plainly", () => {
  const above = checkPriceCondition(5, facts(30), AT);
  assert.equal(deferralLine(above, "OpenAI", AT, KYIV, "uk"), `OpenAI на 30${N}% дорожча за оцінку PreStocks (твій ліміт 5${N}%) · дані 10:32`);
  assert.equal(deferralLine(above, "OpenAI", AT, KYIV, "en"), "OpenAI is 30% above PreStocks' valuation (your limit 5%) · data at 10:32");
  const old = checkPriceCondition(5, facts(1, { priceAt: AT - 26 * 3_600_000 }), AT);
  assert.equal(deferralLine(old, "OpenAI", AT, KYIV, "uk"), "OpenAI — дані про ціну застаріли · останні — 25 вер. о 08:32");
  assert.equal(deferralLine(checkPriceCondition(5, null, AT), "OpenAI", AT, KYIV, "en"), "OpenAI — no reference right now");
});

test("how the price stands now under a rule being written, and the rule's condition as a short fact", () => {
  assert.equal(conditionNowLine(checkPriceCondition(5, facts(29), AT), "uk"), `Зараз ціна на 29${N}% дорожча за оцінку PreStocks — купівлю буде відкладено.`);
  assert.equal(conditionNowLine(checkPriceCondition(5, facts(0.4, { reference: "issuer", ref: 200 }), AT), "en"), "Now the price is 0.4% above the issuer's reference — within the condition.");
  assert.equal(conditionNowLine(checkPriceCondition(5, facts(1, { referenceAt: AT - 3_600_000 }), AT), "uk"), "Свіжих даних зараз немає — правило чекатиме на них.");
  assert.equal(conditionShort(5, "prestocks", "uk"), `не дорожче за оцінку PreStocks більш ніж на${N}5${N}%`);
  assert.equal(conditionShort(10, "market", "en"), "at most 10% above the market reference");
  for (const lang of ["en", "uk"]) {
    for (const text of [conditionReviewLine(checkPriceCondition(5, facts(3), AT), AT, KYIV, lang), deferralLine(checkPriceCondition(5, facts(30), AT), "OpenAI", AT, KYIV, lang), conditionShort(5, "prestocks", lang)]) {
      assert.doesNotMatch(text, /справедлив|fair price/i);
    }
  }
});
