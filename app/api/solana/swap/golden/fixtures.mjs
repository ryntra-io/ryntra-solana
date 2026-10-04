/**
 * Fixed inputs for the swap routes' golden transcript test.
 *
 * Everything here is a generated test value: the two Ed25519 keys were made
 * once for this file and sign nothing outside it, the addresses are hashes of
 * plain labels, and every chain or venue answer is built from the constants
 * below. Ed25519 is deterministic, so a transaction signed here carries the
 * same signature on every run.
 */
import { createHash, createPrivateKey, sign as signBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  AccountRole,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getAddressDecoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

/* ── Keys (test-only, generated for this file) ─────────────────────────── */

/** PKCS#8 DER, base64 — the deployment's issuer key in this test only. */
export const ISSUER_PRIVATE_KEY_PKCS8 = "MC4CAQAwBQYDK2VwBCIEIAM9MfsdAyhWh8lDVNWSPf4HM6m0L+3cVr/9BQfi2YMU";
/** PKCS#8 DER, base64 — the wallet that takes every order here. */
export const TAKER_PRIVATE_KEY_PKCS8 = "MC4CAQAwBQYDK2VwBCIEIKQVC+h7PFi/1UizUuhJpmT72pb6e+YBvV8jyFj8/w1w";
export const TAKER = "4EeXQa4MKrBSwDj9pHEoZXjiiUaZmWzveGq5X9dUKPGW";
/** A second key, used only to produce a signature that does not verify. */
export const STRANGER_PRIVATE_KEY_PKCS8 = "MC4CAQAwBQYDK2VwBCIEIABmR3q1XESGS51F10vKHuGcxGwVCfrYesLQ/1fm8u0g";

/* ── Addresses ──────────────────────────────────────────────────────────── */

export const WSOL = "So11111111111111111111111111111111111111112";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const RETIRED_MINT = "oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
export const JUPITER_PROGRAM = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
export const JUPITER_REFERRAL_PROGRAM = "REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3";
export const JUPITER_ULTRA_REFERRAL_PROJECT = "DkiqsTrw1u1bYFumumC7sCG2S8K25qc2vemJFHyW2wJc";
export const SYSVAR_RENT = "SysvarRent111111111111111111111111111111111";

/** A plain address derived from a label: 32 bytes of sha256, base58. */
export function labelAddress(label) {
  return getAddressDecoder().decode(createHash("sha256").update(`golden-swap:${label}`).digest());
}

export const REFERRAL_ACCOUNT = labelAddress("referral-account");
export const TAKER_USDT_ACCOUNT = labelAddress("taker-usdt-account");
export const REFERRAL_USDT_ACCOUNT = labelAddress("referral-usdt-account");
export const POOL_ACCOUNT = labelAddress("pool");
export const POOL_VAULT = labelAddress("pool-vault");
export const BLOCKHASH = labelAddress("blockhash");

/* ── Hosts ──────────────────────────────────────────────────────────────── */

export const RPC_PRIMARY = "https://rpc-primary.golden.test";
export const RPC_INDEPENDENT = "https://rpc-independent.golden.test";
export const RPC_PRIMARY_HOST = new URL(RPC_PRIMARY).host;
export const RPC_INDEPENDENT_HOST = new URL(RPC_INDEPENDENT).host;

/* ── Time and the order ─────────────────────────────────────────────────── */

/** 2026-10-01T12:00:00.000Z — a whole second, so a reset header can name it exactly. */
export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

export const REQUEST_ID = "golden-order-0001";
export const LAST_VALID_BLOCK_HEIGHT = 300_000_000;
export const IN_LAMPORTS = 10_000_000n;
export const OUT_RAW = 1_500_000n;
export const MIN_OUT_RAW = 1_492_500n;
export const SIGNATURE_FEE = 5_000n;
/** 200 000 units at 5 000 micro-lamports. */
export const PRIORITY_FEE = 1_000n;
/** The wallet's own re-price on the adopted lane: 200 000 units at 10 000 micro-lamports. */
export const ADOPTED_PRIORITY_FEE = 2_000n;
export const REFERRAL_FEE_COLLECTED = 7_537n;
export const TAKER_LAMPORTS_BEFORE = 1_000_000_000n;
export const TAKER_USDT_BEFORE = 5_000_000n;
export const TOKEN_ACCOUNT_RENT = 2_039_280n;

export const ENV_BASE = Object.freeze({
  RYNTRA_SOLANA_SWAP_STATE: "OPEN",
  RYNTRA_JUPITER_API_KEY: "golden-test-provider-key",
  RYNTRA_AGENT_ISSUER_PRIVATE_KEY: ISSUER_PRIVATE_KEY_PKCS8,
  RYNTRA_SOLANA_RPC_MAINNET: RPC_PRIMARY,
  RYNTRA_SOLANA_RPC_MAINNET_FALLBACK: RPC_INDEPENDENT,
  RYNTRA_JUPITER_REFERRAL_ACCOUNT: REFERRAL_ACCOUNT,
  /* The transcripts are the /order lane's, recorded before fee policy v2: the operator's switch keeps them on it. The /build lane has its own tests. */
  RYNTRA_FEE_POLICY: "as-now",
  RYNTRA_REWARDS_ACTIVATION_AT: "2026-09-01T00:00:00Z",
});

/* ── Transactions ───────────────────────────────────────────────────────── */

function u32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function u64(value) {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), true);
  return bytes;
}

