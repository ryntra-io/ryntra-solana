/**
 * SOL-C10 — Launch: the showing of the numbers (UX audit 21.10). The review names every cost as a number and their sum
 * (UX-400); the share typed in «Розширений» says the share the review says (UX-401); the review does not open the
 * wallet without the funds (UX-402); the receipt says «not read», not «None», when the chain was not read (UX-404); a
 * preset's card is one line of what it is for, the difference in «All numbers» (UX-406); a launch's page and Spot of
 * the same token name each other, Spot with the launch's own price (UX-403). Only the showing: shares, fees and
 * signatures are what they were.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import BN from "bn.js";
import { getExcludedFeeAmount, bpsToFeeNumerator } from "@meteora-ag/dynamic-bonding-curve-sdk";

import { ADVANCED_CONFIG_ESTIMATE_SOL, COST_ESTIMATE_SOL, SOL_MARGIN_LAMPORTS, ceilToDigits, firstBuyFeeRaw, fundsOf, maxFirstBuyRaw, networkEstimateSol, reviewLamports, shortfallOf, solToLamports } from "./new/launch-costs.ts";
import { presetTerms, termsOf } from "../../../lib/core/launch/preset-terms.ts";
import { LAUNCH_PRESETS, PEOPLE_PRESET_IDS } from "../../../lib/core/venues/meteora-dbc/presets.ts";
import { LAUNCH_WORDS } from "./launch-words.ts";

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const FLOW = read("app/app/launch/new/launch-flow.tsx");
const FORMATS = read("app/app/launch/new/formats-section.tsx");
const PAGE = read("app/app/launch/[mint]/page.tsx");
const TRADE = read("app/app/launch/[mint]/trade-panel.tsx");
const SPOT_PAGE = read("app/solana/workspace/spot/page.tsx");
const SPOT_HEADER = read("app/solana/workspace/spot/market-header.tsx");
const SPOT_LINE = read("app/solana/workspace/spot/launch-line.tsx");

test("UX-400: the first buy's fee is Meteora's own count of the curve's end fee", () => {
  for (const id of PEOPLE_PRESET_IDS) {
    const bps = presetTerms(id).curve.baseFeeBps;
    for (const amount of [1n, 999n, 10_000_000n, 123_456_789n, 98_500_000_000n]) {
      const [, fee] = getExcludedFeeAmount(bpsToFeeNumerator(bps), new BN(amount.toString()));
      assert.equal(firstBuyFeeRaw(amount, bps), BigInt(fee.toString()), `${id}: ${amount}`);
    }
  }
  assert.equal(firstBuyFeeRaw(10_000_000n, 100), 100_000n, "10 USDC at 1 % is 0.10 USDC");
  assert.equal(firstBuyFeeRaw(0n, 100), 0n);
});

test("UX-400: every cost is a row with a number and the sum names both currencies", () => {
  assert.equal(solToLamports(COST_ESTIMATE_SOL.plain), 10_000_000n);
  assert.equal(solToLamports("1.5"), 1_500_000_000n);
  assert.equal(networkEstimateSol({ sharing: true, locked: true }), COST_ESTIMATE_SOL.sharedLocked);
  assert.equal(networkEstimateSol({ sharing: false, locked: false }), COST_ESTIMATE_SOL.plain);
  assert.match(FLOW, /word\("reviewBuyFeeValue", \{ fee: feeText/, "the fee row says the fee as a number");
  assert.match(FLOW, /word\("reviewConfigRent"\)/, "«Розширений»'s config rent is a row of its own");
  assert.match(FLOW, /costsTotal=\{costsTotal\}/, "the sum is not the rent alone");
  assert.doesNotMatch(FLOW, /reviewBuyFeeIn/, "no «inside the first buy» without a number");
  assert.match(LAUNCH_WORDS.reviewTotalWithFee.en, /\{sol\} SOL \+ \{fee\}/);
});

test("UX-400: the launch's cost and the config's are two figures; neither stands in for the other", () => {
  /* Before any build: both estimates. */
  assert.deepEqual(reviewLamports({ estimateSol: "0.010", launchLamports: null, configPending: true, configLamports: null }), { network: 10_000_000n, config: solToLamports(ADVANCED_CONFIG_ESTIMATE_SOL), total: 10_000_000n + solToLamports(ADVANCED_CONFIG_ESTIMATE_SOL), exact: false });
  /* The config's build answered, its signature declined: the config's figure, the launch still its estimate — never counted twice. */
  assert.deepEqual(reviewLamports({ estimateSol: "0.010", launchLamports: null, configPending: true, configLamports: "8189960" }), { network: 10_000_000n, config: 8_189_960n, total: 18_189_960n, exact: false });
  /* The config made for this choice: the launch alone. */
  assert.deepEqual(reviewLamports({ estimateSol: "0.010", launchLamports: "10340000", configPending: false, configLamports: null }), { network: 10_340_000n, config: 0n, total: 10_340_000n, exact: true });
  /* A made config for other numbers is made again: the form asks for it as pending. */
  assert.match(FLOW, /const configPending = preset\.id === "advanced" && !earlyOn && !\(madeConfig && madeConfig\.key === choiceKey\)/);
  /* The launch's figure holds only for the inputs it was built from. */
  assert.match(FLOW, /useEffect\(\(\) => \{\n    setCovered\(null\);\n  \}, \[coveredFor\]\)/);
  assert.doesNotMatch(FLOW, /setCovered\(data\.creatorCostLamports\);\n            const answer = await signTransactions\(\{ wallet: connection\.wallet, address: connection\.address, unsignedWireBase64: \[data\.unsignedWireBase64\]/, "the config's cost is not the launch's");
});

