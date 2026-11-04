import {
  ActivationType,
  BaseFeeMode,
  CP_AMM_PROGRAM_ID,
  CollectFeeMode,
  CpAmm,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  Rounding,
  calculateTransferFeeExcludedAmount,
  calculateTransferFeeIncludedAmount,
  deriveCustomizablePoolAddress,
  derivePositionAddress,
  getAmountAFromLiquidityDelta,
  getAmountBFromLiquidityDelta,
  getBaseFeeParams,
  getDynamicFeeParams,
  getLiquidityDeltaFromAmountA,
  getLiquidityDeltaFromAmountB,
  getSqrtPriceFromPrice,
  type PoolFeesParams,
} from '@meteora-ag/cp-amm-sdk';
import { ACCOUNT_SIZE, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccountLenForMint, getTransferFeeConfig, unpackMint, type Mint } from '@solana/spl-token';
import { ComputeBudgetProgram, Keypair, PublicKey, type Connection } from '@solana/web3.js';
import BN from 'bn.js';

import {
  LiquidityRefusal,
  type AddLiquidityPreview,
  type AddLiquidityRequest,
  type BuiltLiquidity,
  type LiquidityNotice,
  type LiquidityToken,
  type LiquidityVenueAdapter,
  type RentCost,
} from '../../../lib/liquidity/studio/contract.ts';
import { DAMM_V2_PREVIEW_TTL_MS, POSITION_ACCOUNT_SIZES } from '../../../lib/liquidity/studio/damm-v2.ts';
import { amountOf, parseUnits } from '../../../lib/liquidity/studio/math.ts';
import { STOCK_PIER_BASE_FEE_BPS } from './stock-pier.ts';

/**
 * The Stock Pier's build (CITY-98): a venue adapter that stands in front of the engine's own DAMM v2 adapter and
 * knows one more thing — how to make the pair's pier when it is not there yet. Everything else it hands to the
 * engine's adapter unchanged: mooring beside a standing pier, taking fees, leaving.
 *
 * It is given to the engine's Review (`reviewLiquidityAction`, `lib/liquidity/studio/actions.ts`) as that Review's
 * venue, so a pier is built under the engine's own rules and nothing new: its gate, the fresh key sealed for the relay
 * instead of signing first, the check that every signer is one the relay holds, the check that the transaction calls
 * only the venue and the wallet's own token-account plumbing, the simulation before anyone is asked to sign, the
 * blockhash's life and the sealed ticket. The engine's relay then sends the wallet's bytes once, unchanged.
 *
 * What a build makes — one transaction, one signature of the person's (the fresh NFT key of the position signs after,
 * at the relay): the customizable DAMM v2 pool of the stock (A) and the quote coin (B) on the template «Exchange
 * hours» (the whole curve, a 0.30 % base fee with the venue's volatility part, fees collected in the quote coin only,
 * active at once, nothing locked), its price set to the live market's, and the person's first position in it with
 * the two amounts they chose. The pool's own accounts are paid by its maker and stay the pool's; the position's come
 * back when it is closed.
 */

/** The pair and the price a build is made at, chosen and priced by the server's door — never by the browser. */
export type StockBuildPlan = Readonly<{
  owner: string;
  /** The stock's mint (the pool's A). */
  stock: string;
  /** SOL or USDC (the pool's B). */
  quote: string;
  /** Quote coin for one base token of the stock (before the multiplier), from the live market. */
  price: number;
}>;

export type StockPierVenueDeps = Readonly<{
  connection: Connection;
  /** The engine's own DAMM v2 adapter on the same endpoint. */
  base: LiquidityVenueAdapter;
  plan: StockBuildPlan;
  newKeypair?: () => Keypair;
  now?: () => number;
}>;

