/**
 * Meteora DLMM limit orders for the limits lane (lb_clmm 0.12.0, SDK 1.9.14).
 *
 * One order sits in one bin: the bin whose price is the person's price or
 * better for them — below the market for a buy, above it for a sell. When the
 * market crosses the bin, the pool converts the deposit at the bin's price and
 * it stays converted; the order earns half of the swap fee the bin collects.
 * «Забрати» is the program's cancel, which returns what converted and what did
 * not, followed by closing the empty order account so its rent comes back.
 *
 * Proved on mainnet by simulation on 2026-10-15: `place_limit_order` in the five
 * largest SOL-USDC pools.
 */

import DLMM, { isSupportLimitOrder, LimitOrderStatus } from "@meteora-ag/dlmm";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";

import { limitsConnection } from "./chain.server.ts";
import { withDlmmOrderKey } from "./dlmm-tx.ts";
import { base58, DLMM_PROGRAM, dlmmIsAskSide, dlmmPoolPrice, type LimitSide } from "./model.ts";

const DATA_API = "https://dlmm.datapi.meteora.ag";
/** Pools below this much liquidity are not offered: a thin pool's bins are a price nobody trades through. */
export const DLMM_MIN_POOL_TVL_USD = 5_000;
const POOL_CANDIDATES = 5;


export type DlmmFailure = Readonly<{ ok: false; code: string; reason: string }>;

export type DlmmLimitPool = Readonly<{
  ok: true;
  pool: string;
  name: string;
  baseIsX: boolean;
  binStep: number;
  activeId: number;
  /** Quote per base at the active bin. */
  activePrice: number;
  tvlUsd: number;
}>;

type ApiPool = { address?: string; name?: string; tvl?: number; is_blacklisted?: boolean; token_x?: { address?: string }; token_y?: { address?: string } };

const pools = new Map<string, Readonly<{ at: number; answer: DlmmLimitPool | DlmmFailure }>>();
const POOL_TTL_MS = 2 * 60 * 1000;

async function candidatePools(baseMint: string, quoteMint: string): Promise<readonly ApiPool[]> {
  const filter = `(token_x=${baseMint} && token_y=${quoteMint}) || (token_x=${quoteMint} && token_y=${baseMint})`;
  const url = `${DATA_API}/pools?page_size=${POOL_CANDIDATES}&sort_by=tvl:desc&filter_by=${encodeURIComponent(filter)}`;
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(6_000), cache: "no-store" });
  if (!response.ok) throw new Error(`Meteora answered ${response.status}.`);
  const body = (await response.json()) as { data?: ApiPool[] };
  return (body.data ?? []).filter((pool) => pool.address && !pool.is_blacklisted && (pool.tvl ?? 0) >= DLMM_MIN_POOL_TVL_USD);
}

/** Quote per base at a bin, from the pool's own price of Y per X. */
function binPrice(dlmm: DLMM, binId: number, baseIsX: boolean): number {
  const perLamport = Number(dlmm.fromPricePerLamport(Number(DLMM_PRICE(binId, dlmm.lbPair.binStep))));
  return baseIsX ? perLamport : 1 / perLamport;
}

/** Y-per-X price per lamport of a bin: (1 + step/10 000)^id. */
function DLMM_PRICE(binId: number, binStep: number): number {
  return (1 + binStep / 10_000) ** binId;
}

/**
 * The deepest pool of the pair that takes limit orders. Asked of Meteora's data
 * API by both mints, then read on chain: the pool's own function type decides,
 * not a label.
 */
