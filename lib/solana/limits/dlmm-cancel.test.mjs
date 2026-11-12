// Run from repo root: node --test lib/solana/limits/dlmm-cancel.test.mjs
//
// CITY-231 — «Забрати» a DLMM limit order in the trading lane, on recorded mainnet state with no network.
//
// The state: the SOL-USDC pool (bin step 4) as mainnet held it on 2026-10-16 (CITY-198's tape) with, on top, a lane
// order the real Meteora program placed and the market then filled in part — written down by the fork pass
// (`docs/research/city-231-take-back/harness/pass.mjs`, LiteSVM) as `fixtures/dlmm-take-back.state.json.gz`: the order
// account, the pool, its reserves and the bin array as the program left them.
//
// Flaw 1: the SDK's `cancelLimitOrder` (1.9.14) already ends with `close_limit_order_if_empty`; `buildDlmmCancel` added
// a second close after it, which finds the account gone (`AccountOwnedByWrongProgram` on the real program, the fork
// pass shows it) and fails the whole transaction — no order with a bin in it could be taken back.
//
// Found on the way: the SDK reads an order's amounts in whole tokens, the lane's rows count base units — a part-filled
// order made the Hangar's and the reconciler's `BigInt` throw (`rawOfUi`).
import { createRequire, registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

/* Node without a bundler: the SDK's ESM build imports a directory; the lane takes its CommonJS build, as Next does. */
const sdkRequire = createRequire(import.meta.url);
const DLMM_CJS = pathToFileURL(sdkRequire.resolve("@meteora-ag/dlmm")).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@meteora-ag/dlmm") return { url: DLMM_CJS, format: "commonjs", shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const { buildDlmmCancel, listDlmmOrders, rawOfUi } = await import("./dlmm.server.ts");
const { DLMM_DISCRIMINATOR, inspectDlmmTransaction } = await import("./dlmm-tx.ts");
const { DLMM_PROGRAM } = await import("./model.ts");
const { hangarOrders } = await import("../../bots/hangar/orders.ts");
const { buildHangar } = await import("../../bots/hangar/hangar.ts");
const { ZAP_POOL, zapTapeConnection } = await import("../../liquidity/studio/fixtures/zap-tape.mjs");

const DLMM = sdkRequire("@meteora-ag/dlmm");
const STATE = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/dlmm-take-back.state.json.gz", import.meta.url))).toString("utf8"));
const OWNER = STATE.owner;
const ORDER = STATE.order;

/** The tape as mainnet with the fork's part-filled order on it; the chain's simulation keeps what it was shown and lets it pass. */
function recorded(extra = {}) {
  const connection = zapTapeConnection({ ...STATE.accounts, ...extra });
  const shown = [];
  connection.simulateTransaction = async (tx) => {
    shown.push(Transaction.from(tx.serialize()));
    return { context: { slot: 1 }, value: { err: null, logs: [], accounts: null, unitsConsumed: 0 } };
  };
  /* A node's indexed read of the program's accounts, by its filters and slice: the order is the only one recorded. */
  connection.getProgramAccounts = async (programId, config = {}) => {
    const out = [];
    for (const [key, account] of Object.entries({ ...STATE.accounts, ...extra })) {
      if (account.owner !== programId.toBase58()) continue;
      const data = Buffer.from(account.data[0], "base64");
      const match = (config.filters ?? []).every((filter) => {
        if (filter.dataSize !== undefined) return data.length === filter.dataSize;
        const want = Buffer.from(bs58.decode(filter.memcmp.bytes));
        return data.subarray(filter.memcmp.offset, filter.memcmp.offset + want.length).equals(want);
      });
      if (!match) continue;
      const slice = config.dataSlice ? data.subarray(config.dataSlice.offset, config.dataSlice.offset + config.dataSlice.length) : data;
      out.push({ pubkey: new PublicKey(key), account: { data: slice, owner: new PublicKey(account.owner), lamports: account.lamports, executable: false, rentEpoch: 0 } });
    }
    return out;
  };
  return { connection, shown };
}

const discriminators = (transaction) =>
  transaction.instructions.filter((ix) => ix.programId.toBase58() === DLMM_PROGRAM).map((ix) => Buffer.from(ix.data.subarray(0, 8)).toString("hex"));

test("the recorded state: a lane order the program placed and the market filled in part", () => {
  assert.equal(STATE.pool, ZAP_POOL, "the tape's pool");
  assert.equal(STATE.accounts[ORDER].owner, DLMM_PROGRAM);
  assert.ok(BigInt(STATE.convertedRaw) > 0n && BigInt(STATE.waitingRaw) > 0n, "some USDC converted to SOL, some still waiting");
});

test("the SDK's own cancellation already closes the order account (1.9.14): the fact the lane builds on", async () => {
  const { connection } = recorded();
  const dlmm = await DLMM.create(connection, new PublicKey(ZAP_POOL));
  const tx = await dlmm.cancelLimitOrder({ limitOrderPubkey: new PublicKey(ORDER), owner: new PublicKey(OWNER), rentReceiver: new PublicKey(OWNER), binIds: STATE.binIds });
  assert.deepEqual(discriminators(tx), [DLMM_DISCRIMINATOR.cancel, DLMM_DISCRIMINATOR.close], "cancel, then the SDK's own close — if this moves, the lane's builder must move with it");
});

test("«Забрати» a part-filled order: one cancel of its bins, then exactly one close — not two", async () => {
  const { connection, shown } = recorded();
  const built = await buildDlmmCancel({ owner: OWNER, limitOrder: ORDER }, { connection });
  assert.equal(built.ok, true, built.ok ? "" : `${built.code}: ${built.reason}`);
  assert.equal(built.pool, ZAP_POOL);
  const tx = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  assert.deepEqual(discriminators(tx), [DLMM_DISCRIMINATOR.cancel, DLMM_DISCRIMINATOR.close], "one cancel, one close");
  /* The cancel takes back exactly the bins that hold something: `bin_ids` Vec<i32> after the discriminator. */
  const cancel = tx.instructions.find((ix) => ix.programId.toBase58() === DLMM_PROGRAM && Buffer.from(ix.data.subarray(0, 8)).toString("hex") === DLMM_DISCRIMINATOR.cancel);
  const data = Buffer.from(cancel.data);
  assert.deepEqual(Array.from({ length: data.readUInt32LE(8) }, (_, i) => data.readInt32LE(12 + 4 * i)), STATE.binIds);
  /* The close sends the rent to the wallet; the wallet alone pays and signs; SOL comes back unwrapped. */
  const close = tx.instructions.find((ix) => ix.programId.toBase58() === DLMM_PROGRAM && Buffer.from(ix.data.subarray(0, 8)).toString("hex") === DLMM_DISCRIMINATOR.close);
  assert.deepEqual(close.keys.slice(0, 3).map((key) => key.pubkey.toBase58()), [ORDER, OWNER, OWNER]);
  assert.equal(tx.feePayer?.toBase58(), OWNER);
  assert.equal(tx.signatures.length, 1);
  /* What the chain was asked to simulate is what the wallet will sign; the lane's reading of signed bytes lets it through. */
  assert.equal(shown.length, 1);
  assert.deepEqual(discriminators(shown[0]), [DLMM_DISCRIMINATOR.cancel, DLMM_DISCRIMINATOR.close]);
  const read = inspectDlmmTransaction(built.transactionBase64, { owner: OWNER, kind: "cancel", limitOrder: ORDER });
  assert.equal(read.ok, true, read.ok ? "" : read.reason);
});

test("the old composition — the SDK's cancel and a second close — is refused by the lane's own reading: two order instructions", async () => {
  const { connection } = recorded();
  const dlmm = await DLMM.create(connection, new PublicKey(ZAP_POOL));
  const owner = new PublicKey(OWNER);
  const cancel = await dlmm.cancelLimitOrder({ limitOrderPubkey: new PublicKey(ORDER), owner, rentReceiver: owner, binIds: STATE.binIds });
  const close = await dlmm.closeLimitOrderIfEmpty({ limitOrder: new PublicKey(ORDER), owner, rentReceiver: owner });
  const twice = new Transaction({ feePayer: owner, blockhash: cancel.recentBlockhash, lastValidBlockHeight: cancel.lastValidBlockHeight }).add(...cancel.instructions, ...close.instructions);
  const read = inspectDlmmTransaction(twice.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"), { owner: OWNER, kind: "cancel", limitOrder: ORDER });
  assert.equal(read.ok, false);
  assert.match(read.reason, /exactly one order instruction/);
});

test("an order with nothing left in it is only closed: no cancel, one close", async () => {
  /* The recorded order with every bin emptied (amount 0, age 0), as an order whose bins were all taken back. */
  const bytes = Buffer.from(STATE.accounts[ORDER].data[0], "base64");
  for (let i = 0; i < bytes.readUInt16LE(72); i += 1) bytes.fill(0, 120 + 32 * i, 120 + 32 * i + 16);
  const { connection } = recorded({ [ORDER]: { ...STATE.accounts[ORDER], data: [bytes.toString("base64"), "base64"] } });
  const built = await buildDlmmCancel({ owner: OWNER, limitOrder: ORDER }, { connection });
  assert.equal(built.ok, true, built.ok ? "" : `${built.code}: ${built.reason}`);
  const tx = Transaction.from(Buffer.from(built.transactionBase64, "base64"));
  assert.deepEqual(discriminators(tx), [DLMM_DISCRIMINATOR.close]);
  assert.equal(tx.instructions.length, 1, "nothing to wrap or unwrap: only the close");
  assert.equal(inspectDlmmTransaction(built.transactionBase64, { owner: OWNER, kind: "cancel", limitOrder: ORDER }).ok, true);
});

test("another wallet's order: refused before anything is built", async () => {
  const { connection, shown } = recorded();
  const built = await buildDlmmCancel({ owner: Keypair.generate().publicKey.toBase58(), limitOrder: ORDER }, { connection });
  assert.equal(built.ok, false);
  assert.equal(built.code, "NOT_YOURS");
  assert.equal(shown.length, 0);
});

/* ---------------------------------------------------------------- the amounts' units */

test("the SDK's whole-token amounts become base units, exactly", () => {
  assert.equal(rawOfUi("0.144047955", 9), "144047955");
  assert.equal(rawOfUi("15.021753", 6), "15021753");
  assert.equal(rawOfUi("30", 6), "30000000");
  assert.equal(rawOfUi("1e-9", 9), "1", "Decimal writes one lamport this way");
  assert.equal(rawOfUi("2.5e-7", 9), "250");
  assert.equal(rawOfUi("1.5e+3", 6), "1500000000");
  assert.equal(rawOfUi("0", 9), "0");
  assert.equal(rawOfUi("123456789.123456", 6), "123456789123456");
});

/* CITY-233: a form it does not recognise used to read as «0» — an order holding money looked empty. Now it is null. */
test("an amount in a form not recognised is null, never «0»", () => {
  for (const odd of ["not a number", "", ".", "1,5", "-1", "1.2.3", "0x10", "NaN", "Infinity", "1e", "e5", "1 000"]) assert.equal(rawOfUi(odd, 6), null, JSON.stringify(odd));
  assert.equal(rawOfUi(" 30 ", 6), "30000000", "the SDK's spaces aside, a real amount still reads");
});

test("«My orders» and «My bots» do not show an order with an unreadable amount as empty: the read says it could not read", async () => {
  const { connection } = recorded();
  const original = DLMM.getLimitOrdersByUserAndTokenAddress;
  /* The SDK answers one amount in a form the lane does not know (a thousands separator, say). */
  DLMM.getLimitOrdersByUserAndTokenAddress = async (...args) => {
    const byPool = await original.apply(DLMM, args);
    for (const info of byPool.values()) for (const order of info.limitOrders) order.limitOrderData.totalUnfilledAmountY = "15,021753";
    return byPool;
  };
  try {
    const listed = await listDlmmOrders(OWNER, { connection });
    assert.equal(listed.ok, false, "not a row of zeros");
    assert.equal(listed.code, "UNREADABLE_AMOUNT");
    assert.match(listed.reason, /unfilledY/u);
  } finally {
    DLMM.getLimitOrdersByUserAndTokenAddress = original;
  }
  const again = await listDlmmOrders(OWNER, { connection: recorded().connection });
  assert.equal(again.ok, true, "the same order in the SDK's own form reads as before");
});

test("the claim's receipt on «Забрати» writes no claim from an unreadable amount, never a wrong one", () => {
  const source = readFileSync(new URL("./submit.server.ts", import.meta.url), "utf8");
  const claim = source.slice(source.indexOf("claim = await (async () => {"), source.indexOf("})().catch(() => null);"));
  assert.match(claim, /if \(raw === null\) throw new Error\("UNREADABLE_AMOUNT"\);/u, "an unreadable amount stops the claim's reading…");
  assert.match(source, /\}\)\(\)\.catch\(\(\) => null\);/u, "…and a stopped reading is no claim: the order is still taken back");
  assert.doesNotMatch(claim, /BigInt\(rawOfUi\(/u, "never `BigInt` straight over a reading that can be null");
});

test("«My orders» and «My bots» read the part-filled order in base units — the Hangar no longer throws on it", async () => {
  const { connection } = recorded();
  const listed = await listDlmmOrders(OWNER, { connection });
  assert.equal(listed.ok, true, listed.ok ? "" : listed.reason);
  const [row] = listed.orders;
  assert.equal(row.limitOrder, ORDER);
  assert.equal(row.status, "PARTIAL");
  assert.equal(row.isAskSide, false, "a buy: USDC in, SOL out");
  assert.equal(row.depositY, "30000000", "$30 of USDC");
  assert.equal(row.unfilledY, STATE.waitingRaw);
  assert.equal(row.swappedX, STATE.convertedRaw);
  for (const key of ["depositX", "depositY", "unfilledX", "unfilledY", "swappedX", "swappedY", "feeX", "feeY"]) assert.match(row[key], /^\d+$/, `${key} is a count of base units`);
  const hangar = buildHangar({ wallet: OWNER, nowMs: Date.now(), positions: null, grids: [], entries: {}, orders: hangarOrders({ records: [], trigger: [], dlmm: listed.orders }), bundles: [], rules: null, tokens: {} });
  const bot = hangar.bots.find((b) => b.refs.orders?.includes(ORDER));
  assert.ok(bot, "the order is a bot of «My bots»");
  assert.deepEqual([bot.venue, bot.kind, bot.status], ["meteora_dlmm", "limit", "partial"]);
});