/** A pool made with Token-2022 vaults and a first position costs more than the default compute budget. */
export const STOCK_BUILD_COMPUTE_UNITS = 400_000;
/** The pool account's size in bytes (the program's `pool`, as its IDL states it). */
export const POOL_ACCOUNT_SIZE = 1_112;

/** The template's fees, as the program takes them: a static base fee and the venue's default volatility part. */
export function stockPierFees(baseFeeBps: number = STOCK_PIER_BASE_FEE_BPS): PoolFeesParams {
  return {
    baseFee: getBaseFeeParams({
      baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
      feeTimeSchedulerParam: {
        startingFeeBps: baseFeeBps,
        endingFeeBps: baseFeeBps,
        numberOfPeriod: 0,
        totalDuration: 0,
      },
    }),
    compoundingFeeBps: 0,
    padding: 0,
    dynamicFee: getDynamicFeeParams(baseFeeBps),
  };
}

/** The pair's pier: the one customizable DAMM v2 pool of the two mints, whichever way round they are given. */
export function stockPierAddress(stock: string, quote: string): string {
  return deriveCustomizablePoolAddress(new PublicKey(stock), new PublicKey(quote)).toBase58();
}

/** A price as the SDK reads it: a plain decimal string with enough places, never a float's exponent. */
export function priceString(price: number): string {
  if (!(price > 0) || !Number.isFinite(price)) throw new LiquidityRefusal('BAD_REQUEST', 'The price is not a positive number.');
  const lead = Math.max(0, -Math.floor(Math.log10(price)));
  return price.toFixed(Math.min(20, lead + 12));
}

type MintRead = Readonly<{
  token: LiquidityToken;
  mint: Mint;
  program: PublicKey;
  fee: boolean;
}>;

type CreationPlan = Readonly<{
  preview: AddLiquidityPreview;
  a: MintRead;
  b: MintRead;
  initSqrtPrice: BN;
  liquidity: BN;
  depositA: BN;
  depositB: BN;
}>;

