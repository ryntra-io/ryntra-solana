/**
 * CITY-198 — a SOL pier from one coin in one approval: Meteora's Zap program (`zapvX9M3…Miz`, `@meteora-ag/zap-sdk`
 * 2.0.0) swaps the part of the SOL the pier's other coin needs and opens the DLMM position with both, in the order the
 * SDK writes — the wallet's token accounts and wrapped SOL, the swap, the Zap's ledger, the deposit, the ledger closed
 * and the SOL unwrapped. It is several transactions when it does not fit one; the wallet signs them together.
 *
 * The swap leg is the SDK's choice of the better of two: Jupiter's router (`GET /swap/v2/build`, multi-hop since
 * zap-sdk#33) or the pier's own pool. On Jupiter, Ryntra's fee rides the swap instruction itself — `platformFeeBps` paid
 * into the fee wallet's account (`lib/core/fee-policy.ts`, the `/build` lane), the same way every Ryntra swap carries it;
 * a swap inside the pool carries none. Nothing else of Ryntra's is added to the deposit.
 *
 * What the SDK does not check, this file and `zap-check.ts` do: the bytes are the wallet's own from the first
 * instruction to the last, the swap's floor stands against a reference price, and Zap Out never counts or spends an
 * account that is not the wallet's.
 *
 * «Take the rest» (`zap_rest`): a Zap whose later transaction did not land leaves the swap's coin and the wrapped SOL in
 * the wallet, and maybe the ledger. One more approval takes it back as SOL: the ledger closed back to the wallet, the
 * other coin the Zap brought — what the wallet holds above what it held before — swapped to SOL in the pier's own pool
 * through Zap Out, and the wrapped SOL unwrapped. Nothing the wallet held before the Zap is swapped.
 *
 * The SDK and DLMM come in through `deps` (Next bundles one build, Node's tests load the CommonJS one); the server holds
 * no key that moves money — the only key a build signs with is the fresh position key, which holds nothing.
 */

