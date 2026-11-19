import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { costOf, dollarsOf, etaOf, followEvery, fromRaw, landingOf, originOf, pressOf, readTransfers, refusedInWallet, settled, stateOfProgress, stateOfStatus, toRaw, txLink, withTransfer, TRANSFERS_KEPT } from "./bridge-form.ts";

/* The Bridge form's reasoning, apart from React. */

const facts = (over = {}) => ({
  requestId: "0x" + "1".repeat(64),
  mode: "wallet",
  send: { amountRaw: "10000000000000000", symbol: "ETH", decimals: 18, usd: 30.1 },
  get: { expectedRaw: "240599370", minimumRaw: "239400000", symbol: "SOL", decimals: 9, usd: 29.9 },
  etaSeconds: 4,
  fees: { relayUsd: 0.03, gasUsd: 0.01, ryntraUsd: 0.07 },
  impactPercent: -0.6,
  depositAddress: null,
  prompts: 1,
  ...over,
});

test("a typed amount in a coin's raw units, and back", () => {
  assert.equal(toRaw("0.01", 18), "10000000000000000");
  assert.equal(toRaw("25", 6), "25000000");
  assert.equal(toRaw(".5", 9), "500000000");
  assert.equal(toRaw("0", 6), null);
  assert.equal(toRaw("", 6), null);
  assert.equal(toRaw("1.1234567", 6), null, "more places than the coin holds");
  assert.equal(toRaw("1e5", 6), null);
  assert.equal(fromRaw("10000000000000000", 18), "0.01");
  assert.equal(fromRaw("25000000", 6), "25");
  assert.equal(fromRaw("1", 8), "0.00000001");
});

test("the wait and the cost, as the one line says them", () => {
  const w = { seconds: (n) => `~${n} s`, minutes: (n) => `~${n} min` };
  assert.equal(etaOf(0, w), "~1 s");
  assert.equal(etaOf(4, w), "~4 s");
  assert.equal(etaOf(600, w), "~10 min");
  assert.equal(etaOf(null, w), null);
  assert.equal(dollarsOf(0.004), "<$0.01");
  assert.equal(dollarsOf(1.234), "$1.23");
  assert.equal(dollarsOf(null), null);
  assert.ok(Math.abs(costOf(facts()) - 0.11) < 1e-9, "Relay's fee, the gas and Ryntra's fee together");
  assert.equal(costOf(facts({ fees: { relayUsd: null, gasUsd: null, ryntraUsd: null } })), null);
});

test("the one press climbs the steps: amount, wallet, where it lands, a price, then the move", () => {
  const evm = { wallet: "evm", deposit: true, send: true };
  const solana = { wallet: "solana", owner: "solana" };
  const ready = { status: "ready", key: "k", facts: facts(), preview: false, quote: {} };
  const base = { chainsReady: true, origin: evm, destination: solana, amountRaw: "10000000000000000", heldRaw: null, originAddress: "0xabc", recipient: "So1", recipientTyped: false, quote: ready };
  assert.equal(pressOf({ ...base, chainsReady: false }), "chains");
  assert.equal(pressOf({ ...base, amountRaw: null }), "enter");
  assert.equal(pressOf({ ...base, heldRaw: "1" }), "notEnough");
  assert.equal(pressOf({ ...base, quote: { status: "loading", key: "k" } }), "pricing");
  // A price comes first, before any wallet is asked.
  assert.equal(pressOf({ ...base, originAddress: null, quote: { ...ready, preview: true } }), "connectOrigin");
  assert.equal(pressOf({ ...base, recipient: null, quote: { ...ready, preview: true } }), "connectDestination");
  assert.equal(pressOf({ ...base, recipient: null, recipientTyped: true, quote: { ...ready, preview: true } }), "address");
  assert.equal(pressOf({ ...base, quote: { ...ready, preview: true } }), "pricing", "the parties are known: the real quote is on its way");
  assert.equal(pressOf(base), "move");
  // A network no wallet signs on: a deposit address on the press, its price a preview until then.
  assert.equal(pressOf({ ...base, origin: { wallet: null, deposit: true, send: true }, originAddress: null, quote: { ...ready, preview: true } }), "deposit");
  assert.equal(pressOf({ ...base, origin: { wallet: null, deposit: false, send: false } }), "noRoute", "a network money cannot leave from here");
  // A receiving network no wallet signs on asks for an address.
  assert.equal(pressOf({ ...base, destination: { wallet: null, owner: null }, recipient: null, recipientTyped: true }), "address");
  // Relay's refusals, in words a person can act on.
  for (const [code, press] of [["QUOTE_NO_ROUTE", "noRoute"], ["QUOTE_MISMATCH", "noRoute"], ["RECIPIENT_INVALID", "noRoute"], ["UNKNOWN_CHAIN", "noRoute"], ["QUOTE_AMOUNT_TOO_SMALL", "tooSmall"], ["QUOTE_AMOUNT_TOO_LARGE", "tooLarge"], ["RATE_LIMITED", "busy"], ["UNAVAILABLE", "unavailable"]]) {
    assert.equal(pressOf({ ...base, quote: { status: "failed", key: "k", code } }), press, code);
  }
});

