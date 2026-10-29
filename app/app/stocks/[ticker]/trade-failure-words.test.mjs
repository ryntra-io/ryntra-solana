// Run from repo root: node --test "app/app/stocks/[ticker]/trade-failure-words.test.mjs"
import assert from "node:assert/strict";
import test from "node:test";

import { tradeFailureLine } from "./trade-failure-words.ts";

/* A stock sheet's failure in the words of a purchase, a sale or a swap of a company (SOL-K1): never the router's
   «маршрут», «пара» or «провайдер обміну», always the sheets' «ти». */

const CODES = [
  "NO_ROUTE", "SIMULATION_FAILED", "ORDER_UNREACHABLE", "ORDER_REFUSED", "INTENT_REFUSED", "AMOUNT_TOO_SMALL", "INSUFFICIENT_FUNDS",
  "QUOTE_EXPIRED", "OWNER_LOCK", "PROVIDER_KEY_MISSING", "SWAP_PRE_SIGN_REFUSED", "HTTP_504", "RATE_LIMITED", "SOMETHING_NEW",
];

test("every family speaks as the trade it is, in both languages, without the router's words", () => {
  for (const code of CODES) {
    for (const kind of ["buy", "sell", "swap"]) {
      for (const lang of ["en", "uk"]) {
        const line = tradeFailureLine({ code }, "hook's sentence", kind, lang);
        assert.ok(line && line.length > 10, `${code} ${kind} ${lang}`);
        assert.doesNotMatch(line, /маршрут|пари|провайдер|route|pair|provider/i, `${code} ${kind} ${lang}: ${line}`);
        if (lang === "uk") assert.doesNotMatch(line, /\bВи\b|Спробуйте|Отримайте|Оновіть/, `${code}: ${line}`);
        if (kind !== "swap") assert.doesNotMatch(line, /swap|обмін/i, `${code} ${kind} ${lang}: ${line}`);
      }
    }
  }
});

test("the amount that cannot be bought, the catch-all, the hook's own sentences, and nothing failed", () => {
  assert.equal(tradeFailureLine({ code: "NO_ROUTE" }, null, "buy", "uk"), "Цю суму зараз не купити.");
  assert.equal(tradeFailureLine({ code: "NO_ROUTE" }, null, "sell", "en"), "This amount can't be sold right now.");
  assert.equal(tradeFailureLine({ code: "SOMETHING_NEW" }, null, "buy", "uk"), "Купівлю не вдалося продовжити. Спробуй ще раз.");
  assert.equal(tradeFailureLine({ code: "REVIEW_CLOSED_UNDER_WALLET" }, "The wallet's own words.", "buy", "en"), "The wallet's own words.");
  assert.equal(tradeFailureLine(null, "anything", "buy", "en"), null);
});
