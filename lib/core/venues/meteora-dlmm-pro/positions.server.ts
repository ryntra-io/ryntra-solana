/**
 * Positions of DLMM Pro: one NFT that holds liquidity in up to 45 ranges, opened from a shape, added to,
 * taken from, its fees collected or put back, locked for ever, and looked after by a delegate.
 *
 * A position is a Token-2022 NFT and a program account at its mint; whoever holds the NFT owns it. Each of its ranges
 * is a **slot**, numbered in the order the ranges were given; ranges may overlap, so one position can hold a whole
 * shape. A slot's liquidity is unlocked, permanently locked, or vesting.
 *
 * - **open** — the ranges and their weights come from a liquidity shape (`./shapes.server.ts`), the liquidity from the
 *   two budgets: the largest that both afford (`multiplierFromAmounts`), so a deposit above the price takes token X
 *   only, below it token Y only. Opening, depositing and — when asked — locking are separate program calls; the build
 *   returns them as steps in order and, where they fit one message, as one transaction;
 * - **add** — more into slots that exist: in the proportions they already hold, or by the caller's weights — which is
 *   how a position that was opened and never funded is given its shape;
 * - **the price may move** between a build and its landing, and a deposit is taken at the price it lands at: of token
 *   X most at the lowest price, of token Y at the highest. So every deposit names a band of the price
 *   (`slippageBps`, of the price, either way): its liquidity is the most the budgets afford at the band's two ends, and
 *   each coin's cap is what the deposit takes at the end that takes most of it. Inside the band it lands; outside it
 *   the chain refuses it, so it neither fails on a trade against it nor goes in at whatever price the pool was pushed
 *   to. Zero is for a pool that is not trading yet;
 * - **what the wallet must hold** is checked before bytes are returned: the coins, and what the build itself takes in
 *   lamports — its fees and the rent of what it creates. A build in SOL needs both together;
 * - **remove** — a share of the unlocked liquidity of every slot, or of the slots named. Locked liquidity never
 *   leaves. What it pays moves with the price like a deposit does, so it is held to the same band: the least of each
 *   coin is what the slots pay at the end of the band that pays least of it;
 * - **collect** — the fees the position earned, after a refresh the same transaction makes;
 * - **compound** — collect and put back into one slot, in one transaction; the owner's alone: the coins go through
 *   the owner's accounts, which only the owner may move. Fees in one coin go into a range that takes that coin alone
 *   anywhere in the band;
 * - **lockPermanently** — moves a share of every slot's unlocked liquidity into permanent lock: it keeps earning and
 *   can never be taken out, by anyone;
 * - **delegate** — approves a wallet on the NFT's account (amount 0) and sets what it may do: add, remove, collect
 *   fees, collect rewards, change ranges. Whatever a delegate takes out the program pays only into the owner's own
 *   associated accounts; what it adds it pays from its own. A build signed by anyone but the holder is refused here
 *   unless that wallet is the approved delegate and the position lets it do that very thing;
 * - **close** — an empty position: burns the NFT and returns the rent.
 *
 * The NFT's mint is a fresh key the program creates the mint at, so it signs the opening once; the caller makes it and
 * passes its address — the venue holds no key. Everything else the wallet signs alone.
 */

import {
  MAX_LIQUIDITY_WEIGHT,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PoolExtension,
  PositionDelegatePermission,
  amountsFromShape,
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
  derivePosition,
  encodeAddLiquidityByWeight,
  findNftAccount,
  getAmountsFromLiquidity,
  getSqrtPriceFromTickId,
  isSupportExtension,
  liquidityBitmap,
  multiplierFromAmounts,
  positionDelegatePermissionMask,
  positionTotalLiquidity,
  tickIdFromSqrtPrice,
  type DecodedPosition,
  type DecodedPositionWithReward,
  type LiquidityRange,
  type Pool,
  type PositionArray,
} from "@meteora-ag/dlmm-pro-sdk";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createApproveInstruction, createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, createRevokeInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, type Mint } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import { DLMM_PRO_ACCOUNT_BYTES, assertAffords, assertHolds, assertOpen, assertSigner, bitmapExtensionFor, clientPastDust, clockOf, missingTickArrays, modelWith, poolWhole, tokenProgramOf, transferFeeMintOf, type DlmmProContext } from "./pools.server.ts";
import { DlmmProRefusal, refusing } from "./sdk.server.ts";
import { shapeOf, shapeViewOf, type ShapeRequest, type ShapeView } from "./shapes.server.ts";
import { MAX_POSITION_RANGES, isqrt, splitRangesForGrowth, tickArrayIndexOf } from "./ticks.ts";
import { DLMM_PRO_UNITS, bpsOf, keyOf, rawOf, seal, sealPacked, unitsOf, type DlmmProBuild, type DlmmProRent, type DlmmProTx, type SealOptions } from "./tx.server.ts";

/** The widest band of the price a deposit may be built for, basis points of the price either way. */
export const MAX_DEPOSIT_SLIPPAGE_BPS = 5_000;
/** A budget that binds nothing: the largest amount the program holds. */
const UNBOUND = (1n << 64n) - 1n;

export const POSITION_PERMISSIONS = ["addLiquidity", "removeLiquidity", "claimFee", "claimReward", "updateRange"] as const;
export type PositionPermission = (typeof POSITION_PERMISSIONS)[number];

const PERMISSION_BIT: Readonly<Record<PositionPermission, PositionDelegatePermission>> = {
  addLiquidity: PositionDelegatePermission.AddLiquidity,
  removeLiquidity: PositionDelegatePermission.RemoveLiquidity,
  claimFee: PositionDelegatePermission.ClaimFee,
  claimReward: PositionDelegatePermission.ClaimReward,
  updateRange: PositionDelegatePermission.UpdatePositionRange,
};

export type PositionSlotView = Readonly<{
  index: number;
  tickLowerId: number;
  tickUpperId: number;
  /** Whether the pool's price is inside the range: only such a slot earns. */
  inRange: boolean;
  liquidity: string;
  unlocked: string;
  lockedForEver: string;
  vesting: string;
  /** What the slot's whole liquidity is worth at the pool's price, per coin, rounded down. */
  xRaw: string;
  yRaw: string;
  /** Fees a collect would pay now, before transfer fees. */
  feeXRaw: string;
  feeYRaw: string;
  /** Rewards already accrued to the slot, per reward slot of the pool, before the reward coin's own transfer fee; what accrued since its last refresh is not in it. */
  rewardsAccruedRaw: readonly string[];
}>;

export type PositionView = Readonly<{
  position: Address;
  nftMint: Address;
  pool: Address;
  /** Goes up whenever ranges are added or removed: a build made against an older one is refused by the program. */
  layoutVersion: number;
  /** What a delegate approved on the NFT's account may do. */
  delegateMay: readonly PositionPermission[];
  slots: readonly PositionSlotView[];
  xRaw: string;
  yRaw: string;
  feeXRaw: string;
  feeYRaw: string;
  /** The share of the position's liquidity that can never be taken out, basis points. */
  lockedBps: number;
  /** No liquidity, no fees, no rewards in any slot: it can be closed. */
  empty: boolean;
}>;