/**
 * The provider's v0 transaction: a compute budget and one route instruction
 * over the taker's USDT account, the referral's USDT account and a pool.
 * `microLamports` is the wallet-visible price; changing it is the adopted
 * lane's one modification. `feePayer` lets a refusal name another payer.
 */
export function buildSwapWire({ microLamports = 5_000, feePayer = TAKER } = {}) {
  const instructions = [
    { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data: Uint8Array.of(2, ...u32(200_000)) },
    { programAddress: COMPUTE_BUDGET_PROGRAM, accounts: [], data: Uint8Array.of(3, ...u64(microLamports)) },
    {
      programAddress: JUPITER_PROGRAM,
      accounts: [
        { address: feePayer, role: AccountRole.WRITABLE_SIGNER },
        { address: TAKER_USDT_ACCOUNT, role: AccountRole.WRITABLE },
        { address: REFERRAL_USDT_ACCOUNT, role: AccountRole.WRITABLE },
        { address: POOL_ACCOUNT, role: AccountRole.WRITABLE },
        { address: POOL_VAULT, role: AccountRole.WRITABLE },
        { address: TOKEN_PROGRAM, role: AccountRole.READONLY },
      ],
      data: Uint8Array.of(0xe5, 0x17, 0xcb, 0x97, ...u64(IN_LAMPORTS), ...u64(MIN_OUT_RAW)),
    },
  ];
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (value) => setTransactionMessageFeePayer(feePayer, value),
    (value) =>
      setTransactionMessageLifetimeUsingBlockhash({ blockhash: BLOCKHASH, lastValidBlockHeight: BigInt(LAST_VALID_BLOCK_HEIGHT) }, value),
    (value) => appendTransactionMessageInstructions(instructions, value),
  );
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

/** The static account vector of a wire transaction, in message order. */
export function staticAccountsOf(wireBase64) {
  const decoded = getTransactionDecoder().decode(Buffer.from(wireBase64, "base64"));
  /* The signature map is keyed by the signers; the message bytes carry the full vector. */
  const bytes = new Uint8Array(decoded.messageBytes);
  /* v0: prefix byte, 3 header bytes, compact-u16 count, then 32-byte keys. */
  let offset = 1 + 3;
  const count = bytes[offset];
  offset += 1;
  const keys = [];
  for (let index = 0; index < count; index += 1) {
    keys.push(getAddressDecoder().decode(bytes.subarray(offset, offset + 32)));
    offset += 32;
  }
  return keys;
}

/**
 * Sign a wire transaction's message with a PKCS#8 key and put the signature in
 * the first slot. One signer only, which is every transaction here.
 */
export function signWire(wireBase64, privateKeyPkcs8 = TAKER_PRIVATE_KEY_PKCS8) {
  const wire = Buffer.from(wireBase64, "base64");
  const decoded = getTransactionDecoder().decode(wire);
  const messageBytes = Buffer.from(decoded.messageBytes);
  const key = createPrivateKey({ key: Buffer.from(privateKeyPkcs8, "base64"), format: "der", type: "pkcs8" });
  const signature = signBytes(null, messageBytes, key);
  const signed = Buffer.concat([Buffer.from([1]), signature, messageBytes]);
  return { wire: signed.toString("base64"), signature: getBase58Decoder().decode(signature) };
}

