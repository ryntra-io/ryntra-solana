/**
 * Swapping in a DLMM Pro pool: a quote from the accounts as they are now, and the unsigned swap built from a
 * fresh one.
 *
 * The program swaps an exact input only, and takes all of it or fails (`NotConsumingFullAmountIn`): a quote names the
 * tick arrays the swap will walk, and a quote that leaves input unspent across them cannot be built. So `quote` widens
 * the walk until the input is spent or the pool has no more to give, and refuses the rest (`PARTIAL_FILL`) — a swap is
 * never built to fail in the wallet.
 *
 * **The fee** is inside the swap, in the pool's fee coin — the coin the swap pays out, or always token Y on a pool that
 * collects only in Y. It goes to the liquidity and the limit orders that filled the swap, and to the protocol; Ryntra
 * adds no fee of its own here.
 *
 * **The referral.** A token account passed with the swap is paid a fifth (`HOST_FEE_BPS`) of the protocol's rate on
 * liquidity, taken over the swap's whole fee — whether liquidity or limit orders filled it: 4 % of the fee in a launch
 * pool, 2 % in any other. It comes out of the protocol's share, so the person receives the same with it or without.
 * Ryntra's is the associated account of the configured referral owner in the
 * swap's fee coin — as on DBC (`../meteora-dbc/trade.server.ts`) — and a swap carries it only where that account is on
 * chain, of that coin and not frozen: any other would fail the swap inside the token program. It is read for every
 * quote and never remembered, so an account closed since is simply left out.
 *
 * **The least received** is set from the fresh quote and the caller's slippage, after the output coin's own
 * Token-2022 transfer fee — what the program holds `minimum_output_amount` to.
 *
 * **What the wallet must hold** is checked before the bytes are returned: the amount, and what the swap itself takes
 * in lamports — its fee and the rent of the token accounts it opens. A swap of SOL needs both together. A frozen
 * account of the wallet's — of the coin it spends, or of the coin it is paid — refuses the swap here.
 *
 * The wallet is the fee payer and the only signer. Nothing here holds a key.
 */

import { CollectFeeMode, PoolExtension, decodeTicksFromData, isSupportExtension, type DlmmProClient, type QuoteExactInResult } from "@meteora-ag/dlmm-pro-sdk";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

import type { Address } from "../../contracts.ts";
import { feeBpsOf } from "./fee.ts";
import { DlmmProRefusal, refusing } from "./sdk.server.ts";
import { assertAffords, clientPastDust, decimalsOf, isPayableTokenAccount, poolWhole, tokenProgramOf, type DlmmProContext } from "./pools.server.ts";
import { TICKS_PER_ARRAY, priceOfSqrtX64 } from "./ticks.ts";
import { DLMM_PRO_UNITS, bpsOf, keyOf, minimumAfterSlippage, rawOf, seal, unitsOf, type DlmmProBuild, type SealOptions } from "./tx.server.ts";

/** The largest slippage a swap may be built with, basis points. */
export const MAX_SLIPPAGE_BPS = 5_000;
/** How far a quote's walk is widened before the pool is said to have too little: tick arrays, 32 bytes of the message each. */
export const QUOTE_TICK_ARRAYS = [3, 6, 10] as const;

export type DlmmProSwapRequest = Readonly<{
  pool: Address;
  /** The coin the wallet spends — the pool's token X or token Y. */
  inputMint: Address;
  /** Before the coin's own transfer fee, if it has one. */
  amountInRaw: string;
  slippageBps: number;
  /** Whose swap: the pool's opening rules are read for this wallet. */
  wallet: Address;
}>;

export type DlmmProQuote = Readonly<{
  pool: Address;
  inputMint: Address;
  outputMint: Address;
  /** True when token X is sold for token Y. */
  swapForY: boolean;
  amountInRaw: string;
  /** What the wallet receives, after the output coin's transfer fee. */
  amountOutRaw: string;
  /** The least it may receive and still land, by the slippage. */
  minimumOutRaw: string;
  slippageBps: number;
  fee: Readonly<{
    /** The coin every part below is in. */
    mint: Address;
    totalRaw: string;
    /** To the liquidity in range, to the limit orders filled, to the protocol, to the referral, to the pool's partner. */
    liquidityRaw: string;
    ordersRaw: string;
    protocolRaw: string;
    referralRaw: string;
    partnerRaw: string;
    /** The whole fee as a share of what it was charged on, basis points to two decimals. */
    bps: number;
  }>;
  priceBefore: number;
  priceAfter: number;
  tickAfter: number;
  /** The square-root price the quote ends at, Q64.64 — the program's own number, for a build that follows the swap. */
  sqrtPriceAfterX64: string;
  /** Whether Ryntra's referral account is in the swap. */
  referral: boolean;
  /** The walk the swap is built with. */
  tickArrays: readonly Address[];
  bitmapExtension: Address | null;
}>;

export type DlmmProSwapBuild = DlmmProBuild & Readonly<{ quote: DlmmProQuote }>;

const big = (value: { toString(): string }) => BigInt(value.toString());

