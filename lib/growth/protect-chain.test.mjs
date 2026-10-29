import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { base58Encode } from "./pool-share.ts";
import { FUNDING_MAX_PAGES, readCurveTrades, readFunding, readTransfers } from "./protect-chain.server.ts";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WALLET = "Wa11etxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const FUNDER = "Funderxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const PAYER = "Payerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const CURVE = "Curvexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const sec = (iso) => Date.parse(iso) / 1000;
const TOKEN_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 7);
/* The curve's own vaults, as its account names them (`base_vault` at 168, `quote_vault` at 200). */
const BASE_VAULT_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 40);
const QUOTE_VAULT_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 80);

/** A JSON-RPC that answers from tables: signatures by address (newest first), transactions by signature. */
function rpcOf({ signatures = {}, txs = {}, fail = false }) {
  const calls = [];
  const rpc = async (method, params) => {
    calls.push(method);
    if (fail) throw new Error("HTTP 429");
    if (method === "getSignaturesForAddress") {
      const [address, options] = params;
      const all = signatures[address] ?? [];
      const from = options.before ? all.findIndex((row) => row.signature === options.before) + 1 : 0;
      return all.slice(from, from + options.limit);
    }
    if (method === "getTransaction") return txs[params[0]] ?? null;
    if (method === "getAccountInfo") {
      /* A curve account whose base mint (offset 136) is the test's launch token. */
      const data = Buffer.alloc(424);
      Buffer.from(TOKEN_BYTES).copy(data, 136);
      Buffer.from(BASE_VAULT_BYTES).copy(data, 168);
      Buffer.from(QUOTE_VAULT_BYTES).copy(data, 200);
      return { value: { data: [data.toString("base64"), "base64"] } };
    }
    throw new Error(method);
  };
  return { rpc, calls };
}
const tx = (when, { payer = PAYER, instructions = [], pre = [], post = [] } = {}) => ({
  blockTime: sec(when),
  meta: { err: null, preTokenBalances: pre, postTokenBalances: post, innerInstructions: [] },
  transaction: { message: { accountKeys: [{ pubkey: payer, signer: true }, { pubkey: base58Encode(BASE_VAULT_BYTES) }, { pubkey: base58Encode(QUOTE_VAULT_BYTES) }], instructions } },
});
const transfer = (source, destination) => ({ program: "system", parsed: { type: "transfer", info: { source, destination, lamports: 1 } } });

test("funding: the first incoming transfer names the funder; without one, the fee payer; a failed read is unavailable, never no funder", async () => {
  const { rpc } = rpcOf({
    signatures: { [WALLET]: [{ signature: "late", blockTime: sec("2026-10-10T00:00:00Z"), err: null }, { signature: "first", blockTime: sec("2026-09-01T00:00:00Z"), err: null }] },
    txs: { first: tx("2026-09-01T00:00:00Z", { payer: WALLET, instructions: [transfer(FUNDER, WALLET)] }) },
  });
  assert.deepEqual(await readFunding(rpc, WALLET), { state: "FOUND", funder: FUNDER, firstAt: "2026-09-01T00:00:00.000Z", lastAt: "2026-10-10T00:00:00.000Z" });
  const payerOnly = rpcOf({ signatures: { [WALLET]: [{ signature: "first", blockTime: sec("2026-09-01T00:00:00Z"), err: null }] }, txs: { first: tx("2026-09-01T00:00:00Z") } });
  assert.equal((await readFunding(payerOnly.rpc, WALLET)).funder, PAYER);
  assert.equal((await readFunding(rpcOf({ fail: true }).rpc, WALLET)).state, "UNAVAILABLE");
  assert.equal((await readFunding(rpcOf({}).rpc, WALLET)).state, "EMPTY", "no history read is not a wallet with no funder");
});

test("funding: a history longer than the pages read is deep — a wallet with a life of its own", async () => {
  const many = Array.from({ length: 1000 * FUNDING_MAX_PAGES + 5 }, (_, index) => ({ signature: `s${index}`, blockTime: sec("2026-10-10T00:00:00Z") - index, err: null }));
  const { rpc, calls } = rpcOf({ signatures: { [WALLET]: many } });
  assert.equal((await readFunding(rpc, WALLET)).state, "DEEP");
  assert.equal(calls.filter((call) => call === "getSignaturesForAddress").length, FUNDING_MAX_PAGES);
});

