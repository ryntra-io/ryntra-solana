import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALPENGLOW_EPOCH_FIRST_SLOT,
  ALPENGLOW_VOTOR_SLOT,
  BLOCKHASH_COMMITMENT,
  combineAlpenglowReadings,
  commitmentForNewReads,
  fetchAgGenesisCert,
  MAINNET_AG_GENESIS_CERT_SLOT,
  readAgGenesisCertBody,
  readAlpenglow,
} from "./alpenglow.ts";

const CERT = {
  jsonrpc: "2.0",
  id: 1,
  result: {
    block: { slot: ALPENGLOW_VOTOR_SLOT, blockId: "4q1ScaDS6x3diDLCSTrEt6GWVyJ5oHKVCPmMb1LBH9iL" },
    signature: { signature: "AA==", bitmap: [0, 1, 2] },
  },
};

test("null is TowerBFT, a certificate is Alpenglow, -32601 is unknown — never 'not yet'", () => {
  assert.equal(readAgGenesisCertBody({ jsonrpc: "2.0", id: 1, result: null }, "a").state, "TOWER_BFT");
  const certified = readAgGenesisCertBody(CERT, "a");
  assert.equal(certified.state, "ALPENGLOW");
  assert.equal(certified.cert.slot, ALPENGLOW_VOTOR_SLOT);
  const old = readAgGenesisCertBody({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }, "a");
  assert.deepEqual(old, { state: "UNKNOWN", host: "a", reason: "OLD_NODE" });
  assert.equal(readAgGenesisCertBody({ jsonrpc: "2.0", id: 1, error: { code: -32005 } }, "a").state, "UNKNOWN");
  assert.equal(readAgGenesisCertBody({ jsonrpc: "2.0", id: 1 }, "a").state, "UNKNOWN");
  assert.equal(readAgGenesisCertBody("garbage", "a").state, "UNKNOWN");
  /* A certificate naming a slot before epoch 1064 is not a certificate. */
  assert.equal(
    readAgGenesisCertBody({ result: { block: { slot: ALPENGLOW_EPOCH_FIRST_SLOT - 1, blockId: CERT.result.block.blockId } } }, "a").state,
    "UNKNOWN",
  );
});

/* What api.mainnet-beta.solana.com (solana-core 4.3.2) answered on 2026-10-22, byte for byte. */
const LIVE = JSON.parse(readFileSync(new URL("./fixtures/ag-genesis-cert-mainnet.json", import.meta.url), "utf8"));

test("the live mainnet certificate reads as Alpenglow: blockId is 32 bytes as numbers, kept as base58", () => {
  assert.ok(Array.isArray(LIVE.result.block.blockId));
  assert.equal(LIVE.result.block.blockId.length, 32);
  const reading = readAgGenesisCertBody(LIVE, "api.mainnet-beta.solana.com");
  assert.equal(reading.state, "ALPENGLOW");
  assert.equal(reading.cert.slot, MAINNET_AG_GENESIS_CERT_SLOT);
  assert.equal(reading.cert.blockId, "4q1ScaDS6x3diDLCSTrEt6GWVyJ5oHKVCPmMb1LBH9iL");
  /* The block id is Alpenglow's own name for the block, not its blockhash (GAR8EmHh… for slot 459 652 999). */
  assert.notEqual(reading.cert.blockId, "GAR8EmHh83Q6eDuDNNGns2DkNEkYL3DeLHHsitePSFdY");
  assert.equal(commitmentForNewReads(combineAlpenglowReadings([reading])), "finalized");
});

test("a blockId that is not 32 bytes is not a certificate", () => {
  const withBlockId = (blockId) => ({ result: { block: { slot: MAINNET_AG_GENESIS_CERT_SLOT, blockId } } });
  assert.equal(readAgGenesisCertBody(withBlockId(LIVE.result.block.blockId.slice(0, 31)), "a").state, "UNKNOWN");
  assert.equal(readAgGenesisCertBody(withBlockId([...LIVE.result.block.blockId.slice(0, 31), 256]), "a").state, "UNKNOWN");
  assert.equal(readAgGenesisCertBody(withBlockId([...LIVE.result.block.blockId.slice(0, 31), 1.5]), "a").state, "UNKNOWN");
  assert.equal(readAgGenesisCertBody(withBlockId([]), "a").state, "UNKNOWN");
  assert.equal(readAgGenesisCertBody(withBlockId(""), "a").state, "UNKNOWN");
  /* A string is taken only as base58 of exactly 32 bytes. */
  assert.equal(readAgGenesisCertBody(withBlockId("x"), "a").state, "UNKNOWN");
  assert.equal(readAgGenesisCertBody(withBlockId("0OIl"), "a").state, "UNKNOWN");
  assert.equal(readAgGenesisCertBody(withBlockId("4q1ScaDS6x3diDLCSTrEt6GWVyJ5oHKVCPmMb1LBH9iL"), "a").cert.blockId, "4q1ScaDS6x3diDLCSTrEt6GWVyJ5oHKVCPmMb1LBH9iL");
  assert.equal(readAgGenesisCertBody(withBlockId(null), "a").state, "UNKNOWN");
});

test("an old node beside a TowerBFT node is TowerBFT; two old nodes are unknown; any certificate is Alpenglow", () => {
  const tower = { state: "TOWER_BFT", host: "a" };
  const old = { state: "UNKNOWN", host: "b", reason: "OLD_NODE" };
  const glow = readAgGenesisCertBody(CERT, "c");
  assert.equal(combineAlpenglowReadings([tower, old]).state, "TOWER_BFT");
  assert.equal(combineAlpenglowReadings([old, old]).state, "UNKNOWN");
  assert.equal(combineAlpenglowReadings([]).state, "UNKNOWN");
  assert.equal(combineAlpenglowReadings([tower, glow]).state, "ALPENGLOW");
});

test("the blockhash stays on confirmed; new reads take finalized only after the certificate", () => {
  assert.equal(BLOCKHASH_COMMITMENT, "confirmed");
  assert.equal(commitmentForNewReads({ state: "TOWER_BFT" }), "confirmed");
  assert.equal(commitmentForNewReads({ state: "UNKNOWN" }), "confirmed");
  assert.equal(commitmentForNewReads({ state: "ALPENGLOW" }), "finalized");
});

test("raw JSON-RPC over two endpoints, transport failure is unknown", async () => {
  const bodies = new Map([
    ["https://one.example/", { jsonrpc: "2.0", id: 1, result: null }],
    ["https://two.example/", { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }],
  ]);
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(JSON.parse(init.body));
    if (!bodies.has(url)) throw new Error("offline");
    return new Response(JSON.stringify(bodies.get(url)), { status: 200 });
  };
  const verdict = await readAlpenglow(["https://one.example/", "https://two.example/"], { fetchImpl });
  assert.equal(verdict.state, "TOWER_BFT");
  assert.equal(sent[0].method, "getAgGenesisCert");
  assert.equal(sent[0].params, undefined);
  const down = await fetchAgGenesisCert("https://three.example/", { fetchImpl });
  assert.deepEqual(down, { state: "UNKNOWN", host: "three.example", reason: "TRANSPORT" });
});
