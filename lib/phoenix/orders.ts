/**
 * Orders on Phoenix's perpetuals from the person's own Solana wallet (B6b, decision 64; spec §4.2–§4.3; the collateral
 * model of B6 — `collateral.ts`): open or add to a position with a market or a limit order, set its take profit and
 * stop loss, cut it, close it, cancel a resting order — each a transaction the wallet itself signs. The trader account
 * is the wallet's PDA 0, cross-margin subaccount 0, the one phoenix.trade opens for the same wallet (B7a §7).
 *
 * Pure: the gate, the request, the plan of instructions an order is, the exact bytes each one must carry, what a built
 * transaction may call, and the ticket that seals what a Review showed. The chain and Phoenix's API are
 * `orders.server.ts`; the Review and the relay are `orders-actions.ts`.
 *
 * Every instruction's data is compared byte for byte with what the plan encodes through Phoenix's own SDK codecs: the
 * side, the size in lots, the price in ticks, the flags (reduce-only for a cut or a close), the triggers. A built
 * transaction that carries anything else — another market, another trader account, another signer, a step the plan
 * does not name, a builder other than Ryntra's or a fee override — is refused before a Review shows it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  buildTakeProfitStopLossTriggerOrders,
  DISCRIMINANTS,
  flight,
  getCancelAllEncoder,
  getCancelConditionalOrderEncoder,
  getCancelOrdersByIdEncoder,
  getCreateConditionalOrdersAccountEncoder,
  getPlaceLimitOrderEncoder,
  getPlaceMarketOrderEncoder,
  getPlacePositionConditionalOrderEncoder,
  getPlacePostOnlyOrderEncoder,
  OrderFlags,
  SelfTradeBehavior,
  Side,
  type ImmediateOrCancelOrderPacket,
  type LimitOrderPacket,
  type PostOnlyOrderPacket,
  type TriggerOrderParams,
} from "@ellipsis-labs/rise";
import { PublicKey, Transaction } from "@solana/web3.js";

import { LIGHTHOUSE_PROGRAM } from "../solana/limits/model.ts";
import { legacyView, type TxView } from "../solana/v1-tx.ts";

import { PHOENIX_PROGRAM, traderAccountOf } from "./collateral.ts";
import { DEFAULT_PERP_SLIPPAGE_BPS, MAX_PERP_SLIPPAGE_BPS, MIN_PERP_SLIPPAGE_BPS, STOP_SLIPPAGE_BPS, tifAllowed, tifOf, tifMakerOnly, tifTakesPart, type PerpOrderKind, type PerpOrderType, type PerpSide, type PerpTif } from "./orders-model.ts";

export * from "./orders-model.ts";

/* ------------------------------------------------------------- addresses */

/** Phoenix's log authority and global configuration (SDK `core/constants.ts`): the first accounts of every instruction. */
export const PHOENIX_LOG_AUTHORITY = "GdxfTLSsdSY37G6fZoYtdGDSfgFnbT2EmRpuePZxWShS";
export const PHOENIX_GLOBAL_CONFIG = "2zskx2iyCvb6Stg7RBZkt1f6MrF4dpYtMG3yMvKwqtUZ";
/** Flight, Phoenix's builder-code proxy (B7a §5): an order through it pays the builder's fee on its taker part. */
export const FLIGHT_PROGRAM = "F1ightu9cujFYo34k9CabifLrJT8qzfDVM2Q7BqhJn2W";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const COMPUTE_BUDGET = "ComputeBudget111111111111111111111111111111";

/** The account that holds a trader's TP/SL (SDK `getPhoenixConditionalOrdersAddress`): PDA `["conditional_orders", trader]`. */
export function conditionalOrdersOf(trader: string): string {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from("conditional_orders"), new PublicKey(trader).toBuffer()], new PublicKey(PHOENIX_PROGRAM));
  return pda.toBase58();
}

/** Flight's global state and a builder's state (SDK `flight/pdas.ts`). */
export function flightGlobalState(): string {
  const [pda] = PublicKey.findProgramAddressSync([new PublicKey(PHOENIX_PROGRAM).toBuffer(), Buffer.from("global_state")], new PublicKey(FLIGHT_PROGRAM));
  return pda.toBase58();
}

export function flightBuilderState(builder: string): string {
  const [pda] = PublicKey.findProgramAddressSync([new PublicKey(PHOENIX_PROGRAM).toBuffer(), new PublicKey(builder).toBuffer(), Buffer.from("builder_state")], new PublicKey(FLIGHT_PROGRAM));
  return pda.toBase58();
}

