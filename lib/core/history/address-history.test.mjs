import assert from "node:assert/strict";
import test from "node:test";

import { ScanUnavailable, createAddressHistory, entriesOf, scanBody, scanEndpointOf, scanStats } from "./address-history.ts";

/* CITY-245: the scan finds signatures only, gives a listing whole or not at all, and never says its key. */

const KEY = "0123abcd-4567-89ef-0123-456789abcdef";
const NODE = `https://mainnet.helius-rpc.com/?api-key=${KEY}`;
const sig = (n) => `${"5".repeat(80)}${String(n).padStart(8, "1")}`.replace(/0/gu, "1");
const match = { mints: [{ mint: "So11111111111111111111111111111111111111112", scope: "transaction" }] };

function scripted(pages) {
  const bodies = [];
  const fetch = async (url, init) => {
    bodies.push({ url, body: JSON.parse(init.body) });
    const page = pages[bodies.length - 1];
    if (!page) throw new Error(`no page ${bodies.length}`);
    if (page.status) return new Response(page.text ?? "{}", { status: page.status });
    return new Response(JSON.stringify(page), { status: 200 });
  };
  return { fetch, bodies };
}

const item = (n, slot = 1_000 - n) => ({ signature: sig(n), slot, transactionIndex: 0, blockTime: 1_790_000_000 - n });

test("the scan is the node's own Helius host and key, on mainnet only", () => {
  assert.equal(scanEndpointOf(NODE), `https://mainnet.helius-rpc.com/v1/parsed-events/scan?api-key=${KEY}`);
  assert.equal(scanEndpointOf("https://devnet.helius-rpc.com/?api-key=" + KEY), null);
  assert.equal(scanEndpointOf("https://mainnet.helius-rpc.com/"), null);
  assert.equal(scanEndpointOf("https://solana-rpc.publicnode.com"), null);
  assert.equal(scanEndpointOf("https://api.mainnet-beta.solana.com"), null);
  assert.equal(scanEndpointOf("http://mainnet.helius-rpc.com/?api-key=" + KEY), null);
  assert.equal(scanEndpointOf("https://mainnet.helius-rpc.com.evil.example/?api-key=" + KEY), null);
  assert.equal(scanEndpointOf(""), null);
  assert.equal(scanEndpointOf("not a url"), null);
  assert.equal(createAddressHistory("https://solana-rpc.publicnode.com"), null);
});

test("a request asks for signatures only, newest first, succeeded, with only the fields Helius knows", () => {
  const body = scanBody({ address: "A", match, limit: 300, before: sig(9), time: { gte: 10, lt: 20 } }, null);
  assert.deepEqual(body, {
    address: "A",
    match: { mints: [{ mint: "So11111111111111111111111111111111111111112", scope: "transaction" }] },
    returnShape: "signatures",
    commitment: "confirmed",
    sortOrder: "desc",
    status: "succeeded",
    budget: { maxScannedTransactions: 10_000 },
    time: { gte: 10, lt: 20 },
    beforeSignature: sig(9),
  });
  assert.equal(scanBody({ address: "A", match, limit: 1 }, "460903064:422").paginationToken, "460903064:422");
  assert.equal("limit" in body, false, "limit is ignored for signatures: never sent");
});

test("a page's matches read as a signature list; a malformed one is unreadable, not shorter", () => {
  assert.deepEqual(entriesOf({ data: [item(1)] }), [{ signature: sig(1), slot: 999, blockTime: 1_790_000_000 - 1, err: null, memo: null }]);
  assert.deepEqual(entriesOf({ data: [{ ...item(2), blockTime: null }] })[0].blockTime, null);
  assert.deepEqual(entriesOf({ scan: {} }), []);
  assert.throws(() => entriesOf({ data: [{ slot: 1 }] }), ScanUnavailable);
  assert.throws(() => entriesOf({ data: [{ signature: sig(1) }] }), ScanUnavailable);
  assert.throws(() => entriesOf({ data: "x" }), ScanUnavailable);
});

test("an empty page stopped on the budget is «read on»: the listing follows the cursor to the history's start", async () => {
  const { fetch, bodies } = scripted([
    { data: [item(1), item(2)], paginationToken: "900:1", scan: { stoppedOn: "budget", scannedTransactions: 10_000, creditsCharged: 20 } },
    { data: [], paginationToken: "800:1", scan: { stoppedOn: "budget", scannedTransactions: 10_000, creditsCharged: 20 } },
    { data: [item(3)], scan: { stoppedOn: "windowEnd", scannedTransactions: 120, creditsCharged: 11 } },
  ]);
  const history = createAddressHistory(NODE, { fetch });
  const listing = await history.signatures({ address: "Pool", match, limit: 300 });
  assert.deepEqual(listing.entries.map((entry) => entry.signature), [sig(1), sig(2), sig(3)]);
  assert.equal(listing.whole, true);
  assert.equal(listing.calls, 3);
  assert.equal(listing.credits, 51);
  assert.equal(bodies[1].body.paginationToken, "900:1");
  assert.equal(bodies[2].body.paginationToken, "800:1");
  assert.ok(bodies.every((entry) => entry.url.endsWith(`api-key=${KEY}`)));
});

test("a listing stops at its limit and is then not whole — the next page starts before its last signature", async () => {
  const { fetch } = scripted([{ data: [item(1), item(2), item(3)], paginationToken: "1:1", scan: { stoppedOn: "budget" } }]);
  const listing = await createAddressHistory(NODE, { fetch }).signatures({ address: "Pool", match, limit: 2 });
  assert.deepEqual(listing.entries.map((entry) => entry.signature), [sig(1), sig(2)]);
  assert.equal(listing.whole, false);
});

