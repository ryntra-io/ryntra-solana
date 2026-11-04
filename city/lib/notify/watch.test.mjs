import assert from "node:assert/strict";
import test, { mock } from "node:test";

/* CITY-87: the liquidation risk is Guard's — the centre reads the futures account itself whenever nobody read it in the
   last minute: the Exchange's window closed, or open but behind another tab (its own reads pause there). */

process.env.NEXT_PUBLIC_RYNTRA_CITY_EXCHANGE = "exit";
mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.parse("2026-10-31T12:00:00.000Z") });
const { startNotifySources } = await import("./sources.ts");
const { useExchange } = await import("../exchange/store.ts");

const account = (state = "active") => ({ wallet: "W1", state, positions: [], orders: [] });

test("the window open and reading: the centre stays out; the window paused behind a tab: the centre reads", () => {
  let reads = 0;
  useExchange.setState({ owner: "W1", open: true, account: { status: "ready", value: account(), at: Date.now() }, loadAccount: async () => void (reads += 1) });
  const stop = startNotifySources(() => undefined);
  mock.timers.tick(8_000);
  assert.equal(reads, 0, "read a moment ago by the window");
  // The window keeps reading every 15 s while on screen.
  useExchange.setState({ account: { status: "ready", value: account(), at: Date.now() } });
  mock.timers.tick(52_000);
  assert.equal(reads, 0);
  // Behind another tab the window stops; a minute without a read and the centre reads itself.
  mock.timers.tick(60_000);
  assert.equal(reads, 1);
  stop();
});

test("a wallet with nothing on Phoenix is asked again only every ten minutes; no wallet, nothing is read", () => {
  let reads = 0;
  useExchange.setState({ owner: "W1", open: false, account: { status: "ready", value: account("none"), at: Date.now() - 120_000 }, loadAccount: async () => void (reads += 1) });
  const stop = startNotifySources(() => undefined);
  mock.timers.tick(8_000 + 9 * 60_000);
  assert.equal(reads, 1, "the tenth minute");
  useExchange.setState({ owner: null });
  mock.timers.tick(20 * 60_000);
  assert.equal(reads, 1);
  stop();
});