export async function findDlmmLimitPool(
  baseMint: string,
  quoteMint: string,
  deps: Readonly<{ connection?: Connection; now?: number }> = {},
): Promise<DlmmLimitPool | DlmmFailure> {
  const key = `${baseMint}:${quoteMint}`;
  const now = deps.now ?? Date.now();
  const known = pools.get(key);
  if (known && now - known.at < POOL_TTL_MS) return known.answer;
  const connection = deps.connection ?? limitsConnection();
  let answer: DlmmLimitPool | DlmmFailure = { ok: false, code: "NO_LIMIT_POOL", reason: "No Meteora pool of this pair takes limit orders." };
  try {
    const listed = await candidatePools(baseMint, quoteMint);
    if (listed.length === 0) answer = { ok: false, code: "NO_POOL", reason: "Meteora has no pool of this pair with enough liquidity." };
    for (const pool of listed) {
      const dlmm = await DLMM.create(connection, new PublicKey(pool.address as string));
      if (!isSupportLimitOrder(dlmm.lbPair)) continue;
      const baseIsX = dlmm.lbPair.tokenXMint.toBase58() === baseMint;
      answer = {
        ok: true,
        pool: pool.address as string,
        name: pool.name ?? "",
        baseIsX,
        binStep: dlmm.lbPair.binStep,
        activeId: dlmm.lbPair.activeId,
        activePrice: binPrice(dlmm, dlmm.lbPair.activeId, baseIsX),
        tvlUsd: pool.tvl ?? 0,
      };
      break;
    }
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  pools.set(key, { at: now, answer });
  return answer;
}

/* ----------------------------------------------------------------- place */

export type DlmmPlaceBuilt = Readonly<{
  ok: true;
  /** Legacy transaction, unsigned: the wallet signs first, the relay signs for the order's fresh account after it (`cosignDlmmPlace`). */
  transactionBase64: string;
  limitOrder: string;
  pool: string;
  binId: number;
  /** Quote per base the bin converts at — the order's real price. */
  binPrice: number;
  isAskSide: boolean;
  networkFeeLamports: number;
  /** Rent of the order account (returned on close) and of any new bin array the order opens (not returned). */
  depositLamports: number | null;
}>;

/**
 * Place the deposit in the bin nearest the person's price on their side of it.
 * A price on the wrong side of the market is a market order in disguise and is
 * refused here — the market ticket does that honestly.
 */
export async function buildDlmmPlace(
  args: Readonly<{ owner: string; pool: string; side: LimitSide; inputRaw: string; price: number; baseMint: string }>,
  deps: Readonly<{ connection?: Connection; env?: Readonly<Record<string, string | undefined>> }> = {},
): Promise<DlmmPlaceBuilt | DlmmFailure> {
  const connection = deps.connection ?? limitsConnection();
  const env = deps.env ?? process.env;
  const owner = new PublicKey(args.owner);
  let dlmm: DLMM;
  try {
    dlmm = await DLMM.create(connection, new PublicKey(args.pool));
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  if (!isSupportLimitOrder(dlmm.lbPair)) return { ok: false, code: "NO_LIMIT_POOL", reason: "This pool does not take limit orders." };
  const baseIsX = dlmm.lbPair.tokenXMint.toBase58() === args.baseMint;
  const isAskSide = dlmmIsAskSide(args.side, baseIsX);
  const poolPrice = dlmmPoolPrice(args.price, baseIsX);
  const perLamport = DLMM.getPricePerLamport(dlmm.tokenX.mint.decimals, dlmm.tokenY.mint.decimals, poolPrice);
  /* Ask (X → Y) sits above the market: round the bin up so it never sells below the price. Bid (Y → X) sits below: round down. */
  const binId = DLMM.getBinIdFromPrice(perLamport, dlmm.lbPair.binStep, !isAskSide);
  const activeId = dlmm.lbPair.activeId;
  if (isAskSide ? binId <= activeId : binId >= activeId) {
    return { ok: false, code: "CROSSES_MARKET", reason: "The price is on the other side of the market: that is a market order." };
  }
  /* Built with a draft account in the order's slot; the order's own key is derived from what the transaction does, then seated. */
  const draft = Keypair.generate().publicKey;
  let built: Transaction;
  try {
    built = await dlmm.placeLimitOrder({
      owner,
      payer: owner,
      sender: owner,
      limitOrder: draft,
      params: { isAskSide, relativeBin: null, bins: [{ id: binId, amount: new BN(args.inputRaw) }] },
    });
  } catch (failure) {
    return { ok: false, code: "BUILD_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  built.feePayer = owner;
  const seated = withDlmmOrderKey(built, draft, env);
  if (!seated) return { ok: false, code: "ORDER_KEY_UNAVAILABLE", reason: "The server cannot sign for the order right now." };
  const { transaction, limitOrder } = seated;
  const before = await connection.getBalance(owner, "confirmed").catch(() => null);
  const simulated = await connection
    .simulateTransaction(new VersionedTransaction(transaction.compileMessage()), {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: { encoding: "base64", addresses: [owner.toBase58()] },
    })
    .catch((failure: unknown) => ({ failure }));
  if ("failure" in simulated) return { ok: false, code: "SIMULATION_UNAVAILABLE", reason: simulated.failure instanceof Error ? simulated.failure.message : String(simulated.failure) };
  if (simulated.value.err) {
    const logs = (simulated.value.logs ?? []).filter((line) => /Error|insufficient/i.test(line)).slice(0, 2).join(" ");
    return { ok: false, code: "SIMULATION_FAILED", reason: logs || JSON.stringify(simulated.value.err) };
  }
  const networkFeeLamports = 5_000 * transaction.compileMessage().header.numRequiredSignatures;
  const after = simulated.value.accounts?.[0]?.lamports;
  const wrapped = isAskSide
    ? (dlmm.tokenX.mint.address.equals(NATIVE_MINT) ? Number(args.inputRaw) : 0)
    : (dlmm.tokenY.mint.address.equals(NATIVE_MINT) ? Number(args.inputRaw) : 0);
  const depositLamports = before !== null && typeof after === "number" ? Math.max(0, before - after - networkFeeLamports - wrapped) : null;
  const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    ok: true,
    transactionBase64: Buffer.from(serialized).toString("base64"),
    limitOrder: limitOrder.publicKey.toBase58(),
    pool: args.pool,
    binId,
    binPrice: binPrice(dlmm, binId, baseIsX),
    isAskSide,
    networkFeeLamports,
    depositLamports,
  };
}

/* ------------------------------------------------------- cancel and claim */

/** Cancel every open bin and close the account: the deposit, what converted and the rent come back in one signature. */
export async function buildDlmmCancel(
  args: Readonly<{ owner: string; limitOrder: string }>,
  deps: Readonly<{ connection?: Connection }> = {},
): Promise<Readonly<{ ok: true; transactionBase64: string; pool: string }> | DlmmFailure> {
  const connection = deps.connection ?? limitsConnection();
  const owner = new PublicKey(args.owner);
  const orderKey = new PublicKey(args.limitOrder);
  try {
    const info = await connection.getAccountInfo(orderKey, "confirmed");
    if (!info || info.owner.toBase58() !== DLMM_PROGRAM) return { ok: false, code: "ORDER_NOT_FOUND", reason: "The order account is not on chain." };
    const pool = new PublicKey(info.data.subarray(8, 40));
    const recordedOwner = new PublicKey(info.data.subarray(40, 72));
    if (!recordedOwner.equals(owner)) return { ok: false, code: "NOT_YOURS", reason: "The order belongs to another wallet." };
    const dlmm = await DLMM.create(connection, pool);
    const order = await dlmm.getLimitOrder(orderKey);
    const binIds = order.limitOrderData.limitOrderBinData.filter((bin) => !bin.empty).map((bin) => bin.binId);
    const transaction = new Transaction();
    if (binIds.length > 0) {
      const cancel = await dlmm.cancelLimitOrder({ limitOrderPubkey: orderKey, owner, rentReceiver: owner, binIds });
      transaction.add(...cancel.instructions);
    }
    const close = await dlmm.closeLimitOrderIfEmpty({ limitOrder: orderKey, owner, rentReceiver: owner });
    transaction.add(...close.instructions);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = owner;
    const simulated = await connection.simulateTransaction(new VersionedTransaction(transaction.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
    if (simulated.value.err) {
      const logs = (simulated.value.logs ?? []).filter((line) => /Error/i.test(line)).slice(0, 2).join(" ");
      return { ok: false, code: "SIMULATION_FAILED", reason: logs || JSON.stringify(simulated.value.err) };
    }
    const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
    return { ok: true, transactionBase64: Buffer.from(serialized).toString("base64"), pool: pool.toBase58() };
  } catch (failure) {
    return { ok: false, code: "BUILD_FAILED", reason: failure instanceof Error ? failure.message : String(failure) };
  }
}

/* ---------------------------------------------------------------- orders */

export type DlmmOrderRow = Readonly<{
  limitOrder: string;
  pool: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
  /** One order is one side of one or more bins; this lane places one bin. */
  isAskSide: boolean;
  binIds: readonly number[];
  /** Y per X at the order's first bin. */
  poolPrice: number;
  depositX: string;
  depositY: string;
  unfilledX: string;
  unfilledY: string;
  swappedX: string;
  swappedY: string;
  feeX: string;
  feeY: string;
  /** NotFilled · PartialFilled · Fulfilled. */
  status: "OPEN" | "PARTIAL" | "FILLED";
}>;

const LIMIT_ORDER_ACCOUNT = "89b7d45b731d8de3";
const SOLANA_PUBLIC_ENDPOINT = "https://api.mainnet-beta.solana.com";
let indexed: Connection | null = null;
function indexedReadConnection(): Connection {
  indexed ??= new Connection(SOLANA_PUBLIC_ENDPOINT, { commitment: "confirmed", disableRetryOnRateLimit: true });
  return indexed;
}

/**
 * A wallet's DLMM limit orders, in any pool. One `getProgramAccounts` by owner
 * finds the order accounts (most wallets have none, and that is the whole
 * answer); then each pool's orders are read through the SDK by one of its mints.
 */
export async function listDlmmOrders(
  owner: string,
  deps: Readonly<{ connection?: Connection }> = {},
): Promise<Readonly<{ ok: true; orders: readonly DlmmOrderRow[] }> | DlmmFailure> {
  const primary = deps.connection ?? limitsConnection();
  const seen = new Map<string, DlmmOrderRow>();
  try {
    /* An operator that refuses indexed reads (publicnode answers 403 to any getProgramAccounts) is asked once, then Solana's own public endpoint, which serves them. */
    const connection = await primary
      .getProgramAccounts(new PublicKey(DLMM_PROGRAM), { commitment: "confirmed", dataSlice: { offset: 0, length: 0 }, filters: [{ memcmp: { offset: 0, bytes: base58(Buffer.from(LIMIT_ORDER_ACCOUNT, "hex")) } }, { memcmp: { offset: 40, bytes: owner } }] })
      .then(() => primary)
      .catch(() => indexedReadConnection());
    /* LimitOrder: 8 discriminator · lb_pair 32 · owner 32. */
    const accounts = await connection.getProgramAccounts(new PublicKey(DLMM_PROGRAM), {
      commitment: "confirmed",
      dataSlice: { offset: 8, length: 32 },
      filters: [
        { memcmp: { offset: 0, bytes: base58(Buffer.from(LIMIT_ORDER_ACCOUNT, "hex")) } },
        { memcmp: { offset: 40, bytes: owner } },
      ],
    });
    if (accounts.length === 0) return { ok: true, orders: [] };
    const pairs = [...new Set(accounts.map(({ account }) => new PublicKey(account.data).toBase58()))];
    const pairInfos = await connection.getMultipleAccountsInfo(pairs.map((pair) => new PublicKey(pair)), "confirmed");
    /* One mint per pool covers it; the SDK reads every order of the wallet in pools holding that mint. */
    const tokenX = await Promise.all(pairs.map((pair, index) => (pairInfos[index] ? DLMM.create(connection, new PublicKey(pair)).then((dlmm) => dlmm.lbPair.tokenXMint.toBase58()) : null)));
    const mints = [...new Set(tokenX.filter((mint): mint is string => mint !== null))];
    for (const mint of mints) {
      const byPool = await DLMM.getLimitOrdersByUserAndTokenAddress(connection, new PublicKey(owner), new PublicKey(mint));
      for (const [pool, info] of byPool) {
        for (const order of info.limitOrders) {
          const key = order.publicKey.toBase58();
          if (seen.has(key)) continue;
          const bins = order.limitOrderData.limitOrderBinData.filter((bin) => !bin.empty);
          const first = bins[0] ?? order.limitOrderData.limitOrderBinData[0];
          const statuses = bins.map((bin) => bin.status);
          const status = statuses.length > 0 && statuses.every((value) => value === LimitOrderStatus.Fulfilled)
            ? "FILLED"
            : statuses.some((value) => value === LimitOrderStatus.Fulfilled || value === LimitOrderStatus.PartialFilled) ? "PARTIAL" : "OPEN";
          seen.set(key, {
            limitOrder: key,
            pool,
            tokenXMint: info.tokenX.mint.address.toBase58(),
            tokenYMint: info.tokenY.mint.address.toBase58(),
            tokenXDecimals: info.tokenX.mint.decimals,
            tokenYDecimals: info.tokenY.mint.decimals,
            isAskSide: first?.isAskSide ?? false,
            binIds: bins.map((bin) => bin.binId),
            poolPrice: first ? DLMM_PRICE(first.binId, info.lbPair.binStep) * 10 ** (info.tokenX.mint.decimals - info.tokenY.mint.decimals) : Number.NaN,
            depositX: order.limitOrderData.totalDepositAmountX,
            depositY: order.limitOrderData.totalDepositAmountY,
            unfilledX: order.limitOrderData.totalUnfilledAmountX,
            unfilledY: order.limitOrderData.totalUnfilledAmountY,
            swappedX: order.limitOrderData.totalSwappedAmountX,
            swappedY: order.limitOrderData.totalSwappedAmountY,
            feeX: order.limitOrderData.totalFeeAmountX,
            feeY: order.limitOrderData.totalFeeAmountY,
            status,
          });
        }
      }
    }
  } catch (failure) {
    return { ok: false, code: "UNREACHABLE", reason: failure instanceof Error ? failure.message : String(failure) };
  }
  return { ok: true, orders: [...seen.values()] };
}

export { cosignDlmmPlace, inspectDlmmTransaction, signedByAll } from "./dlmm-tx.ts";
