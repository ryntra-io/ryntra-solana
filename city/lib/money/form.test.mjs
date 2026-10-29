import { test } from "node:test";
import assert from "node:assert/strict";

import { assetsOf } from "./assets.ts";
import { blocksSend, EMPTY_SEND, reviewTotal, sendGate } from "./form.ts";
import { environmentOf } from "./send.ts";
import { bundle, FRIEND, OWNER, USDC } from "./test-fixtures.mjs";

const wallet = {
  owner: OWNER,
  assets: assetsOf([
    { kind: "NATIVE_SOL", mint: null, amountRaw: "2400000000", spendableRaw: "2390000000", decimals: 9, catalog: { usdPrice: "150" } },
    { kind: "TOKEN", mint: USDC, amountRaw: "12500000", spendableRaw: "12500000", decimals: 6, catalog: { symbol: "USDC", isVerified: true, usdPrice: "1" } },
  ]),
  complete: true,
  at: 0,
};

/** A form one step from sending: USDC, a known recipient, an amount. */
const ready = { ...EMPTY_SEND, assetId: USDC, to: FRIEND, amount: "2.5", recents: [FRIEND], recentsRead: true };
const gate = (send, over = {}) => sendGate({ connected: true, owner: OWNER, wallet, walletRead: "ready", send, ...over });

test("no wallet: the one action connects one", () => {
  assert.deepEqual([gate(ready, { connected: false, owner: null }).label, gate(ready, { connected: false, owner: null }).action], ["Connect wallet", "connect"]);
});

test("a complete form asks for the engine's Review; nothing reaches the wallet before it", () => {
  const g = gate(ready);
  assert.deepEqual([g.label, g.action, g.recipient], ["Review transfer", "review", FRIEND]);
});

test("with the engine's Review on screen the action is the wallet; a closed Review cannot be sent", () => {
  const review = { bundle: bundle(), authorized: environmentOf(bundle(), "USDC") };
  assert.deepEqual([gate({ ...ready, review }).label, gate({ ...ready, review }).action], ["Confirm in wallet", "confirm"]);
  const closed = { bundle: bundle({ signable: false }), authorized: review.authorized };
  assert.deepEqual([gate({ ...ready, review: closed }).label, gate({ ...ready, review: closed }).action], ["Cannot be sent", null]);
});

test("each rung of the form holds the action and says what is missing", () => {
  assert.equal(gate({ ...ready, to: "" }).label, "Enter who gets it");
  assert.equal(gate({ ...ready, to: "not-an-address" }).toLine.tone, "error");
  assert.equal(gate({ ...ready, to: "0x1111111111111111111111111111111111111111" }).label, "Use Bridge");
  assert.equal(gate({ ...ready, to: OWNER }).toLine.text, "That is your own wallet.");
  assert.equal(gate({ ...ready, amount: "" }).label, "Enter an amount");
  const over = gate({ ...ready, amount: "13" });
  assert.deepEqual([over.label, over.action, over.amountLine], ["Not enough USDC", null, "More than you can send: 12.5 USDC."]);
  assert.equal(gate({ ...ready, assetId: "gone" }).label, "Choose a coin");
  assert.equal(gate(ready, { wallet: null, walletRead: "reading" }).label, "Reading your balances…");
  assert.equal(gate(ready, { wallet: null, walletRead: "failed" }).label, "Balances unavailable");
});

test("a .skr name is an address only once the engine found it", () => {
  const typed = { ...ready, to: "alice.skr" };
  assert.deepEqual([gate({ ...typed, name: { state: "RESOLVING", name: "alice.skr" } }).label, gate({ ...typed, name: null }).action], ["Finding the name…", null]);
  assert.equal(gate({ ...typed, name: { state: "NOT_FOUND", name: "alice.skr" } }).toLine.text, "No such name: alice.skr.");
  const found = gate({ ...typed, name: { state: "FOUND", name: "alice.skr", address: FRIEND } });
  assert.deepEqual([found.recipient, found.action], [FRIEND, "review"]);
  // An answer about another name answers nothing.
  assert.equal(gate({ ...typed, name: { state: "FOUND", name: "bob.skr", address: FRIEND } }).recipient, null);
});

