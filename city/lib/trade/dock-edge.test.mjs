import { test } from "node:test";
import assert from "node:assert/strict";

import { dockNudge } from "./dock-edge.ts";

// A phone's sheet: the card's room 362–844, the tabs at 380, the dock's edge at 700.
const VIEW = { top: 362, bottom: 844 };
const TABS = { top: 380, bottom: 410 };

test("no row cut by the dock's edge: nothing moves", () => {
  assert.equal(dockNudge([{ top: 600, bottom: 640 }, { top: 650, bottom: 690 }], 700, VIEW, TABS), 0);
  // A row the edge only grazes is not cut.
  assert.equal(dockNudge([{ top: 660, bottom: 701 }], 700, VIEW, TABS), 0);
});

test("the row the edge cuts comes up whole above the dock, the tabs still in sight (Д3: «You pay … · You have 0 SOL»)", () => {
  const rows = [{ top: 620, bottom: 650 }, { top: 680, bottom: 712 }];
  const nudge = dockNudge(rows, 700, VIEW, TABS);
  assert.equal(nudge, 14);
  assert.ok(rows[1].bottom - nudge <= 700 - 2, "the row whole above the edge");
  assert.ok(TABS.top - nudge >= VIEW.top, "the tabs in sight");
});

test("where moving on would take the tabs out of sight, the cut row goes whole under the dock instead", () => {
  const tabs = { top: 366, bottom: 396 };
  const row = { top: 690, bottom: 730 };
  const nudge = dockNudge([row], 700, VIEW, tabs);
  assert.equal(nudge, -10);
  assert.ok(row.top - nudge >= 700, "the row under the dock, whole");
});

test("a row already above the card's room is not the one the edge cuts", () => {
  assert.equal(dockNudge([{ top: 300, bottom: 720 }], 700, VIEW, TABS), 0);
});