test("transfers: whom a wallet paid and who paid it since a moment", async () => {
  const deposit = "Depositxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const { rpc } = rpcOf({
    signatures: { [WALLET]: [{ signature: "b", blockTime: sec("2026-10-05T00:00:00Z"), err: null }, { signature: "a", blockTime: sec("2026-10-01T00:00:00Z"), err: null }, { signature: "old", blockTime: sec("2026-08-01T00:00:00Z"), err: null }] },
    txs: {
      b: tx("2026-10-05T00:00:00Z", { payer: WALLET, instructions: [{ program: "spl-token", parsed: { type: "transferChecked", info: { authority: WALLET, source: "ata", destination: deposit } } }] }),
      a: tx("2026-10-01T00:00:00Z", { instructions: [transfer(FUNDER, WALLET)] }),
    },
  });
  const read = await readTransfers(rpc, WALLET, "2026-09-15T00:00:00Z");
  assert.deepEqual(read, {
    items: [
      { counterparty: deposit, direction: "out", at: "2026-10-05T00:00:00.000Z" },
      { counterparty: FUNDER, direction: "in", at: "2026-10-01T00:00:00.000Z" },
    ],
    complete: true,
  });
});

const TOKEN = base58Encode(TOKEN_BYTES);
const AUTHORITY = "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM";
const held = (amount) => ({ owner: PAYER, mint: TOKEN, uiTokenAmount: { amount: String(amount), decimals: 6 } });
/* The curve's base vault: what the payer gains, the vault loses. */
const baseVault = (amount) => ({ accountIndex: 1, owner: AUTHORITY, mint: TOKEN, uiTokenAmount: { amount: String(amount), decimals: 6 } });
const quoteVault = (amount) => ({ accountIndex: 2, owner: AUTHORITY, mint: USDC, uiTokenAmount: { amount: String(amount), decimals: 6 } });

test("curve trades: the launch token moving to or from the payer is the trade; the payer's dollars its size; a step that moves no token is no trade", async () => {
  const bal = (amount, token, quote) => [{ owner: PAYER, mint: USDC, uiTokenAmount: { amount: String(amount), decimals: 6 } }, held(token), baseVault(1000 - token), quoteVault(quote)];
  const { rpc } = rpcOf({
    signatures: { [CURVE]: [{ signature: "sell", blockTime: sec("2026-10-03T00:00:00Z"), err: null }, { signature: "buy", blockTime: sec("2026-10-02T00:00:00Z"), err: null }, { signature: "other", blockTime: sec("2026-10-01T12:00:00Z"), err: null }, { signature: "before", blockTime: sec("2026-09-01T00:00:00Z"), err: null }] },
    txs: {
      buy: tx("2026-10-02T00:00:00Z", { pre: bal(10_000_000, 0, 0), post: bal(4_000_000, 900, 6_000_000) }),
      sell: tx("2026-10-03T00:00:00Z", { pre: bal(4_000_000, 900, 6_000_000), post: bal(9_500_000, 0, 500_000) }),
      other: tx("2026-10-01T12:00:00Z", { pre: [held(0), baseVault(10)], post: [held(5), baseVault(5)] }),
    },
  });
  const read = await readCurveTrades(rpc, CURVE, "2026-10-01T00:00:00Z");
  assert.equal(read.complete, true);
  assert.deepEqual(read.trades.map((row) => [row.tx, row.side, row.usdMicros]), [["sell", "sell", 5_500_000n], ["buy", "buy", 6_000_000n], ["other", "buy", null]]);
  const claimOnly = rpcOf({
    signatures: { [CURVE]: [{ signature: "claim", blockTime: sec("2026-10-02T00:00:00Z"), err: null }] },
    txs: { claim: tx("2026-10-02T00:00:00Z", { pre: [{ owner: PAYER, mint: USDC, uiTokenAmount: { amount: "0", decimals: 6 } }], post: [{ owner: PAYER, mint: USDC, uiTokenAmount: { amount: "3000000", decimals: 6 } }] }) },
  });
  assert.deepEqual((await readCurveTrades(claimOnly.rpc, CURVE, "2026-10-01T00:00:00Z")).trades, [], "a fee claim is no sale");
  /* A swap elsewhere that only names the curve: the payer's token moves, the curve's vault does not. */
  const spoof = rpcOf({
    signatures: { [CURVE]: [{ signature: "spoof", blockTime: sec("2026-10-02T00:00:00Z"), err: null }] },
    txs: { spoof: tx("2026-10-02T00:00:00Z", { pre: [held(0), { owner: PAYER, mint: USDC, uiTokenAmount: { amount: "2000000", decimals: 6 } }], post: [held(10), { owner: PAYER, mint: USDC, uiTokenAmount: { amount: "0", decimals: 6 } }] }) },
  });
  assert.deepEqual((await readCurveTrades(spoof.rpc, CURVE, "2026-10-01T00:00:00Z")).trades, [], "no move of the curve's own vault, no curve trade");
  assert.equal(await readCurveTrades(rpcOf({ fail: true }).rpc, CURVE, "2026-10-01T00:00:00Z"), null);
});

