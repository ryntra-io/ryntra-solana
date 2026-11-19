import { test } from "node:test";
import assert from "node:assert/strict";
import { pressOf } from "./bridge-form.ts";
import { feeShort, flipText, mintOfParam, pairOfLink, pickStart, reasonOf, solThin } from "./swap-view.ts";
import { MAIN_MINTS } from "../coin/staples.ts";
import { SOL, USDC, USDT_MINT } from "../../city/lib/trade/tiles.ts";
import { askDecimals, knownDecimals, learnDecimals } from "../../city/lib/trade/decimals.ts";

/* The Swap and the Bridge after the quality pass of 19.11 at night. */

const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const coin = (mint, symbol) => ({ mint, symbol, decimals: null, name: symbol });

test("the flip carries what «You get» showed, to six significant digits, rounded down (m1)", () => {
  assert.equal(flipText("146452391", 6), "146.452");
  assert.equal(flipText("136312345", 9), "0.136312");
  assert.equal(flipText("123456789012345", 6), "123456789", "whole units are never cut");
  assert.equal(flipText("5", 0), "5");
  assert.equal(flipText("0", 6), null);
  assert.equal(flipText(null, 6), null);
  assert.equal(flipText("12", null), null);
});

test("a wallet without any SOL is short for the fee, and only for a coin other than SOL (M14)", () => {
  assert.equal(feeShort({ spendableRaw: "0", decimals: 9 }, USDC.mint), true);
  assert.equal(feeShort({ spendableRaw: "0", decimals: 9 }, SOL.mint), false, "spending SOL says its own shortfall");
  assert.equal(feeShort({ spendableRaw: "1000", decimals: 9 }, USDC.mint), false);
  assert.equal(feeShort(null, USDC.mint), false, "a wallet not read yet is not short");
  assert.equal(solThin({ spendableRaw: "1000", decimals: 9 }), true);
  assert.equal(solThin({ spendableRaw: "65858523956", decimals: 9 }), false);
});

test("a refused press is said in the person's terms (M14)", () => {
  // Jupiter offered to pay the fee for a wallet without SOL: not «the wrong transaction came back».
  assert.equal(reasonOf({ code: "TRANSACTION_FEE_PAYER_MISMATCH", solThin: true, frozen: false }), "needSol");
  // 65 SOL and the provider would not build: never «the wallet does not cover the amount».
  assert.equal(reasonOf({ code: "ORDER_BUILD_FAILED", solThin: false, frozen: false }), "notBuilt");
  assert.equal(reasonOf({ code: "ORDER_BUILD_FAILED", solThin: true, frozen: false }), "needSol");
  assert.equal(reasonOf({ code: "ORDER_BUILD_FAILED", solThin: false, frozen: true }), "frozen");
  assert.equal(reasonOf({ code: "SIMULATION_FAILED", solThin: true, frozen: false }), "needSol");
  assert.equal(reasonOf({ code: "SIMULATION_FAILED", solThin: false, frozen: false }), null, "the engine's own sentence stands");
  // Ryntra's own checks keep their own sentence: the bytes the wallet changed are not a want of SOL.
  assert.equal(reasonOf({ code: "SIGNED_FEE_PAYER_MISMATCH", solThin: true, frozen: false }), null);
  assert.equal(reasonOf({ code: "SIMULATION_EFFECT_FEE_PAYER_MISMATCH", solThin: true, frozen: true }), null);
  assert.equal(reasonOf({ code: "SIMULATION_UNAVAILABLE", solThin: true, frozen: false }), null);
  assert.equal(reasonOf({ code: "ORDER_NO_ROUTE", solThin: true, frozen: false }), null);
  assert.equal(reasonOf({ code: undefined, solThin: true, frozen: true }), null);
});

test("a link names its pair: the coin beyond SOL and USDC is the one the ticket stands on (m2)", () => {
  assert.deepEqual(pairOfLink("USDC", JUP), { subject: JUP, side: "buy", counter: USDC.mint });
  assert.deepEqual(pairOfLink(JUP, "usdc"), { subject: JUP, side: "sell", counter: USDC.mint });
  assert.deepEqual(pairOfLink("SOL", "USDC"), { subject: SOL.mint, side: "sell", counter: USDC.mint });
  assert.deepEqual(pairOfLink("USDC", "SOL"), { subject: SOL.mint, side: "buy", counter: USDC.mint });
  assert.deepEqual(pairOfLink(null, BONK), { subject: BONK, side: "buy", counter: null });
  assert.deepEqual(pairOfLink(BONK, null), { subject: BONK, side: "sell", counter: null });
  assert.deepEqual(pairOfLink("$USDT", BONK), { subject: BONK, side: "buy", counter: USDT_MINT });
  assert.equal(pairOfLink("SOL", "SOL"), null);
  assert.equal(pairOfLink("nonsense", null), null);
  assert.equal(pairOfLink("JUP", "USDC"), null, "a coin named that is not one: no pair the link did not name");
  assert.equal(pairOfLink(null, null), null);
  assert.equal(mintOfParam("<script>"), null);
});

