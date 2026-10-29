/**
 * The order actions of «Ф'ючерси» (B6b): a Review that checks the wallet may act, plans the order from Phoenix's own
 * facts, builds it with Phoenix's SDK, checks every instruction against the plan, simulates it on the chain as it stands
 * and seals the bytes in a ticket; and a relay that sends the wallet's signed bytes — those and no others — once, and
 * reads what they filled. The collateral's flow (`collateral-actions.ts`) for an order.
 *
 * What a Review shows comes from the chain, not from a formula: the same simulation, with Phoenix's own view program
 * (Hawkeye, SDK `hawkeye.ts`) read after the order's instructions, gives the account's margin, the position, the price
 * at which Phoenix liquidates it and the funding rate as the program itself counts them — once without the order (the
 * «before») and once after it. A market order that the book would not fill in full within its tolerance is refused
 * here, not on the chain. The person's wallet signs; the server holds no key at all.
 */

import { decodeHawkeyeReturnData, type HawkeyeAssetReturn, type HawkeyeFundingReturn, type HawkeyeLiquidationPriceReturn, type HawkeyeMarginReturn } from "@ellipsis-labs/rise";
import { ComputeBudgetProgram, PublicKey, Transaction, type Connection, type TransactionInstruction } from "@solana/web3.js";

import { networkFeeOf, redacted, signatureStates } from "../liquidity/studio/actions.ts";
import { BLOCKHASH_LIFE_BLOCKS, BLOCKHASH_LIFE_MS, BLOCKHASH_SUBMIT_MARGIN_MS, readBlockhashLife, signableWindowMs, web3ChainReader, type ChainReader } from "../solana/blockhash-life.ts";
import { buildV1Wire, setLoadedAccountsDataSizeLimit, viewOfWire, type TxView, type V1Limits } from "../solana/v1-tx.ts";

import { loadedDataLimit, PRIORITY_MICRO_LAMPORTS } from "./collateral-actions.ts";
import { checkSigned, collateralDigest, traderAccountOf, web3Instruction, type KitInstruction } from "./collateral.ts";
import {
  addsRisk,
  admitOrders,
  bestPriceOf,
  bookFill,
  builderFeeUsd,
  builderOf,
  conditionalOrdersOf,
  fundingOf,
  issueOrderTicket,
  legsSideOk,
  leverageOf,
  MAX_PERP_SLIPPAGE_BPS,
  MIN_ORDER_NOTIONAL_USD,
  notionalMicroOf,
  orderCallsOnly,
  orderTicketKeyConfigured,
  parseOrderRequest,
  perpFeeUsd,
  planOrder,
  priceImpactPercent,
  readOrderTicket,
  ticksFromUsd,
  tifMakerOnly,
  tifTakesPart,
  unitsTextFromLots,
  usdFromTicks,
  worstPriceUsd,
  type BookLevels,
  type ConditionalFacts,
  type Env,
  type OrderRelay,
  type OrderRequest,
  type OrderReview,
  type PerpAfter,
  type PerpFill,
  type PerpSide,
  type PerpUnits,
  type PlanStep,
  type PositionFacts,
  type RestingFacts,
} from "./orders.ts";

export type ActionFailure = Readonly<{ ok: false; status: number; code: string; reason: string }>;
const failure = (status: number, code: string, reason: string): ActionFailure => ({ ok: false, status, code, reason });

/** One market as Phoenix's market list and stats give it: what an order needs to be built and shown. */
export type MarketFacts = Readonly<{
  symbol: string;
  assetId: number;
  units: PerpUnits;
  orderbook: string;
  spline: string;
  /** Fractions of the notional: 0.00035 is 3.5 bps. */
  takerRate: number | null;
  makerRate: number | null;
  markUsd: number | null;
  indexUsd: number | null;
  status: "active" | "gated";
  isolatedOnly: boolean;
  fundingIntervalSeconds: number | null;
}>;

/** The wallet's trader account as Phoenix's trader state reads it, on one market, subaccount 0. */
export type TraderFacts =
  | Readonly<{ found: false }>
  | Readonly<{
      found: true;
      /** Phoenix lets the account take more risk now (`riskIncreasingTrade.immediate`), and take risk away (`riskReducingTrade`). */
      canAddRisk: boolean;
      canReduceRisk: boolean;
      position: PositionFacts | null;
      orders: readonly RestingFacts[];
      /** Every order resting in this market's book, the ones a TP/SL placed among them (PERP-5): «cancel all»'s scope. */
      resting?: readonly RestingFacts[];
      /** The position's conditional orders (PERP-5): what a cancel of one of them names. */
      conditionals?: readonly ConditionalFacts[];
    }>;

export type HawkeyeViews = Readonly<{ margin: KitInstruction; asset: KitInstruction; liquidation: KitInstruction; funding: KitInstruction }>;