import type { FeeRow } from "@ryntra/core/adapters";
import type DLMMClass from "@meteora-ag/dlmm";
import { createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AddressLookupTableAccount,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";
import BN from "bn.js";

import { LIQUIDITY_SHAPES, LiquidityRefusal, SHAPE_TO_STRATEGY, type LiquidityNotice, type LiquidityShape, type LiquidityToken, type PositionRange, type RentCost, type UnsignedLiquidityTx } from "./contract.ts";
import { DLMM_PROGRAM, type DlmmSdk } from "./dlmm.ts";
import { amountOf, assertBps, parseUnits } from "./math.ts";
import { JUPITER_PROGRAM, ledgerOf, ownAccountOf, ZAP_PROGRAM, type ZapCheckContext } from "./zap-check.ts";

export { ZAP_PROGRAM };

/** The swap leg's own bound against its quote (Jupiter's route, or the pool's `min_amount_out`), basis points. */
export const ZAP_SWAP_SLIPPAGE_BPS = 50;
/** The most bins on each side a Zap opens: the widest one DLMM position holds (69 bins — the city's «Calm»). */
export const ZAP_MAX_HALF = 34;
/** The least SOL a Zap takes, lamports: below it the swap leg is dust. */
export const ZAP_MIN_LAMPORTS = 10_000_000n;
/** At most this many transactions for one approval. */
export const ZAP_MAX_TRANSACTIONS = 3;
/** Jupiter's routes are asked to stay within this many accounts, so the leg fits a transaction beside the wallet's plumbing. */
export const ZAP_MAX_ACCOUNTS = 40;
/** A preview's life before the relay refuses it; the bytes' own blockhash is the real bound. */
export const ZAP_PREVIEW_TTL_MS = 30_000;
/** The priority price each transaction sets, micro-lamports per unit: at most 0.014 SOL at the 1.4 M ceiling. */
export const ZAP_UNIT_PRICE = 10_000;

const PACKET_BYTES = 1_232;
const UNIT_CEILING = 1_400_000;
const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TyNMKSDgWgN2ub7ZM4eE6h";
const SOL = NATIVE_MINT.toBase58();

/** Ryntra's fee on a Jupiter leg: the rate and the fee wallet's account for the input mint (wrapped SOL). */
export type ZapFee = Readonly<{ bps: number; account: string; mint: string }>;

export type ZapInRequest = Readonly<{
  pool: string;
  owner: string;
  /** Lamports of SOL the wallet puts in. */
  amountIn: string;
  /** Bins each side of the active bin. */
  half: number;
  /** How the money spreads over those bins; even (`spot`) when not said. */
  shape?: LiquidityShape;
  /** How far the price may move before the deposit is refused, basis points. */
  slippageBps: number;
}>;

export type ZapRestRequest = Readonly<{
  pool: string;
  owner: string;
  /** The wallet's balance of the pier's other coin before the Zap, base units — the Zap's preview says it. */
  otherBefore: string;
}>;

/** The swap a Zap makes: the route, what goes in, what it should and at least will bring, and Ryntra's share of it. */
export type ZapLeg = Readonly<{
  route: "jupiter" | "pool" | "none";
  inMint: string;
  outMint: string;
  inAmount: string;
  expectedOut: string;
  /** The least the swap's own instruction accepts. */
  floor: string;
  /** Jupiter's route only: Ryntra's fee, taken from the input by the swap instruction. */
  fee: Readonly<{ bps: number; amount: string; mint: string; account: string }> | null;
  /** The route's venues as Jupiter labels them; the pool's own swap says «Meteora DLMM». */
  labels: readonly string[];
}>;

export type ZapPreview = Readonly<{
  action: "zap_in" | "zap_rest";
  venue: "meteora-dlmm";
  pool: string;
  owner: string;
  tokenX: LiquidityToken;
  tokenY: LiquidityToken;
  /** zap_in: lamports of SOL taken from the wallet; zap_rest: zero. */
  amountIn: string;
  swap: ZapLeg;
  /** zap_in: what goes into the position after the swap, at most. */
  deposit: Readonly<{ x: ReturnType<typeof amountOf>; y: ReturnType<typeof amountOf> }> | null;
  range: PositionRange | null;
  /** The wallet's balance of the other coin before this Zap: what «Take the rest» never touches. */
  otherBefore: string;
  /** zap_rest: wrapped SOL (lamports, its account's deposit included) that comes back as SOL. */
  unwrapLamports: string;
  /** Ryntra's row is there only when the Jupiter leg carries the fee. */
  fees: readonly FeeRow[];
  rent: readonly RentCost[];
  transactions: number;
  notices: readonly LiquidityNotice[];
  /** Y per one X at the pool's price the preview was made at. */
  price: string;
  at: number;
  expiresAt: number;
}>;

export type BuiltZap = Readonly<{
  preview: ZapPreview;
  transactions: readonly UnsignedLiquidityTx[];
  feePayer: string;
  validUntil: string;
  /** The new position (zap_in) or the pool (zap_rest). */
  position: string;
  lookupTables: readonly AddressLookupTableAccount[];
  /** What the Review holds every instruction to (`zap-check.ts`). */
  check: ZapCheckContext;
}>;

/** The pieces of `@meteora-ag/zap-sdk` 2.0.0 this venue uses. */
export type ZapSdk = Readonly<{
  Zap: typeof import("@meteora-ag/zap-sdk-v2").Zap;
  estimateDlmmDirectSwap: typeof import("@meteora-ag/zap-sdk-v2").estimateDlmmDirectSwap;
  createDlmmSwapPayload: typeof import("@meteora-ag/zap-sdk-v2").createDlmmSwapPayload;
  AMOUNT_IN_DLMM_OFFSET: number;
}>;

/** The pieces of `@meteora-ag/dlmm` beyond the venue's own (`DlmmSdk`). */
export type ZapDlmmSdk = DlmmSdk &
  Readonly<{
    getBinArraysRequiredByPositionRange: typeof import("@meteora-ag/dlmm").getBinArraysRequiredByPositionRange;
    deriveOracle: typeof import("@meteora-ag/dlmm").deriveOracle;
    deriveEventAuthority: typeof import("@meteora-ag/dlmm").deriveEventAuthority;
    deriveBinArrayBitmapExtension: typeof import("@meteora-ag/dlmm").deriveBinArrayBitmapExtension;
  }>;

export type ZapVenueDeps = Readonly<{
  connection: Connection;
  sdk: ZapSdk;
  dlmm: ZapDlmmSdk;
  /** Jupiter's keyed production endpoint; without it no Zap is built (the SDK would ask Jupiter without a key). */
  jupiter: Readonly<{ apiUrl: string; apiKey: string }> | null;
  newKeypair?: () => Keypair;
  now?: () => number;
}>;

export type ZapVenue = Readonly<{
  program: string;
  /** Build a Zap into a new position of the pier: `fee` is Ryntra's on a Jupiter leg, or null for none. */
  buildIn: (request: ZapInRequest, fee: ZapFee | null) => Promise<BuiltZap>;
  /** Build «Take the rest» after a Zap that landed only in part. */
  buildRest: (request: ZapRestRequest) => Promise<BuiltZap>;
}>;

type Dlmm = InstanceType<typeof DLMMClass>;

function key(value: string, field: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new LiquidityRefusal("BAD_REQUEST", `${field} is not a Solana address.`);
  }
}

