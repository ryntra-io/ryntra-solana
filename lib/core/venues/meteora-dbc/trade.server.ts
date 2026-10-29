/**
 * Buying and selling a Ryntra launch — on its bonding curve by Meteora DBC's
 * own swap instruction, and after graduation in the DAMM v2 pool it moved into.
 *
 * The fee is inside the swap itself, in the same transaction: on the curve the
 * config's trading fee — the creator's share and Ryntra's as the partner — and
 * Meteora's protocol fee, of which the referral account, Ryntra's when the
 * trade comes through Ryntra, receives a fifth; in the pool the pool's fee to
 * the locked liquidity, Meteora's, and the same referral. On the curve no other
 * fee is added (fee policy v2: «our launch on the curve — the curve's fee»).
 * After graduation the token is a new token like any other, and a direct trade
 * in its pool carries the policy's Ryntra fee for its class — a transfer into
 * Ryntra's fee wallet in the same transaction, the input's share on a buy, the
 * quoted output's on a sale — as a trade of it through Jupiter does. The caller
 * passes that fee only where the trade is recorded the way every Ryntra fee is.
 *
 * The adapter quotes from the account state it reads now and returns unsigned
 * bytes for the person's wallet: the wallet is the fee payer and the only
 * signer. Nothing here holds a key.
 */

import { SwapMode as DammSwapMode } from "@meteora-ag/cp-amm-sdk";
import { SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, createTransferCheckedInstruction, getAssociatedTokenAddressSync, unpackMint, type Mint } from "@solana/spl-token";
import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import BN from "bn.js";

import { cpAmmOf, dbcClientOf } from "../meteora-clients.server.ts";
import { curveFeeSplit, poolFeeSplit, priceFromSqrtX64, type LaunchFeeSplit, type LaunchTradeSide, type LaunchTradeVenue } from "./market.ts";
import { dammPrice, type MarketState } from "./market.server.ts";
import { bpsAtEpoch, transferFeeOn } from "../../launch/transfer-fee.ts";
import { configTransferFeeOf, mintTransferFeeOf } from "./launch.server.ts";

/**
 * What `owner` holds of `mint`, raw, in its associated token accounts under either token program — read by their
 * addresses in one `getMultipleAccountsInfo`, never by an indexed request: the public node refuses
 * `getTokenAccountsByOwner` («Indexed requests require a personal token», measured 2026-10-06), and that refusal was
 * read as «holds nothing», so no launch could be bought or sold. A trade spends from exactly this account. An account
 * is counted only when its program, mint and owner are the ones asked for. Throws when the read fails.
 */
export async function heldRaw(connection: Pick<Connection, "getMultipleAccountsInfo">, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  const programs = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID];
  const addresses = programs.map((program) => getAssociatedTokenAddressSync(mint, owner, true, program));
  const infos = await connection.getMultipleAccountsInfo(addresses, "confirmed");
  let total = 0n;
  infos.forEach((info, index) => {
    if (!info || !info.owner.equals(programs[index]!) || info.data.length < 72) return;
    const data = Buffer.from(info.data);
    if (!data.subarray(0, 32).equals(mint.toBuffer()) || !data.subarray(32, 64).equals(owner.toBuffer())) return;
    total += data.readBigUInt64LE(64);
  });
  return total;
}

/** Why a trade could not be quoted or built; the caller decides the person's words. */
export class LaunchTradeRefusal extends Error {
  readonly code: "AMOUNT_ZERO" | "CURVE_COMPLETE" | "NO_POOL" | "POOL_SHAPE" | "BALANCE_LOW" | "QUOTE_FAILED";

  constructor(code: LaunchTradeRefusal["code"], message: string) {
    super(message);
    this.name = "LaunchTradeRefusal";
    this.code = code;
  }
}

/** The largest slippage a trade may be built with, basis points. */
export const MAX_SLIPPAGE_BPS = 5_000;

