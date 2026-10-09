/**
 * Meteora DLMM as the venue of Ryntra's liquidity on a graduated launch.
 *
 * One pool per token: the customizable permissionless DLMM pool of the token
 * (X) and its pair currency (Y), at Ryntra's rule (`FLOOR_RULE`: steps of 1 %,
 * a 1 % fee collected in the pair currency). Its address is found from the two
 * mints alone, so a token has one such pool whoever made it; Ryntra's executor
 * makes it when there is none. In it, one position of the executor's: the pair
 * currency in steps below the price — buy liquidity, the «Spot» shape.
 *
 * What it builds, and the executor signs and pays:
 * - `createPool` — the pool, its active bin at the price's;
 * - `openSteps` — the position and the steps, the pair currency only;
 * - `syncSteps` and `placeSteps` — the steps moved up after the price: the
 *   pool's active bin taken to the price's (`go_to_a_bin`, allowed only
 *   through empty bins — the steps are emptied first in the same
 *   transaction), then, once that has landed, one `rebalance_liquidity` that
 *   puts the pair currency into the new steps and shrinks the position to
 *   them;
 * - `readSteps` — what the position holds: its range, the pair currency, the
 *   token it bought, the fees it has not claimed.
 *
 * Every builder returns transactions for the executor to sign; nothing here
 * holds a key but a new position's own, signed in before the bytes leave.
 *
 * Server-only: it reads the chain through the connection it is given.
 */

import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import DLMM, {
  ActivationType,
  CollectFeeMode,
  StrategyType,
  binIdToBinArrayIndex,
  buildLiquidityStrategyParameters,
  deriveBinArray,
  deriveBinArrayBitmapExtension,
  deriveCustomizablePermissionlessLbPair,
  findNextBinArrayIndexWithLiquidity,
  getLiquidityStrategyParameterBuilder,
  isOverflowDefaultBinArrayBitmap,
} from "@meteora-ag/dlmm";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, type Connection, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import { FLOOR_RULE, type FloorLadder } from "../../launch/autopilot.ts";

export const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";

export type FloorPool = Readonly<{
  pool: string;
  /** Whether the launched token is the pool's X; a pool made the other way round is not one the steps can use. */
  tokenIsX: boolean;
  binStep: number;
  activeBinId: number;
  decimalsX: number;
  decimalsY: number;
  /** Who made the pool: its address is found from the two mints alone, so anyone holding the token may make it first. */
  creator: string;
  /** The pool's base fee, basis points. */
  baseFeeBps: number;
  /** Whether its fee is collected in the pair currency (`OnlyY`). */
  collectsFeeInY: boolean;
  /** Whether it trades now — its status enabled. */
  enabled: boolean;
  /** Whether its creator may switch its trading off. */
  creatorCanSwitchOff: boolean;
  /** Whether a launch vault stands before it. */
  alphaVault: boolean;
  /** When it opens to trading, unix seconds for a pool timed by the clock; null for one timed by slots. */
  activationAt: number | null;
}>;

export type StepsRead = Readonly<{
  position: string;
  lowerBinId: number;
  upperBinId: number;
  /** The pair currency in the steps now. */
  pairRaw: string;
  /** The token the steps bought and hold. */
  tokenRaw: string;
  /** Fees earned and not yet claimed, in the pair currency (the pool collects them there). */
  feePairRaw: string;
  /** Each step: its bin and what it holds of the pair currency and the token. Absent where a reader did not split them. */
  bins?: readonly Readonly<{ binId: number; pairRaw: string; tokenRaw: string }>[];
}>;