/* ------------------------------------------------------------------ gate */

/**
 * Who may place orders today, set at runtime like the collateral's gate: `CLOSED` (the default, and any other value)
 * — no screen offers an order and no route builds one; `CANARY` — the one wallet named in `RYNTRA_PHOENIX_CANARY_WALLET`,
 * a new position or an addition of at most `CANARY_MAX_NOTIONAL_USD` of notional: the operator's first live trade;
 * `OPEN` — everyone. A cut, a close, TP/SL and a cancel take risk away and carry no ceiling. The gate is asked at the
 * Review and again at the relay.
 */
export const PHOENIX_ORDERS_ENV = "RYNTRA_PHOENIX_ORDERS";
export const PHOENIX_CANARY_WALLET_ENV = "RYNTRA_PHOENIX_CANARY_WALLET";
export const CANARY_MAX_NOTIONAL_USD = 20;
/**
 * Ryntra's builder on Phoenix's Flight — its public address, never a key. Unset (the default): orders go to Phoenix
 * directly and carry no fee of Ryntra's. Set once the operator has registered the builder; the fee is the builder's registered rate as the chain holds it, read at every Review.
 */
export const PHOENIX_BUILDER_ENV = "RYNTRA_PHOENIX_BUILDER";

export type Env = Readonly<Record<string, string | undefined>>;
export type OrdersAdmission = Readonly<{ ok: true; mode: "CANARY" | "OPEN"; maxNotionalUsd: number | null }> | Readonly<{ ok: false; code: "ORDERS_CLOSED" }>;

export function admitOrders(owner: string | null, env: Env): OrdersAdmission {
  const mode = env[PHOENIX_ORDERS_ENV]?.trim().toUpperCase();
  if (mode === "OPEN") return { ok: true, mode, maxNotionalUsd: null };
  if (mode === "CANARY") {
    const wallet = env[PHOENIX_CANARY_WALLET_ENV]?.trim();
    if (wallet && owner !== null && owner === wallet) return { ok: true, mode, maxNotionalUsd: CANARY_MAX_NOTIONAL_USD };
  }
  return { ok: false, code: "ORDERS_CLOSED" };
}