/* ── Venue answers ──────────────────────────────────────────────────────── */

/** Jupiter `/order`, keyed and with a taker: the signable order. */
export function jupiterOrderBody({ transaction = buildSwapWire(), referral = true, overrides = {} } = {}) {
  return {
    swapType: "aggregator",
    inAmount: IN_LAMPORTS.toString(),
    outAmount: OUT_RAW.toString(),
    otherAmountThreshold: MIN_OUT_RAW.toString(),
    swapMode: "ExactIn",
    slippageBps: 50,
    priceImpactPct: "0.0005",
    routePlan: [
      {
        percent: 100,
        bps: 10_000,
        swapInfo: {
          ammKey: POOL_ACCOUNT,
          label: "Whirlpool",
          inputMint: WSOL,
          outputMint: USDT,
          inAmount: IN_LAMPORTS.toString(),
          outAmount: OUT_RAW.toString(),
        },
      },
    ],
    feeMint: USDT,
    feeBps: referral ? 50 : 2,
    platformFee: { feeBps: referral ? 50 : 2, feeMint: USDT },
    ...(referral ? { referralAccount: REFERRAL_ACCOUNT } : {}),
    signatureFeeLamports: Number(SIGNATURE_FEE),
    signatureFeePayer: TAKER,
    prioritizationFeeLamports: Number(PRIORITY_FEE),
    prioritizationFeePayer: TAKER,
    rentFeeLamports: 0,
    rentFeePayer: null,
    transaction,
    lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    gasless: false,
    jitOptimized: false,
    taker: transaction === null ? null : TAKER,
    inputMint: WSOL,
    outputMint: USDT,
    router: "metis",
    guaranteedPrice: false,
    requestId: REQUEST_ID,
    inUsdValue: 1.5075,
    outUsdValue: 1.5,
    swapUsdValue: 1.5,
    priceImpact: 0.0005,
    mode: referral ? "manual" : "ultra",
    totalTime: 120,
    ...overrides,
  };
}

/** Jupiter `/order` without a taker: what the read-only quote route receives. */
export function jupiterQuoteBody({ referral = true } = {}) {
  const body = jupiterOrderBody({ transaction: null, referral });
  delete body.lastValidBlockHeight;
  return body;
}

/* ── Chain answers ──────────────────────────────────────────────────────── */

const MINT_FIXTURES = {
  [WSOL]: JSON.parse(readFileSync(new URL("../../../../../lib/solana/fixtures/wsol-spl.json", import.meta.url), "utf8")),
  [USDT]: JSON.parse(readFileSync(new URL("../../../../../lib/solana/fixtures/usdt-spl.json", import.meta.url), "utf8")),
};

/** Rent sysvar: 3 480 lamports per byte-year, threshold 2.0, burn 50 %. */
export function rentSysvarBase64() {
  const bytes = new Uint8Array(17);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, 3_480n, true);
  view.setFloat64(8, 2, true);
  view.setUint8(16, 50);
  return Buffer.from(bytes).toString("base64");
}

/** `getAccountInfo` value for the addresses the routes read, else null. */
export function accountInfoValue(address) {
  const mint = MINT_FIXTURES[address];
  if (mint) {
    return { data: [mint.dataBase64, "base64"], executable: false, lamports: 1_461_600, owner: mint.owner, rentEpoch: 0, space: Buffer.from(mint.dataBase64, "base64").length };
  }
  if (address === SYSVAR_RENT) {
    return { data: [rentSysvarBase64(), "base64"], executable: false, lamports: 1_009_200, owner: "Sysvar1111111111111111111111111111111111111", rentEpoch: 0, space: 17 };
  }
  if (address === REFERRAL_ACCOUNT) {
    /* The route asks for 32 bytes at offset 40: the referral project. */
    const project = Buffer.from(getBase58Encoder().encode(JUPITER_ULTRA_REFERRAL_PROJECT));
    return { data: [project.toString("base64"), "base64"], executable: false, lamports: 2_000_000, owner: JUPITER_REFERRAL_PROGRAM, rentEpoch: 0, space: 32 };
  }
  return null;
}

