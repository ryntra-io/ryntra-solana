import assert from "node:assert/strict";
import test from "node:test";

import {
  RHJ_BASE_URL,
  RHJ_RATE_LIMIT,
  fetchRhjAssets,
  fetchRhjCorporateActions,
  fetchRhjPrices,
  outcomeSentence,
} from "./client.ts";

const NOW = "2026-08-23T16:00:00.000Z";
const now = () => NOW;

/** The literal sentence api.robinhood.com returned to this environment on 2026-08-23. */
const BLOCKED_BODY =
  "Your request has been blocked due to originating from a jurisdiction restricted by US sanctions. " +
  "Please contact Robinhood support for more information.";

function respondWith(status, body, record) {
  return async function (url, init) {
    if (record) record.push({ url, hasSignal: init.signal instanceof AbortSignal });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": typeof body === "string" ? "text/plain" : "application/json" },
    });
  };
}

test("the three endpoints are addressed exactly as the provider documents them", function () {
  assert.equal(RHJ_BASE_URL, "https://api.robinhood.com/rhj");
  assert.equal(RHJ_RATE_LIMIT, 60);
});

test("a 200 parses and reports the read as permitted", async function () {
  const calls = [];
  const read = await fetchRhjAssets({
    now,
    fetcher: respondWith(
      200,
      {
        assets: [
          {
            id: "0x" + "a".repeat(64),
            tokenSymbol: "AAPL",
            tokenName: "Apple • Robinhood Token",
            deployments: [{ contractAddress: "0xaF3D", chainId: 4663 }],
            currentMultiplier: "1.0",
            pendingMultiplier: "",
            status: "ASSET_STATUS_ACTIVE",
          },
        ],
      },
      calls,
    ),
  });
  assert.equal(read.outcome.ok, true);
  assert.equal(read.outcome.httpStatus, 200);
  assert.equal(read.outcome.dataRightsState, "PUBLIC_READ");
  assert.equal(read.rows.length, 1);
  assert.equal(read.rows[0].identity.dataRightsState, "PUBLIC_READ");
  assert.equal(calls[0].url, "https://api.robinhood.com/rhj/assets");
  assert.equal(calls[0].hasSignal, true, "every read must be bounded by a timeout");
});

test("the 403 this environment actually receives is carried as the venue's own answer", async function () {
  /*
   * Probed 2026-08-23: all three endpoints answered 403 with this sentence,
   * while docs.robinhood.com and rpc.mainnet.chain.robinhood.com answered 200
   * in the same session. It is the venue deciding, and it is shown as it came
   * back rather than predicted, simulated or routed around.
   */
  for (const read of [
    await fetchRhjAssets({ now, fetcher: respondWith(403, BLOCKED_BODY) }),
    await fetchRhjPrices("AAPL", { now, fetcher: respondWith(403, BLOCKED_BODY) }),
    await fetchRhjCorporateActions({ now, fetcher: respondWith(403, BLOCKED_BODY) }),
  ]) {
    assert.equal(read.outcome.ok, false);
    assert.equal(read.outcome.httpStatus, 403);
    assert.equal(read.outcome.dataRightsState, "JURISDICTION_BLOCKED");
    assert.equal(read.outcome.providerMessage, BLOCKED_BODY, "the provider's words must survive verbatim");
    assert.deepEqual(read.rows, [], "a blocked source yields no rows, and certainly no invented ones");
    assert.equal(outcomeSentence(read.outcome), BLOCKED_BODY);
  }
});

test("a jurisdiction block is never described as a temporary outage", function () {
  const outcome = {
    surfaceId: "rhj-assets",
    url: RHJ_BASE_URL + "/assets",
    ok: false,
    httpStatus: 403,
    dataRightsState: "JURISDICTION_BLOCKED",
    providerMessage: BLOCKED_BODY,
    reason: null,
    receivedAt: NOW,
  };
  const sentence = outcomeSentence(outcome);
  /* A reader told "unavailable" retries; a reader told the venue refused this
     jurisdiction does not. The two must not be worded the same. */
  assert.doesNotMatch(sentence, /try again|temporar|outage|retry/i);
  assert.match(sentence, /jurisdiction/i);
});

test("no code path offers a way around the block", async function () {
  /* Both Robinhood and Arcus prohibit masking. There is no proxy option to
     reach for, and this asserts the absence rather than trusting it. */
  const source = await import("node:fs").then(function (fs) {
    return fs.readFileSync(new URL("./client.ts", import.meta.url), "utf8");
  });
  for (const forbidden of ["proxy", "vpn", "x-forwarded-for", "cf-connecting-ip"]) {
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\//g, ""),
      new RegExp(forbidden, "i"),
      "client.ts references " + forbidden,
    );
  }
});

test("429 is rate-limited and anything else is unavailable, each kept apart", async function () {
  const limited = await fetchRhjPrices("AAPL", { now, fetcher: respondWith(429, "slow down") });
  assert.equal(limited.outcome.dataRightsState, "RATE_LIMITED");

  const broken = await fetchRhjPrices("AAPL", { now, fetcher: respondWith(500, "") });
  assert.equal(broken.outcome.dataRightsState, "UNAVAILABLE");
  assert.match(broken.outcome.reason, /HTTP 500/);
});

test("a network failure names what happened and invents nothing", async function () {
  const read = await fetchRhjAssets({
    now,
    fetcher: async function () { throw new Error("ENOTFOUND api.robinhood.com"); },
  });
  assert.equal(read.outcome.ok, false);
  assert.equal(read.outcome.httpStatus, null);
  assert.equal(read.outcome.dataRightsState, "UNAVAILABLE");
  assert.match(read.outcome.reason, /ENOTFOUND/);
  assert.deepEqual(read.rows, []);
});

test("a 200 that is not JSON fails closed rather than rendering as empty", async function () {
  const read = await fetchRhjAssets({ now, fetcher: respondWith(200, "<html>maintenance</html>") });
  assert.equal(read.outcome.ok, false);
  assert.match(read.outcome.reason, /not JSON/);
});

test("the per-symbol form is used and the symbol is encoded", async function () {
  const calls = [];
  await fetchRhjPrices("BRK B", { now, fetcher: respondWith(200, { quotes: [] }, calls) });
  assert.equal(calls[0].url, "https://api.robinhood.com/rhj/prices/BRK%20B");

  const all = [];
  await fetchRhjPrices(null, { now, fetcher: respondWith(200, { quotes: [] }, all) });
  assert.equal(all[0].url, "https://api.robinhood.com/rhj/prices");
});

test("an oversized provider message is bounded before it reaches a surface", async function () {
  const read = await fetchRhjAssets({ now, fetcher: respondWith(403, "x".repeat(5000)) });
  assert.ok(read.outcome.providerMessage.length <= 401);
  assert.ok(read.outcome.providerMessage.endsWith("…"));
});
