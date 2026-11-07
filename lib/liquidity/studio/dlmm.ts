/**
 * Liquidity Studio's DLMM venue (Meteora `LBUZKhRx…wxo`, `@meteora-ag/dlmm`):
 * a pool's bins and fees, a wallet's positions from the program's accounts,
 * and the add / remove / claim the person's wallet signs.
 *
 * The SDK comes in through `deps.sdk`: Next imports its ESM build
 * (`./venues.server.ts`), while Node's own loader cannot (the build imports a
 * directory of `@coral-xyz/anchor`), so the tests hand in its CommonJS build.
 * Nothing here is the launch engine's: the ladder of Ryntra's own markets
 * (`lib/core/venues/meteora-dlmm/floor.server.ts`) signs with the executor's
 * key; this venue signs with nothing but a fresh position key.
 */

import type { FeeRow } from "@ryntra/core/adapters";
import type DLMMClass from "@meteora-ag/dlmm";
import type { LbPosition, PositionInfo, TokenReserve } from "@meteora-ag/dlmm";
import { getTransferFeeConfig, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, SYSVAR_CLOCK_PUBKEY, type Connection, type Transaction } from "@solana/web3.js";
import BN from "bn.js";

import {
  LiquidityRefusal,
  SOLANA_NETWORK,
  liquidityActions,
  liquidityVenueCapabilities,
  type AddLiquidityPreview,
  type AddLiquidityRequest,
  type BuiltLiquidity,
  type ChainSource,
  type ClaimFeesPreview,
  type ClaimFeesRequest,
  type LiquidityNotice,
  type LiquidityPool,
  type LiquidityPosition,
  SHAPE_TO_STRATEGY,
  type LiquidityToken,
  type LiquidityVenueAdapter,
  type RemoveLiquidityPreview,
  type RemoveLiquidityRequest,
  type RentCost,
} from "./contract.ts";
import { amountOf, assertBinRange, assertBps, assertSidesFit, binRangeState, driftBps, parseUnits, percentToBps, shareOf, wholeUnits } from "./math.ts";

export const DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo";
/** How long a preview holds before a build refuses it. */
export const DLMM_PREVIEW_TTL_MS = 30_000;
/** The most a person may ask the price to move while the add lands, basis points. */
export const MAX_SLIPPAGE_BPS = 5_000;

/** The pieces of `@meteora-ag/dlmm` this venue uses, from whichever build the caller can load. */
export type DlmmSdk = Readonly<{
  DLMM: typeof DLMMClass;
  getPriceOfBinByBinId: typeof import("@meteora-ag/dlmm").getPriceOfBinByBinId;
  wrapPosition: typeof import("@meteora-ag/dlmm").wrapPosition;
  createProgram: typeof import("@meteora-ag/dlmm").createProgram;
  ClockLayout: typeof import("@meteora-ag/dlmm").ClockLayout;
  DEFAULT_BIN_PER_POSITION: BN;
}>;

export type DlmmVenueDeps = Readonly<{
  connection: Connection;
  sdk: DlmmSdk;
  /** A new position's key; the tests pass a fixed one. */
  newKeypair?: () => Keypair;
  now?: () => number;
  /** Actions for people open after a first live check with the smallest amount. */
  actionsOpen?: boolean;
}>;

type Dlmm = InstanceType<typeof DLMMClass>;

/** The pair's own bound on a bin id for its step: past it the price leaves what the program can hold. */
function maxBinIdFor(binStep: number): number {
  return Math.floor(Math.log(2 ** 64) / Math.log(1 + binStep / 10_000));
}

function key(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new LiquidityRefusal("BAD_REQUEST", `${field} is not a Solana address.`);
  }
}

/** The SDK's figures in base units: a Decimal string (fraction floored, exponent form read), a BN or a bigint. */
function units(value: string | BN | bigint | number): bigint {
  if (typeof value === "number") return wholeUnits(BigInt(Math.floor(value)));
  return wholeUnits(value);
}

/** A key the program leaves unset reads as the all-zero address. */
const isSet = (value: PublicKey): boolean => !value.equals(PublicKey.default);

