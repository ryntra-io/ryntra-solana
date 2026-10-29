/* The world's rules, pure: levels, slots, modules, links and points. */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const catalog = await import("./catalog.ts");
const rules = await import("./rules.ts");
const contract = await import("./contract.ts");
const { awardPoints, recordWorldEvent, freezeWorldVersion, WorldInputRefused } = await import("./award.ts");
const { MemoryWorldStore } = await import("./memory-store.ts");

const quarter = (level) => ({ id: "q", ownerId: "r", district: "arrivals", street: "arrivals-1", cell: { x: 0, z: 0 }, level, version: 1, updatedAt: "" });

test("points reach levels at the thresholds and never past ten", () => {
  assert.equal(catalog.quarterLevelFor(0), 1);
  assert.equal(catalog.quarterLevelFor(29), 1);
  assert.equal(catalog.quarterLevelFor(30), 2);
  assert.equal(catalog.quarterLevelFor(1_000_000), 10);
  assert.deepEqual([1, 2, 3, 10].map(catalog.openSlots), [3, 4, 5, 12]);
  assert.deepEqual([1, 2, 3, 5, 7, 10].map(catalog.maxBuildingLevel), [2, 2, 3, 4, 5, 5]);
  for (let slot = 0; slot < catalog.QUARTER_SLOTS; slot += 1) {
    const level = catalog.quarterLevelForSlot(slot);
    assert.ok(slot < catalog.openSlots(level) && (level === 1 || slot >= catalog.openSlots(level - 1)), `slot ${slot}`);
  }
  for (let b = 1; b <= 5; b += 1) assert.ok(catalog.maxBuildingLevel(catalog.quarterLevelForBuilding(b)) >= b);
});

test("the catalog covers every kind of the contract and every module opens at some level", () => {
  assert.deepEqual(Object.keys(catalog.KINDS).sort(), [...contract.BUILDING_KINDS].sort());
  for (const [id, m] of Object.entries(catalog.MODULES)) {
    assert.match(id, /^[a-z]+\.[a-z0-9_]+$/);
    assert.equal(id.split(".")[0], m.part);
    assert.ok(m.from >= 1 && m.from <= catalog.MAX_QUARTER_LEVEL);
  }
  for (const example of ["base.stone", "floor.glass", "roof.garden", "light.amber"]) assert.ok(catalog.MODULES[example], example);
  for (const task of catalog.DAILY_TASKS) assert.ok(contract.DAILY_TASK_KINDS.includes(task.kind));
});

test("points come only from the contract's reasons; volume and launch counts pay nothing", () => {
  assert.deepEqual(Object.keys(catalog.POINTS).sort(), [...contract.POINTS_REASONS].sort());
  for (const reason of contract.POINTS_REASONS) assert.doesNotMatch(reason, /volume|trade|launch|swap|buy/);
  assert.equal(rules.isPointsReason("trade_volume"), false);
  assert.equal(rules.isPointsReason("launch_count"), false);
});

test("awarding points: the amount is the list's, the key pays once, other reasons are refused", async () => {
  const store = new MemoryWorldStore();
  const { resident } = await store.claim({ accountId: null, guestSalt: "0".repeat(32), displayName: null, now: new Date() });
  const first = await awardPoints(store, { residentId: resident.id, reason: "survival_30", sourceRef: "mint", key: "survival_30:mint" });
  assert.deepEqual(first, { ok: true, awarded: true, total: catalog.POINTS.survival_30 });
  assert.equal((await awardPoints(store, { residentId: resident.id, reason: "survival_30", sourceRef: "mint", key: "survival_30:mint" })).awarded, false);
  await assert.rejects(() => awardPoints(store, { residentId: resident.id, reason: "trade_volume", sourceRef: "x", key: "v" }), WorldInputRefused);
  await assert.rejects(() => awardPoints(store, { residentId: resident.id, reason: "launch_count", sourceRef: "x", key: "l" }), WorldInputRefused);
  await assert.rejects(() => awardPoints(store, { residentId: resident.id, reason: "task_done", sourceRef: "", key: "k" }), WorldInputRefused);
  await assert.rejects(() => recordWorldEvent(store, { source: "world", kind: "build", subject: "x", sourceAt: new Date() }), WorldInputRefused);
  const event = await recordWorldEvent(store, { source: "market", kind: "pump", subject: "mint", sourceAt: new Date("2026-10-27T10:00:00Z") });
  assert.equal(event.sourceAt, "2026-10-27T10:00:00.000Z");
  await assert.rejects(() => freezeWorldVersion(store, { day: "27.10.2026", seed: "s", towers: [] }), WorldInputRefused);
});

