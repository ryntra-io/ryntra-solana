import assert from "node:assert/strict";
import test from "node:test";

import { FIELD_PAD_PX, KEYBOARD_MIN_PX, PHONE_QUERY, keyboardInset, raisesKeyboard, scrollForField } from "./typing.ts";

/**
 * The three decisions behind «the keyboard does not cover the field»: whether the focus landing somewhere raises a
 * keyboard at all, how much of the screen it then covers, and how far the page must move so the field stands in what
 * is left. Each has one answer, here, rather than a rule remembered in an effect.
 *
 * The case that put this file here: a sum field at 448…480 px of a 390×480 window, where the keyboard had taken the
 * rest — the field read as «in the viewport» and was under the bottom bar all the same.
 */

const element = (tag, attributes = {}) => ({
  tagName: tag.toUpperCase(),
  disabled: false,
  readOnly: false,
  isContentEditable: false,
  ...attributes,
  getAttribute: (name) => (name === "type" ? (attributes.type ?? null) : null),
});

test("a keyboard rises for what a person types into, and for nothing else", () => {
  assert.equal(raisesKeyboard(element("input")), true, "an input with no type is a text field");
  for (const type of ["text", "search", "email", "tel", "url", "password", "number", "date", "time"]) {
    assert.equal(raisesKeyboard(element("input", { type })), true, type);
  }
  for (const type of ["checkbox", "radio", "range", "color", "file", "hidden", "submit", "button", "image", "reset"]) {
    assert.equal(raisesKeyboard(element("input", { type })), false, type);
  }
  assert.equal(raisesKeyboard(element("textarea")), true);
  assert.equal(raisesKeyboard(element("div", { isContentEditable: true })), true);
  assert.equal(raisesKeyboard(element("button")), false);
  assert.equal(raisesKeyboard(element("select")), false);
  assert.equal(raisesKeyboard(null), false);
  assert.equal(raisesKeyboard(undefined), false);
});

test("a field nobody can type into leaves the bar where it is", () => {
  assert.equal(raisesKeyboard(element("input", { type: "text", disabled: true })), false);
  assert.equal(raisesKeyboard(element("input", { type: "text", readOnly: true })), false);
  assert.equal(raisesKeyboard(element("textarea", { disabled: true })), false);
  assert.equal(raisesKeyboard(element("textarea", { readOnly: true })), false);
  /* A read-only field still shows its value; the page must not jump for it. */
  assert.equal(raisesKeyboard(element("input", { type: "number", readOnly: true })), false);
});

test("what the keyboard covers is read from the visual viewport, never guessed", () => {
  /* The case of the audit: a 390×844 phone whose window the keyboard cut to 480. */
  assert.equal(keyboardInset({ innerHeight: 844, viewHeight: 480, offsetTop: 0 }), 364);
  /* iOS pushes the seen part down instead of shortening the window: both ends count. */
  assert.equal(keyboardInset({ innerHeight: 844, viewHeight: 480, offsetTop: 100 }), 264);
  /* Nothing up: no inset, and never a negative one from a rounding of the browser's own fractions. */
  assert.equal(keyboardInset({ innerHeight: 844, viewHeight: 844, offsetTop: 0 }), 0);
  assert.equal(keyboardInset({ innerHeight: 844, viewHeight: 844.4, offsetTop: 0 }), 0);
  /* A browser's bar folding away is below the threshold; a keyboard is far above it. */
  assert.ok(keyboardInset({ innerHeight: 844, viewHeight: 788, offsetTop: 0 }) < KEYBOARD_MIN_PX);
  assert.ok(keyboardInset({ innerHeight: 844, viewHeight: 480, offsetTop: 0 }) > KEYBOARD_MIN_PX);
});

test("a field under the keyboard is scrolled up to it, with a breath left over", () => {
  /* The audit's field: 448…480 of a window the keyboard cut to 480 — its whole breath gone. */
  const delta = scrollForField({ fieldTop: 448, fieldBottom: 480, visibleTop: 0, visibleBottom: 480 });
  assert.equal(delta, FIELD_PAD_PX, "the field rises until the breath under it is free");
  const after = { top: 448 - delta, bottom: 480 - delta };
  assert.ok(after.bottom + FIELD_PAD_PX <= 480, "and then it stands clear of the keyboard's edge");
  assert.ok(after.top >= 0);
});

test("a field already in sight is left alone — the page does not twitch on every focus", () => {
  assert.equal(scrollForField({ fieldTop: 200, fieldBottom: 240, visibleTop: 0, visibleBottom: 480 }), 0);
  /* Exactly one breath from either edge is in sight. */
  assert.equal(scrollForField({ fieldTop: FIELD_PAD_PX, fieldBottom: 100, visibleTop: 0, visibleBottom: 480 }), 0);
  assert.equal(scrollForField({ fieldTop: 400, fieldBottom: 480 - FIELD_PAD_PX, visibleTop: 0, visibleBottom: 480 }), 0);
});

test("a field above the band is scrolled down to it", () => {
  assert.equal(scrollForField({ fieldTop: 4, fieldBottom: 40, visibleTop: 56, visibleBottom: 480 }), 4 - FIELD_PAD_PX - 56);
  assert.ok(scrollForField({ fieldTop: 4, fieldBottom: 40, visibleTop: 56, visibleBottom: 480 }) < 0, "a negative answer scrolls the page up");
});

test("the band is read where the browser put it, not from the window's top", () => {
  /* iOS: the seen part pushed 120 px down, 480 px of it left. A field at 580…620 is below its bottom edge, though
     the window it was measured in is 844 tall and calls it «in the viewport». */
  const delta = scrollForField({ fieldTop: 580, fieldBottom: 620, visibleTop: 120, visibleBottom: 600 });
  assert.equal(delta, 620 + FIELD_PAD_PX - 600);
  assert.ok(620 - delta + FIELD_PAD_PX <= 600);
  /* Read against the window's top instead, the same field would be left where it is. */
  assert.equal(scrollForField({ fieldTop: 580, fieldBottom: 620, visibleTop: 0, visibleBottom: 844 }), 0);
});

test("a field taller than the band is shown from its top", () => {
  /* A long note in a short window: its bottom can never be reached, so the top is what a person needs. */
  const delta = scrollForField({ fieldTop: 300, fieldBottom: 700, visibleTop: 0, visibleBottom: 300 });
  assert.equal(delta, 300 - FIELD_PAD_PX);
  assert.equal(300 - delta, FIELD_PAD_PX, "its top lands one breath under the band's top edge");
});

test("the bar steps aside only below a desk, where the core draws one", () => {
  assert.equal(PHONE_QUERY, "(max-width: 1023px)");
});
