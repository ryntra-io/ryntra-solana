/**
 * Liquidity Studio's DAMM v2 venue (Meteora `cpamdpZC…sGG`,
 * `@meteora-ag/cp-amm-sdk`): one constant-product curve per pool between its
 * minimum and maximum price, positions carried by an NFT, fees read from the
 * position against the pool's fee per unit of liquidity.
 *
 * Who owns a position is whoever holds its NFT now — a position bought or sent
 * to another wallet moves with it — so every action finds the NFT among the
 * wallet's own accounts before it builds anything. Liquidity under a vesting
 * or a permanent lock (a launch's migrated pool locks its share for good) is
 * shown and counted as locked; only the unlocked part is withdrawable.
 *
 * The launch engine's DAMM v2 code (`lib/core/venues/meteora-damm-v2/holder.server.ts`)
 * is a separate thing — a launch holder's entry with a collector's permission.
 * This venue grants nobody any permission.
 */

import type { FeeRow } from "@ryntra/core/adapters";
import {
  CP_AMM_PROGRAM_ID,
  CollectFeeMode,
  CpAmm,
  MAX_SQRT_PRICE,
  derivePositionAddress,
  derivePositionNftAccount,
  MIN_SQRT_PRICE,
  TradeDirection,
  getBaseFeeHandlerFromPodAlignedData,
  getCurrentPoint,
  getMaxFeeBps,
  getMaxFeeNumerator,
  getPriceFromSqrtPrice,
  getTokenProgram,
  getTotalFeeNumerator,
  getUnClaimLpFee,
  isDynamicFeeEnabled,
  type PoolState,
  type PositionState,
} from "@meteora-ag/cp-amm-sdk";
import { getTransferFeeConfig, TOKEN_2022_PROGRAM_ID, unpackAccount, unpackMint, type Mint } from "@solana/spl-token";
import { Keypair, PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import BN from "bn.js";

import {
  LiquidityRefusal,
  SOLANA_NETWORK,
  liquidityActions,
  liquidityVenueCapabilities,
  type AddLiquidityPreview,
  type AddLiquidityRequest,
  type ChainSource,
  type ClaimFeesPreview,
  type ClaimFeesRequest,
  type LiquidityNotice,
  type LiquidityPool,
  type LiquidityPosition,
  type LiquidityToken,
  type LiquidityVenueAdapter,
  type RemoveLiquidityPreview,
  type RemoveLiquidityRequest,
  type RentCost,
} from "./contract.ts";
import { amountOf, assertBps, assertSidesFit, driftBps, minusSlippage, numeratorToBps, parseUnits, plusSlippage, shareOf, sqrtRangeState } from "./math.ts";

export const DAMM_V2_PROGRAM = CP_AMM_PROGRAM_ID.toBase58();
export const DAMM_V2_PREVIEW_TTL_MS = 30_000;
export const MAX_SLIPPAGE_BPS = 5_000;

/**
 * The accounts a new position opens, by size in bytes: the position (the program's `position`, 408), its NFT mint —
 * Token-2022 with the close authority, the metadata pointer and Meteora's fixed name, symbol and link — and the NFT's
 * token account with its immutable-owner extension. The sizes are read from a live position on mainnet on 2026-10-16
 * (`scripts/liquidity/record-studio-fixtures.mjs` checks them again on every recording); the rent is asked of the network.
 * Closing the position returns all three.
 */
export const POSITION_ACCOUNT_SIZES = Object.freeze({ position: 408, nftMint: 465, nftAccount: 165 });

export type DammV2VenueDeps = Readonly<{
  connection: Connection;
  newKeypair?: () => Keypair;
  now?: () => number;
  actionsOpen?: boolean;
  /** Byte sizes of a new position's accounts; the recording checks them against the chain. */
  accountSizes?: Readonly<{ position: number; nftMint: number; nftAccount: number }>;
}>;

type PoolFacts = Readonly<{
  address: PublicKey;
  state: PoolState;
  x: LiquidityToken;
  y: LiquidityToken;
  mintX: Mint;
  mintY: Mint;
  /** Which side is a Token-2022 mint with a transfer fee; the quotes count the fee for it. */
  feeX: boolean;
  feeY: boolean;
  /** The epoch a transfer fee is read at; null when neither side has one. */
  epoch: number | null;
}>;

function key(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new LiquidityRefusal("BAD_REQUEST", `${field} is not a Solana address.`);
  }
}