export type OpenPositionRequest = Readonly<{
  pool: Address;
  /** The owner: it pays the coins and the rent, and signs. */
  wallet: Address;
  /** The address of the fresh key the position's NFT is minted at; the caller holds the key and signs with it once. */
  nftMint: Address;
  shape: ShapeRequest;
  /** The most of each coin to deposit, its own transfer fee included. Zero for a side the shape does not need. */
  amountXRaw: string;
  amountYRaw: string;
  /**
   * How far the price may move between the build and the landing, basis points of the price, either way. The deposit
   * is sized so that both budgets cover it anywhere in that band, and each coin's cap is what it takes at the end of
   * the band that takes most of that coin. Zero — the caps are exactly what the deposit takes now: right for a pool
   * that is not trading yet, a refusal by the chain on any move otherwise. A coin with a budget of nothing is not
   * offered at all: a price that moved to where the deposit needs it refuses the deposit.
   */
  slippageBps: number;
  /** Lock this share of what was deposited for ever, basis points; absent — nothing is locked. */
  lockBps?: number;
  /**
   * The most ranges the shape may take, 1 to 45; absent — 45. Every range costs rent the position keeps until it is
   * closed — and a position locked for ever is never closed — so fewer ranges is a coarser shape for less rent.
   */
  maxRanges?: number;
  /**
   * Hand the position over to this wallet as the last step: the NFT goes to the wallet's own account of it,
   * and with it the position, its fees and everything it may ever do. Before a pool opens only its early depositor may
   * open a position, and only in its own name — so a position meant for another is opened, funded and locked by the
   * depositor and handed over. Absent — the position stays the wallet's.
   */
  handOverTo?: Address;
  /**
   * What lands before this opening does, in the same approval of the wallet — a swap in this very pool, sent first
   * (`./earn.server.ts`). The opening is then built for the pool as that swap leaves it: its shape and its deposit
   * stand at `sqrtPriceX64` and `tickId`, the price the swap's quote ends at, and the band of the price is around
   * that. `spends…` is what the swap takes out of the wallet ahead of the deposit and `brings…` the least it pays in,
   * so the wallet is held to what it has now, less the one, plus the other; `lamports` is what the swap itself costs —
   * its fee and the rent it leaves. A trade that lands between the two moves the price like any other: inside the
   * band the deposit lands, outside it the chain refuses it and the coins stay in the wallet.
   */
  ahead?: Readonly<{ sqrtPriceX64: string; tickId: number; spendsXRaw: string; spendsYRaw: string; bringsXRaw: string; bringsYRaw: string; lamports: number }>;
  /**
   * How the deposit is sized. `band` (the default) — here, once: the liquidity both budgets afford at both ends of
   * the band, so it lands anywhere in it and leaves out what the price it lands at did not ask for. `landing` — by the
   * program, at the price the deposit lands at: the most both budgets afford there, so next to nothing is left out —
   * for a position of one range only (the program's `add_liquidity_imbalance` fills one slot). The band then only
   * says where the deposit may land at all; `deposit` tells what it takes at the price it was built for, and its
   * `maximum…` are the budgets themselves.
   */
  sizing?: "band" | "landing";
}>;

export type OpenRole = "OPEN" | "WIDEN" | "DEPOSIT" | "LOCK" | "HANDOVER";

export type OpenPositionBuild = DlmmProRent &
  Readonly<{
  /** In the order they are sent, one program call each: open, widen (when the ranges need more than one call), deposit, lock. */
  steps: readonly (DlmmProTx & Readonly<{ role: OpenRole }>)[];
  /**
   * The same in the fewest transactions that hold them — one, for a position of few ranges; each says which steps it
   * carries. A caller sends either `steps` or `packed`, never both.
   */
  packed: readonly (DlmmProTx & Readonly<{ roles: readonly OpenRole[] }>)[];
  position: Address;
  nftMint: Address;
  /** The NFT's account while the opening wallet holds it; after a hand-over it is closed, and the NFT is in `handedTo.nftAccount`. */
  nftAccount: Address;
  /** Who the position is handed over to as its last step, and the account its NFT then lives in; null — nobody. */
  handedTo: Readonly<{ owner: Address; nftAccount: Address }> | null;
  /**
   * The tick arrays the opening makes — those its ranges stand in that were not on chain when it was built — each a
   * head in its rent. Two openings built at one moment on the same ticks both count them, and only the first to land
   * pays: a caller that sends the two in order takes them off the second.
   */
  newTickArrays: number;
  shape: ShapeView;
  deposit: DepositView;
}>;
/* What an opening tells of its rent is for the whole position, whichever of `steps` or `packed` is sent. */

/**
 * A deposit in numbers. `xRaw`/`yRaw` — what the pool receives at the price the deposit was built at; `paid…` — what
 * leaves the wallet for it, the coin's own transfer fee on top; `maximum…` — the most that may leave the wallet
 * anywhere in the band the price may move in, never above the budget; `multiplier` — the liquidity bought per unit of
 * weight.
 */
export type DepositView = Readonly<{ xRaw: string; yRaw: string; paidXRaw: string; paidYRaw: string; maximumXRaw: string; maximumYRaw: string; multiplier: string }>;

const big = (value: { toString(): string }) => BigInt(value.toString());
const bn = (value: bigint) => new BN(value.toString());

