/**
 * CITY-203 — the agent's actions on a position it looks after, built from Meteora's own SDKs (`@meteora-ag/dlmm`,
 * `@meteora-ag/cp-amm-sdk`) for the care vault.
 *
 * The SDKs build for an owner that is also the payer; here the owner is the vault and the payer the agent. So every
 * build is read back and kept to what the policies allow: only the pool program's own instructions go inside the
 * execution, their payees rewritten to the accounts the rule names (the person's for an exit, the vault's for tending),
 * and what the SDK asked the owner to pay for outside the pool's program — token accounts, bin arrays — is paid by the
 * agent, outside the execution, where it can only cost the agent. Nothing here signs or sends.
 */

import type DLMMClass from "@meteora-ag/dlmm";
import { createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction, type Connection } from "@solana/web3.js";
import BN from "bn.js";

import { ownTokenAccount, type Care } from "./enable.ts";
import { CARE_MAX_ACTIVE_BIN_SLIPPAGE, DAMM_V2_PROGRAM_ID, DISC, DLMM_PROGRAM_ID, LAYOUT, careRuleOf } from "./terms.ts";

/** What one action of the agent is: the setup it pays for, the instructions inside the execution, any fresh key that signs. */
export type CareBuild = Readonly<{
  policy: "exit" | "tend";
  setup: readonly TransactionInstruction[];
  inner: readonly TransactionInstruction[];
  constraintIndices: readonly number[];
  /** A fresh key the transaction must also sign with — a new position, or its NFT's mint. */
  extraSigners: readonly Keypair[];
}>;

/** Bins per DLMM bin array (the program's `MAX_BIN_ARRAY_SIZE`). */
const BIN_ARRAY_SIZE = 70;
/** The SDK's `StrategyType.Spot`: the same amount in every bin. */
const SPOT = 0;
const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
const head = (data: Uint8Array, disc: Uint8Array) => disc.every((byte, index) => data[index] === byte);

/** Rewrite the accounts at `at` of an instruction. */
function patch(instruction: TransactionInstruction, at: Readonly<Record<number, PublicKey>>): TransactionInstruction {
  instruction.keys = instruction.keys.map((key, index) => (at[index] ? { ...key, pubkey: at[index]! } : key));
  return instruction;
}

/** DLMM's `close_position_if_empty`, which the SDK's exit ends with. */
const DLMM_CLOSE_IF_EMPTY = Uint8Array.of(...[59, 124, 212, 118, 91, 152, 110, 157]);
/** The DLMM SDK's `initialize_bin_array` names its funder at index 2; the agent pays for it. */
const DLMM_INIT_BIN_ARRAY = Uint8Array.of(35, 86, 19, 185, 78, 212, 75, 211);

/** Sort an SDK build: the pool program's instructions go inside, bin arrays are funded by the agent outside. */
function split(instructions: readonly TransactionInstruction[], program: PublicKey, agent: PublicKey) {
  const inside: TransactionInstruction[] = [];
  const outside: TransactionInstruction[] = [];
  for (const instruction of instructions) {
    if (instruction.programId.equals(ComputeBudgetProgram.programId)) continue;
    if (instruction.programId.equals(program) && head(instruction.data, DLMM_INIT_BIN_ARRAY)) outside.push(patch(instruction, { 2: agent }));
    else if (instruction.programId.equals(program)) inside.push(instruction);
    /* Token accounts the SDK opens for the owner, SOL it wraps or unwraps: the agent opens what is needed itself. */
  }
  return { inside, outside };
}

function indicesOf(care: Care, inner: readonly TransactionInstruction[], policy: "exit" | "tend", claimPaysVault = false): number[] {
  return inner.map((instruction) => {
    const rule = careRuleOf(care.terms.pool.kind, instruction.programId, instruction.data, claimPaysVault);
    if (!rule || rule.policy !== policy) throw new Error("the SDK built an instruction outside the care's rules");
    return rule.index;
  });
}