export function createStockPierVenue(deps: StockPierVenueDeps): LiquidityVenueAdapter {
  const { connection, base, plan } = deps;
  const now = deps.now ?? Date.now;
  const newKeypair = deps.newKeypair ?? (() => Keypair.generate());
  const cpAmm = new CpAmm(connection);
  const poolKey = deriveCustomizablePoolAddress(new PublicKey(plan.stock), new PublicKey(plan.quote));
  const pool = poolKey.toBase58();

  /** Whether this request is the pier's own and the pier is not built yet: only then does this adapter build. */
  const creates = async (request: AddLiquidityRequest): Promise<boolean> => {
    if (request.pool !== pool) return false;
    const info = await connection.getAccountInfo(poolKey, 'confirmed');
    // Lamports sent to the address leave an account that is no pool: the program still makes the pier there.
    return info === null || !info.owner.equals(CP_AMM_PROGRAM_ID);
  };

  const readMint = (
    address: string,
    info: Readonly<{
      owner: PublicKey;
      data: Buffer;
      lamports: number;
      executable: boolean;
    }> | null,
  ): MintRead => {
    if (!info) throw new LiquidityRefusal('POOL_NOT_FOUND', 'A coin of the pier has no mint account.');
    const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : info.owner.equals(TOKEN_PROGRAM_ID) ? TOKEN_PROGRAM_ID : null;
    if (!program) throw new LiquidityRefusal('BAD_REQUEST', 'A coin of the pier is not a token.');
    const key = new PublicKey(address);
    const mint = unpackMint(key, info as never, program);
    const fee = program.equals(TOKEN_2022_PROGRAM_ID) && getTransferFeeConfig(mint) !== null;
    return {
      token: {
        mint: address,
        decimals: mint.decimals,
        program: program.toBase58(),
      },
      mint,
      program,
      fee,
    };
  };

  const rentOf = async (bytes: readonly number[]): Promise<bigint> => {
    const each = await Promise.all(bytes.map((size) => connection.getMinimumBalanceForRentExemption(size)));
    return each.reduce((sum, lamports) => sum + BigInt(lamports), 0n);
  };

  const creationPlan = async (request: AddLiquidityRequest): Promise<CreationPlan> => {
    if (request.owner !== plan.owner) throw new LiquidityRefusal('NOT_OWNER', 'The build is priced for another wallet.');
    const wantA = parseUnits(request.amountX, 'amountX');
    const wantB = parseUnits(request.amountY, 'amountY');
    if (wantA <= 0n || wantB <= 0n) throw new LiquidityRefusal('AMOUNT_ZERO', 'A new pier takes both coins.');
    const [infoA, infoB] = await connection.getMultipleAccountsInfo([new PublicKey(plan.stock), new PublicKey(plan.quote)], 'confirmed');
    const a = readMint(plan.stock, infoA as never);
    const b = readMint(plan.quote, infoB as never);
    const epoch = a.fee || b.fee ? (await connection.getEpochInfo('confirmed')).epoch : null;
    const netOf = (side: MintRead, units: bigint) => (side.fee && epoch !== null ? calculateTransferFeeExcludedAmount(new BN(units.toString()), side.mint, epoch).amount : new BN(units.toString()));
    const grossOf = (side: MintRead, units: BN) => (side.fee && epoch !== null ? calculateTransferFeeIncludedAmount(units, side.mint, epoch).amount : units);

    const initSqrtPrice = getSqrtPriceFromPrice(priceString(plan.price), a.token.decimals, b.token.decimals);
    if (initSqrtPrice.lte(MIN_SQRT_PRICE) || initSqrtPrice.gte(MAX_SQRT_PRICE)) throw new LiquidityRefusal('BAD_REQUEST', 'The price is outside what the venue holds.');
    const fromA = getLiquidityDeltaFromAmountA(netOf(a, wantA), initSqrtPrice, MAX_SQRT_PRICE, CollectFeeMode.OnlyB);
    const fromB = getLiquidityDeltaFromAmountB(netOf(b, wantB), MIN_SQRT_PRICE, initSqrtPrice, CollectFeeMode.OnlyB);
    /* One unit of liquidity less than the smaller side gives: the amounts rounded up never pass what was asked. */
    const liquidity = BN.min(fromA, fromB).subn(1);
    if (liquidity.lten(0)) throw new LiquidityRefusal('AMOUNT_ZERO', 'The amounts are too small for a pier.');
    const depositA = grossOf(a, getAmountAFromLiquidityDelta(initSqrtPrice, MAX_SQRT_PRICE, liquidity, Rounding.Up, CollectFeeMode.OnlyB));
    const depositB = grossOf(b, getAmountBFromLiquidityDelta(MIN_SQRT_PRICE, initSqrtPrice, liquidity, Rounding.Up, CollectFeeMode.OnlyB));
    const inA = BigInt(depositA.toString());
    const inB = BigInt(depositB.toString());
    if (inA > wantA || inB > wantB || inA <= 0n || inB <= 0n) throw new LiquidityRefusal('AMOUNT_ZERO', 'The amounts do not make a pier at this price.');

    const vaultSize = (side: MintRead) => (side.program.equals(TOKEN_2022_PROGRAM_ID) ? getAccountLenForMint(side.mint) : ACCOUNT_SIZE);
    const [positionRent, poolRent] = await Promise.all([
      rentOf([POSITION_ACCOUNT_SIZES.position, POSITION_ACCOUNT_SIZES.nftMint, POSITION_ACCOUNT_SIZES.nftAccount]),
      rentOf([POOL_ACCOUNT_SIZE, vaultSize(a), vaultSize(b)]),
    ]);
    const rent: RentCost[] = [
      {
        what: 'position',
        direction: 'pay',
        lamports: positionRent.toString(),
        refundable: true,
      },
      {
        what: 'pool',
        direction: 'pay',
        lamports: poolRent.toString(),
        refundable: false,
      },
    ];
    const notices: LiquidityNotice[] = [];
    /* A price that moved since the amounts were typed leaves part of one side out. */
    if (inA * 100n < wantA * 98n || inB * 100n < wantB * 98n) notices.push('partial_deposit');
    if (a.fee || b.fee) notices.push('transfer_fee');
    const at = now();
    const preview: AddLiquidityPreview = {
      action: 'add',
      venue: 'meteora-damm2',
      pool,
      request,
      opensPosition: true,
      range: { kind: 'range', minPrice: null, maxPrice: null },
      rangeState: 'in_range',
      deposit: { x: amountOf(a.token, inA), y: amountOf(b.token, inB) },
      fees: [],
      rent,
      transactions: 1,
      notices,
      price: priceString(plan.price),
      at,
      expiresAt: at + DAMM_V2_PREVIEW_TTL_MS,
    };
    return { preview, a, b, initSqrtPrice, liquidity, depositA, depositB };
  };

  const buildPier = async (given: AddLiquidityPreview): Promise<BuiltLiquidity> => {
    if (now() > given.expiresAt) throw new LiquidityRefusal('PREVIEW_EXPIRED', 'The preview is older than its window; preview again.');
    const fresh = await creationPlan(given.request);
    /* What the Review showed is the most that goes in: a fresh figure above it is a moved price — preview again. */
    const shown = (units: string | undefined) => (units !== undefined && /^\d+$/.test(units) ? BigInt(units) : null);
    const shownA = shown(given.deposit?.x?.units);
    const shownB = shown(given.deposit?.y?.units);
    if (shownA === null || shownB === null || BigInt(fresh.preview.deposit.x.units) > shownA || BigInt(fresh.preview.deposit.y.units) > shownB) {
      throw new LiquidityRefusal('PREVIEW_EXPIRED', 'The figures moved since the preview.');
    }
    const owner = new PublicKey(plan.owner);
    const nft = newKeypair();
    const { tx } = await cpAmm.createCustomPool({
      payer: owner,
      creator: owner,
      positionNft: nft.publicKey,
      tokenAMint: new PublicKey(plan.stock),
      tokenBMint: new PublicKey(plan.quote),
      tokenAAmount: fresh.depositA,
      tokenBAmount: fresh.depositB,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      liquidityDelta: fresh.liquidity,
      initSqrtPrice: fresh.initSqrtPrice,
      poolFees: stockPierFees(),
      hasAlphaVault: false,
      activationType: ActivationType.Timestamp,
      collectFeeMode: CollectFeeMode.OnlyB,
      activationPoint: null,
      tokenAProgram: fresh.a.program,
      tokenBProgram: fresh.b.program,
      isLockLiquidity: false,
    });
    tx.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: STOCK_BUILD_COMPUTE_UNITS,
      }),
    );
    const latest = await connection.getLatestBlockhash('confirmed');
    tx.feePayer = owner;
    tx.recentBlockhash = latest.blockhash;
    tx.lastValidBlockHeight = latest.lastValidBlockHeight;
    tx.partialSign(nft);
    return {
      preview: fresh.preview,
      transactions: [
        {
          wireBase64: Buffer.from(
            tx.serialize({
              requireAllSignatures: false,
              verifySignatures: false,
            }),
          ).toString('base64'),
          presigned: [nft.publicKey.toBase58()],
        },
      ],
      feePayer: owner.toBase58(),
      validUntil: String(latest.lastValidBlockHeight),
      position: derivePositionAddress(nft.publicKey).toBase58(),
    };
  };

  return {
    ...base,
    async previewAdd(request) {
      return (await creates(request)) ? (await creationPlan(request)).preview : base.previewAdd(request);
    },
    async buildAdd(given) {
      return (await creates(given.request)) ? buildPier(given) : base.buildAdd(given);
    },
  };
}
