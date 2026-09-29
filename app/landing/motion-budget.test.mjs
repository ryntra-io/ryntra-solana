import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8");

/**
 * Motion budget for the public surface (RYN-LAND-002).
 *
 * A one-off frame-rate reading proves the machine that took it was fast enough;
 * it does not prevent the next component from animating `width`. These gates
 * assert the property that actually makes the page cheap on a slow device:
 * nothing on the animated path triggers layout, at any layer.
 *
 * The boundary is narrower than "compositor-only", and saying so matters: some
 * animation here repaints. The legacy `lp2-chip` pulse animates `box-shadow`
 * continuously, and discrete lp4 transitions animate `color` and `background`.
 * Repaint costs a frame; layout costs a frame plus everything downstream of it,
 * and only layout scales badly with page size. So the rules are:
 *   - no layout property is animated anywhere, ever;
 *   - looping lp4 animation is compositor-only (transform/opacity);
 *   - every animated property, looping or not, is on a reviewed allow-list.
 */

/** Properties whose animation forces layout on every frame. */
const LAYOUT_PROPERTIES = [
  "width",
  "min-width",
  "max-width",
  "height",
  "min-height",
  "max-height",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "inset-block",
  "inset-block-start",
  "inset-block-end",
  "inset-inline",
  "inset-inline-start",
  "inset-inline-end",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-inline",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-inline",
  "border-width",
  "border-top-width",
  "border-bottom-width",
  "font-size",
  "line-height",
  "letter-spacing",
  "gap",
  "row-gap",
  "column-gap",
  "flex",
  "flex-basis",
  "grid-template-columns",
  "grid-template-rows",
];

/**
 * Properties this surface is allowed to animate at all. Anything outside the
 * list is either a layout trigger or an unreviewed cost; both must fail.
 */
const ALLOWED_ANIMATED = new Set([
  "transform",
  "opacity",
  "color",
  "background",
  "background-color",
  "background-position",
  "border-color",
  "box-shadow",
  "filter",
  "outline-color",
  "scroll-behavior",
  "transition-duration",
  "animation-duration",
  "none",
]);

function declarations(property) {
  // Capture the value side of every `transition:`/`transition-property:` rule.
  const pattern = new RegExp(`${property}\\s*:\\s*([^;}]+)`, "g");
  return [...css.matchAll(pattern)].map((match) => match[1].trim());
}

test("no transition animates a layout property", () => {
  for (const value of [...declarations("transition"), ...declarations("transition-property")]) {
    for (const property of LAYOUT_PROPERTIES) {
      const animatesLayout = new RegExp(`(^|[\\s,])${property}([\\s,]|$)`).test(value);
      assert.ok(
        !animatesLayout,
        `transition animates the layout property "${property}", which lays out every frame: ${value}`,
      );
    }
    // "all" is worse than naming a layout property: it animates whatever a
    // future edit happens to change.
    assert.ok(!/(^|[\s,])all([\s,]|$)/.test(value), `transition: all is unbounded: ${value}`);
  }
});

/**
 * Extract each @keyframes body by balancing braces. A lazy regex stops at the
 * first "}" and silently swallows the following rule, which made this gate read
 * properties that were never inside the animation.
 */
