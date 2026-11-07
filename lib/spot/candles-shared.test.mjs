import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { getJson, readSpotCandles, readTokenPoolsBody, resetSpotCandleCaches } from "./candles.server.ts";
import { resetSpotMarketCaches } from "./markets.server.ts";
import { ratePauseLeftMs } from "./shared-reads.ts";

/* CITY-208: the chart and the token page asking for one mint at once are one read of the chart source, and after its 429
   nothing is asked of it until its pause ends. */

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const POOL = "Pool111111111111111111111111111111111111111";

const realFetch = globalThis.fetch;
let gecko = [];
let status = 200;

const poolsBody = {
  data: [
    {
      attributes: { address: POOL, name: "BONK / USDC", reserve_in_usd: "2500000", volume_usd: { h24: "900000" } },
      relationships: { base_token: { data: { id: `solana_${BONK}` } }, quote_token: { data: { id: `solana_${USDC}` } }, dex: { data: { id: "orca" } } },
    },
  ],
};

beforeEach(() => {
  resetSpotCandleCaches();
  resetSpotMarketCaches();
  gecko = [];
  status = 200;
  globalThis.fetch = async (url) => {
    const href = String(url);
    if (!href.startsWith("https://api.geckoterminal.com/")) return new Response("{}", { status: 500 });
    gecko.push(href.replace("https://api.geckoterminal.com/api/v2/networks/solana", ""));
    if (status === 429) return new Response("{}", { status: 429, headers: { "retry-after": "12" } });
    if (href.includes("/ohlcv/")) return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: [] } } }), { status: 200 });
    return new Response(JSON.stringify(poolsBody), { status: 200 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the chart and the page's pools asking for one mint at once read its pools once", async () => {
  const [chart, page] = await Promise.all([readTokenPoolsBody(BONK, "chart"), readTokenPoolsBody(BONK, "page")]);
  assert.equal(chart.ok && page.ok, true);
  assert.equal(gecko.length, 1);
});

test("the same chart opened at once is one read of its pool and one of its candles", async () => {
  const answers = await Promise.all([readSpotCandles(BONK, "1h"), readSpotCandles(BONK, "1h"), readSpotCandles(BONK, "1h")]);
  for (const answer of answers) assert.equal(answer.ok, true);
  assert.deepEqual(gecko.map((path) => path.split("?")[0]), [`/tokens/${BONK}/pools`, `/pools/${POOL}/ohlcv/hour`]);
});

test("after the chart source's 429 nothing is asked of it until the pause ends; a chart read before stays, stated stale", async () => {
  const first = await readSpotCandles(BONK, "1m");
  assert.equal(first.ok && first.stale, false);
  status = 429;
  const refused = await getJson("https://api.geckoterminal.com/api/v2/networks/solana/pools/x/trades");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "RATE_LIMITED");
  assert.ok(ratePauseLeftMs("geckoterminal") > 11_000, "the source's own twelve seconds");
  const asked = gecko.length;
  const paused = await getJson("https://api.geckoterminal.com/api/v2/networks/solana/pools/y/trades");
  assert.equal(paused.ok, false);
  assert.equal(paused.code, "RATE_LIMITED");
  assert.ok(paused.retryAfterMs > 0);
  assert.equal(gecko.length, asked, "no call inside the pause");
});
