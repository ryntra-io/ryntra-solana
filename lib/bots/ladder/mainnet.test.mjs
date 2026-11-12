// Run from repo root: node --test lib/bots/ladder/mainnet.test.mjs
//
// CITY-219 — the ladder on recorded mainnet state, with no network: the engine reads the deepest SOL-USDC DLMM pool as
// mainnet held it on 2026-10-16 (CITY-198's tape, `lib/liquidity/studio/fixtures/dlmm.tape.json.gz`) and builds a
// ladder there with the real Meteora SDK. The chain's simulation is played from the transaction's own instruction —
// the order the program would open — so the engine's judgement of what the person gets is tested both ways. The
// program itself runs in the fork pass (`docs/research/city-219-ladder-mainnet/harness/pass.mjs`, LiteSVM).
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

/* Node without a bundler: the SDK's ESM build imports a directory; the engine takes its CommonJS build, as Next does. */
const sdkRequire = createRequire(import.meta.url);
const DLMM_CJS = pathToFileURL(sdkRequire.resolve("@meteora-ag/dlmm")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@meteora-ag/dlmm") return { url: DLMM_CJS, format: "commonjs", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

import assert from "node:assert/strict";
import test from "node:test";

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

const { buildLadder, chainTerms, ladderPoolOf, readLadderPool } = await import("./build.server.ts");
const { MAINNET_GENESIS } = await import("./connection.server.ts");
const { ladderGate, MAINNET_USDC, WRAPPED_SOL } = await import("./network.ts");
const { checkLadderBundle } = await import("./relay.server.ts");
const { housekeepingIssue, readLadderTransaction } = await import("./tx.ts");
const { inspectDlmmTransaction } = await import("../../solana/limits/dlmm-tx.ts");
const { tokenAccount, ZAP_POOL, zapTapeConnection } = await import("../../liquidity/studio/fixtures/zap-tape.mjs");

const owner = Keypair.generate();
const OWNER = owner.publicKey.toBase58();
const USDC_ATA = getAssociatedTokenAddressSync(new PublicKey(MAINNET_USDC), owner.publicKey, true).toBase58();
const gate = ladderGate({ RYNTRA_BOTS_LADDER_MAINNET: "OPEN" }, "mainnet");
const findPool = async (base, quote) => (base === WRAPPED_SOL && quote === MAINNET_USDC ? ZAP_POOL : null);

/** The tape as mainnet, the person's wallet and USDC on it, and a simulation that opens the order the instruction names. */
function recordedMainnet({ usdc = 500_000_000n, lamports = 2_000_000_000, breakOrder = false } = {}) {
  const wallet = { data: ["", "base64"], executable: false, lamports, owner: "11111111111111111111111111111111", rentEpoch: 0, space: 0 };
  const connection = zapTapeConnection({ [OWNER]: wallet, [USDC_ATA]: tokenAccount(MAINNET_USDC, OWNER, usdc) });
  connection.getGenesisHash = async () => MAINNET_GENESIS;
  connection.simulateTransaction = async (tx) => {
    const legacy = Transaction.from(tx.serialize());
    const place = legacy.instructions.find((ix) => ix.programId.toBase58() === "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" && Buffer.from(ix.data.subarray(0, 8)).toString("hex") === "6cb021ba92e501c5");
    const data = Buffer.from(place.data);
    const isAsk = data[8] === 1;
    const count = data.readUInt32LE(26);
    const bins = Array.from({ length: count }, (_, i) => ({ id: data.readInt32LE(30 + 12 * i), amount: data.readBigUInt64LE(34 + 12 * i) }));
    const account = Buffer.alloc(120 + 32 * count);
    Buffer.from("89b7d45b731d8de3", "hex").copy(account, 0);
    place.keys[0].pubkey.toBuffer().copy(account, 8);
    owner.publicKey.toBuffer().copy(account, 40);
    account.writeUInt16LE(count, 72);
    bins.forEach((bin, i) => {
      account.writeBigUInt64LE(breakOrder && i === 0 ? bin.amount + 1n : bin.amount, 120 + 32 * i);
      account.writeInt32LE(bin.id, 136 + 32 * i);
      account[140 + 32 * i] = isAsk ? 1 : 0;
    });
    const total = bins.reduce((sum, bin) => sum + bin.amount, 0n);
    const priority = 20_000;
    const rent = (120 + 32 * count + 128) * 6_960;
    if (usdc < total) return { context: { slot: 1 }, value: { err: { InstructionError: [2, { Custom: 1 }] }, logs: ["Program log: Error: insufficient funds"], accounts: null } };
    const left = Buffer.from(tokenAccount(MAINNET_USDC, OWNER, usdc - total).data[0], "base64");
    return {
      context: { slot: 1 },
      value: {
        err: null,
        logs: [],
        accounts: [
          { lamports: lamports - 10_000 - priority - rent, data: ["", "base64"], owner: "11111111111111111111111111111111", executable: false, rentEpoch: 0 },
          { lamports: 2_039_280, data: [left.toString("base64"), "base64"], owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", executable: false, rentEpoch: 0 },
          { lamports: rent, data: [account.toString("base64"), "base64"], owner: "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo", executable: false, rentEpoch: 0 },
        ],
      },
    };
  };
  return connection;
}

const keys = () => Array.from({ length: 8 }, () => Keypair.generate().publicKey.toBase58());
const buy = (over = {}) => ({ side: "buy", steps: 4, firstPct: 0.1, lastPct: 0.5, shape: "even", amountRaw: "50000000", ...over });

test("recorded mainnet: the SOL-USDC pool reads as a ladder's pool — USDC-quoted, takes limit orders, its arrays around the price", async () => {
  const connection = recordedMainnet();
  const pool = await readLadderPool(ZAP_POOL, gate.quotes, { connection, network: "mainnet" });
  assert.equal(pool.ok, true, JSON.stringify(pool));
  assert.equal(pool.facts.baseMint, WRAPPED_SOL);
  assert.equal(pool.facts.quoteMint, MAINNET_USDC);
  assert.equal(pool.facts.binStep, 4);
  assert.equal(pool.takesLimitOrders, true);
  assert.ok(pool.activePrice > 50 && pool.activePrice < 500, `SOL at $${pool.activePrice}`);
  const found = await ladderPoolOf(WRAPPED_SOL, gate, { connection, findPool });
  assert.equal(found?.facts.pool, ZAP_POOL);
  assert.equal(await ladderPoolOf("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", gate, { connection, findPool }), null, "a coin with no ladder pool: none");
  assert.deepEqual(await chainTerms(connection, "mainnet"), { rentPerByte: 6_960, priorityLamportsPerTx: 20_000 });
  /* A devnet ladder never reads mainnet. */
  const devnet = await readLadderPool(ZAP_POOL, gate.quotes, { connection, network: "devnet" });
  assert.deepEqual([devnet.ok, devnet.code], [false, "NOT_DEVNET"]);
});

test("recorded mainnet: a buy ladder builds — bins rising, the budget first with mainnet's priority, the wallet pays, nothing else", async () => {
  const connection = recordedMainnet();
  const built = await buildLadder({ owner: OWNER, pool: ZAP_POOL, legs: [buy()], orderKeys: keys(), network: "mainnet", pools: null, quotes: gate.quotes, maxUsd: gate.maxUsd }, { connection, findPool });
  assert.equal(built.ok, true, JSON.stringify(built));
  assert.equal(built.network, "mainnet");
  assert.equal(built.amountUsd, 50);
  assert.equal(built.transactions.length, 1);
  const tx = Transaction.from(Buffer.from(built.transactions[0].wireBase64, "base64"));
  assert.deepEqual(
    tx.instructions.slice(0, 2).map((ix) => [ix.programId.toBase58(), ix.data[0]]),
    [
      ["ComputeBudget111111111111111111111111111111", 2],
      ["ComputeBudget111111111111111111111111111111", 3],
    ],
  );
  const read = readLadderTransaction(built.transactions[0].wireBase64);
  const ids = read.orders[0].data.bins.map((bin) => bin.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "the program takes an order's bins in rising order only");
  assert.ok(ids.every((id) => id < built.pool.facts.activeId), "a buy sits under the price");
  assert.equal(read.feePayer, OWNER);
  assert.deepEqual(read.signers, [OWNER, built.transactions[0].limitOrder]);
  assert.equal(housekeepingIssue(built.transactions[0].wireBase64, OWNER), null);
  /* As the wallet and the order account sign it, the limits lane's own reading lets it through. */
  const order = Keypair.generate();
  const signed = await buildLadder({ owner: OWNER, pool: ZAP_POOL, legs: [buy()], orderKeys: [order.publicKey.toBase58()], network: "mainnet", pools: null, quotes: gate.quotes, maxUsd: gate.maxUsd }, { connection, findPool });
  const exact = VersionedTransaction.deserialize(Buffer.from(signed.transactions[0].wireBase64, "base64"));
  exact.sign([owner, order]);
  const wire = Buffer.from(exact.serialize()).toString("base64");
  assert.equal(inspectDlmmTransaction(wire, { owner: OWNER, kind: "place", limitOrder: order.publicKey.toBase58(), pool: ZAP_POOL }).ok, true);
  assert.deepEqual(checkLadderBundle({ owner: OWNER, kind: "place", items: [{ wireBase64: wire, limitOrder: order.publicKey.toBase58() }], pools: null }), { ok: true });
  /* The line: two signatures and the priority per transaction, the order's rent back on cancel. */
  assert.equal(built.costs.networkLamports, 2 * 5_000 + 20_000);
  assert.equal(built.costs.rentBackLamports, (120 + 32 * 4 + 128) * 6_960);
  assert.equal(built.canDo[0].maxInputRaw, "50000000");
  assert.equal(built.canDo[0].owner, OWNER);
});

test("recorded mainnet: over the cap, another pool, a broken promise, too little USDC — refused before the wallet", async () => {
  const connection = recordedMainnet();
  const over = await buildLadder({ owner: OWNER, pool: ZAP_POOL, legs: [buy({ amountRaw: "150000000" })], orderKeys: keys(), network: "mainnet", pools: null, quotes: gate.quotes, maxUsd: 100 }, { connection, findPool });
  assert.equal(over.code, "OVER_LIMIT");
  const elsewhere = await buildLadder({ owner: OWNER, pool: ZAP_POOL, legs: [buy()], orderKeys: keys(), network: "mainnet", pools: null, quotes: gate.quotes, maxUsd: 100 }, { connection, findPool: async () => Keypair.generate().publicKey.toBase58() });
  assert.equal(elsewhere.code, "POOL_NOT_LISTED");
  const broken = await buildLadder({ owner: OWNER, pool: ZAP_POOL, legs: [buy()], orderKeys: keys(), network: "mainnet", pools: null, quotes: gate.quotes, maxUsd: 100 }, { connection: recordedMainnet({ breakOrder: true }), findPool });
  assert.deepEqual([broken.code, broken.reason.split(":")[0]], ["PROMISE_BROKEN", "ORDER_MISMATCH"]);
  const poor = await buildLadder({ owner: OWNER, pool: ZAP_POOL, legs: [buy()], orderKeys: keys(), network: "mainnet", pools: null, quotes: gate.quotes, maxUsd: 100 }, { connection: recordedMainnet({ usdc: 10_000_000n }), findPool });
  assert.equal(poor.code, "SIMULATION_FAILED");
});
