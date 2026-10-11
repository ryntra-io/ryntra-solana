// Run from repo root: node --test lib/core/solana-swap/refusal.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { sentenceForLog, swapOrderLogLine } from "./refusal.ts";

/* The log of a refused swap order since 2026-10-11: the code, the status, the venue's error code and its own sentence —
   never the taker's or a mint's address, never a sum. On 2026-10-03 and 10-04 the log said `ORDER_REFUSED (HTTP 502)`
   and nothing of why. */

const TAKER = "BxoQfrYTkfgFbNpgXGSoGSWvvcJCZqcxpierDrt1h7gZ";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

test("the venue's sentence is written with its code and status", () => {
  const line = swapOrderLogLine("refused", {
    code: "ORDER_REFUSED",
    status: 502,
    message: "Jupiter refused the order with HTTP 400: Failed to get quotes",
    extra: { provider: { errorCode: "COULD_NOT_FIND_ANY_ROUTE", router: null } },
  });
  assert.equal(line, "swap-order refused: ORDER_REFUSED (HTTP 502) [COULD_NOT_FIND_ANY_ROUTE] — Jupiter refused the order with HTTP 400: Failed to get quotes");
});

test("an address and a sum in the venue's words never reach the log; the venue's own HTTP status does", () => {
  const said = sentenceForLog(`Jupiter refused the order with HTTP 400: taker ${TAKER} lacks 12.5 of ${USDC} (amount 12500000, 0xAbCdEf0123456789)`);
  assert.doesNotMatch(said, new RegExp(TAKER));
  assert.doesNotMatch(said, new RegExp(USDC));
  assert.doesNotMatch(said, /12\.5|12500000|0xAbCdEf/);
  assert.match(said, /HTTP 400/);
  assert.equal(said, "Jupiter refused the order with HTTP 400: taker ‹address› lacks ‹n› of ‹address› (amount ‹n›, ‹address›)");
});

test("a first refusal asked again is written without the route's status; an error code that is not a plain token is left out", () => {
  const line = swapOrderLogLine("asked again", { code: "ORDER_HTTP_ERROR", status: null, message: "Jupiter refused the order with HTTP 503.", extra: { provider: { errorCode: "a b\nc" } } });
  assert.equal(line, "swap-order asked again: ORDER_HTTP_ERROR — Jupiter refused the order with HTTP 503.");
  assert.equal(sentenceForLog("one\n\n  line ".repeat(80)).length <= 300, true);
});

test("the order route writes its refusals through the line, and the venue's step asks once more after a 4xx or 5xx before anything is reserved", () => {
  const route = readFileSync(new URL("../../../app/api/solana/swap/order/route.ts", import.meta.url), "utf8");
  assert.match(route, /if \(status >= 500\) console\.error\(swapOrderLogLine\("refused", \{ code, status, message, extra \}\)\);/);
  assert.doesNotMatch(route, /input\.taker\}|amountRaw\}/, "no taker or amount is interpolated into a log line");
  const prepare = readFileSync(new URL("./prepare.ts", import.meta.url), "utf8");
  const step = prepare.slice(prepare.indexOf('name: "venue-order"'), prepare.indexOf("/* ----------------------------------------------------------------- guard: the plan */"));
  assert.match(step, /const answer = await askVenueOrder\(venue, intent\);/);
  const steps = prepare.slice(prepare.indexOf("  steps: ["));
  assert.ok(steps.indexOf("venueOrder,") < steps.indexOf("ownerLockReserve,"), "the second ask comes before the owner's lock is reserved");
});

test("the venue's step asks a refused order once more and answers with the second ask; a missing route is answered at once", async () => {
  const { askVenueOrder } = await import("./venue-order.ts");
  const { JupiterOrderRefusal } = await import("../venues/jupiter.ts");
  const refusal = (code, reason) => new JupiterOrderRefusal({ ok: false, code, errorCode: null, status: 400, reason, access: "production", router: null });
  const quote = { venue: "jupiter", requestId: "second" };
  const intent = { network: "solana", inputAsset: USDC, outputAsset: "So11111111111111111111111111111111111111112", amountRaw: "5000000", account: { kind: "WALLET", network: "solana", address: TAKER } };
  const warned = [];
  const warn = console.warn;
  console.warn = (line) => warned.push(line);
  try {
    let asks = 0;
    const flaky = { quote: async () => { asks += 1; if (asks === 1) throw refusal("REFUSED", `Jupiter refused the order with HTTP 400: taker ${TAKER} 12.5 short`); return quote; } };
    const sleeps = [];
    const answer = await askVenueOrder(flaky, intent, { sleep: async (ms) => { sleeps.push(ms); } });
    assert.equal(asks, 2);
    assert.deepEqual(sleeps, [1_000]);
    assert.deepEqual(answer, { ok: true, quote });
    assert.deepEqual(warned, ["swap-order asked again: ORDER_REFUSED — Jupiter refused the order with HTTP 400: taker ‹address› ‹n› short"]);

    let noRouteAsks = 0;
    const noRoute = { quote: async () => { noRouteAsks += 1; throw refusal("NO_ROUTE", "Jupiter found no route for this pair at this amount."); } };
    const refused = await askVenueOrder(noRoute, intent, { sleep: async () => { throw new Error("no pause expected"); } });
    assert.equal(noRouteAsks, 1);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, "NO_ROUTE");

    /* A first answer that took longer than ten seconds is not asked again — the route's sixty are kept. */
    let slowAsks = 0;
    let clock = 0;
    const slow = { quote: async () => { slowAsks += 1; clock += 16_000; throw refusal("HTTP_ERROR", "Jupiter refused the order with HTTP 503."); } };
    const late = await askVenueOrder(slow, intent, { sleep: async () => {}, now: () => clock });
    assert.equal(slowAsks, 1);
    assert.equal(late.code, "HTTP_ERROR");

    /* Anything but the venue's refusal is thrown, never answered. */
    await assert.rejects(askVenueOrder({ quote: async () => { throw new Error("boom"); } }, intent), /boom/);
  } finally {
    console.warn = warn;
  }
});

test("the log masks fractions, exponents, digits glued to words and shortened addresses", () => {
  assert.equal(sentenceForLog("need .5 more, 1.25e9 units, inAmount12500000, wallet BxoQfr…h7gZ, code 0x1771"), "need ‹n› more, ‹n› units, inAmount‹n›, wallet ‹address›, code ‹n›");
  assert.equal(sentenceForLog("Jupiter refused the order with HTTP 503."), "Jupiter refused the order with HTTP 503.");
  assert.equal(sentenceForLog("request 0f8c2a4e-91b7-4d3a-a1c2-7e5f9b0d3c11 hash abcdef0123456789abcdef"), "request ‹id› hash ‹id›");
});
