import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { forgetCovers, keptCovers, serveCover } from "./cover-serve.ts";

/*
 * Found 29.10 (CITY-77): «Відкривається, немає картинок». Every cover came from `assets.agg.market`, which the city's
 * policy does not allow, so the browser refused each one. The city serves AGG's covers from its own origin — those
 * and nothing else.
 */

const COVER = "https://assets.agg.market/events/polymarket/32225/cover/original.webp";
const ask = (u) => new Request(`https://ryntra.io/api/city/predict/cover${u === undefined ? "" : `?u=${encodeURIComponent(u)}`}`);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x10, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
let fetched = [];

beforeEach(() => {
  forgetCovers();
  fetched = [];
});

const upstream = (body, init = {}) => async (url, opts) => {
  fetched.push({ url, redirect: opts?.redirect });
  return new Response(body, { status: 200, ...init });
};

test("an AGG cover is fetched once, never through a redirect, and served as the image it is, kept at the edge", async () => {
  const res = await serveCover(ask(COVER), upstream(WEBP));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.match(res.headers.get("cache-control"), /s-maxage=604800/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(fetched, [{ url: COVER, redirect: "error" }]);
  const again = await serveCover(ask(COVER), upstream(WEBP));
  assert.equal(again.status, 200);
  assert.equal(fetched.length, 1, "kept: the second ask is not fetched again");
});

test("anything but an AGG cover is refused before any fetch", async () => {
  for (const u of [undefined, "", "https://evil.test/a.webp", "https://assets.agg.market/x.webp", "http://assets.agg.market/events/polymarket/1/cover/original.webp", "https://127.0.0.1/events/polymarket/1/cover/original.webp", "https://assets.agg.market/events/polymarket/../cover/original.webp", "https://assets.agg.market/events/polymarket/./cover/original.webp", "https://assets.agg.market.evil.test/events/polymarket/1/cover/original.webp", "https://assets.agg.market@evil.test/events/polymarket/1/cover/original.webp"]) {
    const res = await serveCover(ask(u), upstream(WEBP));
    assert.equal(res.status, 400, String(u));
  }
  assert.equal(fetched.length, 0);
});

test("bytes that are not an image, an oversized answer or a failed one are never handed to the page", async () => {
  assert.equal((await serveCover(ask(COVER), upstream("<html>not an image</html>"))).status, 404);
  forgetCovers();
  assert.equal((await serveCover(ask(COVER), upstream(WEBP, { headers: { "content-length": String(5 * 1024 * 1024) } }))).status, 502);
  forgetCovers();
  assert.equal((await serveCover(ask(COVER), upstream(null, { status: 404 }))).status, 404);
  forgetCovers();
  assert.equal((await serveCover(ask(COVER), async () => { throw new Error("down"); })).status, 502);
});

test("a body that runs past the ceiling without declaring its size is cut off, never read whole", async () => {
  let pulled = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulled++;
      const chunk = new Uint8Array(256 * 1024);
      chunk.set(WEBP);
      controller.enqueue(chunk);
    },
  });
  const res = await serveCover(ask(COVER), upstream(endless));
  assert.equal(res.status, 502);
  assert.ok(pulled <= 10, `read ${pulled} chunks of a quarter megabyte: stopped at the two-megabyte ceiling`);
  assert.equal(keptCovers().entries, 0);
});

test("the covers kept stay under one memory budget: the oldest give way", async () => {
  const big = new Uint8Array(1.5 * 1024 * 1024);
  big.set(WEBP);
  for (let i = 0; i < 60; i++) {
    const u = `https://assets.agg.market/events/polymarket/${i}/cover/original.webp`;
    assert.equal((await serveCover(ask(u), upstream(big))).status, 200);
  }
  const { entries, bytes } = keptCovers();
  assert.ok(bytes <= 48 * 1024 * 1024, `${bytes} bytes kept`);
  assert.ok(entries < 60 && entries > 0, `${entries} covers kept`);
});
