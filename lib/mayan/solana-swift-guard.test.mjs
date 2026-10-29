import assert from "node:assert/strict";
import test from "node:test";

import { getBase58Decoder } from "@solana/kit";

import {
  assessCrossSwapOwnerEffects,
  checkMayanSwiftInstructions,
  COMPUTE_BUDGET_PROGRAM_ID,
  JUPITER_V6_PROGRAM_ID,
  MAYAN_CPI_PROXY_PROGRAM_ID,
  MAYAN_SWIFT_V2_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
} from "./solana-swift-guard.ts";

/**
 * FIX-XSWAP-1 (SEC-1 P1). Each case is an answer from Mayan's API that looks
 * like an order and does something else with the person's wallet; the
 * assertion is always that it is refused with a reason. The first case of
 * each group is the honest order, which must still pass.
 */

const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ATA = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const WSOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

const OWNER = "2wmVCSfPxGPjrnMMn7rchp4uaeoTqN39mXFC2zhPdri9";
const OWNER_WSOL = "7oP5jGQNGd2vR3JmXk1pXQ8CkUv9h4uB2kRdd9JqvWUd";
const STATE = "9hF4dQ3n6zj8B5yGkXr2cTqLmV1sUpW7aZoEiN3bYxKe";
const STATE_USDC = "4kNmBv8cXz2QwRtYuJoPaSdFgHjKkZxCvBnMqWeRtYu1";
const POOL_SOL = "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3";
const POOL_USDC = "6P4tvbLUHxn2ZvZ1kYZ8d8qv2ZR8eGZt7hW8rM5tXyQw";
const POOL_AUTHORITY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const ATTACKER = "8ZUczUAUSLDxEqS6DkU8n1LwUr3y9ZcB8iS1xNqgH3Pk";
const ATTACKER_PROGRAM = "AttackerProgram1111111111111111111111111111";

const STATIC = [OWNER, OWNER_WSOL, STATE, STATE_USDC, POOL_SOL, POOL_USDC, TOKEN, SYSTEM_PROGRAM_ID];
const RENT = { lamportsPerByteYear: 5080n, exemptionThreshold: 1, burnPercent: 50 };
const STATE_SPACE = 400;
const STATE_RENT = (128n + 400n) * 5080n; /* 2,682,240 */
const ATA_RENT = (128n + 165n) * 5080n; /* 1,488,440 */
const AMOUNT = 100_000_000n;
const FEE = 35_000n;

const balance = (accountIndex, mint, owner, amount) => ({ accountIndex, mint, owner, uiTokenAmount: { amount: String(amount), decimals: 6 } });
const parsed = (type, info) => ({ programId: TOKEN, program: "spl-token", parsed: { type, info }, stackHeight: 2 });

/**
 * 0.1 SOL into Base USDC: Jupiter swaps SOL through the wallet's temporary wSOL
 * account into the order's USDC account, and `init_order` opens the order's
 * state. The wallet pays the amount, the fee and the two accounts' rent.
 */
function honestSimulation(overrides = {}) {
  return {
    fee: FEE,
    loadedAddresses: { writable: [], readonly: [] },
    preBalances: [1_000_000_000n, 0n, 0n, 0n, 5_000_000_000n, 2_039_280n, 1n, 1n],
    postBalances: [1_000_000_000n - AMOUNT - FEE - STATE_RENT - ATA_RENT, 0n, STATE_RENT, ATA_RENT, 5_000_000_000n + AMOUNT, 2_039_280n, 1n, 1n],
    preTokenBalances: [balance(5, USDC, POOL_AUTHORITY, 1_000_000_000_000n)],
    postTokenBalances: [balance(3, USDC, STATE, 10_388_583n), balance(5, USDC, POOL_AUTHORITY, 1_000_000_000_000n - 10_388_583n)],
    innerInstructions: [
      {
        index: 1,
        instructions: [
          parsed("syncNative", { account: OWNER_WSOL }),
          parsed("transferChecked", { source: POOL_USDC, destination: STATE_USDC, authority: POOL_AUTHORITY, mint: USDC }),
          parsed("closeAccount", { account: OWNER_WSOL, destination: OWNER, owner: OWNER }),
        ],
      },
    ],
    ...overrides,
  };
}

function honestStates(overrides = {}) {
  return new Map(
    Object.entries({
      [OWNER]: { lamports: 0n, space: 0, owner: SYSTEM_PROGRAM_ID },
      [STATE]: { lamports: STATE_RENT, space: STATE_SPACE, owner: MAYAN_SWIFT_V2_PROGRAM_ID },
      [STATE_USDC]: { lamports: ATA_RENT, space: 165, owner: TOKEN },
      [POOL_SOL]: { lamports: 5_100_000_000n, space: 165, owner: TOKEN },
      [POOL_USDC]: { lamports: 2_039_280n, space: 165, owner: TOKEN },
      ...overrides,
    }),
  );
}