/** A token account's amount from its raw data (offset 64), or zero for an account not opened. */
function heldUnits(data: Uint8Array | null | undefined): bigint {
  return data && data.length >= 72 ? Buffer.from(data.subarray(64, 72)).readBigUInt64LE(0) : 0n;
}

/** Compute units an instruction is given: the Zap's deposit is about 460 k (the SDK's own measure), a route up to 400 k. */
function unitsOf(instruction: TransactionInstruction): number {
  const program = instruction.programId.toBase58();
  if (program === ZAP_PROGRAM) return instruction.keys.length > 12 ? 600_000 : 30_000;
  if (program === JUPITER_PROGRAM) return 400_000;
  if (program === DLMM_PROGRAM) return 200_000;
  return 30_000;
}

const budgetFor = (instructions: readonly TransactionInstruction[]): TransactionInstruction[] => [
  ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(UNIT_CEILING, Math.max(200_000, instructions.reduce((sum, ix) => sum + unitsOf(ix), 0))) }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: ZAP_UNIT_PRICE }),
];

/**
 * The instructions, in their order, packed into as few version-0 transactions as fit Solana's packet: each with its
 * own compute budget, each reading the lookup tables it needs. The order is the SDK's and never changes — the Zap's
 * ledger carries what one transaction leaves to the next.
 */
export function packZap(
  instructions: readonly TransactionInstruction[],
  payer: PublicKey,
  blockhash: string,
  tables: readonly AddressLookupTableAccount[],
): TransactionInstruction[][] {
  const compile = (group: readonly TransactionInstruction[]) =>
    new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: [...budgetFor(group), ...group] }).compileToV0Message([...tables]));
  const fits = (group: readonly TransactionInstruction[]): boolean => {
    try {
      return compile(group).serialize().length <= PACKET_BYTES;
    } catch {
      return false;
    }
  };
  const groups: TransactionInstruction[][] = [];
  let current: TransactionInstruction[] = [];
  for (const instruction of instructions) {
    if (fits([...current, instruction])) {
      current.push(instruction);
      continue;
    }
    if (current.length === 0) throw new LiquidityRefusal("ZAP_NO_ROUTE", "One step of the Zap does not fit a transaction.");
    groups.push(current);
    current = [instruction];
    if (!fits(current)) throw new LiquidityRefusal("ZAP_NO_ROUTE", "One step of the Zap does not fit a transaction.");
  }
  if (current.length) groups.push(current);
  if (groups.length > ZAP_MAX_TRANSACTIONS) throw new LiquidityRefusal("ZAP_NO_ROUTE", "The Zap needs more transactions than one approval takes.");
  return groups;
}

