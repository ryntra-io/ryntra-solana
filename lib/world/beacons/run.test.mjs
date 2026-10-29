/*
 * The server's pass over every beacon: the states land before anything is
 * said, a firing is told once and only where the person asked, no market
 * read writes nothing, and a beacon edited mid-pass is not told.
 */
import "../testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const { runBeacons } = await import("./run.ts");
const { MemoryBeaconStore } = await import("./store.ts");

const MINT = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const T0 = Date.parse("2026-10-28T12:00:00.000Z");
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const rule = (over = {}) => ({
  id: "beacon01", version: 1, groups: [[{ kind: "price", op: "above", value: 1.1 }]], holdSeconds: 0, hysteresis: 0.002,
  cooldownSeconds: 3600, repeat: true, expiresAt: null, quiet: null, on: true, createdAt: T0, mint: MINT, symbol: "BONK", notify: true, ...over,
});

function harness() {
  const store = new MemoryBeaconStore();
  const said = [];
  const clock = { now: T0, price: 1, read: true, answer: "sent" };
  const pass = () =>
    runBeacons({
      store,
      market: async () => (clock.read ? { towers: new Map([[MINT, { price: clock.price, liquidity: 1e6, change5m: 0, change1h: 0, change24h: 0 }]]), at: clock.now } : null),
      telegram: async (accountId, text, link) => {
        said.push({ accountId, text, link });
        return clock.answer;
      },
      link: (mint) => `https://ryntra.io/c/${mint}`,
      now: () => clock.now,
      pageSize: 1,
    });
  return { store, said, clock, pass };
}

test("a crossing is told once, to the account whose beacon lit, with the tower's link", async () => {
  const { store, said, clock, pass } = harness();
  await store.write({ accountId: A, revision: 0, rules: [rule()], states: {}, now: new Date(T0) });
  await store.write({ accountId: B, revision: 0, rules: [rule({ groups: [[{ kind: "price", op: "below", value: 0.5 }]] })], states: {}, now: new Date(T0) });
  assert.equal((await pass()).fired, 0, "first look: nothing fires");
  clock.now += 120_000;
  clock.price = 1.2;
  const report = await pass();
  assert.deepEqual({ fired: report.fired, told: report.told, checked: report.checked }, { fired: 1, told: 1, checked: 2 });
  assert.equal(said.length, 1);
  assert.equal(said[0].accountId, A);
  assert.equal(said[0].link, `https://ryntra.io/c/${MINT}`);
  assert.match(said[0].text, /^Ryntra · Beacon lit\n\$BONK · Price above \$1\.1\nNow \$1\.2\n/);
  clock.now += 120_000;
  await pass();
  assert.equal(said.length, 1, "still above: not told again");
});

test("no market read: nothing is known, nothing written, nothing said", async () => {
  const { store, said, clock, pass } = harness();
  await store.write({ accountId: A, revision: 0, rules: [rule()], states: {}, now: new Date(T0) });
  clock.read = false;
  const report = await pass();
  assert.deepEqual(report, { checked: 0, written: 0, fired: 0, told: 0, failed: 0, read: false });
  assert.deepEqual((await store.read(A)).states, {});
  assert.equal(said.length, 0);
});

test("not asked, or a chat that is not connected, is not told; a failed message is counted and not tried again", async () => {
  const { store, said, clock, pass } = harness();
  await store.write({ accountId: A, revision: 0, rules: [rule({ notify: false })], states: {}, now: new Date(T0) });
  await store.write({ accountId: B, revision: 0, rules: [rule()], states: {}, now: new Date(T0) });
  await pass();
  clock.now += 120_000;
  clock.price = 1.2;
  clock.answer = "failed";
  const report = await pass();
  assert.equal(report.fired, 2);
  assert.equal(report.failed, 1);
  assert.deepEqual(said.map((s) => s.accountId), [B]);
  clock.now += 120_000;
  await pass();
  assert.equal(said.length, 1);
});

test("a beacon edited mid-pass is not told: its states do not land", async () => {
  const { store, said, clock, pass } = harness();
  await store.write({ accountId: A, revision: 0, rules: [rule()], states: {}, now: new Date(T0) });
  await pass();
  clock.now += 120_000;
  clock.price = 1.2;
  const due = store.due.bind(store);
  store.due = async (input) => {
    const rows = await due(input);
    if (rows.length) await store.write({ accountId: A, revision: 1, rules: [rule({ version: 2 })], states: {}, now: new Date(clock.now) });
    return rows;
  };
  const report = await pass();
  assert.equal(report.written, 0);
  assert.equal(said.length, 0);
});
