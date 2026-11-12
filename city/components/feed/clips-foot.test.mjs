// Run from repo root: node --test city/components/feed/clips-foot.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/* CITY-237: the bell's panel is a column that scrolls as a whole. Its list was left to shrink (the strip's `min-height:
   0`), so with more events than the panel is tall the last ones hung out of the list's box and «Clips of this visit»,
   the row after the list, was drawn over them — words over words on ryntra.io. */
test("in the bell's panel the list keeps its height, so «Clips of this visit» stands under the last event", () => {
  const css = readFileSync(new URL("./feed.module.css", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const at = css.indexOf("\n.panel .list {");
  assert.ok(at >= 0);
  assert.match(css.slice(at, css.indexOf("}", at)), /flex: none;/u);
  const clips = css.indexOf("\n.clips {");
  assert.match(css.slice(clips, css.indexOf("}", clips)), /flex: none;/u);
  // The panel itself is what scrolls.
  const panel = css.indexOf("section.feed.panel {");
  assert.match(css.slice(panel, css.indexOf("}", panel)), /overflow-y: auto;/u);
});
