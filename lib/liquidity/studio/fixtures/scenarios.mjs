/**
 * The scenarios the venue tapes were recorded on, shared by the recorder
 * (`scripts/liquidity/record-studio-fixtures.mjs`) and the tests. Every
 * address is public: pools on mainnet and wallets that hold positions in
 * them — `J7zLmX…` is Ryntra's own launch executor (`lib/attribution/registry.ts`);
 * the others are strangers' wallets found among a pool's positions.
 */

import { createHash } from "node:crypto";

import { Keypair } from "@solana/web3.js";

export const DLMM_SCENARIO = Object.freeze({
  /** SOL-USDC, bin step 4 — the deepest DLMM pool of the pair on 2026-10-16. */
  pool: "5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6",
  /** A wallet with twelve positions in it: some across the price, some above, some below. */
  lp: "6mch5rCLBtZ9DCnM2mx18Ud1XXhXAip7otw9LkrTXwTD",
  /** Across the price, both tokens, fees waiting. */
  inRange: "8dRtxg5xzetRyzYjyWPhcLMAVdyhbPpJo1u1J87Fh9XL",
  /** Above the price: SOL only. */
  oneSided: "1Be6ZXynELowU6JjN1VRR4pRMEeAywdgpQdeKJp44id",
  /** No fees waiting. */
  noFees: "F9giKWHtHEimNgTQMwCiGJz7UuFQz6bbEX7wNqW4xvXG",
  /** Ryntra's executor: one ladder step below the price of a demo market. */
  executor: "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU",
  /** 0.01 SOL and 1.5 USDC. */
  amountX: "10000000",
  amountY: "1500000",
  seed: "ryntra-studio-dlmm-position",
});

export const DAMM_V2_SCENARIO = Object.freeze({
  /** SOL-USDC, a bounded curve with a static fee. */
  pool: "8Pm2kZpnxD3hoMmt4bjStX2Pw2Z9abpbHzZxMPqxPmie",
  /** A demo market's graduated pool: a compounding pool of a Token-2022 launch token and USDC, with no price bounds. */
  compoundingPool: "7UNr1t6DnPb4vwmR72BioSnr5cbatwYWcxHAzawafMtD",
  /** A wallet with one free position in the SOL-USDC pool, fees waiting. */
  lp: "5EXSx1fpCszyrjp3PaSWzqz9bsYc21XV8ZA2KM3STPzG",
  unlocked: "Fkiq3dLreQ99MKcaVWQNgpwY3yLeBcgBVuMeiPE3dRTs",
  /** A position whose liquidity is partly under a vesting, and its holder. */
  vesting: "92KzSGvMQb2fGhEVvPjLij8W9QHhmnAmJCPMRMu3faXN",
  vester: "21CMvQbknX112N6U59TWvwR6YudkUHBuSqri4j9qtrsa",
  /** Ryntra's executor's share of the demo pool, locked for good at graduation. */
  locked: "Gp182hExYGWjbYGCTcGfizysgjJzgMLxWsYGX1Vjcs76",
  executor: "J7zLmXSewhb1kcqwpL4SKpKfivivwn6wmSHwSg6H4JeU",
  /** 0.01 SOL and 5 USDC into the SOL-USDC curve. */
  amountX: "10000000",
  amountY: "5000000",
  /** 1 000 launch tokens and 1 USDC into the compounding pool. */
  compoundingAmountX: "1000000000",
  compoundingAmountY: "1000000",
  seed: "ryntra-studio-damm-v2-nft",
});

/** The same position key on every recording and replay, so a build's bytes repeat. */
export function fixedKeypair(seed) {
  return Keypair.fromSeed(createHash("sha256").update(seed).digest());
}

/** `@meteora-ag/dlmm`'s CommonJS build: the module is the DLMM class itself, with the named exports on it. */
export function dlmmSdkFromCommonJs(mod) {
  return {
    DLMM: mod,
    createProgram: mod.createProgram,
    ClockLayout: mod.ClockLayout,
    DEFAULT_BIN_PER_POSITION: mod.DEFAULT_BIN_PER_POSITION,
    getPriceOfBinByBinId: mod.getPriceOfBinByBinId,
    wrapPosition: mod.wrapPosition,
  };
}