test("the picker opens on the wallet's coins and «Main» — no coin the person did not ask for (M15)", () => {
  const main = MAIN_MINTS.slice(0, 4).map((mint, i) => coin(mint, `M${i}`));
  const spam = coin("Spam1111111111111111111111111111111111111111", "FARTBOY");
  const held = [coin(BONK, "BONK"), spam, coin(MAIN_MINTS[1], "USDC")];
  const worth = (asset) => (asset.mint === BONK ? 40 : asset.mint === MAIN_MINTS[1] ? 900 : null);
  const pay = pickStart({ field: "pay", held, main, worth, most: 12 });
  assert.deepEqual(pay.mine.map((a) => a.symbol), ["USDC", "BONK"], "worth first");
  assert.deepEqual(pay.main.map((a) => a.mint), [MAIN_MINTS[0], MAIN_MINTS[2], MAIN_MINTS[3]], "each coin once");
  assert.deepEqual(pay.rest.map((a) => a.symbol), ["FARTBOY"], "a coin nobody prices stands after «Main», never above it");
  const get = pickStart({ field: "get", held, main, worth, most: 12 });
  assert.deepEqual(get.main.map((a) => a.mint), MAIN_MINTS.slice(0, 4), "what is got: «Main» first, whole");
  assert.deepEqual(get.mine.map((a) => a.symbol), ["BONK"]);
  assert.deepEqual(get.rest.map((a) => a.symbol), ["FARTBOY"]);
  const capped = pickStart({ field: "pay", held, main, worth, most: 1 });
  assert.deepEqual(capped.mine.map((a) => a.symbol), ["USDC"], "no more of the wallet's coins than the cap above «Main»");
  assert.deepEqual(capped.rest.map((a) => a.symbol), ["BONK", "FARTBOY"]);
});

test("a coin's decimals: SOL, USDC and USDT by heart, any other read once from the chain", async () => {
  assert.equal(knownDecimals(SOL.mint), 9);
  assert.equal(knownDecimals(USDC.mint), 6);
  assert.equal(knownDecimals(USDT_MINT), 6);
  const mint = "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R";
  const calls = [];
  const reader = async (url, init) => (calls.push([url, init.body]), { ok: true, json: async () => ({ mint, decimals: 6 }) });
  const [a, b] = await Promise.all([askDecimals(mint, reader), askDecimals(mint, reader)]);
  assert.equal(a, 6);
  assert.equal(b, 6);
  assert.equal(calls.length, 1, "one read for two asks at once");
  assert.equal(await askDecimals(mint, reader), 6);
  assert.equal(calls.length, 1, "known after that");
  const other = "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL";
  assert.equal(await askDecimals(other, async () => ({ ok: false, json: async () => ({}) })), null, "no answer is no decimals");
  assert.equal(await askDecimals(other, async () => ({ ok: true, json: async () => ({ mint: "someone-else", decimals: 3 }) })), null, "another mint's answer is not this one's");
  learnDecimals(other, 99);
  assert.equal(knownDecimals(other), null, "nothing outside 0–18 is kept");
});

test("the bridge's «Another address» asks for the address, never «pricing» forever (M13)", () => {
  const base = {
    chainsReady: true,
    origin: { wallet: "evm", deposit: false, send: true },
    destination: { wallet: "solana", owner: "solana" },
    amountRaw: "10000000000000000",
    heldRaw: null,
    originAddress: null,
    recipient: null,
    recipientTyped: true,
  };
  assert.equal(pressOf({ ...base, quote: { status: "idle" } }), "address");
  assert.equal(pressOf({ ...base, quote: { status: "loading", key: "k" } }), "address");
  assert.equal(pressOf({ ...base, quote: { status: "failed", key: "k", code: "QUOTE_NO_ROUTE" } }), "noRoute", "a refusal still says itself");
});
