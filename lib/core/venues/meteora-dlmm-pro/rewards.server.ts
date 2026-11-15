/**
 * Liquidity-mining rewards of DLMM Pro: setting a reward slot up, funding its emission, collecting.
 *
 * A pool created with the `LiquidityMining` extension has two reward slots. A slot pays one coin, at a rate per
 * second, between two moments — to the liquidity **in range at the price**, in proportion to it; liquidity outside the
 * range, and limit orders, earn none. The pool's creator may set up slot 0 and name its authority; slot 1 is Meteora's
 * operator's. The authority funds an emission: the whole of it is paid into the pool's vault up front, for a window of
 * one day to one year that starts within thirty days.
 *
 * - **initialize** — slot 0, by the pool's creator: the reward's coin and the authority that will fund it. A coin with
 *   a freeze authority, or with a Token-2022 extension beyond a transfer fee and metadata, is taken by the program only
 *   with Meteora's token badge (wrapped SOL and USDC pass): the build passes the badge where the coin has one, and
 *   refuses where it has not;
 * - **fund** — an emission from an amount and a window: the rate is the amount over the window's seconds, rounded
 *   down, so the vault is never asked for more than the amount;
 * - **collect** — a position's reward into its owner's account, after a refresh the same transaction makes. The
 *   build says what the position's slots already show as accrued, as it arrives — after the reward coin's own
 *   transfer fee: the least the owner receives — and is refused only where
 *   nothing can have accrued: the slots show nothing, nothing was ever credited to the pool's liquidity, and the
 *   emission has not started. What an emission that has ended left a position is collected while the next is ahead;
 * - **withdrawIneligible** — what was emitted while the pool had no liquidity in range, back to the authority once the
 *   emission has ended. In the rehearsal the pool had liquidity in range all through its emission: the withdrawal
 *   landed and moved nothing, before the slot's next emission was funded. One that pays, and whether the program asks
 *   for that order, were not tried.
 *
 * Rewards accrue to a position only when it is refreshed or its liquidity changes, so what a position's slots show as
 * accrued lags what a collect pays; the collect's own refresh closes the gap.
 *
 * The wallet is the fee payer and the only signer. Nothing here holds a key.
 */

import { CREATOR_REWARD_INDEX, MAX_REWARD_DURATION, MAX_REWARD_START_DELAY, MIN_REWARD_DURATION, NUM_REWARDS, PoolExtension, PositionDelegatePermission, calculateTransferFeeExcludedAmount, calculateTransferFeeIncludedAmount, derivePosition, isSupportExtension, liquidityBitmap, positionTotalLiquidity } from "@meteora-ag/dlmm-pro-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import { DLMM_PRO_ACCOUNT_BYTES, assertAffords, assertSigner, clientPastDust, clockOf, poolWhole, rewardsOf, tokenBadgeFor, tokenProgramOf, transferFeeMintOf, type DlmmProContext, type DlmmProReward } from "./pools.server.ts";
import { DlmmProRefusal, refusing } from "./sdk.server.ts";
import { DLMM_PRO_UNITS, keyOf, rawOf, seal, unitsOf, type DlmmProBuild, type DlmmProTx, type SealOptions } from "./tx.server.ts";

const big = (value: { toString(): string }) => BigInt(value.toString());
const Q64 = 1n << 64n;
/** The least an emission's start lies ahead of the build's clock, and where it is put when the caller names none: past the life of the build's blockhash. */
export const REWARD_START_MARGIN_SECONDS = 120;

/** The rate of an emission: atoms a second, Q64.64, rounded down — and what the vault is funded with for it, rounded up as the program rounds. */
export function emissionOf(amountRaw: bigint, seconds: bigint): Readonly<{ perSecondX64: bigint; fundedRaw: bigint }> {
  if (seconds <= 0n) throw new DlmmProRefusal("BAD_INPUT", "An emission lasts at least a second.");
  const perSecondX64 = (amountRaw << 64n) / seconds;
  const fundedRaw = (perSecondX64 * seconds + Q64 - 1n) / Q64;
  return { perSecondX64, fundedRaw };
}