test("UX-402: a shortfall and a cost are rounded up, never down", () => {
  assert.equal(ceilToDigits(12_000_000n, 9, 3), 12_000_000n, "0.012 SOL stays 0.012");
  assert.equal(ceilToDigits(12_000_001n, 9, 3), 13_000_000n);
  assert.equal(ceilToDigits(10_496_000n, 6, 2), 10_500_000n, "10.496 USDC reads 10.50");
  assert.equal(ceilToDigits(12_300n, 6, 2), 20_000n);
  assert.equal(ceilToDigits(0n, 6, 2), 0n);
  assert.match(FLOW, /fromRaw\(ceilToDigits\(raw, decimals, places\), decimals, places\)/);
  assert.match(FLOW, /pairAmount\(short\.solLamports, 9, locale, 3\)/);
  assert.match(FLOW, /href="\/app\/top-up" target="_blank" rel="noopener"/, "«Top up» keeps the draft");
  assert.match(FLOW, /document\.addEventListener\("visibilitychange", again\)/, "the balance is read again on return");
});

test("UX-401: the share under the field is the share the review says", () => {
  for (const pct of [0, 10, 25, 40]) {
    const typed = termsOf({ ...LAUNCH_PRESETS.advanced, creatorTradingFeePct: pct }).curve.split;
    assert.equal(typed.creatorBps, pct * 80, `${pct} % after Meteora's 20 % is ${pct * 0.8} % of every fee`);
    assert.equal(typed.creatorBps + typed.ryntraBps + typed.meteoraBps, 10_000);
  }
  assert.equal(termsOf({ ...LAUNCH_PRESETS.advanced, creatorTradingFeePct: 40 }).curve.split.creatorBps, 3_200, "40 in the field is 32 % in the review");
  assert.match(FORMATS, /termsOf\(\{ \.\.\.LAUNCH_PRESETS\.advanced, creatorTradingFeePct \}\)\.curve\.split/, "the field reads the review's one source");
  assert.match(FORMATS, /word\("advancedShareOfEvery"/);
  assert.match(LAUNCH_WORDS.advancedCreatorShare.uk, /після 20 % Meteora/);
});

test("UX-402: without the funds the review does not open the wallet; unread is never zero", () => {
  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const empty = fundsOf({ status: "ready", complete: true, data: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "0" }] }, USDC);
  assert.deepEqual(empty, { sol: { read: true, raw: 0n }, pair: { read: true, raw: 0n } });
  const short = shortfallOf(empty, { solLamports: 10_000_000n, pairRaw: 10_000_000n });
  assert.deepEqual(short, { solLamports: 10_000_000n + SOL_MARGIN_LAMPORTS, pairRaw: 10_000_000n });
  const enough = fundsOf({ status: "ready", complete: true, data: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "50000000" }, { kind: "TOKEN", mint: USDC, amountRaw: "20000000" }] }, USDC);
  assert.equal(shortfallOf(enough, { solLamports: 10_000_000n, pairRaw: 10_000_000n }), null);
  /* A read still running, failed or partial without the row: «—», and nothing blocks. */
  for (const read of [null, { status: "loading", complete: false, data: [] }, { status: "error", complete: false, data: [] }]) {
    assert.equal(shortfallOf(fundsOf(read, USDC), { solLamports: 10_000_000n, pairRaw: 10_000_000n }), null);
  }
  const partial = fundsOf({ status: "ready", complete: false, data: [{ kind: "NATIVE_SOL", mint: null, amountRaw: "50000000" }] }, USDC);
  assert.deepEqual(partial.pair, { read: false });
  assert.equal(maxFirstBuyRaw(98_000_000n, { read: true, raw: 5_000_000n }), 5_000_000n, "«Max» is no more than the wallet holds");
  assert.equal(maxFirstBuyRaw(98_000_000n, { read: false }), 98_000_000n);
  assert.match(FLOW, /ready=\{[^}]*!short\}/, "the review is not ready while the wallet lacks the funds");
  assert.match(FLOW, /href="\/app\/top-up"/, "the shortfall offers «Top up»");
  assert.match(FLOW, /word\("readAgain"\)/, "and a read again");
  assert.match(FLOW, /word\("reviewWallet"\)/, "the review says what the wallet holds");
  assert.match(FLOW, /word\("buyBalance"/, "the first buy's field says the balance");
});

