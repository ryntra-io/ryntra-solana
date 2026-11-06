import { test } from "node:test";
import assert from "node:assert/strict";

import { hasNews, useFeedPanel } from "./panel.ts";

test("the bell: the visit's first events are seen, a newer one lights the dot, opening the panel sees it", () => {
  assert.equal(hasNews(null, 5), false, "nothing is news before the first events settle");
  const panel = useFeedPanel.getState();
  panel.settle(5);
  assert.equal(useFeedPanel.getState().seen, 5);
  useFeedPanel.getState().settle(9);
  assert.equal(useFeedPanel.getState().seen, 5, "settling happens once a visit");
  assert.equal(hasNews(useFeedPanel.getState().seen, 9), true);
  useFeedPanel.getState().toggle(9);
  assert.equal(useFeedPanel.getState().open, true);
  assert.equal(hasNews(useFeedPanel.getState().seen, 9), false);
  useFeedPanel.getState().close();
  assert.equal(useFeedPanel.getState().open, false);
});

test("a card without a spark lets its line run into the spark's column (CITY-200)", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../../components/feed/feed.module.css", import.meta.url), "utf8");
  assert.match(css, /\.card:not\(:has\(\.spark\)\) \.line \{\s*grid-column: 2 \/ 4;\s*\}/);
  assert.match(css, /'icon line spark'/, "the spark's column is the line's neighbour it borrows");
  assert.match(css, /\.feed:not\(\[data-open\]\) \.card \.line \{\s*grid-area: line;/, "the collapsed strip keeps its own row");
});