export type FloorVenue = Readonly<{
  /** The token's pool by its mints, whoever made it; null while there is none. */
  pool(token: string, pair: string): Promise<FloorPool | null>;
  /**
   * The pool, its active bin at `activeBinId`. The program asks the pool's creator to hold some of the token — a
   * launch owner's proof — so when the payer holds none, the same transaction first buys `proof.amountRaw` of the
   * pair currency's worth in the token's graduated DAMM v2 pool.
   */
  createPool(args: Readonly<{ token: string; pair: string; activeBinId: number; payer: string; proof: Readonly<{ dammPool: string; amountRaw: bigint }> | null }>): Promise<Transaction>;
  openSteps(args: Readonly<{ pool: string; owner: string; ladder: FloorLadder; amountRaw: bigint }>): Promise<Readonly<{ transactions: Transaction[]; position: Keypair }>>;
  /** The steps emptied and the pool's active bin taken to a price's bin; null when it is there already. */
  syncSteps(args: Readonly<{ pool: string; owner: string; position: string | null; activeBinId: number }>): Promise<Transaction | null>;
  /** One `rebalance_liquidity`: whatever the position holds of the pair currency, and `amountRaw` more from the wallet, into the steps of `ladder`; the position shrinks to them. */
  placeSteps(args: Readonly<{ pool: string; owner: string; position: string; ladder: FloorLadder; amountRaw: bigint }>): Promise<Transaction>;
  readSteps(pool: string, position: string): Promise<StepsRead | null>;
}>;

/** A priority fee on the executor's transactions, so they land on a busy network; it costs at most a few thousand lamports. */
const PRIORITY_MICRO_LAMPORTS = 50_000;