/** The builder the orders route through, when one is set and is a key; null — straight to Phoenix. */
export function builderOf(env: Env): string | null {
  const value = env[PHOENIX_BUILDER_ENV]?.trim();
  if (!value || !WALLET.test(value)) return null;
  try {
    return new PublicKey(value).toBase58();
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------- request */

const WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SYMBOL = /^[A-Za-z0-9]{1,20}$/;
/* Up to a u64's 20 digits: a bid's sequence on Phoenix sits near the top of a u64, 20 digits long (request 72). */
const DIGITS = /^\d{1,20}$/;
const MAX_U64 = 18_446_744_073_709_551_615n;

type Base = Readonly<{ owner: string; symbol: string; format?: "v1" }>;
export type OrderRequest =
  | (Base & Readonly<{ kind: "open"; side: PerpSide; type: PerpOrderType; tif: PerpTif; sizeLots: bigint; priceTicks: bigint | null; slippageBps: number; tpTicks: bigint | null; slTicks: bigint | null }>)
  | (Base & Readonly<{ kind: "reduce"; sizeLots: bigint; close: boolean; slippageBps: number }>)
  | (Base & Readonly<{ kind: "protect"; tpTicks: bigint | null; slTicks: bigint | null }>)
  | (Base & Readonly<{ kind: "cancel"; orderSequenceNumber: bigint }>)
  | (Base & Readonly<{ kind: "cancelAll" }>)
  | (Base & Readonly<{ kind: "cancelConditional"; index: number }>);

const digits = (value: unknown): bigint | null => (typeof value === "string" && DIGITS.test(value) && BigInt(value) > 0n && BigInt(value) <= MAX_U64 ? BigInt(value) : null);
const optionalTicks = (value: unknown): bigint | null | undefined => (value === undefined || value === null || value === "" ? null : (digits(value) ?? undefined));
const slippage = (value: unknown): number | null => (value === undefined ? DEFAULT_PERP_SLIPPAGE_BPS : typeof value === "number" && Number.isInteger(value) && value >= MIN_PERP_SLIPPAGE_BPS && value <= MAX_PERP_SLIPPAGE_BPS ? value : null);

/** The browser's body, field by field; anything else is refused before Phoenix or the chain is asked. */
export function parseOrderRequest(body: unknown): OrderRequest | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const { kind, owner, symbol, format } = raw;
  if (typeof owner !== "string" || !WALLET.test(owner)) return null;
  try {
    new PublicKey(owner);
  } catch {
    return null;
  }
  if (typeof symbol !== "string" || !SYMBOL.test(symbol)) return null;
  if (format !== undefined && format !== "legacy" && format !== "v1") return null;
  const base: Base = format === "v1" ? { owner, symbol, format } : { owner, symbol };
  if (kind === "open") {
    const side = raw.side;
    const type = raw.type;
    if (side !== "long" && side !== "short") return null;
    if (type !== "market" && type !== "limit") return null;
    /* The time in force is the SDK's packet: absent keeps today's — a market order all-or-nothing, a limit resting. */
    if (raw.tif !== undefined && !tifAllowed(type, raw.tif)) return null;
    const tif = tifOf(type, raw.tif as PerpTif | undefined);
    const sizeLots = digits(raw.size);
    if (sizeLots === null) return null;
    const priceTicks = type === "limit" ? digits(raw.price) : null;
    if (type === "limit" && priceTicks === null) return null;
    if (type === "market" && raw.price !== undefined) return null;
    const slippageBps = type === "market" ? slippage(raw.slippageBps) : null;
    if (type === "market" && slippageBps === null) return null;
    const tpTicks = optionalTicks(raw.tp);
    const slTicks = optionalTicks(raw.sl);
    if (tpTicks === undefined || slTicks === undefined) return null;
    /* A limit rests: its TP/SL waits for the fill and is set on the position after it, never sent with it. */
    if (type === "limit" && (tpTicks !== null || slTicks !== null)) return null;
    return { ...base, kind, side, type, tif, sizeLots, priceTicks, slippageBps: slippageBps ?? 0, tpTicks, slTicks };
  }
  if (kind === "reduce") {
    const close = raw.close === true;
    const sizeLots = digits(raw.size);
    if (sizeLots === null) return null;
    const slippageBps = slippage(raw.slippageBps);
    if (slippageBps === null) return null;
    return { ...base, kind, sizeLots, close, slippageBps };
  }
  if (kind === "protect") {
    const tpTicks = optionalTicks(raw.tp);
    const slTicks = optionalTicks(raw.sl);
    if (tpTicks === undefined || slTicks === undefined) return null;
    return { ...base, kind, tpTicks, slTicks };
  }
  if (kind === "cancel") {
    const order = digits(raw.order);
    if (order === null) return null;
    return { ...base, kind, orderSequenceNumber: order };
  }
  if (kind === "cancelAll") return { ...base, kind };
  if (kind === "cancelConditional") {
    /* Phoenix's conditional orders live at 1 … 191 in the trader's own TP/SL account. */
    const index = typeof raw.index === "number" && Number.isInteger(raw.index) && raw.index >= 1 && raw.index <= 191 ? raw.index : null;
    if (index === null) return null;
    return { ...base, kind, index };
  }
  return null;
}

/* ------------------------------------------------------------------ plan */

/** One Phoenix instruction an order is made of, with exactly what it carries. */
export type PlanStep =
  | Readonly<{ ix: "market"; packet: ImmediateOrCancelOrderPacket }>
  | Readonly<{ ix: "limit"; packet: LimitOrderPacket }>
  | Readonly<{ ix: "postOnly"; packet: PostOnlyOrderPacket }>
  | Readonly<{ ix: "cancelOrders"; orders: readonly Readonly<{ orderSequenceNumber: bigint; priceInTicks: bigint }>[] }>
  | Readonly<{ ix: "cancelAll" }>
  | Readonly<{ ix: "createConditional"; capacity: number }>
  | Readonly<{ ix: "cancelConditional"; index: number }>
  | Readonly<{ ix: "positionConditional"; assetId: number; greater: TriggerOrderParams | null; less: TriggerOrderParams | null }>;

/** The TP/SL account's room when Ryntra opens it: the SDK's own default. */
export const CONDITIONAL_CAPACITY = 32;

const sideOf = (side: PerpSide, closing: boolean): Side => ((side === "long") !== closing ? Side.Bid : Side.Ask);

/**
 * An immediate-or-cancel order within its price (SDK `buildMarketOrderPacketFromMarketParams`). Its least fill is what
 * tells the two apart: all of its size (`fok` — all at once or nothing, which is what every market order of Ryntra has
 * been) or one lot (`ioc` — whatever the book gives now, the rest cancelled).
 */
export function marketPacket(side: Side, sizeLots: bigint, priceTicks: bigint, reduceOnly: boolean, partial = false): ImmediateOrCancelOrderPacket {
  return {
    side,
    priceInTicks: priceTicks as never,
    numBaseLots: sizeLots as never,
    numQuoteLots: null,
    minBaseLotsToFill: (partial ? 1n : sizeLots) as never,
    minQuoteLotsToFill: 1n as never,
    selfTradeBehavior: SelfTradeBehavior.Abort,
    matchLimit: null,
    clientOrderId: 0n,
    lastValidSlot: null,
    orderFlags: reduceOnly ? OrderFlags.ReduceOnly : OrderFlags.None,
    cancelExisting: false,
  };
}

/** A limit order that rests at its price for what it does not fill (SDK `buildLimitOrderPacketFromMarketParams`). */
export function limitPacket(side: Side, sizeLots: bigint, priceTicks: bigint): LimitOrderPacket {
  return {
    side,
    priceInTicks: priceTicks as never,
    numBaseLots: sizeLots as never,
    selfTradeBehavior: SelfTradeBehavior.CancelProvide,
    matchLimit: null,
    clientOrderId: 0n,
    lastValidSlot: null,
    orderFlags: OrderFlags.None,
    cancelExisting: false,
  };
}

/**
 * A post-only order (SDK's `PostOnly` packet): it is placed in the book and never matches what stands there. `slide`
 * stays false, so an order that would cross is refused by Phoenix's program rather than quietly moved to another
 * price — the Review refuses it before that, from the book it read.
 */
export function postOnlyPacket(side: Side, sizeLots: bigint, priceTicks: bigint): PostOnlyOrderPacket {
  return {
    side,
    priceInTicks: priceTicks as never,
    numBaseLots: sizeLots as never,
    clientOrderId: 0n,
    slide: false,
    lastValidSlot: null,
    orderFlags: OrderFlags.None,
    cancelExisting: false,
  };
}

/** A position's TP and SL as Phoenix's triggers (SDK `buildTakeProfitStopLossTriggerOrders`): TP rests as a limit, SL fires a market order. */
export function legsOf(side: PerpSide, tpTicks: bigint | null, slTicks: bigint | null): Readonly<{ greater: TriggerOrderParams | null; less: TriggerOrderParams | null }> {
  const legs = buildTakeProfitStopLossTriggerOrders({ primarySide: side === "long" ? Side.Bid : Side.Ask, takeProfitPrice: tpTicks as never, stopLossPrice: slTicks as never, slippageBps: STOP_SLIPPAGE_BPS });
  return { greater: legs.greaterTriggerOrder, less: legs.lessTriggerOrder };
}

/** The wallet's position on one market at subaccount 0, and its TP/SL, as Phoenix's trader state holds them. */
export type PositionFacts = Readonly<{ lots: bigint; conditionalIndexes: readonly number[] }>;
export type RestingFacts = Readonly<{ orderSequenceNumber: bigint; priceTicks: bigint; side: "buy" | "sell"; sizeLots: bigint | null }>;
/**
 * One conditional order of a position as Phoenix holds it: its index in the trader's TP/SL account and the triggers it
 * carries. Ryntra places a take profit and a stop loss as **one** conditional order with two triggers
 * (`buildTakeProfitStopLossTriggerOrders`), so one index commonly carries both legs — and Phoenix's own cancel takes
 * the whole conditional order, both triggers with it. `legs` says which are there, so nothing on screen promises that
 * the other one stays.
 */
export type ConditionalFacts = Readonly<{ index: number; legs: readonly ("tp" | "sl")[]; tpTicks: bigint | null; slTicks: bigint | null }>;

export type PlanInput = Readonly<{
  request: OrderRequest;
  assetId: number;
  /** The market order's worst price, ticks: the mark moved by the tolerance against the order (`worstPriceUsd`). */
  worstTicks: bigint | null;
  position: PositionFacts | null;
  order: RestingFacts | null;
  /**
   * Every order of this wallet resting in this market's book — the plain ones and the ones a TP/SL placed — for
   * «cancel all», which is what Phoenix's own `CancelAll` removes.
   */
  resting?: readonly RestingFacts[];
  /** The position's conditional orders, for the cancel of one of them. */
  conditionals?: readonly ConditionalFacts[];
  conditionalAccount: boolean;
}>;

export type PlanResult = Readonly<{ ok: true; steps: readonly PlanStep[]; side: PerpSide; sizeLots: bigint; clearsLegs: boolean }> | Readonly<{ ok: false; code: string; reason: string }>;

const refuse = (code: string, reason: string): PlanResult => ({ ok: false, code, reason });

/** The steps of TP/SL: lift the position's own first, open the account that holds them if it is not there, then set them. */
function legSteps(input: PlanInput, side: PerpSide, tpTicks: bigint | null, slTicks: bigint | null): PlanStep[] {
  const steps: PlanStep[] = [];
  for (const index of input.position?.conditionalIndexes ?? []) steps.push({ ix: "cancelConditional", index });
  if (tpTicks === null && slTicks === null) return steps;
  if (!input.conditionalAccount) steps.push({ ix: "createConditional", capacity: CONDITIONAL_CAPACITY });
  const legs = legsOf(side, tpTicks, slTicks);
  steps.push({ ix: "positionConditional", assetId: input.assetId, greater: legs.greater, less: legs.less });
  return steps;
}

/**
 * The instructions an order is, from the request and Phoenix's own facts read at the Review — never the browser's: the
 * position's size for a close, the resting order's price for a cancel, the TP/SL indexes to lift.
 */
export function planOrder(input: PlanInput): PlanResult {
  const { request, position } = input;
  const held = position?.lots ?? 0n;
  const heldSide: PerpSide | null = held > 0n ? "long" : held < 0n ? "short" : null;
  const heldLots = held < 0n ? -held : held;
  if (request.kind === "open") {
    const side = request.side;
    if (request.type === "market") {
      if (input.worstTicks === null) return refuse("PRICE_UNKNOWN", "Phoenix's mark price did not arrive.");
      const steps: PlanStep[] = [{ ix: "market", packet: marketPacket(sideOf(side, false), request.sizeLots, input.worstTicks, false, tifTakesPart(request.tif)) }];
      /* TP/SL with a market order covers the whole position after it: the position's side must be the order's. */
      const legs = request.tpTicks !== null || request.slTicks !== null;
      if (legs && heldSide !== null && heldSide !== side && heldLots >= request.sizeLots) return refuse("LEGS_SIDE", "This order cuts the position: set TP/SL on the position itself.");
      return { ok: true, steps: legs ? [...steps, ...legSteps(input, side, request.tpTicks, request.slTicks)] : steps, side, sizeLots: request.sizeLots, clearsLegs: legs && (position?.conditionalIndexes.length ?? 0) > 0 };
    }
    const packetSide = sideOf(side, false);
    const step: PlanStep = tifMakerOnly(request.tif)
      ? { ix: "postOnly", packet: postOnlyPacket(packetSide, request.sizeLots, request.priceTicks!) }
      : { ix: "limit", packet: limitPacket(packetSide, request.sizeLots, request.priceTicks!) };
    return { ok: true, steps: [step], side, sizeLots: request.sizeLots, clearsLegs: false };
  }
  if (request.kind === "reduce") {
    if (heldSide === null) return refuse("NO_POSITION", "There is no position on this market to cut.");
    if (input.worstTicks === null) return refuse("PRICE_UNKNOWN", "Phoenix's mark price did not arrive.");
    /* A close takes the position's own size as Phoenix holds it now, whatever the browser saw. */
    const size = request.close ? heldLots : request.sizeLots;
    if (size > heldLots) return refuse("OVER_POSITION", "More than the position holds.");
    const steps: PlanStep[] = [{ ix: "market", packet: marketPacket(sideOf(heldSide, true), size, input.worstTicks, true) }];
    /* A closed position's TP/SL has nothing left to guard: lifted in the same transaction. */
    const clears = request.close && (position?.conditionalIndexes.length ?? 0) > 0;
    if (clears) for (const index of position!.conditionalIndexes) steps.push({ ix: "cancelConditional", index });
    return { ok: true, steps, side: heldSide, sizeLots: size, clearsLegs: clears };
  }
  if (request.kind === "protect") {
    if (heldSide === null) return refuse("NO_POSITION", "There is no position on this market to protect.");
    const steps = legSteps(input, heldSide, request.tpTicks, request.slTicks);
    if (steps.length === 0) return refuse("NOTHING_TO_CHANGE", "The position has no TP/SL to lift and none was set.");
    return { ok: true, steps, side: heldSide, sizeLots: 0n, clearsLegs: (position?.conditionalIndexes.length ?? 0) > 0 };
  }
  if (request.kind === "cancelAll") {
    /* One instruction takes every order of this wallet resting in this market's book; with none there is nothing to sign. */
    if ((input.resting ?? []).length === 0) return refuse("NO_ORDERS", "Phoenix holds no resting order of this wallet on this market.");
    return { ok: true, steps: [{ ix: "cancelAll" }], side: heldSide ?? "long", sizeLots: 0n, clearsLegs: false };
  }
  if (request.kind === "cancelConditional") {
    const leg = (input.conditionals ?? []).find((entry) => entry.index === request.index);
    if (!leg) return refuse("NO_CONDITIONAL", "Phoenix holds no such conditional order of this position.");
    return { ok: true, steps: [{ ix: "cancelConditional", index: leg.index }], side: heldSide ?? "long", sizeLots: 0n, clearsLegs: true };
  }
  const order = input.order;
  if (!order || order.orderSequenceNumber !== request.orderSequenceNumber) return refuse("NO_ORDER", "Phoenix holds no such resting order of this wallet.");
  return { ok: true, steps: [{ ix: "cancelOrders", orders: [{ orderSequenceNumber: order.orderSequenceNumber, priceInTicks: order.priceTicks }] }], side: order.side === "buy" ? "long" : "short", sizeLots: 0n, clearsLegs: false };
}

/** The exact bytes a step's instruction carries, by Phoenix's own SDK codecs. */
export function stepData(step: PlanStep): Uint8Array {
  switch (step.ix) {
    case "market":
      return Uint8Array.from(getPlaceMarketOrderEncoder().encode(step.packet));
    case "limit":
      return Uint8Array.from(getPlaceLimitOrderEncoder().encode(step.packet));
    case "postOnly":
      return Uint8Array.from(getPlacePostOnlyOrderEncoder().encode(step.packet));
    case "cancelAll":
      return Uint8Array.from(getCancelAllEncoder().encode(undefined));
    case "cancelOrders":
      return Uint8Array.from(getCancelOrdersByIdEncoder().encode({ orderIds: step.orders.map((order) => ({ nodePointer: null, orderId: { priceInTicks: order.priceInTicks as never, orderSequenceNumber: order.orderSequenceNumber } })) }));
    case "createConditional":
      return Uint8Array.from(getCreateConditionalOrdersAccountEncoder().encode(step.capacity));
    case "cancelConditional":
      return Uint8Array.from(getCancelConditionalOrderEncoder().encode({ conditionalOrderIndex: step.index, disableFirst: true, disableSecond: true }));
    case "positionConditional":
      return Uint8Array.from(getPlacePositionConditionalOrderEncoder().encode({ assetId: step.assetId, greaterTriggerOrder: step.greater, lessTriggerOrder: step.less, sizeBaseLots: null, sizePercent: 100 }));
  }
}

/** Steps Flight routes when a builder is set (SDK `isFlightRoutableInstruction`); the rest stay Phoenix's own. */
export const routedThroughBuilder = (step: PlanStep): boolean => step.ix === "market" || step.ix === "limit" || step.ix === "postOnly" || step.ix === "positionConditional";

/* ------------------------------------------------- what a build may call */

const PROXY_TAG = Buffer.from(flight.FLIGHT_DISCRIMINANTS.PROXY_INSTRUCTION!);
const discriminant = (step: PlanStep): Uint8Array => {
  /* A post-only order is Phoenix's `PlaceLimitOrder` with the packet kind `PostOnly`: the same tag, another first byte
     of the packet — which the byte-for-byte check against `stepData` covers. */
  const key = { market: "PLACE_MARKET_ORDER", limit: "PLACE_LIMIT_ORDER", postOnly: "PLACE_LIMIT_ORDER", cancelOrders: "CANCEL_ORDERS_BY_ID", cancelAll: "CANCEL_ALL", createConditional: "CREATE_CONDITIONAL_ORDERS_ACCOUNT", cancelConditional: "CANCEL_CONDITIONAL_ORDER", positionConditional: "PLACE_POSITION_CONDITIONAL_ORDER" }[step.ix];
  return DISCRIMINANTS[key]!;
};

export type OrderExpectation = Readonly<{
  owner: string;
  steps: readonly PlanStep[];
  /** The market's book and spline accounts, from Phoenix's market list. */
  orderbook: string;
  spline: string;
  /** The builder the routed steps go through, or null. */
  builder: string | null;
}>;

export type BuiltCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; reason: string }>;
const no = (reason: string): BuiltCheck => ({ ok: false, reason });

