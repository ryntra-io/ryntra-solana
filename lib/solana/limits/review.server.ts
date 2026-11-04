/**
 * One Review for a limit order, whichever venue: the amounts, the price it
 * fills at, every cost on its own line, and the unsigned transaction — proved
 * by reading it and by simulating it before anyone is asked to sign.
 *
 * The risk verdict stands here too (`lib/solana/trade-risk.ts`): a limit order
 * is a trade, so it is judged in the same four words over the same thirteen
 * named facts as a swap. What differs is one of them — an order that fills at
 * its own price or not at all takes no slippage, and the fact says exactly
 * that instead of borrowing a swap's answer.
 */

import { PublicKey, type Connection } from "@solana/web3.js";

import { readFreshBuildWindowMs, web3ChainReader } from "../blockhash-life.ts";
import { limitsConnection } from "./chain.server.ts";
import { buildDlmmCancel, buildDlmmPlace, findDlmmLimitPool } from "./dlmm.server.ts";
import {
  effectiveTriggerPrice,
  impliedPrice,
  limitAmounts,
  TRIGGER_V1_MIN_ORDER_USD,
  type LimitPair,
  type LimitSide,
  type LimitVenue,
  type TriggerFeeReason,
} from "./model.ts";
import { buildTriggerCancel, buildTriggerOrder, triggerFeeContext } from "./trigger.server.ts";
import { readRefereeDiscountBps, refereeDiscountInForce } from "../../core/referee-discount.ts";
import { getGuardRuntime } from "../../guard/runtime.ts";
import { tradeRiskVerdict } from "../trade-risk.server.ts";
import type { TradeRiskSource, TradeRiskVerdict } from "../trade-risk.ts";

const decimalsCache = new Map<string, number>();

/** A mint's decimals from the chain, never from the browser: the amounts are built on them. */
export async function mintDecimals(mint: string, connection: Connection): Promise<number | null> {
  const known = decimalsCache.get(mint);
  if (known !== undefined) return known;
  try {
    const info = await connection.getParsedAccountInfo(new PublicKey(mint), "confirmed");
    const data = info.value?.data;
    const decimals = data && typeof data === "object" && "parsed" in data ? (data.parsed as { info?: { decimals?: unknown } }).info?.decimals : undefined;
    if (typeof decimals !== "number") return null;
    decimalsCache.set(mint, decimals);
    return decimals;
  } catch {
    return null;
  }
}

export type LimitReviewRequest = Readonly<{
  owner: string;
  venue: LimitVenue;
  side: LimitSide;
  baseMint: string;
  quoteMint: string;
  /** What the person spends: the quote for a buy, the base for a sell. */
  amount: string;
  /** Quote per base. */
  price: string;
  /** The quote's price in dollars, if the ticket knows it — for the venue's minimum only. */
  quoteUsd?: number | null;
}>;

export type LimitReview = Readonly<{
  venue: LimitVenue;
  side: LimitSide;
  order: string;
  requestId: string | null;
  pool: string | null;
  transactionBase64: string;
  pair: LimitPair;
  inputMint: string;
  outputMint: string;
  makingRaw: string;
  takingRaw: string;
  price: string;
  /** Quote per base at which the order actually fills: the bin's price on DLMM, the price moved by the fee on Jupiter. */
  fillPrice: number;
  fee: Readonly<{
    ryntraBps: number;
    venueBps: number;
    /** Raw units of the output, if the whole order fills. */
    ryntraFeeRaw: string;
    venueFeeRaw: string;
    reason: TriggerFeeReason | "VENUE_HAS_NO_FEE";
    /** Where Ryntra's fee would go, public; null when there is none. */
    account: string | null;
  }>;
  networkFeeLamports: number;
  depositLamports: number | null;
  /** A DLMM order earns half the swap fees of its bin. */
  makerFeeShare: boolean;
  builtAt: string;
  /**
   * AG-1: how long from arriving the person may still sign — the bytes live ~150 blocks ≈ 30 s on 200 ms slots
   * (`lib/solana/blockhash-life.ts`). Signed later, the ticket builds the Review again instead of a refusal.
   */
  signableMs: number;
  /** The risk verdict over this trade: thirteen named facts, each with its source and its time. */
  risk: TradeRiskVerdict;
}>;