export type LaunchTradeQuote = Readonly<{
  venue: LaunchTradeVenue;
  side: LaunchTradeSide;
  /** What the trade spends: the pair currency on a buy, the token on a sell — raw. */
  amountInRaw: string;
  /** What it receives, quoted now. */
  amountOutRaw: string;
  /** The least it may receive and still land, by the slippage. */
  minimumOutRaw: string;
  /** A buy the curve cannot take whole before it graduates leaves this much unspent; zero otherwise. */
  amountLeftRaw: string;
  slippageBps: number;
  fee: LaunchFeeSplit;
  /** The fee as a share of what moves, basis points. */
  feeBps: number;
  priceBefore: number;
  priceAfter: number;
  /** Whether Ryntra's referral account is in the trade. */
  referral: boolean;
  /** Ryntra's own fee into its fee wallet, outside the swap (in the pool only), raw in the pair currency. */
  ryntraFeeRaw: string;
  /** What the swap instruction itself is built with: the input after Ryntra's fee on a buy, the least output before it on a sale. */
  swap: Readonly<{ amountInRaw: string; minimumOutRaw: string }>;
}>;

export type LaunchTradeBuild = Readonly<{ wireBase64: string; validUntil: string; quote: LaunchTradeQuote }>;

const big = (value: { toString(): string } | null | undefined) => BigInt(value ? value.toString() : "0");

/** The least of `amount` after `slippageBps`, rounded down. */
export function minimumAfterSlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

/** Ryntra's fee in the pool before the swap: on a buy its share of the input leaves the wallet first and the swap spends the rest; nothing on a sale. */
export function poolFeeBefore(side: LaunchTradeSide, amountRaw: bigint, bps: number): Readonly<{ feeRaw: bigint; swapInRaw: bigint }> {
  const feeRaw = side === "buy" ? (amountRaw * BigInt(bps)) / 10_000n : 0n;
  return { feeRaw, swapInRaw: amountRaw - feeRaw };
}

/**
 * Ryntra's fee in the pool after the swap: on a sale its share of the quoted output — a fixed amount, set at the quote —
 * leaves after the swap, so the seller receives the output less it and at least the swap's least less it.
 */
export function poolFeeAfter(
  side: LaunchTradeSide,
  outRaw: bigint,
  bps: number,
  slippageBps: number,
): Readonly<{ feeRaw: bigint; amountOutRaw: bigint; minimumOutRaw: bigint; swapMinimumRaw: bigint }> {
  const feeRaw = side === "sell" ? (outRaw * BigInt(bps)) / 10_000n : 0n;
  const swapMinimumRaw = minimumAfterSlippage(outRaw, slippageBps);
  const least = swapMinimumRaw - feeRaw;
  return { feeRaw, amountOutRaw: outRaw - feeRaw, minimumOutRaw: least > 0n ? least : 0n, swapMinimumRaw };
}

/** Where the fee's transfer sits among the swap's instructions: first on a buy — the wallet pays it from what it spends — and last on a sale, from the proceeds. */
export function withPoolFee<T>(instructions: readonly T[], transfer: T, side: LaunchTradeSide): T[] {
  return side === "buy" ? [transfer, ...instructions] : [...instructions, transfer];
}

/* Whether a referral or fee token account exists on chain; an account once created is remembered. */
const REFERRAL_ACCOUNTS = new Set<string>();
const PROGRAMS = new Map<string, PublicKey>();