type Key = Readonly<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;

/** One Phoenix instruction against its step: the bytes exactly, the wallet in its places, its own trader account, the market's accounts. */
function phoenixMatches(keys: readonly Key[], data: Uint8Array, step: PlanStep, expected: OrderExpectation): string | null {
  if (!Buffer.from(data).equals(Buffer.from(stepData(step)))) return `A Phoenix instruction does not carry the reviewed ${step.ix} exactly.`;
  const owner = expected.owner;
  const trader = traderAccountOf(owner);
  const at = (index: number) => keys[index]?.pubkey;
  if (at(0) !== PHOENIX_PROGRAM || at(1) !== PHOENIX_LOG_AUTHORITY || at(2) !== PHOENIX_GLOBAL_CONFIG) return "A Phoenix instruction does not start with Phoenix's own accounts.";
  const pubkeys = keys.map((key) => key.pubkey);
  const market = () => pubkeys.includes(expected.orderbook) && pubkeys.includes(expected.spline);
  const conditional = conditionalOrdersOf(trader);
  switch (step.ix) {
    case "market":
    case "limit":
    case "postOnly":
    case "cancelOrders":
    case "cancelAll":
      /* [3] the wallet signs, [4] its own trader account; the book and the spline of the reviewed market. */
      if (at(3) !== owner || !keys[3]!.isSigner || at(4) !== trader || !keys[4]!.isWritable || !market()) return "An order is not the wallet's own on the reviewed market.";
      /* The book and the spline close the list (SDK layout): nothing rides after them, through a proxy or not. */
      if (at(keys.length - 2) !== expected.orderbook || at(keys.length - 1) !== expected.spline) return "An order carries accounts after the market's own.";
      return null;
    case "createConditional":
      /* [3] the wallet pays, [4] it owns, [5] its trader account, [6] the TP/SL account of that trader, [7] the system program. */
      if (at(3) !== owner || at(4) !== owner || at(5) !== trader || at(6) !== conditional || at(7) !== SYSTEM_PROGRAM) return "The TP/SL account is not the wallet's own.";
      return null;
    case "cancelConditional":
      /* [3] the trader account, [4] the wallet signs, [5] the market's book, [6] the TP/SL account. */
      if (at(3) !== trader || at(4) !== owner || !keys[4]!.isSigner || at(5) !== expected.orderbook || at(6) !== conditional) return "A TP/SL cancel is not the wallet's own.";
      return null;
    case "positionConditional":
      /* [3] the wallet pays, [4] its trader account; the wallet signs and the TP/SL account is its trader's. */
      if (at(3) !== owner || at(4) !== trader || !market() || !pubkeys.includes(conditional) || at(keys.length - 1) !== SYSTEM_PROGRAM) return "A TP/SL is not the wallet's own on the reviewed market.";
      if (!keys.some((key) => key.pubkey === owner && key.isSigner)) return "A TP/SL is not signed by the wallet.";
      return null;
  }
}