test("where a transfer stands, from the SDK's progress", () => {
  assert.equal(stateOfProgress({ steps: [{ items: [{ status: "incomplete" }] }], currentStepItem: { progressState: "confirming" } }), "sign");
  assert.equal(stateOfProgress({ steps: [{ items: [{ status: "incomplete", progressState: "validating" }] }], currentStepItem: { progressState: "validating" }, txHashes: [{ txHash: "0x1", chainId: 8453 }] }), "sent");
  assert.equal(stateOfProgress({ steps: [{ items: [{ status: "incomplete", checkStatus: "pending" }] }] }), "bridging");
  assert.equal(stateOfProgress({ steps: [{ items: [{ status: "complete" }] }, { items: [{ status: "complete", checkStatus: "success" }] }] }), "done");
  assert.equal(stateOfProgress({ steps: [{ items: [{ status: "incomplete", checkStatus: "refund" }] }] }), "refunded");
  assert.equal(stateOfProgress({ refunded: true, steps: [] }), "refunded");
  assert.equal(stateOfProgress({ steps: [{ items: [{ status: "incomplete", checkStatus: "failure" }] }] }), "failed");
});

test("the money left with the deposit, not with an approval before it; it landed on the receiving network", () => {
  const approved = { steps: [{ id: "approve", items: [{ status: "complete", txHashes: [{ txHash: "0xapprove", chainId: 42161 }] }] }, { id: "deposit", items: [{ status: "incomplete", check: {} }] }], txHashes: [{ txHash: "0xapprove", chainId: 42161 }] };
  assert.equal(originOf(approved, 42161), null, "an approval is not the transfer");
  const deposited = { steps: [approved.steps[0], { id: "deposit", items: [{ status: "incomplete", check: {}, txHashes: [{ txHash: "0xdeposit", chainId: 42161 }] }] }] };
  assert.deepEqual(originOf(deposited, 42161), [42161, "0xdeposit"]);
  assert.equal(landingOf(deposited, 792703809), null, "nothing landed before Relay says so");
  const filled = { steps: [approved.steps[0], { id: "deposit", items: [{ status: "complete", check: {}, checkStatus: "success", internalTxHashes: [{ txHash: "0xdeposit", chainId: 42161 }], txHashes: [{ txHash: "5land", chainId: 792703809 }] }] }] };
  assert.deepEqual(originOf(filled, 42161), [42161, "0xdeposit"]);
  assert.deepEqual(landingOf(filled, 792703809), [792703809, "5land"]);
});

test("a transfer is asked about often while fresh, then less, and let go after a day", () => {
  assert.equal(followEvery(60_000), 6_000);
  assert.equal(followEvery(30 * 60_000), 30_000);
  assert.equal(followEvery(5 * 60 * 60_000), 180_000);
  assert.equal(followEvery(25 * 60 * 60_000), null);
  assert.ok(settled("expired") && settled("reverted") && settled("unconfirmed"));
});