function tokenRow(accountIndex, owner, amount) {
  return {
    accountIndex,
    mint: USDT,
    owner,
    programId: TOKEN_PROGRAM,
    uiTokenAmount: { amount: amount.toString(), decimals: 6, uiAmount: Number(amount) / 1e6, uiAmountString: (Number(amount) / 1e6).toString() },
  };
}

/**
 * Balance vectors for one execution of the swap: the taker pays `fee` and the
 * input, receives `outRaw` USDT, and the referral account receives its fee.
 */
export function balanceVectors(staticAccounts, { fee, outRaw = OUT_RAW, referralRaw = REFERRAL_FEE_COLLECTED } = {}) {
  const preBalances = staticAccounts.map((account) =>
    account === TAKER ? TAKER_LAMPORTS_BEFORE : account === TAKER_USDT_ACCOUNT || account === REFERRAL_USDT_ACCOUNT ? TOKEN_ACCOUNT_RENT : 1n,
  );
  const postBalances = preBalances.map((value, index) => (staticAccounts[index] === TAKER ? value - IN_LAMPORTS - fee : value));
  const takerIndex = staticAccounts.indexOf(TAKER_USDT_ACCOUNT);
  const referralIndex = staticAccounts.indexOf(REFERRAL_USDT_ACCOUNT);
  return {
    preBalances: preBalances.map(Number),
    postBalances: postBalances.map(Number),
    preTokenBalances: [tokenRow(takerIndex, TAKER, TAKER_USDT_BEFORE), tokenRow(referralIndex, REFERRAL_ACCOUNT, 0n)],
    postTokenBalances: [tokenRow(takerIndex, TAKER, TAKER_USDT_BEFORE + outRaw), tokenRow(referralIndex, REFERRAL_ACCOUNT, referralRaw)],
  };
}

/** `simulateTransaction` value for the given wire transaction. */
export function simulationValue(wireBase64, { fee = SIGNATURE_FEE + PRIORITY_FEE, outRaw = OUT_RAW, err = null, addresses = [] } = {}) {
  const staticAccounts = staticAccountsOf(wireBase64);
  return {
    err,
    logs: ["Program log: golden simulation"],
    accounts: addresses.map(() => null),
    unitsConsumed: 118_000,
    returnData: null,
    innerInstructions: [],
    replacementBlockhash: null,
    fee: Number(fee),
    loadedAddresses: { writable: [], readonly: [] },
    ...balanceVectors(staticAccounts, { fee, outRaw }),
  };
}

/** `getTransaction` (json, v0) for the given signed wire transaction. */
export function transactionValue(signedWireBase64, signature, { fee = SIGNATURE_FEE + PRIORITY_FEE, err = null, slot = 400_000_123 } = {}) {
  const staticAccounts = staticAccountsOf(signedWireBase64);
  const vectors = balanceVectors(staticAccounts, { fee });
  const failed = err !== null;
  return {
    slot,
    blockTime: Math.floor(T0 / 1000),
    version: 0,
    meta: {
      err,
      status: failed ? { Err: err } : { Ok: null },
      fee: Number(fee),
      preBalances: vectors.preBalances,
      postBalances: failed
        ? vectors.preBalances.map((value, index) => (staticAccounts[index] === TAKER ? value - Number(fee) : value))
        : vectors.postBalances,
      preTokenBalances: vectors.preTokenBalances,
      postTokenBalances: failed ? vectors.preTokenBalances : vectors.postTokenBalances,
      innerInstructions: [],
      logMessages: ["Program log: golden landing"],
      loadedAddresses: { writable: [], readonly: [] },
      computeUnitsConsumed: 118_000,
    },
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: staticAccounts,
        header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 3 },
        recentBlockhash: BLOCKHASH,
        instructions: [
          { programIdIndex: staticAccounts.indexOf(COMPUTE_BUDGET_PROGRAM), accounts: [], data: "K1FDJ7" },
          { programIdIndex: staticAccounts.indexOf(COMPUTE_BUDGET_PROGRAM), accounts: [], data: "3DdGGhkhJbjm" },
          { programIdIndex: staticAccounts.indexOf(JUPITER_PROGRAM), accounts: [0, 1, 2, 3, 4], data: "3Bxs4Bc3" },
        ],
        addressTableLookups: [],
      },
    },
  };
}