const assess = (simulation = honestSimulation(), accountStates = honestStates(), extra = {}) =>
  assessCrossSwapOwnerEffects({
    owner: OWNER,
    inputMint: WSOL,
    nativeInput: true,
    amountInRaw: String(AMOUNT),
    staticAccounts: STATIC,
    simulation,
    accountStates,
    rent: RENT,
    ...extra,
  });

test("the honest order passes, and states what the wallet loses", () => {
  const result = assess();
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.effects.inputLossRaw, String(AMOUNT));
  assert.equal(result.effects.rentLamports, String(STATE_RENT + ATA_RENT));
  assert.equal(result.effects.feeLamports, String(FEE));
  assert.equal(result.effects.createdAccounts, 2);
});

/* ── Attack: a third-party program ────────────────────────────────────────── */

const proxied = (programId) => ({ programId: MAYAN_CPI_PROXY_PROGRAM_ID, keys: [{ pubkey: programId }, { pubkey: OWNER }] });
const honestInstructions = [
  { programId: COMPUTE_BUDGET_PROGRAM_ID, keys: [] },
  proxied(ATA),
  proxied(SYSTEM_PROGRAM_ID),
  proxied(TOKEN),
  { programId: JUPITER_V6_PROGRAM_ID, keys: [{ pubkey: OWNER }] },
  proxied(TOKEN),
  proxied(MAYAN_SWIFT_V2_PROGRAM_ID),
];

test("program list: the SDK's own shape of a Swift order passes", () => {
  assert.deepEqual(checkMayanSwiftInstructions(honestInstructions), { ok: true });
});

test("program list: a third-party program at the top level is refused", () => {
  const result = checkMayanSwiftInstructions([...honestInstructions, { programId: ATTACKER_PROGRAM, keys: [{ pubkey: OWNER }] }]);
  assert.equal(result.ok, false);
  assert.equal(result.code, "UNEXPECTED_PROGRAM");
  assert.match(result.reason, /AttackerProgram/);
});

test("program list: a bare Token instruction from the API is refused — the SDK only ever proxies its own", () => {
  const result = checkMayanSwiftInstructions([...honestInstructions, { programId: TOKEN, keys: [{ pubkey: OWNER }] }]);
  assert.equal(result.code, "UNEXPECTED_PROGRAM");
});

test("program list: the proxy forwarding to a program the order does not need is refused", () => {
  assert.equal(checkMayanSwiftInstructions([...honestInstructions, proxied(ATTACKER_PROGRAM)]).code, "UNEXPECTED_PROGRAM");
  assert.equal(checkMayanSwiftInstructions([...honestInstructions, proxied(MEMO)]).code, "UNEXPECTED_PROGRAM", "Memo is not needed and not allowed");
  assert.equal(checkMayanSwiftInstructions([...honestInstructions, proxied(MAYAN_CPI_PROXY_PROGRAM_ID)]).code, "UNEXPECTED_PROGRAM", "no proxy of the proxy");
  assert.equal(checkMayanSwiftInstructions([...honestInstructions, { programId: MAYAN_CPI_PROXY_PROGRAM_ID, keys: [] }]).code, "UNEXPECTED_PROGRAM");
});

test("effects: an approve over the person's tokens is refused, parsed or raw — it moves no balance", () => {
  const sim = honestSimulation();
  const approve = parsed("approve", { source: OWNER_WSOL, delegate: ATTACKER, owner: OWNER, amount: "1" });
  const viaParsed = assess({ ...sim, innerInstructions: [{ index: 1, instructions: [...sim.innerInstructions[0].instructions, approve] }] });
  assert.equal(viaParsed.code, "UNSAFE_TOKEN_MUTATION");

  /* Approve = 4, then a u64 amount; accounts [source, delegate, owner] by index. */
  const data = getBase58Decoder().decode(new Uint8Array([4, 255, 255, 255, 255, 255, 255, 255, 255]));
  const raw = { programIdIndex: 6, accounts: [1, 4, 0], data, stackHeight: 2 };
  const viaRaw = assess({ ...sim, innerInstructions: [{ index: 1, instructions: [raw] }] });
  assert.equal(viaRaw.code, "UNSAFE_TOKEN_MUTATION");
});

test("effects: a close of the person's account to someone else is refused", () => {
  const sim = honestSimulation();
  const close = parsed("closeAccount", { account: OWNER_WSOL, destination: ATTACKER, owner: OWNER });
  assert.equal(assess({ ...sim, innerInstructions: [{ index: 1, instructions: [close] }] }).code, "UNSAFE_TOKEN_MUTATION");
});

test("effects: a wallet reassigned to another program is refused — no balance changes, everything does", () => {
  const result = assess(honestSimulation(), honestStates({ [OWNER]: { lamports: 0n, space: 0, owner: ATTACKER_PROGRAM } }));
  assert.equal(result.code, "WALLET_MUTATED");
});