const big = (value: BN): bigint => BigInt(value.toString());
const priceOf = (sqrtPrice: BN, x: LiquidityToken, y: LiquidityToken): string => getPriceFromSqrtPrice(sqrtPrice, x.decimals, y.decimals).toSignificantDigits(10).toFixed();
const isCompounding = (state: PoolState): boolean => state.collectFeeMode === CollectFeeMode.Compounding;
/** A compounding pool has no bounds, so it is always in range; a bounded curve is checked against its bounds. */
const rangeStateOf = (state: PoolState) => (isCompounding(state) ? "in_range" : sqrtRangeState(big(state.sqrtPrice), big(state.sqrtMinPrice), big(state.sqrtMaxPrice)));
const boundsOf = (state: PoolState, x: LiquidityToken, y: LiquidityToken) =>
  isCompounding(state) ? { minPrice: null, maxPrice: null } : { minPrice: priceOf(state.sqrtMinPrice, x, y), maxPrice: priceOf(state.sqrtMaxPrice, x, y) };
const totalLiquidity = (position: PositionState): BN => position.unlockedLiquidity.add(position.vestedLiquidity).add(position.permanentLockedLiquidity);

export function createDammV2Venue(deps: DammV2VenueDeps): LiquidityVenueAdapter {
  const { connection } = deps;
  const now = deps.now ?? Date.now;
  const newKeypair = deps.newKeypair ?? (() => Keypair.generate());
  const sizes = deps.accountSizes ?? POSITION_ACCOUNT_SIZES;
  const cpAmm = new CpAmm(connection);

  const source = async (): Promise<ChainSource> => {
    const slot = await connection.getSlot("confirmed").catch(() => null);
    return { kind: "chain", program: DAMM_V2_PROGRAM, slot, at: now() };
  };

  const facts = async (address: PublicKey): Promise<PoolFacts> => {
    let state: PoolState;
    try {
      state = await cpAmm.fetchPoolState(address);
    } catch (error) {
      /* Only an account that is not there, or not the program's, is "no pool"; a failing RPC stays a failure. */
      const info = await connection.getAccountInfo(address, "confirmed");
      if (!info || !info.owner.equals(CP_AMM_PROGRAM_ID)) throw new LiquidityRefusal("POOL_NOT_FOUND", "No DAMM v2 pool at the address.");
      throw error;
    }
    const programX = getTokenProgram(state.tokenAFlag);
    const programY = getTokenProgram(state.tokenBFlag);
    const [infoX, infoY] = await connection.getMultipleAccountsInfo([state.tokenAMint, state.tokenBMint], "confirmed");
    if (!infoX || !infoY) throw new LiquidityRefusal("POOL_NOT_FOUND", "A token of the pool has no mint account.");
    const mintX = unpackMint(state.tokenAMint, infoX, programX);
    const mintY = unpackMint(state.tokenBMint, infoY, programY);
    const feeX = programX.equals(TOKEN_2022_PROGRAM_ID) && getTransferFeeConfig(mintX) !== null;
    const feeY = programY.equals(TOKEN_2022_PROGRAM_ID) && getTransferFeeConfig(mintY) !== null;
    const epoch = feeX || feeY ? (await connection.getEpochInfo("confirmed")).epoch : null;
    return {
      address,
      state,
      mintX,
      mintY,
      feeX,
      feeY,
      epoch,
      x: { mint: state.tokenAMint.toBase58(), decimals: mintX.decimals, program: programX.toBase58() },
      y: { mint: state.tokenBMint.toBase58(), decimals: mintY.decimals, program: programY.toBase58() },
    };
  };

  const hasTransferFee = (pool: PoolFacts): boolean => pool.feeX || pool.feeY;

  /** The SDK counts a Token-2022 transfer fee only when it is handed the mint and the epoch. */
  const feeInfoX = (pool: PoolFacts) => (pool.feeX && pool.epoch !== null ? { mint: pool.mintX, currentEpoch: pool.epoch } : undefined);
  const feeInfoY = (pool: PoolFacts) => (pool.feeY && pool.epoch !== null ? { mint: pool.mintY, currentEpoch: pool.epoch } : undefined);

  /** The pool's reserves: from the pool account where its layout keeps them, otherwise its two vaults. */
  const reservesOf = async (pool: PoolFacts): Promise<{ x: bigint; y: bigint }> => {
    if (pool.state.layoutVersion >= 1) return { x: big(pool.state.tokenAAmount), y: big(pool.state.tokenBAmount) };
    const [vaultX, vaultY] = await connection.getMultipleAccountsInfo([pool.state.tokenAVault, pool.state.tokenBVault], "confirmed");
    const amount = (info: typeof vaultX, vault: PublicKey, program: string) => (info ? unpackAccount(vault, info, new PublicKey(program)).amount : 0n);
    return { x: amount(vaultX, pool.state.tokenAVault, pool.x.program), y: amount(vaultY, pool.state.tokenBVault, pool.y.program) };
  };

  /** The fee a small trade pays now: the base (which a scheduler may still be lowering) plus the volatility part. */
  const feesOf = async (state: PoolState) => {
    const handler = getBaseFeeHandlerFromPodAlignedData(state.poolFees.baseFee.baseFeeInfo.data);
    let base: BN;
    try {
      const point = await getCurrentPoint(connection, state.activationType);
      base = handler.getBaseFeeNumeratorFromIncludedFeeAmount(point, state.activationPoint, TradeDirection.AtoB, new BN(1), state.poolFees.initSqrtPrice, state.sqrtPrice);
    } catch {
      base = handler.getMinFeeNumerator();
    }
    const total = getTotalFeeNumerator(state.poolFees, base, getMaxFeeNumerator(state.feeVersion));
    return {
      baseBps: numeratorToBps(big(base)),
      currentBps: isDynamicFeeEnabled(state.poolFees.dynamicFee) ? numeratorToBps(big(total)) : null,
      maxBps: getMaxFeeBps(state.feeVersion),
      protocolSharePct: state.poolFees.protocolFeePercent,
    };
  };

  const toPool = async (pool: PoolFacts, at: ChainSource): Promise<LiquidityPool> => {
    const { state, x, y } = pool;
    const reserves = await reservesOf(pool);
    return {
      venue: "meteora-damm2",
      network: SOLANA_NETWORK,
      address: pool.address.toBase58(),
      tokenX: x,
      tokenY: y,
      price: priceOf(state.sqrtPrice, x, y),
      shape: {
        kind: "range",
        ...boundsOf(state, x, y),
        concentrated: !isCompounding(state) && !(state.sqrtMinPrice.eq(MIN_SQRT_PRICE) && state.sqrtMaxPrice.eq(MAX_SQRT_PRICE)),
        compounding: isCompounding(state),
      },
      fees: await feesOf(state),
      reserves: { x: amountOf(x, reserves.x), y: amountOf(y, reserves.y) },
      enabled: state.poolStatus === 0,
      source: at,
    };
  };

  const quoteBase = (state: PoolState) => ({
    minSqrtPrice: state.sqrtMinPrice,
    maxSqrtPrice: state.sqrtMaxPrice,
    sqrtPrice: state.sqrtPrice,
    collectFeeMode: state.collectFeeMode,
    tokenAAmount: state.tokenAAmount,
    tokenBAmount: state.tokenBAmount,
    liquidity: state.liquidity,
  });

  /** What a liquidity share returns at the price now, before slippage. */
  const withdrawOf = (pool: PoolFacts, delta: BN): { x: bigint; y: bigint } => {
    if (delta.isZero()) return { x: 0n, y: 0n };
    const quote = cpAmm.getWithdrawQuote({ liquidityDelta: delta, ...quoteBase(pool.state), tokenATokenInfo: feeInfoX(pool), tokenBTokenInfo: feeInfoY(pool) });
    return { x: big(quote.outAmountA), y: big(quote.outAmountB) };
  };

  const rewardTokens = async (state: PoolState): Promise<(LiquidityToken | null)[]> => {
    const live = state.rewardInfos.map((reward) => (reward.initialized ? reward.mint : null));
    const wanted = live.filter((mint): mint is PublicKey => mint !== null);
    if (wanted.length === 0) return live.map(() => null);
    const infos = await connection.getMultipleAccountsInfo(wanted, "confirmed");
    return live.map((mint) => {
      if (!mint) return null;
      const info = infos[wanted.findIndex((m) => m.equals(mint))];
      const decimals = info?.data?.[44];
      return info && decimals !== undefined ? { mint: mint.toBase58(), decimals, program: info.owner.toBase58() } : null;
    });
  };

  const rewardAmounts = (tokens: readonly (LiquidityToken | null)[], values: readonly BN[]) =>
    values
      .map((value, index) => ({ value: big(value), token: tokens[index] ?? null }))
      .filter((reward): reward is { value: bigint; token: LiquidityToken } => reward.token !== null && reward.value > 0n)
      .map((reward) => amountOf(reward.token, reward.value));

  const toPosition = (pool: PoolFacts, rewards: readonly (LiquidityToken | null)[], address: PublicKey, state: PositionState, owner: string, at: ChainSource): LiquidityPosition => {
    const total = totalLiquidity(state);
    const locked = state.vestedLiquidity.add(state.permanentLockedLiquidity);
    const amounts = withdrawOf(pool, total);
    const unclaimed = getUnClaimLpFee(pool.state, state);
    return {
      venue: "meteora-damm2",
      network: SOLANA_NETWORK,
      address: address.toBase58(),
      pool: pool.address.toBase58(),
      owner,
      feeRecipient: owner,
      nftMint: state.nftMint.toBase58(),
      range: { kind: "range", ...boundsOf(pool.state, pool.x, pool.y) },
      rangeState: rangeStateOf(pool.state),
      amounts: { x: amountOf(pool.x, amounts.x), y: amountOf(pool.y, amounts.y) },
      unclaimedFees: { x: amountOf(pool.x, big(unclaimed.feeTokenA)), y: amountOf(pool.y, big(unclaimed.feeTokenB)) },
      unclaimedRewards: rewardAmounts(rewards, unclaimed.rewards),
      lockedBps: total.isZero() ? 0 : Number(big(locked.muln(10_000).div(total))),
      source: at,
    };
  };

  /** A Token-2022 account holding the NFT: its owner, or null when it holds none. */
  const holdingOwner = (account: PublicKey, info: Awaited<ReturnType<Connection["getAccountInfo"]>>, nftMint: PublicKey): PublicKey | null => {
    if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) return null;
    const token = unpackAccount(account, info, TOKEN_2022_PROGRAM_ID);
    return token.mint.equals(nftMint) && token.amount === 1n ? token.owner : null;
  };

  /**
   * Who holds the position's NFT now, and in which account. The NFT is minted into an account at an address derived
   * from it and usually stays there; one sent elsewhere is found among the wallet's own accounts (`wallet`, when the
   * caller names one) or, failing that, as the mint's largest holding.
   */
  const holderOf = async (nftMint: PublicKey, wallet?: PublicKey): Promise<{ owner: PublicKey; account: PublicKey } | null> => {
    const derived = derivePositionNftAccount(nftMint);
    const atDerived = holdingOwner(derived, await connection.getAccountInfo(derived, "confirmed"), nftMint);
    if (atDerived) return { owner: atDerived, account: derived };
    if (wallet) {
      const mine = await connection.getTokenAccountsByOwner(wallet, { mint: nftMint }, "confirmed");
      for (const entry of mine.value) if (holdingOwner(entry.pubkey, entry.account, nftMint)) return { owner: wallet, account: entry.pubkey };
      return null;
    }
    const largest = await connection.getTokenLargestAccounts(nftMint, "confirmed").catch(() => null);
    const holding = largest?.value.find((entry) => entry.amount === "1");
    if (!holding) return null;
    const owner = holdingOwner(holding.address, await connection.getAccountInfo(holding.address, "confirmed"), nftMint);
    return owner ? { owner, account: holding.address } : null;
  };

  /** The position, its pool and the person's right to act on it — every action starts here. */
  const ownedPosition = async (positionAddress: string, ownerAddress: string) => {
    const positionKey = key(positionAddress, "position");
    const owner = key(ownerAddress, "owner");
    let state: PositionState;
    try {
      state = await cpAmm.fetchPositionState(positionKey);
    } catch (error) {
      const info = await connection.getAccountInfo(positionKey, "confirmed");
      if (!info || !info.owner.equals(CP_AMM_PROGRAM_ID)) throw new LiquidityRefusal("POSITION_NOT_FOUND", "No DAMM v2 position at the address.");
      throw error;
    }
    const holder = await holderOf(state.nftMint, owner);
    if (!holder || !holder.owner.equals(owner)) throw new LiquidityRefusal("NOT_OWNER", "The wallet does not hold this position's NFT.");
    const pool = await facts(state.pool);
    return { positionKey, owner, state, pool, nftAccount: holder.account };
  };

  const tokenParams = (pool: PoolFacts) => ({
    tokenAMint: pool.state.tokenAMint,
    tokenBMint: pool.state.tokenBMint,
    tokenAVault: pool.state.tokenAVault,
    tokenBVault: pool.state.tokenBVault,
    tokenAProgram: new PublicKey(pool.x.program),
    tokenBProgram: new PublicKey(pool.y.program),
  });

  /**
   * The liquidity an add of up to `x` and `y` buys at the price now: across the price both sides are needed, and the
   * side that runs out first decides; off the price only the side the curve takes.
   */
  const depositOf = (pool: PoolFacts, x: bigint, y: bigint) => {
    const { state } = pool;
    const base = quoteBase(state);
    const fromX = () => cpAmm.getDepositQuote({ inAmount: new BN(x.toString()), isTokenA: true, ...base, inputTokenInfo: feeInfoX(pool), outputTokenInfo: feeInfoY(pool) });
    const fromY = () => cpAmm.getDepositQuote({ inAmount: new BN(y.toString()), isTokenA: false, ...base, inputTokenInfo: feeInfoY(pool), outputTokenInfo: feeInfoX(pool) });
    const state_ = rangeStateOf(state);
    if (state_ === "above") {
      const q = fromX();
      return { delta: q.liquidityDelta, x, y: 0n };
    }
    if (state_ === "below") {
      const q = fromY();
      return { delta: q.liquidityDelta, x: 0n, y };
    }
    if (x === 0n || y === 0n) throw new LiquidityRefusal("SIDE_NOT_ACCEPTED", "At the pool's price an add takes both tokens.");
    const qx = fromX();
    if (big(qx.outputAmount) <= y) return { delta: qx.liquidityDelta, x, y: big(qx.outputAmount) };
    const qy = fromY();
    return { delta: qy.liquidityDelta, x: big(qy.outputAmount), y };
  };

  const rentOfNewPosition = async (): Promise<bigint> => {
    const parts = await Promise.all([sizes.position, sizes.nftMint, sizes.nftAccount].filter((size) => size > 0).map((size) => connection.getMinimumBalanceForRentExemption(size, "confirmed")));
    return parts.reduce((sum, lamports) => sum + BigInt(lamports), 0n);
  };

  /** What closing returns: the lamports the position, its NFT mint and the NFT's account hold now. */
  const heldRent = async (...accounts: PublicKey[]): Promise<bigint> => {
    const infos = await connection.getMultipleAccountsInfo(accounts, "confirmed");
    return infos.reduce((sum, info) => sum + BigInt(info?.lamports ?? 0), 0n);
  };

  const notExpired = (preview: { expiresAt: number }): void => {
    if (now() > preview.expiresAt) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The preview is older than its window; preview again.");
  };

  const seal = async (transactions: readonly Transaction[], owner: PublicKey, signers: readonly Keypair[]) => {
    const latest = await connection.getLatestBlockhash("confirmed");
    const sealed = transactions.map((tx) => {
      tx.feePayer = owner;
      tx.recentBlockhash = latest.blockhash;
      tx.lastValidBlockHeight = latest.lastValidBlockHeight;
      const mine = signers.filter((signer) => tx.instructions.some((ix) => ix.keys.some((meta) => meta.isSigner && meta.pubkey.equals(signer.publicKey))));
      if (mine.length) tx.partialSign(...mine);
      return {
        wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"),
        presigned: mine.map((signer) => signer.publicKey.toBase58()),
      };
    });
    return { transactions: sealed, feePayer: owner.toBase58(), validUntil: String(latest.lastValidBlockHeight) };
  };

  const venueFees = (pool: LiquidityPool): readonly FeeRow[] => [{ who: "venue", applies_to: "swap", bps: pool.fees.currentBps ?? pool.fees.baseBps }];

  const expiry = () => {
    const at = now();
    return { at, expiresAt: at + DAMM_V2_PREVIEW_TTL_MS };
  };

  /** A build previews the request again on the chain and builds from that; the price may not have moved past the slippage. */
  const agrees = (given: { price: string; request: { slippageBps: number } }, fresh: { price: string }): void => {
    if (driftBps(given.price, fresh.price) > given.request.slippageBps) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The price moved past the slippage since the preview.");
  };

  const addPlan = async (request: AddLiquidityRequest) => {
    key(request.owner, "owner");
    assertBps(request.slippageBps, "slippageBps", 0, MAX_SLIPPAGE_BPS);
    const amountX = parseUnits(request.amountX, "amountX");
    const amountY = parseUnits(request.amountY, "amountY");
    let pool: PoolFacts;
    let held: Awaited<ReturnType<typeof ownedPosition>> | null = null;
    if (request.position) {
      held = await ownedPosition(request.position, request.owner);
      if (held.pool.address.toBase58() !== request.pool) throw new LiquidityRefusal("WRONG_POOL", "The position belongs to another pool.");
      pool = held.pool;
    } else {
      pool = await facts(key(request.pool, "pool"));
    }
    const read = await toPool(pool, await source());
    if (!read.enabled) throw new LiquidityRefusal("POOL_DISABLED", "The pool does not take liquidity now.");
    const rangeState = rangeStateOf(pool.state);
    assertSidesFit(rangeState, amountX, amountY);
    /*
     * The liquidity is sized for the amounts less the slippage, and the program's caps are that deposit plus the
     * slippage, never above what the person typed: the price may move by the slippage and the add still fits inside
     * the request, and the caps the wallet signs are the deposit Review shows.
     */
    const sized = depositOf(pool, minusSlippage(amountX, request.slippageBps), minusSlippage(amountY, request.slippageBps));
    if (sized.delta.isZero()) throw new LiquidityRefusal("AMOUNT_ZERO", "The amounts buy no liquidity at this price.");
    const cap = (units: bigint, typed: bigint) => (units === 0n ? 0n : plusSlippage(units, request.slippageBps) < typed ? plusSlippage(units, request.slippageBps) : typed);
    const deposit = { delta: sized.delta, x: cap(sized.x, amountX), y: cap(sized.y, amountY) };
    const notices: LiquidityNotice[] = [];
    if (rangeState !== "in_range") notices.push("one_sided");
    /* Short by more than the slippage on a side: the other side runs out first and part of this one stays in the wallet. */
    if (deposit.x < minusSlippage(amountX, request.slippageBps) || deposit.y < minusSlippage(amountY, request.slippageBps)) notices.push("partial_deposit");
    if (hasTransferFee(pool)) notices.push("transfer_fee");
    const rent: RentCost[] = held ? [] : [{ what: "position", direction: "pay", lamports: (await rentOfNewPosition()).toString(), refundable: true }];
    const preview: AddLiquidityPreview = {
      action: "add",
      venue: "meteora-damm2",
      pool: read.address,
      request: { ...request, bins: undefined, shape: undefined },
      opensPosition: !held,
      range: { kind: "range", ...boundsOf(pool.state, pool.x, pool.y) },
      rangeState,
      deposit: { x: amountOf(pool.x, deposit.x), y: amountOf(pool.y, deposit.y) },
      fees: [],
      rent,
      transactions: 1,
      notices,
      price: read.price,
      ...expiry(),
    };
    return { preview, pool, held, deposit };
  };

  const removePlan = async (request: RemoveLiquidityRequest) => {
    const shareBps = assertBps(request.shareBps, "shareBps", 1, 10_000);
    const slippageBps = assertBps(request.slippageBps, "slippageBps", 0, MAX_SLIPPAGE_BPS);
    const close = request.close === true;
    if (close && shareBps !== 10_000) throw new LiquidityRefusal("BAD_REQUEST", "Closing takes the whole position.");
    const held = await ownedPosition(request.position, request.owner);
    const locked = held.state.vestedLiquidity.add(held.state.permanentLockedLiquidity);
    const unlocked = held.state.unlockedLiquidity;
    if (close && !locked.isZero()) throw new LiquidityRefusal("POSITION_LOCKED", "Part of the position is locked, so it cannot be closed.");
    const delta = new BN(shareOf(big(unlocked), shareBps).toString());
    if (delta.isZero() && !close) throw new LiquidityRefusal(locked.isZero() ? "NOTHING_TO_WITHDRAW" : "POSITION_LOCKED", "Nothing in the position is withdrawable now.");
    const expected = withdrawOf(held.pool, delta);
    const read = await toPool(held.pool, await source());
    const unclaimed = getUnClaimLpFee(held.pool.state, held.state);
    const rewards = rewardAmounts(await rewardTokens(held.pool.state), unclaimed.rewards);
    const notices: LiquidityNotice[] = [];
    if (!locked.isZero()) notices.push("locked_part_stays");
    if (!close && rewards.length > 0) notices.push("rewards_separate");
    if (hasTransferFee(held.pool)) notices.push("transfer_fee");
    const preview: RemoveLiquidityPreview = {
      action: "remove",
      venue: "meteora-damm2",
      pool: read.address,
      request: { ...request, close },
      expected: { x: amountOf(held.pool.x, expected.x), y: amountOf(held.pool.y, expected.y) },
      minimum: { x: amountOf(held.pool.x, minusSlippage(expected.x, slippageBps)), y: amountOf(held.pool.y, minusSlippage(expected.y, slippageBps)) },
      feesClaimed: { x: amountOf(held.pool.x, close ? big(unclaimed.feeTokenA) : 0n), y: amountOf(held.pool.y, close ? big(unclaimed.feeTokenB) : 0n) },
      rewardsClaimed: close ? rewards : [],
      closesPosition: close,
      fees: [],
      rent: close ? [{ what: "position", direction: "return", lamports: (await heldRent(held.positionKey, held.state.nftMint, held.nftAccount)).toString(), refundable: true }] : [],
      transactions: 1,
      notices,
      price: read.price,
      ...expiry(),
    };
    return { preview, held, delta };
  };

  const claimPlan = async (request: ClaimFeesRequest) => {
    const held = await ownedPosition(request.position, request.owner);
    const unclaimed = getUnClaimLpFee(held.pool.state, held.state);
    if (unclaimed.feeTokenA.isZero() && unclaimed.feeTokenB.isZero()) throw new LiquidityRefusal("NOTHING_TO_CLAIM", "The position has no fees waiting.");
    const read = await toPool(held.pool, await source());
    const notices: LiquidityNotice[] = [];
    if (unclaimed.rewards.some((reward) => !reward.isZero())) notices.push("rewards_separate");
    if (hasTransferFee(held.pool)) notices.push("transfer_fee");
    const preview: ClaimFeesPreview = {
      action: "claim",
      venue: "meteora-damm2",
      pool: read.address,
      request,
      claimed: { x: amountOf(held.pool.x, big(unclaimed.feeTokenA)), y: amountOf(held.pool.y, big(unclaimed.feeTokenB)) },
      fees: [],
      rent: [],
      transactions: 1,
      notices,
      price: read.price,
      ...expiry(),
    };
    return { preview, held };
  };

  return {
    id: "meteora-damm2",
    label: "Meteora DAMM v2",
    network: SOLANA_NETWORK,
    program: DAMM_V2_PROGRAM,
    capabilities: () => ({ actions: liquidityActions(deps.actionsOpen ?? false), range: "pool", shapes: [], oneSided: true, maxBins: null }),
    venueCapabilities: liquidityVenueCapabilities,
    fees: venueFees,

    async pool(address) {
      return toPool(await facts(key(address, "pool")), await source());
    },

    async positions(ownerAddress, options) {
      const owner = key(ownerAddress, "owner");
      const at = await source();
      const held = options?.pool ? await cpAmm.getUserPositionByPool(key(options.pool, "pool"), owner) : await cpAmm.getPositionsByUser(owner);
      const pools = new Map<string, { pool: PoolFacts; rewards: (LiquidityToken | null)[] }>();
      const out: LiquidityPosition[] = [];
      for (const entry of held) {
        const poolKey = entry.positionState.pool.toBase58();
        let known = pools.get(poolKey);
        if (!known) {
          const pool = await facts(entry.positionState.pool);
          known = { pool, rewards: await rewardTokens(pool.state) };
          pools.set(poolKey, known);
        }
        out.push(toPosition(known.pool, known.rewards, entry.position, entry.positionState, owner.toBase58(), at));
      }
      return out.sort((a, b) => a.pool.localeCompare(b.pool) || a.address.localeCompare(b.address));
    },

    async position(address) {
      const positionKey = key(address, "position");
      let state: PositionState;
      try {
        state = await cpAmm.fetchPositionState(positionKey);
      } catch (error) {
        const info = await connection.getAccountInfo(positionKey, "confirmed");
        if (!info || !info.owner.equals(CP_AMM_PROGRAM_ID)) return null;
        throw error;
      }
      const holder = await holderOf(state.nftMint);
      const pool = await facts(state.pool);
      return toPosition(pool, await rewardTokens(pool.state), positionKey, state, holder?.owner.toBase58() ?? "", await source());
    },

    async previewAdd(request) {
      return (await addPlan(request)).preview;
    },

    async buildAdd(given) {
      notExpired(given);
      const plan = await addPlan(given.request);
      const fresh = plan.preview;
      agrees(given, fresh);
      if (fresh.rangeState !== given.rangeState || fresh.opensPosition !== given.opensPosition) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The price left the range since the preview.");
      const owner = key(fresh.request.owner, "owner");
      /* The caps are the fresh deposit's, never looser than the preview handed back: a doctored preview only tightens them. */
      const tighter = (fromChain: bigint, shown: string | undefined) => (shown !== undefined && /^\d+$/.test(shown) && BigInt(shown) < fromChain ? BigInt(shown) : fromChain);
      const maxX = new BN(tighter(plan.deposit.x, given.deposit?.x?.units).toString());
      const maxY = new BN(tighter(plan.deposit.y, given.deposit?.y?.units).toString());
      const thresholds = { maxAmountTokenA: maxX, maxAmountTokenB: maxY, tokenAAmountThreshold: maxX, tokenBAmountThreshold: maxY };
      if (plan.held) {
        const { held } = plan;
        const tx = await cpAmm.addLiquidity({ owner, position: held.positionKey, pool: held.pool.address, positionNftAccount: held.nftAccount, liquidityDelta: plan.deposit.delta, ...thresholds, ...tokenParams(held.pool) });
        return { preview: fresh, position: held.positionKey.toBase58(), ...(await seal([tx], owner, [])) };
      }
      const nft = newKeypair();
      const { tokenAMint, tokenBMint, tokenAProgram, tokenBProgram } = tokenParams(plan.pool);
      const tx = await cpAmm.createPositionAndAddLiquidity({ owner, pool: plan.pool.address, positionNft: nft.publicKey, liquidityDelta: plan.deposit.delta, ...thresholds, tokenAMint, tokenBMint, tokenAProgram, tokenBProgram });
      return { preview: fresh, position: derivePositionAddress(nft.publicKey).toBase58(), ...(await seal([tx], owner, [nft])) };
    },

    async previewRemove(request) {
      return (await removePlan(request)).preview;
    },

    async buildRemove(given) {
      notExpired(given);
      const plan = await removePlan(given.request);
      const fresh = plan.preview;
      agrees(given, fresh);
      const { held } = plan;
      /* The floor is the higher of the fresh one and the one Review showed: a doctored preview only raises it. */
      const floor = (fromChain: string, shown: string | undefined) => (shown !== undefined && /^\d+$/.test(shown) && BigInt(shown) > BigInt(fromChain) ? shown : fromChain);
      const minimum = fresh.minimum!;
      const thresholdA = new BN(floor(minimum.x.units, given.minimum?.x?.units));
      const thresholdB = new BN(floor(minimum.y.units, given.minimum?.y?.units));
      const currentPoint = await getCurrentPoint(connection, held.pool.state.activationType);
      /* A vesting releases its share only when the remove names it; with none, the call skips the read. */
      const vestings = held.state.vestedLiquidity.isZero()
        ? []
        : (await cpAmm.getAllVestingsByPosition(held.positionKey)).map((vesting) => ({ account: vesting.publicKey, vestingState: vesting.account }));
      if (fresh.request.close) {
        const tx = await cpAmm.removeAllLiquidityAndClosePosition({
          owner: held.owner,
          position: held.positionKey,
          positionNftAccount: held.nftAccount,
          poolState: held.pool.state,
          positionState: held.state,
          tokenAAmountThreshold: thresholdA,
          tokenBAmountThreshold: thresholdB,
          vestings,
          currentPoint,
        });
        return { preview: fresh, position: fresh.request.position, ...(await seal([tx], held.owner, [])) };
      }
      const tx = await cpAmm.removeLiquidity({
        owner: held.owner,
        position: held.positionKey,
        pool: held.pool.address,
        positionNftAccount: held.nftAccount,
        liquidityDelta: plan.delta,
        tokenAAmountThreshold: thresholdA,
        tokenBAmountThreshold: thresholdB,
        vestings,
        currentPoint,
        ...tokenParams(held.pool),
      });
      return { preview: fresh, position: fresh.request.position, ...(await seal([tx], held.owner, [])) };
    },

    async previewClaim(request) {
      return (await claimPlan(request)).preview;
    },

    async buildClaim(given) {
      notExpired(given);
      const { preview: fresh, held } = await claimPlan(given.request);
      const tx = await cpAmm.claimPositionFee2({
        owner: held.owner,
        position: held.positionKey,
        pool: held.pool.address,
        positionNftAccount: held.nftAccount,
        receiver: held.owner,
        ...tokenParams(held.pool),
      });
      return { preview: fresh, position: fresh.request.position, ...(await seal([tx], held.owner, [])) };
    },
  };
}