/** The agent opens the person's and the vault's token accounts of both coins (idempotent, at its own cost). */
function accountsSetup(care: Care): TransactionInstruction[] {
  const { pool, human, agent } = care.terms;
  const out: TransactionInstruction[] = [];
  for (const [mint, program] of [
    [pool.mintX, pool.programX],
    [pool.mintY, pool.programY],
  ] as const) {
    out.push(createAssociatedTokenAccountIdempotentInstruction(agent, ownTokenAccount(human, mint, program), human, mint, program));
    out.push(createAssociatedTokenAccountIdempotentInstruction(agent, ownTokenAccount(care.vault, mint, program), care.vault, mint, program));
  }
  return out;
}

/* ================================================================== DLMM */

export type DlmmPosition = Readonly<{ address: PublicKey; lowerBin: number; upperBin: number; hasLiquidity: boolean; feeX: bigint; feeY: bigint; amountX: bigint; amountY: bigint }>;

type DlmmPool = Awaited<ReturnType<typeof DLMMClass.create>>;

export async function dlmmPool(connection: Connection, care: Care, deps: Readonly<{ DLMM?: typeof DLMMClass }> = {}): Promise<DlmmPool> {
  const DLMM = deps.DLMM ?? (await import("@meteora-ag/dlmm")).default;
  return DLMM.create(connection, care.terms.pool.address, { cluster: care.cluster === "devnet" ? "devnet" : "mainnet-beta" });
}

/** The vault's positions in the pool, as the agent reads them. */
export async function dlmmPositions(pool: DlmmPool, care: Care): Promise<readonly DlmmPosition[]> {
  const { userPositions } = await pool.getPositionsByUserAndLbPair(care.vault);
  return userPositions.map((entry) => {
    const data = entry.positionData;
    const amountX = BigInt(new BN(data.totalXAmount.toString().split(".")[0]!).toString());
    const amountY = BigInt(new BN(data.totalYAmount.toString().split(".")[0]!).toString());
    return {
      address: entry.publicKey,
      lowerBin: data.lowerBinId,
      upperBin: data.upperBinId,
      hasLiquidity: amountX > 0n || amountY > 0n,
      feeX: BigInt(data.feeX.toString()),
      feeY: BigInt(data.feeY.toString()),
      amountX,
      amountY,
    };
  });
}

/**
 * A new position of `width` bins around the price, in the vault: `initialize_position2` with a fresh key (the
 * transaction signs with it too). The money goes in with the next action — a `rebalance` that deposits.
 */
export async function dlmmOpen(pool: DlmmPool, care: Care, width: number): Promise<CareBuild & { position: PublicKey }> {
  const position = Keypair.generate();
  const active = await pool.getActiveBin();
  const minBinId = active.binId - Math.floor(width / 2);
  const maxBinId = minBinId + width - 1;
  /* `initialize_position2` from the program's own IDL (the SDK's empty position still uses the first version). */
  const init = await pool.program.methods
    .initializePosition2(minBinId, maxBinId - minBinId + 1)
    .accountsPartial({ payer: care.vault, position: position.publicKey, lbPair: care.terms.pool.address, owner: care.vault })
    .instruction();
  /* The bin arrays the range needs, funded by the agent — permissionless, outside the execution. */
  const indexes: BN[] = [];
  for (let index = Math.floor(minBinId / BIN_ARRAY_SIZE); index <= Math.floor(maxBinId / BIN_ARRAY_SIZE); index += 1) indexes.push(new BN(index));
  const withArrays = pool as unknown as { createBinArraysIfNeeded(indexes: BN[], funder: PublicKey): Promise<TransactionInstruction[]> };
  const arrays = await withArrays.createBinArraysIfNeeded(indexes, care.terms.agent);
  const outside = arrays.map((instruction) => patch(instruction, { 2: care.terms.agent }));
  const inner = [init];
  return { policy: "tend", setup: [...accountsSetup(care), ...outside], inner, constraintIndices: indicesOf(care, inner, "tend"), extraSigners: [position], position: position.publicKey };
}

/**
 * The position's money put back around the price — and the vault's idle coins (`topUp`) with it — in one `rebalance_liquidity`:
 * the fees claimed into the vault, everything withdrawn, the same width deposited around the active bin («Spot»). The
 * active bin's slippage is capped by the policy (`CARE_MAX_ACTIVE_BIN_SLIPPAGE`).
 */
