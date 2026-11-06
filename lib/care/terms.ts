/**
 * CITY-203 — the agent looks after a person's Meteora liquidity: the terms they give once and the policies they become.
 *
 * The same primitive as the agent's budget (`../mandate/**`, decision 95): their Squads smart account holds the position in
 * its vault, and ProgramInteraction policies on it name the one key that may act (the agent's, in Google Cloud KMS) and
 * what it may do — the program itself holds the bounds, not our code:
 *
 * - **exit** — fees, liquidity and the position's rent go out **only to the person's own token accounts and wallet**:
 *   DLMM `claim_fee2`, `remove_liquidity_by_range2`, `close_position2`; DAMM v2 `claim_position_fee`,
 *   `remove_all_liquidity`, `close_position`;
 * - **tend** — the vault's own money stays the vault's, in the one pool they chose: DLMM `rebalance_liquidity` (claim
 *   the fees, take the liquidity out and put it back around the price in one instruction, the active bin's slippage
 *   capped) and `initialize_position2`; DAMM v2 `claim_position_fee` into the vault, `add_liquidity`, `create_position`.
 *
 * Nothing else: no swap, no transfer, no other pool, no other program. A stolen agent key can at most move their
 * liquidity inside their own pool or hand it back to their. A policy carries at most a few rules in one transaction's room,
 * so each pool takes two policies (two of their transactions, one approval). Pure — the window, the server and the agent
 * share it.
 */

import { PublicKey } from "@solana/web3.js";

import { TOKEN_PROGRAM_ID, type AccountConstraint, type DataConstraint, type InstructionConstraint, type ProgramInteractionPolicy } from "../mandate/ssa.ts";

export const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const DLMM_PROGRAM_ID = new PublicKey("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo");
export const DAMM_V2_PROGRAM_ID = new PublicKey("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG");

/** Anchor discriminators, read off the programs' IDLs (DLMM 0.12.0, DAMM v2 0.2.5 — the SDKs in `package.json`). */
export const DISC = Object.freeze({
  dlmmClaimFee2: Uint8Array.of(112, 191, 101, 171, 28, 144, 127, 187),
  dlmmRemoveByRange2: Uint8Array.of(204, 2, 195, 145, 53, 145, 145, 205),
  dlmmClosePosition2: Uint8Array.of(174, 90, 35, 115, 186, 40, 147, 226),
  dlmmRebalance: Uint8Array.of(92, 4, 176, 193, 119, 185, 83, 9),
  dlmmInitPosition2: Uint8Array.of(143, 19, 242, 145, 213, 15, 104, 115),
  dammClaimFee: Uint8Array.of(180, 38, 154, 17, 133, 33, 162, 211),
  dammRemoveAll: Uint8Array.of(10, 51, 61, 35, 112, 105, 24, 85),
  dammClosePosition: Uint8Array.of(123, 134, 81, 0, 49, 68, 98, 98),
  dammAddLiquidity: Uint8Array.of(181, 157, 89, 67, 143, 182, 52, 72),
  dammCreatePosition: Uint8Array.of(48, 215, 197, 153, 96, 203, 180, 133),
});

/** Where each instruction keeps what the policy pins (the IDLs' account order). */
export const LAYOUT = Object.freeze({
  dlmmClaimFee2: { pool: 0, position: 1, sender: 2, tokenX: 5, tokenY: 6 },
  dlmmRemoveByRange2: { position: 0, pool: 1, tokenX: 3, tokenY: 4, sender: 9 },
  dlmmClosePosition2: { position: 0, sender: 1, rentReceiver: 2 },
  /** `rebalance_liquidity`; its params start with `active_id: i32`, then `max_active_bin_slippage: u16` at byte 12. */
  dlmmRebalance: { position: 0, pool: 1, tokenX: 3, tokenY: 4, owner: 9, rentPayer: 10, maxActiveBinSlippage: 12 },
  dlmmInitPosition2: { payer: 0, position: 1, pool: 2, owner: 3 },
  dammClaimFee: { pool: 1, position: 2, tokenA: 3, tokenB: 4, signer: 10 },
  dammRemoveAll: { pool: 1, position: 2, tokenA: 3, tokenB: 4, signer: 10 },
  dammClosePosition: { pool: 2, position: 3, rentReceiver: 5, owner: 6 },
  dammAddLiquidity: { pool: 0, position: 1, tokenA: 2, tokenB: 3, signer: 9 },
  dammCreatePosition: { owner: 0, pool: 3, payer: 6 },
});

