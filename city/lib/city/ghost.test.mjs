import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ghostGuard } from "./ghost.ts";

/* CITY-200: on a 390 px phone one tap on SOL's tower opened Spot and, with the same tap's click, «Ask Ryntra» in its head. */
const touchEnd = () => {
  const e = { cancelable: true, prevented: false, preventDefault() { this.prevented = true; } };
  return e;
};

test("a touch tap that picked a tower cancels its own click; the next tap is free", () => {
  const g = ghostGuard();
  g.arm("touch");
  const first = touchEnd();
  g.onTouchEnd(first);
  assert.equal(first.prevented, true);
  const second = touchEnd();
  g.onTouchEnd(second);
  assert.equal(second.prevented, false, "only the tap that opened the window");
});

test("a mouse, a reset press and an uncancelable end are left alone", () => {
  const g = ghostGuard();
  g.arm("mouse");
  const m = touchEnd();
  g.onTouchEnd(m);
  assert.equal(m.prevented, false);
  g.arm("touch");
  g.reset();
  const r = touchEnd();
  g.onTouchEnd(r);
  assert.equal(r.prevented, false);
  g.arm("touch");
  const u = { cancelable: false, prevented: false, preventDefault() { this.prevented = true; } };
  g.onTouchEnd(u);
  assert.equal(u.prevented, false);
});

test("the camera rig arms the guard on a tower's tap and listens to touchend, not passively", () => {
  const rig = readFileSync(new URL("../../components/city/CameraRig.tsx", import.meta.url), "utf8");
  assert.match(rig, /if \(hit\) ghost\.arm\(e\.pointerType\);\s*state\.select/);
  assert.match(rig, /addEventListener\('touchend', onTouchEnd, \{ passive: false \}\)/);
});