export type OrderDeps = Readonly<{
  env: Env;
  /** The endpoints in the order they are tried; the relay sends through the first. */
  connections: readonly Connection[];
  readMarket: (symbol: string) => Promise<MarketFacts | null>;
  readTrader: (owner: string, symbol: string) => Promise<TraderFacts | null>;
  /**
   * Phoenix's book of one market, uncut by the execution band: the Review's price impact and the refusal of a
   * post-only order that would cross. A book that does not answer leaves the impact unknown, never made up.
   */
  readBook: (symbol: string) => Promise<BookLevels | null>;
  /** Phoenix's SDK: one instruction per step, the routed ones through the builder when one is given. */
  build: (owner: string, symbol: string, steps: readonly PlanStep[], builder: string | null) => Promise<readonly KitInstruction[]>;
  /** Phoenix's view program's instructions for this wallet on this market (SDK `buildHawkeyeView*`). */
  views: (owner: string, symbol: string) => Promise<HawkeyeViews>;
  /** The builder's registered fee in bps as the chain holds it; null when it is not active or not readable. */
  builderBps: (builder: string, connection: Connection) => Promise<number | null>;
  /** Phoenix's record of what a landed signature filled; null when Phoenix did not answer. */
  readFills: (owner: string, signature: string) => Promise<readonly PerpFill[] | null>;
  now?: () => number;
  relayMs?: number;
  callMs?: number;
  pollMs?: number;
  chainReader?: (connection: Connection) => ChainReader;
}>;