export function createDlmmProRewards(context: DlmmProContext) {
  const { connection, client } = context;
  const programId = client.program.programId;
  /** Refuses a build whose signer cannot pay its fee and the rent of what it creates. */
  const assertPaysFor = (signer: PublicKey, sealed: Pick<DlmmProTx, "feeLamports">, instructions: readonly TransactionInstruction[], more: readonly number[] = [], receives: readonly PublicKey[] = []) =>
    assertAffords(connection, signer, [], { fee: BigInt(sealed.feeLamports), instructions, accounts: more, receives });
  const programOf = (reward: DlmmProReward) => tokenProgramOf(reward.program === "token-2022" ? 1 : 0);

  async function slotOf(poolKey: PublicKey, index: number): Promise<Readonly<{ reward: DlmmProReward | null; rewards: readonly DlmmProReward[] }>> {
    if (!Number.isInteger(index) || index < 0 || index >= NUM_REWARDS) throw new DlmmProRefusal("BAD_INPUT", `A pool has reward slots 0 to ${NUM_REWARDS - 1}.`);
    const [{ pool, extensions }, clock] = await Promise.all([poolWhole(context, poolKey), clockOf(context)]);
    if (!isSupportExtension(pool.extensions, PoolExtension.LiquidityMining)) throw new DlmmProRefusal("BAD_INPUT", "The pool was created without liquidity mining; it can never have rewards.");
    const rewards = rewardsOf(extensions, clock);
    return { reward: rewards.find((entry) => entry.index === index) ?? null, rewards };
  }

  /** The reward slots of a pool that were set up; empty for a pool without liquidity mining. */
  async function read(pool: Address): Promise<readonly DlmmProReward[]> {
    return refusing(async () => {
      const [{ extensions }, clock] = await Promise.all([poolWhole(context, keyOf(pool, "The pool")), clockOf(context)]);
      return rewardsOf(extensions, clock);
    });
  }

  /** Sets reward slot 0 up: its coin and the authority that funds it. Signed by the pool's creator. */
  async function initialize(
    request: Readonly<{ pool: Address; creator: Address; rewardMint: Address; /** Absent — the creator. */ authority?: Address }>,
    options: SealOptions = {},
  ): Promise<DlmmProBuild & Readonly<{ vault: Address; index: number }>> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const creator = keyOf(request.creator, "The creator");
      const rewardMint = keyOf(request.rewardMint, "The reward's coin");
      const [{ pool }, slot] = await Promise.all([poolWhole(context, poolKey), slotOf(poolKey, CREATOR_REWARD_INDEX)]);
      if (!pool.creator.equals(creator)) throw new DlmmProRefusal("BAD_INPUT", "Only the pool's creator sets its first reward slot up.");
      if (slot.reward) throw new DlmmProRefusal("NOTHING_TO_DO", "The pool's first reward slot is set up already.");
      const mintInfo = await connection.getAccountInfo(rewardMint, "confirmed");
      if (!mintInfo) throw new DlmmProRefusal("BAD_INPUT", "The reward's coin does not exist.");
      const badge = await tokenBadgeFor(connection, rewardMint, mintInfo, "reward");
      const built = await client.reward.initializeReward({ pool: poolKey, rewardMint, rewardAuthority: request.authority ? keyOf(request.authority, "The reward's authority") : creator, creator, payer: creator, tokenProgram: mintInfo.owner, ...(badge ? { tokenBadge: badge } : {}) });
      const sealed = await seal({ connection, wallet: creator, instructions: built.tx.instructions, units: DLMM_PRO_UNITS.initializeReward, options });
      /* The slot's vault is a token account the creator pays the rent of. */
      const cost = await assertPaysFor(creator, sealed, built.tx.instructions, [DLMM_PRO_ACCOUNT_BYTES.tokenAccount2022]);
      return { ...sealed, ...cost, vault: built.rewardVault.toBase58(), index: CREATOR_REWARD_INDEX };
    });
  }

  /**
   * Funds an emission of a slot: `amountRaw` of its coin over `seconds`, starting at `opensAt` (unix seconds, at least
   * two minutes ahead of the chain's clock; absent — two minutes ahead). Signed by the slot's authority, which also pays.
   */
  async function fund(
    request: Readonly<{ pool: Address; authority: Address; index?: number; amountRaw: string; seconds: number; opensAt?: number }>,
    options: SealOptions = {},
  ): Promise<DlmmProBuild & Readonly<{ vault: Address; emissionPerSecondX64: string; fundedRaw: string; maximumPaidRaw: string; opensAt: number; endsAt: number }>> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const authority = keyOf(request.authority, "The reward's authority");
      const index = request.index ?? CREATOR_REWARD_INDEX;
      const amount = rawOf(request.amountRaw, "The amount");
      if (amount <= 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "The amount is zero.");
      if (!Number.isSafeInteger(request.seconds) || BigInt(request.seconds) < big(MIN_REWARD_DURATION) || BigInt(request.seconds) > big(MAX_REWARD_DURATION)) throw new DlmmProRefusal("BAD_INPUT", "An emission lasts from one day to one year.");
      const [slot, clock] = await Promise.all([slotOf(poolKey, index), clockOf(context)]);
      if (!slot.reward) throw new DlmmProRefusal("BAD_INPUT", "The reward slot is not set up.");
      if (slot.reward.authority !== authority.toBase58()) throw new DlmmProRefusal("BAD_INPUT", "Only the slot's authority funds it.");
      if (slot.reward.endsAt > 0 && clock.unix < BigInt(slot.reward.endsAt)) throw new DlmmProRefusal("BAD_INPUT", "The slot's emission is still running; it takes the next one when this ends.");
      /*
       * The start is always named. «Now» to the program is the moment the transaction lands, and it measures the window
       * from there: an end counted from the build's clock would make the window — and with it the amount funded — depend
       * on how long the wallet took, and a one-day window a second short of a day is refused. A start a little ahead of
       * the build's clock, past the life of its blockhash, keeps both exact.
       */
      const opensAt = request.opensAt ?? Number(clock.unix) + REWARD_START_MARGIN_SECONDS;
      if (!Number.isSafeInteger(opensAt) || BigInt(opensAt) < clock.unix + BigInt(REWARD_START_MARGIN_SECONDS) || BigInt(opensAt) > clock.unix + big(MAX_REWARD_START_DELAY)) {
        throw new DlmmProRefusal("BAD_INPUT", `An emission starts at least ${REWARD_START_MARGIN_SECONDS} seconds ahead of the chain's clock and at most thirty days.`);
      }
      const emission = emissionOf(amount, BigInt(request.seconds));
      if (emission.perSecondX64 === 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "The amount is too small to emit over this window.");
      const rewardMint = new PublicKey(slot.reward.mint);
      const mint = await transferFeeMintOf(connection, rewardMint);
      /* The vault receives the funded amount exactly; the authority pays the coin's own transfer fee on top. */
      const maximumPaid = calculateTransferFeeIncludedAmount(mint, clock.epoch, new BN(emission.fundedRaw.toString())).amount;
      const rewardProgram = programOf(slot.reward);
      const endsAt = opensAt + request.seconds;
      const sdk = await clientPastDust(context, [authority], [{ mint: rewardMint, program: rewardProgram }]);
      const built = await sdk.reward.setRewardEmission({
        pool: poolKey,
        rewardMint,
        funder: authority,
        authority,
        parameters: { index, openTime: new BN(opensAt), endTime: new BN(endsAt), emissionPerSecond: new BN(emission.perSecondX64.toString()), maxAmount: maximumPaid },
      });
      const sealed = await seal({ connection, wallet: authority, instructions: built.tx.instructions, units: DLMM_PRO_UNITS.fundReward + DLMM_PRO_UNITS.tokenAccount, options });
      const cost = await assertAffords(connection, authority, [{ mint: rewardMint, program: rewardProgram, amount: big(maximumPaid) }], { fee: BigInt(sealed.feeLamports), instructions: built.tx.instructions });
      return { ...sealed, ...cost, vault: built.rewardVault.toBase58(), emissionPerSecondX64: emission.perSecondX64.toString(), fundedRaw: emission.fundedRaw.toString(), maximumPaidRaw: maximumPaid.toString(), opensAt, endsAt };
    });
  }

  /** Collects a position's reward of one slot into its owner's account: a refresh of every slot of the position that holds liquidity, then the claim. */
  async function collect(
    request: Readonly<{ pool: Address; nftMint: Address; owner: Address; signer?: Address; index?: number }>,
    options: SealOptions = {},
  ): Promise<
    DlmmProBuild &
      Readonly<{
        rewardMint: Address;
        index: number;
        /**
         * What the position's slots already show, after the coin's own transfer fee: the least that arrives. It is what
         * is written, not what is owed: what accrued since the slots' last refresh is paid on top — and «0» is told as
         * well of a position that is owed a whole emission as of one that is owed nothing.
         */
        accruedRaw: string;
      }>
  > {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const nftMint = keyOf(request.nftMint, "The position's NFT");
      const owner = keyOf(request.owner, "The owner");
      const signer = request.signer ? keyOf(request.signer, "The signer") : owner;
      const index = request.index ?? CREATOR_REWARD_INDEX;
      const [slot, clock] = await Promise.all([slotOf(poolKey, index), clockOf(context)]);
      if (!slot.reward) throw new DlmmProRefusal("BAD_INPUT", "The reward slot is not set up.");
      const missing = (error: unknown) => {
        if (error instanceof Error && /Account not found|is not owned by|Invalid account discriminator/i.test(error.message)) throw new DlmmProRefusal("BAD_INPUT", "No position lives at this NFT.");
        throw error;
      };
      const positionKey = derivePosition(nftMint, programId);
      /* The head first: a position's slots are longer on a pool with rewards, so those of another pool's position would not even decode. */
      const head = await client.state.fetchPositionArray(positionKey).catch(missing);
      if (!head.pool.equals(poolKey)) throw new DlmmProRefusal("BAD_INPUT", "The position belongs to another pool.");
      /* The pool has liquidity mining — `slotOf` held that — so its positions carry rewards. */
      const { positionArray, positions } = await client.state.fetchPositionArrayWithPositions(positionKey, { withReward: true }).catch(missing);
      await assertSigner(connection, nftMint, owner, signer, (positionArray.delegatePermission & (1 << PositionDelegatePermission.ClaimReward)) !== 0, "the position");
      if (positions.length === 0) throw new DlmmProRefusal("BAD_INPUT", "No position lives at this NFT.");
      const funded = positions.map((position, at) => ({ position, at })).filter(({ position }) => !positionTotalLiquidity(position).isZero());
      /*
       * What the slots show as accrued — told below as it arrives, after the coin's own transfer fee. What accrued
       * since each slot's last refresh comes on top, and the SDK has no arithmetic for it — so nothing accrued is not
       * yet «nothing to collect». It is that only where nothing was ever credited to liquidity and the emission has
       * not started: a slot's dates are its latest emission's, and one that ended before may still owe the position.
       */
      const accrued = positions.reduce((sum, position) => sum + big(("rewards" in position ? position.rewards[index]?.pendingAmount : undefined) ?? 0), 0n);
      if (accrued === 0n && !slot.reward.credited && (slot.reward.opensAt === 0 || clock.unix < BigInt(slot.reward.opensAt))) throw new DlmmProRefusal("NOTHING_TO_DO", "The position has earned no reward: the slot's emission has not started.");
      const rewardMint = new PublicKey(slot.reward.mint);
      const rewardProgram = programOf(slot.reward);
      const mint = await transferFeeMintOf(connection, rewardMint);
      const arrives = big(calculateTransferFeeExcludedAmount(mint, clock.epoch, new BN(accrued.toString())).amount);
      const sdk = await clientPastDust(context, [owner], [{ mint: rewardMint, program: rewardProgram }]);
      const built = await sdk.reward.claimReward({
        pool: poolKey,
        nftMint,
        owner,
        signer,
        rewardMint,
        rewardIndex: index,
        /* Every slot is refreshed; only those that hold liquidity have ticks to read. */
        bitmap: liquidityBitmap(positions.map((_, at) => at)),
        tickRanges: funded.map(({ position }) => ({ tickLowerId: position.tickLowerId, tickUpperId: position.tickUpperId })),
      });
      const sealed = await seal({ connection, wallet: signer, instructions: built.tx.instructions, units: unitsOf(DLMM_PRO_UNITS.claimReward.base, DLMM_PRO_UNITS.claimReward.perRange, funded.length, DLMM_PRO_UNITS.tokenAccount), options });
      /* The reward is paid into the owner's own account of its coin: a frozen one takes nothing. */
      const cost = await assertPaysFor(signer, sealed, built.tx.instructions, [], [getAssociatedTokenAddressSync(rewardMint, owner, true, rewardProgram)]);
      return { ...sealed, ...cost, rewardMint: slot.reward.mint, index, accruedRaw: arrives.toString() };
    });
  }

  /**
   * Takes back what a slot emitted while the pool had no liquidity in range — after its emission ended. Signed by the
   * slot's authority, and paid into the authority's own account of the reward's coin: a frozen one takes nothing, and
   * the build is refused — whatever there is to take, for the venue does not reckon it.
   */
  async function withdrawIneligible(request: Readonly<{ pool: Address; authority: Address; index?: number }>, options: SealOptions = {}): Promise<DlmmProBuild> {
    return refusing(async () => {
      const poolKey = keyOf(request.pool, "The pool");
      const authority = keyOf(request.authority, "The reward's authority");
      const index = request.index ?? CREATOR_REWARD_INDEX;
      const [slot, clock] = await Promise.all([slotOf(poolKey, index), clockOf(context)]);
      if (!slot.reward) throw new DlmmProRefusal("BAD_INPUT", "The reward slot is not set up.");
      if (slot.reward.authority !== authority.toBase58()) throw new DlmmProRefusal("BAD_INPUT", "Only the slot's authority takes this back.");
      if (slot.reward.endsAt === 0 || clock.unix < BigInt(slot.reward.endsAt)) throw new DlmmProRefusal("BAD_INPUT", "The slot's emission has not ended.");
      const rewardMint = new PublicKey(slot.reward.mint);
      const rewardProgram = programOf(slot.reward);
      const sdk = await clientPastDust(context, [authority], [{ mint: rewardMint, program: rewardProgram }]);
      const built = await sdk.reward.withdrawIneligibleRewards({ pool: poolKey, rewardMint, authority, rewardIndex: index });
      const sealed = await seal({ connection, wallet: authority, instructions: built.tx.instructions, units: DLMM_PRO_UNITS.withdrawIneligibleReward + DLMM_PRO_UNITS.tokenAccount, options });
      return { ...sealed, ...(await assertPaysFor(authority, sealed, built.tx.instructions, [], [getAssociatedTokenAddressSync(rewardMint, authority, true, rewardProgram)])) };
    });
  }

  return { read, initialize, fund, collect, withdrawIneligible };
}

export type DlmmProRewards = ReturnType<typeof createDlmmProRewards>;