test("the engine's recipient check holds a recipient it refuses", () => {
  const check = (result, status = "done") => ({ key: "k", status, result });
  assert.equal(gate({ ...ready, check: check(null, "checking") }).label, "Checking the recipient…");
  const refused = gate({ ...ready, check: check({ next: "none", problem: "RECIPIENT_FROZEN", address: FRIEND, opensAccount: false, askedAmount: null, linkUrl: null }) });
  assert.deepEqual([refused.action, refused.toLine.text], [null, "That account is frozen and cannot receive."]);
  const opens = gate({ ...ready, check: check({ next: "transfer", problem: null, address: FRIEND, opensAccount: true, askedAmount: null, linkUrl: null }) });
  assert.equal(opens.action, "review");
  // Its cost is on the Review's one line; «To» carries no explanation of it.
  assert.equal(opens.toLine, null);
  // An unreadable check is not a refusal: the engine's own build checks the recipient again.
  assert.equal(gate({ ...ready, check: check(null, "unread") }).action, "review");
});

test("a request is paid only at the address the engine read from it", () => {
  const request = { ...ready, to: `solana:${FRIEND}?amount=2.5` };
  assert.equal(gate(request).label, "Reading the request…");
  const read = { key: "k", status: "done", result: { next: "transfer", problem: null, address: FRIEND, opensAccount: false, askedAmount: "2.5", linkUrl: null } };
  assert.deepEqual([gate({ ...request, check: read }).recipient, gate({ ...request, check: read }).action], [FRIEND, "review"]);
  const link = { key: "k", status: "done", result: { next: "pay-link", problem: null, address: null, opensAccount: false, askedAmount: null, linkUrl: "https://ryntra.io/pay/x" } };
  assert.equal(gate({ ...request, check: link }).action, null);
});

test("a new address and a look-alike each hold the action until the person checks them (SEC-2)", () => {
  const fresh = { ...ready, recents: [] };
  assert.deepEqual([gate(fresh).label, gate(fresh).action, gate(fresh).isNew], ["Check the new address", "accept-fresh", true]);
  assert.equal(gate({ ...fresh, accepted: { lookalike: null, fresh: FRIEND } }).action, "review");
  // Accepted for another address is not accepted for this one.
  assert.equal(gate({ ...fresh, accepted: { lookalike: null, fresh: OWNER } }).action, "accept-fresh");
  const known = `${FRIEND.slice(0, 4)}${"Q".repeat(FRIEND.length - 8)}${FRIEND.slice(-4)}`;
  const planted = { ...ready, recents: [known] };
  assert.deepEqual([gate(planted).action, gate(planted).lookalike], ["accept-lookalike", known]);
});

test("the security source's word on the recipient is read before signing, and never holds the action", () => {
  const flagged = gate({ ...ready, risk: { address: FRIEND, summary: "sanctioned" } });
  assert.deepEqual([flagged.riskLine?.tone, flagged.action], ["error", "review"]);
  assert.equal(gate({ ...ready, risk: { address: FRIEND, summary: "evidence-found" } }).riskLine?.tone, "warn");
  // A word about another address says nothing about this one; «nothing found» is no line.
  assert.equal(gate({ ...ready, risk: { address: OWNER, summary: "sanctioned" } }).riskLine, null);
  assert.equal(gate({ ...ready, risk: { address: FRIEND, summary: "nothing-found" } }).riskLine, null);
});

test("while a transfer is mid-way or an earlier one is open, nothing new is offered", () => {
  for (const phase of ["reviewing", "preparing", "wallet", "sending"]) assert.equal(gate({ ...ready, phase }).action, null, phase);
  assert.equal(blocksSend({ resumed: { signature: "s", state: "UNKNOWN" } }), true);
  assert.equal(blocksSend({ resumed: { signature: "s", state: "LANDED" } }), false);
  assert.equal(gate({ ...ready, resumed: { signature: "s", state: "CHECKING" } }).label, "Waiting for an earlier transfer");
});

test("what leaves the wallet, from the engine's Review alone", () => {
  const token = reviewTotal(bundle({ setup: { lamports: "2039280", sol: "0.00203928" } }).check, "USDC");
  assert.deepEqual(token, { coin: "2.5 USDC", sol: "0.00204528 SOL", whole: true });
  const sol = reviewTotal(bundle({ native: true, amountRaw: "100000000" }).check, "SOL");
  assert.deepEqual(sol, { coin: null, sol: "0.100006 SOL", whole: true });
  // An account cost the engine could not read: no total is called whole.
  assert.equal(reviewTotal(bundle({ setup: { lamports: null, sol: null } }).check, "USDC").whole, false);
});