/**
 * A built transaction before it is shown: paid for by the wallet, the wallet its one signer, and nothing in it but the
 * plan's steps in the plan's order — each Phoenix's own instruction for exactly the reviewed values, the routed ones
 * through Ryntra's builder (and only when one is set) without a fee override — and a compute budget the relay accepts.
 */
export function orderCallsOnly(built: Transaction | TxView, expected: OrderExpectation): BuiltCheck {
  const view = built instanceof Transaction ? legacyView(built) : built;
  const owner = expected.owner;
  if (view.payer !== owner) return no("The built transaction is paid by someone other than the wallet.");
  let next = 0;
  for (const instruction of view.instructions) {
    if (instruction.keys.some((key) => key.isSigner && key.pubkey !== owner)) return no(`An instruction of ${instruction.programId} names a signer other than the wallet.`);
    if (instruction.programId === COMPUTE_BUDGET) continue;
    const step = expected.steps[next];
    if (!step) return no(`The built transaction has an instruction of ${instruction.programId} beyond the order.`);
    const routed = expected.builder !== null && routedThroughBuilder(step);
    let keys: readonly Key[] = instruction.keys;
    let data: Uint8Array = instruction.data;
    if (routed) {
      /* Flight's proxy (SDK `buildProxyInstructionIx`): its six accounts, then Phoenix's; its tag, then Phoenix's bytes. */
      const builder = expected.builder!;
      if (instruction.programId !== FLIGHT_PROGRAM) return no(`The ${step.ix} does not route through Ryntra's builder.`);
      if (!Buffer.from(data.subarray(0, 8)).equals(PROXY_TAG)) return no("The builder's proxy is not the plain one (a fee override, or another call).");
      const head = keys.slice(0, 6).map((key) => key.pubkey);
      const flightAccounts = [flightGlobalState(), PHOENIX_PROGRAM, builder, traderAccountOf(builder), flightBuilderState(builder), owner];
      if (head.length !== 6 || head.some((key, index) => key !== flightAccounts[index])) return no("The builder's proxy names accounts other than Ryntra's builder and the wallet.");
      keys = keys.slice(6);
      data = data.subarray(8);
    } else if (instruction.programId !== PHOENIX_PROGRAM) {
      return no(`The built transaction has an instruction of ${instruction.programId} outside the order.`);
    }
    if (!Buffer.from(data.subarray(0, 8)).equals(Buffer.from(discriminant(step)))) return no(`The ${step.ix} is not where the plan has it.`);
    const mismatch = phoenixMatches(keys, data, step, expected);
    if (mismatch) return no(mismatch);
    next += 1;
  }
  if (next !== expected.steps.length) return no("The built transaction is missing a step of the order.");
  return { ok: true };
}