/** How far the active bin may move between the agent's read and its rebalance landing — the sandwich it can suffer. */
export const CARE_MAX_ACTIVE_BIN_SLIPPAGE = 5;

/** The longest a care lasts before the person renews it with one signature. */
export const CARE_MAX_DAYS = 90;

export type CarePoolKind = "dlmm" | "damm-v2";

/** One pool the agent looks after: its address and its two coins, each with its token program. */
export type CarePool = Readonly<{
  kind: CarePoolKind;
  address: PublicKey;
  /** DLMM's X / DAMM v2's A. */
  mintX: PublicKey;
  /** DLMM's Y / DAMM v2's B — the pair currency (SOL or a dollar) in Ryntra's pools. */
  mintY: PublicKey;
  programX: PublicKey;
  programY: PublicKey;
}>;

/** What happens to the fees: brought to their wallet, or put back into the position. */
export type FeeMode = "wallet" | "reinvest";

export type CareTerms = Readonly<{
  human: PublicKey;
  agent: PublicKey;
  pool: CarePool;
  fees: FeeMode;
  /** DLMM only: put the range back around the price when the price leaves it. */
  rebalance: boolean;
  /**
   * The person's stop: when X's price in Y falls under it, the agent takes everything out to their wallet. Price in Y per
   * whole X (decimal, as the window shows it); null — no stop.
   */
  stopBelow: number | null;
  /** Unix seconds. */
  expiresAt: bigint;
}>;

const isTokenProgram = (program: PublicKey) => program.equals(TOKEN_PROGRAM_ID) || program.equals(TOKEN_2022_PROGRAM_ID);

/** Why the terms are not a care the engine writes; null when they are. */
export function careTermsRefusal(terms: CareTerms, nowSeconds: bigint): string | null {
  if (terms.human.equals(terms.agent)) return "the agent's key is not the person's wallet";
  const pool = terms.pool;
  if (pool.mintX.equals(pool.mintY)) return "the pool trades two coins";
  if (!isTokenProgram(pool.programX) || !isTokenProgram(pool.programY)) return "the pool's coins are SPL tokens";
  if (terms.rebalance && pool.kind !== "dlmm") return "only a DLMM range is rebalanced";
  if (terms.stopBelow !== null && !(Number.isFinite(terms.stopBelow) && terms.stopBelow > 0)) return "the stop is a price above zero";
  if (terms.expiresAt <= nowSeconds) return "the care ends in the future";
  if (terms.expiresAt - nowSeconds > BigInt(CARE_MAX_DAYS) * 86_400n) return `the care lasts at most ${CARE_MAX_DAYS} days`;
  return null;
}

/* ------------------------------------------------------------------ constraint builders */

const keys = (index: number, ...pinned: PublicKey[]): AccountConstraint => ({ index, rule: { kind: "keys", keys: pinned }, owner: null });
const slice = (offset: number, bytes: Uint8Array): DataConstraint => ({ offset, value: { kind: "bytes", value: bytes }, operator: "equals" });
const u16 = (offset: number, value: number, operator: DataConstraint["operator"]): DataConstraint => ({ offset, value: { kind: "u16", value }, operator });

/** A token account of `program` whose owner field is `owner`. */
const ownedBy = (index: number, owner: PublicKey, program: PublicKey): AccountConstraint => ({ index, rule: { kind: "data", constraints: [slice(32, owner.toBytes())] }, owner: program });

