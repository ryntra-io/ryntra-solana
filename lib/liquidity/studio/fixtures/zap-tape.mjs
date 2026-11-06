/**
 * CITY-198 — the Zap's tests on recorded mainnet state, with no network.
 *
 * The DLMM tape (`dlmm.tape.json.gz`, SOL-USDC bin step 4, recorded 2026-10-16) holds the pool, its reserves and the
 * bin arrays around the price. The Zap SDK reads a little more than the venue's own tests did — the same accounts under
 * other parameters, bin arrays further along the swap's direction, the wallet's own accounts. `zapTapeConnection`
 * answers those from what the tape already holds, account by account; a bin array the tape never saw is answered as an
 * empty one (no liquidity), a wallet's account as absent unless the test hands it in. Every figure the SDK computes
 * stands on the pool's real recorded state.
 *
 * Jupiter is not on the tape: `jupiterBuild` answers `GET /swap/v2/build` the way its live answers are shaped (CITY-183's
 * report §2): a `route_v2` instruction for the taker with the platform fee in slot 10 when asked, its route accounts in
 * one lookup table. Its price is the test's, never the market's.
 */

import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

import { AccountLayout, ACCOUNT_SIZE, createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AddressLookupTableAccount, Keypair, PublicKey } from "@solana/web3.js";

import { replayConnection, TapeMiss } from "../rpc-cassette.ts";
import { DLMM_SCENARIO, dlmmSdkFromCommonJs } from "./scenarios.mjs";

const require = createRequire(import.meta.url);
const BN = require("bn.js");
const DLMM = require("@meteora-ag/dlmm");
const ZAP = require("@meteora-ag/zap-sdk-v2");

export const ZAP_TAPE = JSON.parse(gunzipSync(readFileSync(new URL("./dlmm.tape.json.gz", import.meta.url))).toString("utf8"));
export const ZAP_POOL = DLMM_SCENARIO.pool;
export const SOL = NATIVE_MINT.toBase58();
export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const JUPITER = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const BLOCKHASH = "GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi";

export const ZAP_SDK = { Zap: ZAP.Zap, estimateDlmmDirectSwap: ZAP.estimateDlmmDirectSwap, createDlmmSwapPayload: ZAP.createDlmmSwapPayload, AMOUNT_IN_DLMM_OFFSET: ZAP.AMOUNT_IN_DLMM_OFFSET };
export const ZAP_DLMM_SDK = {
  ...dlmmSdkFromCommonJs(DLMM),
  getBinArraysRequiredByPositionRange: DLMM.getBinArraysRequiredByPositionRange,
  deriveOracle: DLMM.deriveOracle,
  deriveEventAuthority: DLMM.deriveEventAuthority,
  deriveBinArrayBitmapExtension: DLMM.deriveBinArrayBitmapExtension,
};

const rpc = (value) => ({ jsonrpc: "2.0", id: "1", result: { context: { slot: 457726077 }, value } });

