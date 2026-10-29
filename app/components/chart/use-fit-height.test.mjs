import assert from "node:assert/strict";
import test from "node:test";

import { FIT_FLOOR_PX, fitHeight } from "./use-fit-height.ts";

/**
 * The height a panel takes from the first screen. It had one rule — never below `min` — and that rule is what makes a
 * phone on its side worse than a phone upright: 390 px of screen against a floor written for a window 900 tall, and the
 * panel grows taller than everything around it. So the floor gives way to the room, down to a height no screen is below.
 */

const SPOT_PHONE = { min: 220, max: 640, margin: 64 + 12 };

test("a screen with room to spare gets the room, inside its bounds", () => {
  /* A phone upright: 844 px of window, the chart starting at 300, the bar 65 tall. */
  assert.equal(fitHeight({ innerHeight: 844, top: 300, bar: 65, ...SPOT_PHONE }), 844 - 300 - 65 - 76);
  /* And never past the ceiling, however tall the screen. */
  assert.equal(fitHeight({ innerHeight: 2160, top: 300, bar: 0, ...SPOT_PHONE }), 640);
});

test("a phone on its side gets the room it has, not the floor written for a tall window", () => {
  /* 844×390 with the bottom bar away (the frame hides it on a short landscape screen) and a 44 px header. */
  const room = 390 - 190 - 76;
  assert.ok(room < SPOT_PHONE.min, "the case only exists because the room is under the floor");
  assert.equal(fitHeight({ innerHeight: 390, top: 190, bar: 0, ...SPOT_PHONE }), room);
  /* The old rule returned the floor, and a panel taller than the screen pushed the page's action off it. */
  assert.ok(fitHeight({ innerHeight: 390, top: 190, bar: 0, ...SPOT_PHONE }) < SPOT_PHONE.min);
});

test("nothing taller than the screen, whatever a line's own minimum says", () => {
  /* The perpetuals terminal asks for 600 px at the least; a phone on its side has nothing like it. */
  const perps = { min: 600, max: 2400, margin: 12 };
  const height = fitHeight({ innerHeight: 390, top: 120, bar: 0, ...perps });
  assert.ok(height <= 390 - 120, "it fits under where it starts");
  assert.equal(height, 390 - 120 - 12);
});

test("a floor under which a panel says nothing at all", () => {
  /* No room left, or less than none: the panel keeps a height a person can still read a shape in. */
  assert.equal(fitHeight({ innerHeight: 390, top: 380, bar: 65, ...SPOT_PHONE }), FIT_FLOOR_PX);
  assert.equal(fitHeight({ innerHeight: 200, top: 400, bar: 0, ...SPOT_PHONE }), FIT_FLOOR_PX);
  assert.ok(FIT_FLOOR_PX > 0);
});

test("what must stay seen below the panel is taken off its height first", () => {
  /* The ranges under a company's line (`tail`): the panel gives them their place instead of covering them. */
  const without = fitHeight({ innerHeight: 900, top: 500, below: 0, margin: 16, min: 280, max: 560 });
  const with_ = fitHeight({ innerHeight: 900, top: 500, below: 120, margin: 16, min: 280, max: 560 });
  assert.equal(without - with_, 120);
});

test("the phone's bar is room the panel never had", () => {
  const bare = fitHeight({ innerHeight: 844, top: 300, bar: 0, ...SPOT_PHONE });
  const barred = fitHeight({ innerHeight: 844, top: 300, bar: 65, ...SPOT_PHONE });
  assert.equal(bare - barred, 65, "a pinned action over the bar is not the panel's to cover");
});