export function createFloorVenue(args: Readonly<{ connection: Connection; cluster: "devnet" | "mainnet" }>): FloorVenue {
  const { connection } = args;
  const opt = args.cluster === "devnet" ? { cluster: "devnet" as const } : undefined;
  const programId = new PublicKey(DLMM_PROGRAM);
  const open = (pool: string) => DLMM.create(connection, new PublicKey(pool), opt);

  const priced = (tx: Transaction): Transaction => {
    const has = tx.instructions.some((ix) => ix.programId.equals(ComputeBudgetProgram.programId) && ix.data[0] === 3);
    if (!has) tx.instructions.unshift(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }));
    return tx;
  };

  return {
    async pool(token, pair) {
      const [address] = deriveCustomizablePermissionlessLbPair(new PublicKey(token), new PublicKey(pair), programId);
      const info = await connection.getAccountInfo(address, "confirmed");
      if (!info) return null;
      const dlmm = await open(address.toBase58());
      const lb = dlmm.lbPair;
      return {
        pool: address.toBase58(),
        tokenIsX: dlmm.tokenX.publicKey.toBase58() === token,
        binStep: lb.binStep,
        activeBinId: lb.activeId,
        decimalsX: dlmm.tokenX.mint.decimals,
        decimalsY: dlmm.tokenY.mint.decimals,
        creator: lb.creator.toBase58(),
        baseFeeBps: Math.round(Number(dlmm.getFeeInfo().baseFeeRatePercentage.toString()) * 100),
        collectsFeeInY: lb.parameters.collectFeeMode === CollectFeeMode.OnlyY,
        enabled: lb.status === 0,
        creatorCanSwitchOff: lb.creatorPoolOnOffControl !== 0,
        alphaVault: !lb.preActivationSwapAddress.equals(PublicKey.default),
        activationAt: lb.activationType === ActivationType.Timestamp ? Number(lb.activationPoint.toString()) : null,
      };
    },

    async createPool({ token, pair, activeBinId, payer: payerAddress, proof }) {
      const payer = new PublicKey(payerAddress);
      const created = await DLMM.createCustomizablePermissionlessLbPair2(
        connection,
        new BN(FLOOR_RULE.binStep),
        new PublicKey(token),
        new PublicKey(pair),
        new BN(activeBinId),
        new BN(FLOOR_RULE.feeBps),
        ActivationType.Timestamp,
        false,
        payer,
        undefined,
        false,
        undefined,
        CollectFeeMode.OnlyY,
        opt,
      );
      const tx = new Transaction();
      if (proof) tx.add(...(await proofBuyInstructions(connection, { pool: proof.dammPool, owner: payer, amountRaw: proof.amountRaw })));
      tx.add(...created.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)));
      tx.feePayer = payer;
      return priced(tx);
    },

    async openSteps({ pool, owner: ownerAddress, ladder, amountRaw }) {
      const owner = new PublicKey(ownerAddress);
      const dlmm = await open(pool);
      if (ladder.upperBinId >= dlmm.lbPair.activeId) throw new Error("The steps must sit below the pool's price.");
      const position = Keypair.generate();
      const tx = await dlmm.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: position.publicKey,
        user: owner,
        totalXAmount: new BN(0),
        totalYAmount: new BN(amountRaw.toString()),
        strategy: { minBinId: ladder.lowerBinId, maxBinId: ladder.upperBinId, strategyType: StrategyType.Spot },
        slippage: 1,
      });
      return { transactions: [priced(tx)], position };
    },

    async syncSteps({ pool, owner: ownerAddress, position, activeBinId }) {
      const owner = new PublicKey(ownerAddress);
      const dlmm = await open(pool);
      if (dlmm.lbPair.activeId === activeBinId) return null;
      /*
       * The steps are emptied and the pool's active bin taken to the price's in one transaction: `go_to_a_bin` moves
       * only through bins without liquidity, so the pair currency leaves the old steps first and comes back to the
       * executor's wallet; the next step puts it into the new ones.
       */
      const tx = new Transaction();
      const positionKey = position ? new PublicKey(position) : null;
      const read = positionKey ? await dlmm.getPosition(positionKey) : null;
      const hasLiquidity = read !== null && (new BN(read.positionData.totalXAmount).gtn(0) || new BN(read.positionData.totalYAmount).gtn(0));
      if (read && positionKey && hasLiquidity) {
        const removes = await dlmm.removeLiquidity({
          user: owner,
          position: positionKey,
          fromBinId: read.positionData.lowerBinId,
          toBinId: read.positionData.upperBinId,
          bps: new BN(10_000),
          shouldClaimAndClose: false,
        });
        for (const part of removes) tx.add(...part.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)));
      }
      tx.add(...(await goToBinInstructions(dlmm, activeBinId, owner)));
      tx.feePayer = owner;
      return priced(tx);
    },

    async placeSteps({ pool, owner: ownerAddress, position, ladder, amountRaw }) {
      const owner = new PublicKey(ownerAddress);
      /* Built against the pool as the chain shows it now: the rebalance names the active bin it expects. */
      const dlmm = await open(pool);
      const activeBinId = dlmm.lbPair.activeId;
      if (ladder.upperBinId >= activeBinId) throw new Error("The steps must sit below the pool's price.");
      const positionKey = new PublicKey(position);
      const read = await dlmm.getPosition(positionKey);
      const holds = new BN(read.positionData.totalYAmount).add(read.positionData.feeY);
      const amount = holds.add(new BN(amountRaw.toString()));
      const minDeltaId = ladder.lowerBinId - activeBinId;
      const maxDeltaId = ladder.upperBinId - activeBinId;
      const params = buildLiquidityStrategyParameters(new BN(0), amount, new BN(minDeltaId), new BN(maxDeltaId), new BN(dlmm.lbPair.binStep), false, new BN(activeBinId), getLiquidityStrategyParameterBuilder(StrategyType.Spot));
      const emptied = new BN(read.positionData.totalXAmount).isZero() && new BN(read.positionData.totalYAmount).isZero();
      const simulated = await dlmm.simulateRebalancePosition(
        positionKey,
        read.positionData,
        true,
        false,
        [{ minDeltaId: new BN(minDeltaId), maxDeltaId: new BN(maxDeltaId), x0: params.x0, y0: params.y0, deltaX: params.deltaX, deltaY: params.deltaY, favorXInActiveBin: false }],
        emptied ? [] : [{ minBinId: null, maxBinId: null, bps: new BN(10_000) }],
      );
      const built = await dlmm.rebalancePosition(simulated, new BN(0), owner, 1);
      const tx = new Transaction();
      tx.add(...(built.initBinArrayInstructions as TransactionInstruction[]), ...(built.rebalancePositionInstruction as TransactionInstruction[]));
      tx.feePayer = owner;
      return priced(tx);
    },

    async readSteps(pool, position) {
      const dlmm = await open(pool);
      const read = await dlmm.getPosition(new PublicKey(position)).catch(() => null);
      if (!read) return null;
      const data = read.positionData;
      return {
        position,
        lowerBinId: data.lowerBinId,
        upperBinId: data.upperBinId,
        pairRaw: data.totalYAmount,
        tokenRaw: data.totalXAmount,
        feePairRaw: data.feeY.toString(),
        bins: data.positionBinData.map((bin) => ({ binId: bin.binId, pairRaw: String(bin.positionYAmount), tokenRaw: String(bin.positionXAmount) })),
      };
    },
  };
}

