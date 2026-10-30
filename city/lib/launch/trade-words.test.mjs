import assert from "node:assert/strict";
import test from "node:test";

import { BUILD_UNEXPECTED, TRADE_CLOSED, WALLET_REFUSED } from "./trade-flow.ts";
import { dollarsText, earnerText, feeLineText, getText, honestText, pctText, progressText, riskText, tradeFailureText, unitsText } from "./trade-words.ts";
import { LAUNCH_TRADE } from "./words.ts";

test("the live fee line — the countdown never parted from its word", () => {
  const falling = { venue: "curve", nowBps: 1400, endBps: 100, leftS: 48 };
  assert.equal(feeLineText(falling, "uk"), "Комісія запуску зараз 14 % → 1 % за 0:48");
  assert.equal(feeLineText(falling, "en"), "Launch fee now 14% → 1% in 0:48");
  assert.equal(feeLineText({ venue: "curve", nowBps: 120, endBps: null, leftS: null }, "en"), "Fee now 1.2%");
  assert.equal(feeLineText({ venue: "curve", nowBps: 947, endBps: 100, leftS: 101 }, "uk"), "Комісія запуску зараз 9,5 % → 1 % за 1:41", "one decimal, rounded up");
  assert.equal(feeLineText({ venue: "curve", nowBps: 174, endBps: null, leftS: null }, "en"), "Fee now 1.8%");
  assert.equal(feeLineText({ venue: "pool", nowBps: 70, endBps: null, leftS: null }, "uk"), "Комісія пулу зараз 0,7 %");
});

test("the bonding bar's line, before and after graduation", () => {
  const curve = { migrated: false, pct: 46, capUsd: 34_500, graduationUsd: 75_000 };
  assert.equal(progressText(curve, "uk"), "До виходу на DEX: 46 % · $34,5K з $75K");
  assert.equal(progressText(curve, "en"), "To DEX: 46% · $34.5K of $75K");
  assert.equal(progressText({ ...curve, capUsd: null }, "en"), "To DEX: 46%");
  assert.equal(progressText({ migrated: true, jupiter: false }, "uk"), "Вийшла · DAMM v2");
  assert.equal(progressText({ migrated: true, jupiter: true }, "en"), "Graduated · DAMM v2 · Jupiter");
});

test("one honest line: the fee rounded up, the least received rounded down, the risk said plainly", () => {
  const review = { side: "buy", spend: 25, get: 12_449_999, minimum: 12_076_499.5, fee: 3.501, feeBps: 1400, priceMoveBps: 240, left: 0, spendSymbol: "USDC", getSymbol: "SPARK" };
  assert.equal(honestText(review, "USDC", "en"), "Fee 3.51 USDC · at least 12M SPARK");
  assert.equal(honestText(review, "USDC", "uk"), "Комісія 3,51 USDC · щонайменше 12M SPARK");
  assert.equal(getText(review, "en"), "≈ 12.4M SPARK · price +2.4%");
  assert.equal(LAUNCH_TRADE.uk.risk, "Більшість нових монет дешевшає.");
  assert.equal(LAUNCH_TRADE.en.risk, "Most new coins lose value.");
});

test("figures: never more than they are", () => {
  assert.equal(unitsText(12_499_999, "down", "en"), "12.4M");
  assert.equal(unitsText(1_234_567_890, "down", "en"), "1.2B");
  assert.equal(unitsText(45_678, "down", "en"), "45.6K");
  assert.equal(unitsText(3.509, "up", "en"), "3.51");
  assert.equal(unitsText(3.509, "down", "uk"), "3,50");
  assert.equal(unitsText(0.004219, "down", "en"), "0.0042");
  assert.equal(unitsText(0, "down", "en"), "0");
  assert.equal(pctText(50, "en"), "0.5%");
  assert.equal(pctText(5000, "uk"), "50 %");
  assert.equal(dollarsText(34_500, "en"), "$34.5K");
  assert.equal(dollarsText(75_000, "en"), "$75K");
  assert.equal(dollarsText(1_250_000, "uk"), "$1,25M");
  assert.equal(dollarsText(5_000, "en"), "$5K");
});

test("who earns the fee is named in the language on screen", () => {
  assert.equal(earnerText("creatorPosition", "en"), "Creator’s locked liquidity");
  assert.equal(earnerText("compounding", "uk"), "Назад у пул");
  assert.equal(earnerText("meteora", "uk"), "Meteora");
});

test("a stopped trade says in a line or two whether anything left", () => {
  assert.equal(tradeFailureText({ code: WALLET_REFUSED, stage: "before", message: "" }, "Phantom", "en"), "Phantom did not sign. Nothing was sent.");
  assert.equal(tradeFailureText({ code: WALLET_REFUSED, stage: "before", message: "" }, null, "uk"), "Гаманець не підписав. Нічого не надіслано.");
  assert.equal(tradeFailureText({ code: TRADE_CLOSED, stage: "before", message: "" }, null, "uk"), LAUNCH_TRADE.uk.closed);
  assert.equal(tradeFailureText({ code: "LAUNCH_SLIPPAGE", stage: "send", message: "" }, null, "en"), "The price moved past your slippage. Nothing moved.");
  for (const lang of ["en", "uk"]) {
    for (const code of ["LAUNCH_BALANCE_LOW", "LAUNCH_GRADUATING", "RATE_LIMITED", "LAUNCH_BUILD_EXPIRED", "SOMETHING_NEW"]) {
      for (const stage of ["before", "send"]) {
        const text = tradeFailureText({ code, stage, message: "" }, null, lang);
        assert.ok(text.split(/[.!?;](\s|$)/).filter((part) => part && part.trim()).length <= 3, `${lang} ${code}: ${text}`);
        assert.doesNotMatch(text, /API|\/api\//, "no technical words");
      }
    }
  }
});

test("the risk beside the one line follows the engine's verdict over this trade", () => {
  assert.equal(riskText(null, "en"), "Most new coins lose value.");
  assert.equal(riskText("INCOMPLETE", "uk"), "Більшість нових монет дешевшає.", "a devnet trade the engine could not read stays on the plain truth");
  assert.equal(riskText("NO_KNOWN_BLOCKER", "en"), "Most new coins lose value.");
  assert.equal(riskText("REVIEW_REQUIRED", "uk"), "Перевірка ризику радить придивитися.");
  assert.equal(riskText("BLOCKED", "en"), "The risk check stops this trade.");
});

test("no technical word in a failure a person reads", () => {
  for (const lang of ["en", "uk"]) {
    const text = tradeFailureText({ code: BUILD_UNEXPECTED, stage: "before", message: "" }, null, lang);
    assert.doesNotMatch(text, /engine|двигун/i);
  }
});