export function createLaunchTradeVenue(
  args: Readonly<{
    connection: Connection;
    /** The address Ryntra's referral token accounts belong to on this network; absent, trades carry no referral. */
    referralOwner: string | null;
    /** Ryntra's fee wallet on this network and the policy's rate for a graduated launch, basis points; absent, no fee is added in the pool. */
    poolFee?: Readonly<{ wallet: string; bps: number }> | null;
  }>,
) {
  const { connection } = args;
  const client = dbcClientOf(connection);
  const cpAmm = cpAmmOf(connection);

  /** A mint's token program; it never changes, so it is read once. */
  async function programOf(mint: PublicKey): Promise<PublicKey> {
    const key = `${connection.rpcEndpoint}:${mint.toBase58()}`;
    const known = PROGRAMS.get(key);
    if (known) return known;
    const info = await connection.getAccountInfo(mint, "confirmed");
    if (!info) throw new LaunchTradeRefusal("QUOTE_FAILED", `No mint at ${mint.toBase58()}.`);
    const program = info.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    PROGRAMS.set(key, program);
    return program;
  }

  /** Ryntra's referral token account in the pair currency, when it exists on chain. */
  async function referralAccount(pairMint: string): Promise<PublicKey | null> {
    return args.referralOwner ? accountOf(args.referralOwner, pairMint) : null;
  }

  /** Ryntra's fee wallet's account in the pair currency, when it exists on chain. */
  async function feeAccount(pairMint: string): Promise<PublicKey | null> {
    return args.poolFee ? accountOf(args.poolFee.wallet, pairMint) : null;
  }

  /** An owner's associated account of a mint, when it exists on chain. */
  async function accountOf(owner: string, pairMint: string): Promise<PublicKey | null> {
    const mint = new PublicKey(pairMint);
    const account = getAssociatedTokenAddressSync(mint, new PublicKey(owner), true, await programOf(mint));
    const key = `${connection.rpcEndpoint}:${account.toBase58()}`;
    if (REFERRAL_ACCOUNTS.has(key)) return account;
    const info = await connection.getAccountInfo(account, "confirmed").catch(() => null);
    if (!info) return null;
    REFERRAL_ACCOUNTS.add(key);
    return account;
  }

  /**
   * The pair currency's own transfer fee for a quote on the curve (SOL-L11): where the pair is a Token-2022 token — a
   * checked pair currency, never a preset's — DBC 2.0.0 prices the fee from the mint and the epoch and refuses a quote
   * without them. Null on a classic-program pair, and on 1.5.13, which quotes no such pair at all.
   */
  async function curveQuoteFees(state: MarketState): Promise<Readonly<{ quoteMint: Mint; currentEpoch: number }> | null> {
    const flag = Number((state.accounts.config as unknown as { quoteTokenFlag?: number | BN } | null)?.quoteTokenFlag ?? 0);
    if (client.sdk !== "2.0.0" || flag !== 1) return null;
    const mint = new PublicKey(state.curve.pairMint);
    const [info, epoch] = await Promise.all([connection.getAccountInfo(mint, "confirmed"), connection.getEpochInfo("confirmed")]);
    if (!info) throw new LaunchTradeRefusal("QUOTE_FAILED", "The pair currency's mint could not be read.");
    return { quoteMint: unpackMint(mint, info, info.owner), currentEpoch: epoch.epoch };
  }

  async function curveQuote(state: MarketState, side: LaunchTradeSide, amountRaw: bigint, slippageBps: number, referral: boolean) {
    /* The curve as the market read just saw it: one read for the page and its quote. */
    const virtual = state.accounts.curve;
    const config = state.accounts.config;
    if (!virtual || !config) throw new LaunchTradeRefusal("NO_POOL", "The curve could not be read.");
    const poolState = (virtual as unknown as { poolState: { quoteReserve: BN; sqrtPrice: BN } }).poolState;
    if (big(poolState.quoteReserve) >= big(config.migrationQuoteThreshold)) throw new LaunchTradeRefusal("CURVE_COMPLETE", "The curve is full and graduating.");
    const pairFees = await curveQuoteFees(state);
    const quote = client.pool.swapQuote2({
      ...(pairFees ?? {}),
      virtualPool: virtual as never,
      config,
      swapBaseForQuote: side === "sell",
      hasReferral: referral,
      eligibleForFirstSwapWithMinFee: false,
      currentPoint: new BN(Math.floor(Date.now() / 1000)),
      /* A buy near the threshold fills what the curve still sells and leaves the rest unspent. */
      ...(side === "buy" ? { swapMode: SwapMode.PartialFill as const, amountIn: new BN(amountRaw.toString()) } : { swapMode: SwapMode.ExactIn as const, amountIn: new BN(amountRaw.toString()) }),
    });
    const fee = curveFeeSplit({ tradingFeeRaw: big(quote.tradingFee), protocolFeeRaw: big(quote.protocolFee), referralFeeRaw: big(quote.referralFee), creatorPct: state.curve.creatorTradingFeePct });
    /*
     * What the wallet receives: on a token with a transfer fee (SOL-L10, SDK 2.0.0) the curve's output less the fee the
     * token program withholds — the amount the program holds `minimum_amount_out` to; on every other token the same.
     */
    const excluded = (quote as { excludedTransferFeeAmountOut?: BN }).excludedTransferFeeAmountOut;
    const out = big(excluded ?? quote.outputAmount);
    const spent = big(quote.includedFeeInputAmount);
    const feeTotal = BigInt(fee.totalRaw);
    const gross = side === "buy" ? spent : out + feeTotal;
    const result: LaunchTradeQuote = {
      venue: "curve",
      side,
      amountInRaw: (side === "buy" ? spent : amountRaw).toString(),
      amountOutRaw: out.toString(),
      minimumOutRaw: minimumAfterSlippage(out, slippageBps).toString(),
      amountLeftRaw: big(quote.amountLeft).toString(),
      slippageBps,
      fee,
      feeBps: gross > 0n ? Number((feeTotal * 10_000n) / gross) : 0,
      priceBefore: priceFromSqrtX64(poolState.sqrtPrice.toString(), state.tokenDecimals, state.pairDecimals),
      priceAfter: priceFromSqrtX64(quote.nextSqrtPrice.toString(), state.tokenDecimals, state.pairDecimals),
      referral,
      ryntraFeeRaw: "0",
      swap: { amountInRaw: amountRaw.toString(), minimumOutRaw: minimumAfterSlippage(out, slippageBps).toString() },
    };
    return result;
  }

  async function poolContext(state: MarketState) {
    const graduated = state.graduated;
    if (!graduated) throw new LaunchTradeRefusal("NO_POOL", "The token has no graduated pool.");
    /* A pool graduated from a DBC curve holds the token as A and the pair as B; its fee is collected in B. Any other shape is not quoted. */
    if (!graduated.tokenIsA) throw new LaunchTradeRefusal("POOL_SHAPE", "The graduated pool is not in the shape Ryntra trades.");
    const pool = new PublicKey(graduated.pool);
    /* The pool as the same read of the market saw it (SOL-P1): one read of it for the state and its quote. */
    const poolState = (state.accounts.pool as Awaited<ReturnType<typeof cpAmm.fetchPoolState>> | null | undefined) ?? (await cpAmm.fetchPoolState(pool));
    const activationByTime = Number(poolState.activationType) === 1;
    const currentPoint = activationByTime ? new BN(Math.floor(Date.now() / 1000)) : new BN(await connection.getSlot("confirmed"));
    return { graduated, pool, poolState, currentPoint };
  }

  /**
   * «Комісія за переказ» (SOL-L10) in the DEX pool: until RevokeZeroFee's 0 % applies — two epochs after the move — a
   * transfer of the token still pays the curve's rate. The token's mint and the epoch for the pool's quote; null when the
   * token takes no fee now (every token whose config set none: no read is made for it).
   */
  async function poolTransferFee(state: MarketState, tokenMint: PublicKey): Promise<Readonly<{ mint: Mint; epoch: number; bps: number }> | null> {
    if (!configTransferFeeOf(state.accounts.config)) return null;
    const [info, epoch] = await Promise.all([connection.getAccountInfo(tokenMint, "confirmed"), connection.getEpochInfo("confirmed")]);
    if (!info) throw new LaunchTradeRefusal("NO_POOL", "The token's mint could not be read.");
    const mint = unpackMint(tokenMint, info, info.owner);
    const fee = mintTransferFeeOf(mint);
    const bps = fee ? bpsAtEpoch(fee, BigInt(epoch.epoch)) : 0;
    return bps > 0 ? { mint, epoch: epoch.epoch, bps } : null;
  }

  async function poolQuote(state: MarketState, side: LaunchTradeSide, amountRaw: bigint, slippageBps: number, referral: boolean) {
    const { graduated, poolState, currentPoint } = await poolContext(state);
    const tokenFee = await poolTransferFee(state, poolState.tokenAMint);
    const inputMint = side === "buy" ? poolState.tokenBMint : poolState.tokenAMint;
    /* Ryntra's fee for a new token, where the fee wallet can take it: the buyer's input before the swap, the seller's output after it. */
    const bps = args.poolFee && (await feeAccount(state.curve.pairMint)) !== null ? args.poolFee.bps : 0;
    const { feeRaw: buyFee, swapInRaw: swapIn } = poolFeeBefore(side, amountRaw, bps);
    if (swapIn <= 0n) throw new LaunchTradeRefusal("AMOUNT_ZERO", "The amount is too small to trade.");
    const quote = cpAmm.getQuote2({
      inputTokenMint: inputMint,
      slippage: 0,
      currentPoint,
      poolState,
      tokenADecimal: state.tokenDecimals,
      tokenBDecimal: state.pairDecimals,
      hasReferral: referral,
      swapMode: DammSwapMode.ExactIn,
      amountIn: new BN(swapIn.toString()),
      /* The token's side pays its transfer fee: what a seller sends reaches the pool less it, what a buyer gets arrives less it. */
      ...(tokenFee ? (side === "buy" ? { outputTokenInfo: { mint: tokenFee.mint, currentEpoch: tokenFee.epoch } } : { inputTokenInfo: { mint: tokenFee.mint, currentEpoch: tokenFee.epoch } }) : {}),
    });
    const out = tokenFee && side === "buy" ? transferFeeOn(big(quote.outputAmount), tokenFee.bps).netRaw : big(quote.outputAmount);
    const after = poolFeeAfter(side, out, bps, slippageBps);
    const ryntraFee = buyFee + after.feeRaw;
    const pool = poolFeeSplit({
      claimingFeeRaw: big(quote.claimingFee),
      compoundingFeeRaw: big(quote.compoundingFee),
      protocolFeeRaw: big(quote.protocolFee),
      referralFeeRaw: big(quote.referralFee),
      liquidity: big(poolState.liquidity),
      permanentLockedLiquidity: big(poolState.permanentLockLiquidity),
    });
    const fee = { ...pool, totalRaw: (BigInt(pool.totalRaw) + ryntraFee).toString(), ryntraRaw: (BigInt(pool.ryntraRaw) + ryntraFee).toString() };
    const swapMinimum = after.swapMinimumRaw;
    const gross = side === "buy" ? amountRaw : out + BigInt(pool.totalRaw);
    const result: LaunchTradeQuote = {
      venue: "pool",
      side,
      amountInRaw: amountRaw.toString(),
      amountOutRaw: after.amountOutRaw.toString(),
      minimumOutRaw: after.minimumOutRaw.toString(),
      amountLeftRaw: "0",
      slippageBps,
      fee,
      feeBps: gross > 0n ? Number((BigInt(fee.totalRaw) * 10_000n) / gross) : 0,
      priceBefore: dammPrice(graduated.sqrtPrice, true, state.tokenDecimals, state.pairDecimals),
      priceAfter: dammPrice(quote.nextSqrtPrice.toString(), true, state.tokenDecimals, state.pairDecimals),
      referral,
      ryntraFeeRaw: ryntraFee.toString(),
      swap: { amountInRaw: swapIn.toString(), minimumOutRaw: swapMinimum.toString() },
    };
    return result;
  }
  async function quote(input: Readonly<{ state: MarketState; side: LaunchTradeSide; amountRaw: string; slippageBps: number }>): Promise<LaunchTradeQuote> {
    const amount = BigInt(input.amountRaw);
    if (amount <= 0n) throw new LaunchTradeRefusal("AMOUNT_ZERO", "The amount is zero.");
    const referral = (await referralAccount(input.state.curve.pairMint)) !== null;
    try {
      return input.state.curve.migrated
        ? await poolQuote(input.state, input.side, amount, input.slippageBps, referral)
        : await curveQuote(input.state, input.side, amount, input.slippageBps, referral);
    } catch (error) {
      if (error instanceof LaunchTradeRefusal) throw error;
      throw new LaunchTradeRefusal("QUOTE_FAILED", error instanceof Error ? error.message.slice(0, 300) : "The trade could not be quoted.");
    }
  }

  /** What `wallet` holds of `mint`, raw, in the account a trade spends from; a read that fails throws — never a zero. */
  function balanceOf(wallet: PublicKey, mint: PublicKey): Promise<bigint> {
    return heldRaw(connection, wallet, mint);
  }

  async function seal(tx: Transaction, payer: PublicKey): Promise<Readonly<{ wireBase64: string; validUntil: string }>> {
    const latest = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = payer;
    tx.recentBlockhash = latest.blockhash;
    return { wireBase64: Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64"), validUntil: String(latest.lastValidBlockHeight) };
  }

  async function build(input: Readonly<{ state: MarketState; token: string; side: LaunchTradeSide; amountRaw: string; slippageBps: number; wallet: string }>): Promise<LaunchTradeBuild> {
    const wallet = new PublicKey(input.wallet);
    const spendMint = new PublicKey(input.side === "buy" ? input.state.curve.pairMint : input.token);
    if ((await balanceOf(wallet, spendMint)) < BigInt(input.amountRaw)) throw new LaunchTradeRefusal("BALANCE_LOW", "The wallet does not hold that much.");
    const fresh = await quote(input);
    const referral = fresh.referral ? await referralAccount(input.state.curve.pairMint) : null;
    let tx: Transaction;
    if (fresh.venue === "curve") {
      tx = await client.pool.swap2({
        owner: wallet,
        payer: wallet,
        pool: new PublicKey(input.state.curve.pool),
        swapBaseForQuote: input.side === "sell",
        referralTokenAccount: referral,
        ...(input.side === "buy"
          ? { swapMode: SwapMode.PartialFill as const, amountIn: new BN(input.amountRaw), minimumAmountOut: new BN(fresh.minimumOutRaw) }
          : { swapMode: SwapMode.ExactIn as const, amountIn: new BN(input.amountRaw), minimumAmountOut: new BN(fresh.minimumOutRaw) }),
      });
    } else {
      const { pool, poolState } = await poolContext(input.state);
      const [tokenAProgram, tokenBProgram] = await Promise.all([programOf(poolState.tokenAMint), programOf(poolState.tokenBMint)]);
      tx = await cpAmm.swap2({
        payer: wallet,
        pool,
        inputTokenMint: input.side === "buy" ? poolState.tokenBMint : poolState.tokenAMint,
        outputTokenMint: input.side === "buy" ? poolState.tokenAMint : poolState.tokenBMint,
        tokenAMint: poolState.tokenAMint,
        tokenBMint: poolState.tokenBMint,
        tokenAVault: poolState.tokenAVault,
        tokenBVault: poolState.tokenBVault,
        tokenAProgram,
        tokenBProgram,
        referralTokenAccount: referral,
        poolState,
        swapMode: DammSwapMode.ExactIn,
        amountIn: new BN(fresh.swap.amountInRaw),
        minimumAmountOut: new BN(fresh.swap.minimumOutRaw),
      });
      const ryntraFee = BigInt(fresh.ryntraFeeRaw);
      const feeTo = ryntraFee > 0n ? await feeAccount(input.state.curve.pairMint) : null;
      if (ryntraFee > 0n && feeTo) {
        /* Ryntra's fee in the same transaction: from the buyer before the swap, from the seller's proceeds after it. */
        const pairMint = poolState.tokenBMint;
        const pairProgram = tokenBProgram;
        const from = getAssociatedTokenAddressSync(pairMint, wallet, true, pairProgram);
        const transfer = createTransferCheckedInstruction(from, pairMint, feeTo, wallet, ryntraFee, input.state.pairDecimals, [], pairProgram);
        tx.instructions = withPoolFee(tx.instructions, transfer, input.side);
      }
    }
    const sealed = await seal(tx, wallet);
    return { ...sealed, quote: fresh };
  }

  return { quote, build, referralAccount, feeAccount };
}

export type LaunchTrading = ReturnType<typeof createLaunchTradeVenue>;