/** A token account's data as the chain keeps it, base64 — for the wallet's own accounts a test hands in. */
export function tokenAccount(mint, owner, amount, { native = false, lamports = 2_039_280 } = {}) {
  const data = Buffer.alloc(ACCOUNT_SIZE);
  AccountLayout.encode(
    {
      mint: new PublicKey(mint),
      owner: new PublicKey(owner),
      amount: BigInt(amount),
      delegateOption: 0,
      delegate: PublicKey.default,
      state: 1,
      isNativeOption: native ? 1 : 0,
      isNative: native ? 2_039_280n : 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return { data: [data.toString("base64"), "base64"], executable: false, lamports, owner: TOKEN_PROGRAM_ID.toBase58(), rentEpoch: 0, space: ACCOUNT_SIZE };
}

/**
 * The tape as a connection the Zap SDK can read: the tape's own answers first, then any account the tape holds under
 * other parameters, the test's own accounts, and empty bin arrays the tape never recorded. Anything else misses loudly.
 */
export function zapTapeConnection(extra = {}) {
  const connection = replayConnection(ZAP_TAPE);
  const known = new Map();
  for (const call of ZAP_TAPE.calls) {
    const encoding = call.params?.[1]?.encoding ?? "base64";
    if (encoding !== "base64") continue;
    if (call.method === "getAccountInfo" && call.response?.result?.value) known.set(call.params[0], call.response.result.value);
    if (call.method === "getMultipleAccounts") call.params[0].forEach((k, i) => call.response?.result?.value?.[i] && !known.has(k) && known.set(k, call.response.result.value[i]));
    if (call.method === "getProgramAccounts" && Array.isArray(call.response?.result)) for (const row of call.response.result) if (!known.has(row.pubkey)) known.set(row.pubkey, row.account);
  }
  const program = DLMM.createProgram(connection);
  const pool = new PublicKey(ZAP_POOL);
  const active = ZAP_TAPE.scenario.active;
  const activeIndex = DLMM.binIdToBinArrayIndex(new BN(active)).toNumber();
  const empty = new Map();
  for (let index = activeIndex - 30; index <= activeIndex + 30; index += 1) empty.set(DLMM.deriveBinArray(pool, new BN(index), program.programId)[0].toBase58(), index);
  const template = [...known.values()].find((value) => value.owner === program.programId.toBase58() && Buffer.from(value.data[0], "base64").length > 10_000);
  const emptyBinArray = (index) => {
    const data = Buffer.from(template.data[0], "base64");
    data.writeBigInt64LE(BigInt(index), 8);
    data.fill(0, 56);
    return { ...template, data: [data.toString("base64"), "base64"] };
  };
  const account = (key) => extra[key] ?? known.get(key) ?? (empty.has(key) ? emptyBinArray(empty.get(key)) : null);
  const internals = connection;
  const single = internals._rpcRequest;
  internals._rpcRequest = async (method, args) => {
    if ((method === "getAccountInfo" || method === "getMultipleAccounts") && Object.keys(extra).length) {
      if (method === "getAccountInfo" && extra[args[0]]) return rpc(extra[args[0]]);
      if (method === "getMultipleAccounts" && args[0].some((key) => extra[key])) return rpc(args[0].map(account));
    }
    try {
      return await single(method, args);
    } catch (error) {
      if (!(error instanceof TapeMiss)) throw error;
      if (method === "getAccountInfo") return rpc(account(args[0]));
      if (method === "getMultipleAccounts") return rpc(args[0].map(account));
      if (method === "getLatestBlockhash") return rpc({ blockhash: BLOCKHASH, lastValidBlockHeight: 1_000 });
      if (method === "getMinimumBalanceForRentExemption") return { jsonrpc: "2.0", id: "1", result: Math.ceil(((args[0] + 128) * 3480 * 2) / 1) };
      if (method === "getTokenAccountBalance") {
        const value = account(args[0]);
        if (!value) return { jsonrpc: "2.0", id: "1", error: { code: -32602, message: "could not find account" } };
        const amount = Buffer.from(value.data[0], "base64").readBigUInt64LE(64);
        return rpc({ amount: amount.toString(), decimals: 0, uiAmount: null, uiAmountString: amount.toString() });
      }
      throw error;
    }
  };
  internals._rpcBatchRequest = async (requests) => Promise.all(requests.map((request) => internals._rpcRequest(request.methodName, request.args)));
  return connection;
}

const seeded = (name) => Keypair.fromSeed(createHash("sha256").update(`ryntra-zap-${name}`).digest()).publicKey;

/** The route accounts of the stand-in Jupiter route, and the one lookup table that holds them. */
export const ROUTE_ACCOUNTS = Array.from({ length: 18 }, (_, index) => seeded(`route-${index}`));
export const ROUTE_TABLE = new AddressLookupTableAccount({
  key: seeded("lookup-table"),
  state: { addresses: ROUTE_ACCOUNTS, deactivationSlot: 0xffffffffffffffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0 },
});
const EVENT_AUTHORITY = seeded("jupiter-event-authority");

const ROUTE_V2 = createHash("sha256").update("global:route_v2").digest().subarray(0, 8);

/**
 * `GET /swap/v2/build` answered the way Jupiter shapes it: `outPerIn` is the test's price (output base units per input
 * base unit), the fee comes off the input when `platformFeeBps` and `feeAccount` are asked. `tamper` lets a test make the
 * route pay someone else.
 */
export function jupiterBuild({ outPerIn, tamper = {} }) {
  const asked = [];
  const fetchImpl = async (url) => {
    const query = new URL(String(url)).searchParams;
    asked.push(Object.fromEntries(query.entries()));
    const amount = BigInt(query.get("amount"));
    const slippage = Number(query.get("slippageBps"));
    const feeBps = Number(query.get("platformFeeBps") ?? 0);
    const feeAccount = query.get("feeAccount");
    const taker = new PublicKey(query.get("taker"));
    const inputMint = new PublicKey(query.get("inputMint"));
    const outputMint = new PublicKey(query.get("outputMint"));
    const net = amount - (amount * BigInt(feeBps)) / 10_000n;
    const outAmount = BigInt(Math.floor(Number(net) * outPerIn));
    const threshold = (outAmount * BigInt(10_000 - slippage)) / 10_000n;
    const source = getAssociatedTokenAddressSync(inputMint, taker, true);
    const destination = tamper.destination ?? getAssociatedTokenAddressSync(outputMint, taker, true);
    const data = Buffer.alloc(8 + 8 + 8 + 2 + 2 + 2 + 4);
    ROUTE_V2.copy(data, 0);
    data.writeBigUInt64LE(amount, 8);
    data.writeBigUInt64LE(outAmount, 16);
    data.writeUInt16LE(slippage, 24);
    data.writeUInt16LE(tamper.feeBps ?? feeBps, 26);
    data.writeUInt16LE(tamper.positiveSlippageBps ?? 0, 28);
    const meta = (pubkey, isSigner, isWritable) => ({ pubkey: pubkey.toBase58(), isSigner, isWritable });
    const accounts = [
      meta(taker, true, false),
      meta(source, false, true),
      meta(destination, false, true),
      meta(inputMint, false, false),
      meta(outputMint, false, false),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(tamper.receiver ?? new PublicKey(JUPITER), false, Boolean(tamper.receiver)),
      meta(EVENT_AUTHORITY, false, false),
      meta(new PublicKey(JUPITER), false, false),
      ...(feeAccount ? [meta(new PublicKey(tamper.feeAccount ?? feeAccount), false, true)] : []),
      ...ROUTE_ACCOUNTS.map((key) => meta(key, false, true)),
    ];
    const setup = createAssociatedTokenAccountIdempotentInstruction(taker, getAssociatedTokenAddressSync(outputMint, taker, true), taker, outputMint);
    const body = {
      inputMint: inputMint.toBase58(),
      inAmount: amount.toString(),
      outputMint: outputMint.toBase58(),
      outAmount: outAmount.toString(),
      otherAmountThreshold: threshold.toString(),
      swapMode: "ExactIn",
      slippageBps: slippage,
      priceImpactPct: "0.0001",
      routePlan: [{ swapInfo: { label: "Stand-in AMM", ammKey: ROUTE_ACCOUNTS[0].toBase58(), inputMint: inputMint.toBase58(), outputMint: outputMint.toBase58(), inAmount: net.toString(), outAmount: outAmount.toString() }, percent: 100, bps: 10_000 }],
      computeBudgetInstructions: [],
      setupInstructions: [{ programId: setup.programId.toBase58(), accounts: setup.keys.map((k) => meta(k.pubkey, k.isSigner, k.isWritable)), data: Buffer.from(setup.data).toString("base64") }],
      swapInstruction: { programId: JUPITER, accounts, data: data.toString("base64") },
      cleanupInstruction: null,
      otherInstructions: [],
      addressesByLookupTableAddress: { [ROUTE_TABLE.key.toBase58()]: ROUTE_ACCOUNTS.map((key) => key.toBase58()) },
      blockhashWithMetadata: { blockhash: Array.from(Buffer.alloc(32, 7)), lastValidBlockHeight: 1_000, fetchedAt: { secs_since_epoch: 0, nanos_since_epoch: 0 } },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetchImpl, asked };
}

/** Jupiter refusing: the SDK then takes the pool's own swap. */
export const jupiterDown = async () => new Response("{}", { status: 503 });
