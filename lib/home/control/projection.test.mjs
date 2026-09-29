import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROL_AUTHORITY,
  CONTROL_GROUPS,
  buildControlProjection,
  controlVocabulary,
} from "./projection.ts";

const input = (overrides = {}) => ({
  asOf: "2026-08-23T10:00:00.000Z",
  commitments: { count: 0, state: "OK", value: "0", reason: null, observedAt: "2026-08-23T09:59:00.000Z" },
  monitoring: { ruleCount: 3, scheduledCount: 2, unenrolledCount: 0, state: "OK", reason: null, observedAt: "2026-08-23T09:58:00.000Z" },
  sources: [
    { sourceId: "arcus", label: "Arcus", state: "OK", reason: null, observedAt: "2026-08-23T09:59:00.000Z" },
    { sourceId: "rhj", label: "Robinhood stock tokens", state: "FAILED", reason: "The venue refused the read.", observedAt: null },
  ],
  risk: [
    { id: "concentration", status: "EXCEEDED", detailHref: "/app/portfolio" },
    { id: "liquidity", status: "WITHIN", detailHref: "/app/portfolio" },
  ],
  waiting: { queueCount: 1, openActionCount: 2 },
  recovery: [],
  ...overrides,
});

test("every tile is a projection with a named owner and a link", () => {
  const projection = buildControlProjection(input());
  assert.ok(projection.tiles.length > 0);
  for (const tile of projection.tiles) {
    assert.equal(tile.authority, CONTROL_AUTHORITY);
    assert.ok(tile.owner.surface.length > 0, tile.tileId + " must name the surface that owns it");
    assert.match(tile.owner.href, /^\/(app|agents)\//, tile.tileId + " must link to that surface");
    assert.ok(CONTROL_GROUPS.includes(tile.group));
  }
});

test("the authority is the constant PROJECTION and nothing here is a second source of truth", () => {
  assert.equal(CONTROL_AUTHORITY, "PROJECTION");
  const projection = buildControlProjection(input());
  assert.equal(projection.authority, "PROJECTION");
  assert.equal(new Set(projection.tiles.map((tile) => tile.authority)).size, 1);
});

test("a tile without an owner cannot be built", () => {
  assert.throws(
    () => buildControlProjection(input({ sources: [{ sourceId: "", label: "", state: "OK", reason: null, observedAt: null }] })),
    /owner|source/i,
  );
});

test("what no server can read says so, with the reason and the way in", () => {
  const projection = buildControlProjection(input());
  const cases = projection.tiles.find((tile) => tile.tileId === "agent-cases");
  assert.equal(cases.state, "NOT_SERVER_READABLE");
  assert.match(cases.reason, /browser|tab|session/i);
  assert.equal(cases.owner.href, "/agents/workspace/actions");
  assert.equal(cases.value, null);
});

test("no tile prints the same word twice: the chip carries the domain's own state", () => {
  /* Found by looking: `LIQUIDITY / UNKNOWN / UNKNOWN` — the tone's name in the
     chip and the same word again as the value. */
  for (const tile of buildControlProjection(input()).tiles) {
    assert.ok(tile.stateLabel.length > 0, tile.tileId + " must carry a chip label");
    assert.notEqual(tile.value, tile.stateLabel, tile.tileId + " must not print its state twice");
    assert.equal(/_/.test(tile.stateLabel), false, tile.tileId + " must not print a raw enum: " + tile.stateLabel);
  }
  const liquidity = buildControlProjection(input()).tiles.find((tile) => tile.tileId === "risk-liquidity");
  assert.equal(liquidity.stateLabel, "WITHIN");
  assert.equal(liquidity.value, null);
});

test("a failed source is a degraded tile carrying the provider's own reason", () => {
  const projection = buildControlProjection(input());
  const source = projection.tiles.find((tile) => tile.tileId === "source-rhj");
  assert.equal(source.state, "DEGRADED");
  assert.equal(source.reason, "The venue refused the read.");
});

test("a constraint inside its limit is not an attention tile", () => {
  const projection = buildControlProjection(input());
  const within = projection.tiles.find((tile) => tile.tileId === "risk-liquidity");
  const exceeded = projection.tiles.find((tile) => tile.tileId === "risk-concentration");
  assert.equal(within.state, "OK");
  assert.equal(exceeded.state, "ATTENTION");
});

test("the vocabulary is imported from Agent Control rather than restated", () => {
  const vocabulary = controlVocabulary();
  assert.ok(vocabulary.actionClasses.includes("TRANSFER"));
  assert.ok(vocabulary.authorizationModes.includes("BOUNDED_MANDATE"));
  assert.ok(vocabulary.enforcementGrades.includes("OBSERVE_ONLY"));
  assert.ok(vocabulary.mandateStates.includes("REVOKED"));
  assert.equal(vocabulary.owner.href, "/agents/workspace");
});

test("no tile carries a control that acts: this surface pauses, revokes and authorizes nothing", () => {
  const projection = buildControlProjection(input());
  const text = JSON.stringify(projection).toLowerCase();
  for (const word of ["pause(", "revoke(", "authorize(", "killswitch", "kill-switch"]) {
    assert.equal(text.includes(word), false, "the projection must not carry " + word);
  }
  for (const tile of projection.tiles) assert.equal("action" in tile, false);
});

test("the surface state comes from the tiles rather than from a second calculation", () => {
  assert.equal(buildControlProjection(input()).state, "DEGRADED");
  assert.equal(
    buildControlProjection(
      input({
        sources: [{ sourceId: "arcus", label: "Arcus", state: "OK", reason: null, observedAt: null }],
        risk: [{ id: "liquidity", status: "WITHIN", detailHref: "/app/portfolio" }],
        waiting: { queueCount: 0, openActionCount: 0 },
      }),
    ).state,
    "CALM",
  );
});

test("the same input always projects the same tiles, in the same order", () => {
  assert.deepEqual(buildControlProjection(input()), buildControlProjection(input()));
});
