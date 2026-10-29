import { test } from "node:test";
import assert from "node:assert/strict";

import { BOOK_ROWS, BOOK_STALE_MS, bookStale, depthView } from "./depth.ts";

const BOOK = {
  symbol: "SOL",
  slot: 1,
  asks: [
    { price: 150.1, size: 2 },
    { price: 150.2, size: 3 },
  ],
  bids: [
    { price: 149.9, size: 1 },
    { price: 149.8, size: 4 },
  ],
  observedAt: 1,
};

test("the book's levels as Phoenix sent them, each with the depth up to it against the deeper side", () => {
  const view = depthView(BOOK, "SOL");
  assert.deepEqual(
    view.asks.map((row) => [row.price, row.size, row.total, row.depth]),
    [
      [150.1, 2, 2, 0.4],
      [150.2, 3, 5, 1],
    ],
  );
  assert.deepEqual(
    view.bids.map((row) => [row.price, row.size, row.total, row.depth]),
    [
      [149.9, 1, 1, 0.2],
      [149.8, 4, 5, 1],
    ],
  );
  assert.ok(Math.abs(view.spreadUsd - 0.2) < 1e-9);
  assert.ok(Math.abs(view.spreadPercent - (0.2 / 150) * 100) < 1e-9);
});

test("only the open market's book, only the nearest levels, and no spread where a side is missing or the sides cross", () => {
  assert.deepEqual(depthView(BOOK, "BTC").asks, []);
  assert.deepEqual(depthView(BOOK, "sol").asks.length, 2);
  assert.deepEqual(depthView(null, "SOL"), { asks: [], bids: [], spreadUsd: null, spreadPercent: null });
  const deep = { ...BOOK, asks: Array.from({ length: 30 }, (_, index) => ({ price: 150 + index, size: 1 })) };
  assert.equal(depthView(deep, "SOL").asks.length, BOOK_ROWS);
  const oneSided = depthView({ ...BOOK, bids: [] }, "SOL");
  assert.equal(oneSided.spreadUsd, null);
  assert.equal(oneSided.asks.at(-1).depth, 1);
  assert.equal(depthView({ ...BOOK, bids: [{ price: 151, size: 1 }] }, "SOL").spreadUsd, null);
});

test("the book says it is delayed when the last read failed or came long ago", () => {
  assert.equal(bookStale({ status: "ready", at: 1_000 }, 1_000 + BOOK_STALE_MS), false);
  assert.equal(bookStale({ status: "ready", at: 1_000 }, 1_001 + BOOK_STALE_MS), true);
  assert.equal(bookStale({ status: "failed", at: 1_000 }, 1_000), true);
});
