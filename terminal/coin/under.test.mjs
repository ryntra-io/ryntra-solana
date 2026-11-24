import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { filterTape, holderMarksOf, holderMoveOf, holdersPartOf, isBigTrade, marksOf, resultTone, signedSum, sortTraders, tapeFiltersOf, tapeMarksOf } from "./tape-view.ts";
import { UNDER } from "./under-words.ts";

/* The coin page's lower panel: who bought, who holds, who earned — the rules the screen lays out, held as written. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const trade = (signature, side, usd, wallet, labels) => ({
  signature,
  at: "2026-11-20T00:00:00Z",
  side,
  wallet,
  tokenAmount: 1,
  usd,
  priceUsd: 1,
  capUsd: null,
  ...(labels ? { labels } : {}),
});

const BASIS = { creator: true, topHolders: 12, agents: false, fresh: 3, bigTradeUsd: 1_000, freshRule: { maxAgeHours: 72, maxTransactions: 20 } };

test("a wallet's marks: only the known marks the read sent, the wallet's own before the trade's, at most as many as asked", () => {
  assert.deepEqual(marksOf(["big", "creator", "fresh"]), ["creator", "fresh"]);
  assert.deepEqual(marksOf(["big", "ryntra-agent", "top-holder"], 3), ["ryntra-agent", "top-holder", "big"]);
  assert.deepEqual(marksOf(["kol", "smart"]), []);
  assert.deepEqual(marksOf(undefined), []);
  assert.deepEqual(marksOf(["program"], 1), ["program"]);
});

test("no marks in the read: the trades read as before, and «Big» falls back on the dollars", () => {
  assert.equal(tapeMarksOf(undefined), null);
  assert.equal(tapeMarksOf("nothing"), null);
  assert.deepEqual(tapeFiltersOf(null, null), ["all", "big"]);
  const trades = [trade("a", "buy", 1_500, "W1"), trade("b", "sell", 20, "W2")];
  assert.deepEqual(filterTape(trades, "all", null, null), trades);
  assert.deepEqual(filterTape(trades, "big", null, null).map((t) => t.signature), ["a"]);
  // A filter the screen does not offer keeps every trade.
  assert.deepEqual(filterTape(trades, "creator", null, null), trades);
});

test("the filters: «Creator» once the creator is named, «Top holders» once the holders were read, «Mine» with a wallet", () => {
  const marks = tapeMarksOf(BASIS);
  assert.deepEqual(marks, { creator: true, top: true, bigUsd: 1_000 });
  assert.deepEqual(tapeFiltersOf(marks, "ME"), ["all", "creator", "big", "top", "mine"]);
  assert.deepEqual(tapeFiltersOf(tapeMarksOf({ ...BASIS, creator: false, topHolders: null }), null), ["all", "big"]);
  const trades = [
    trade("1", "buy", 50, "DEV", ["creator"]),
    trade("2", "buy", 5_000, "WHALE", ["top-holder", "big"]),
    trade("3", "sell", 2_000, "ME"),
    trade("4", "buy", 1_200, "X", ["fresh"]),
  ];
  assert.deepEqual(filterTape(trades, "creator", marks, "ME").map((t) => t.signature), ["1"]);
  assert.deepEqual(filterTape(trades, "top", marks, "ME").map((t) => t.signature), ["2"]);
  assert.deepEqual(filterTape(trades, "mine", marks, "ME").map((t) => t.signature), ["3"]);
  // Where the read marked the trades, «Big» is its mark — its own bar — not the dollars.
  assert.deepEqual(filterTape(trades, "big", marks, "ME").map((t) => t.signature), ["2"]);
  assert.equal(isBigTrade(trades[2], marks), false);
  assert.equal(isBigTrade(trades[2], null), true);
});

test("what a holder did in the trades read: bought more, sold, evenly, or nothing said", () => {
  assert.deepEqual(holderMoveOf({ change: 120, trades: 2 }), { kind: "added", tokens: 120 });
  assert.deepEqual(holderMoveOf({ change: -40.5, trades: 1 }), { kind: "sold", tokens: 40.5 });
  assert.deepEqual(holderMoveOf({ change: 0, trades: 2 }), { kind: "even", tokens: 0 });
  assert.equal(holderMoveOf({ change: 0, trades: 0 }), null);
  assert.equal(holderMoveOf({ change: null, trades: 0 }), null);
  assert.deepEqual(holderMarksOf(["creator", "program"]), ["creator"]);
  assert.deepEqual(holderMarksOf(["pool"]), ["pool"]);
  assert.deepEqual(holderMarksOf([]), []);
});

test("one honest line when the holders listed are only the largest part", () => {
  const largest = { listed: 20, ceiling: 20, source: "largest-accounts", whole: false, holders: 4_210 };
  assert.deepEqual(holdersPartOf(largest, 20), { listed: 20, of: 4_210 });
  assert.deepEqual(holdersPartOf({ ...largest, holders: null }, 20), { listed: 20, of: null });
  // Every holder listed: nothing to say.
  assert.equal(holdersPartOf({ listed: 37, ceiling: 100, source: "all-accounts", whole: true, holders: 37 }, 37), null);
  assert.equal(holdersPartOf({ listed: 37, ceiling: 100, source: "all-accounts", whole: true, holders: null }, 37), null);
  assert.equal(holdersPartOf(undefined, 20), null);
  assert.equal(holdersPartOf(null, 20), null);
});

const row = (wallet, resultUsd, boughtUsd = 100, soldUsd = 0) => ({ wallet, buys: 1, sells: 0, boughtTokens: 1, soldTokens: 0, boughtUsd, soldUsd, unpriced: 0, avgBuyPriceUsd: 1, avgSellPriceUsd: null, netTokens: 1, realizedUsd: 0, unrealizedUsd: resultUsd, resultUsd, completenessPct: 100, firstAt: "2026-11-20T00:00:00Z", lastAt: "2026-11-20T00:00:00Z" });

test("the traders by result: the largest first or the smallest; a result not known always last, by turnover", () => {
  const rows = [row("A", 10), row("B", null, 900), row("C", -50), row("D", 300), row("E", null, 2_000)];
  assert.deepEqual(sortTraders(rows).map((r) => r.wallet), ["D", "A", "C", "E", "B"]);
  assert.deepEqual(sortTraders(rows, "up").map((r) => r.wallet), ["C", "A", "D", "E", "B"]);
  assert.equal(rows[0].wallet, "A", "the rows read are not reordered in place");
});

test("a result as it is read: signed, toned, nothing for zero", () => {
  const sum = (abs) => `$${abs}`;
  assert.equal(signedSum(120, sum), "+$120");
  assert.equal(signedSum(-3, sum), "−$3");
  assert.equal(signedSum(0, sum), "$0");
  assert.equal(resultTone(5), "up");
  assert.equal(resultTone(-5), "down");
  assert.equal(resultTone(0), undefined);
  assert.equal(resultTone(null), undefined);
});

const NEVER = [/\bAPI\b|\bengine\b|\bRPC\b|\bendpoint\b|\bJSON\b|\bHelius\b|\bGeckoTerminal\b|\bSolscan\b/i, /двигун|ендпоінт|гарант/i, /\bmoon|\b100x\b|\bguarantee/i, /\b[A-Z]{3,4}-\d{2,}\b/];

test("the panel's words: both languages alike, nothing technical, no hype", () => {
  assert.deepEqual(Object.keys(UNDER.uk).sort(), Object.keys(UNDER.en).sort());
  for (const lang of ["en", "uk"]) {
    for (const [key, value] of Object.entries(UNDER[lang])) {
      assert.equal(typeof value, typeof UNDER.en[key], `${lang}.${key}`);
      const said = typeof value === "string" ? value : value(...Array.from({ length: value.length }, () => "12"));
      assert.ok(said.trim(), `${lang}.${key} is empty`);
      for (const word of NEVER) assert.doesNotMatch(said, word, `${lang}.${key}: «${said}»`);
    }
    // A mark beside a wallet is one word.
    for (const key of ["markCreator", "markAgent", "markTop", "markPool", "markVault", "markBig", "markFresh"]) assert.match(UNDER[lang][key], /^\S+$/u, `${lang}.${key}`);
  }
});

test("a wallet in any row opens its page in the terminal, never another site; a transaction may", () => {
  const tabs = read("./MarketTabs.tsx");
  assert.match(tabs, /href=\{walletHref\(address\)\}/);
  assert.doesNotMatch(tabs, /solscan\.io\/account/);
  assert.doesNotMatch(tabs, /solscan\('account'/);
  // Every wallet cell goes through the one link.
  assert.equal((tabs.match(/<Wallet address=/g) ?? []).length, 4);
});