const UNIT_ROOM = 1.2;
const MAX_UNITS = 1_400_000;
const LOADED_MAX = 64 * 1024 * 1024;
const CALL_MS = 8_000;
const RELAY_MS = 40_000;
function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), Math.max(1, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

class Refusal extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function onFirstAnswering<T>(connections: readonly Connection[], run: (connection: Connection) => Promise<T>): Promise<Readonly<{ value: T; connection: Connection }>> {
  let last: unknown = new Error("No Solana endpoint is configured.");
  for (const connection of connections) {
    try {
      return { value: await run(connection), connection };
    } catch (error) {
      if (error instanceof Refusal) throw error;
      last = error;
    }
  }
  throw last;
}

/* ------------------------------------------------------------ simulation */

type RpcRequest = (method: string, args: unknown[]) => Promise<{ result?: { value?: Record<string, unknown> } & Record<string, unknown>; error?: { message?: string } }>;
type Simulated = Readonly<{ err: unknown; logs: readonly string[] | null; unitsConsumed: number | null; loadedAccountsDataSize: number | null; returnData: Buffer | null; lamports: readonly (bigint | null)[] }>;

/**
 * A simulation of base64 wire bytes through the endpoint's own JSON-RPC (web3.js 1.98 cannot carry v1, the endpoint
 * can), with the program's return data — Hawkeye's answer — and the lamports the named accounts hold after it.
 */
async function simulateWire(connection: Connection, wireBase64: string, watched: readonly string[] = [], replaceBlockhash = false): Promise<Simulated> {
  const request = (connection as unknown as { _rpcRequest: RpcRequest })._rpcRequest;
  const answer = await request.call(connection, "simulateTransaction", [
    wireBase64,
    { encoding: "base64", sigVerify: false, commitment: "confirmed", ...(replaceBlockhash ? { replaceRecentBlockhash: true } : {}), ...(watched.length ? { accounts: { addresses: watched, encoding: "base64" } } : {}) },
  ]);
  if (answer.error || !answer.result?.value) throw new Error(`simulateTransaction: ${answer.error?.message ?? "no answer"}`);
  const value = answer.result.value;
  const returned = value.returnData as { data?: [string, string] } | null | undefined;
  const accounts = (value.accounts as (Readonly<{ lamports?: number }> | null)[] | undefined) ?? [];
  return {
    err: value.err ?? null,
    logs: (value.logs as string[] | null | undefined) ?? null,
    unitsConsumed: typeof value.unitsConsumed === "number" ? value.unitsConsumed : null,
    loadedAccountsDataSize: typeof value.loadedAccountsDataSize === "number" ? value.loadedAccountsDataSize : null,
    returnData: returned?.data?.[0] ? Buffer.from(returned.data[0], "base64") : null,
    lamports: watched.map((_, index) => (typeof accounts[index]?.lamports === "number" ? BigInt(accounts[index]!.lamports!) : null)),
  };
}

const legacyWire = (owner: string, blockhash: string, lastValidBlockHeight: number, instructions: readonly TransactionInstruction[]) =>
  new Transaction({ feePayer: new PublicKey(owner), blockhash, lastValidBlockHeight }).add(...instructions).serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");

/** Hawkeye's answer to one view, run after `before` (the order's instructions, or none); null when it did not answer. */
async function viewAfter(connection: Connection, owner: string, blockhash: string, before: readonly TransactionInstruction[], view: KitInstruction): Promise<ReturnType<typeof decodeHawkeyeReturnData> | null> {
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_UNITS }), ...before, web3Instruction(view)];
  const simulated = await within(simulateWire(connection, legacyWire(owner, blockhash, 0, instructions), [], true), CALL_MS);
  if (simulated.err || !simulated.returnData) return null;
  try {
    return decodeHawkeyeReturnData(Uint8Array.from(simulated.returnData));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- Hawkeye → page */

const QUOTE = 1_000_000;

/** The position's signed size in the asset, from Hawkeye's lots. */
const positionUnitsOf = (asset: HawkeyeAssetReturn | null, units: PerpUnits): string => (asset ? unitsTextFromLots(asset.baseLots, units.baseLotsDecimals) : "0");

/**
 * The account after an order, from Phoenix's view program: the margin's collateral and value, the position on this
 * market and where Phoenix liquidates it. `before` is the same views without the order, for what the order changes.
 */
export function afterFromHawkeye(
  views: Readonly<{ margin: HawkeyeMarginReturn | null; asset: HawkeyeAssetReturn | null; liquidation: HawkeyeLiquidationPriceReturn | null }>,
  before: HawkeyeMarginReturn | null,
  units: PerpUnits,
): PerpAfter {
  const { margin, asset, liquidation } = views;
  const collateral = margin ? Number(margin.collateralQuoteLots) / QUOTE : null;
  const value = margin ? Number(margin.effectiveCollateralQuoteLots) / QUOTE : null;
  const positionValue = asset ? Number(asset.positionValueQuoteLots) / QUOTE : null;
  const found = liquidation?.status.label === "found" && liquidation.liquidationPriceTicks > 0n;
  const flat = !asset || asset.baseLots === 0n;
  return {
    positionUnits: positionUnitsOf(asset, units),
    entryUsd: asset && !flat && asset.entryPriceQuoteLotsPerBaseLot > 0n ? (Number(asset.entryPriceQuoteLotsPerBaseLot) / QUOTE) * 10 ** units.baseLotsDecimals : null,
    positionValueUsd: flat ? 0 : positionValue,
    liquidationUsd: found ? usdFromTicks(liquidation!.liquidationPriceTicks, units) : null,
    liquidationStatus: liquidation?.status.label ?? "unknown",
    leverage: flat ? null : leverageOf(positionValue, value),
    collateralUsd: collateral,
    accountValueUsd: value,
    collateralChangeUsd: collateral !== null && before ? collateral - Number(before.collateralQuoteLots) / QUOTE : null,
    freeCollateralUsd: margin ? Number(margin.freeCollateralQuoteLots) / QUOTE : null,
    initialMarginUsd: margin ? Number(margin.initialMarginQuoteLots) / QUOTE : null,
    riskTier: margin && margin.riskTier.label !== "unknown" ? margin.riskTier.label : null,
  };
}

const asMargin = (value: unknown): HawkeyeMarginReturn | null => ((value as { kind?: string } | null)?.kind === "view_margin" ? (value as HawkeyeMarginReturn) : null);
const asAsset = (value: unknown): HawkeyeAssetReturn | null => ((value as { kind?: string } | null)?.kind === "view_margin_for_asset" ? (value as HawkeyeAssetReturn) : null);
const asLiquidation = (value: unknown): HawkeyeLiquidationPriceReturn | null => ((value as { kind?: string } | null)?.kind === "view_liquidation_price" ? (value as HawkeyeLiquidationPriceReturn) : null);
const asFunding = (value: unknown): HawkeyeFundingReturn | null => ((value as { kind?: string } | null)?.kind === "view_funding" ? (value as HawkeyeFundingReturn) : null);

/* ----------------------------------------------------------------- build */

type Built = Readonly<{
  wire: string;
  view: TxView;
  networkFeeLamports: bigint;
  rentLamports: bigint;
  lastValidBlockHeight: number;
  before: Readonly<{ margin: HawkeyeMarginReturn | null; asset: HawkeyeAssetReturn | null; liquidation: HawkeyeLiquidationPriceReturn | null }> | null;
  after: Readonly<{ margin: HawkeyeMarginReturn | null; asset: HawkeyeAssetReturn | null; liquidation: HawkeyeLiquidationPriceReturn | null; funding: HawkeyeFundingReturn | null }> | null;
}>;

/** One endpoint's build: the transaction with its limits, simulated twice, and Phoenix's views before and after it. */
async function buildOn(connection: Connection, request: OrderRequest, kit: readonly KitInstruction[], views: HawkeyeViews | null, opensConditional: boolean): Promise<Built> {
  const owner = request.owner;
  /* The TP/SL account this order opens, when it opens one: its lamports after the run are the rent the wallet pays. */
  const watched = opensConditional ? [conditionalOrdersOf(traderAccountOf(owner))] : [];
  const instructions = kit.map(web3Instruction);
  const latest = await within(connection.getLatestBlockhash("confirmed"), CALL_MS);
  const v1 = request.format === "v1";
  const v1Wire = (limits: V1Limits) => buildV1Wire({ owner, instructions: kit, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight, limits });
  const draftWire = v1
    ? v1Wire({ computeUnitLimit: MAX_UNITS, loadedAccountsDataSizeLimit: LOADED_MAX, priorityFeeLamports: 0n })
    : legacyWire(owner, latest.blockhash, latest.lastValidBlockHeight, [ComputeBudgetProgram.setComputeUnitLimit({ units: MAX_UNITS }), ...instructions]);
  const simulated = await within(simulateWire(connection, draftWire), CALL_MS);
  /* A wallet with no SOL cannot pay the network: the chain names its account not found, or the fee unpaid. */
  if (simulated.err === "AccountNotFound" || simulated.err === "InsufficientFundsForFee") throw new Refusal(422, "NEEDS_SOL", "The wallet has no SOL for the network fee.");
  if (simulated.err) {
    console.warn(`phoenix orders: ${request.kind} simulation refused — ${JSON.stringify(simulated.err).slice(0, 160)}; ${(simulated.logs ?? []).slice(-3).join(" | ").slice(0, 400)}`);
    /* Phoenix's own word for an order the collateral cannot carry with its fees: said as that, not as «something». */
    if (/InsufficientFunds/.test(JSON.stringify(simulated.err))) throw new Refusal(422, "MARGIN_SHORT", "The collateral cannot carry this order with its fees.");
    throw new Refusal(422, "SIMULATION_FAILED", "The network would refuse this order now.");
  }
  const units = Math.min(MAX_UNITS, Math.ceil((simulated.unitsConsumed ?? 200_000) * UNIT_ROOM) + 10_000);
  const loaded = loadedDataLimit(simulated.loadedAccountsDataSize);
  const priorityLamports = (BigInt(units) * BigInt(PRIORITY_MICRO_LAMPORTS) + 999_999n) / 1_000_000n;
  const wire = v1
    ? v1Wire({ computeUnitLimit: units, loadedAccountsDataSizeLimit: loaded, priorityFeeLamports: priorityLamports })
    : legacyWire(owner, latest.blockhash, latest.lastValidBlockHeight, [
        ComputeBudgetProgram.setComputeUnitLimit({ units }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
        setLoadedAccountsDataSizeLimit(loaded),
        ...instructions,
      ]);
  const networkFeeLamports = v1 ? 5_000n + priorityLamports : networkFeeOf(wire);
  /* The bytes the wallet will see, with every limit set, run once more; Phoenix's views beside them. */
  const at = (view: KitInstruction, before: readonly TransactionInstruction[]) => viewAfter(connection, owner, latest.blockhash, before, view).catch(() => null);
  const [finalRun, marginBefore, assetBefore, liquidationBefore, marginAfter, assetAfter, liquidationAfter, funding] = await Promise.all([
    within(simulateWire(connection, wire, watched), CALL_MS),
    views ? at(views.margin, []) : null,
    views ? at(views.asset, []) : null,
    views ? at(views.liquidation, []) : null,
    views ? at(views.margin, instructions) : null,
    views ? at(views.asset, instructions) : null,
    views ? at(views.liquidation, instructions) : null,
    views ? at(views.funding, instructions) : null,
  ]);
  if (finalRun.err) {
    console.warn(`phoenix orders: ${request.kind} final simulation refused — ${JSON.stringify(finalRun.err).slice(0, 160)}`);
    throw new Refusal(422, "SIMULATION_FAILED", "The network would refuse this order now.");
  }
  /* An account this order opens and the simulation did not show is not one to show a person. */
  const rent = opensConditional ? finalRun.lamports[0] : 0n;
  if (rent === null || rent === undefined) throw new Error("The simulation did not show the TP/SL account it opens.");
  return {
    wire,
    view: viewOfWire(wire),
    networkFeeLamports,
    rentLamports: rent,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    before: views ? { margin: asMargin(marginBefore), asset: asAsset(assetBefore), liquidation: asLiquidation(liquidationBefore) } : null,
    after: views ? { margin: asMargin(marginAfter), asset: asAsset(assetAfter), liquidation: asLiquidation(liquidationAfter), funding: asFunding(funding) } : null,
  };
}

/* ----------------------------------------------------------------- review */

const sideBuys = (request: OrderRequest, held: PerpSide | null): boolean => (request.kind === "open" ? request.side === "long" : held === "short");

/** A market order's worst price in ticks: the mark moved by the tolerance, rounded so the tolerance is never widened. */
export function worstTicksOf(markUsd: number | null, buys: boolean, slippageBps: number, units: PerpUnits): bigint | null {
  if (markUsd === null || !(markUsd > 0)) return null;
  const worst = worstPriceUsd(buys ? "long" : "short", markUsd, slippageBps);
  return ticksFromUsd(worst.toFixed(12), units, buys ? "floor" : "ceil");
}

export async function reviewOrder(body: unknown, deps: OrderDeps): Promise<Readonly<{ ok: true; value: OrderReview }> | ActionFailure> {
  const env = deps.env;
  const now = deps.now ?? Date.now;
  const request = parseOrderRequest(body);
  if (!request) return failure(400, "BAD_REQUEST", "The order is not one this route builds.");
  const admitted = admitOrders(request.owner, env);
  if (!admitted.ok) return failure(403, "ORDERS_CLOSED", "Orders are not open for this wallet yet.");
  if (!orderTicketKeyConfigured(env)) return failure(503, "ORDERS_UNAVAILABLE", "The server cannot seal a Review now.");

  const [market, trader, book] = await Promise.all([
    deps.readMarket(request.symbol).catch(() => null),
    deps.readTrader(request.owner, request.symbol).catch(() => null),
    deps.readBook(request.symbol).catch(() => null),
  ]);
  if (!market || !trader) return failure(503, "PHOENIX_UNAVAILABLE", "Phoenix did not answer. Nothing was built.");
  if (market.status !== "active") return failure(409, "MARKET_GATED", "Phoenix does not take orders on this market now.");
  if (request.kind === "open" && market.isolatedOnly) return failure(409, "ISOLATED_ONLY", "This market trades on isolated margin only; Ryntra opens cross-margin positions.");
  /* Phoenix opens a trader account by an invite, a referral or a builder's onboarding (B7a §6): without one there is nowhere to trade. */
  if (!trader.found) return failure(409, "ACCOUNT_NEEDED", "This wallet has no Phoenix account yet.");
  if (addsRisk(request.kind) ? !trader.canAddRisk : !trader.canReduceRisk) return failure(409, "TRADING_CLOSED", "Phoenix does not take this order on this account now.");

  const units = market.units;
  const held = trader.position && trader.position.lots !== 0n ? (trader.position.lots > 0n ? "long" : "short") : null;
  const buys = sideBuys(request, held);
  const slippageBps = request.kind === "open" ? (request.type === "market" ? request.slippageBps : null) : request.kind === "reduce" ? request.slippageBps : null;
  const worstTicks = slippageBps === null ? null : worstTicksOf(market.markUsd, buys, slippageBps, units);

  /*
   * The notional the order trades, at the highest price it may fill at: the canary's ceiling, the minimum and the fees
   * count it. A buy fills at its limit or below; a sell at the book, which may stand far above a low limit — so a sell
   * counts at the mark when that is higher. A limit that crosses the mark by more than a market order's widest tolerance
   * is a market order without its guard: refused.
   */
  const sizeLots = request.kind === "open" ? request.sizeLots : request.kind === "reduce" ? (request.close ? (trader.position ? (trader.position.lots < 0n ? -trader.position.lots : trader.position.lots) : 0n) : request.sizeLots) : 0n;
  const markTicks = market.markUsd !== null && market.markUsd > 0 ? ticksFromUsd(market.markUsd.toFixed(12), units, "ceil") : null;
  const priceTicks = request.kind === "open" && request.type === "limit" ? request.priceTicks : worstTicks;
  if (request.kind === "open" && request.type === "limit") {
    if (markTicks === null) return failure(503, "PRICE_UNKNOWN", "Phoenix's mark price did not arrive. Nothing was built.");
    const far = (markTicks * BigInt(MAX_PERP_SLIPPAGE_BPS)) / 10_000n;
    if (buys ? request.priceTicks! > markTicks + far : request.priceTicks! < markTicks - far) return failure(422, "LIMIT_FAR", "The limit crosses the price by more than 5 %: that is a market order without its tolerance.");
    /* A post-only order never takes liquidity: a price that crosses the book is Phoenix's `PostOnlyCross`, refused here. */
    if (tifMakerOnly(request.tif)) {
      const best = bestPriceOf(request.side, book);
      const priceUsd = usdFromTicks(request.priceTicks!, units);
      if (best !== null && (buys ? priceUsd >= best : priceUsd <= best)) {
        return failure(422, "POST_ONLY_CROSS", "A post-only order would cross the book at this price: it can only rest. Nothing was built.");
      }
    }
  }
  const countTicks = priceTicks === null ? null : !buys && markTicks !== null && markTicks > priceTicks ? markTicks : priceTicks;
  const notionalMicro = countTicks !== null && sizeLots > 0n ? notionalMicroOf(sizeLots, countTicks, units) : null;
  const notionalUsd = notionalMicro === null ? null : Number(notionalMicro) / QUOTE;
  if (request.kind === "open") {
    if (notionalUsd === null) return failure(503, "PRICE_UNKNOWN", "Phoenix's mark price did not arrive. Nothing was built.");
    if (notionalUsd < MIN_ORDER_NOTIONAL_USD) return failure(422, "BELOW_MINIMUM", "An order opens at least one dollar of notional.");
    if (admitted.maxNotionalUsd !== null && notionalUsd > admitted.maxNotionalUsd) return failure(403, "CANARY_LIMIT", "The check takes a smaller order.");
  }
  /* TP/SL on the side they guard: a long's take profit above the mark and its stop below; a short's the other way. */
  const legSide: PerpSide | null = request.kind === "open" ? request.side : request.kind === "protect" ? held : null;
  const tpTicks = request.kind === "open" || request.kind === "protect" ? request.tpTicks : null;
  const slTicks = request.kind === "open" || request.kind === "protect" ? request.slTicks : null;
  /* Without the mark the sides cannot be checked: a stop on the wrong side would fire at once. */
  if (legSide && (tpTicks !== null || slTicks !== null) && market.markUsd === null) return failure(503, "PRICE_UNKNOWN", "Phoenix's mark price did not arrive. Nothing was built.");
  if (legSide && market.markUsd !== null && (tpTicks !== null || slTicks !== null)) {
    const wrong = legsSideOk(legSide, market.markUsd, tpTicks === null ? null : usdFromTicks(tpTicks, units), slTicks === null ? null : usdFromTicks(slTicks, units));
    if (wrong) return failure(422, wrong, wrong === "TP_SIDE" ? "The take profit is on the wrong side of the price." : "The stop loss is on the wrong side of the price.");
  }

  const builder = builderOf(env);
  const order = request.kind === "cancel" ? (trader.orders.find((entry) => entry.orderSequenceNumber === request.orderSequenceNumber) ?? null) : null;
  const conditional = request.kind === "cancelConditional" ? ((trader.conditionals ?? []).find((entry) => entry.index === request.index) ?? null) : null;
  const needsLegs = tpTicks !== null || slTicks !== null;
  /* A cancel of any shape takes risk away: Phoenix's view of the account after it is not what the person is deciding on. */
  const cancels = request.kind === "cancel" || request.kind === "cancelAll" || request.kind === "cancelConditional";
  /* What «cancel all» would take: every order of this wallet resting in this market's book, as Phoenix holds them now. */
  const resting = trader.resting ?? trader.orders;

  let connection: Connection;
  let builtValue: Built;
  let steps: readonly PlanStep[];
  let planSide: PerpSide;
  let clearsLegs: boolean;
  let builderBps = 0;
  try {
    const answer = await onFirstAnswering(deps.connections, async (candidate) => {
      const [conditionalAccount, bps] = await Promise.all([
        needsLegs ? within(candidate.getAccountInfo(new PublicKey(conditionalOrdersOf(traderAccountOf(request.owner))), "confirmed"), CALL_MS).then((info) => info !== null) : Promise.resolve(true),
        builder ? deps.builderBps(builder, candidate) : Promise.resolve(0),
      ]);
      if (bps === null) throw new Refusal(503, "BUILDER_UNAVAILABLE", "Ryntra's builder on Phoenix is not active. Nothing was built.");
      const plan = planOrder({ request, assetId: market.assetId, worstTicks, position: trader.position, order, resting: trader.resting ?? trader.orders, conditionals: trader.conditionals ?? [], conditionalAccount });
      if (!plan.ok) throw new Refusal(plan.code === "PRICE_UNKNOWN" ? 503 : 409, plan.code, plan.reason);
      let kit: readonly KitInstruction[];
      try {
        kit = await deps.build(request.owner, request.symbol, plan.steps, builder);
      } catch (error) {
        console.warn(`phoenix orders: ${request.kind} build — ${redacted(error)}`);
        throw new Refusal(503, "PHOENIX_UNAVAILABLE", "Phoenix did not answer. Nothing was built.");
      }
      const views = cancels ? null : await deps.views(request.owner, request.symbol).catch(() => null);
      if (!cancels && !views) throw new Refusal(503, "PHOENIX_UNAVAILABLE", "Phoenix did not answer. Nothing was built.");
      const built = await buildOn(candidate, request, kit, views, plan.steps.some((step) => step.ix === "createConditional"));
      return { built, plan, bps };
    });
    connection = answer.connection;
    builtValue = answer.value.built;
    steps = answer.value.plan.steps;
    planSide = answer.value.plan.side;
    clearsLegs = answer.value.plan.clearsLegs;
    builderBps = answer.value.bps;
  } catch (error) {
    if (error instanceof Refusal) return failure(error.status, error.code, error.message);
    console.warn(`phoenix orders: ${request.kind} — ${redacted(error)}`);
    return failure(503, "UNAVAILABLE", "Solana did not answer. Nothing was built.");
  }

  const calls = orderCallsOnly(builtValue.view, { owner: request.owner, steps, orderbook: market.orderbook, spline: market.spline, builder });
  if (!calls.ok) return failure(500, "BUILD_REFUSED", calls.reason);

  /* What Phoenix's own view says the order does: a market order the book would not fill in full is refused here. */
  const before = builtValue.before;
  const after = builtValue.after;
  if (!cancels && (!before?.margin || !after?.margin || !after.asset || !after.liquidation)) return failure(503, "PHOENIX_UNAVAILABLE", "Phoenix's view of the account did not answer. Nothing was built.");
  if ((request.kind === "open" && request.type === "market") || request.kind === "reduce") {
    const moved = (after!.asset!.baseLots ?? 0n) - (before!.asset?.baseLots ?? 0n);
    const expected = buys ? sizeLots : -sizeLots;
    /* A fill-or-kill moves the whole size or it is not an order; an immediate-or-cancel takes what the book gives,
       so any part of it in the order's own direction is an order — but nothing at all is not. */
    const partial = request.kind === "open" && tifTakesPart(request.tif);
    const sameWay = expected === 0n ? moved === 0n : (moved > 0n) === (expected > 0n) && (moved < 0n ? -moved : moved) <= (expected < 0n ? -expected : expected);
    if (partial ? moved === 0n || !sameWay : moved !== expected) return failure(422, "NOT_FILLABLE", "The book cannot fill this size within the tolerance now. Nothing was built.");
  }

  const life = await readBlockhashLife((deps.chainReader ?? ((c: Connection) => web3ChainReader(c, CALL_MS)))(connection), builtValue.lastValidBlockHeight);
  if (life.state === "EXPIRED") return failure(503, "UNAVAILABLE", "Solana answered with a blockhash that has already expired. Nothing was built.");
  const ttlMs = Math.min(life.state === "LIVE" ? life.msLeft : BLOCKHASH_LIFE_BLOCKS * life.msPerSlot, BLOCKHASH_LIFE_MS);
  const signableMs = Math.min(signableWindowMs(life), Math.max(0, ttlMs - BLOCKHASH_SUBMIT_MARGIN_MS));
  const issuedAt = now();
  const ticket = issueOrderTicket({ owner: request.owner, kind: request.kind, symbol: request.symbol, notionalMicro: (notionalMicro ?? 0n).toString(), messages: [collateralDigest(builtValue.view)] }, env, issuedAt, ttlMs);
  if (!ticket) return failure(503, "ORDERS_UNAVAILABLE", "The server cannot seal a Review now.");

  const taker = request.kind === "open" || request.kind === "reduce";
  /* A post-only order can only ever rest: Phoenix charges it the maker rate and Flight charges it nothing. */
  const makerOnly = request.kind === "open" && request.type === "limit" && tifMakerOnly(request.tif);
  /* An order that takes liquidity now — a market order, a cut, a close: its fees are known, and so is its impact. */
  const takesNow = (request.kind === "open" && request.type === "market") || request.kind === "reduce";
  const sizeUnitsNumber = Number(unitsTextFromLots(sizeLots, units.baseLotsDecimals));
  const fillSide: PerpSide = buys ? "long" : "short";
  const walk = takesNow && sizeUnitsNumber > 0 ? bookFill(fillSide, sizeUnitsNumber, book) : null;
  const bestUsd = bestPriceOf(fillSide, book);
  const impactPercent = walk && walk !== "thin" ? priceImpactPercent(fillSide, walk.averageUsd, bestUsd) : null;
  const fundingRead = after?.funding ?? null;
  const tif = request.kind === "open" ? request.tif : request.kind === "reduce" ? "fok" : null;
  return {
    ok: true,
    value: {
      kind: request.kind,
      symbol: request.symbol,
      tif,
      side: planSide,
      type: request.kind === "open" ? request.type : "market",
      sizeLots: sizeLots.toString(),
      sizeUnits: unitsTextFromLots(sizeLots, units.baseLotsDecimals),
      priceUsd: priceTicks === null || !taker ? null : usdFromTicks(priceTicks, units),
      markUsd: market.markUsd,
      indexUsd: market.indexUsd,
      slippageBps,
      notionalUsd: taker ? notionalUsd : null,
      before: before?.margin
        ? {
            collateralUsd: Number(before.margin.collateralQuoteLots) / QUOTE,
            accountValueUsd: Number(before.margin.effectiveCollateralQuoteLots) / QUOTE,
            liquidationUsd: before.liquidation?.status.label === "found" && before.liquidation.liquidationPriceTicks > 0n ? usdFromTicks(before.liquidation.liquidationPriceTicks, units) : null,
            positionUnits: positionUnitsOf(before.asset, units),
            initialMarginUsd: Number(before.margin.initialMarginQuoteLots) / QUOTE,
          }
        : null,
      after: after?.margin ? afterFromHawkeye(after, before?.margin ?? null, units) : null,
      fees: {
        takerRate: market.takerRate,
        makerRate: market.makerRate,
        /* Phoenix's own fee at the rate that applies: the maker's for a post-only order, the taker's for the rest. */
        venueUsd: !taker
          ? 0
          : notionalUsd === null
            ? null
            : makerOnly
              ? market.makerRate === null
                ? null
                : perpFeeUsd(notionalUsd, market.makerRate)
              : market.takerRate === null
                ? null
                : perpFeeUsd(notionalUsd, market.takerRate),
        venueLiquidity: makerOnly ? "maker" : request.kind === "open" && request.type === "limit" ? "mixed" : "taker",
        builderBps: builder ? builderBps : 0,
        /* A plain limit pays the builder only on the part that crosses the book: its share is not known before it
           fills. A post-only order crosses nothing, so it pays the builder nothing at all. */
        builderUsd: !builder || makerOnly || !taker ? 0 : notionalUsd !== null && takesNow ? builderFeeUsd(notionalUsd, builderBps) : null,
      },
      funding: (() => {
        const rate = fundingRead ? fundingOf(fundingRead.projected1hFundingRateMicroBps, market.markUsd, market.indexUsd) : null;
        return rate ? { ...rate, intervalSeconds: market.fundingIntervalSeconds } : null;
      })(),
      tpUsd: tpTicks === null ? null : usdFromTicks(tpTicks, units),
      slUsd: slTicks === null ? null : usdFromTicks(slTicks, units),
      clearsLegs,
      impact: walk && walk !== "thin" && bestUsd !== null && impactPercent !== null ? { averageUsd: walk.averageUsd, bestUsd, percent: impactPercent } : null,
      /* What the book said, so the screen tells its silence from its answer — and a resting order from a crossing one. */
      book: !taker ? "resting" : makerOnly ? "resting" : !takesNow ? "unsure" : walk === "thin" ? "thin" : walk && bestUsd !== null && impactPercent !== null ? "walked" : "quiet",
      order: order ? { id: order.orderSequenceNumber.toString(), side: order.side, priceUsd: usdFromTicks(order.priceTicks, units), sizeUnits: order.sizeLots === null ? null : unitsTextFromLots(order.sizeLots, units.baseLotsDecimals) } : null,
      cancelAll:
        request.kind === "cancelAll"
          ? {
              count: resting.length,
              /* The magnitudes of both sides added, and null the moment one row's remainder did not come: a sum that
                 silently leaves a row out would understate what the one instruction removes. */
              sizeUnits: resting.some((entry) => entry.sizeLots === null)
                ? null
                : unitsTextFromLots(
                    resting.reduce((sum, entry) => sum + (entry.sizeLots! < 0n ? -entry.sizeLots! : entry.sizeLots!), 0n),
                    units.baseLotsDecimals,
                  ),
            }
          : null,
      conditional: conditional
        ? {
            index: conditional.index,
            legs: conditional.legs,
            tpUsd: conditional.tpTicks === null ? null : usdFromTicks(conditional.tpTicks, units),
            slUsd: conditional.slTicks === null ? null : usdFromTicks(conditional.slTicks, units),
          }
        : null,
      rentLamports: builtValue.rentLamports.toString(),
      networkFeeLamports: builtValue.networkFeeLamports.toString(),
      traderAccount: traderAccountOf(request.owner),
      transaction: { wireBase64: builtValue.wire },
      ticket,
      expiresAt: issuedAt + signableMs,
      signableMs,
    },
  };
}

/* ------------------------------------------------------------------ relay */

async function landed(connection: Connection, signature: string, deadline: number, pollMs: number): Promise<Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; reason: string | null }>> {
  while (Date.now() < deadline) {
    const [status] = await signatureStates(connection, [signature], Math.min(CALL_MS, deadline - Date.now())).catch(() => [undefined]);
    if (status && status.state !== "UNKNOWN") return status;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { state: "UNKNOWN", reason: null };
}

/**
 * The wallet's signed bytes, held to the ticket, sent once. A refusal before the send means nothing moved; once the
 * bytes have left, a timeout is answered by reading the signature, never by a second send. Landed, Phoenix's record of
 * the fills is read for the receipt; a record that has not arrived yet is the status route's to read again.
 */
export async function submitOrder(body: unknown, deps: OrderDeps): Promise<Readonly<{ ok: true; value: OrderRelay }> | ActionFailure> {
  const env = deps.env;
  const now = deps.now ?? Date.now;
  if (!body || typeof body !== "object") return failure(400, "BAD_REQUEST", "A relay takes a ticket and the signed transaction.");
  const { ticket: sealed, signed } = body as Record<string, unknown>;
  if (!Array.isArray(signed)) return failure(400, "BAD_REQUEST", "A relay takes a ticket and the signed transaction.");
  const read = readOrderTicket(sealed, env, now());
  if (!read.ok) return read.code === "TICKET_EXPIRED" ? failure(410, "TICKET_EXPIRED", "The Review is older than its transaction; review again.") : failure(400, "TICKET_INVALID", "The Review's ticket is not one this server sealed.");
  const { ticket } = read;
  /* The gate as it stands now: closed, or a canary's ceiling below the sealed notional, sends nothing. */
  const admitted = admitOrders(ticket.owner, env);
  if (!admitted.ok) return failure(403, "ORDERS_CLOSED", "Orders are not open for this wallet now.");
  if (addsRisk(ticket.kind) && admitted.maxNotionalUsd !== null && BigInt(ticket.notionalMicro) > BigInt(admitted.maxNotionalUsd) * 1_000_000n) return failure(403, "CANARY_LIMIT", "The check takes a smaller order.");
  const checked = checkSigned(ticket, signed);
  if (!checked.ok) return failure(422, checked.code, checked.code === "NOT_SIGNED" ? "A signature is missing or does not match." : "The signed bytes are not the ones Review showed.");

  const connection = deps.connections[0];
  if (!connection) return failure(503, "UNAVAILABLE", "No Solana endpoint is configured.");
  const deadline = Date.now() + (deps.relayMs ?? RELAY_MS);
  try {
    await within(connection.sendRawTransaction(Buffer.from(checked.wire, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }), Math.min(deps.callMs ?? CALL_MS, deadline - Date.now()));
  } catch (error) {
    const message = redacted(error);
    if (/simulation failed|preflight|blockhash not found/i.test(message) && !/already been processed|AlreadyProcessed/i.test(message)) {
      console.warn(`phoenix orders relay: ${ticket.kind} refused before sending — ${message}`);
      return failure(422, /blockhash not found/i.test(message) ? "TICKET_EXPIRED" : "RELAY_REFUSED", "The network refused the order before it was sent. Nothing moved.");
    }
  }
  const answer = await landed(connection, checked.signature, deadline, deps.pollMs ?? 1_500);
  console.info(`phoenix orders relay: ${ticket.kind} ${ticket.symbol} ${checked.signature.slice(0, 8)}=${answer.state}`);
  const fills = answer.state === "LANDED" ? await deps.readFills(ticket.owner, checked.signature).catch(() => null) : undefined;
  return { ok: true, value: { results: [{ signature: checked.signature, ...answer, ...(fills === undefined ? {} : { fills }) }], settled: answer.state === "LANDED" } };
}