test("where a transfer stands, from Relay's status after a reload; an unpaid failure is not a loss", () => {
  assert.equal(stateOfStatus("success", true), "done");
  assert.equal(stateOfStatus("refund", true), "refunded");
  assert.equal(stateOfStatus("pending", true), "bridging");
  assert.equal(stateOfStatus("submitted", true), "bridging");
  assert.equal(stateOfStatus("waiting", false), "waiting");
  assert.equal(stateOfStatus("waiting", true), "sent");
  assert.equal(stateOfStatus("failure", true), "failed");
  assert.equal(stateOfStatus("failure", false), null);
  assert.equal(stateOfStatus(undefined, true), null);
  assert.ok(settled("done") && settled("refunded") && settled("failed") && settled("cancelled"));
  assert.ok(!settled("slow") && !settled("waiting") && !settled("bridging"));
});

test("a wallet's «no» is told apart from a fault", () => {
  assert.equal(refusedInWallet(Object.assign(new Error("User rejected the request."), { code: 4001 })), true);
  assert.equal(refusedInWallet(new Error("Phantom: user denied")), true);
  assert.equal(refusedInWallet("User rejected the request"), true);
  assert.equal(refusedInWallet(new Error("execution reverted")), false);
});

test("the device keeps the newest transfers, and reads back only what is a transfer", () => {
  const one = (n, at) => ({ requestId: "0x" + String(n).padStart(64, "0"), at, state: "bridging", from: { chainId: 8453, symbol: "ETH", amountRaw: "1", decimals: 18 }, to: { chainId: 792703809, symbol: "SOL", amountRaw: "2", decimals: 9 }, originTx: null, destinationTx: null, depositAddress: null });
  let list = [];
  for (let n = 0; n < TRANSFERS_KEPT + 5; n += 1) list = withTransfer(list, one(n, n));
  assert.equal(list.length, TRANSFERS_KEPT);
  assert.equal(list[0].at, TRANSFERS_KEPT + 4, "newest first");
  list = withTransfer(list, { ...one(TRANSFERS_KEPT + 4, TRANSFERS_KEPT + 4), state: "done" });
  assert.equal(list.length, TRANSFERS_KEPT, "a change replaces, never duplicates");
  assert.equal(list[0].state, "done");
  assert.equal(readTransfers([one(1, 1), { requestId: "x" }, null, "junk", { ...one(2, 2), from: { chainId: 1 } }]).length, 1);
  assert.deepEqual(readTransfers("not a list"), []);
});

test("a transaction opens at the network's own explorer, as Relay lists it", () => {
  assert.equal(txLink("https://basescan.org", "0xabc"), "https://basescan.org/tx/0xabc");
  assert.equal(txLink("https://solscan.io/", "5x"), "https://solscan.io/tx/5x");
  assert.equal(txLink(null, "0xabc"), null);
  assert.equal(txLink("javascript:alert(1)", "0xabc"), null);
});

/* What the page is made of (decision 105, LAYOUT 18.11). */
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the Bridge page: one form in the action panel, «My transfers» beside it, one amber press", () => {
  const screen = read("./BridgeScreen.tsx");
  assert.match(screen, /<BridgeForm \/>/);
  assert.match(screen, /<BridgeTransfers \/>/);
  assert.match(screen, /tone="hi"/, "the one panel a screen acts in");
  const form = read("./BridgeForm.tsx");
  assert.equal((form.match(/<Action\b/g) ?? []).length, 1, "one amber press on the form");
  assert.doesNotMatch(form, /BridgePanel|useMoneyStore|deposit-address/, "the old USDC-only bridge is not drawn here");
});

test("the browser talks only to this site: Relay, logos and networks go through its own routes", () => {
  for (const file of ["./BridgeForm.tsx", "./BridgePick.tsx", "./BridgeTrip.tsx", "./BridgeTransfers.tsx", "./bridge-store.ts", "./bridge-run.ts", "./bridge-evm.ts", "./bridge-form.ts"]) {
    const source = read(file);
    assert.doesNotMatch(source, /fetch\(\s*['"`]https?:/, `${file} fetches no outside host`);
    assert.doesNotMatch(source, /assets\.relay\.link|api\.relay\.link|coingecko/, `${file} names no outside host`);
  }
  assert.match(read("./bridge-run.ts"), /api\/swap\/bridge\/relay/, "the SDK's calls go through the site's pass");
});
