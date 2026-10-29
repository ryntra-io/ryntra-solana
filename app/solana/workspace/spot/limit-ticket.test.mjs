// Run from repo root: node --test app/solana/workspace/spot/limit-ticket.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SOLANA_UK_TEXT } from "../i18n/catalog.ts";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const ticket = read("./spot-ticket.tsx");
const core = read("./core-ticket.ts");
const orders = read("./my-orders.tsx");
const state = read("./trading-state.tsx");

test("the ticket's order types are the core's Market · Limit, «Регулярно» one press beside them (B16 on SOL-T1)", () => {
  assert.match(ticket, /from "@ryntra\/core\/ui"/);
  assert.match(ticket, /<TradeTicket\b/);
  assert.match(ticket, /limit=\{limitFlag\}/);
  assert.match(ticket, /data-recurring-open/);
  /* A plan or a rule's reminder binds the ticket to its market purchase: no limit under one. */
  assert.match(ticket, /const limitFlag = bound \? \(\{ status: "off" \} as const\) : on;/);
});

test("a limit order goes through the core's Review and ends in the core's receipt, every cost on its own line", () => {
  assert.match(ticket, /reviewLimit\(\{/);
  assert.match(ticket, /signAndPlace\(/);
  assert.match(ticket, /reviewedFromLimit\(\{/);
  /* Ryntra's fee, the venue's and the network's — each its own line of the core's Review. */
  assert.match(core, /fees\.ryntra = amount\(BigInt\(review\.fee\.ryntraFeeRaw\), get\)/);
  assert.match(core, /fees\.venue = amount\(BigInt\(review\.fee\.venueFeeRaw\), get\)/);
  assert.match(core, /fees\.gas = amount\(BigInt\(review\.networkFeeLamports\), SOL_TOKEN\)/);
  /* A placed order rests: the core's result says where it waits. */
  assert.match(ticket, /state: limitPhase\.settled \? "resting" : "sent"/);
});

test("the venue that a pair cannot use is grey with its reason, never hidden", () => {
  assert.match(ticket, /disabled=\{limitBusy \|\| unavailable\}/);
  assert.match(ticket, /text\("No pool of this pair takes limits"\)/);
});

test("«My orders» is the account's panel, a core Table with one action per row", () => {
  /* B16: «Ордери (n)» in the account's tabs — a panel of its own on a desk, «Мої» on a phone. */
  assert.match(state, /\{ id: "orders", label: `\$\{text\("Orders"\)\}/);
  assert.match(state, /<MyOrders /);
  assert.match(orders, /<Table\b/);
  assert.match(orders, /text\("Take back"\)/);
  assert.match(orders, /text\("Cancel"\)/);
});

test("every state word «My orders» can show has its Ukrainian", () => {
  const table = orders.slice(orders.indexOf("const STATE_WORDS"), orders.indexOf("};", orders.indexOf("const STATE_WORDS")));
  const words = [...table.matchAll(/^\s{2}[A-Z_]+: "([^"]+)",$/gm)].map((match) => match[1]);
  assert.ok(words.length >= 8);
  for (const word of words) assert.ok(SOLANA_UK_TEXT[word], `missing «${word}»`);
});

test("the amount is the core's one line from nothing to everything the wallet can spend, the price starts at the market", () => {
  /* The core's ticket carries the share slider, «Max» with room for the fee and the quick sums. */
  assert.match(ticket, /balances=\{balances\}/);
  assert.match(ticket, /quick=\{quick\}/);
  /* The reference the limit price starts from and is measured against. */
  assert.match(ticket, /reference=\{baseInput\?\.reference \?\? null\}/);
  /* A limit at or through the market is a market order: said, never sent as a limit. */
  assert.match(ticket, /text\("This price is already the market: use a market order\."\)/);
});

test("an answer the core cannot call final offers the transaction, and a new start once it is known (critic round 4; SOL-C12, UX-256)", () => {
  /* A limit the chain has not confirmed is «sent» in the core, which then draws no «again»; nor does a settled trade
     the classifier could not name. The ticket's own row keeps the transaction and a read again; «again» stands only
     once the wallet's history or its orders name the signature (`knownOutcome`). */
  assert.match(ticket, /limitPhase\.kind === "PLACED" && !limitPhase\.settled \? limitPhase\.signature : null/);
  assert.match(ticket, /phase === "SETTLED" && result\?\.state === "unknown"/);
  assert.match(ticket, /data-ticket-unsettled/);
  assert.match(ticket, /unsettledKnown \? \(\s*<Button variant="ghost" lang=\{lang\} onClick=\{startOver\}/);
  for (const key of [
    "The chain has not confirmed this order yet. Look for it in «Orders» before you place another.",
    "The outcome is not known. Check the transaction before you trade again.",
    "Check transaction",
    "New limit order",
    "Trade again",
  ]) assert.ok(SOLANA_UK_TEXT[key], key);
});

test("a result names the trade that was signed: its market held from Review, a new market after it a new ticket", () => {
  assert.match(ticket, /setHeldMarket\(\{ market: ticketMarket, scale \}\)/);
  assert.match(ticket, /market=\{stage === "result" && !limit && heldMarket \? heldMarket\.market : ticketMarket\}/);
  assert.match(ticket, /scale: heldMarket\?\.scale \?\? scale/);
  assert.match(ticket, /if \(settledPhase\.current === "SETTLED"\) resetTicket\(\);/);
});