export async function dlmmRebalance(
  pool: DlmmPool,
  care: Care,
  position: PublicKey,
  topUp: Readonly<{ x: bigint; y: bigint }>,
  options: Readonly<{ withdraw: boolean }> = { withdraw: true },
): Promise<CareBuild> {
  const read = await pool.getPosition(position);
  const withdrawBps = new BN(options.withdraw ? 10_000 : 0);
  /*
   * The SDK deposits exactly the amounts it is handed: what comes out of the position — its liquidity and its fees,
   * claimed in the same instruction — has to be handed back in, with the vault's idle coins (CITY-203 devnet, 5.11:
   * a rebalance handed only the idle coins left the money in the vault).
   */
  const whole = (value: unknown) => BigInt(String(value ?? "0").split(".")[0] || "0");
  const back = options.withdraw ? { x: whole(read.positionData.totalXAmount) + whole(read.positionData.feeX), y: whole(read.positionData.totalYAmount) + whole(read.positionData.feeY) } : { x: 0n, y: 0n };
  const depositX = topUp.x + back.x;
  const depositY = topUp.y + back.y;
  const simulated = await pool.simulateRebalancePositionWithBalancedStrategy(position, read.positionData, SPOT as never, new BN(depositX.toString()), new BN(depositY.toString()), withdrawBps, withdrawBps);
  const built = await pool.rebalancePosition(simulated, new BN(CARE_MAX_ACTIVE_BIN_SLIPPAGE), care.vault);
  const { inside, outside } = split([...built.initBinArrayInstructions, ...built.rebalancePositionInstruction], DLMM_PROGRAM_ID, care.terms.agent);
  const rebalance = inside.filter((instruction) => head(instruction.data, DISC.dlmmRebalance));
  if (rebalance.length !== 1) throw new Error("the SDK did not build one rebalance_liquidity");
  const L = LAYOUT.dlmmRebalance;
  const { pool: poolInfo } = care.terms;
  const inner = [
    patch(rebalance[0]!, {
      [L.tokenX]: ownTokenAccount(care.vault, poolInfo.mintX, poolInfo.programX),
      [L.tokenY]: ownTokenAccount(care.vault, poolInfo.mintY, poolInfo.programY),
      [L.owner]: care.vault,
      [L.rentPayer]: care.vault,
    }),
  ];
  return { policy: "tend", setup: [...accountsSetup(care), ...outside], inner, constraintIndices: indicesOf(care, inner, "tend"), extraSigners: [] };
}

/** The fees to the person's wallet: `claim_fee2` paying their own accounts. */
export async function dlmmClaimToWallet(pool: DlmmPool, care: Care, position: PublicKey): Promise<CareBuild> {
  const read = await pool.getPosition(position);
  const txs = await pool.claimSwapFee({ owner: care.vault, position: read });
  const all = (Array.isArray(txs) ? txs : [txs]).flatMap((tx) => tx.instructions);
  const { inside, outside } = split(all, DLMM_PROGRAM_ID, care.terms.agent);
  const L = LAYOUT.dlmmClaimFee2;
  const { pool: info, human } = care.terms;
  const inner = inside
    .filter((instruction) => head(instruction.data, DISC.dlmmClaimFee2))
    .map((instruction) => patch(instruction, { [L.tokenX]: ownTokenAccount(human, info.mintX, info.programX), [L.tokenY]: ownTokenAccount(human, info.mintY, info.programY) }));
  if (!inner.length) throw new Error("no fee to claim");
  return { policy: "exit", setup: [...accountsSetup(care), ...outside], inner, constraintIndices: indicesOf(care, inner, "exit"), extraSigners: [] };
}