export function createDlmmProPositions(context: DlmmProContext) {
  const { connection, client } = context;
  const programId = client.program.programId;

  async function loaded(poolKey: PublicKey, nftMint: PublicKey) {
    const { pool, extensions } = await poolWhole(context, poolKey);
    const withReward = isSupportExtension(pool.extensions, PoolExtension.LiquidityMining);
    const positionKey = derivePosition(nftMint, programId);
    const missing = (error: unknown) => {
      if (error instanceof Error && /Account not found|is not owned by|Invalid account discriminator/i.test(error.message)) throw new DlmmProRefusal("BAD_INPUT", "No position lives at this NFT.");
      throw error;
    };
    /* The head first: a position's slots are longer on a pool with rewards, so those of another pool's position would not even decode. */
    const head = await client.state.fetchPositionArray(positionKey).catch(missing);
    if (!head.pool.equals(poolKey)) throw new DlmmProRefusal("BAD_INPUT", "The position belongs to another pool.");
    const read: Readonly<{ positionArray: PositionArray; positions: DecodedPosition[] | DecodedPositionWithReward[] }> = await client.state.fetchPositionArrayWithPositions(positionKey, { withReward }).catch(missing);
    return { pool, extensions, withReward, positionKey, head: read.positionArray, slots: read.positions as readonly (DecodedPosition & Partial<DecodedPositionWithReward>)[] };
  }

  const rangeOf = (slot: Pick<DecodedPosition, "tickLowerId" | "tickUpperId">) => ({ tickLowerId: slot.tickLowerId, tickUpperId: slot.tickUpperId });

  /** Whether the position lets a delegate do one thing: the permission bit on its account. */
  const mayDelegate = (head: Pick<PositionArray, "delegatePermission">, permission: PositionPermission) => (head.delegatePermission & (1 << PERMISSION_BIT[permission])) !== 0;

  /** The compute ceiling of a call that opens or widens a position with these ranges: by their distinct ticks and the tick arrays those fall in. */
  const openingUnits = (group: readonly Readonly<{ tickLowerId: number; tickUpperId: number }>[], tickSpacing: number) => {
    const ticks = new Set(group.flatMap((range) => [range.tickLowerId, range.tickUpperId]));
    const arrays = new Set([...ticks].map((tick) => tickArrayIndexOf(tick, tickSpacing)));
    return unitsOf(DLMM_PRO_UNITS.openPosition.base, DLMM_PRO_UNITS.openPosition.perTick, ticks.size, DLMM_PRO_UNITS.openPosition.perArray * arrays.size);
  };

  /** The two ends of a band of the price around `sqrtPrice`, as square-root prices: `bps` of the price either way, inside the program's own limits. */
  const bandOf = (sqrtPrice: bigint, bps: number) => {
    const square = sqrtPrice * sqrtPrice;
    const within = (value: bigint) => (value < big(MIN_SQRT_PRICE) ? big(MIN_SQRT_PRICE) : value > big(MAX_SQRT_PRICE) ? big(MAX_SQRT_PRICE) : value);
    return { low: within(isqrt((square * BigInt(10_000 - bps)) / 10_000n)), high: within(isqrt((square * BigInt(10_000 + bps)) / 10_000n)) };
  };

  /**
   * The liquidity two budgets buy for weighted ranges, and the most the deposit may take of each coin, when the price
   * may move by `slippageBps` of itself either way before the deposit lands.
   *
   * A deposit is taken at the price it lands at: of token X it takes most at the lowest price, of token Y at the
   * highest. So the liquidity is the largest that fits the X budget at the band's low end and the Y budget at its high
   * end, and each coin's cap — what the program holds the deposit to — is what it takes there, with the coin's own
   * transfer fee, never above its budget. Anywhere inside the band the deposit lands; outside it the chain refuses
   * it. A coin with a budget of nothing has a cap of nothing. With a band of nothing the caps are exactly what the
   * deposit takes now.
   */
  function sized(args: Readonly<{ ranges: LiquidityRange[]; pool: Pool; amountX: bigint; amountY: bigint; slippageBps: number; mintX: Mint | null; mintY: Mint | null; epoch: bigint }>) {
    const { ranges, pool } = args;
    type Price = Readonly<{ currentSqrtPrice: BN; currentTickId: number }>;
    const now: Price = { currentSqrtPrice: pool.sqrtPrice, currentTickId: pool.tickCurrentId };
    const at = (sqrtPrice: bigint): Price => ({ currentSqrtPrice: bn(sqrtPrice), currentTickId: tickIdFromSqrtPrice(bn(sqrtPrice)) });
    const band = bandOf(big(pool.sqrtPrice), args.slippageBps);
    const low = args.slippageBps === 0 ? now : at(band.low);
    const high = args.slippageBps === 0 ? now : at(band.high);
    const fits = (where: Price, amountX: bigint, amountY: bigint) => multiplierFromAmounts({ ranges, tickSpacing: pool.tickSpacing, ...where, amountX: bn(amountX), amountY: bn(amountY), mintX: args.mintX, mintY: args.mintY, epoch: args.epoch });
    /* What the budgets buy at the price now: the SDK itself refuses budgets that buy nothing, or a shape that needs now a coin that is not offered. */
    let multiplier = fits(now, args.amountX, args.amountY);
    if (args.slippageBps > 0) {
      if (args.amountX > 0n) multiplier = BN.min(multiplier, fits(low, args.amountX, UNBOUND));
      if (args.amountY > 0n) multiplier = BN.min(multiplier, fits(high, UNBOUND, args.amountY));
    }
    if (multiplier.isZero()) throw new DlmmProRefusal("AMOUNT_ZERO", "The amounts are too small to buy any liquidity in this shape.");
    const takes = (where: Price) => amountsFromShape({ ranges, ...where, multiplier }).reduce((sum, item) => ({ x: sum.x + big(item.amountX), y: sum.y + big(item.amountY) }), { x: 0n, y: 0n });
    const paid = (amount: bigint, mint: Mint | null) => (amount === 0n ? 0n : big(calculateTransferFeeIncludedAmount(mint, args.epoch, bn(amount)).amount));
    const capOf = (most: bigint, budget: bigint, mint: Mint | null) => {
      const cost = paid(most, mint);
      return cost < budget ? cost : budget;
    };
    const taken = takes(now);
    const maximumX = capOf(takes(low).x, args.amountX, args.mintX);
    const maximumY = capOf(takes(high).y, args.amountY, args.mintY);
    const view: DepositView = {
      xRaw: taken.x.toString(),
      yRaw: taken.y.toString(),
      paidXRaw: paid(taken.x, args.mintX).toString(),
      paidYRaw: paid(taken.y, args.mintY).toString(),
      maximumXRaw: maximumX.toString(),
      maximumYRaw: maximumY.toString(),
      multiplier: multiplier.toString(),
    };
    return { multiplier, maximumX, maximumY, view };
  }

  /** The two coins of a pool with their token programs, for whoever holds or receives them. */
  const coinsOf = (pool: Pool) => [
    { mint: pool.tokenXMint, program: tokenProgramOf(pool.tokenXFlag) },
    { mint: pool.tokenYMint, program: tokenProgramOf(pool.tokenYFlag) },
  ];
  /** Refuses a build whose signer cannot pay its fees and the rent of the token accounts it opens — or that pays into a frozen account. */
  const assertPaysFor = (signer: PublicKey, sealed: Pick<DlmmProTx, "feeLamports">, instructions: readonly TransactionInstruction[], receives: readonly PublicKey[] = []) =>
    assertAffords(connection, signer, [], { fee: BigInt(sealed.feeLamports), instructions, receives });
  /** The owner's own accounts of the pool's coins that a build pays anything into: a frozen one takes nothing. */
  const receivingOf = (pool: Pool, owner: PublicKey, x: bigint, y: bigint) =>
    coinsOf(pool)
      .filter((_, index) => (index === 0 ? x : y) > 0n)
      .map((coin) => getAssociatedTokenAddressSync(coin.mint, owner, true, coin.program));
  /** What an amount of a coin is once its own transfer fee is taken: what arrives. */
  const arrives = (amount: BN, mint: Mint | null, epoch: bigint) => big(calculateTransferFeeExcludedAmount(mint, epoch, amount).amount);

  /**
   * The token program's own hand-over of a position's NFT: the receiver's account of it is made where it is not there,
   * the NFT moves, and the giver's emptied account is closed — its rent comes back to the giver and all but pays for the
   * receiver's. A position's NFT has no rule against a transfer: its mint carries a metadata pointer, its metadata and
   * a close authority, nothing more.
   */
  const handOverInstructions = (nftMint: PublicKey, from: PublicKey, to: PublicKey): TransactionInstruction[] => {
    const source = findNftAccount(nftMint, from);
    const target = findNftAccount(nftMint, to);
    return [
      createAssociatedTokenAccountIdempotentInstruction(from, target, to, nftMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      createTransferCheckedInstruction(source, nftMint, target, from, 1, 0, [], TOKEN_2022_PROGRAM_ID),
      createCloseAccountInstruction(source, from, from, [], TOKEN_2022_PROGRAM_ID),
    ];
  };
  /** The receiver of a hand-over as a key: a wallet other than the giver, never the NFT's own mint. */
  const receiverOf = (address: Address, giver: PublicKey, nftMint: PublicKey) => {
    const to = keyOf(address, "The receiver");
    if (to.equals(giver)) throw new DlmmProRefusal("BAD_INPUT", "The position is already this wallet's: there is nobody to hand it over to.");
    if (to.equals(nftMint) || to.equals(PublicKey.default)) throw new DlmmProRefusal("BAD_INPUT", "The receiver is not a wallet.");
    return to;
  };

  const worthOf = (pool: Pool, slot: DecodedPosition, liquidity: BN) =>
    /* A negative liquidity asks for the amounts a withdrawal pays: rounded down. */
    getAmountsFromLiquidity({ tickCurrentId: pool.tickCurrentId, tickLowerId: slot.tickLowerId, tickUpperId: slot.tickUpperId, currentSqrtPrice: pool.sqrtPrice, liquidity: liquidity.neg() });
  /** The same at another price: what a withdrawal that lands there pays. */
  const worthAt = (sqrtPrice: bigint, slot: DecodedPosition, liquidity: BN) =>
    getAmountsFromLiquidity({ tickCurrentId: tickIdFromSqrtPrice(bn(sqrtPrice)), tickLowerId: slot.tickLowerId, tickUpperId: slot.tickUpperId, currentSqrtPrice: bn(sqrtPrice), liquidity: liquidity.neg() });

  /** What a swap sent ahead of an opening leaves behind, as numbers: refused unless every one of them is a number it can be. */
  const aheadOf = (ahead: NonNullable<OpenPositionRequest["ahead"]>) => {
    if (typeof ahead.sqrtPriceX64 !== "string" || !/^\d{1,40}$/.test(ahead.sqrtPriceX64)) throw new DlmmProRefusal("BAD_INPUT", "The price the swap ends at is not a square-root price.");
    const sqrtPrice = BigInt(ahead.sqrtPriceX64);
    if (sqrtPrice < big(MIN_SQRT_PRICE) || sqrtPrice > big(MAX_SQRT_PRICE)) throw new DlmmProRefusal("BAD_INPUT", "The price the swap ends at is outside the program's own limits.");
    if (!Number.isInteger(ahead.tickId) || tickIdFromSqrtPrice(bn(sqrtPrice)) !== ahead.tickId) throw new DlmmProRefusal("BAD_INPUT", "The tick the swap ends at is not the tick of the price it ends at.");
    if (!Number.isSafeInteger(ahead.lamports) || ahead.lamports < 0) throw new DlmmProRefusal("BAD_INPUT", "What the swap costs is a whole number of lamports.");
    return {
      sqrtPrice,
      tickId: ahead.tickId,
      spendsX: rawOf(ahead.spendsXRaw, "What the swap takes of token X"),
      spendsY: rawOf(ahead.spendsYRaw, "What the swap takes of token Y"),
      bringsX: rawOf(ahead.bringsXRaw, "What the swap brings of token X"),
      bringsY: rawOf(ahead.bringsYRaw, "What the swap brings of token Y"),
      lamports: ahead.lamports,
    };
  };

  /** A position: its slots, what they are worth, what they have earned. */
  async function read(request: Readonly<{ pool: Address; nftMint: Address }>): Promise<PositionView> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const state = await loaded(poolKey, nftMint);
      const claimable = await client.position.getClaimableFees({ pool: poolKey, nftMint });
      let x = 0n;
      let y = 0n;
      let all = 0n;
      let locked = 0n;
      let pendingRewards = false;
      const slots = state.slots.map((slot, index): PositionSlotView => {
        const total = positionTotalLiquidity(slot);
        const worth = total.isZero() ? { amountX: new BN(0), amountY: new BN(0) } : worthOf(state.pool, slot, total);
        const fees = claimable.slots[index];
        x += big(worth.amountX);
        y += big(worth.amountY);
        all += big(total);
        locked += big(slot.permanentLockedLiquidity);
        const rewards = (slot.rewards ?? []).map((reward) => reward.pendingAmount.toString());
        if (rewards.some((amount) => amount !== "0")) pendingRewards = true;
        return {
          index,
          ...rangeOf(slot),
          inRange: slot.tickLowerId <= state.pool.tickCurrentId && state.pool.tickCurrentId < slot.tickUpperId,
          liquidity: total.toString(),
          unlocked: slot.unlockedLiquidity.toString(),
          lockedForEver: slot.permanentLockedLiquidity.toString(),
          vesting: slot.vestingLiquidity.toString(),
          xRaw: worth.amountX.toString(),
          yRaw: worth.amountY.toString(),
          feeXRaw: (fees?.feeX ?? new BN(0)).toString(),
          feeYRaw: (fees?.feeY ?? new BN(0)).toString(),
          rewardsAccruedRaw: rewards,
        };
      });
      return {
        position: state.positionKey.toBase58(),
        nftMint: nftMint.toBase58(),
        pool: poolKey.toBase58(),
        layoutVersion: state.head.layoutVersion,
        delegateMay: POSITION_PERMISSIONS.filter((name) => (state.head.delegatePermission & (1 << PERMISSION_BIT[name])) !== 0),
        slots,
        xRaw: x.toString(),
        yRaw: y.toString(),
        feeXRaw: claimable.feeX.toString(),
        feeYRaw: claimable.feeY.toString(),
        lockedBps: all === 0n ? 0 : Number((locked * 10_000n) / all),
        empty: all === 0n && claimable.feeX.isZero() && claimable.feeY.isZero() && !pendingRewards,
      };
    });
  }

  /**
   * What a position's whole liquidity — unlocked, locked and vesting — is worth at a price the caller names, per coin,
   * rounded down as a withdrawal is. A slot's liquidity does not change when the pool trades, so at the pool's first
   * price this is what the position was given, whatever has been bought since (a launch's supply, read back
   * after trading began).
   */
  async function worthAtPrice(request: Readonly<{ pool: Address; nftMint: Address; sqrtPriceX64: string }>): Promise<Readonly<{ xRaw: string; yRaw: string }>> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      if (!/^\d{1,40}$/.test(request.sqrtPriceX64)) throw new DlmmProRefusal("BAD_INPUT", "The price is not a square-root price.");
      const sqrtPrice = BigInt(request.sqrtPriceX64);
      if (sqrtPrice < big(MIN_SQRT_PRICE) || sqrtPrice > big(MAX_SQRT_PRICE)) throw new DlmmProRefusal("BAD_INPUT", "The price is outside the program's range.");
      const state = await loaded(poolKey, nftMint);
      let x = 0n;
      let y = 0n;
      for (const slot of state.slots) {
        const total = positionTotalLiquidity(slot);
        if (total.isZero()) continue;
        const worth = worthAt(sqrtPrice, slot, total);
        x += big(worth.amountX);
        y += big(worth.amountY);
      }
      return { xRaw: x.toString(), yRaw: y.toString() };
    });
  }

  /** A position opened from a shape and funded — unsigned steps; the wallet signs each, the fresh NFT mint the first. */
  async function open(request: OpenPositionRequest, options: SealOptions = {}): Promise<OpenPositionBuild> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const wallet = keyOf(request.wallet, "The wallet");
      const nftMint = keyOf(request.nftMint, "The position's NFT mint");
      const amountX = rawOf(request.amountXRaw, "The amount of token X");
      const amountY = rawOf(request.amountYRaw, "The amount of token Y");
      if (amountX === 0n && amountY === 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "Both amounts are zero.");
      const lockBps = request.lockBps === undefined ? null : bpsOf(request.lockBps, "The share to lock", 1, 10_000);
      const slippageBps = bpsOf(request.slippageBps, "The band of the price", 0, MAX_DEPOSIT_SLIPPAGE_BPS);
      const handOverTo = request.handOverTo === undefined ? null : receiverOf(request.handOverTo, wallet, nftMint);
      const { model, pool, clock } = await modelWith(context, poolKey, wallet.toBase58());
      assertOpen(model, "addLiquidity");
      if (request.maxRanges !== undefined && (!Number.isInteger(request.maxRanges) || request.maxRanges < 1 || request.maxRanges > MAX_POSITION_RANGES)) throw new DlmmProRefusal("BAD_INPUT", `A position holds 1 to ${MAX_POSITION_RANGES} ranges.`);
      /* The price the opening is built for: the pool's own, or the one a swap sent ahead of it leaves the pool at. */
      const ahead = request.ahead ? aheadOf(request.ahead) : null;
      const priced: Pool = ahead ? { ...pool, sqrtPrice: bn(ahead.sqrtPrice), tickCurrentId: ahead.tickId } : pool;
      /* A position is built from a shape's ranges alone: an even shape of any width is one range. */
      const shape = shapeOf(request.shape, priced, request.maxRanges ?? MAX_POSITION_RANGES, "ranges");
      const ranges = shape.ranges;
      const [mintX, mintY] = await Promise.all([transferFeeMintOf(connection, pool.tokenXMint), transferFeeMintOf(connection, pool.tokenYMint)]);
      const atLanding = request.sizing === "landing";
      if (request.sizing !== undefined && request.sizing !== "band" && !atLanding) throw new DlmmProRefusal("BAD_INPUT", "A deposit is sized for its band, or at the price it lands at.");
      if (atLanding && ranges.length !== 1) throw new DlmmProRefusal("BAD_INPUT", "Only a position of one range is sized at the price it lands at.");
      /* Sized at landing, the build still tells what the deposit takes at the price it was built for; its caps are the budgets. */
      const told = sized({ ranges, pool: priced, amountX, amountY, slippageBps: atLanding ? 0 : slippageBps, mintX, mintY, epoch: clock.epoch });
      const size = atLanding ? { ...told, maximumX: amountX, maximumY: amountY, view: { ...told.view, maximumXRaw: amountX.toString(), maximumYRaw: amountY.toString() } } : told;
      const groups = splitRangesForGrowth(ranges, pool.tickSpacing, model.extensions.liquidityMining);
      /*
       * No layout version is named for a position these very steps open: the program's check guards a build against a
       * delegate that reordered the ranges since, and a position made a moment ago by its own wallet has none.
       */
      const parameters = encodeAddLiquidityByWeight({ ranges, maxAmountX: bn(size.maximumX), maxAmountY: bn(size.maximumY), multiplier: size.multiplier });
      const tickRanges = ranges.map(rangeOf);

      const opened = await client.position.openPosition({ pool: poolKey, owner: wallet, payer: wallet, nftMint, tickRanges: groups[0]!.map(rangeOf) });
      const parts: { role: OpenRole; instructions: readonly TransactionInstruction[]; units: number; fresh: readonly PublicKey[] }[] = [
        { role: "OPEN", instructions: opened.tx.instructions, units: openingUnits(groups[0]!, pool.tickSpacing), fresh: [nftMint] },
      ];
      for (const group of groups.slice(1)) {
        const widened = await client.position.expandPosition({ pool: poolKey, signer: wallet, payer: wallet, nftMint, owner: wallet, tickRanges: group.map(rangeOf) });
        parts.push({ role: "WIDEN", instructions: widened.tx.instructions, units: openingUnits(group, pool.tickSpacing), fresh: [] });
      }
      const sdk = await clientPastDust(context, [wallet], coinsOf(pool));
      /* Ranges beyond the pool's own bitmap of tick arrays, on a pool with no extension yet: the deposit makes it first. */
      const extension = await bitmapExtensionFor(client, poolKey, pool, ranges.flatMap((range) => [range.tickLowerId, range.tickUpperId]), wallet);
      const depositAccounts = { pool: poolKey, nftMint, owner: wallet, signer: wallet, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges, ...(extension.extension ? { tickArrayBitmapExtension: extension.extension } : {}) };
      const landingBand = bandOf(big(priced.sqrtPrice), slippageBps);
      const deposited = atLanding
        ? await sdk.position.addLiquidityImbalance({
            ...depositAccounts,
            /* A coin with a budget of nothing is not offered: the program takes that only where the range needs none of it at the price it lands at. */
            parameters: { maxAmountX: amountX > 0n ? bn(amountX) : null, maxAmountY: amountY > 0n ? bn(amountY) : null, slippage: { sqrtPriceSlippage: { minSqrtPrice: bn(landingBand.low), maxSqrtPrice: bn(landingBand.high) }, minLiquidity: null }, expectedLayoutVersion: null, index: 0 },
          })
        : await sdk.position.addLiquidityByWeight({ ...depositAccounts, parameters });
      parts.push({
        role: "DEPOSIT",
        instructions: [...extension.make, ...deposited.tx.instructions],
        units: unitsOf(atLanding ? DLMM_PRO_UNITS.addLiquidityAtLanding.base : DLMM_PRO_UNITS.addLiquidity.base, DLMM_PRO_UNITS.addLiquidity.perRange, ranges.length, 2 * DLMM_PRO_UNITS.tokenAccount + extension.units),
        fresh: [],
      });
      if (lockBps !== null) {
        const lockedTx = await client.position.lockPermanentPosition({ pool: poolKey, nftMint, owner: wallet, bps: lockBps });
        parts.push({ role: "LOCK", instructions: lockedTx.tx.instructions, units: unitsOf(DLMM_PRO_UNITS.lockPermanent.base, DLMM_PRO_UNITS.lockPermanent.perRange, ranges.length), fresh: [] });
      }
      /* The hand-over goes last: what was deposited and locked is the receiver's from the moment the NFT moves. */
      const handOver = handOverTo ? handOverInstructions(nftMint, wallet, handOverTo) : [];
      if (handOverTo) parts.push({ role: "HANDOVER", instructions: handOver, units: DLMM_PRO_UNITS.handOver, fresh: [] });

      const blockhash = options.blockhash ?? (await connection.getLatestBlockhash("confirmed"));
      /* Each step keeps its own ceiling: a caller's single `units` is not the limit of several program calls. */
      const shared = { ...options, blockhash, units: undefined };
      const steps = await Promise.all(parts.map(async (part) => ({ ...(await seal({ connection, wallet, instructions: part.instructions, units: part.units, fresh: part.fresh, options: shared })), role: part.role })));
      const packed = await sealPacked({ connection, wallet, parts, options: shared });
      /*
       * What the wallet must hold for all of it: both coins up to their caps, the fees of every step, and the rent of the
       * position — its NFT, its head, a slot and two ticks for each range, a head for every tick array that is not
       * there yet, any token account the deposit opens, and the pool's bitmap extension where the deposit makes it.
       */
      const sizes = DLMM_PRO_ACCOUNT_BYTES;
      const withRewards = model.extensions.liquidityMining;
      const arrays = await missingTickArrays(context, poolKey, ranges.flatMap((range) => [range.tickLowerId, range.tickUpperId]), pool.tickSpacing);
      const cost = await assertAffords(
        connection,
        wallet,
        /* With a swap sent ahead: what the wallet has now must cover the deposit and what the swap takes, less the least the swap pays in. */
        coinsOf(pool).map((coin, index) => {
          const most = index === 0 ? size.maximumX : size.maximumY;
          const before = ahead ? most + (index === 0 ? ahead.spendsX : ahead.spendsY) - (index === 0 ? ahead.bringsX : ahead.bringsY) : most;
          return { ...coin, amount: before > 0n ? before : 0n };
        }),
        {
          fee: steps.reduce((sum, step) => sum + BigInt(step.feeLamports), 0n) + BigInt(ahead?.lamports ?? 0),
          /* The receiver's account of the NFT is one more account the build opens; the giver's closed one returns its rent, which is not counted towards what the wallet must hold. */
          instructions: [...deposited.tx.instructions, ...handOver.slice(0, 1)],
          accounts: [sizes.nftMint, sizes.nftAccount, sizes.positionHead, ...Array.from({ length: arrays }, () => sizes.tickArrayHead), ...extension.accounts],
          bytes: ranges.length * (withRewards ? sizes.positionSlotWithRewards + 2 * sizes.tickWithRewards : sizes.positionSlot + 2 * sizes.tick),
        },
      );
      return {
        steps,
        packed,
        ...cost,
        position: opened.position.toBase58(),
        nftMint: nftMint.toBase58(),
        nftAccount: opened.nftAccount.toBase58(),
        handedTo: handOverTo ? { owner: handOverTo.toBase58(), nftAccount: findNftAccount(nftMint, handOverTo).toBase58() } : null,
        newTickArrays: arrays,
        shape: shapeViewOf(request.shape.strategy, shape),
        deposit: size.view,
      };
    });
  }

  /**
   * More into a position's slots: by `weights` — one per slot named, 1 to 255 — or, without them, in the proportions
   * the slots already hold (evenly into slots that hold nothing). `slots` — the slots to add to; absent — all, in
   * their order. `slippageBps` — the band the price may move in, as in `open`. The signer pays: the owner, or a
   * delegate that may add.
   */
  async function add(
    request: Readonly<{ pool: Address; nftMint: Address; owner: Address; signer?: Address; amountXRaw: string; amountYRaw: string; slippageBps: number; slots?: readonly number[]; weights?: readonly number[] }>,
    options: SealOptions = {},
  ): Promise<DlmmProBuild & Readonly<{ deposit: DepositView }>> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const signer = request.signer ? keyOf(request.signer, "The signer") : owner;
      const amountX = rawOf(request.amountXRaw, "The amount of token X");
      const amountY = rawOf(request.amountYRaw, "The amount of token Y");
      if (amountX === 0n && amountY === 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "Both amounts are zero.");
      const slippageBps = bpsOf(request.slippageBps, "The band of the price", 0, MAX_DEPOSIT_SLIPPAGE_BPS);
      const state = await loaded(poolKey, nftMint);
      await assertSigner(connection, nftMint, owner, signer, mayDelegate(state.head, "addLiquidity"), "the position");
      const { model, pool, clock } = await modelWith(context, poolKey, owner.toBase58());
      assertOpen(model, "addLiquidity");
      const named = request.slots ?? state.slots.map((_, index) => index);
      if (named.length === 0 || new Set(named).size !== named.length || named.some((index) => !Number.isInteger(index) || index < 0 || index >= state.slots.length)) throw new DlmmProRefusal("BAD_INPUT", "A slot named is not one of the position's, or is named twice.");
      if (request.weights && (request.weights.length !== named.length || request.weights.some((weight) => !Number.isInteger(weight) || weight < 1 || weight > MAX_LIQUIDITY_WEIGHT))) {
        throw new DlmmProRefusal("BAD_INPUT", `A weight is given for every slot named, each a whole number from 1 to ${MAX_LIQUIDITY_WEIGHT}.`);
      }
      const held = named.map((index) => big(positionTotalLiquidity(state.slots[index]!)));
      const most = held.reduce((max, value) => (value > max ? value : max), 0n);
      /* Without the caller's weights: 1…255 in the proportions held; a slot with nothing gets the least, and an empty position is filled evenly. */
      const weightOf = (at: number) => request.weights?.[at] ?? (most === 0n ? 1 : Math.max(1, Number((held[at]! * 255n + most / 2n) / most)));
      const chosen = named.map((index, at) => ({ index, weight: weightOf(at) })).sort((a, b) => a.index - b.index);
      const indexes = chosen.map((entry) => entry.index);
      const ranges: LiquidityRange[] = chosen.map((entry) => ({ ...rangeOf(state.slots[entry.index]!), weight: entry.weight }));
      const [mintX, mintY] = await Promise.all([transferFeeMintOf(connection, pool.tokenXMint), transferFeeMintOf(connection, pool.tokenYMint)]);
      const size = sized({ ranges, pool, amountX, amountY, slippageBps, mintX, mintY, epoch: clock.epoch });
      const parameters = encodeAddLiquidityByWeight({ ranges, positionIndexes: indexes, maxAmountX: bn(size.maximumX), maxAmountY: bn(size.maximumY), multiplier: size.multiplier, expectedLayoutVersion: state.head.layoutVersion });
      /* A deposit is paid from the signer's own accounts — the owner's, or its delegate's. */
      const sdk = await clientPastDust(context, [signer], coinsOf(pool));
      /* A position opened and never funded may stand beyond the pool's own bitmap of tick arrays: its first deposit makes the extension. */
      const extension = await bitmapExtensionFor(client, poolKey, pool, ranges.flatMap((range) => [range.tickLowerId, range.tickUpperId]), signer);
      const built = await sdk.position.addLiquidityByWeight({ pool: poolKey, nftMint, owner, signer, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges: ranges.map(rangeOf), parameters, ...(extension.extension ? { tickArrayBitmapExtension: extension.extension } : {}) });
      const sealed = await seal({
        connection,
        wallet: signer,
        instructions: [...extension.make, ...built.tx.instructions],
        units: unitsOf(DLMM_PRO_UNITS.addLiquidity.base, DLMM_PRO_UNITS.addLiquidity.perRange, ranges.length, 2 * DLMM_PRO_UNITS.tokenAccount + extension.units),
        options,
      });
      const cost = await assertAffords(connection, signer, coinsOf(pool).map((coin, index) => ({ ...coin, amount: index === 0 ? size.maximumX : size.maximumY })), { fee: BigInt(sealed.feeLamports), instructions: built.tx.instructions, accounts: extension.accounts });
      return { ...sealed, ...cost, deposit: size.view };
    });
  }

  /**
   * Takes out a share of the unlocked liquidity — of every slot, or of the slots named — into the owner's accounts.
   *
   * What a removal pays moves with the price: of token X least at the highest price, of token Y at the lowest — and
   * near a range's edge one of the two goes to nothing. So `slippageBps` is a band of the price, either way, as in a
   * deposit: `minimum` is what the slots pay at the end of the band that pays least of each coin, after the coin's own
   * transfer fee. Inside the band the removal lands; a price pushed outside it refuses it. `expected` is what it pays
   * at the price it was built at. Zero — exactly what it pays now: any move of the price refuses it.
   *
   * A coin the removal may pay anywhere in its band is paid into the owner's account of it — a frozen one refuses the
   * build — though at the price of the build it pays none of that coin: a narrower band, which pays it nowhere, is
   * still built.
   */
  async function remove(
    request: Readonly<{ pool: Address; nftMint: Address; owner: Address; signer?: Address; bps: number; slots?: readonly number[]; slippageBps: number }>,
    options: SealOptions = {},
  ): Promise<DlmmProBuild & Readonly<{ expected: Readonly<{ xRaw: string; yRaw: string }>; minimum: Readonly<{ xRaw: string; yRaw: string }> }>> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const signer = request.signer ? keyOf(request.signer, "The signer") : owner;
      const bps = bpsOf(request.bps, "The share to take out", 1, 10_000);
      const slippageBps = bpsOf(request.slippageBps, "The band of the price", 0, MAX_DEPOSIT_SLIPPAGE_BPS);
      const state = await loaded(poolKey, nftMint);
      await assertSigner(connection, nftMint, owner, signer, mayDelegate(state.head, "removeLiquidity"), "the position");
      const { model, pool, clock } = await modelWith(context, poolKey, owner.toBase58());
      assertOpen(model, "removeLiquidity");
      const named = request.slots ? [...new Set(request.slots)].sort((a, b) => a - b) : null;
      if (named && (named.length === 0 || named.some((index) => !Number.isInteger(index) || index < 0 || index >= state.slots.length))) throw new DlmmProRefusal("BAD_INPUT", "A slot named is not one of the position's.");
      const indexes = (named ?? state.slots.map((_, index) => index)).filter((index) => !state.slots[index]!.unlockedLiquidity.muln(bps).divn(10_000).isZero());
      if (indexes.length === 0) throw new DlmmProRefusal("NOTHING_TO_DO", "The position has no unlocked liquidity to take out.");
      const shares = indexes.map((index) => ({ slot: state.slots[index]!, liquidity: state.slots[index]!.unlockedLiquidity.muln(bps).divn(10_000) }));
      /* What the shares pay at a price — the pool's own (null), or another the removal may land at. */
      const paysAt = (sqrtPrice: bigint | null) =>
        shares.reduce(
          (sum, { slot, liquidity }) => {
            const worth = sqrtPrice === null ? worthOf(pool, slot, liquidity) : worthAt(sqrtPrice, slot, liquidity);
            return { x: sum.x + big(worth.amountX), y: sum.y + big(worth.amountY) };
          },
          { x: 0n, y: 0n },
        );
      const now = paysAt(null);
      const band = bandOf(big(pool.sqrtPrice), slippageBps);
      /* Of token X a removal pays least at the band's high end, of token Y at its low end. */
      const least = slippageBps === 0 ? now : { x: paysAt(band.high).x, y: paysAt(band.low).y };
      /* And most at the other end: what it may pay of each coin anywhere in the band. */
      const most = slippageBps === 0 ? now : { x: paysAt(band.low).x, y: paysAt(band.high).y };
      const [mintX, mintY] = await Promise.all([transferFeeMintOf(connection, pool.tokenXMint), transferFeeMintOf(connection, pool.tokenYMint)]);
      const netX = arrives(bn(now.x), mintX, clock.epoch);
      const netY = arrives(bn(now.y), mintY, clock.epoch);
      const minimum = { x: arrives(bn(least.x), mintX, clock.epoch), y: arrives(bn(least.y), mintY, clock.epoch) };
      const sdk = await clientPastDust(context, [owner], coinsOf(pool));
      const built = await sdk.position.removeLiquidityByBps({
        pool: poolKey,
        nftMint,
        owner,
        signer,
        tokenXMint: pool.tokenXMint,
        tokenYMint: pool.tokenYMint,
        tickRanges: indexes.map((index) => rangeOf(state.slots[index]!)),
        /* The slots are always named: the tick ranges passed are theirs alone, and «every slot» would ask for the ticks of slots with nothing to take. */
        parameters: { minAmountX: bn(minimum.x), minAmountY: bn(minimum.y), expectedLayoutVersion: state.head.layoutVersion, bps, bitmap: liquidityBitmap(indexes) },
      });
      const sealed = await seal({ connection, wallet: signer, instructions: built.tx.instructions, units: unitsOf(DLMM_PRO_UNITS.removeLiquidity.base, DLMM_PRO_UNITS.removeLiquidity.perRange, indexes.length, 2 * DLMM_PRO_UNITS.tokenAccount), options });
      const cost = await assertPaysFor(signer, sealed, built.tx.instructions, receivingOf(pool, owner, most.x, most.y));
      return { ...sealed, ...cost, expected: { xRaw: netX.toString(), yRaw: netY.toString() }, minimum: { xRaw: minimum.x.toString(), yRaw: minimum.y.toString() } };
    });
  }

  /**
   * Collects the position's fees into the owner's accounts: a refresh of every slot that holds liquidity, then the
   * claim. `expected` is what arrives — after each coin's own transfer fee.
   */
  async function collect(
    request: Readonly<{ pool: Address; nftMint: Address; owner: Address; signer?: Address }>,
    options: SealOptions = {},
  ): Promise<DlmmProBuild & Readonly<{ expected: Readonly<{ xRaw: string; yRaw: string }> }>> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const signer = request.signer ? keyOf(request.signer, "The signer") : owner;
      const { pool, head } = await loaded(poolKey, nftMint);
      await assertSigner(connection, nftMint, owner, signer, mayDelegate(head, "claimFee"), "the position");
      const claimable = await client.position.getClaimableFees({ pool: poolKey, nftMint });
      if (claimable.feeX.isZero() && claimable.feeY.isZero()) throw new DlmmProRefusal("NOTHING_TO_DO", "The position has earned no fee yet.");
      const sdk = await clientPastDust(context, [owner], coinsOf(pool));
      const built = await sdk.position.claimFee({ pool: poolKey, nftMint, owner, signer, tokenXMint: pool.tokenXMint, tokenYMint: pool.tokenYMint, tickRanges: claimable.tickRanges, bitmap: claimable.bitmap });
      const sealed = await seal({ connection, wallet: signer, instructions: built.tx.instructions, units: unitsOf(DLMM_PRO_UNITS.claimFee.base, DLMM_PRO_UNITS.claimFee.perRange, claimable.tickRanges.length, 2 * DLMM_PRO_UNITS.tokenAccount), options });
      const cost = await assertPaysFor(signer, sealed, built.tx.instructions, receivingOf(pool, owner, big(claimable.feeX), big(claimable.feeY)));
      const [mintX, mintY, clock] = await Promise.all([transferFeeMintOf(connection, pool.tokenXMint), transferFeeMintOf(connection, pool.tokenYMint), clockOf(context)]);
      return { ...sealed, ...cost, expected: { xRaw: arrives(claimable.feeX, mintX, clock.epoch).toString(), yRaw: arrives(claimable.feeY, mintY, clock.epoch).toString() } };
    });
  }

  /**
   * Collects the fees and puts them back into one slot, in one transaction. A slot takes a coin only where the price
   * lets it — token X above the price, token Y at or below it, both inside the range — so the slot is the caller's, or
   * the one nearest the price that can take what was earned: liquidity far from the price earns nothing until the
   * price comes to it. When none can, the fees are collected, not compounded, and this refuses.
   *
   * The owner's alone. The program pays the fees into the owner's accounts and takes the deposit back out of them with
   * the signer as the authority — which a delegate is not; a delegate collects, and the owner compounds.
   *
   * The deposit goes in at the price the transaction lands at, so it is held to a band of the price around the build's
   * (`slippageBps`, of the price, either way): a price pushed outside it refuses the compound. Fees in one coin alone
   * go into a range that takes that coin alone, and the program refuses the deposit the moment the range needs the
   * other — so the range is one that stays wholly on its side of the price anywhere in the band, the nearest such: a
   * wider band puts the fees further from the price, never into a transaction that fails inside its own band.
   * `expected` is what the claim delivers after each coin's own transfer fee — what is there to put back.
   */
  async function compound(
    request: Readonly<{ pool: Address; nftMint: Address; owner: Address; slippageBps: number; slot?: number }>,
    options: SealOptions = {},
  ): Promise<DlmmProBuild & Readonly<{ slot: number; expected: Readonly<{ xRaw: string; yRaw: string }> }>> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const signer = owner;
      const slippageBps = bpsOf(request.slippageBps, "The band of the price", 0, MAX_DEPOSIT_SLIPPAGE_BPS);
      /* The position is read first: one of another pool is refused here, in the venue's own words. */
      await loaded(poolKey, nftMint);
      const { model, pool, clock } = await modelWith(context, poolKey, owner.toBase58());
      assertOpen(model, "addLiquidity");
      await assertHolds(connection, nftMint, owner, "the position");
      const claimable = await client.position.getClaimableFees({ pool: poolKey, nftMint });
      if (claimable.feeX.isZero() && claimable.feeY.isZero()) throw new DlmmProRefusal("NOTHING_TO_DO", "The position has earned no fee yet.");
      const [mintX, mintY] = await Promise.all([transferFeeMintOf(connection, pool.tokenXMint), transferFeeMintOf(connection, pool.tokenYMint)]);
      /* What the claim delivers is what there is to put back: a fee the coin's own transfer fee eats whole is not there. */
      const delivered = { x: arrives(claimable.feeX, mintX, clock.epoch), y: arrives(claimable.feeY, mintY, clock.epoch) };
      const hasX = delivered.x > 0n;
      const hasY = delivered.y > 0n;
      if (!hasX && !hasY) throw new DlmmProRefusal("NOTHING_TO_DO", "What the position earned is less than its coins' own transfer fees: there is nothing to put back.");
      const band = bandOf(big(pool.sqrtPrice), slippageBps);
      const edge = (tickId: number) => big(getSqrtPriceFromTickId(tickId));
      const takes = (slot: Readonly<{ tickLowerId: number; tickUpperId: number }>) => {
        const above = pool.tickCurrentId < slot.tickLowerId;
        const below = pool.tickCurrentId >= slot.tickUpperId;
        /*
         * Above the price a slot takes X alone, below it Y alone; inside, both — and it must be given both. A slot
         * given one coin must need none of the other wherever in the band the price lands.
         */
        if (above) return hasX && !hasY && edge(slot.tickLowerId) > band.high;
        if (below) return hasY && !hasX && edge(slot.tickUpperId) <= band.low;
        return hasX && hasY;
      };
      /* How far a range lies from the price, in ticks: nothing for one the price is inside. */
      const away = (slot: Readonly<{ tickLowerId: number; tickUpperId: number }>) => (pool.tickCurrentId < slot.tickLowerId ? slot.tickLowerId - pool.tickCurrentId : pool.tickCurrentId >= slot.tickUpperId ? pool.tickCurrentId - slot.tickUpperId + 1 : 0);
      const nearest = claimable.slots.filter(takes).sort((a, b) => away(a) - away(b) || a.index - b.index)[0];
      const target = request.slot === undefined ? nearest : claimable.slots.find((slot) => slot.index === request.slot);
      if (!target || !takes(target)) throw new DlmmProRefusal("NOTHING_TO_DO", "No range of the position can take the coins it earned anywhere in the band of the price; collect them instead, or name a narrower band.");
      const index = target.index;
      const sdk = await clientPastDust(context, [owner], coinsOf(pool));
      const built = await sdk.position.compoundFees({
        pool: poolKey,
        nftMint,
        owner,
        signer,
        tokenXMint: pool.tokenXMint,
        tokenYMint: pool.tokenYMint,
        index,
        slippage: { sqrtPriceSlippage: { minSqrtPrice: bn(band.low), maxSqrtPrice: bn(band.high) }, minLiquidity: null },
      });
      const sealed = await seal({ connection, wallet: signer, instructions: built.tx.instructions, units: unitsOf(DLMM_PRO_UNITS.compound.base, DLMM_PRO_UNITS.compound.perRange, claimable.tickRanges.length, 2 * DLMM_PRO_UNITS.tokenAccount), options });
      const cost = await assertPaysFor(signer, sealed, built.tx.instructions, receivingOf(pool, owner, big(claimable.feeX), big(claimable.feeY)));
      return { ...sealed, ...cost, slot: index, expected: { xRaw: delivered.x.toString(), yRaw: delivered.y.toString() } };
    });
  }

  /** Locks a share of every slot's unlocked liquidity for ever. Only the owner; it cannot be undone. */
  async function lockPermanently(request: Readonly<{ pool: Address; nftMint: Address; owner: Address; bps: number }>, options: SealOptions = {}): Promise<DlmmProBuild> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const bps = bpsOf(request.bps, "The share to lock", 1, 10_000);
      const state = await loaded(poolKey, nftMint);
      await assertHolds(connection, nftMint, owner, "the position");
      if (state.slots.every((slot) => slot.unlockedLiquidity.muln(bps).divn(10_000).isZero())) throw new DlmmProRefusal("NOTHING_TO_DO", "The position has no unlocked liquidity to lock.");
      const built = await client.position.lockPermanentPosition({ pool: poolKey, nftMint, owner, bps, expectedLayoutVersion: state.head.layoutVersion });
      const sealed = await seal({ connection, wallet: owner, instructions: built.tx.instructions, units: unitsOf(DLMM_PRO_UNITS.lockPermanent.base, DLMM_PRO_UNITS.lockPermanent.perRange, state.slots.length), options });
      return { ...sealed, ...(await assertPaysFor(owner, sealed, [])) };
    });
  }

  /**
   * Lets `delegate` look after the position within `may` — or takes it back (`delegate` null): the approval on the
   * NFT's account (amount 0: a delegated amount fails every delegated call) and the position's permission bits, in one
   * transaction.
   */
  async function delegate(
    request: Readonly<{ nftMint: Address; owner: Address; delegate: Address | null; may?: readonly PositionPermission[] }>,
    options: SealOptions = {},
  ): Promise<DlmmProBuild> {
    return refusing(async () => {
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const to = request.delegate ? keyOf(request.delegate, "The delegate") : null;
      const may = to ? (request.may ?? []) : [];
      if (to && may.length === 0) throw new DlmmProRefusal("BAD_INPUT", "A delegate is given at least one thing it may do.");
      if (may.some((name) => !(name in PERMISSION_BIT))) throw new DlmmProRefusal("BAD_INPUT", "A permission named is not one a position has.");
      const nftAccount = findNftAccount(nftMint, owner);
      await assertHolds(connection, nftMint, owner, "the position");
      const built = await client.position.updatePositionDelegatePermission({ nftMint, owner, permission: positionDelegatePermissionMask(may.map((name) => PERMISSION_BIT[name])) });
      const approval = to ? createApproveInstruction(nftAccount, to, owner, 0, [], TOKEN_2022_PROGRAM_ID) : createRevokeInstruction(nftAccount, owner, [], TOKEN_2022_PROGRAM_ID);
      const sealed = await seal({ connection, wallet: owner, instructions: [approval, ...built.tx.instructions], units: DLMM_PRO_UNITS.delegate, options });
      return { ...sealed, ...(await assertPaysFor(owner, sealed, [])) };
    });
  }

  /**
   * Hands a position over to another wallet: its NFT, and with it the position, what it holds, the fees it earns and
   * everything its holder may do. Only the holder signs; the giver's delegate, if it has one, is not the receiver's —
   * an approval lives on the giver's account of the NFT, and that account is closed. What is locked for ever stays
   * locked: a hand-over changes who collects, never what can be taken out. It cannot be undone from here — only the
   * receiver can hand it back.
   */
  async function handOver(request: Readonly<{ pool: Address; nftMint: Address; owner: Address; to: Address }>, options: SealOptions = {}): Promise<DlmmProBuild & Readonly<{ handedTo: Readonly<{ owner: Address; nftAccount: Address }> }>> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const to = receiverOf(request.to, owner, nftMint);
      /* The NFT of a position of this very pool: a hand-over of anything else is not this venue's to build. */
      await loaded(poolKey, nftMint);
      await assertHolds(connection, nftMint, owner, "the position");
      const instructions = handOverInstructions(nftMint, owner, to);
      const sealed = await seal({ connection, wallet: owner, instructions, units: DLMM_PRO_UNITS.handOver, options });
      /* A frozen account of the receiver's would take nothing; one that is there and holds the NFT's coin is paid into as it is. */
      const cost = await assertAffords(connection, owner, [], { fee: BigInt(sealed.feeLamports), instructions: instructions.slice(0, 1), receives: [findNftAccount(nftMint, to)] });
      return { ...sealed, ...cost, handedTo: { owner: to.toBase58(), nftAccount: findNftAccount(nftMint, to).toBase58() } };
    });
  }

  /** Closes an empty position: burns the NFT and returns the rent to the owner (or to `rentReceiver`). */
  async function close(request: Readonly<{ pool: Address; nftMint: Address; owner: Address; rentReceiver?: Address }>, options: SealOptions = {}): Promise<DlmmProBuild> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const state = await loaded(poolKey, nftMint);
      await assertHolds(connection, nftMint, owner, "the position");
      if (state.slots.some((slot) => !positionTotalLiquidity(slot).isZero() || !slot.feePendingX.isZero() || !slot.feePendingY.isZero() || (slot.rewards ?? []).some((reward) => !reward.pendingAmount.isZero()))) {
        throw new DlmmProRefusal("BAD_INPUT", "The position still holds liquidity, fees or rewards: take them out first. Liquidity locked for ever never leaves, and its position is never closed.");
      }
      const built = await client.position.closePosition({ pool: poolKey, owner, nftMint, rentReceiver: request.rentReceiver ? keyOf(request.rentReceiver, "The rent's receiver") : owner, tickRanges: state.slots.map(rangeOf) });
      const sealed = await seal({ connection, wallet: owner, instructions: built.tx.instructions, units: unitsOf(DLMM_PRO_UNITS.closePosition.base, DLMM_PRO_UNITS.closePosition.perRange, state.slots.length), options });
      return { ...sealed, ...(await assertPaysFor(owner, sealed, [])) };
    });
  }

  return { read, worthAtPrice, open, add, remove, collect, compound, lockPermanently, delegate, handOver, close, clockOf: () => clockOf(context) };
}

export type DlmmProPositions = ReturnType<typeof createDlmmProPositions>;