/** At most this many accounts in one `getMultipleAccounts`; the clock rides in the first chunk. */
const ACCOUNTS_PER_CALL = 99;

export function createDlmmVenue(deps: DlmmVenueDeps): LiquidityVenueAdapter {
  const { connection, sdk } = deps;
  const now = deps.now ?? Date.now;
  const newKeypair = deps.newKeypair ?? (() => Keypair.generate());
  const maxBins = sdk.DEFAULT_BIN_PER_POSITION.toNumber();
  const program = sdk.createProgram(connection, { cluster: "mainnet-beta" });

  /**
   * Rent of a program account, asked of the network by the account's size. The SDK's own constants
   * (`POSITION_FEE` and the like) carry the rate of the day they were written; the network's rate has fallen since.
   */
  const rentOf = async (account: "positionV2" | "binArray" | "binArrayBitmapExtension", count = 1): Promise<string> =>
    (BigInt(await connection.getMinimumBalanceForRentExemption(program.account[account].size, "confirmed")) * BigInt(count)).toString();

  const open = async (pool: PublicKey): Promise<Dlmm> => {
    try {
      return await sdk.DLMM.create(connection, pool, { cluster: "mainnet-beta" });
    } catch (error) {
      /* Only an account that is not there, or not the program's, is "no pool"; a failing RPC stays a failure. */
      const info = await connection.getAccountInfo(pool, "confirmed");
      if (!info || info.owner.toBase58() !== DLMM_PROGRAM) throw new LiquidityRefusal("POOL_NOT_FOUND", "No DLMM pool at the address.");
      throw error;
    }
  };

  const tokenOf = (reserve: TokenReserve): LiquidityToken => ({ mint: reserve.publicKey.toBase58(), decimals: reserve.mint.decimals, program: reserve.owner.toBase58() });

  const hasTransferFee = (reserve: TokenReserve): boolean => reserve.owner.equals(TOKEN_2022_PROGRAM_ID) && getTransferFeeConfig(reserve.mint) !== null;

  /** Y per one X at a bin, in whole tokens, to ten significant digits. */
  const binPrice = (binId: number, binStep: number, x: LiquidityToken, y: LiquidityToken): string =>
    sdk.getPriceOfBinByBinId(binId, binStep).mul(10 ** (x.decimals - y.decimals)).toSignificantDigits(10).toFixed();

  const source = async (): Promise<ChainSource> => {
    const slot = await connection.getSlot("confirmed").catch(() => null);
    return { kind: "chain", program: DLMM_PROGRAM, slot, at: now() };
  };

  const toPool = (dlmm: Dlmm, at: ChainSource): LiquidityPool => {
    const x = tokenOf(dlmm.tokenX);
    const y = tokenOf(dlmm.tokenY);
    const pair = dlmm.lbPair;
    const info = dlmm.getFeeInfo();
    return {
      venue: "meteora-dlmm",
      network: SOLANA_NETWORK,
      address: dlmm.pubkey.toBase58(),
      tokenX: x,
      tokenY: y,
      price: binPrice(pair.activeId, pair.binStep, x, y),
      shape: { kind: "bins", binStepBps: pair.binStep, activeBin: pair.activeId },
      fees: {
        baseBps: percentToBps(info.baseFeeRatePercentage.toString()),
        currentBps: percentToBps(dlmm.getDynamicFee().toString()),
        maxBps: percentToBps(info.maxFeeRatePercentage.toString()),
        protocolSharePct: Number(info.protocolFeePercentage.toString()),
      },
      reserves: { x: amountOf(x, dlmm.tokenX.amount), y: amountOf(y, dlmm.tokenY.amount) },
      enabled: pair.status === 0,
      source: at,
    };
  };

  /**
   * Whether each position is locked now: a launch can lock a position until a slot or a time (`lockReleasePoint`).
   * Without the clock, or without a position's account, the answer is "locked" — never a withdraw on a guess.
   */
  const lockedOf = async (keys: readonly PublicKey[], activationType: number): Promise<ReadonlyMap<string, boolean>> => {
    const out = new Map<string, boolean>();
    if (keys.length === 0) return out;
    const chunks: PublicKey[][] = [];
    for (let i = 0; i < keys.length; i += ACCOUNTS_PER_CALL) chunks.push(keys.slice(i, i + ACCOUNTS_PER_CALL));
    let point: BN | null = null;
    for (const [index, chunk] of chunks.entries()) {
      const infos = await connection.getMultipleAccountsInfo(index === 0 ? [SYSVAR_CLOCK_PUBKEY, ...chunk] : chunk, "confirmed");
      if (index === 0) {
        const clockInfo = infos.shift();
        if (clockInfo) {
          const clock = sdk.ClockLayout.decode(clockInfo.data) as { slot: BN; unixTimestamp: BN };
          point = activationType === 0 ? clock.slot : clock.unixTimestamp;
        }
      }
      chunk.forEach((positionKey, i) => {
        const info = infos[i];
        out.set(positionKey.toBase58(), !info || point === null || sdk.wrapPosition(program, positionKey, info).lockReleasePoint().gt(point));
      });
    }
    return out;
  };

  type PairFacts = Readonly<{ address: string; activeId: number; binStep: number; x: LiquidityToken; y: LiquidityToken; rewardMints: readonly (LiquidityToken | null)[] }>;

  const rewardsOf = (pair: PairFacts, data: LbPosition["positionData"]) =>
    [data.rewardOne, data.rewardTwo]
      .map((value, index) => ({ value: units(value), token: pair.rewardMints[index] ?? null }))
      .filter((reward): reward is { value: bigint; token: LiquidityToken } => reward.token !== null && reward.value > 0n)
      .map((reward) => amountOf(reward.token, reward.value));

  const toPosition = (pair: PairFacts, position: LbPosition, locked: boolean, at: ChainSource): LiquidityPosition => {
    const data = position.positionData;
    return {
      venue: "meteora-dlmm",
      network: SOLANA_NETWORK,
      address: position.publicKey.toBase58(),
      pool: pair.address,
      owner: data.owner.toBase58(),
      feeRecipient: isSet(data.feeOwner) ? data.feeOwner.toBase58() : data.owner.toBase58(),
      nftMint: null,
      range: {
        kind: "bins",
        lowerBin: data.lowerBinId,
        upperBin: data.upperBinId,
        lowerPrice: binPrice(data.lowerBinId, pair.binStep, pair.x, pair.y),
        upperPrice: binPrice(data.upperBinId, pair.binStep, pair.x, pair.y),
      },
      rangeState: binRangeState(data.lowerBinId, data.upperBinId, pair.activeId),
      amounts: { x: amountOf(pair.x, units(data.totalXAmount)), y: amountOf(pair.y, units(data.totalYAmount)) },
      unclaimedFees: { x: amountOf(pair.x, units(data.feeX)), y: amountOf(pair.y, units(data.feeY)) },
      unclaimedRewards: rewardsOf(pair, data),
      lockedBps: locked ? 10_000 : 0,
      source: at,
    };
  };

  /** A pair's reward tokens, read once per pair; a slot with no reward is null. A mint's decimals sit at byte 44 of its account. */
  const rewardTokensOf = async (rewardMints: readonly PublicKey[]): Promise<(LiquidityToken | null)[]> => {
    const live = rewardMints.map((mint) => (isSet(mint) ? mint : null));
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

  const pairFacts = async (address: string, lbPair: Dlmm["lbPair"], tokenX: TokenReserve, tokenY: TokenReserve): Promise<PairFacts> => ({
    address,
    activeId: lbPair.activeId,
    binStep: lbPair.binStep,
    x: tokenOf(tokenX),
    y: tokenOf(tokenY),
    rewardMints: await rewardTokensOf(lbPair.rewardInfos.map((reward) => reward.mint)),
  });

  /** The position, its pool and the person's right to act on it — every action starts here. */
  const ownedPosition = async (positionAddress: string, ownerAddress: string) => {
    const positionKey = key(positionAddress, "position");
    const owner = key(ownerAddress, "owner");
    const info = await connection.getAccountInfo(positionKey, "confirmed");
    if (!info || info.owner.toBase58() !== DLMM_PROGRAM) throw new LiquidityRefusal("POSITION_NOT_FOUND", "No DLMM position at the address.");
    const wrapped = sdk.wrapPosition(program, positionKey, info);
    if (!wrapped.owner().equals(owner)) throw new LiquidityRefusal("NOT_OWNER", "The wallet does not own this position.");
    const dlmm = await open(wrapped.lbPair());
    const lbPosition = await dlmm.getPosition(positionKey);
    const locked = (await lockedOf([positionKey], dlmm.lbPair.activationType)).get(positionKey.toBase58()) ?? true;
    const feeOwner = wrapped.feeOwner();
    /* The program pays a claim to the fee owner when one is set; the person would sign for someone else's fees. */
    const feesElsewhere = isSet(feeOwner) && !feeOwner.equals(owner);
    return { positionKey, owner, dlmm, lbPosition, wrapped, locked, feesElsewhere, rentLamports: info.lamports };
  };

  const notExpired = (preview: { expiresAt: number }): void => {
    if (now() > preview.expiresAt) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The preview is older than its window; preview again.");
  };

  /**
   * A build previews the request again on the chain and builds from that; the preview it is handed only has to agree.
   * The price may not have moved past the person's slippage (at least one bin's worth — DLMM's own smallest step).
   */
  const agrees = (given: { price: string; request: { slippageBps: number } }, fresh: { price: string }, binStep: number): void => {
    /* Half a basis point over: prices are read to ten digits, and a move of exactly one bin must still pass. */
    const tolerance = Math.max(given.request.slippageBps, binStep) + 0.5;
    if (driftBps(given.price, fresh.price) > tolerance) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The price moved past the slippage since the preview.");
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
    return { at, expiresAt: at + DLMM_PREVIEW_TTL_MS };
  };

  const addPlan = async (request: AddLiquidityRequest) => {
    key(request.owner, "owner");
    assertBps(request.slippageBps, "slippageBps", 0, MAX_SLIPPAGE_BPS);
    const amountX = parseUnits(request.amountX, "amountX");
    const amountY = parseUnits(request.amountY, "amountY");
    const shape = request.shape ?? "spot";
    if (!Object.hasOwn(SHAPE_TO_STRATEGY, shape)) throw new LiquidityRefusal("BAD_REQUEST", "Unknown shape.");

    let dlmm: Dlmm;
    let held: Awaited<ReturnType<typeof ownedPosition>> | null = null;
    let lower: number;
    let upper: number;
    if (request.position) {
      held = await ownedPosition(request.position, request.owner);
      if (held.dlmm.pubkey.toBase58() !== request.pool) throw new LiquidityRefusal("WRONG_POOL", "The position belongs to another pool.");
      dlmm = held.dlmm;
      lower = held.lbPosition.positionData.lowerBinId;
      upper = held.lbPosition.positionData.upperBinId;
    } else {
      if (!request.bins) throw new LiquidityRefusal("RANGE_INVALID", "A new position needs its bins.");
      dlmm = await open(key(request.pool, "pool"));
      lower = request.bins.lower;
      upper = request.bins.upper;
      assertBinRange(lower, upper, maxBins, maxBinIdFor(dlmm.lbPair.binStep));
    }
    const pool = toPool(dlmm, await source());
    if (!pool.enabled) throw new LiquidityRefusal("POOL_DISABLED", "The pool does not take liquidity now.");
    const rangeState = binRangeState(lower, upper, dlmm.lbPair.activeId);
    assertSidesFit(rangeState, amountX, amountY);

    const rent: RentCost[] = [];
    if (!held) {
      rent.push({ what: "position", direction: "pay", lamports: await rentOf("positionV2"), refundable: true });
      const quote = await dlmm.quoteCreatePosition({ strategy: { minBinId: lower, maxBinId: upper, strategyType: SHAPE_TO_STRATEGY[shape] } });
      if (quote.binArraysCount > 0) rent.push({ what: "bin_arrays", direction: "pay", lamports: await rentOf("binArray", quote.binArraysCount), refundable: false });
      if (quote.bitmapExtensionCost > 0) rent.push({ what: "bitmap_extension", direction: "pay", lamports: await rentOf("binArrayBitmapExtension"), refundable: false });
    }
    const notices: LiquidityNotice[] = [];
    if (rangeState !== "in_range") notices.push("one_sided");
    if (hasTransferFee(dlmm.tokenX) || hasTransferFee(dlmm.tokenY)) notices.push("transfer_fee");
    const preview: AddLiquidityPreview = {
      action: "add",
      venue: "meteora-dlmm",
      pool: pool.address,
      request: { ...request, shape, bins: { lower, upper } },
      opensPosition: !held,
      range: { kind: "bins", lowerBin: lower, upperBin: upper, lowerPrice: binPrice(lower, dlmm.lbPair.binStep, pool.tokenX, pool.tokenY), upperPrice: binPrice(upper, dlmm.lbPair.binStep, pool.tokenX, pool.tokenY) },
      rangeState,
      deposit: { x: amountOf(pool.tokenX, amountX), y: amountOf(pool.tokenY, amountY) },
      fees: [],
      rent,
      /* The SDK adds to a wide or extended position in chunks of the bins one position holds. */
      transactions: Math.max(1, Math.ceil((upper - lower + 1) / maxBins)),
      notices,
      price: pool.price,
      ...expiry(),
    };
    return { preview, dlmm, held, amountX, amountY, lower, upper, shape };
  };

  const removePlan = async (request: RemoveLiquidityRequest) => {
    const shareBps = assertBps(request.shareBps, "shareBps", 1, 10_000);
    assertBps(request.slippageBps, "slippageBps", 0, MAX_SLIPPAGE_BPS);
    const close = request.close === true;
    if (close && shareBps !== 10_000) throw new LiquidityRefusal("BAD_REQUEST", "Closing takes the whole position.");
    const held = await ownedPosition(request.position, request.owner);
    if (held.locked) throw new LiquidityRefusal("POSITION_LOCKED", "The position is locked until its release point.");
    const data = held.lbPosition.positionData;
    const pool = toPool(held.dlmm, await source());
    const totalX = units(data.totalXAmount);
    const totalY = units(data.totalYAmount);
    const feeX = units(data.feeX);
    const feeY = units(data.feeY);
    const facts = await pairFacts(pool.address, held.dlmm.lbPair, held.dlmm.tokenX, held.dlmm.tokenY);
    const rewards = rewardsOf(facts, data);
    const empty = totalX === 0n && totalY === 0n;
    if (empty && !close) throw new LiquidityRefusal("NOTHING_TO_WITHDRAW", "The position holds nothing.");
    /* Closing claims the fees to the fee owner and opens its token accounts on the person's rent: never for another wallet. */
    if (close && held.feesElsewhere) throw new LiquidityRefusal("FEES_GO_ELSEWHERE", "Closing claims the fees, and this position pays them to another wallet.");
    const notices: LiquidityNotice[] = [];
    if (!close && rewards.length > 0) notices.push("rewards_separate");
    if (hasTransferFee(held.dlmm.tokenX) || hasTransferFee(held.dlmm.tokenY)) notices.push("transfer_fee");
    const width = data.upperBinId - data.lowerBinId + 1;
    const preview: RemoveLiquidityPreview = {
      action: "remove",
      venue: "meteora-dlmm",
      pool: pool.address,
      request: { ...request, close },
      expected: { x: amountOf(pool.tokenX, shareOf(totalX, shareBps)), y: amountOf(pool.tokenY, shareOf(totalY, shareBps)) },
      minimum: null,
      feesClaimed: { x: amountOf(pool.tokenX, close ? feeX : 0n), y: amountOf(pool.tokenY, close ? feeY : 0n) },
      rewardsClaimed: close ? rewards : [],
      closesPosition: close,
      fees: [],
      rent: close ? [{ what: "position", direction: "return", lamports: String(held.rentLamports), refundable: true }] : [],
      /* The SDK splits the range by the bins a position holds at most, over the bins that hold liquidity. */
      transactions: Math.max(1, Math.ceil(width / maxBins)),
      notices,
      price: pool.price,
      ...expiry(),
    };
    /* Empty by the program's own count: no liquidity share in any bin and nothing pending, not amounts rounded to zero. */
    const noShares = held.wrapped.liquidityShares().every((share) => share.isZero());
    return { preview, held, empty: noShares && feeX === 0n && feeY === 0n && units(data.rewardOne) === 0n && units(data.rewardTwo) === 0n };
  };

  const claimPlan = async (request: ClaimFeesRequest) => {
    const held = await ownedPosition(request.position, request.owner);
    const data = held.lbPosition.positionData;
    const pool = toPool(held.dlmm, await source());
    const feeX = units(data.feeX);
    const feeY = units(data.feeY);
    if (feeX === 0n && feeY === 0n) throw new LiquidityRefusal("NOTHING_TO_CLAIM", "The position has no fees waiting.");
    if (held.feesElsewhere) throw new LiquidityRefusal("FEES_GO_ELSEWHERE", "This position pays its fees to another wallet.");
    const notices: LiquidityNotice[] = [];
    if (units(data.rewardOne) > 0n || units(data.rewardTwo) > 0n) notices.push("rewards_separate");
    if (hasTransferFee(held.dlmm.tokenX) || hasTransferFee(held.dlmm.tokenY)) notices.push("transfer_fee");
    const preview: ClaimFeesPreview = {
      action: "claim",
      venue: "meteora-dlmm",
      pool: pool.address,
      request,
      claimed: { x: amountOf(pool.tokenX, feeX), y: amountOf(pool.tokenY, feeY) },
      fees: [],
      rent: [],
      transactions: Math.max(1, Math.ceil((data.upperBinId - data.lowerBinId + 1) / maxBins)),
      notices,
      price: pool.price,
      ...expiry(),
    };
    return { preview, held };
  };

  return {
    id: "meteora-dlmm",
    label: "Meteora DLMM",
    network: SOLANA_NETWORK,
    program: DLMM_PROGRAM,
    capabilities: () => ({ actions: liquidityActions(deps.actionsOpen ?? false), range: "bins", shapes: ["spot", "curve", "bid_ask"], oneSided: true, maxBins }),
    venueCapabilities: liquidityVenueCapabilities,
    fees: venueFees,

    async pool(address) {
      const dlmm = await open(key(address, "pool"));
      return toPool(dlmm, await source());
    },

    async positions(ownerAddress, options) {
      const owner = key(ownerAddress, "owner");
      const at = await source();
      const groups: { address: string; pair: Dlmm["lbPair"]; tokenX: TokenReserve; tokenY: TokenReserve; positions: LbPosition[] }[] = [];
      if (options?.pool) {
        const dlmm = await open(key(options.pool, "pool"));
        const { userPositions } = await dlmm.getPositionsByUserAndLbPair(owner);
        groups.push({ address: dlmm.pubkey.toBase58(), pair: dlmm.lbPair, tokenX: dlmm.tokenX, tokenY: dlmm.tokenY, positions: userPositions });
      } else {
        const all: Map<string, PositionInfo> = await sdk.DLMM.getAllLbPairPositionsByUser(connection, owner, { cluster: "mainnet-beta" });
        for (const [address, info] of all) groups.push({ address, pair: info.lbPair, tokenX: info.tokenX, tokenY: info.tokenY, positions: info.lbPairPositionsData });
      }
      const out: LiquidityPosition[] = [];
      for (const group of groups) {
        const facts = await pairFacts(group.address, group.pair, group.tokenX, group.tokenY);
        const locks = await lockedOf(
          group.positions.map((p) => p.publicKey),
          group.pair.activationType,
        );
        for (const position of group.positions) out.push(toPosition(facts, position, locks.get(position.publicKey.toBase58()) ?? true, at));
      }
      return out.sort((a, b) => a.pool.localeCompare(b.pool) || a.address.localeCompare(b.address));
    },

    async position(address) {
      const positionKey = key(address, "position");
      const info = await connection.getAccountInfo(positionKey, "confirmed");
      if (!info || info.owner.toBase58() !== DLMM_PROGRAM) return null;
      const wrapped = sdk.wrapPosition(program, positionKey, info);
      const dlmm = await open(wrapped.lbPair());
      const lbPosition = await dlmm.getPosition(positionKey);
      const facts = await pairFacts(dlmm.pubkey.toBase58(), dlmm.lbPair, dlmm.tokenX, dlmm.tokenY);
      const locked = (await lockedOf([positionKey], dlmm.lbPair.activationType)).get(address) ?? true;
      return toPosition(facts, lbPosition, locked, await source());
    },

    async previewAdd(request) {
      return (await addPlan(request)).preview;
    },

    async buildAdd(given) {
      notExpired(given);
      const plan = await addPlan(given.request);
      const fresh = plan.preview;
      agrees(given, fresh, plan.dlmm.lbPair.binStep);
      if (fresh.rangeState !== given.rangeState || fresh.opensPosition !== given.opensPosition) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The price crossed the range since the preview.");
      const owner = key(fresh.request.owner, "owner");
      const strategy = { minBinId: plan.lower, maxBinId: plan.upper, strategyType: SHAPE_TO_STRATEGY[plan.shape] };
      const totalXAmount = new BN(plan.amountX.toString());
      const totalYAmount = new BN(plan.amountY.toString());
      /* The SDK reads 0 as "its default" (three bins); the smallest tolerance it holds is one bin. */
      const slippage = Math.max(fresh.request.slippageBps, 1) / 100;
      if (plan.held) {
        const tx = await plan.dlmm.addLiquidityByStrategy({ positionPubKey: plan.held.positionKey, totalXAmount, totalYAmount, strategy, user: owner, slippage });
        return { preview: fresh, position: plan.held.positionKey.toBase58(), ...(await seal([tx], owner, [])) };
      }
      const positionKeypair = newKeypair();
      const tx = await plan.dlmm.initializePositionAndAddLiquidityByStrategy({ positionPubKey: positionKeypair.publicKey, totalXAmount, totalYAmount, strategy, user: owner, slippage });
      return { preview: fresh, position: positionKeypair.publicKey.toBase58(), ...(await seal([tx], owner, [positionKeypair])) };
    },

    async previewRemove(request) {
      return (await removePlan(request)).preview;
    },

    async buildRemove(given) {
      notExpired(given);
      const plan = await removePlan(given.request);
      const fresh = plan.preview;
      agrees(given, fresh, plan.held.dlmm.lbPair.binStep);
      const { held } = plan;
      const data = held.lbPosition.positionData;
      if (fresh.request.close && plan.empty) {
        /* Nothing left in the bins and nothing waiting: the SDK's remove has no bins to walk, so close the account itself. */
        const tx = await held.dlmm.closePositionIfEmpty({ owner: held.owner, position: held.lbPosition });
        return { preview: fresh, position: fresh.request.position, ...(await seal([tx], held.owner, [])) };
      }
      const txs = await held.dlmm.removeLiquidity({
        user: held.owner,
        position: held.positionKey,
        fromBinId: data.lowerBinId,
        toBinId: data.upperBinId,
        bps: new BN(fresh.request.shareBps),
        shouldClaimAndClose: fresh.request.close === true,
      });
      if (txs.length === 0) throw new LiquidityRefusal("NOTHING_TO_WITHDRAW", "No bin of the position holds liquidity.");
      return { preview: fresh, position: fresh.request.position, ...(await seal(txs, held.owner, [])) };
    },

    async previewClaim(request) {
      return (await claimPlan(request)).preview;
    },

    async buildClaim(given) {
      notExpired(given);
      const { preview: fresh, held } = await claimPlan(given.request);
      const txs = await held.dlmm.claimSwapFee({ owner: held.owner, position: held.lbPosition });
      if (txs.length === 0) throw new LiquidityRefusal("NOTHING_TO_CLAIM", "The position has no fees waiting.");
      return { preview: fresh, position: fresh.request.position, ...(await seal(txs, held.owner, [])) };
    },
  };
}

export type { BuiltLiquidity };