/** The coin a swap's fee is taken in: token Y on an «only Y» pool, else the coin the swap pays out. */
export function feeMintOf(pool: Readonly<{ collectFeeMode: number; tokenXMint: PublicKey; tokenYMint: PublicKey }>, swapForY: boolean): PublicKey {
  if (pool.collectFeeMode === CollectFeeMode.OnlyY) return pool.tokenYMint;
  return swapForY ? pool.tokenYMint : pool.tokenXMint;
}

export function createDlmmProSwap(context: DlmmProContext) {
  const { connection } = context;
  const client: DlmmProClient = context.client;

  /** Ryntra's referral token account in `mint`, when it is on chain now and can be paid. */
  async function referralAccount(mint: PublicKey, program: PublicKey): Promise<PublicKey | null> {
    if (!context.referralOwner) return null;
    const account = getAssociatedTokenAddressSync(mint, new PublicKey(context.referralOwner), true, program);
    /* The account's own program, coin and state, not its address alone: an account of another coin, or a frozen one, would fail the swap. */
    return isPayableTokenAccount(await connection.getAccountInfo(account, "confirmed"), mint, program) ? account : null;
  }

  async function quoted(request: DlmmProSwapRequest) {
    const amount = rawOf(request.amountInRaw, "The amount");
    if (amount <= 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "The amount is zero.");
    const slippageBps = bpsOf(request.slippageBps, "The slippage", 0, MAX_SLIPPAGE_BPS);
    const poolKey = keyOf(request.pool, "The pool");
    const wallet = keyOf(request.wallet, "The wallet");
    const inputMint = keyOf(request.inputMint, "The coin");
    const { pool } = await poolWhole(context, poolKey);
    const swapForY = inputMint.equals(pool.tokenXMint);
    if (!swapForY && !inputMint.equals(pool.tokenYMint)) throw new DlmmProRefusal("BAD_INPUT", "The coin is not one of the pool's two.");
    /* The operator's pause is its own refusal: the SDK's quote would report it as a pool that has not opened. */
    if ((pool.poolStatus & 1) !== 0) throw new DlmmProRefusal("PAUSED", "The pool's operator has paused swaps.");
    const outputMint = swapForY ? pool.tokenYMint : pool.tokenXMint;
    const feeMint = feeMintOf(pool, swapForY);
    const feeProgram = tokenProgramOf(feeMint.equals(pool.tokenXMint) ? pool.tokenXFlag : pool.tokenYFlag);
    const referral = await referralAccount(feeMint, feeProgram);

    let answer: Awaited<ReturnType<DlmmProClient["pool"]["quoteExactIn"]>> | null = null;
    for (const maxTickArrays of QUOTE_TICK_ARRAYS) {
      answer = await client.pool.quoteExactIn({ pool: poolKey, inputAmount: new BN(amount.toString()), swapForY, hasReferral: referral !== null, swapper: wallet, maxTickArrays });
      /* Spent whole, or the walk ended before its limit: more arrays would add nothing. */
      if (answer.quote.amountLeft.isZero() || answer.tickArrays.length < maxTickArrays) break;
    }
    if (!answer) throw new DlmmProRefusal("FAILED", "The swap could not be quoted.");
    const result: QuoteExactInResult = answer.quote;
    if (!result.amountLeft.isZero()) throw new DlmmProRefusal("PARTIAL_FILL", `The pool can take ${result.consumedInAmount.toString()} of the ${amount.toString()} asked for.`);

    const decimals = await decimalsOf(connection, [pool.tokenXMint, pool.tokenYMint]);
    const decimalsX = decimals.get(pool.tokenXMint.toBase58())!;
    const decimalsY = decimals.get(pool.tokenYMint.toBase58())!;
    const out = big(result.transferFeeExcludedOutAmount);
    if (out <= 0n) throw new DlmmProRefusal("AMOUNT_ZERO", "The amount is too small to receive anything for.");
    /* A swap that pays something never carries a least of nothing: the slippage rounds down, and one atom is the floor. */
    const least = minimumAfterSlippage(out, slippageBps);
    const parts = { liquidity: big(result.mmFee), orders: big(result.limitOrderFee), protocol: big(result.protocolFee), referral: big(result.hostFee), partner: big(result.partnerFee) };
    const total = parts.liquidity + parts.orders + parts.protocol + parts.referral + parts.partner;
    /* The fee is charged on the input when its coin is the input, else on the output before it. */
    const feeOnInput = feeMint.equals(inputMint);
    const charged = feeOnInput ? big(result.consumedInAmount) : big(result.outAmount) + total;
    const quote: DlmmProQuote = {
      pool: poolKey.toBase58(),
      inputMint: inputMint.toBase58(),
      outputMint: outputMint.toBase58(),
      swapForY,
      amountInRaw: amount.toString(),
      amountOutRaw: out.toString(),
      minimumOutRaw: (least > 0n ? least : 1n).toString(),
      slippageBps,
      fee: {
        mint: feeMint.toBase58(),
        totalRaw: total.toString(),
        liquidityRaw: parts.liquidity.toString(),
        ordersRaw: parts.orders.toString(),
        protocolRaw: parts.protocol.toString(),
        referralRaw: parts.referral.toString(),
        partnerRaw: parts.partner.toString(),
        bps: charged > 0n ? feeBpsOf((total * 1_000_000_000n) / charged) : 0,
      },
      priceBefore: priceOfSqrtX64(big(pool.sqrtPrice), decimalsX, decimalsY),
      priceAfter: priceOfSqrtX64(big(result.nextSqrtPrice), decimalsX, decimalsY),
      tickAfter: result.nextTickId,
      sqrtPriceAfterX64: result.nextSqrtPrice.toString(),
      referral: referral !== null,
      tickArrays: answer.tickArrays.map((key) => key.toBase58()),
      bitmapExtension: answer.tickArrayBitmapExtension?.toBase58() ?? null,
    };
    return { quote, pool, poolKey, wallet, inputMint, swapForY, referral, answer };
  }

  /** What the swap would give now. Refuses an amount the pool cannot take whole, a pool not open to this wallet, a paused one. */
  async function quote(request: DlmmProSwapRequest): Promise<DlmmProQuote> {
    return refusing(async () => (await quoted(request)).quote);
  }

  /** The unsigned swap, built from a quote made now. Refuses a wallet that does not hold the amount. */
  async function build(request: DlmmProSwapRequest, options: SealOptions = {}): Promise<DlmmProSwapBuild> {
    return refusing(async () => {
      const fresh = await quoted(request);
      const { pool, wallet, inputMint, swapForY } = fresh;
      const inputProgram = tokenProgramOf(swapForY ? pool.tokenXFlag : pool.tokenYFlag);
      const sdk = await clientPastDust(context, [wallet], [
        { mint: pool.tokenXMint, program: tokenProgramOf(pool.tokenXFlag) },
        { mint: pool.tokenYMint, program: tokenProgramOf(pool.tokenYFlag) },
      ]);
      const built = await sdk.pool.swap({
        pool: fresh.poolKey,
        tokenXMint: pool.tokenXMint,
        tokenYMint: pool.tokenYMint,
        user: wallet,
        swapForY,
        tickArrays: fresh.answer.tickArrays,
        tickArrayBitmapExtension: fresh.answer.tickArrayBitmapExtension,
        referral: fresh.referral,
        parameters: { inputAmount: new BN(fresh.quote.amountInRaw), minimumOutputAmount: new BN(fresh.quote.minimumOutRaw) },
      });
      /*
       * The ceiling follows the ticks somebody stands on between the pool's price now and the price the quote ends at —
       * read off the walk's own tick arrays — with a few to spare for ticks stood on before the swap lands; never more
       * than those arrays can hold. A read that fails throws: a ceiling is not guessed.
       */
      const [low, high] = [Math.min(pool.tickCurrentId, fresh.quote.tickAfter) - pool.tickSpacing, Math.max(pool.tickCurrentId, fresh.quote.tickAfter) + pool.tickSpacing];
      const withReward = isSupportExtension(pool.extensions, PoolExtension.LiquidityMining);
      const walked = fresh.answer.tickArrays.length ? await connection.getMultipleAccountsInfo(fresh.answer.tickArrays, "confirmed") : [];
      const stoodOn = walked.reduce((count, info) => (info && info.owner.equals(client.program.programId) ? count + decodeTicksFromData(Buffer.from(info.data), withReward).filter((tick) => tick.tickId >= low && tick.tickId <= high).length : count), 0);
      const crossed = Math.min(stoodOn + Math.max(DLMM_PRO_UNITS.swap.spareTicks, Math.ceil(stoodOn / 4)), TICKS_PER_ARRAY * fresh.answer.tickArrays.length);
      const units = unitsOf(DLMM_PRO_UNITS.swap.base, DLMM_PRO_UNITS.swap.perArray, fresh.answer.tickArrays.length, DLMM_PRO_UNITS.swap.perTick * crossed + (fresh.referral ? DLMM_PRO_UNITS.swap.referral : 0) + 2 * DLMM_PRO_UNITS.tokenAccount);
      const sealed = await seal({ connection, wallet, instructions: built.tx.instructions, units, options });
      /* What the swap pays out arrives in the wallet's account of the other coin: one that is there and frozen takes nothing. */
      const outputMint = swapForY ? pool.tokenYMint : pool.tokenXMint;
      const receives = [getAssociatedTokenAddressSync(outputMint, wallet, true, tokenProgramOf(swapForY ? pool.tokenYFlag : pool.tokenXFlag))];
      const cost = await assertAffords(connection, wallet, [{ mint: inputMint, program: inputProgram, amount: BigInt(fresh.quote.amountInRaw) }], { fee: BigInt(sealed.feeLamports), instructions: built.tx.instructions, receives });
      return { ...sealed, ...cost, quote: fresh.quote };
    });
  }

  return { quote, build, referralAccount };
}

export type DlmmProSwap = ReturnType<typeof createDlmmProSwap>;
