import assert from "node:assert/strict";
import test from "node:test";

import { NATIVE_SOL_FEE_RESERVE_LAMPORTS } from "../../../lib/solana/send-inventory.ts";
import { isPhoneUserAgent, phantomBrowseUrl, PHANTOM_DOWNLOAD_URL } from "../../../lib/solana/open-in-wallet.ts";
import {
  FIRST_PURCHASE_LAMPORTS,
  fundingNeed,
  fundsOf,
  fundsReady,
  NEW_TOKEN_ACCOUNT_LAMPORTS,
  PURCHASE_FEE_LAMPORTS,
  returnPath,
  solAmount,
  solShort,
  SUGGESTED_SOL_LAMPORTS,
  suggestedSolUsd,
  UNKNOWN_FUNDS,
} from "./funding-model.ts";
import { INVEST_WORDS, solEnoughLine } from "./invest-words.ts";

/**
 * «Поповнити» and «Простий»'s empty states: what stands between a wallet and
 * its first purchase — USDC from $1 (it was $10), then a little SOL for the
 * network — read from the same holdings every page reads.
 */

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const sol = (lamports, price = "150.00") => ({ kind: "NATIVE_SOL", mint: null, amountRaw: String(lamports), decimals: 9, symbol: "SOL", catalog: { symbol: "SOL", name: "Wrapped SOL", usdPrice: price, category: "crypto" } });
const usdc = (dollars) => ({ kind: "TOKEN", mint: USDC, amountRaw: String(Math.round(dollars * 1e6)), decimals: 6, symbol: "USDC", catalog: { symbol: "USDC", name: "USD Coin", usdPrice: "1", category: "crypto" } });
const apple = { kind: "TOKEN", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", amountRaw: "10630000", decimals: 8, symbol: "AAPLx", catalog: { symbol: "AAPLx", name: "Apple xStock", usdPrice: "235.10", category: "stock" } };

test("the floors are the product's own fee reserve and a new company's account, and 0.01 SOL covers four first purchases", () => {
  assert.equal(PURCHASE_FEE_LAMPORTS, NATIVE_SOL_FEE_RESERVE_LAMPORTS);
  /* A 179-byte Token-2022 account held 1,559,560 lamports on 2026-09-14 (lib/solana/rent.ts); the floor rounds it up. */
  assert.ok(NEW_TOKEN_ACCOUNT_LAMPORTS >= 1_559_560n);
  assert.equal(FIRST_PURCHASE_LAMPORTS, PURCHASE_FEE_LAMPORTS + NEW_TOKEN_ACCOUNT_LAMPORTS);
  assert.equal(SUGGESTED_SOL_LAMPORTS, 10_000_000n);
  assert.ok(SUGGESTED_SOL_LAMPORTS >= 4n * FIRST_PURCHASE_LAMPORTS);
});

test("a wallet's dollars and SOL are read from its holdings, and unknown is never zero", () => {
  assert.deepEqual(fundsOf(null, true), UNKNOWN_FUNDS);
  const empty = fundsOf([sol(0)], true);
  assert.equal(empty.usdc, 0, "a complete read without a USDC row holds none");
  assert.equal(empty.solLamports, 0n);
  assert.equal(empty.ownsCompany, false);
  assert.equal(fundsOf([sol(0)], false).usdc, null, "a partial read says nothing about USDC");
  assert.equal(fundsOf([usdc(52.34)], true).solLamports, null, "no SOL row means the read did not answer");
  const full = fundsOf([sol(120_000_000), usdc(52.34), apple], true);
  assert.equal(full.usdc, 52.34);
  assert.equal(full.solLamports, 120_000_000n);
  assert.equal(full.solUsd, 150);
  assert.equal(full.ownsCompany, true);
  assert.equal(fundsOf([sol(1, "0")], true).solUsd, null, "a price of zero is no price");
});

test("dollars come first, then the network's SOL, then nothing stands in the way", () => {
  assert.equal(fundingNeed(UNKNOWN_FUNDS), "unknown");
  assert.equal(fundingNeed(fundsOf([sol(0)], true)), "usdc", "an empty wallet tops up first");
  assert.equal(fundingNeed(fundsOf([sol(50_000_000), usdc(0.99)], true)), "usdc", "below the $1 minimum");
  assert.equal(fundingNeed(fundsOf([sol(50_000_000), usdc(1)], true)), "ready", "a dollar is enough to buy");
  assert.equal(fundingNeed(fundsOf([sol(0), usdc(25)], true)), "sol", "dollars with no SOL cannot pay the network");
  assert.equal(fundingNeed(fundsOf([sol(Number(FIRST_PURCHASE_LAMPORTS) - 1), usdc(25)], true)), "sol", "a first purchase needs the new account too");
  assert.equal(fundingNeed(fundsOf([sol(Number(FIRST_PURCHASE_LAMPORTS)), usdc(25)], true)), "ready");
  /* A wallet that already holds a company needs only the fee for its next purchase of it. */
  assert.equal(fundingNeed(fundsOf([sol(Number(PURCHASE_FEE_LAMPORTS)), usdc(25), apple], true)), "ready");
  assert.equal(fundingNeed(fundsOf([sol(Number(PURCHASE_FEE_LAMPORTS) - 1), usdc(25), apple], true)), "sol");
  assert.equal(solShort(0n, true), true);
  assert.equal(solShort(FIRST_PURCHASE_LAMPORTS, false), false);
});

test("the top-up's two lines say each need on its own", () => {
  assert.deepEqual(fundsReady(UNKNOWN_FUNDS), { usdc: null, sol: null });
  assert.deepEqual(fundsReady(fundsOf([sol(0), usdc(52.34)], true)), { usdc: true, sol: false });
  assert.deepEqual(fundsReady(fundsOf([sol(120_000_000)], true)), { usdc: false, sol: true });
});

test("SOL reads to four decimals, a dust balance is never zero, and the suggestion is a whole dollar", () => {
  assert.equal(solAmount(120_000_000n, "uk-UA"), "0,12");
  assert.equal(solAmount(2_059_560n, "en-US"), "0.0021");
  assert.equal(solAmount(0n, "en-US"), "0");
  assert.equal(solAmount(5_000n, "en-US"), "< 0.0001");
  assert.equal(suggestedSolUsd(150), 2);
  assert.equal(suggestedSolUsd(40), 1, "never below a dollar");
  assert.equal(suggestedSolUsd(null), null);
  assert.equal(suggestedSolUsd(0), null);
});

test("the way back after a top-up is a page of the cabinet and nothing else", () => {
  assert.equal(returnPath("/app/stocks/AAPLx"), "/app/stocks/AAPLx");
  assert.equal(returnPath("/app/home"), "/app/home");
  for (const hostile of [null, "", "https://evil.example/app", "//evil.example/app", "/app//evil.example", "/app/../admin", "/docs", "/app/stocks?x=1", "javascript:alert(1)", "/app/\\evil"]) {
    assert.equal(returnPath(hostile), null, String(hostile));
  }
});

test("the card's words are the screens' words, in both languages", () => {
  /* The three ways, a row each, and the three empty states — said exactly. */
  const uk = (key) => INVEST_WORDS[key].uk;
  assert.equal(uk("receiveUsdc"), "Отримати USDC");
  assert.equal(uk("cardUsdc"), "Купити карткою у своєму гаманці");
  assert.equal(uk("exchangeUsdc"), "Переказати з біржі");
  assert.equal(uk("connectToBuy"), "Під'єднай гаманець — і купи частинку компанії від $1");
  assert.equal(uk("fundFirst"), "Поповни — і купи першу частинку");
  assert.equal(uk("needSol"), "Потрібно трохи SOL на мережу");
  for (const [key, pair] of Object.entries(INVEST_WORDS)) {
    assert.ok(pair.en.trim() && pair.uk.trim(), `${key} is said in both languages`);
    assert.doesNotMatch(`${pair.en} ${pair.uk}`, /\bRyn\b/, `${key} names no «Ryn»`);
  }
  assert.equal(solEnoughLine("uk", "0,01", 2), "Вистачить ≈0,01 SOL (≈ $2) — мережа бере невелику плату за кожну купівлю.");
  assert.equal(solEnoughLine("en", "0.01", null), "About 0.01 SOL is enough — the network charges a small fee for every purchase.");
});

test("a phone without a wallet opens the page inside Phantom; a computer is sent to install one", () => {
  assert.equal(
    phantomBrowseUrl("https://ryntra.io/app/top-up", "https://ryntra.io"),
    "https://phantom.app/ul/browse/https%3A%2F%2Fryntra.io%2Fapp%2Ftop-up?ref=https%3A%2F%2Fryntra.io",
  );
  assert.equal(isPhoneUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"), true);
  assert.equal(isPhoneUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36"), true);
  assert.equal(isPhoneUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"), false);
  assert.equal(isPhoneUserAgent(undefined), false);
  assert.equal(PHANTOM_DOWNLOAD_URL, "https://phantom.com/download");
});
