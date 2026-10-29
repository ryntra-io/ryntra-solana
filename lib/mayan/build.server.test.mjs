import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { addresses as MAYAN_ADDRESSES } from "@mayanfinance/swap-sdk";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

import { buildSolanaSwiftTransaction } from "./build.server.ts";
import { JUPITER_V6_PROGRAM_ID, MAYAN_CPI_PROXY_PROGRAM_ID, MAYAN_SWIFT_V2_PROGRAM_ID } from "./solana-swift-guard.ts";

/**
 * FIX-XSWAP-1 (SEC-1 P1): the builder decides what a wallet is asked to sign,
 * and Mayan's API decides half of it. Every case below hands the builder an
 * SDK answer or a quote that looks ordinary and is not, and asserts that no
 * bytes come back. The SDK itself is replaced: nothing here reaches Mayan or a
 * cluster.
 */

const fixture = JSON.parse(readFileSync(new URL("./fixtures/price-api-quote-sol-to-base-usdc.json", import.meta.url), "utf8"));
const SWIFT = fixture.quotes.find((quote) => quote.type === "SWIFT");
const OWNER = Keypair.generate().publicKey;
const DESTINATION = "0x000000000000000000000000000000000000dEaD";
const EXPECTED = {
  fromChain: "solana",
  fromToken: "0x0000000000000000000000000000000000000000",
  toChain: "base",
  toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amountInRaw: "100000000",
};
const ATA = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const MEMO = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

const proxied = (programId, keys = []) =>
  new TransactionInstruction({
    programId: new PublicKey(MAYAN_CPI_PROXY_PROGRAM_ID),
    keys: [{ pubkey: programId, isSigner: false, isWritable: false }, { pubkey: OWNER, isSigner: true, isWritable: true }, ...keys],
    data: Buffer.from([1]),
  });

/** The shape `createSwiftFromSolanaInstructions` returns for SOL into Base USDC: a Jupiter leg, then `init_order`. */
function honestInstructions() {
  return [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30_000 }),
    proxied(ATA),
    proxied(SystemProgram.programId),
    proxied(TOKEN),
    new TransactionInstruction({ programId: new PublicKey(JUPITER_V6_PROGRAM_ID), keys: [{ pubkey: OWNER, isSigner: true, isWritable: true }], data: Buffer.from([2]) }),
    proxied(TOKEN),
    proxied(new PublicKey(MAYAN_SWIFT_V2_PROGRAM_ID), [{ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }]),
  ];
}

function build({ quote = SWIFT, expected = EXPECTED, instructions = honestInstructions(), calls = { count: 0 } } = {}) {
  return buildSolanaSwiftTransaction({
    quote,
    owner: OWNER.toBase58(),
    destination: DESTINATION,
    rpcUrl: "http://127.0.0.1:1",
    expected,
    deps: {
      createInstructions: async () => {
        calls.count += 1;
        return { instructions, lookupTables: [], signers: [] };
      },
      latestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1_000 }),
    },
  });
}

test("the pinned program ids are the ones SDK 15.2.2 writes", () => {
  assert.equal(MAYAN_SWIFT_V2_PROGRAM_ID, MAYAN_ADDRESSES.SWIFT_V2_PROGRAM_ID);
  assert.equal(MAYAN_CPI_PROXY_PROGRAM_ID, MAYAN_ADDRESSES.CPI_PROXY_PROGRAM_ID);
});

test("an honest Swift order is built, and says what to simulate", async () => {
  const result = await build();
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.requiredSignatures, 1);
  assert.equal(result.staticAccounts[0], OWNER.toBase58());
  assert.ok(result.writableAccounts.includes(OWNER.toBase58()), "the wallet's own post-state is asked for");
  assert.equal(result.nativeInput, true);
  assert.equal(result.inputMint, "So11111111111111111111111111111111111111112");
  assert.equal(result.amountInRaw, SWIFT.effectiveAmountIn64);
});

/* ── Attack: a third-party program ────────────────────────────────────────── */

test("an API answer that adds a third-party program is refused, and no bytes come back", async () => {
  const thief = new TransactionInstruction({ programId: Keypair.generate().publicKey, keys: [{ pubkey: OWNER, isSigner: true, isWritable: true }], data: Buffer.from([9]) });
  const result = await build({ instructions: [...honestInstructions(), thief] });
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNEXPECTED_PROGRAM");
  assert.equal(result.unsignedWireBase64, undefined);
});

test("an API answer that slips in a bare Token transfer from the wallet is refused", async () => {
  const transfer = new TransactionInstruction({
    programId: TOKEN,
    keys: [{ pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, { pubkey: Keypair.generate().publicKey, isSigner: false, isWritable: true }, { pubkey: OWNER, isSigner: true, isWritable: false }],
    data: Buffer.from([3, 1, 0, 0, 0, 0, 0, 0, 0]),
  });
  assert.equal((await build({ instructions: [...honestInstructions(), transfer] })).code, "UNEXPECTED_PROGRAM");
});

test("the proxy forwarding to a program a Swift order does not need — Memo among them — is refused", async () => {
  assert.equal((await build({ instructions: [...honestInstructions(), proxied(MEMO)] })).code, "UNEXPECTED_PROGRAM");
  assert.equal((await build({ instructions: [...honestInstructions(), proxied(Keypair.generate().publicKey)] })).code, "UNEXPECTED_PROGRAM");
});

/* ── Attack: another token, another network ───────────────────────────────── */

test("a quote that pays out another token is refused before the SDK runs", async () => {
  const calls = { count: 0 };
  const swapped = { ...SWIFT, toToken: { ...SWIFT.toToken, contract: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed" } };
  const result = await build({ quote: swapped, calls });
  assert.equal(result.ok, false);
  assert.equal(result.code, "QUOTE_MISMATCH");
  assert.match(result.reason, /token to receive/);
  assert.equal(calls.count, 0, "nothing was built from a quote for another token");
});

test("a quote that spends another token, on another network or more than asked is refused", async () => {
  assert.equal((await build({ quote: { ...SWIFT, fromToken: { ...SWIFT.fromToken, contract: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" } } })).code, "QUOTE_MISMATCH");
  assert.equal((await build({ quote: { ...SWIFT, toChain: "arbitrum" } })).code, "QUOTE_MISMATCH");
  assert.equal((await build({ quote: { ...SWIFT, effectiveAmountIn64: "100000001" } })).code, "QUOTE_MISMATCH");
  assert.equal((await build({ quote: { ...SWIFT, swiftVersion: "V1" } })).code, "QUOTE_MISMATCH");
  assert.equal((await build({ quote: { ...SWIFT, gasless: true } })).code, "QUOTE_MISMATCH");
});

test("an EVM token named in another case is the same token, and still builds", async () => {
  const result = await build({ expected: { ...EXPECTED, toToken: EXPECTED.toToken.toLowerCase() } });
  assert.equal(result.ok, true, result.reason);
});
