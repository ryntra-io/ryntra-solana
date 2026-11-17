import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { factsOf, figure, mintOf, positionOf, signedUsd, standIn, tradesOf } from "./coin-view.ts";
import { NO_GUARD, READ_BEFORE_PRESS_MS, actionOf, guardNext, pressHeld, retryShown, ticketFree } from "./ticket-rules.ts";

/* The coin's screen and its ticket, held as they are written. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const SOL = "So11111111111111111111111111111111111111112";
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";

const BASE = { phase: "idle", side: "buy", connected: true, connecting: false, problem: null, hasAmount: true, empty: false, priced: true, exact: false, canTopUp: true };
const PHASES = ["idle", "preparing", "wallet", "sending", "checking", "done", "failed", "unknown"];

test("the ticket's one button is the trade's verb whenever a press can do it, and says the one thing missing when it cannot", () => {
  assert.deepEqual(actionOf(BASE), { label: "verb", does: "press", busy: false }, "a price on screen: the press builds the exact order");
  assert.deepEqual(actionOf({ ...BASE, exact: true }), { label: "verb", does: "press", busy: false }, "the exact order on screen: the press opens the wallet");
  assert.deepEqual(actionOf({ ...BASE, connected: false }), { label: "connect", does: "press", busy: false });
  assert.deepEqual(actionOf({ ...BASE, priced: false }), { label: "verb", does: "none", busy: false }, "no price, nothing to agree to");
  assert.deepEqual(actionOf({ ...BASE, problem: "balance" }), { label: "short", does: "none", busy: false });
  assert.deepEqual(actionOf({ ...BASE, problem: "other" }), { label: "verb", does: "none", busy: false });
  assert.deepEqual(actionOf({ ...BASE, empty: true, hasAmount: false }), { label: "topUp", does: "topUp", busy: false }, "an empty wallet is sent to get funds");
  assert.deepEqual(actionOf({ ...BASE, empty: true, hasAmount: false, canTopUp: false }), { label: "short", does: "none", busy: false });
  assert.deepEqual(actionOf({ ...BASE, side: "sell", empty: true, hasAmount: false }), { label: "nothing", does: "none", busy: false });
  assert.deepEqual(actionOf({ ...BASE, hasAmount: false }), { label: "verb", does: "none", busy: false });
  for (const phase of ["preparing", "wallet", "sending", "checking"]) assert.equal(actionOf({ ...BASE, phase }).busy, true, phase);
  assert.deepEqual(actionOf({ ...BASE, connected: false, connecting: true }), { label: "connecting", does: "none", busy: true });
});

test("«Try again» is never the amber button: a failed price is asked again by a quiet control of its own, which only reads the price", () => {
  const labels = new Set();
  for (const phase of PHASES) for (const connected of [false, true]) for (const priced of [false, true]) for (const exact of [false, true]) for (const problem of [null, "balance", "other"]) for (const empty of [false, true]) {
    labels.add(actionOf({ ...BASE, phase, connected, priced, exact, problem, empty }).label);
  }
  assert.ok(![...labels].some((label) => /retry|again/i.test(label)), [...labels].join(","));
  assert.equal(retryShown({ quoteFailed: true, retryable: true, exact: false, phase: "idle" }), true);
  assert.equal(retryShown({ quoteFailed: true, retryable: false, exact: false, phase: "idle" }), false, "a price that cannot come offers no «Try again»");
  assert.equal(retryShown({ quoteFailed: true, retryable: true, exact: true, phase: "idle" }), false);
  assert.equal(retryShown({ quoteFailed: true, retryable: true, exact: false, phase: "wallet" }), false);
  const ticket = read("./Ticket.tsx");
  // The quiet «Try again» calls the price's read and nothing else; the one amber button's words come from its rule.
  assert.match(ticket, /<Quiet size="s" onClick=\{\(\) => void useTrade\.getState\(\)\.refreshQuote\(\)\}>\s*\{t\.tryAgain\}/);
  assert.equal((ticket.match(/refreshQuote/g) ?? []).length, 1, "the ticket asks for a price in one place only");
  assert.match(ticket, /\{labels\[action\.label\]\}/);
  assert.doesNotMatch(ticket, /onRetry/);
});

test("after a price that failed, the order's figures stand a moment before a press may open the wallet", () => {
  let guard = NO_GUARD;
  guard = guardNext(guard, { quoteFailed: true, exact: false }, 1000);
  assert.equal(pressHeld(guard, 1000), false, "no order yet: the press only builds one");
  guard = guardNext(guard, { quoteFailed: false, exact: false }, 1500);
  guard = guardNext(guard, { quoteFailed: false, exact: true }, 2000);
  assert.equal(pressHeld(guard, 2000 + READ_BEFORE_PRESS_MS - 1), true, "a tap meant for «Try again» lands on nothing");
  assert.equal(pressHeld(guard, 2000 + READ_BEFORE_PRESS_MS), false, "the next tap is the person's own");
  assert.equal(guardNext(guard, { quoteFailed: false, exact: true }, 9000), guard, "the same order keeps its moment");
  assert.equal(pressHeld(NO_GUARD, 0), false, "a price that never failed holds nothing");
  const hook = read("./useTicket.ts");
  assert.match(hook, /if \(pressHeld\(guard\.current, Date\.now\(\)\)\) return 'ok';\s*return useTrade\.getState\(\)\.press\(\);/);
});

test("the trade card goes to another coin only while it rests: a trade under way, its result or a limit's signature keep it", () => {
  assert.equal(ticketFree({ open: false, phase: "wallet", held: true }), true);
  assert.equal(ticketFree({ open: true, phase: "idle", held: false }), true);
  for (const phase of ["preparing", "wallet", "sending", "checking", "done", "failed", "unknown"]) assert.equal(ticketFree({ open: true, phase, held: false }), false, phase);
  assert.equal(ticketFree({ open: true, phase: "idle", held: true }), false);
  // Another coin named never closes the card: only the screen going does, and `close` refuses under a signature.
  const hook = read("./useTicket.ts");
  assert.equal((hook.match(/\.close\(\)/g) ?? []).length, 1, "the card is closed in one place");
  assert.match(hook, /useEffect\(\(\) => \(\) => useTrade\.getState\(\)\.close\(\), \[\]\);/);
  // A newly named coin opens on the screen's side — buying unless it says otherwise — and only while the card rests.
  assert.match(hook, /if \(ticketFree\(card\)\) card\.openFor\(wanted, sideNow\.current, \{ view \}\);/);
  assert.match(hook, /side: Side = 'buy'/);
  // Connecting from an empty Sell side asks the wallet for its address only, never through the trade's press.
  assert.match(read("./Ticket.tsx"), /const tap = \(\) => connectOrPick\(\(\) => setPicking\(true\)\);/);
});

test("the ticket stands on the trade card's own logic: the price, the order and the signature are the city's store, as they are", () => {
  const hook = read("./useTicket.ts");
  assert.match(hook, /from '@\/city\/lib\/trade\/store'/);
  for (const file of ["./Ticket.tsx", "./LimitStop.tsx", "./useTicket.ts", "./doors.ts"]) {
    const code = read(file);
    assert.doesNotMatch(code, /\/api\/solana\/swap|signTransaction|citySigner/, `${file} reaches the engine or the wallet itself`);
    assert.doesNotMatch(code, /from ['"](@\/)?(components|app\/app|app\/solana\/workspace)\//, `${file} takes from the old interface`);
  }
});

test("an address names a coin only when it is a Solana mint", () => {
  assert.equal(mintOf(SOL), SOL);
  assert.equal(mintOf(encodeURIComponent(JUP)), JUP);
  assert.equal(mintOf("SOL"), null);
  assert.equal(mintOf("%E0%A4%A"), null);
  assert.equal(mintOf(null), null);
});

test("a coin outside the market read keeps the engine's name and measures nothing: a dash, never a zero", () => {
  const coin = standIn({ mint: JUP, symbol: "JUP", name: "Jupiter", icon: null, verified: true });
  assert.equal(coin.verified, true);
  assert.equal(figure(coin, "price"), null);
  assert.deepEqual(factsOf(coin), []);
  const live = { ...coin, unread: ["traders1h"], price: 0.27, mcap: 8e8, liquidity: 4.8e6, volume24h: 8.5e6, traders1h: 0 };
  assert.deepEqual(factsOf(live).map((fact) => fact.name), ["mcap", "liquidity", "volume24h"]);
  assert.equal(figure(live, "price"), 0.27);
});

test("the position: what the wallet holds at the market's price, and a result only where the engine measured the cost", () => {
  assert.equal(positionOf(null, 72, 70), null);
  assert.equal(positionOf({ spendableRaw: "0", decimals: 9 }, 72, 70), null);
  const held = positionOf({ spendableRaw: "1500000000", decimals: 9 }, 72.22, 70.1);
  assert.equal(held.valueUsd.toFixed(2), "108.33");
  assert.equal(held.entry, 70.1);
  assert.equal(held.resultUsd.toFixed(2), "3.18");
  assert.equal(held.resultPct.toFixed(2), "3.02");
  const unknown = positionOf({ spendableRaw: "1500000000", decimals: 9 }, 72.22, null);
  assert.equal(unknown.entry, null);
  assert.equal(unknown.resultUsd, null, "a holding that also came from elsewhere has no result here");
  assert.equal(positionOf({ spendableRaw: "1500000000", decimals: 9 }, null, 70).valueUsd, null);
  assert.equal(signedUsd(3.18), "+$3.18");
  assert.equal(signedUsd(-0.424), "−$0.42");
  assert.equal(signedUsd(0.001), "$0.00");
  assert.equal(signedUsd(12345.6), "+$12,346");
});

test("the wallet's own trades of the coin, newest first, as the engine recorded them; rows it cannot read whole are left out", () => {
  const body = {
    trades: [
      { key: "BUY:a", kind: "BUY", mint: JUP, at: "2026-11-10T10:00:00Z", quantityRaw: "1000000", decimals: 6, costMicros: "250000", proceedsMicros: null, resultBps: null },
      { key: "SELL:b", kind: "SELL", mint: JUP, at: "2026-11-12T10:00:00Z", quantityRaw: "500000", decimals: 6, costMicros: "125000", proceedsMicros: "150000", resultBps: 2000 },
      { key: "BUY:c", kind: "BUY", mint: SOL, at: "2026-11-13T10:00:00Z", quantityRaw: "1", decimals: 9, costMicros: "1" },
      { key: "BUY:d", kind: "BUY", mint: JUP, at: "not a date", quantityRaw: "1", decimals: 6, costMicros: "1" },
      { key: "BUY:e", kind: "SWAP", mint: JUP, at: "2026-11-13T10:00:00Z", quantityRaw: "1", decimals: 6 },
    ],
  };
  const trades = tradesOf(body, JUP);
  assert.deepEqual(trades.map((trade) => trade.key), ["SELL:b", "BUY:a"]);
  assert.equal(trades[0].usd, 0.15);
  assert.equal(trades[0].resultPct, 20);
  assert.equal(trades[1].usd, 0.25);
  assert.equal(trades[1].resultPct, null);
  assert.deepEqual(tradesOf(null, JUP), []);
  assert.deepEqual(tradesOf({ trades: "x" }, JUP), []);
});