/** Everything out to the person's wallet — liquidity, fees — and the position closed, its rent to them. */
export async function dlmmExit(pool: DlmmPool, care: Care, position: DlmmPosition): Promise<CareBuild> {
  /* An empty position — nothing in it and no fee waiting — only closes, its rent to the person (the SDK's exit has no bin to start from). */
  if (!position.hasLiquidity && position.feeX + position.feeY === 0n) {
    const close = await pool.program.methods.closePosition2().accountsPartial({ position: position.address, sender: care.vault, rentReceiver: care.terms.human }).instruction();
    return { policy: "exit", setup: accountsSetup(care), inner: [close], constraintIndices: indicesOf(care, [close], "exit"), extraSigners: [] };
  }
  const txs = await pool.removeLiquidity({ user: care.vault, position: position.address, fromBinId: position.lowerBin, toBinId: position.upperBin, bps: new BN(10_000), shouldClaimAndClose: true, skipUnwrapSOL: true });
  const all = (Array.isArray(txs) ? txs : [txs]).flatMap((tx) => tx.instructions);
  const { inside, outside } = split(all, DLMM_PROGRAM_ID, care.terms.agent);
  const { pool: info, human } = care.terms;
  const toX = ownTokenAccount(human, info.mintX, info.programX);
  const toY = ownTokenAccount(human, info.mintY, info.programY);
  const inner = inside.flatMap((instruction) => {
    if (head(instruction.data, DISC.dlmmRemoveByRange2)) return [patch(instruction, { [LAYOUT.dlmmRemoveByRange2.tokenX]: toX, [LAYOUT.dlmmRemoveByRange2.tokenY]: toY })];
    if (head(instruction.data, DISC.dlmmClaimFee2)) return [patch(instruction, { [LAYOUT.dlmmClaimFee2.tokenX]: toX, [LAYOUT.dlmmClaimFee2.tokenY]: toY })];
    /* The SDK closes with `close_position_if_empty`; the care closes with `close_position2`, its rent to the person. */
    if (head(instruction.data, DISC.dlmmClosePosition2) || head(instruction.data, DLMM_CLOSE_IF_EMPTY)) return [];
    throw new Error("the SDK's exit holds an instruction outside the care's rules");
  });
  inner.push(await pool.program.methods.closePosition2().accountsPartial({ position: position.address, sender: care.vault, rentReceiver: human }).instruction());
  return { policy: "exit", setup: [...accountsSetup(care), ...outside], inner, constraintIndices: indicesOf(care, inner, "exit"), extraSigners: [] };
}

/* ================================================================== DAMM v2 */

type CpAmmModule = typeof import("@meteora-ag/cp-amm-sdk");

async function cpAmm(connection: Connection, deps: Readonly<{ sdk?: CpAmmModule }>) {
  const sdk = deps.sdk ?? (await import("@meteora-ag/cp-amm-sdk"));
  return { sdk, client: new sdk.CpAmm(connection) };
}

export type DammPosition = Readonly<{ address: PublicKey; nftMint: PublicKey; nftAccount: PublicKey; hasLiquidity: boolean; feeA: bigint; feeB: bigint }>;

export async function dammPositions(connection: Connection, care: Care, deps: Readonly<{ sdk?: CpAmmModule }> = {}): Promise<readonly DammPosition[]> {
  const { sdk, client } = await cpAmm(connection, deps);
  const pool = await client.fetchPoolState(care.terms.pool.address);
  const rows = await client.getUserPositionByPool(care.terms.pool.address, care.vault);
  return rows.map((row) => {
    const fee = sdk.getUnClaimLpFee(pool, row.positionState);
    return {
      address: row.position,
      nftMint: row.positionState.nftMint,
      nftAccount: row.positionNftAccount,
      hasLiquidity: !row.positionState.unlockedLiquidity.isZero(),
      feeA: BigInt(fee.feeTokenA.toString()),
      feeB: BigInt(fee.feeTokenB.toString()),
    };
  });
}

const dammCommon = (care: Care, pool: Awaited<ReturnType<InstanceType<CpAmmModule["CpAmm"]>["fetchPoolState"]>>) => ({
  pool: care.terms.pool.address,
  tokenAMint: pool.tokenAMint,
  tokenBMint: pool.tokenBMint,
  tokenAVault: pool.tokenAVault,
  tokenBVault: pool.tokenBVault,
  tokenAProgram: care.terms.pool.programX,
  tokenBProgram: care.terms.pool.programY,
});

const DAMM_POOL_AUTHORITY = new PublicKey("HLnpSz9h2S4hiLQ43rnSD9XkcUThA7B8hQMKmDaiTLcC");
const DAMM_EVENT_AUTHORITY = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], DAMM_V2_PROGRAM_ID)[0];
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const m = (pubkey: PublicKey, isWritable: boolean, isSigner = false) => ({ pubkey, isSigner, isWritable });

