import "../world/testing/hooks.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import { DAY_TASKS, TASKS_PER_DAY, dayOf, dayTasks, foldDay, marksOf, resetAt, taskAward, taskLine, tasksForDay } from "./day.ts";
import { random } from "./fixtures.mjs";

const { DAILY_TASKS, MODULES, POINTS } = await import("../world/catalog.ts");
const { DAILY_TASK_KINDS } = await import("../world/contract.ts");
const { planBuild, taskKey, tasksOfDay } = await import("../world/rules.ts");

/*
 * The day's tasks: three a person, new at 00:00 UTC, done by world events — and exactly what the world's server
 * already checks, so the panel, the rules and the ledger say the same thing.
 */

const ALL_LIVE = DAY_TASKS.map((r) => ({ ...r, live: true }));

test("five tasks exist, none of them about money; the three live ones are the world's own list", () => {
  assert.deepEqual(DAY_TASKS.map((r) => r.kind).sort(), [...DAILY_TASK_KINDS].sort());
  for (const r of DAY_TASKS) assert.doesNotMatch(`${r.kind} ${r.line}`, /buy|sell|trade|swap|launch|pay|deposit|\$/i);
  const live = DAY_TASKS.filter((r) => r.live);
  assert.equal(live.length, TASKS_PER_DAY);
  assert.deepEqual(live.map((r) => ({ kind: r.kind, goal: r.goal })), DAILY_TASKS.map((t) => ({ kind: t.kind, goal: t.goal })));
  assert.deepEqual(DAY_TASKS.filter((r) => !r.live).map((r) => r.kind), ["run", "coop_build"], "a run and a shared build wait until the server can check them");
});

test("the panel draws the server's own list: the same tasks, goals and progress as GET /api/world/me", () => {
  const day = "2026-10-27";
  for (const id of ["resident-1", "resident-2", "resident-3"]) {
    // A fresh day: the server answers its whole list at zero; the panel shows exactly that list.
    const served = tasksOfDay([], id, day);
    const shown = dayTasks(served, id, day);
    assert.deepEqual(shown.map(({ kind, goal, progress, doneAt }) => ({ kind, goal, progress, doneAt })), served.map(({ kind, goal, progress, doneAt }) => ({ kind, goal, progress, doneAt })));
    // Before the server has answered for today, the panel uses the server's rule for a new day — the same list.
    assert.deepEqual(dayTasks([], id, day).map((t) => [t.kind, t.goal]), served.map((t) => [t.kind, t.goal]));
    // And the city's rules give the same tasks with the same goals.
    assert.deepEqual(tasksForDay(id, day).map((r) => [r.kind, r.goal]), served.map((t) => [t.kind, t.goal]));
  }
  // Progress and done as stored; a stored task of yesterday moves nothing today.
  const stored = [
    { residentId: "r", day, kind: "add_floor", progress: 1, goal: 1, doneAt: `${day}T09:00:00.000Z` },
    { residentId: "r", day, kind: "visit_quarters", progress: 2, goal: 3, doneAt: null },
  ];
  const shown = dayTasks(tasksOfDay(stored, "r", day), "r", day);
  assert.deepEqual(shown.map((t) => [t.kind, t.progress, t.done]), [["add_floor", 1, true], ["light_street", 0, false], ["visit_quarters", 2, false]]);
  assert.deepEqual(shown.map((t) => t.line), shown.map((t) => taskLine(t.kind)));
  const yesterday = dayTasks(tasksOfDay(stored, "r", day), "r", "2026-10-28");
  assert.ok(yesterday.every((t) => t.progress === 0 && !t.done), "the day turned: everything starts at zero");
});

test("three tasks a person: the same all day on every device, new at 00:00 UTC", () => {
  const people = Array.from({ length: 200 }, (_, i) => `resident-${i}`);
  for (const id of people) {
    const morning = tasksForDay(id, dayOf("2026-10-27T00:00:00.000Z"));
    const night = tasksForDay(id, dayOf("2026-10-27T23:59:59.999Z"));
    assert.deepEqual(night, morning);
    assert.equal(morning.length, TASKS_PER_DAY);
    // With three live tasks, everyone has those three — what the world's server hands out today.
    assert.deepEqual(tasksOfDay([], id, "2026-10-27").map((t) => t.kind), morning.map((r) => r.kind));
  }
  assert.equal(dayOf("2026-10-27T23:59:59.999Z"), "2026-10-27");
  assert.equal(dayOf("2026-10-28T00:00:00.000Z"), "2026-10-28");
  assert.equal(resetAt("2026-10-27T13:45:00.000Z"), "2026-10-28T00:00:00.000Z");
  assert.equal(resetAt("2026-10-27T00:00:00.000Z"), "2026-10-28T00:00:00.000Z");
  assert.equal(resetAt(new Date("2026-12-31T23:59:59.000Z")), "2027-01-01T00:00:00.000Z");
});

