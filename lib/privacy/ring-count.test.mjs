import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { RING_PROGRAMS, RELAY_HOST, rpcAllowed } from "./relay.ts";
import { RING_COUNT_KEEP_MS, RING_REGISTRY, RING_SOL_VAULT, USER_RECORD_BYTES, balancesFrom, forgetRingCount, lamportsFrom, readRingCount, ringCountBatch } from "./ring-count.ts";

/* The ring's counter: the SOL in the ring and the private balances, read on the server through Helius
   devnet, kept a minute; a read that fails says «unknown», never zero. */

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const ANSWER = [
  { jsonrpc: "2.0", id: "registry", result: Array.from({ length: 37 }, (_, i) => ({ pubkey: `p${i}`, account: {} })) },
  { jsonrpc: "2.0", id: "vault", result: { context: { slot: 1 }, value: 12_480_000_000 } },
];

function fakeFetch(answer, calls) {
  return async (url, init) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
}

test("the counter reads the ring's SOL vault and the registry's user records, as the SDK names them", () => {
  assert.equal(RING_SOL_VAULT, "CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE", "the vault of PROBE.md, CiNm…pLXE");
  assert.ok(RING_PROGRAMS.has(RING_REGISTRY), "the registry is one of the ring's two programs");
  assert.equal(USER_RECORD_BYTES, 100);
  const [vault, registry] = ringCountBatch();
  assert.deepEqual([vault.method, registry.method], ["getBalance", "getProgramAccounts"]);
  assert.equal(vault.params[0], RING_SOL_VAULT);
  assert.equal(registry.params[0], RING_REGISTRY);
  assert.deepEqual(registry.params[1].dataSlice, { offset: 0, length: 0 }, "records counted without their data");
  assert.deepEqual(registry.params[1].filters, [{ dataSize: 100 }, { memcmp: { offset: 0, bytes: "2" } }], "a user record: 100 bytes, first byte 1");
  assert.ok(rpcAllowed(ringCountBatch()), "nothing the relay would not pass");
  const bundle = read("../../public/privacy/spr-0.9.0-alpha.mjs");
  assert.ok(bundle.includes("wa=Mw(Uint8Array.from([174,9,251,185,56,68,80,105,187,159,161,65,25,120,15,51,227,171,191,213,18,39,39,20,57,237,147,228,185,57,125,253]))"), "the SDK's SOL vault, byte for byte");
  assert.ok(/function QsA\(Q\)\{if\(Q\.length!==X0A\)throw new BQ\("WALLET_INVALID_USER_RECORD"\);let A=new zS\(Q\);if\(A\.u8\(\)!==1\)/.test(bundle) && bundle.includes("X0A=100"), "the SDK's user record: 100 bytes, first byte 1");
});

test("the answer is read by id; anything else is unknown, never zero", () => {
  assert.equal(lamportsFrom(ANSWER), "12480000000");
  assert.equal(balancesFrom(ANSWER), 37);
  assert.equal(balancesFrom([{ id: "registry", result: { context: {}, value: [{}, {}] } }]), 2, "the answer with its context");
  assert.equal(lamportsFrom([{ id: "vault", result: 5 }]), "5");
  for (const bad of [null, {}, [], [{ id: "vault", error: { code: 1 } }], [{ id: "vault", result: { value: -1 } }], [{ id: "vault", result: { value: 1.5 } }], [{ id: "vault", result: { value: "9" } }]]) {
    assert.equal(lamportsFrom(bad), null, JSON.stringify(bad));
    assert.equal(balancesFrom(bad), null, JSON.stringify(bad));
  }
});

test("one batch to Helius devnet with the server's key; kept a minute; without a key nothing is read", async () => {
  forgetRingCount();
  assert.equal(await readRingCount({ key: "", fetchImpl: fakeFetch(ANSWER, []) }), null);
  const calls = [];
  let clock = 1_000_000;
  const now = () => clock;
  const first = await readRingCount({ key: "K", fetchImpl: fakeFetch(ANSWER, calls), now });
  assert.deepEqual(first, { network: "devnet", lamports: "12480000000", balances: 37, readAt: new Date(1_000_000).toISOString() });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.host, RELAY_HOST);
  assert.equal(url.searchParams.get("api-key"), "K");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), ringCountBatch());
  clock += RING_COUNT_KEEP_MS - 1;
  assert.equal(await readRingCount({ key: "K", fetchImpl: fakeFetch(ANSWER, calls), now }), first, "kept");
  assert.equal(calls.length, 1);
  clock += 2;
  await readRingCount({ key: "K", fetchImpl: fakeFetch(ANSWER, calls), now });
  assert.equal(calls.length, 2, "asked again after a minute");
});

test("a failed read keeps the last good one, and with none says unknown", async () => {
  forgetRingCount();
  assert.equal(await readRingCount({ key: "K", fetchImpl: fakeFetch(new Error("down"), []) }), null);
  assert.equal(await readRingCount({ key: "K", fetchImpl: fakeFetch([{ id: "vault", error: {} }], []) }), null);
  let clock = 0;
  const good = await readRingCount({ key: "K", fetchImpl: fakeFetch(ANSWER, []), now: () => clock });
  clock += RING_COUNT_KEEP_MS + 1;
  assert.equal(await readRingCount({ key: "K", fetchImpl: fakeFetch(new Error("down"), []), now: () => clock }), good);
  forgetRingCount();
  const half = await readRingCount({ key: "K", fetchImpl: fakeFetch([ANSWER[1]], []), now: () => clock });
  assert.deepEqual({ lamports: half.lamports, balances: half.balances }, { lamports: "12480000000", balances: null }, "one half read is still a count");
  forgetRingCount();
});

test("the door is a read on the switch's network only, behind the private switch, and keeps the key on the server", () => {
  const route = read("../../app/api/v1/privacy/ring/route.ts");
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.match(route, /const network = openNetwork\(\);\n  if \(!network\) return new NextResponse\(null, \{ status: 404 \}\);/);
  assert.match(route, /readRingCount\(\{ key: relayKey\(network\), network \}\)/, "the network's own key, on the server");
  assert.doesNotMatch(route, /HELIUS_[A-Z_]*API_KEY/);
  assert.match(route, /publicCacheHeaders\(60, 120\)/);
  assert.doesNotMatch(read("./ring-count.ts"), /mainnet/i, "the counter follows the network it is handed, names none");
  assert.doesNotMatch(read("../../terminal/ui/PrivacyBand.tsx"), /helius-rpc|api-key|HELIUS/, "the browser reads Ryntra's door only");
});
