import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ATTRIBUTION_REGISTRY } from "../attribution/registry.ts";
import {
  CLAIM_EVENTS,
  CLAIM_LAYOUTS,
  DAMM_V2_PROGRAM,
  DBC_PROGRAM,
  EVENT_IX_TAG,
  base58Decode,
  base58Encode,
} from "./pool-share.ts";
import { decodeDbcPool, jsonRpc, readSolanaPoolShares, solanaChainReader } from "./pool-share-read.server.ts";

const SAFE = "22BZNVD9FuZPQvGwALBwhopSyxUCTuNNeTW1Lr1KsSvA";
const EXECUTOR = "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU";
const PROTECTED = "33KU1WNMVAXLBuGF1EQAHqWFnrsDevofJnw4VAamiK2G";
const MICRO = "3xh95YxdDBDiR35mWJo4E3hVoXNDqW4hdXemuWwsBD8w";
const DEMO = "GVDLyxgHraJcbmzds6i6hMgb3jSUUhSaHq5XVFnq6AS5";
const STRANGER = "B6gheJ5PL6tpE9V3vQGYA8wLqe3pcFh1fgKf4aPxZh1H";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const COMMUNITY = "Cke6GmukBsgbCLyUx6DoB8wvTCLTz4fBkJ6LjSmjpump";
const CREATOR = "SysvarRent111111111111111111111111111111111";
const POOL_P = "8VtucGA9hvmH8GTVnVRbF5CNNfaLTKie5DyLAEaQJ6e1";
const POOL_M = "AFoxY8SRfJ2SmCYNRWgXsMN27PpJyy2iUk2zGYsrXc7K";
const POOL_D = "9qyVyLMRoCwGxDRscUJ6Ae8QV1vUKoQRy8NZch3XvRaX";
const DAMM = "7UNr1t6DnPb4vwmR72BioSnr5cbatwYWcxHAzawafMtD";
const TOKEN = "So11111111111111111111111111111111111111112";

const disc = (name) => Object.entries(CLAIM_LAYOUTS).find(([, layout]) => layout.name === name)[0];
const eventDisc = (name) => Object.entries(CLAIM_EVENTS).find(([, event]) => event === name)[0];
const u64 = (value) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; };
const pk = (address) => Buffer.from(base58Decode(address));
const ix = (name, ...rest) => base58Encode(Buffer.concat([Buffer.from(disc(name), "hex"), ...rest]));
const ev = (name, ...fields) => base58Encode(Buffer.concat([Buffer.from(EVENT_IX_TAG, "hex"), Buffer.from(eventDisc(name), "hex"), ...fields]));

function curveClaim(signature, { claimer, config, pool, quoteMint = USDC, quote, paidTo = claimer }) {
  return {
    slot: 10, blockTime: Date.parse("2026-10-13T16:00:00Z") / 1000,
    meta: { err: null, postTokenBalances: [{ accountIndex: 1, mint: quoteMint, owner: paidTo }], innerInstructions: [{ index: 0, instructions: [{ programId: DBC_PROGRAM, accounts: ["ea"], data: ev("EvtClaimTradingFee", pk(pool), u64(0), u64(quote)) }] }] },
    transaction: { signatures: [signature], message: { accountKeys: [claimer, "tb"], instructions: [{ programId: DBC_PROGRAM, accounts: ["auth", config, pool, "ta", "tb", "bv", "qv", TOKEN, quoteMint, claimer, "p", "p", "ea", DBC_PROGRAM], data: ix("claim_trading_fee", u64(1), u64(1)) }] } },
  };
}

function lpClaim(signature, quote, { claimer = SAFE, owner = claimer, paidTo = claimer } = {}) {
  return {
    slot: 11, blockTime: Date.parse("2026-10-13T16:05:00Z") / 1000,
    meta: { err: null, postTokenBalances: [{ accountIndex: 1, mint: USDC, owner: paidTo }], innerInstructions: [{ index: 0, instructions: [{ programId: DAMM_V2_PROGRAM, accounts: ["ea"], data: ev("EvtClaimPositionFee", pk(DAMM), pk(POOL_P), pk(owner), u64(9), u64(quote)) }] }] },
    transaction: { signatures: [signature], message: { accountKeys: [{ pubkey: claimer }, { pubkey: "tb" }], instructions: [{ programId: DAMM_V2_PROGRAM, accounts: ["auth", DAMM, POOL_P, "ta", "tb", "va", "vb", TOKEN, USDC, "nft", claimer, "p", "p", "ea", DAMM_V2_PROGRAM], data: ix("claim_position_fee") }] } },
  };
}

