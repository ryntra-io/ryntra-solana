import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryGuardStore } from "../guard/store.ts";
import { peopleOpen, peopleOpenOf, readEngineAlerts, readPeopleSwitch, setPeopleSwitch, tellOperator } from "./engine.server.ts";

const at = Date.parse("2026-10-20T06:00:00.000Z");
const quietPass = { steps: [{ token: "T1", step: "ON_CURVE" }], stats: { failing: 0, budget: { lagSeconds: 0 }, floor: { lagSeconds: 0 } } };

test("people's markets: open on devnet until the operator closes it, closed on mainnet until opened; not read — closed; each flip kept", async () => {
  assert.equal(peopleOpenOf("devnet", null), true);
  assert.equal(peopleOpenOf("mainnet", null), false);
  assert.equal(peopleOpenOf("devnet", undefined), false, "a switch not read is closed");
  const store = createMemoryGuardStore();
  assert.equal(await peopleOpen(store, "mainnet"), false);
  const opened = await setPeopleSwitch(store, { cluster: "mainnet", open: true, by: "admin:1", now: new Date(at) });
  assert.equal(opened.changed, true);
  assert.equal(await peopleOpen(store, "mainnet"), true);
  assert.equal((await setPeopleSwitch(store, { cluster: "mainnet", open: true, by: "admin:1", now: new Date(at + 1_000) })).changed, false, "a flip that changes nothing");
  await setPeopleSwitch(store, { cluster: "mainnet", open: false, by: "admin:2", now: new Date(at + 2_000) });
  const row = await readPeopleSwitch(store, "mainnet");
  assert.deepEqual(row.flips.map((flip) => [flip.open, flip.by]), [[true, "admin:1"], [false, "admin:2"]]);
  assert.equal(await peopleOpen(store, "mainnet"), false);
  assert.equal(await peopleOpen(store, "devnet"), true, "each network its own switch");
  const broken = { ...store, versioned: () => ({ get: async () => { throw new Error("store down"); } }) };
  assert.equal(await peopleOpen(broken, "devnet"), false);
});

test("after a pass: three failed transactions in a row across passes — the operator hears once; a landed one ends the run", async () => {
  const store = createMemoryGuardStore();
  const heard = [];
  const tell = (steps, minute) =>
    tellOperator(store, {
      cluster: "mainnet",
      pass: { ...quietPass, steps },
      previousAt: new Date(at + (minute - 1) * 60_000).toISOString(),
      startedAt: new Date(at + minute * 60_000),
      now: new Date(at + minute * 60_000 + 5_000),
      nodes: { reads: 40, mainDown: 0, bothFailed: 0 },
      lamports: 500_000_000n,
      alert: async (text) => {
        heard.push(text);
        return true;
      },
    });
  await tell([{ token: "A", step: "BUDGET_CLAIM_FAILED" }], 1);
  await tell([{ token: "A", step: "GRADUATION_REJECTED" }], 2);
  assert.equal(heard.length, 0, "two are not yet a series");
  const third = await tell([{ token: "B", step: "BUDGET_CLAIM_FAILED" }], 3);
  assert.deepEqual(third.said, ["RAISED:SENDS"]);
  assert.equal(heard[0], "Ryntra · виконавець\nУвага: 3 транзакції поспіль не пройшли");
  await tell([{ token: "B", step: "BUDGET_CLAIM_FAILED" }], 4);
  assert.equal(heard.length, 1, "not again each minute");
  const landed = await tell([{ token: "B", step: "BUDGET_CLAIMED" }], 5);
  assert.deepEqual(landed.said, [], "the run is over; said cleared only after ten quiet minutes");
  const cleared = await tell([], 15);
  assert.deepEqual(cleared.said, ["CLEARED:SENDS"]);
  assert.equal((await readEngineAlerts(store, "mainnet")).active.SENDS, undefined);
});

test("after a pass: a read neither node answered, SOL low, a silence and a pause — one message; undelivered, tried again a quarter of an hour later", async () => {
  const store = createMemoryGuardStore();
  let answer = false;
  const heard = [];
  const tell = (minute) =>
    tellOperator(store, {
      cluster: "mainnet",
      pass: { ...quietPass, steps: [{ token: "4JVX000000000000QRLa", step: "STATE_PAUSED_RISK" }] },
      previousAt: new Date(at - 20 * 60_000).toISOString(),
      startedAt: new Date(at + minute * 60_000),
      now: new Date(at + minute * 60_000),
      nodes: { reads: 40, mainDown: 4, bothFailed: 1 },
      lamports: 20_000_000n,
      alert: async (text) => {
        heard.push(text);
        return answer;
      },
    });
  const first = await tell(0);
  assert.equal(first.delivered, false);
  assert.equal(heard.length, 1);
  assert.doesNotMatch(heard[0], /вузл/, "the nodes failing are said only once it lasts");
  assert.equal(heard[0], "Ryntra · виконавець\nМинуло: 20 хв без проходів\nУвага: 1 ринок на паузі за ризик-лімітами — 4JVX…QRLa\nУвага: SOL у виконавця 0,020 — менше 0,100, поповніть");
  await tell(1);
  assert.equal(heard.length, 1, "an undelivered word is not tried every minute");
  for (let minute = 2; minute < 15; minute += 1) await tell(minute);
  assert.equal(heard.length, 1, "still not tried again within the quarter");
  answer = true;
  const later = await tell(15);
  assert.equal(later.delivered, true);
  assert.deepEqual(later.said.filter((word) => word.startsWith("RAISED")).sort(), ["RAISED:LOW_SOL", "RAISED:NODE"]);
});