export type LimitReviewFailure = Readonly<{ ok: false; status: number; code: string; reason: string }>;

/**
 * The verdict over one limit order. The venue's own terms come out of what was
 * just built: the price the order fills at (which is the price, not a bound on
 * it), the pool or the trigger it rests in, and the life of the bytes the
 * person is about to sign — past that life the Review is rebuilt, and the
 * verdict says so rather than letting stale bytes read as current.
 */
async function limitOrderRisk(
  args: Readonly<{ venue: LimitVenue; outputMint: string; pool: string | null; price: string; pair: LimitPair; builtAt: string; signableMs: number }>,
): Promise<TradeRiskVerdict> {
  const label = args.venue === "trigger" ? "Jupiter Trigger" : "Meteora DLMM";
  const source: TradeRiskSource = { ref: `ryntra.solana.limits:${args.venue}`, label: `Ryntra · ${label}, as the Review was built`, readAt: args.builtAt, slot: null };
  const expiresAt = new Date(Date.parse(args.builtAt) + args.signableMs).toISOString();
  return tradeRiskVerdict({
    trade: { kind: "SPOT_LIMIT", network: "mainnet", mint: args.outputMint },
    slippage: {
      kind: "PRICE_IS_THE_LIMIT",
      basis: `The order rests at ${args.price} and fills at that price or not at all.`,
      source,
    },
    path: { hops: [{ label: args.pool ? `the bin at ${args.price}` : `the trigger at ${args.price}`, venue: args.pool ? `${label} (${args.pool})` : label }], source },
    quote: { readAt: args.builtAt, expiresAt, source },
    venue: { id: args.venue, label, status: "LIVE", detail: "The order was built against this venue just now.", source },
  });
}