test("UX-404: «None» only from a receipt read", () => {
  assert.match(PAGE, /: receipt\s*\?\s*word\("receiptNone"\)\s*:\s*word\("receiptUnread"\)/, "the first buy");
  assert.match(PAGE, /receipt && !token\.receiptProblems\.includes\(RECEIPT_LOCK_UNREAD\) \? word\("receiptNone"\) : word\("receiptUnread"\)/, "the lock");
  assert.equal(LAUNCH_WORDS.receiptUnread.uk, "зараз не прочитано");
});

test("UX-406: a card is its name and one line; the difference is in «All numbers»", () => {
  const card = FLOW.slice(FLOW.indexOf("function PresetCard("), FLOW.indexOf("function presetPurpose("));
  assert.equal((card.match(/word\(/g) ?? []).length, 2, "the card says «Default» or «Ryntra test» at most, and its one line");
  assert.match(card, /presetPurpose\(preset, locale\)/);
  for (const id of ["classic", "protected", "community", "micro"]) assert.ok(LAUNCH_WORDS[`presetFor_${id}`], id);
  assert.match(FLOW, /<PresetsCompare presets=\{presets\.presets\}/, "every preset side by side");
  assert.match(FLOW, /<PresetsCommon /, "what every preset shares, once");
  assert.match(LAUNCH_WORDS.presetFor_micro.en, /\{period\}.*\{creator\} to you/, "Micro's lock and 0 % stay on its card");
  assert.equal(LAUNCH_WORDS.presetsCompare.uk, "Усі числа");
});

test("UX-403: a launch's page and Spot name each other; Spot says the launch's own price", () => {
  assert.match(TRADE, /href=\{`\/app\/spot\?mint=\$\{market\.token\}`\}/);
  assert.match(SPOT_PAGE, /launchRecordedHere\(getGuardRuntime\(\)\.store, network\.cluster, mint\)/, "one read of Ryntra's record, never the chain");
  assert.match(SPOT_PAGE, /from "@\/lib\/launch\/recorded\.server"/, "a light module, not Launch's builders");
  assert.match(SPOT_PAGE, /Promise\.race\(\[read, new Promise<boolean>/, "Spot never waits on the store");
  assert.doesNotMatch(read("lib/launch/recorded.server.ts"), /flow\.server/);
  assert.match(SPOT_HEADER, /<LaunchHeaderLine mint=\{selectedMint\} \/>/);
  assert.match(SPOT_LINE, /\/api\/v1\/launch\/\$\{mint\}\/market/, "the same read the launch page shows");
  assert.match(SPOT_LINE, /href=\{`\/app\/launch\/\$\{mint\}`\}/);
});

test("the money is what it was: the same build, the same quote, the same signature", () => {
  assert.match(FLOW, /api<LaunchBuildResponse>\("\/api\/v1\/launch\/build"/);
  assert.match(FLOW, /api<LaunchQuoteResponse>\("\/api\/v1\/launch\/quote"/);
  assert.match(FLOW, /firstBuyRaw: \(buyRaw \?\? 0n\)\.toString\(\)/);
  assert.match(FLOW, /signTransactions\(\{ wallet: connection\.wallet, address: connection\.address, unsignedWireBase64: wires, chain: data\.network \}\)/);
});