test("a short list without a cursor is the whole history; the same signature twice is kept once", async () => {
  const { fetch } = scripted([{ data: [item(1), item(1), item(2)], scan: { stoppedOn: "windowEnd" } }]);
  const listing = await createAddressHistory(NODE, { fetch }).signatures({ address: "Pool", match, limit: 1_000 });
  assert.equal(listing.entries.length, 2);
  assert.equal(listing.whole, true);
});

test("a refusal, a 500, a stuck cursor or the end of the time throws — never a short list taken for a whole one", async () => {
  for (const status of [400, 401, 429, 500, 503]) {
    const { fetch } = scripted([{ status }]);
    await assert.rejects(createAddressHistory(NODE, { fetch }).signatures({ address: "Pool", match, limit: 10 }), (error) => error instanceof ScanUnavailable && error.status === status);
  }
  const stuck = scripted([{ data: [], paginationToken: "5:5" }, { data: [], paginationToken: "5:5" }]);
  await assert.rejects(createAddressHistory(NODE, { fetch: stuck.fetch }).signatures({ address: "Pool", match, limit: 10 }), ScanUnavailable);
  const endless = scripted(Array.from({ length: 20 }, (_, n) => ({ data: [], paginationToken: `${n}:0` })));
  await assert.rejects(createAddressHistory(NODE, { fetch: endless.fetch }).signatures({ address: "Pool", match, limit: 10 }), /longer than one listing follows/u);
  let clock = 0;
  const late = scripted([{ data: [item(1)], paginationToken: "1:1" }, { data: [item(2)] }]);
  const timed = createAddressHistory(NODE, { fetch: async (url, init) => ((clock += 10_000), late.fetch(url, init)), now: () => clock });
  await assert.rejects(timed.signatures({ address: "Pool", match, limit: 10, until: 5_000 }), /time ran out/u);
  const failures = scanStats().failures;
  assert.ok(failures >= 8);
});

test("an error never carries the key: a fetch that fails with the URL in its message says the host alone", async () => {
  const history = createAddressHistory(NODE, {
    fetch: async (url) => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    },
  });
  await assert.rejects(history.signatures({ address: "Pool", match, limit: 1 }), (error) => error instanceof ScanUnavailable && !String(error.message).includes(KEY) && String(error.message).includes("mainnet.helius-rpc.com"));
  const bad = createAddressHistory(NODE, { fetch: async () => new Response("<html>", { status: 200 }) });
  await assert.rejects(bad.signatures({ address: "Pool", match, limit: 1 }), (error) => !String(error.message).includes(KEY));
  assert.equal(history.host, "mainnet.helius-rpc.com");
});

test("a cursor is sent alone: the first call's «before» is not repeated beside it", async () => {
  const { fetch, bodies } = scripted([{ data: [item(1)], paginationToken: "9:9" }, { data: [item(2)] }]);
  await createAddressHistory(NODE, { fetch }).signatures({ address: "Pool", match, limit: 10, before: sig(0) });
  assert.equal(bodies[0].body.beforeSignature, sig(0));
  assert.equal(bodies[1].body.paginationToken, "9:9");
  assert.equal("beforeSignature" in bodies[1].body, false);
});

test("a scan that failed rests a minute — its callers page the node at once; a refused query or a caller's own time does not rest it", async () => {
  let clock = 1_000;
  let calls = 0;
  const answers = [{ status: 503 }, { data: [item(1)] }, { status: 400 }, { data: [item(2)] }];
  const history = createAddressHistory(NODE, {
    now: () => clock,
    fetch: async () => {
      const page = answers[calls++];
      return page.status ? new Response("{}", { status: page.status }) : new Response(JSON.stringify(page), { status: 200 });
    },
  });
  await assert.rejects(history.signatures({ address: "Pool", match, limit: 10 }), (error) => error.status === 503);
  await assert.rejects(history.signatures({ address: "Pool", match, limit: 10 }), /rests/u);
  assert.equal(calls, 1, "resting: no request");
  clock += 60_001;
  assert.equal((await history.signatures({ address: "Pool", match, limit: 10 })).entries.length, 1);
  await assert.rejects(history.signatures({ address: "Pool", match, limit: 10 }), (error) => error.status === 400);
  await assert.rejects(history.signatures({ address: "Pool", match, limit: 10, until: clock }), /time ran out/u);
  assert.equal((await history.signatures({ address: "Pool", match, limit: 10 })).entries.length, 1, "neither rested it");
});

test("no request waits past the listing's time: its timeout is the time left", async () => {
  let clock = 0;
  const seen = [];
  const history = createAddressHistory(NODE, {
    now: () => clock,
    fetch: async (_url, init) => {
      seen.push(init.signal);
      return new Response(JSON.stringify({ data: [item(1)] }), { status: 200 });
    },
  });
  await history.signatures({ address: "Pool", match, limit: 10, until: 3_000 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].aborted, false);
});

test("a wait the caller's time cut short, or one address too long to list, does not rest the scan for the others", async () => {
  let clock = 0;
  let calls = 0;
  const history = createAddressHistory(NODE, {
    now: () => clock,
    fetch: async () => {
      calls += 1;
      if (calls === 1) throw new Error("aborted");
      if (calls <= 13) return new Response(JSON.stringify({ data: [], paginationToken: `${calls}:0` }), { status: 200 });
      return new Response(JSON.stringify({ data: [item(1)] }), { status: 200 });
    },
  });
  await assert.rejects(history.signatures({ address: "Pool", match, limit: 10, until: 2_000 }), (error) => error.rests === false);
  await assert.rejects(history.signatures({ address: "Busy", match, limit: 10 }), (error) => error.rests === false && /longer than one listing/u.test(error.message));
  assert.equal((await history.signatures({ address: "Pool", match, limit: 10 })).entries.length, 1, "the scan still answers");
});