function keyframeBlocks() {
  const blocks = [];
  const opener = /@keyframes\s+([\w-]+)\s*\{/g;
  let match;
  while ((match = opener.exec(css))) {
    let depth = 1;
    let index = opener.lastIndex;
    while (index < css.length && depth > 0) {
      if (css[index] === "{") depth++;
      else if (css[index] === "}") depth--;
      index++;
    }
    blocks.push([match[0], match[1], css.slice(opener.lastIndex, index - 1)]);
  }
  return blocks;
}

test("no keyframe animation triggers layout", () => {
  const blocks = keyframeBlocks();
  assert.ok(blocks.length > 0, "the landing must define keyframes to check");

  for (const [, name, body] of blocks) {
    const properties = [...body.matchAll(/(^|[{;\s])([a-z-]+)\s*:/g)].map((match) => match[2]);
    for (const property of properties) {
      assert.ok(
        !LAYOUT_PROPERTIES.includes(property),
        `@keyframes ${name} animates the layout property "${property}"`,
      );
    }
  }
});

test("lp4 keyframes are compositor-only", () => {
  // Continuous animation is the expensive case, so the looping lp4 keyframes are
  // held to transform/opacity. Discrete hover and state transitions may repaint —
  // they run once on interaction, not every frame — but must never lay out.
  for (const [, name, body] of keyframeBlocks().filter(([, name]) => name.startsWith("lp4-"))) {
    const properties = [...body.matchAll(/(^|[{;\s])([a-z-]+)\s*:/g)].map((match) => match[2]);
    for (const property of properties) {
      assert.ok(
        ["transform", "opacity"].includes(property),
        `@keyframes ${name} animates "${property}"; looping lp4 animation is compositor-only`,
      );
    }
  }
});

test("every animated property across the surface is on the reviewed list", () => {
  // Transitions.
  for (const value of [...declarations("transition"), ...declarations("transition-property")]) {
    for (const token of value.split(",")) {
      const property = token.trim().split(/\s+/)[0];
      if (!property || /^\d/.test(property) || property.startsWith("var(") || property.startsWith("cubic-bezier")) continue;
      assert.ok(
        ALLOWED_ANIMATED.has(property),
        `transition animates "${property}", which is not on the reviewed animation list: ${value}`,
      );
    }
  }

  // Keyframes, held to the same list — an earlier version of this gate checked
  // transitions only, so a keyframe could animate anything and pass.
  for (const [, name, body] of keyframeBlocks()) {
    for (const [, , property] of body.matchAll(/(^|[{;\s])([a-z-]+)\s*:/g)) {
      assert.ok(
        ALLOWED_ANIMATED.has(property),
        `@keyframes ${name} animates "${property}", which is not on the reviewed animation list`,
      );
    }
  }
});

test("JavaScript animation cadences come from the shared motion module", () => {
  // The card claims no ad-hoc animation constants remain. A component-local
  // interval is exactly that, so the cadence lives in one exported place and
  // this gate keeps it there.
  const scanner = readFileSync(new URL("./scanner-demo.tsx", import.meta.url), "utf8");
  assert.ok(
    scanner.includes("SWEEP_INTERVAL_MS") && scanner.includes('from "./motion"'),
    "scanner-demo must take its cadence from ./motion, not a local literal",
  );
  assert.doesNotMatch(
    scanner,
    /setInterval\([^,]+,\s*\d{3,}\s*\)/,
    "scanner-demo must not pass a numeric literal interval",
  );
});

test("every motion token is used, and no animation hardcodes a duration", () => {
  // Checking a fixed list let --motion-ambient-strip sit unused while the ticker
  // hardcoded its own 112s, so the "no literals" claim was unbacked. Discover
  // the tokens from the file instead: a dead token now fails on its own.
  const declared = [...css.matchAll(/(--motion-[a-z-]+)\s*:/g)].map((match) => match[1]);
  assert.ok(declared.length >= 6, "the motion system must declare its tokens in one place");

  for (const token of new Set(declared)) {
    assert.ok(
      css.split(`var(${token})`).length > 1,
      `${token} is declared but never used — either wire it up or delete it`,
    );
  }

  // Neither animations nor transitions may carry their own timing literals.
  // Checking only `animation:` left every hover, reveal and stagger timing free
  // to restate its own numbers, which is exactly how a "system" decays into a
  // convention nobody follows.
  // Longhands matter as much as shorthands: five literal transition-delay values
  // sat undetected while the gate watched only `animation:` and `transition:`.
  for (const property of [
    "animation",
    "animation-duration",
    "animation-delay",
    "transition",
    "transition-duration",
    "transition-delay",
  ]) {
    for (const [, value] of css.matchAll(new RegExp(`\\b${property}:\\s*([^;}]+)`, "g"))) {
      // 0.01ms is the reduced-motion kill switch, not a design timing: it stops
      // animation while still firing transitionend, so listeners do not hang.
      if (/^0\.01ms\b/.test(value.trim())) continue;
      assert.doesNotMatch(
        value,
        /\b\d+(?:\.\d+)?m?s\b/,
        `${property} hardcodes a timing instead of using a motion token: ${value.trim()}`,
      );
    }
  }

  // Travel distance is part of the contract too — "a documented set of easings,
  // durations and distances". A literal translateY is an undeclared distance.
  for (const [, value] of css.matchAll(/transform:\s*([^;}]*translateY\([^)]*\)[^;}]*)/g)) {
    assert.doesNotMatch(
      value,
      /translateY\(\s*-?\d+(?:\.\d+)?px\s*\)/,
      `transform hardcodes a travel distance instead of using a motion token: ${value.trim()}`,
    );
  }

  // Easing curves belong to the system too: a stray cubic-bezier is a second
  // motion language competing with the first.
  for (const [, value] of css.matchAll(/\btransition:\s*([^;}]+)/g)) {
    assert.doesNotMatch(
      value,
      /cubic-bezier\(/,
      `transition inlines an easing curve instead of using a motion token: ${value.trim()}`,
    );
  }
});