/** The two policies of one pool. `exit` pays only the person; `tend` keeps the money in the vault and the pool. */
export type CarePolicies = Readonly<{ exit: ProgramInteractionPolicy; tend: ProgramInteractionPolicy }>;

/** The rule names, in the order the policies hold them — what the agent names when it acts. */
export const CARE_RULES = Object.freeze({
  dlmm: { exit: ["claimToWallet", "removeToWallet", "closeToWallet"], tend: ["rebalance", "openPosition"] },
  "damm-v2": { exit: ["claimToWallet", "removeToWallet", "closeToWallet"], tend: ["claimToVault", "addLiquidity", "openPosition"] },
} as const);

export type CareRule = (typeof CARE_RULES)[CarePoolKind]["exit" | "tend"][number];

function dlmmPolicies(terms: CareTerms, vault: PublicKey, accountIndex: number): CarePolicies {
  const { human, pool } = terms;
  const P = pool.address;
  const c = LAYOUT;
  const exit: InstructionConstraint[] = [
    {
      programId: DLMM_PROGRAM_ID,
      accounts: [keys(c.dlmmClaimFee2.pool, P), keys(c.dlmmClaimFee2.sender, vault), ownedBy(c.dlmmClaimFee2.tokenX, human, pool.programX), ownedBy(c.dlmmClaimFee2.tokenY, human, pool.programY)],
      data: [slice(0, DISC.dlmmClaimFee2)],
    },
    {
      programId: DLMM_PROGRAM_ID,
      accounts: [keys(c.dlmmRemoveByRange2.pool, P), keys(c.dlmmRemoveByRange2.sender, vault), ownedBy(c.dlmmRemoveByRange2.tokenX, human, pool.programX), ownedBy(c.dlmmRemoveByRange2.tokenY, human, pool.programY)],
      data: [slice(0, DISC.dlmmRemoveByRange2)],
    },
    {
      programId: DLMM_PROGRAM_ID,
      accounts: [keys(c.dlmmClosePosition2.sender, vault), keys(c.dlmmClosePosition2.rentReceiver, human)],
      data: [slice(0, DISC.dlmmClosePosition2)],
    },
  ];
  const tend: InstructionConstraint[] = [
    {
      programId: DLMM_PROGRAM_ID,
      accounts: [
        keys(c.dlmmRebalance.pool, P),
        keys(c.dlmmRebalance.owner, vault),
        keys(c.dlmmRebalance.rentPayer, vault),
        ownedBy(c.dlmmRebalance.tokenX, vault, pool.programX),
        ownedBy(c.dlmmRebalance.tokenY, vault, pool.programY),
      ],
      data: [slice(0, DISC.dlmmRebalance), u16(c.dlmmRebalance.maxActiveBinSlippage, CARE_MAX_ACTIVE_BIN_SLIPPAGE, "lessThanOrEqualTo")],
    },
    {
      programId: DLMM_PROGRAM_ID,
      accounts: [keys(c.dlmmInitPosition2.payer, vault), keys(c.dlmmInitPosition2.pool, P), keys(c.dlmmInitPosition2.owner, vault)],
      data: [slice(0, DISC.dlmmInitPosition2)],
    },
  ];
  return { exit: policyOf(exit, accountIndex), tend: policyOf(tend, accountIndex) };
}