test("when more tasks are live, each person draws three a day — stable, varied, always live ones", () => {
  const seen = new Set();
  const counts = new Map();
  for (let i = 0; i < 400; i += 1) {
    const id = `resident-${i}`;
    for (const day of ["2026-10-27", "2026-10-28", "2026-10-29"]) {
      const picked = tasksForDay(id, day, ALL_LIVE);
      assert.equal(picked.length, TASKS_PER_DAY);
      assert.equal(new Set(picked.map((r) => r.kind)).size, TASKS_PER_DAY);
      assert.deepEqual(tasksForDay(id, day, ALL_LIVE), picked, "the same answer twice");
      const order = picked.map((r) => ALL_LIVE.findIndex((x) => x.kind === r.kind));
      assert.deepEqual(order, [...order].sort((a, b) => a - b), "in the list's order");
      seen.add(picked.map((r) => r.kind).join(","));
      for (const r of picked) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
    }
  }
  assert.equal(seen.size, 10, "every three of five comes up");
  for (const [kind, n] of counts) assert.ok(n > 400 * 3 * 0.45 && n < 400 * 3 * 0.75, `${kind}: ${n}`);
  const someLive = ALL_LIVE.map((r) => (r.kind === "coop_build" ? { ...r, live: false } : r));
  for (let i = 0; i < 50; i += 1) assert.ok(tasksForDay(`r${i}`, "2026-10-27", someLive).every((r) => r.kind !== "coop_build"));
});

test("a build marks the day exactly as the world's server does", () => {
  const rnd = random(7);
  const floors = Object.keys(MODULES).filter((id) => MODULES[id].part === "floor" && MODULES[id].from === 1);
  const lights = [null, ...Object.keys(MODULES).filter((id) => MODULES[id].part === "light" && MODULES[id].from === 1)];
  const make = () => {
    const light = lights[Math.floor(rnd() * lights.length)];
    return ["base.stone", ...floors.slice(0, Math.floor(rnd() * 2)), ...(light ? [light] : [])];
  };
  const quarter = { id: "q", ownerId: "r", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level: 3, version: 1, updatedAt: "" };
  let compared = 0;
  for (let i = 0; i < 300; i += 1) {
    const kind = rnd() > 0.5 ? "home" : "decor";
    const beforeKind = rnd() > 0.3 ? kind : kind === "home" ? "decor" : "home";
    const before = rnd() > 0.3 ? { kind: beforeKind, modules: make() } : null;
    const after = { kind, modules: make() };
    const buildings = before ? [{ id: "b", quarterId: "q", slot: 0, kind: before.kind, level: 1, modules: before.modules, link: null, updatedAt: "" }] : [];
    const planned = planBuild({ quarter, buildings, slot: 0, kind, modules: after.modules });
    if (!planned.ok) continue;
    assert.deepEqual(marksOf({ kind: "build", before, after }), planned.plan.progress, JSON.stringify({ before, after }));
    compared += 1;
  }
  assert.ok(compared > 250, `${compared} builds compared`);
  assert.deepEqual(marksOf({ kind: "visit", counted: true }), [{ kind: "visit_quarters", delta: 1 }]);
  assert.deepEqual(marksOf({ kind: "visit", counted: false }), [], "one's own quarter and a second visit in a day mark nothing");
  assert.deepEqual(marksOf({ kind: "run", checked: false }), [], "a run the server has not checked marks nothing");
  assert.deepEqual(marksOf({ kind: "run", checked: true }), [{ kind: "run", delta: 1 }]);
});

test("a day from the world's events: each task done once, at the moment it was done, paying the world's key", () => {
  const day = "2026-10-27";
  const t = (h) => `${day}T${String(h).padStart(2, "0")}:00:00.000Z`;
  const events = [
    { at: t(9), event: { kind: "visit", counted: true } },
    { at: t(8), event: { kind: "build", before: null, after: { kind: "home", modules: ["base.stone", "floor.glass", "light.amber"] } } },
    { at: t(10), event: { kind: "visit", counted: false } },
    { at: t(11), event: { kind: "visit", counted: true } },
    { at: t(12), event: { kind: "visit", counted: true } },
    { at: t(13), event: { kind: "visit", counted: true } },
    { at: t(14), event: { kind: "build", before: { kind: "home", modules: ["base.stone"] }, after: { kind: "home", modules: ["base.stone", "floor.glass", "floor.concrete"] } } },
    { at: "2026-10-28T00:00:00.000Z", event: { kind: "build", before: null, after: { kind: "decor", modules: ["base.stone", "floor.glass"] } } },
    { at: t(15), event: { kind: "run", checked: true } },
  ];
  const { tasks, awards } = foldDay("resident-1", day, events);
  assert.deepEqual(tasks.map((x) => [x.kind, x.progress, x.goal, x.doneAt]), [
    ["add_floor", 1, 1, t(8)],
    ["light_street", 1, 1, t(8)],
    ["visit_quarters", 3, 3, t(12)],
  ]);
  assert.deepEqual(awards.map((a) => a.key), ["task_done:2026-10-27:add_floor", "task_done:2026-10-27:light_street", "task_done:2026-10-27:visit_quarters"]);
  for (const a of awards) {
    assert.equal(a.key, taskKey(day, a.sourceRef), "the world's key");
    assert.equal(a.points, POINTS.task_done);
  }
  assert.deepEqual(taskAward(day, "run").key, taskKey(day, "run"));
  assert.equal(foldDay("resident-1", "2026-10-28", events).awards.length, 1, "after midnight a new day starts from nothing");
});