function migrationClaim(signature, { claimer, config, pool, fee, flag = 0 }) {
  return {
    slot: 12, blockTime: Date.parse("2026-10-13T16:10:00Z") / 1000,
    meta: { err: null, postTokenBalances: [{ accountIndex: 1, mint: USDC, owner: claimer }], innerInstructions: [{ index: 0, instructions: [{ programId: DBC_PROGRAM, accounts: ["ea"], data: ev("EvtWithdrawMigrationFee", pk(pool), u64(fee), Buffer.from([flag])) }] }] },
    transaction: { signatures: [signature], message: { accountKeys: [claimer, "rcv"], instructions: [{ programId: DBC_PROGRAM, accounts: ["auth", config, pool, "rcv", "qv", USDC, claimer, "p", "ea", DBC_PROGRAM], data: ix("withdraw_migration_fee", Buffer.from([flag])) }] } },
  };
}

function fakeChain({ signatures, transactions, pools, fail = false }) {
  return {
    async signatures(address) {
      if (fail) throw new Error("HTTP 429");
      return signatures[address] ?? [];
    },
    async transaction(signature) { return transactions[signature] ?? null; },
    async dbcPool(address) { return pools[address] ?? null; },
    async decimals(mint) { return mint === USDC ? 6 : 9; },
    async dbcPoolAddress(config, base) { return config === PROTECTED && base === TOKEN ? POOL_P : config === MICRO && base === TOKEN ? POOL_M : `none-${config}`; },
  };
}

const sig = (signature) => ({ signature, err: null, confirmationStatus: "finalized" });

test("Solana: the safe's claims count whole, Micro's three quarters; demo, unregistered and unfinalized write nothing", async () => {
  const read = await readSolanaPoolShares({
    registry: ATTRIBUTION_REGISTRY,
    now: "2026-10-13T17:00:00.000Z",
    chain: fakeChain({
      signatures: { [SAFE]: [sig("s1"), sig("s2"), sig("s5"), sig("s6"), sig("s7")], [EXECUTOR]: [sig("e1"), sig("e2"), { signature: "e3", err: { Custom: 1 } }] },
      transactions: {
        s1: curveClaim("s1", { claimer: SAFE, config: PROTECTED, pool: POOL_P, quote: 47_824 }),
        s2: curveClaim("s2", { claimer: SAFE, config: STRANGER, pool: POOL_P, quote: 5 }),
        s5: lpClaim("s5", 60_000),
        s7: curveClaim("s7", { claimer: SAFE, config: PROTECTED, pool: POOL_P, quote: 3, paidTo: "SomeoneElseDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD" }),
        /* s6 — the finalized commitment does not return it yet. */
        e1: curveClaim("e1", { claimer: EXECUTOR, config: MICRO, pool: POOL_M, quote: 1_000 }),
        e2: curveClaim("e2", { claimer: EXECUTOR, config: DEMO, pool: POOL_D, quote: 273_180 }),
      },
      pools: {
        [POOL_P]: { config: PROTECTED, creator: CREATOR, baseMint: TOKEN },
        [POOL_M]: { config: MICRO, creator: CREATOR, baseMint: TOKEN },
        [POOL_D]: { config: DEMO, creator: CREATOR, baseMint: TOKEN },
      },
    }),
  });
  assert.equal(read.state, "OK");
  const byTx = Object.fromEntries(read.rows.map((row) => [row.claim.tx, row]));
  assert.deepEqual(Object.keys(byTx).sort(), ["e1", "s1", "s5"]);
  assert.equal(byTx.s1.receivedRaw, "47824");
  assert.equal(byTx.s1.usdMicros, "47824");
  assert.equal(byTx.s1.rule, "ALL");
  assert.equal(byTx.s1.creator, CREATOR);
  assert.equal(byTx.e1.claimedRaw, "1000");
  assert.equal(byTx.e1.receivedRaw, "750");
  assert.equal(byTx.e1.rule, "MICRO_REVENUE");
  assert.equal(byTx.s5.source, "lp");
  assert.equal(byTx.s5.pool, POOL_P);
  assert.equal(byTx.s5.venuePool, DAMM);
  assert.equal(byTx.s5.receivedRaw, "60000");
  assert.deepEqual(read.skipped.map((item) => [item.tx, /demo/.test(item.reason) ? "demo" : /registry/.test(item.reason) ? "unregistered" : /does not own/.test(item.reason) ? "not its account" : item.reason]).sort(), [["e2", "demo"], ["s2", "unregistered"], ["s7", "not its account"]]);
  assert.deepEqual(read.pending.map((item) => [item.tx, item.reason]), [["s6", "not finalized yet"]]);
  assert.deepEqual(read.chain.map((claim) => claim.tx).sort(), ["e1", "s1", "s5"]);
});

