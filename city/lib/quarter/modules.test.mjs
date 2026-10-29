// Run from repo root: node --test city/lib/quarter/modules.test.mjs
import "../../../lib/world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const { MODULES, firstBuildable, levelFor, moduleById, moduleForKind, refusalLine, verdict, verdictLine } = await import("./modules.ts");
const { MODULES: KIT, KINDS } = await import("../../../lib/world/catalog.ts");
const { planBuild } = await import("../../../lib/world/rules.ts");

/**
 * What the picker offers is what the world allows: every building is made of modules from the world's kit and
 * checked by the world's own rules; Home and a street lamp are open from level 1, the rest say what opens them.
 */

const quarter = (level = 1) => ({ id: "q", ownerId: "r", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level, version: 1, updatedAt: "" });
const built = (slot, kind) => ({ id: `b${slot}`, quarterId: "q", slot, kind, level: 1, modules: [...moduleForKind(kind).modules], link: null, updatedAt: "" });

test("Home comes first; Home and the lamp are open from the first minute", () => {
  assert.equal(MODULES[0].id, "home");
  for (const id of ["home", "lamp"]) {
    const m = moduleById(id);
    assert.equal(m.later, null);
    assert.equal(levelFor(m.kind), 1);
  }
});

test("every building is made of kit modules the world accepts at the level that opens it", () => {
  for (const m of MODULES) {
    for (const id of m.modules) assert.ok(KIT[id], `${m.id}: ${id} is in the kit`);
    const plan = planBuild({ quarter: quarter(KINDS[m.kind].from), buildings: [], slot: 0, kind: m.kind, modules: [...m.modules] });
    assert.ok(plan.ok, `${m.id} is a valid building at level ${KINDS[m.kind].from}`);
    assert.ok(m.name.length <= 11, `${m.id}: the name fits a tile`);
    assert.ok(m.line.length <= 28, `${m.id}: the line fits`);
  }
  assert.equal(new Set(MODULES.map((m) => m.kind)).size, MODULES.length);
  assert.equal(moduleForKind("billboard"), null, "sponsored light is not a resident's building");
});

test("the verdicts on a new quarter", () => {
  const q = quarter(1);
  const home = moduleById("home");
  const lamp = moduleById("lamp");
  assert.deepEqual(verdict(home, q, [], 1), { ok: true });
  assert.deepEqual(verdict(lamp, q, [], 0), { ok: true });
  assert.deepEqual(verdict(home, q, [], 3), { ok: false, why: "slot", need: 2 }, "the second row opens at level 2");
  assert.deepEqual(verdict(moduleById("harbor"), q, [], 0), { ok: false, why: "kind", need: 2 });
  assert.deepEqual(verdict(moduleById("garage"), q, [], 0), { ok: false, why: "kind", need: 3 });
  assert.deepEqual(verdict(moduleById("coin_tower"), q, [], 0), { ok: true }, "a coin tower stands from level 1 and shows its coin once linked");
  assert.deepEqual(verdict(moduleById("showcase"), quarter(4), [], 0), { ok: false, why: "later", need: null }, "the showcase comes with its own step");
  assert.deepEqual(verdict(home, q, [built(1, "home")], 0), { ok: false, why: "limit", need: null });
  assert.deepEqual(verdict(home, q, [built(1, "home")], 1), { ok: false, why: "same", need: null });
  assert.deepEqual(verdict(lamp, q, [built(1, "home")], 1), { ok: false, why: "taken", need: null }, "the city never knocks a home down");
  assert.deepEqual(verdict(lamp, q, [built(1, "home"), built(0, "decor")], 2), { ok: true }, "lamps are not one per quarter");
});

test("the button says what opens what", () => {
  const q = quarter(1);
  assert.equal(verdictLine(moduleById("home"), verdict(moduleById("home"), q, [], 1)), "Build Home");
  assert.equal(verdictLine(moduleById("harbor"), verdict(moduleById("harbor"), q, [], 0)), "Opens at level 2");
  assert.equal(verdictLine(moduleById("coin_tower"), verdict(moduleById("coin_tower"), q, [], 0)), "Build Coin tower");
  assert.equal(verdictLine(moduleById("showcase"), verdict(moduleById("showcase"), quarter(4), [], 0)), "Comes later");
  assert.equal(verdictLine(moduleById("home"), verdict(moduleById("home"), q, [], 4)), "Plot opens at level 3");
});

test("the picker opens on Home for an empty quarter, then on the lamp", () => {
  assert.equal(firstBuildable(quarter(1), [], 1)?.id, "home");
  assert.equal(firstBuildable(quarter(1), [built(1, "home")], 0)?.id, "lamp");
  assert.equal(firstBuildable(quarter(1), [built(1, "home")], 1), null, "nothing new goes on the home's own plot");
});

test("every refusal reads as one plain sentence", () => {
  for (const [code, reason, need] of [["LOCKED", "slot", 3], ["LOCKED", "limit", null], ["LOCKED", "linked", null], ["VERSION_CONFLICT"], ["RATE_LIMITED"], ["NO_RESIDENT"], ["OFFLINE"], ["UNAVAILABLE"], ["BAD_REQUEST"]]) {
    const line = refusalLine(code, reason ?? null, need ?? null);
    assert.match(line, /^[A-Z][^_]*\.$/, `${code} → "${line}"`);
  }
  assert.equal(refusalLine("LOCKED", "slot", 3), "That opens at quarter level 3.");
  assert.notEqual(refusalLine("VERSION_CONFLICT"), refusalLine("BAD_REQUEST"));
});
