// Run from repo root: node --test city/lib/trade/holdings-watch.test.mjs
//
// CITY-237 (the supervisor's review): «Add SOL» now stands on three cards — the agent's, the tower's ticket, the money
// autopilot — and each read the wallet's balance every 15 s by its own timer, in a hidden tab too. One watch for all:
// a hidden tab reads nothing, two cards share one timer, a return to the page is one read.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createHoldingsWatch, HOLDINGS_WATCH_GAP_MS, HOLDINGS_WATCH_MS } from "./holdings-watch.ts";

/** A page with a clock: timers and «came back» listeners are kept in lists the test fires by hand. */
function page() {
  const state = { reads: 0, visible: true, at: 1_000_000, timers: [], returns: [] };
  const env = {
    read: () => void (state.reads += 1),
    visible: () => state.visible,
    now: () => state.at,
    every: (run, ms) => {
      const timer = { run, ms };
      state.timers.push(timer);
      return () => void state.timers.splice(state.timers.indexOf(timer), 1);
    },
    onReturn: (run) => {
      state.returns.push(run);
      return () => void state.returns.splice(state.returns.indexOf(run), 1);
    },
  };
  const tick = () => {
    state.at += HOLDINGS_WATCH_MS;
    for (const timer of [...state.timers]) timer.run();
  };
  /* The browser says a return twice: `focus` and `visibilitychange`, the same moment. */
  const comeBack = () => {
    state.visible = true;
    for (const run of [...state.returns]) run();
    for (const run of [...state.returns]) run();
  };
  return { state, watch: createHoldingsWatch(env), tick, comeBack };
}

test("a card that asks for funds reads the balance every 15 s while the page is in view", () => {
  const { state, watch, tick } = page();
  const stop = watch();
  assert.equal(state.timers.length, 1);
  assert.equal(state.timers[0].ms, 15_000);
  assert.equal(state.reads, 0, "nothing is read at the start: the card has the balance it was drawn from");
  tick();
  tick();
  assert.equal(state.reads, 2);
  stop();
  assert.equal(state.timers.length, 0, "the card gone, its timer is gone");
  assert.equal(state.returns.length, 0, "and its listeners");
});

test("a hidden tab reads nothing; the return to the page reads at once, once", () => {
  const { state, watch, tick, comeBack } = page();
  const stop = watch();
  state.visible = false;
  for (let i = 0; i < 40; i += 1) tick();
  assert.equal(state.reads, 0, "ten minutes in the background: not one read");
  comeBack();
  assert.equal(state.reads, 1, "`focus` and `visibilitychange` together are one read");
  state.at += HOLDINGS_WATCH_GAP_MS;
  comeBack();
  assert.equal(state.reads, 2, "a later return reads again");
  stop();
});

test("two cards asking at once share one timer; it lives until the last of them is gone", () => {
  const { state, watch, tick } = page();
  const agent = watch();
  const ticket = watch();
  assert.equal(state.timers.length, 1);
  assert.equal(state.returns.length, 1);
  tick();
  assert.equal(state.reads, 1, "one read a tick, not one a card");
  agent();
  agent();
  assert.equal(state.timers.length, 1, "a card's stop said twice does not take the other card's watch away");
  tick();
  assert.equal(state.reads, 2);
  ticket();
  assert.equal(state.timers.length, 0);
  const again = watch();
  assert.equal(state.timers.length, 1, "a new card starts the watch again");
  again();
});

test("the cards use the one watch, and nothing reads the balance by its own timer", () => {
  const read = (file) => readFileSync(new URL(file, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const parts = read("../../components/trade/WalletParts.tsx");
  assert.match(parts, /const watchHoldings = createHoldingsWatch\(\{/u);
  assert.match(parts, /visible: \(\) => document\.visibilityState === 'visible',/u);
  assert.match(parts, /useEffect\(\(\) => \(on \? watchHoldings\(\) : undefined\), \[on\]\);/u);
  for (const file of ["../../components/crew/CardWallet.tsx", "../../components/pilot/PilotCard.tsx", "../../components/trade/TradeSheet.tsx"]) {
    const card = read(file);
    assert.match(card, /useHoldingsWatch\(/u, file);
    assert.doesNotMatch(card, /setInterval\([^)]*refreshHoldings|setInterval\(again/u, file);
  }
});