test("Solana: a community pair is valued at the claim's moment or left unvalued; a failed read is no data", async () => {
  const chain = fakeChain({
    signatures: { [SAFE]: [sig("c1")] },
    transactions: { c1: curveClaim("c1", { claimer: SAFE, config: PROTECTED, pool: POOL_P, quoteMint: COMMUNITY, quote: 2_000_000_000 }) },
    pools: { [POOL_P]: { config: PROTECTED, creator: CREATOR, baseMint: TOKEN } },
  });
  const priced = await readSolanaPoolShares({ registry: ATTRIBUTION_REGISTRY, chain, priceAt: async () => ({ price: "0.25", sourceRef: "test", observedAt: "2026-10-13T16:01:00.000Z" }) });
  assert.equal(priced.rows[0].asset.mint, COMMUNITY);
  assert.equal(priced.rows[0].usdMicros, "500000");
  const unpriced = await readSolanaPoolShares({ registry: ATTRIBUTION_REGISTRY, chain, priceAt: async () => null });
  assert.equal(unpriced.rows[0].usdMicros, null);
  assert.equal(unpriced.rows[0].valuation.basis, "UNVALUED");
  const failed = await readSolanaPoolShares({ registry: ATTRIBUTION_REGISTRY, chain: fakeChain({ signatures: {}, transactions: {}, pools: {}, fail: true }) });
  assert.equal(failed.state, "NO_DATA");
});

test("Solana: the reader asks only for finalized data and decodes a curve account", async () => {
  const calls = [];
  const reader = solanaChainReader(async (method, params) => { calls.push([method, params]); return method === "getSignaturesForAddress" ? [] : null; });
  await reader.signatures(SAFE, null);
  await reader.transaction("x");
  assert.equal(calls[0][1][1].commitment, "finalized");
  assert.equal(calls[1][1][1].commitment, "finalized");
  const data = Buffer.alloc(424);
  pk(PROTECTED).copy(data, 72);
  pk(CREATOR).copy(data, 104);
  pk(TOKEN).copy(data, 136);
  assert.deepEqual(decodeDbcPool(data), { config: PROTECTED, creator: CREATOR, baseMint: TOKEN });
  assert.equal(await reader.dbcPoolAddress(PROTECTED, TOKEN, USDC), await reader.dbcPoolAddress(PROTECTED, TOKEN, USDC));
});