function dammPolicies(terms: CareTerms, vault: PublicKey, accountIndex: number): CarePolicies {
  const { human, pool } = terms;
  const P = pool.address;
  const c = LAYOUT;
  const claim = (to: PublicKey): InstructionConstraint => ({
    programId: DAMM_V2_PROGRAM_ID,
    accounts: [keys(c.dammClaimFee.pool, P), keys(c.dammClaimFee.signer, vault), ownedBy(c.dammClaimFee.tokenA, to, pool.programX), ownedBy(c.dammClaimFee.tokenB, to, pool.programY)],
    data: [slice(0, DISC.dammClaimFee)],
  });
  const exit: InstructionConstraint[] = [
    claim(human),
    {
      programId: DAMM_V2_PROGRAM_ID,
      accounts: [keys(c.dammRemoveAll.pool, P), keys(c.dammRemoveAll.signer, vault), ownedBy(c.dammRemoveAll.tokenA, human, pool.programX), ownedBy(c.dammRemoveAll.tokenB, human, pool.programY)],
      data: [slice(0, DISC.dammRemoveAll)],
    },
    {
      programId: DAMM_V2_PROGRAM_ID,
      accounts: [keys(c.dammClosePosition.pool, P), keys(c.dammClosePosition.owner, vault), keys(c.dammClosePosition.rentReceiver, human)],
      data: [slice(0, DISC.dammClosePosition)],
    },
  ];
  const tend: InstructionConstraint[] = [
    claim(vault),
    {
      programId: DAMM_V2_PROGRAM_ID,
      accounts: [keys(c.dammAddLiquidity.pool, P), keys(c.dammAddLiquidity.signer, vault), ownedBy(c.dammAddLiquidity.tokenA, vault, pool.programX), ownedBy(c.dammAddLiquidity.tokenB, vault, pool.programY)],
      data: [slice(0, DISC.dammAddLiquidity)],
    },
    {
      programId: DAMM_V2_PROGRAM_ID,
      accounts: [keys(c.dammCreatePosition.owner, vault), keys(c.dammCreatePosition.pool, P), keys(c.dammCreatePosition.payer, vault)],
      data: [slice(0, DISC.dammCreatePosition)],
    },
  ];
  return { exit: policyOf(exit, accountIndex), tend: policyOf(tend, accountIndex) };
}

/* No spending limit: no rule lets money leave the pool for anyone but the person, so there is nothing to cap per day. */
const policyOf = (constraints: InstructionConstraint[], accountIndex: number): ProgramInteractionPolicy => ({ accountIndex, constraints, spendingLimits: [] });

/** The two policies the terms become, for the vault that holds the position. */
export function carePolicies(terms: CareTerms, vault: PublicKey, accountIndex = 1): CarePolicies {
  return terms.pool.kind === "dlmm" ? dlmmPolicies(terms, vault, accountIndex) : dammPolicies(terms, vault, accountIndex);
}

/** Which policy and rule an instruction claims, by its program and discriminator — or for DAMM v2's claim, its payee. */
export function careRuleOf(kind: CarePoolKind, programId: PublicKey, data: Uint8Array, claimPaysVault = false): Readonly<{ policy: "exit" | "tend"; index: number; rule: CareRule }> | null {
  const head = (disc: Uint8Array) => disc.length <= data.length && disc.every((byte, index) => data[index] === byte);
  if (kind === "dlmm") {
    if (!programId.equals(DLMM_PROGRAM_ID)) return null;
    if (head(DISC.dlmmClaimFee2)) return { policy: "exit", index: 0, rule: "claimToWallet" };
    if (head(DISC.dlmmRemoveByRange2)) return { policy: "exit", index: 1, rule: "removeToWallet" };
    if (head(DISC.dlmmClosePosition2)) return { policy: "exit", index: 2, rule: "closeToWallet" };
    if (head(DISC.dlmmRebalance)) return { policy: "tend", index: 0, rule: "rebalance" };
    if (head(DISC.dlmmInitPosition2)) return { policy: "tend", index: 1, rule: "openPosition" };
    return null;
  }
  if (!programId.equals(DAMM_V2_PROGRAM_ID)) return null;
  if (head(DISC.dammClaimFee)) return claimPaysVault ? { policy: "tend", index: 0, rule: "claimToVault" } : { policy: "exit", index: 0, rule: "claimToWallet" };
  if (head(DISC.dammRemoveAll)) return { policy: "exit", index: 1, rule: "removeToWallet" };
  if (head(DISC.dammClosePosition)) return { policy: "exit", index: 2, rule: "closeToWallet" };
  if (head(DISC.dammAddLiquidity)) return { policy: "tend", index: 1, rule: "addLiquidity" };
  if (head(DISC.dammCreatePosition)) return { policy: "tend", index: 2, rule: "openPosition" };
  return null;
}