/**
 * DAMM v2's position instructions written from the IDL's account order (0.2.5), so that every payee is exactly the one
 * the rule names — the SDK's builders open token accounts and unwrap SOL for an owner that here is the vault.
 */
function dammPositionInstruction(
  kind: "claim" | "removeAll",
  care: Care,
  pool: Awaited<ReturnType<InstanceType<CpAmmModule["CpAmm"]>["fetchPoolState"]>>,
  position: DammPosition,
  to: PublicKey,
): TransactionInstruction {
  const info = care.terms.pool;
  const keys = [
    m(DAMM_POOL_AUTHORITY, false),
    m(info.address, kind === "removeAll"),
    m(position.address, true),
    m(ownTokenAccount(to, info.mintX, info.programX), true),
    m(ownTokenAccount(to, info.mintY, info.programY), true),
    m(pool.tokenAVault, true),
    m(pool.tokenBVault, true),
    m(info.mintX, false),
    m(info.mintY, false),
    m(position.nftAccount, false),
    m(care.vault, false, true),
    m(info.programX, false),
    m(info.programY, false),
    m(DAMM_EVENT_AUTHORITY, false),
    m(DAMM_V2_PROGRAM_ID, false),
  ];
  const data = kind === "claim" ? Buffer.from(DISC.dammClaimFee) : Buffer.concat([Buffer.from(DISC.dammRemoveAll), Buffer.alloc(16)]);
  return new TransactionInstruction({ programId: DAMM_V2_PROGRAM_ID, keys, data });
}

function dammCloseInstruction(care: Care, position: DammPosition): TransactionInstruction {
  const keys = [
    m(position.nftMint, true),
    m(position.nftAccount, true),
    m(care.terms.pool.address, true),
    m(position.address, true),
    m(DAMM_POOL_AUTHORITY, false),
    m(care.terms.human, true),
    m(care.vault, false, true),
    m(TOKEN_2022, false),
    m(DAMM_EVENT_AUTHORITY, false),
    m(DAMM_V2_PROGRAM_ID, false),
  ];
  return new TransactionInstruction({ programId: DAMM_V2_PROGRAM_ID, keys, data: Buffer.from(DISC.dammClosePosition) });
}

/** A new position in the vault and the vault's coins put into it: `create_position` + `add_liquidity` in one execution. */
export async function dammOpen(connection: Connection, care: Care, amounts: Readonly<{ a: bigint; b: bigint }>, deps: Readonly<{ sdk?: CpAmmModule }> = {}): Promise<CareBuild & { position: PublicKey }> {
  const { sdk, client } = await cpAmm(connection, deps);
  const pool = await client.fetchPoolState(care.terms.pool.address);
  const nft = Keypair.generate();
  const position = sdk.derivePositionAddress(nft.publicKey);
  const nftAccount = sdk.derivePositionNftAccount(nft.publicKey);
  const create = (await client.createPosition({ owner: care.vault, payer: care.vault, pool: care.terms.pool.address, positionNft: nft.publicKey })).instructions.filter((ix) => ix.programId.equals(DAMM_V2_PROGRAM_ID));
  const add = await dammAddInstructions(sdk, client, care, pool, position, nftAccount, amounts);
  const inner = [...create, ...add];
  return { policy: "tend", setup: accountsSetup(care), inner, constraintIndices: indicesOf(care, inner, "tend", true), extraSigners: [nft], position };
}