/** Lighthouse is a wallet's own assertion, never a step of the order: the digest leaves it out, as the collateral's. */
export { LIGHTHOUSE_PROGRAM };

/* ---------------------------------------------------------------- ticket */

/**
 * The seal between a Review and the relay, as the collateral's (`collateral.ts`) under its own purpose — a collateral
 * ticket is not an order's: the wallet, the order's kind and market, the notional it opens (for the canary's ceiling at
 * the relay) and the digest of what the transaction does.
 */
export const TICKET_KEY_ENV = "BETA_TOKEN_SECRET";
const PURPOSE = "phoenix.orders.v1";

export type OrderTicket = Readonly<{ v: 1; owner: string; kind: PerpOrderKind; symbol: string; notionalMicro: string; messages: readonly string[]; issuedAt: number; expiresAt: number }>;

function secretOf(env: Env): string | null {
  const value = env[TICKET_KEY_ENV];
  return value && value.length >= 16 ? value : null;
}

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(`${PURPOSE}.${payload}`).digest("base64url");

export const orderTicketKeyConfigured = (env: Env): boolean => secretOf(env) !== null;

export function issueOrderTicket(input: Omit<OrderTicket, "v" | "issuedAt" | "expiresAt">, env: Env, now: number, ttlMs: number): string | null {
  const secret = secretOf(env);
  if (!secret) return null;
  const ticket: OrderTicket = { v: 1, ...input, issuedAt: now, expiresAt: now + Math.max(0, ttlMs) };
  const payload = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return `${payload}.${mac(payload, secret)}`;
}

