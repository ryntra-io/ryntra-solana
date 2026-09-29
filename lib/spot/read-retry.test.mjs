import { test } from "node:test";
import assert from "node:assert/strict";

import { spotListNoticeVisible, spotListReadIncomplete, spotReadRetryDelayMs } from "./read-retry.ts";

test("spot read retry: quick at first, steady after, never zero", () => {
  assert.equal(spotReadRetryDelayMs(1), 2_500);
  assert.equal(spotReadRetryDelayMs(2), 6_000);
  assert.equal(spotReadRetryDelayMs(3), 12_000);
  assert.equal(spotReadRetryDelayMs(4), 20_000);
  assert.equal(spotReadRetryDelayMs(40), 20_000);
  assert.equal(spotReadRetryDelayMs(0), 2_500);
  assert.equal(spotReadRetryDelayMs(Number.NaN), 2_500);
});

test("spot read retry: the unavailable note waits for the quick retries to fail", () => {
  assert.equal(spotListNoticeVisible(undefined), false);
  assert.equal(spotListNoticeVisible(1), false);
  assert.equal(spotListNoticeVisible(2), false);
  assert.equal(spotListNoticeVisible(3), true);
});

test("spot read retry: an empty category from a partial read is a failed read, an empty All or search is not", () => {
  assert.equal(spotListReadIncomplete({ view: "stock", searching: false, partial: true, rowCount: 0 }), true);
  assert.equal(spotListReadIncomplete({ view: "stock", searching: false, partial: true, rowCount: 4 }), false);
  assert.equal(spotListReadIncomplete({ view: "stock", searching: false, partial: false, rowCount: 0 }), false);
  assert.equal(spotListReadIncomplete({ view: "all", searching: false, partial: true, rowCount: 0 }), false);
  assert.equal(spotListReadIncomplete({ view: "stock", searching: true, partial: true, rowCount: 0 }), false);
  assert.equal(spotListReadIncomplete({ view: "watchlist", searching: false, partial: true, rowCount: 0 }), false);
});
