/*
 * The rules of a quarter's free layout (CITY-55): the grid, what may stand where, the caps that keep it from being
 * farmed, and a sign's words, which only the owner reads until CITY-73 cleans foreign text.
 */
import "./testing/hooks.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

const L = await import("./layout.ts");
const { planLayout, fitToQuarter, publicLayout, signText, pieceCap, slotOfCell, PIECES, PIECE_KINDS, GRID_W, GRID_D, MAX_STACK } = L;

const quarter = (level = 1) => ({ level });
const p = (gx, gz, kind = "block", y = 0, rot = 0, extra = {}) => ({ gx, gz, y, kind, rot, ...extra });
const plan = (pieces, level = 1, buildings = []) => planLayout({ quarter: quarter(level), buildings, pieces });

test("the grid is the quarter's 3 × 4 plots cut into 3 × 3 cells; slots count from the street, left to right", () => {
  assert.equal(GRID_W, 9);
  assert.equal(GRID_D, 12);
  assert.equal(slotOfCell(0, 0), 0);
  assert.equal(slotOfCell(4, 1), 1);
  assert.equal(slotOfCell(8, 2), 2);
  assert.equal(slotOfCell(0, 3), 3);
  assert.equal(slotOfCell(8, 11), 11);
});

test("a fresh quarter takes pieces on its three open plots, in one order, and nothing else is kept", () => {
  const done = plan([p(5, 2, "tree"), p(0, 0), p(0, 0, "glass", 1), p(3, 0, "path")]);
  assert.equal(done.ok, true);
  assert.deepEqual(done.pieces.map((x) => [x.gx, x.gz, x.y, x.kind]), [[0, 0, 0, "block"], [0, 0, 1, "glass"], [3, 0, 0, "path"], [5, 2, 0, "tree"]]);
});

test("a closed plot, a built plot, a cell off the grid and a malformed piece are refused by index", () => {
  assert.deepEqual(plan([p(0, 0), p(0, 3)]).refusal, { reason: "closed", index: 1, need: { quarterLevel: 2 } });
  assert.deepEqual(plan([p(4, 1)], 1, [{ slot: 1 }]).refusal, { reason: "built", index: 0 });
  assert.equal(plan([p(9, 0)]).refusal.reason, "shape");
  assert.equal(plan([{ ...p(0, 0), extra: 1 }]).refusal.reason, "shape");
  assert.equal(plan([p(0, 0, "castle")]).refusal.reason, "shape");
  assert.equal(plan([p(0, 0, "block", 0, 4)]).refusal.reason, "shape");
  assert.equal(plan([p(0, 0, "block", MAX_STACK)]).refusal.reason, "shape");
  assert.equal(plan({ pieces: [] }).refusal.reason, "shape");
});

test("pieces stack only on what carries; nothing floats, nothing shares a place", () => {
  assert.equal(plan([p(0, 0), p(0, 0, "block", 1), p(0, 0, "turret", 2)], 2).ok, true);
  assert.deepEqual(plan([p(0, 0, "block", 1)]).refusal, { reason: "support", index: 0 });
  assert.deepEqual(plan([p(0, 0, "tree"), p(0, 0, "lamp", 1)]).refusal, { reason: "support", index: 1 });
  assert.deepEqual(plan([p(0, 0), p(0, 0, "glass")]).refusal, { reason: "overlap", index: 1 });
  assert.deepEqual(plan([p(0, 0), p(0, 0, "path", 1)]).refusal, { reason: "support", index: 1 }, "a path lies on the ground");
  assert.deepEqual(plan([p(0, 0), p(0, 0, "arch", 1)]).refusal, { reason: "support", index: 1 }, "an arch stands on the ground");
});

test("a game building covers two by two cells inside one plot and takes its whole column", () => {
  assert.equal(plan([p(0, 0, "arcade")]).ok, true);
  assert.deepEqual(plan([p(2, 0, "arcade")]).refusal, { reason: "cell", index: 0 }, "across two plots");
  assert.deepEqual(plan([p(0, 0, "arcade"), p(1, 1, "tree")]).refusal, { reason: "overlap", index: 1 });
  assert.deepEqual(plan([p(1, 1, "block"), p(0, 0, "arcade")]).refusal, { reason: "overlap", index: 1 });
  assert.deepEqual(plan([p(0, 0, "arcade"), p(3, 0, "arcade")]).refusal, { reason: "limit", index: 1 });
  assert.deepEqual(plan([p(0, 0, "vault_house")]).refusal, { reason: "kind", index: 0, need: { quarterLevel: 2 } });
  assert.deepEqual(plan([p(0, 0, "mini_ring")], 2).refusal, { reason: "kind", index: 0, need: { quarterLevel: 3 } });
  assert.equal(plan([p(0, 0, "mini_ring")], 3).ok, true);
});