test("modules: one base, up to four floors, one roof, light and sign, kept in one order", () => {
  assert.deepEqual(rules.normalizeModules(["sign.plain", "floor.glass", "base.stone", "floor.concrete", "light.amber", "roof.flat"]), {
    ok: true, modules: ["base.stone", "floor.glass", "floor.concrete", "roof.flat", "light.amber", "sign.plain"],
  });
  for (const bad of [[], ["floor.glass"], ["base.stone", "base.timber"], ["base.stone", "roof.flat", "roof.dome"], ["base.stone", ...Array(5).fill("floor.glass")], "base.stone", [1]]) {
    assert.equal(rules.normalizeModules(bad).ok, false, JSON.stringify(bad));
  }
  assert.equal(rules.normalizeModules(["base.gold"]).refusal.code, "UNKNOWN_MODULE");
});

test("a build moves the day's tasks only by what it adds", () => {
  const home = { id: "b", quarterId: "q", slot: 0, kind: "home", level: 2, modules: ["base.stone", "floor.glass", "light.amber"], link: null, updatedAt: "" };
  const plan = (modules, kind = "home", buildings = [home]) => rules.planBuild({ quarter: quarter(10), buildings, slot: 0, kind, modules });
  assert.deepEqual(plan(["base.stone", "floor.glass", "floor.glass", "light.amber"]).plan.progress, [{ kind: "add_floor", delta: 1 }]);
  assert.deepEqual(plan(["base.stone", "floor.glass", "light.violet"]).plan.progress, [{ kind: "light_street", delta: 1 }]);
  assert.deepEqual(plan(["base.stone"]).plan.progress, [], "taking a floor off is not progress");
  assert.deepEqual(plan(["base.stone", "floor.glass", "light.amber"], "decor").plan.progress, [{ kind: "add_floor", delta: 1 }, { kind: "light_street", delta: 1 }], "a new kind is a new building");
  assert.equal(plan(["base.stone", "floor.glass", "floor.glass", "floor.glass", "floor.glass"]).plan.level, 5);
});

test("a building that shows an engine object keeps its kind", () => {
  const linked = { id: "b", quarterId: "q", slot: 0, kind: "coin_tower", level: 1, modules: ["base.stone"], link: { kind: "mint", mint: "So11111111111111111111111111111111111111112" }, updatedAt: "" };
  const refused = rules.planBuild({ quarter: quarter(10), buildings: [linked], slot: 0, kind: "decor", modules: ["base.stone"] });
  assert.equal(refused.refusal.reason, "linked");
  assert.equal(rules.planBuild({ quarter: quarter(10), buildings: [linked], slot: 0, kind: "coin_tower", modules: ["base.basalt"] }).ok, true);
});

test("links: exact fields, the right building, the account's own book", () => {
  const MINT = "So11111111111111111111111111111111111111112";
  const id = "6f1c2a8e-1b7d-4c55-9e8f-0a1b2c3d4e5f";
  assert.deepEqual(rules.parseLink({ kind: "mint", mint: MINT }), { kind: "mint", mint: MINT });
  assert.deepEqual(rules.parseLink({ kind: "strategy", strategyId: id.toUpperCase() }), { kind: "strategy", strategyId: id });
  assert.deepEqual(rules.parseLink({ kind: "team", teamId: "0123456789abcdef01234567" }), { kind: "team", teamId: "0123456789abcdef01234567" });
  for (const bad of [null, [], { kind: "mint" }, { kind: "mint", mint: MINT, x: 1 }, { kind: "team", teamId: id }, { kind: "agent", agentId: "a" }, { kind: "money", amount: 1 }]) {
    assert.equal(rules.parseLink(bad), null, JSON.stringify(bad));
  }
  assert.deepEqual(rules.checkLinkShape({ kind: "home", link: { kind: "mint", mint: MINT }, accountId: null }), { ok: false, reason: "kind_mismatch" });
  assert.deepEqual(rules.checkLinkShape({ kind: "workshop", link: { kind: "strategy", strategyId: id }, accountId: null }), { ok: false, reason: "account_required" });
  assert.deepEqual(rules.checkLinkShape({ kind: "oracle", link: { kind: "prediction_book", accountId: id }, accountId: "other" }), { ok: false, reason: "not_yours" });
  assert.deepEqual(rules.checkLinkShape({ kind: "showcase", link: { kind: "mint", mint: MINT }, accountId: null }), { ok: true });
  assert.deepEqual(rules.storedLink({ kind: "prediction_book", accountId: id }), { kind: "prediction_book" });
  assert.deepEqual(rules.ownerBuilding({ link: { kind: "prediction_book" } }, id).link, { kind: "prediction_book", accountId: id });
});

test("the day is the UTC date", () => {
  assert.equal(rules.dayOf(new Date("2026-10-27T23:59:59.999Z")), "2026-10-27");
  assert.equal(rules.dayOf(new Date("2026-10-28T00:00:00.000+03:00")), "2026-10-27");
  assert.equal(rules.taskKey("2026-10-27", "add_floor"), "task_done:2026-10-27:add_floor");
});