export type OrderTicketRead = Readonly<{ ok: true; ticket: OrderTicket }> | Readonly<{ ok: false; code: "TICKET_INVALID" | "TICKET_EXPIRED" }>;

const KINDS: ReadonlySet<string> = new Set(["open", "reduce", "protect", "cancel", "cancelAll", "cancelConditional"]);

export function readOrderTicket(value: unknown, env: Env, now = Date.now()): OrderTicketRead {
  const secret = secretOf(env);
  if (!secret || typeof value !== "string" || value.length > 4096) return { ok: false, code: "TICKET_INVALID" };
  const dot = value.lastIndexOf(".");
  if (dot < 1) return { ok: false, code: "TICKET_INVALID" };
  const payload = value.slice(0, dot);
  const given = Buffer.from(value.slice(dot + 1), "base64url");
  const expected = Buffer.from(mac(payload, secret), "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, code: "TICKET_INVALID" };
  let parsed: Partial<OrderTicket>;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<OrderTicket>;
  } catch {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (
    parsed.v !== 1 ||
    typeof parsed.owner !== "string" ||
    !WALLET.test(parsed.owner) ||
    typeof parsed.kind !== "string" ||
    !KINDS.has(parsed.kind) ||
    typeof parsed.symbol !== "string" ||
    !SYMBOL.test(parsed.symbol) ||
    typeof parsed.notionalMicro !== "string" ||
    !/^\d{1,24}$/.test(parsed.notionalMicro) ||
    !Array.isArray(parsed.messages) ||
    parsed.messages.length !== 1 ||
    !parsed.messages.every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)) ||
    typeof parsed.issuedAt !== "number" ||
    typeof parsed.expiresAt !== "number"
  ) {
    return { ok: false, code: "TICKET_INVALID" };
  }
  if (parsed.issuedAt > now + 60_000) return { ok: false, code: "TICKET_INVALID" };
  if (now > parsed.expiresAt) return { ok: false, code: "TICKET_EXPIRED" };
  return { ok: true, ticket: parsed as OrderTicket };
}

/** An order that adds risk: what the canary's ceiling and the account's `riskIncreasingTrade` speak to. */
export const addsRisk = (kind: PerpOrderKind): boolean => kind === "open";