test("the caps: pieces by quarter level, signs and fountains per quarter — and nothing here pays", async () => {
  assert.equal(pieceCap(1), 40);
  assert.equal(pieceCap(5), 80);
  assert.equal(pieceCap(10), 120);
  const many = [];
  for (let gz = 0; gz < 3; gz += 1) for (let gx = 0; gx < 9; gx += 1) for (let y = 0; y < 2; y += 1) many.push(p(gx, gz, "block", y));
  assert.equal(many.length, 54);
  assert.deepEqual(plan(many).refusal, { reason: "cap", index: null, need: { quarterLevel: 2 } });
  assert.equal(plan(many.slice(0, 40)).ok, true);
  assert.deepEqual(plan([p(0, 0, "sign"), p(1, 0, "sign"), p(2, 0, "sign"), p(3, 0, "sign")]).refusal, { reason: "limit", index: 3 });
  for (const kind of PIECE_KINDS) assert.ok(PIECES[kind], kind);
  const source = (await import("node:fs")).readFileSync(new URL("./layout.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source.replace(/^\s*(\/\/|\*|\/\*).*$/gm, ""), /points|award|lamports|usdc|\bsol\b/i, "a layout knows nothing of points or money");
});

test("a sign takes 12 plain characters; anything else is refused, and only its owner reads it", () => {
  assert.deepEqual(signText("  Ryntra  Café "), { ok: true, text: "Ryntra Café" });
  assert.deepEqual(signText("Київ 24"), { ok: true, text: "Київ 24" });
  assert.equal(signText("").ok, false);
  assert.equal(signText("thirteen char").ok, false);
  assert.equal(signText("hi​there").ok, false, "invisible characters");
  assert.equal(signText("a‮b").ok, false, "direction overrides");
  assert.equal(signText("<script>").ok, false);
  assert.equal(signText("@everyone").ok, false);
  assert.equal(signText(42).ok, false);
  assert.deepEqual(plan([p(0, 0, "sign", 0, 0, { text: "x\u0000" })]).refusal, { reason: "sign", index: 0 });
  assert.deepEqual(plan([p(0, 0, "block", 0, 0, { text: "Hi" })]).refusal, { reason: "shape", index: 0 }, "only a sign has words");
  const kept = plan([p(0, 0, "sign", 0, 1, { text: " Open " })]);
  assert.equal(kept.pieces[0].text, "Open");
  const layout = { quarterId: "q", pieces: kept.pieces, version: 1, updatedAt: null };
  assert.equal(publicLayout(layout).pieces[0].text, undefined);
  assert.equal(publicLayout(layout).pieces[0].kind, "sign");
  assert.equal(layout.pieces[0].text, "Open", "the owner's copy keeps them");
});

test("fitToQuarter drops pieces a building took back, and what stood on them", () => {
  const pieces = [p(0, 0), p(0, 0, "glass", 1), p(4, 1), p(4, 1, "tree", 1), p(7, 2, "lamp")];
  const fit = fitToQuarter(pieces, 1, [{ slot: 1 }]);
  assert.deepEqual(fit.map((x) => [x.gx, x.gz, x.y]), [[0, 0, 0], [0, 0, 1], [7, 2, 0]]);
  const orphan = fitToQuarter([p(0, 0, "tree"), p(0, 0, "lamp", 1)], 1, []);
  assert.equal(orphan.length, 1);
  assert.equal(plan(fit).ok, true, "what fits is a layout the server takes");
});

test("free building is closed unless the deployment opens it", () => {
  assert.equal(L.freeBuildOpen(undefined), false);
  assert.equal(L.freeBuildOpen(""), false);
  assert.equal(L.freeBuildOpen("true"), false);
  assert.equal(L.freeBuildOpen("open"), true);
});