export function createZapVenue(deps: ZapVenueDeps): ZapVenue {
  const { connection, sdk } = deps;
  const now = deps.now ?? Date.now;
  const newKeypair = deps.newKeypair ?? (() => Keypair.generate());
  const program = deps.dlmm.createProgram(connection, { cluster: "mainnet-beta" });

  const zapFor = () => {
    if (!deps.jupiter) throw new LiquidityRefusal("ZAP_NO_ROUTE", "Jupiter's keyed endpoint is not configured; no Zap is built.");
    return new sdk.Zap(connection, { jupiterApiUrl: deps.jupiter.apiUrl, jupiterApiKey: deps.jupiter.apiKey });
  };

  const open = async (pool: PublicKey): Promise<Dlmm> => {
    try {
      return await deps.dlmm.DLMM.create(connection, pool, { cluster: "mainnet-beta" });
    } catch (error) {
      const info = await connection.getAccountInfo(pool, "confirmed");
      if (!info || info.owner.toBase58() !== DLMM_PROGRAM) throw new LiquidityRefusal("POOL_NOT_FOUND", "No DLMM pool at the address.");
      throw error;
    }
  };

  /** The pier's sides: one of them SOL (wrapped), the other its coin of the Token program — a hook or a transfer fee would break the ledger's count. */
  const pierOf = (dlmm: Dlmm) => {
    const x: LiquidityToken = { mint: dlmm.tokenX.publicKey.toBase58(), decimals: dlmm.tokenX.mint.decimals, program: dlmm.tokenX.owner.toBase58() };
    const y: LiquidityToken = { mint: dlmm.tokenY.publicKey.toBase58(), decimals: dlmm.tokenY.mint.decimals, program: dlmm.tokenY.owner.toBase58() };
    if ((x.mint === SOL) === (y.mint === SOL)) throw new LiquidityRefusal("WRONG_POOL", "A Zap from SOL needs a pool of SOL and one other coin.");
    if (x.program !== TOKEN_PROGRAM_ID.toBase58() || y.program !== TOKEN_PROGRAM_ID.toBase58()) throw new LiquidityRefusal("WRONG_POOL", "The Zap takes coins of the Token program only.");
    if (dlmm.lbPair.status !== 0) throw new LiquidityRefusal("POOL_DISABLED", "The pool does not take liquidity now.");
    const solSide: "x" | "y" = x.mint === SOL ? "x" : "y";
    const other = solSide === "x" ? y : x;
    return { x, y, solSide, other, price: priceOf(dlmm, x, y) };
  };

  const priceOf = (dlmm: Dlmm, x: LiquidityToken, y: LiquidityToken): string =>
    deps.dlmm.getPriceOfBinByBinId(dlmm.lbPair.activeId, dlmm.lbPair.binStep).mul(10 ** (x.decimals - y.decimals)).toSignificantDigits(10).toFixed();

  const rentOf = async (account: "positionV2" | "binArray", count = 1): Promise<string> =>
    (BigInt(await connection.getMinimumBalanceForRentExemption(program.account[account].size, "confirmed")) * BigInt(count)).toString();

  const expiry = () => {
    const at = now();
    return { at, expiresAt: at + ZAP_PREVIEW_TTL_MS };
  };

  /** Pack, sign with the fresh key where it is named, and hand back the wallet's bytes with their blockhash's life. */
  const seal = async (instructions: readonly TransactionInstruction[], owner: PublicKey, tables: readonly AddressLookupTableAccount[], fresh: Keypair | null) => {
    const latest = await connection.getLatestBlockhash("confirmed");
    const groups = packZap(instructions, owner, latest.blockhash, tables);
    const transactions = groups.map((group): UnsignedLiquidityTx => {
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: owner, recentBlockhash: latest.blockhash, instructions: [...budgetFor(group), ...group] }).compileToV0Message([...tables]));
      const mine = fresh && group.some((ix) => ix.keys.some((meta) => meta.isSigner && meta.pubkey.equals(fresh.publicKey))) ? fresh : null;
      if (mine) tx.sign([mine]);
      return { wireBase64: Buffer.from(tx.serialize()).toString("base64"), presigned: mine ? [mine.publicKey.toBase58()] : [] };
    });
    /* Only the tables a transaction actually reads are named in the ticket. */
    const used = new Set<string>();
    for (const tx of transactions) for (const lookup of VersionedTransaction.deserialize(Buffer.from(tx.wireBase64, "base64")).message.addressTableLookups) used.add(lookup.accountKey.toBase58());
    return { transactions, validUntil: String(latest.lastValidBlockHeight), lookupTables: tables.filter((table) => used.has(table.key.toBase58())) };
  };

  return {
    program: ZAP_PROGRAM,

    async buildIn(request, fee) {
      const owner = key(request.owner, "owner");
      const poolKey = key(request.pool, "pool");
      const amountIn = parseUnits(request.amountIn, "amountIn");
      if (amountIn < ZAP_MIN_LAMPORTS) throw new LiquidityRefusal("AMOUNT_ZERO", "Too little SOL for a Zap.");
      if (!Number.isInteger(request.half) || request.half < 0 || request.half > ZAP_MAX_HALF) throw new LiquidityRefusal("RANGE_TOO_WIDE", "A Zap opens at most 69 bins.");
      assertBps(request.slippageBps, "slippageBps", 1, 1_000);
      const shape = request.shape ?? "spot";
      if (!LIQUIDITY_SHAPES.includes(shape)) throw new LiquidityRefusal("BAD_REQUEST", "The shape is not one the engine builds.");
      const strategy = SHAPE_TO_STRATEGY[shape];
      if (fee && (!Number.isInteger(fee.bps) || fee.bps < 1 || fee.bps > 100 || fee.mint !== SOL)) throw new LiquidityRefusal("BAD_REQUEST", "Ryntra's fee on a Zap is a rate of the table, in SOL.");
      const zap = zapFor();
      const dlmm = await open(poolKey);
      const pier = pierOf(dlmm);
      const activeId = dlmm.lbPair.activeId;
      const binStep = dlmm.lbPair.binStep;
      const lower = activeId - request.half;
      const upper = activeId + request.half;

      const queryOptions: Record<string, string | number | boolean> = { maxAccounts: ZAP_MAX_ACCOUNTS };
      if (fee) Object.assign(queryOptions, { platformFeeBps: fee.bps, feeAccount: fee.account });
      const estimate = await sdk
        .estimateDlmmDirectSwap({
          user: owner,
          amountIn: new BN(amountIn.toString()),
          inputTokenMint: NATIVE_MINT,
          lbPair: poolKey,
          connection,
          swapSlippageBps: ZAP_SWAP_SLIPPAGE_BPS,
          minDeltaId: -request.half,
          maxDeltaId: request.half,
          strategy,
          jupiterQuoteOptions: queryOptions,
          config: { jupiterApiUrl: deps.jupiter!.apiUrl, jupiterApiKey: deps.jupiter!.apiKey },
        })
        .catch((error: unknown) => {
          throw new LiquidityRefusal("ZAP_NO_ROUTE", `No swap for the Zap: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`);
        });
      const result = estimate.result;
      const quote = result.quote;
      const swapType = result.swapType;
      const route: ZapLeg["route"] = swapType === 2 || !quote ? "none" : quote.route === 0 ? "jupiter" : "pool";
      const inAmount = route === "none" ? 0n : BigInt(result.swapAmount.toString());
      const expectedOut = route === "none" ? 0n : BigInt(result.expectedOutput.toString());
      let floor = expectedOut;
      let labels: string[] = route === "pool" ? ["Meteora DLMM"] : [];
      if (route === "jupiter" && quote && quote.route === 0) {
        const jq = quote.originalQuote as { outAmount: string; otherAmountThreshold: string; slippageBps: number; routePlan?: { swapInfo?: { label?: unknown } }[] };
        const fromSlippage = (BigInt(jq.outAmount) * BigInt(10_000 - jq.slippageBps)) / 10_000n;
        const stated = BigInt(jq.otherAmountThreshold);
        floor = stated < fromSlippage ? stated : fromSlippage;
        labels = (jq.routePlan ?? []).map((step) => (typeof step.swapInfo?.label === "string" ? step.swapInfo.label.slice(0, 48) : "?")).slice(0, 4);
      }
      /* The SOL side buys the other coin: SOL → other is the only direction a Zap from SOL swaps. */
      if (route !== "none" && (swapType === 0) !== (pier.solSide === "x")) throw new LiquidityRefusal("ZAP_NO_ROUTE", "The swap does not buy the pier's other coin.");
      const charged = route === "jupiter" && fee ? fee : null;

      const params = await zap
        .getZapInDlmmDirectParams({
          user: owner,
          lbPair: poolKey,
          inputTokenMint: NATIVE_MINT,
          amountIn: new BN(amountIn.toString()),
          maxActiveBinSlippage: Math.max(1, Math.ceil(request.slippageBps / binStep)),
          minDeltaId: -request.half,
          maxDeltaId: request.half,
          strategy,
          favorXInActiveId: false,
          swapSlippageBps: ZAP_SWAP_SLIPPAGE_BPS,
          maxTransferAmountExtendPercentage: 2,
          directSwapEstimate: result,
        })
        .catch((error: unknown) => {
          throw new LiquidityRefusal("ZAP_NO_ROUTE", `The Zap could not be built: ${error instanceof Error ? error.message.slice(0, 120) : "unknown"}`);
        });
      if (params.activeId !== activeId) throw new LiquidityRefusal("PREVIEW_EXPIRED", "The price moved while the Zap was built.");
      const fresh = newKeypair();
      const built = await zap.buildZapInDlmmTransaction({ ...params, position: fresh.publicKey });

      /* The bins the position covers need their arrays on chain; the ones missing are opened on the wallet's rent. */
      const required = deps.dlmm.getBinArraysRequiredByPositionRange(poolKey, new BN(lower), new BN(upper), new PublicKey(DLMM_PROGRAM));
      const infos = await connection.getMultipleAccountsInfo(required.map((entry) => entry.key), "confirmed");
      const missing = required.filter((_, index) => !infos[index]);
      const initBins = missing.length ? await dlmm.initializeBinArrays(missing.map((entry) => entry.index), owner) : [];
      const otherAccount = ownAccountOf(request.owner, pier.other.mint, pier.other.program);
      const [otherInfo] = await connection.getMultipleAccountsInfo([new PublicKey(otherAccount)], "confirmed");

      const rent: RentCost[] = [{ what: "position", direction: "pay", lamports: await rentOf("positionV2"), refundable: true }];
      if (missing.length) rent.push({ what: "bin_arrays", direction: "pay", lamports: await rentOf("binArray", missing.length), refundable: false });
      if (!otherInfo) rent.push({ what: "token_account", direction: "pay", lamports: String(await connection.getMinimumBalanceForRentExemption(165, "confirmed")), refundable: true });

      const sealed = await seal([...initBins, ...built.instructions], owner, built.addressLookupTableAccounts, fresh);
      const postX = BigInt(result.postSwapX.toString());
      const postY = BigInt(result.postSwapY.toString());
      const preview: ZapPreview = {
        action: "zap_in",
        venue: "meteora-dlmm",
        pool: request.pool,
        owner: request.owner,
        tokenX: pier.x,
        tokenY: pier.y,
        amountIn: amountIn.toString(),
        swap: {
          route,
          inMint: SOL,
          outMint: pier.other.mint,
          inAmount: inAmount.toString(),
          expectedOut: expectedOut.toString(),
          floor: floor.toString(),
          fee: charged ? { bps: charged.bps, amount: ((inAmount * BigInt(charged.bps)) / 10_000n).toString(), mint: SOL, account: charged.account } : null,
          labels,
        },
        deposit: { x: amountOf(pier.x, postX), y: amountOf(pier.y, postY) },
        range: {
          kind: "bins",
          lowerBin: lower,
          upperBin: upper,
          lowerPrice: deps.dlmm.getPriceOfBinByBinId(lower, binStep).mul(10 ** (pier.x.decimals - pier.y.decimals)).toSignificantDigits(10).toFixed(),
          upperPrice: deps.dlmm.getPriceOfBinByBinId(upper, binStep).mul(10 ** (pier.x.decimals - pier.y.decimals)).toSignificantDigits(10).toFixed(),
        },
        otherBefore: heldUnits(otherInfo?.data).toString(),
        unwrapLamports: "0",
        fees: charged ? [{ who: "ryntra", applies_to: "swap", bps: charged.bps }] : [],
        rent,
        transactions: sealed.transactions.length,
        notices: [],
        price: pier.price,
        ...expiry(),
      };
      return {
        preview,
        transactions: sealed.transactions,
        feePayer: request.owner,
        validUntil: sealed.validUntil,
        position: fresh.publicKey.toBase58(),
        lookupTables: sealed.lookupTables,
        check: {
          owner: request.owner,
          pool: request.pool,
          mintX: pier.x.mint,
          mintY: pier.y.mint,
          programX: pier.x.program,
          programY: pier.y.program,
          action: "zap_in",
          position: fresh.publicKey.toBase58(),
          fee: charged ? { bps: charged.bps, account: charged.account } : null,
          swap: route === "none" ? null : { maxIn: inAmount, floor },
        },
      };
    },

    async buildRest(request) {
      const owner = key(request.owner, "owner");
      const poolKey = key(request.pool, "pool");
      const before = parseUnits(request.otherBefore, "otherBefore");
      const zap = new sdk.Zap(connection);
      const dlmm = await open(poolKey);
      const pier = pierOf(dlmm);
      const otherAccount = new PublicKey(ownAccountOf(request.owner, pier.other.mint, pier.other.program));
      const wsolAccount = new PublicKey(ownAccountOf(request.owner, SOL, TOKEN_PROGRAM_ID.toBase58()));
      const ledger = new PublicKey(ledgerOf(request.owner));
      const [otherInfo, wsolInfo, ledgerInfo] = await connection.getMultipleAccountsInfo([otherAccount, wsolAccount, ledger], "confirmed");
      const held = heldUnits(otherInfo?.data);
      const extra = held > before ? held - before : 0n;

      const instructions: TransactionInstruction[] = [];
      const rent: RentCost[] = [];
      if (ledgerInfo && ledgerInfo.owner.toBase58() === ZAP_PROGRAM) {
        instructions.push(await zap.zapProgram.methods.closeLedgerAccount().accountsPartial({ ledger, owner, rentReceiver: owner }).instruction());
        rent.push({ what: "ledger", direction: "return", lamports: String(ledgerInfo.lamports), refundable: true });
      }
      let swap: ZapLeg = { route: "none", inMint: pier.other.mint, outMint: SOL, inAmount: "0", expectedOut: "0", floor: "0", fee: null, labels: [] };
      if (extra > 0n) {
        /* The other coin back to SOL in the pier's own pool, through Zap Out: it swaps what the account holds above `before`, at most `extra`. */
        const swapForY = pier.solSide === "y";
        const binArrays = await dlmm.getBinArrayForSwap(swapForY, 4);
        const quote = dlmm.swapQuote(new BN(extra.toString()), swapForY, new BN(ZAP_SWAP_SLIPPAGE_BPS), binArrays);
        const minOut = BigInt(quote.minOutAmount.toString());
        if (minOut <= 0n) throw new LiquidityRefusal("ZAP_NO_ROUTE", "The pool gives nothing back for the rest now.");
        const [bitmap] = deps.dlmm.deriveBinArrayBitmapExtension(poolKey, new PublicKey(DLMM_PROGRAM));
        const [bitmapInfo] = await connection.getMultipleAccountsInfo([bitmap], "confirmed");
        const [oracle] = deps.dlmm.deriveOracle(poolKey, new PublicKey(DLMM_PROGRAM));
        const [eventAuthority] = deps.dlmm.deriveEventAuthority(new PublicKey(DLMM_PROGRAM));
        const dlmmProgram = new PublicKey(DLMM_PROGRAM);
        const meta = (pubkey: PublicKey, isWritable: boolean, isSigner = false) => ({ pubkey, isSigner, isWritable });
        /* swap2's own accounts, in its order — built here: the SDK's helper reads the bin arrays for X → Y only. */
        const remaining = [
          meta(poolKey, true),
          meta(bitmapInfo ? bitmap : dlmmProgram, Boolean(bitmapInfo)),
          meta(dlmm.lbPair.reserveX, true),
          meta(dlmm.lbPair.reserveY, true),
          meta(otherAccount, true),
          meta(wsolAccount, true),
          meta(dlmm.lbPair.tokenXMint, false),
          meta(dlmm.lbPair.tokenYMint, false),
          meta(oracle, true),
          meta(dlmmProgram, false),
          meta(owner, false, true),
          meta(TOKEN_PROGRAM_ID, false),
          meta(TOKEN_PROGRAM_ID, false),
          meta(new PublicKey(MEMO_PROGRAM), false),
          meta(eventAuthority, false),
          meta(dlmmProgram, false),
          ...binArrays.map((entry) => meta(entry.publicKey, true)),
        ];
        const payload = sdk.createDlmmSwapPayload(new BN(extra.toString()), new BN(minOut.toString()), { slices: [] });
        instructions.push(createAssociatedTokenAccountIdempotentInstruction(owner, wsolAccount, owner, NATIVE_MINT));
        instructions.push(
          await zap.zapProgram.methods
            .zapOut({ percentage: 100, offsetAmountIn: sdk.AMOUNT_IN_DLMM_OFFSET, preUserTokenBalance: new BN(before.toString()), maxSwapAmount: new BN(extra.toString()), payloadData: payload })
            .accountsPartial({ userTokenInAccount: otherAccount, ammProgram: dlmmProgram })
            .remainingAccounts(remaining)
            .instruction(),
        );
        swap = { route: "pool", inMint: pier.other.mint, outMint: SOL, inAmount: extra.toString(), expectedOut: quote.outAmount.toString(), floor: minOut.toString(), fee: null, labels: ["Meteora DLMM"] };
      }
      if (wsolInfo || extra > 0n) instructions.push(createCloseAccountInstruction(wsolAccount, owner, owner));
      if (instructions.length === 0) throw new LiquidityRefusal("NOTHING_TO_WITHDRAW", "Nothing of the Zap is left in the wallet.");

      const sealed = await seal(instructions, owner, [], null);
      const preview: ZapPreview = {
        action: "zap_rest",
        venue: "meteora-dlmm",
        pool: request.pool,
        owner: request.owner,
        tokenX: pier.x,
        tokenY: pier.y,
        amountIn: "0",
        swap,
        deposit: null,
        range: null,
        otherBefore: before.toString(),
        unwrapLamports: String(wsolInfo?.lamports ?? 0),
        fees: [],
        rent,
        transactions: sealed.transactions.length,
        notices: [],
        price: pier.price,
        ...expiry(),
      };
      return {
        preview,
        transactions: sealed.transactions,
        feePayer: request.owner,
        validUntil: sealed.validUntil,
        position: request.pool,
        lookupTables: sealed.lookupTables,
        check: {
          owner: request.owner,
          pool: request.pool,
          mintX: pier.x.mint,
          mintY: pier.y.mint,
          programX: pier.x.program,
          programY: pier.y.program,
          action: "zap_rest",
          position: null,
          fee: null,
          swap: extra > 0n ? { maxIn: extra, floor: BigInt(swap.floor) } : null,
        },
      };
    },
  };
}