/**
 * `go_to_a_bin` to a bin, with the bin arrays the program checks: the active bin's, and the next one holding liquidity
 * in that direction — as the client's own `syncWithMarketPrice` passes them, without its refusal, because here the
 * liquidity in those arrays is removed earlier in the same transaction.
 */
async function goToBinInstructions(dlmm: DLMM, binId: number, payer: PublicKey): Promise<TransactionInstruction[]> {
  const programId = dlmm.program.programId;
  const pool = dlmm.pubkey;
  const activeId = dlmm.lbPair.activeId;
  const swapForY = binId < activeId;
  const fromIndex = binIdToBinArrayIndex(new BN(activeId));
  const nextIndex = findNextBinArrayIndexWithLiquidity(swapForY, new BN(activeId), dlmm.lbPair, dlmm.binArrayBitmapExtension?.account ?? null);
  const targetIndex = binIdToBinArrayIndex(new BN(binId));
  const extension = isOverflowDefaultBinArrayBitmap(targetIndex) ? deriveBinArrayBitmapExtension(pool, programId)[0] : null;
  const [fromBinArray] = deriveBinArray(pool, fromIndex, programId);
  const toBinArray = nextIndex ? deriveBinArray(pool, nextIndex, programId)[0] : null;
  const [extensionInfo, fromInfo, toInfo] = await dlmm.program.provider.connection.getMultipleAccountsInfo([extension ?? fromBinArray, fromBinArray, toBinArray ?? fromBinArray]);
  const pre: TransactionInstruction[] = [];
  if (extension && !extensionInfo) {
    pre.push(await dlmm.program.methods.initializeBinArrayBitmapExtension().accountsPartial({ binArrayBitmapExtension: extension, funder: payer, lbPair: pool }).instruction());
  }
  const ix = await dlmm.program.methods
    .goToABin(binId)
    .accountsPartial({ lbPair: pool, binArrayBitmapExtension: extension, fromBinArray: fromInfo ? fromBinArray : null, toBinArray: toBinArray && toInfo ? toBinArray : null })
    .instruction();
  return [...pre, ix];
}

/**
 * A buy of the token for `amountRaw` of the pair currency in its graduated DAMM v2 pool — the proof a customizable
 * DLMM pool asks its creator for. The least out is one raw unit: the amount is a cent, and what it buys is kept.
 */
export async function proofBuyInstructions(connection: Connection, args: Readonly<{ pool: string; owner: PublicKey; amountRaw: bigint }>): Promise<TransactionInstruction[]> {
  const cpAmm = new CpAmm(connection);
  const poolKey = new PublicKey(args.pool);
  const state = await cpAmm.fetchPoolState(poolKey);
  const [infoA, infoB] = await connection.getMultipleAccountsInfo([state.tokenAMint, state.tokenBMint]);
  if (!infoA || !infoB) throw new Error("The graduated pool's mints could not be read.");
  const tx = await cpAmm.swap({
    payer: args.owner,
    pool: poolKey,
    inputTokenMint: state.tokenBMint,
    outputTokenMint: state.tokenAMint,
    amountIn: new BN(args.amountRaw.toString()),
    minimumAmountOut: new BN(1),
    tokenAMint: state.tokenAMint,
    tokenBMint: state.tokenBMint,
    tokenAVault: state.tokenAVault,
    tokenBVault: state.tokenBVault,
    tokenAProgram: infoA.owner,
    tokenBProgram: infoB.owner,
    referralTokenAccount: null,
    poolState: state,
  });
  return tx.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
}