export async function reviewLimitOrder(
  request: LimitReviewRequest,
  deps: Readonly<{ connection?: Connection; now?: () => Date; feeDiscount?: (owner: string) => Promise<number> }> = {},
): Promise<Readonly<{ ok: true; review: LimitReview }> | LimitReviewFailure> {
  const connection = deps.connection ?? limitsConnection();
  const [baseDecimals, quoteDecimals] = await Promise.all([mintDecimals(request.baseMint, connection), mintDecimals(request.quoteMint, connection)]);
  if (baseDecimals === null || quoteDecimals === null) return { ok: false, status: 502, code: "MINT_UNREADABLE", reason: "The token could not be read from the chain." };
  const pair: LimitPair = { baseMint: request.baseMint, baseDecimals, quoteMint: request.quoteMint, quoteDecimals };
  const amounts = limitAmounts({ pair, side: request.side, amount: request.amount, price: request.price });
  if (!amounts) return { ok: false, status: 400, code: "INVALID_TERMS", reason: "The amount or the price is not a positive number." };
  const price = Number(request.price);
  if (request.side === "buy" && request.quoteUsd && Number(request.amount) * request.quoteUsd < TRIGGER_V1_MIN_ORDER_USD && request.venue === "trigger") {
    return { ok: false, status: 400, code: "BELOW_MINIMUM", reason: `Jupiter takes orders from ${TRIGGER_V1_MIN_ORDER_USD} USD.` };
  }
  const builtAt = (deps.now ?? (() => new Date()))().toISOString();
  /* The build's own time is subtracted from the bytes' life: the builders hand back no lastValidBlockHeight. */
  const startedAtMs = Date.now();

  if (request.venue === "trigger") {
    /* A partner's friend pays the discounted rate (CITY-182); the store is asked only while the switch is on. */
    const feeDiscountBps = await (deps.feeDiscount ?? ((owner: string) => (refereeDiscountInForce() ? readRefereeDiscountBps(getGuardRuntime().store, owner) : Promise.resolve(0))))(request.owner);
    const context = await triggerFeeContext(amounts, { connection, feeDiscountBps });
    const built = await buildTriggerOrder({ owner: request.owner, amounts, plan: context.plan }, { connection });
    if (!built.ok) return { ok: false, status: built.code === "TRIGGER_BUSY" ? 503 : 422, code: built.code, reason: built.reason };
    const ryntraBps = context.plan.feeAccount !== null ? built.onChain.feeBps : 0;
    const venueBps = ryntraBps > 0 ? 0 : built.onChain.feeBps;
    const signableMs = await readFreshBuildWindowMs(web3ChainReader(connection), { startedAtMs });
    return {
      ok: true,
      review: {
        venue: "trigger",
        side: request.side,
        order: built.order,
        requestId: built.requestId,
        pool: null,
        transactionBase64: built.transactionBase64,
        pair,
        inputMint: amounts.inputMint,
        outputMint: amounts.outputMint,
        makingRaw: amounts.makingRaw,
        takingRaw: amounts.takingRaw,
        price: request.price,
        fillPrice: effectiveTriggerPrice(impliedPrice(pair, request.side, amounts.makingRaw, amounts.takingRaw), request.side, built.onChain.feeBps),
        fee: {
          ryntraBps,
          venueBps,
          ryntraFeeRaw: built.ryntraFeeRaw,
          venueFeeRaw: built.jupiterFeeRaw,
          reason: context.plan.reason,
          account: context.plan.feeAccount,
        },
        networkFeeLamports: built.networkFeeLamports,
        depositLamports: built.depositLamports,
        makerFeeShare: false,
        builtAt,
        signableMs,
        risk: await limitOrderRisk({ venue: "trigger", outputMint: amounts.outputMint, pool: null, price: request.price, pair, builtAt, signableMs }),
      },
    };
  }

  const pool = await findDlmmLimitPool(request.baseMint, request.quoteMint, { connection });
  if (!pool.ok) return { ok: false, status: 422, code: pool.code, reason: pool.reason };
  const placed = await buildDlmmPlace({ owner: request.owner, pool: pool.pool, side: request.side, inputRaw: amounts.makingRaw, price, baseMint: request.baseMint }, { connection });
  if (!placed.ok) return { ok: false, status: placed.code === "ORDER_KEY_UNAVAILABLE" ? 503 : 422, code: placed.code, reason: placed.reason };
  /* What the order delivers at the bin's price, which is the order's real price. */
  const takingAtBin = limitAmounts({ pair, side: request.side, amount: request.amount, price: placed.binPrice.toFixed(18) });
  const dlmmSignableMs = await readFreshBuildWindowMs(web3ChainReader(connection), { startedAtMs });
  return {
    ok: true,
    review: {
      venue: "dlmm",
      side: request.side,
      order: placed.limitOrder,
      requestId: null,
      pool: pool.pool,
      transactionBase64: placed.transactionBase64,
      pair,
      inputMint: amounts.inputMint,
      outputMint: amounts.outputMint,
      makingRaw: amounts.makingRaw,
      takingRaw: takingAtBin?.takingRaw ?? amounts.takingRaw,
      price: request.price,
      fillPrice: placed.binPrice,
      fee: { ryntraBps: 0, venueBps: 0, ryntraFeeRaw: "0", venueFeeRaw: "0", reason: "VENUE_HAS_NO_FEE", account: null },
      networkFeeLamports: placed.networkFeeLamports,
      depositLamports: placed.depositLamports,
      makerFeeShare: true,
      builtAt,
      signableMs: dlmmSignableMs,
      risk: await limitOrderRisk({ venue: "dlmm", outputMint: amounts.outputMint, pool: pool.pool, price: request.price, pair, builtAt, signableMs: dlmmSignableMs }),
    },
  };
}

export async function buildLimitCancel(
  args: Readonly<{ owner: string; venue: LimitVenue; order: string }>,
  deps: Readonly<{ connection?: Connection }> = {},
): Promise<Readonly<{ ok: true; transactionBase64: string; requestId: string | null }> | LimitReviewFailure> {
  if (args.venue === "trigger") {
    const built = await buildTriggerCancel({ owner: args.owner, order: args.order });
    return built.ok ? { ok: true, transactionBase64: built.transactionBase64, requestId: built.requestId } : { ok: false, status: 422, code: built.code, reason: built.reason };
  }
  const built = await buildDlmmCancel({ owner: args.owner, limitOrder: args.order }, deps);
  return built.ok ? { ok: true, transactionBase64: built.transactionBase64, requestId: null } : { ok: false, status: 422, code: built.code, reason: built.reason };
}
