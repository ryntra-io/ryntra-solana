import assert from "node:assert/strict";
import test from "node:test";

import { navActiveHref, railCurrent } from "./nav-active.ts";

/**
 * The rail's two decisions: which row wins, and what word it says.
 *
 * Both have shipped wrong. The first lit two rows at once, then lit an ancestor
 * as though it were the page. The second — added when Control began opening on
 * Agent Control's decision queue — put `aria-current="page"` on two rows of one
 * nav, and its first fix took the word away from Home. The rule lives in a leaf
 * module so these cases can be asserted rather than remembered.
 */

test("the longest matching href wins, on segment boundaries", () => {
  const hrefs = ["/x/workspace", "/x/workspace/screener", "/x/workspace/pay"];
  assert.equal(navActiveHref("/x/workspace/screener", hrefs), "/x/workspace/screener");
  assert.equal(navActiveHref("/x/workspace/assets/abc", hrefs), "/x/workspace");
  assert.equal(navActiveHref("/x/workspace/payouts", hrefs), "/x/workspace", "a prefix is not a segment");
  assert.equal(navActiveHref("/y", hrefs), null);
});

test("the row that is the page says so, and an ancestor never does", () => {
  const page = railCurrent("/x/send", "/x/send", true);
  assert.deepEqual(page, { current: "page", within: false });

  const ancestor = railCurrent("/x", "/x", false);
  assert.equal(ancestor.current, null, "an ordinary ancestor claims nothing");
  assert.equal(ancestor.within, true, "and is marked as containing the open page");

  const elsewhere = railCurrent("/x/receive", "/x/send", true);
  assert.deepEqual(elsewhere, { current: null, within: false });
});

test("a domain you are standing inside is current without being the page", () => {
  const domain = railCurrent("/x/send", "/x/send", false, { domain: true });
  assert.equal(domain.current, "true", "ARIA's word for the current item of a set");
  assert.equal(domain.within, true);
});

test("a domain yields `page` to the row that is actually the page", () => {
  /* Control opens on `/agents/workspace/attention`, and `Needs a person` points
     at the same URL. Both matched exactly, and both said `page`. */
  const control = railCurrent("/agents/workspace/attention", "/agents/workspace/attention", true, {
    domain: true,
    pageIsInside: true,
  });
  assert.equal(control.current, "true", "the domain steps back");
  assert.equal(control.within, true, "and keeps its filled edge");

  const inside = railCurrent("/agents/workspace/attention", "/agents/workspace/attention", true, {
    pageIsInside: true,
  });
  assert.equal(inside.current, "page", "the page keeps the word");
});

test("a domain with nothing to yield to keeps `page`", () => {
  /* Home is its own landing. The first version of the yield rule counted the
     domains group as "inside", so Home stepped back for itself. */
  const home = railCurrent("/solana/workspace", "/solana/workspace", true, {
    domain: true,
    pageIsInside: false,
  });
  assert.deepEqual(home, { current: "page", within: false });
});