test("funding fails closed: failed rows are never the start, a transaction the node does not return is unavailable; deep keeps how far back it read", async () => {
  const spam = Array.from({ length: 5 }, (_, index) => ({ signature: `fail${index}`, blockTime: sec("2026-08-01T00:00:00Z") - index, err: { InstructionError: [0, "Custom"] } }));
  const funded = rpcOf({
    signatures: { [WALLET]: [{ signature: "first", blockTime: sec("2026-09-01T00:00:00Z"), err: null }, ...spam] },
    txs: { first: tx("2026-09-01T00:00:00Z", { payer: WALLET, instructions: [transfer(FUNDER, WALLET)] }) },
  });
  assert.equal((await readFunding(funded.rpc, WALLET)).funder, FUNDER, "five failed transactions before the money do not hide its source");
  const missing = rpcOf({ signatures: { [WALLET]: [{ signature: "first", blockTime: sec("2026-09-01T00:00:00Z"), err: null }] }, txs: {} });
  assert.equal((await readFunding(missing.rpc, WALLET)).state, "UNAVAILABLE");
  const many = Array.from({ length: 1000 * FUNDING_MAX_PAGES }, (_, index) => ({ signature: `s${index}`, blockTime: sec("2026-10-10T00:00:00Z") - index * 60, err: null }));
  const deep = await readFunding(rpcOf({ signatures: { [WALLET]: many } }).rpc, WALLET);
  assert.deepEqual([deep.state, deep.firstAt], ["DEEP", new Date((sec("2026-10-10T00:00:00Z") - (many.length - 1) * 60) * 1000).toISOString()]);
});

test("transfers: token moves name the owners on both sides; a programme's own moves inside a swap are nobody's transfer", async () => {
  const PARTNER_ATA = "PartnerAtaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const VAULT = "Vau1txxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const partnerWallet = "Partnerxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  const usdc = (index, owner) => ({ accountIndex: index, owner, mint: USDC, uiTokenAmount: { amount: "1", decimals: 6 } });
  const sent = {
    blockTime: sec("2026-10-05T00:00:00Z"),
    meta: { err: null, preTokenBalances: [usdc(1, WALLET), usdc(2, partnerWallet)], postTokenBalances: [usdc(1, WALLET), usdc(2, partnerWallet)], innerInstructions: [{ instructions: [{ program: "spl-token", parsed: { type: "transferChecked", info: { authority: WALLET, source: "walletAta", destination: VAULT } } }] }] },
    transaction: { message: { accountKeys: [{ pubkey: WALLET, signer: true }, { pubkey: "walletAta" }, { pubkey: PARTNER_ATA }], instructions: [{ program: "spl-token", parsed: { type: "transferChecked", info: { authority: WALLET, source: "walletAta", destination: PARTNER_ATA } } }] } },
  };
  const { rpc } = rpcOf({ signatures: { [WALLET]: [{ signature: "sent", blockTime: sec("2026-10-05T00:00:00Z"), err: null }] }, txs: { sent } });
  const read = await readTransfers(rpc, WALLET, "2026-09-15T00:00:00Z");
  assert.deepEqual(read.items, [{ counterparty: partnerWallet, direction: "out", at: "2026-10-05T00:00:00.000Z" }]);
  const lost = rpcOf({ signatures: { [WALLET]: [{ signature: "gone", blockTime: sec("2026-10-05T00:00:00Z"), err: null }] }, txs: {} });
  assert.equal(await readTransfers(lost.rpc, WALLET, "2026-09-15T00:00:00Z"), null, "a transaction not returned is a failed read");
});

