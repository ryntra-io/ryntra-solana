import assert from "node:assert/strict";
import { test } from "node:test";

import { readWalletHoldings, readWalletHoldingsUntilComplete } from "./holdings.client.ts";

const OWNER = "4MS4RQ3Vj2oYFHJz4EtLyxtq6panVcDUpDyXdoGxfQ1n";

function answers(sequence) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const next = sequence.shift();
    if (next === undefined) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return calls;
}

test("a partial answer is read again until it is whole, every answer reaching the screen on the way", async () => {
  /* Seen on production on 2026-09-12: the Swap card held eight rows for a
     wallet of seventy after one token program failed to answer, and the USDC
     leg had no balance and no MAX. */
  const calls = answers([
    { body: { data: { holdings: [{ kind: "NATIVE_SOL" }], tokenRead: "PARTIAL" } } },
    { body: { data: { holdings: [{ kind: "NATIVE_SOL" }, { kind: "TOKEN", mint: "EPjF" }], tokenRead: "COMPLETE" } } },
  ]);
  const seen = [];
  const last = await readWalletHoldingsUntilComplete({ owner: OWNER, delaysMs: [1, 1], onRead: (read, attempt) => seen.push([attempt, read.ok && read.tokenRead, read.ok && read.rows.length]) });
  assert.deepEqual(seen, [[0, "PARTIAL", 1], [1, "COMPLETE", 2]]);
  assert.equal(last.ok && last.tokenRead, "COMPLETE");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, { owner: OWNER, network: "mainnet" });
});

test("the retries are bounded, and what is still partial after them is returned as partial, never as the wallet", async () => {
  answers([
    { body: { data: { holdings: [], tokenRead: "PARTIAL" } } },
    { body: { data: { holdings: [], tokenRead: "PARTIAL" } } },
    { body: { data: { holdings: [], tokenRead: "PARTIAL" } } },
  ]);
  let reads = 0;
  const last = await readWalletHoldingsUntilComplete({ owner: OWNER, delaysMs: [1, 1], onRead: () => { reads += 1; } });
  assert.equal(reads, 3, "the first read and one per delay");
  assert.equal(last.ok && last.tokenRead, "PARTIAL");
});

test("a refused read stops the loop and says why; an old envelope shape is still read", async () => {
  answers([{ status: 429, body: { error: { code: "RATE_LIMITED", message: "Too many requests." } } }]);
  const refused = await readWalletHoldingsUntilComplete({ owner: OWNER, delaysMs: [1, 1] });
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.code, "RATE_LIMITED");

  answers([{ body: { holdings: [{ kind: "NATIVE_SOL" }] } }]);
  const flat = await readWalletHoldings(OWNER);
  assert.equal(flat.ok && flat.rows.length, 1);
  assert.equal(flat.ok && flat.tokenRead, "COMPLETE", "no word about the read means the route predates the word, which was complete");
});

test("an aborted read returns without asking again", async () => {
  const calls = answers([
    { body: { data: { holdings: [], tokenRead: "PARTIAL" } } },
    { body: { data: { holdings: [], tokenRead: "COMPLETE" } } },
  ]);
  const controller = new AbortController();
  const done = readWalletHoldingsUntilComplete({ owner: OWNER, delaysMs: [50], signal: controller.signal, onRead: () => controller.abort() });
  await done;
  assert.equal(calls.length, 1);
});
