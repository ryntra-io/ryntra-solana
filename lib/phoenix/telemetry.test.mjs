// Run from repo root: node --test lib/phoenix/telemetry.test.mjs
//
// PERP-4 — Perps' telemetry (spec §18): the spec's moments through the site's one channel, with a market's public
// symbol and one word — never a wallet, an amount, a price, a signature or an order id.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PERPS_EVENT_NAMES, isPerpsEvent, perpsEvent, perpsTrackRow } from "./telemetry.ts";

test("the spec's moments, and only those Perps can say truly", () => {
  for (const name of ["market_stream_stale", "order_review_opened", "review_invalidated", "transaction_signed", "tx_confirmed", "order_partial_fill", "order_filled", "order_cancelled", "risk_warning_shown"]) assert.ok(isPerpsEvent(name), name);
  /* The wallet's connection is the shell's; an emergency stop does not exist yet: neither is claimed. */
  assert.equal(isPerpsEvent("wallet_connection_failure"), false);
  assert.equal(isPerpsEvent("emergency_stop_triggered"), false);
  assert.equal(PERPS_EVENT_NAMES.length, 9);
});

test("an event carries a symbol and one word of a fixed set, nothing about the person", () => {
  assert.deepEqual(perpsEvent("order_filled", "SOL", "open", "uk"), { name: "order_filled", placement: "perps", locale: "uk", path: "/app/perps", ref: "SOL:open" });
  assert.equal(perpsEvent("market_stream_stale", "../x", "markets", "en").ref, ":markets", "a symbol that is not one is dropped");
  assert.equal(perpsEvent("market_stream_stale", null, null, "en").ref, null);
});

test("the stored row is held to its shape whatever the request carried", () => {
  assert.deepEqual(perpsTrackRow({ name: "tx_confirmed", ref: "BTC:reduce", locale: "en", path: "/x?wallet=96GL", placement: "anything" }), { name: "tx_confirmed", placement: "perps", locale: "en", path: "/app/perps", ref: "BTC:reduce" });
  /* A wallet, an amount or a free text in the ref is never stored. */
  for (const ref of ["7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", "SOL:open:5 USDC", "SOL 100"]) assert.equal(perpsTrackRow({ name: "order_filled", ref }).ref, null, ref);
  assert.equal(perpsTrackRow({ name: "order_filled", ref: "SOL:wallet" }).ref, "SOL:", "a word outside the set is dropped; the market stays");
  assert.equal(perpsTrackRow({ name: "order_filled", locale: "de" }).locale, null);
  assert.equal(perpsTrackRow({ name: "telegram_cta_click" }), null);
});

test("the track route takes Perps' moments through their own row, and the page sends nothing but `perpsEvent`", () => {
  const route = readFileSync(new URL("../../app/api/track/route.ts", import.meta.url), "utf8");
  assert.match(route, /PERPS_EVENT_NAMES/);
  assert.match(route, /perpsTrackRow\(/);
  const client = readFileSync(new URL("../../app/solana/workspace/futures/perps-telemetry.ts", import.meta.url), "utf8");
  assert.match(client, /sendEvent\(perpsEvent\(/);
  for (const file of ["futures-workspace.tsx", "order-panel.tsx", "perp-ticket-form.tsx"]) {
    const source = readFileSync(new URL(`../../app/solana/workspace/futures/${file}`, import.meta.url), "utf8");
    /* Every call names a market and a kind word — never the wallet, the owner or a signature. */
    for (const call of source.matchAll(/(?:trackPerps|useTrackOnce)\(([^;]*?)\);/g)) assert.doesNotMatch(call[1], /owner|wallet|signature|address|usd|Usd|size|price/, `${file}: ${call[0]}`);
  }
});