test("curve trades: a history longer than the cap is read as incomplete", async () => {
  const rows = Array.from({ length: 700 }, (_, index) => ({ signature: `c${index}`, blockTime: sec("2026-10-10T00:00:00Z") - index, err: null }));
  const txs = Object.fromEntries(rows.map((row) => [row.signature, tx(new Date(row.blockTime * 1000).toISOString(), { pre: [held(0), baseVault(5)], post: [held(1), baseVault(4)] })]));
  const read = await readCurveTrades(rpcOf({ signatures: { [CURVE]: rows }, txs }).rpc, CURVE, "2026-09-01T00:00:00Z");
  assert.deepEqual([read.trades.length, read.complete], [600, false]);
});

test("transfers: a failed transaction among the latest is a row read — a history longer than the cap is never whole", async () => {
  const rows = Array.from({ length: 300 }, (_, index) => ({ signature: `t${index}`, blockTime: sec("2026-10-10T00:00:00Z") - index * 60, err: index === 7 ? { InstructionError: [0, "x"] } : null }));
  const txs = Object.fromEntries(rows.map((row) => [row.signature, tx(new Date(row.blockTime * 1000).toISOString())]));
  const read = await readTransfers(rpcOf({ signatures: { [WALLET]: rows }, txs }).rpc, WALLET, "2026-09-01T00:00:00Z");
  assert.equal(read.complete, false);
});

test("curve trades: the curve's own vault gives the side and the dollars, whatever route paid", async () => {
  const vault = (amount) => [{ accountIndex: 2, owner: "FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM", mint: USDC, uiTokenAmount: { amount: String(amount), decimals: 6 } }];
  const { rpc } = rpcOf({
    signatures: { [CURVE]: [{ signature: "solroute", blockTime: sec("2026-10-02T00:00:00Z"), err: null }] },
    txs: { solroute: tx("2026-10-02T00:00:00Z", { pre: [...vault(50_000_000), held(0), baseVault(1000)], post: [...vault(57_500_000), held(800), baseVault(200)] }) },
  });
  const read = await readCurveTrades(rpc, CURVE, "2026-10-01T00:00:00Z");
  assert.deepEqual(read.trades.map((row) => [row.side, row.usdMicros]), [["buy", 7_500_000n]]);
});

test("curve trades: a trade on another curve that only names ours is not ours", async () => {
  const OTHER = base58Encode(Uint8Array.from({ length: 32 }, () => 99));
  const other = (owner, amount) => ({ owner, mint: OTHER, uiTokenAmount: { amount: String(amount), decimals: 6 } });
  const { rpc } = rpcOf({
    signatures: { [CURVE]: [{ signature: "elsewhere", blockTime: sec("2026-10-02T00:00:00Z"), err: null }] },
    txs: { elsewhere: tx("2026-10-02T00:00:00Z", { pre: [other(PAYER, 0), other("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM", 1000)], post: [other(PAYER, 500), other("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM", 500)] }) },
  });
  assert.deepEqual((await readCurveTrades(rpc, CURVE, "2026-10-01T00:00:00Z")).trades, []);
});

/* A real v1 transaction (SIMD-0385) in `jsonParsed`: its payer sends lamports to three accounts in inner instructions. */
const V1 = JSON.parse(readFileSync(new URL("./fixtures/tx-v1-mainnet-parsed.json", import.meta.url), "utf8"));

test("funding: a v1 transaction names its funder — asked for version 0, the node refused it and the read was unavailable", async () => {
  const asked = [];
  const rpc = async (method, params) => {
    if (method === "getSignaturesForAddress") return [{ signature: V1.signature, blockTime: V1.result.blockTime, err: null }];
    if (method === "getTransaction") {
      asked.push(params[1]);
      /* The node's rule, as `jsonRpc` surfaces it: -32015 to a client that asks for less than the transaction's version. */
      if ((params[1].maxSupportedTransactionVersion ?? -1) < V1.result.version) throw new Error("getTransaction: Transaction version (1) is not supported by the requesting client.");
      return V1.result;
    }
    throw new Error(method);
  };
  const at = new Date(V1.result.blockTime * 1000).toISOString();
  assert.deepEqual(await readFunding(rpc, "AHxkYPjFo7jRY7h18sCXcNPxoBLe6hcD4typ7j1xtdd4"), { state: "FOUND", funder: "STKTBd357hAuDCUUvTDRP6t2DYiNJiuQhpkZxDF1Qyq", firstAt: at, lastAt: at });
  assert.equal(asked[0].maxSupportedTransactionVersion, 1);
});