async function dammAddInstructions(
  sdk: CpAmmModule,
  client: InstanceType<CpAmmModule["CpAmm"]>,
  care: Care,
  pool: Awaited<ReturnType<InstanceType<CpAmmModule["CpAmm"]>["fetchPoolState"]>>,
  position: PublicKey,
  nftAccount: PublicKey,
  amounts: Readonly<{ a: bigint; b: bigint }>,
): Promise<TransactionInstruction[]> {
  /* The liquidity both amounts allow: the smaller of the two deltas, so neither side is asked for more than the vault holds. */
  const quoteA = client.getDepositQuote({ inAmount: new BN(amounts.a.toString()), isTokenA: true, minSqrtPrice: pool.sqrtMinPrice, maxSqrtPrice: pool.sqrtMaxPrice, sqrtPrice: pool.sqrtPrice, collectFeeMode: pool.collectFeeMode, tokenAAmount: pool.tokenAAmount, tokenBAmount: pool.tokenBAmount, liquidity: pool.liquidity } as never);
  const quoteB = client.getDepositQuote({ inAmount: new BN(amounts.b.toString()), isTokenA: false, minSqrtPrice: pool.sqrtMinPrice, maxSqrtPrice: pool.sqrtMaxPrice, sqrtPrice: pool.sqrtPrice, collectFeeMode: pool.collectFeeMode, tokenAAmount: pool.tokenAAmount, tokenBAmount: pool.tokenBAmount, liquidity: pool.liquidity } as never);
  const quote = quoteA.liquidityDelta.lte(quoteB.liquidityDelta) ? quoteA : quoteB;
  if (quote.liquidityDelta.isZero()) return [];
  const tx = await client.addLiquidity({
    owner: care.vault,
    position,
    positionNftAccount: nftAccount,
    liquidityDelta: quote.liquidityDelta,
    maxAmountTokenA: new BN(amounts.a.toString()),
    maxAmountTokenB: new BN(amounts.b.toString()),
    tokenAAmountThreshold: new BN(amounts.a.toString()),
    tokenBAmountThreshold: new BN(amounts.b.toString()),
    ...dammCommon(care, pool),
  });
  const { pool: info } = care.terms;
  void sdk;
  return tx.instructions
    .filter((ix) => ix.programId.equals(DAMM_V2_PROGRAM_ID) && head(ix.data, DISC.dammAddLiquidity))
    .map((ix) => patch(ix, { [LAYOUT.dammAddLiquidity.tokenA]: ownTokenAccount(care.vault, info.mintX, info.programX), [LAYOUT.dammAddLiquidity.tokenB]: ownTokenAccount(care.vault, info.mintY, info.programY) }));
}

/** The fees out of the position: to the person's wallet, or into the vault and straight back into the position. */
export async function dammClaim(
  connection: Connection,
  care: Care,
  position: DammPosition,
  to: "wallet" | "reinvest",
  vaultSpare: Readonly<{ a: bigint; b: bigint }> = { a: 0n, b: 0n },
  deps: Readonly<{ sdk?: CpAmmModule }> = {},
): Promise<CareBuild> {
  const { sdk, client } = await cpAmm(connection, deps);
  const pool = await client.fetchPoolState(care.terms.pool.address);
  const payee = to === "wallet" ? care.terms.human : care.vault;
  const claim = [dammPositionInstruction("claim", care, pool, position, payee)];
  if (to === "wallet") return { policy: "exit", setup: accountsSetup(care), inner: claim, constraintIndices: indicesOf(care, claim, "exit"), extraSigners: [] };
  const add = await dammAddInstructions(sdk, client, care, pool, position.address, position.nftAccount, { a: position.feeA + vaultSpare.a, b: position.feeB + vaultSpare.b });
  const inner = [...claim, ...add];
  return { policy: "tend", setup: accountsSetup(care), inner, constraintIndices: indicesOf(care, inner, "tend", true), extraSigners: [] };
}

/** Everything out to the person's wallet and the position closed: `claim_position_fee`, `remove_all_liquidity`, `close_position`. */
export async function dammExit(connection: Connection, care: Care, position: DammPosition, deps: Readonly<{ sdk?: CpAmmModule }> = {}): Promise<CareBuild> {
  const { client } = await cpAmm(connection, deps);
  const pool = await client.fetchPoolState(care.terms.pool.address);
  const human = care.terms.human;
  const inner = [
    ...(position.feeA + position.feeB > 0n ? [dammPositionInstruction("claim", care, pool, position, human)] : []),
    ...(position.hasLiquidity ? [dammPositionInstruction("removeAll", care, pool, position, human)] : []),
    dammCloseInstruction(care, position),
  ];
  return { policy: "exit", setup: accountsSetup(care), inner, constraintIndices: indicesOf(care, inner, "exit"), extraSigners: [] };
}

export const __internals = { SYSTEM_PROGRAM, split, patch };