test("effects: SOL sent from the wallet to an existing account is refused", () => {
  const sim = honestSimulation();
  const vector = [...STATIC, ATTACKER];
  const result = assessCrossSwapOwnerEffects({
    owner: OWNER,
    inputMint: WSOL,
    nativeInput: true,
    amountInRaw: String(AMOUNT),
    staticAccounts: vector,
    simulation: {
      ...sim,
      preBalances: [...sim.preBalances, 10n],
      postBalances: [sim.postBalances[0] - 50_000_000n, ...sim.postBalances.slice(1), 50_000_010n],
    },
    accountStates: honestStates(),
    rent: RENT,
  });
  assert.equal(result.code, "SOL_OVERSPENT");
});

test("effects: SOL sent to a fresh address is refused as an account the order has no reason to open", () => {
  const sim = honestSimulation();
  const result = assessCrossSwapOwnerEffects({
    owner: OWNER,
    inputMint: WSOL,
    nativeInput: true,
    amountInRaw: String(AMOUNT),
    staticAccounts: [...STATIC, ATTACKER],
    simulation: { ...sim, preBalances: [...sim.preBalances, 0n], postBalances: [sim.postBalances[0] - 890_880n, ...sim.postBalances.slice(1), 890_880n] },
    accountStates: honestStates({ [ATTACKER]: { lamports: 890_880n, space: 0, owner: SYSTEM_PROGRAM_ID } }),
    rent: RENT,
  });
  assert.equal(result.code, "UNEXPECTED_ACCOUNT_CREATED");
});

test("effects: a network fee far above any Mayan suggests is refused", () => {
  assert.equal(assess(honestSimulation({ fee: 50_000_000n })).code, "FEE_TOO_HIGH");
});

test("effects: a simulation without balances or inner instructions is not a proof", () => {
  assert.equal(assess(honestSimulation({ preTokenBalances: null })).code, "SIMULATION_METADATA_UNAVAILABLE");
  assert.equal(assess(honestSimulation({ innerInstructions: undefined })).code, "SIMULATION_METADATA_UNAVAILABLE");
  assert.equal(assess(honestSimulation({ fee: null })).code, "SIMULATION_METADATA_UNAVAILABLE");
  const withoutWallet = new Map([...honestStates()].filter(([address]) => address !== OWNER));
  assert.equal(assess(honestSimulation(), withoutWallet).code, "SIMULATION_METADATA_UNAVAILABLE");
});

/* ── Attack: another token ────────────────────────────────────────────────── */

test("effects: a token the swap does not spend leaving the wallet is refused", () => {
  const sim = honestSimulation();
  /* The wallet's BONK account at index 1 drained into the attacker's. */
  const result = assess({
    ...sim,
    preTokenBalances: [...sim.preTokenBalances, balance(1, BONK, OWNER, 5_000_000n), balance(4, BONK, ATTACKER, 0n)],
    postTokenBalances: [...sim.postTokenBalances, balance(1, BONK, OWNER, 0n), balance(4, BONK, ATTACKER, 5_000_000n)],
  });
  assert.equal(result.code, "UNRELATED_TOKEN_LOSS");
  assert.match(result.reason, new RegExp(BONK));
});

test("effects: on a token input, more than the amount leaving the wallet is refused; the amount itself passes", () => {
  /* USDC in: the wallet's USDC account (index 1) pays the order's account (index 3). */
  const usdcIn = (spent) =>
    assessCrossSwapOwnerEffects({
      owner: OWNER,
      inputMint: USDC,
      nativeInput: false,
      amountInRaw: "10000000",
      staticAccounts: STATIC,
      simulation: {
        fee: FEE,
        loadedAddresses: { writable: [], readonly: [] },
        preBalances: [1_000_000_000n, ATA_RENT, 0n, 0n, 1n, 1n, 1n, 1n],
        postBalances: [1_000_000_000n - FEE - STATE_RENT - ATA_RENT, ATA_RENT, STATE_RENT, ATA_RENT, 1n, 1n, 1n, 1n],
        preTokenBalances: [balance(1, USDC, OWNER, 50_000_000n)],
        postTokenBalances: [balance(1, USDC, OWNER, 50_000_000n - spent), balance(3, USDC, STATE, spent)],
        innerInstructions: [{ index: 0, instructions: [parsed("transfer", { source: OWNER_WSOL, destination: STATE_USDC, authority: OWNER, amount: String(spent) })] }],
      },
      accountStates: honestStates(),
      rent: RENT,
    });
  assert.equal(usdcIn(10_000_000n).ok, true);
  const over = usdcIn(10_000_001n);
  assert.equal(over.code, "INPUT_OVERSPENT");
});

test("effects: on a native input, wSOL drained from the wallet's own account counts as SOL and is refused", () => {
  const sim = honestSimulation();
  /* The wallet already held 0.5 wSOL in index 1; the order takes it on top of the amount. */
  const result = assess({
    ...sim,
    preTokenBalances: [...sim.preTokenBalances, balance(1, WSOL, OWNER, 500_000_000n)],
    postTokenBalances: [...sim.postTokenBalances, balance(1, WSOL, OWNER, 0n)],
  });
  assert.equal(result.code, "SOL_OVERSPENT");
});
