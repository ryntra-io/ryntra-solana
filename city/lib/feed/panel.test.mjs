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