test("Solana, Micro: the executor's position fees count three quarters, its migration fee nothing; the creator's part, a foreign position and a holder's position it collects are skipped", async () => {
  const read = await readSolanaPoolShares({
    registry: ATTRIBUTION_REGISTRY,
    chain: {
      ...fakeChain({
        signatures: { [EXECUTOR]: [sig("m1"), sig("m2"), sig("m3"), sig("h1")], [SAFE]: [sig("f1")] },
        transactions: {
          m1: lpClaim("m1", 1_001, { claimer: EXECUTOR }),
          m2: migrationClaim("m2", { claimer: EXECUTOR, config: MICRO, pool: POOL_M, fee: 8_000_000 }),
          m3: migrationClaim("m3", { claimer: EXECUTOR, config: MICRO, pool: POOL_M, fee: 1, flag: 1 }),
          f1: lpClaim("f1", 5, { owner: EXECUTOR }),
          /* The executor as the holders' collector: it signs, the fees go to the holder's own account. */
          h1: lpClaim("h1", 70_000, { claimer: EXECUTOR, paidTo: "HolderCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" }),
        },
        pools: { [POOL_M]: { config: MICRO, creator: CREATOR, baseMint: TOKEN }, [POOL_P]: { config: PROTECTED, creator: CREATOR, baseMint: TOKEN } },
      }),
      async dbcPoolAddress(config, base) { return config === MICRO && base === TOKEN ? POOL_M : config === PROTECTED && base === TOKEN ? POOL_P : `none-${config}`; },
    },
  });
  assert.equal(read.state, "OK");
  const byTx = Object.fromEntries(read.rows.map((row) => [row.claim.tx, row]));
  assert.deepEqual(Object.keys(byTx).sort(), ["m1", "m2"]);
  assert.equal(byTx.m1.source, "lp");
  assert.equal(byTx.m1.pool, POOL_M);
  assert.equal(byTx.m1.claimedRaw, "1001");
  assert.equal(byTx.m1.receivedRaw, "751");
  assert.equal(byTx.m2.source, "migration");
  assert.equal(byTx.m2.claimedRaw, "8000000");
  assert.equal(byTx.m2.receivedRaw, "0");
  assert.equal(byTx.m2.usdMicros, "0");
  assert.deepEqual(read.skipped.map((item) => item.tx).sort(), ["f1", "h1", "m3"]);
  assert.match(read.skipped.find((item) => item.tx === "h1").reason, /holder/);
});

/* A real v1 transaction (SIMD-0385), as a mainnet node answers it in `jsonParsed` — and the node's rule: a v1
   transaction only to a client that asks for version 1, -32015 to one that asks for less. */
const V1 = JSON.parse(readFileSync(new URL("./fixtures/tx-v1-mainnet-parsed.json", import.meta.url), "utf8"));
function v1Node(signaturesOf) {
  const asked = [];
  const fetchImpl = async (_url, init) => {
    const { id, method, params } = JSON.parse(init.body);
    asked.push({ method, params });
    const reply = (body) => new Response(JSON.stringify({ jsonrpc: "2.0", id, ...body }), { headers: { "content-type": "application/json" } });
    if (method === "getSignaturesForAddress") return reply({ result: signaturesOf(params[0]) });
    if (method === "getTransaction") {
      if (params[0] !== V1.signature) return reply({ result: null });
      if ((params[1].maxSupportedTransactionVersion ?? -1) < V1.result.version) return reply({ error: { code: -32015, message: "Transaction version (1) is not supported by the requesting client." } });
      return reply({ result: V1.result });
    }
    throw new Error(method);
  };
  return { fetchImpl, asked };
}

test("Solana: a v1 transaction in a claimer's history is read — asked for version 0, the node's refusal emptied the whole read", async () => {
  const node = v1Node((address) => (address === EXECUTOR ? [sig(V1.signature)] : []));
  const rpc = jsonRpc("https://node.test", { fetchImpl: node.fetchImpl, attempts: 1 });
  await assert.rejects(rpc("getTransaction", [V1.signature, { encoding: "jsonParsed", commitment: "finalized", maxSupportedTransactionVersion: 0 }]), /not supported/);
  const chain = solanaChainReader(rpc);
  const tx = await chain.transaction(V1.signature);
  assert.equal(tx.version, 1);
  assert.equal(tx.transaction.signatures[0], V1.signature);
  const read = await readSolanaPoolShares({ registry: ATTRIBUTION_REGISTRY, chain, now: "2026-10-25T12:00:00.000Z" });
  assert.equal(read.state, "OK", read.reason);
  assert.deepEqual(read.rows, [], "a transaction that claims nothing writes nothing");
  assert.ok(node.asked.some((call) => call.method === "getTransaction" && call.params[0] === V1.signature && call.params[1].maxSupportedTransactionVersion === 1));
});
