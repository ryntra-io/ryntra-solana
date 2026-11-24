import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PRO_GOALS, proGoalsShown } from "../../city/lib/earn/pro.ts";
import { earnProWaveOpen, EARN_PRO_WAVE_ENV } from "../../lib/earn-pro/gate.ts";
import { PRESETS, presetsShown } from "./shape/model.ts";

/* Meteora's Wave is a new shape of money: behind its own switch on the ticket and on the server, closed by default. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("closed, the ticket offers the three goals and «Start from» no Wave; open, both offer it", () => {
  assert.deepEqual([...proGoalsShown(false)], ["even", "near", "edges"]);
  assert.deepEqual([...proGoalsShown(true)], [...PRO_GOALS]);
  assert.ok(proGoalsShown(true).includes("wave"));
  assert.deepEqual([...presetsShown(false)], ["even", "near", "edges"]);
  assert.deepEqual([...presetsShown(true)], [...PRESETS]);
});

test("the ticket and «Start from» follow the build's switch, exactly «open»", () => {
  const model = read("./shape/model.ts");
  assert.match(model, /export const WAVE_OPEN = process\.env\.NEXT_PUBLIC_RYNTRA_EARN_PRO_WAVE === 'open';/);
  assert.match(read("./ProTicket.tsx"), /const GOALS = proGoalsShown\(WAVE_OPEN\);/);
  assert.match(read("./shape/ShapePainter.tsx"), /\{presetsShown\(\)\.map\(/);
});

test("the server serves Wave only where a deployment says exactly «open»", () => {
  assert.equal(EARN_PRO_WAVE_ENV, "RYNTRA_EARN_PRO_WAVE");
  assert.equal(earnProWaveOpen({}), false);
  assert.equal(earnProWaveOpen({ RYNTRA_EARN_PRO_WAVE: "1" }), false);
  assert.equal(earnProWaveOpen({ RYNTRA_EARN_PRO_WAVE: "open" }), true);
  assert.match(read("../../lib/earn-pro/actions.server.ts"), /input\.goal === "wave" && !earnProWaveOpen\(env\)\) return fail\(404, "EARN_PRO_CLOSED"/);
});
