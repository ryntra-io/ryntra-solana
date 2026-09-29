import assert from "node:assert/strict";
import { afterEach, beforeEach } from "node:test";
import test from "node:test";

import { readXStocksAssets, resetXStocksCaches, XSTOCKS_MAX_PAGES } from "./issuer-xstocks.server.ts";

/*
 * `RYN-API-CONTRACT-002` (2026-09-23): the issuer's catalogue grew to 1,026
 * assets on eleven pages while the reader asked for ten, so the eleventh —
 * TSLAx, NVDAx and AAPLx among others — was never read and those stocks left
 * the universe. The catalogue is read to its last page, and a catalogue
 * longer than the ceiling is refused, never cut.
 */
const NVDAX = "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh";
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const mintOf = (index) => `Xs${Array.from({ length: 41 }, (_, position) => ALPHABET[(index * 7 + position * 13) % ALPHABET.length]).join("")}`;

function catalogue(total, lastSaysMore = false) {
  const asked = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    asked.push(page);
    const from = page * 100;
    const nodes = [];
    for (let index = from; index < Math.min(total, from + 100); index += 1) {
      const nvidia = index === total - 2;
      nodes.push({ symbol: nvidia ? "NVDAx" : `S${index}x`, name: nvidia ? "NVIDIA xStock" : `Stock ${index} xStock`, deployments: [{ network: "Solana", address: nvidia ? NVDAX : mintOf(index) }] });
    }
    const hasNextPage = lastSaysMore || from + 100 < total;
    return new Response(JSON.stringify({ nodes, page: { currentPage: page, hasNextPage } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, asked };
}

beforeEach(() => resetXStocksCaches());
afterEach(() => resetXStocksCaches());

test("a catalogue of 1,026 assets on eleven pages is read whole — NVDAx on the last page included", async () => {
  const { fetchImpl, asked } = catalogue(1_026);
  const read = await readXStocksAssets({ fetchImpl });
  assert.equal(read.ok, true);
  assert.equal(read.assets.length, 1_026);
  assert.ok(read.assets.some((asset) => asset.symbol === "NVDAx" && asset.solanaMint === NVDAX), "the eleventh page's NVDAx is in the listing");
  assert.ok(Math.max(...asked) >= 10, "the eleventh page was asked for");
});

test("a catalogue longer than one batch is read on until a page says it is the last", async () => {
  const { fetchImpl } = catalogue(2_345);
  const read = await readXStocksAssets({ fetchImpl });
  assert.equal(read.ok, true);
  assert.equal(read.assets.length, 2_345);
});

test("a catalogue that never ends is refused, never cut at the ceiling", async () => {
  const { fetchImpl, asked } = catalogue(200, true);
  const read = await readXStocksAssets({ fetchImpl });
  assert.equal(read.ok, false);
  assert.match(read.reason, new RegExp(`past ${XSTOCKS_MAX_PAGES} pages`));
  assert.equal(Math.max(...asked), XSTOCKS_MAX_PAGES - 1, "no page past the ceiling was asked for");
});
