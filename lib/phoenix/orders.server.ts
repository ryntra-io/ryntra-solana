/**
 * The order actions wired for the routes (B6b): Phoenix's SDK (`@ellipsis-labs/rise`, the exact version in package.json
 * — B7a §10) builds each step's instruction from Phoenix's public API alone, no key; Phoenix's API gives the market and
 * the wallet's trader state; the configured Solana endpoints read, simulate and send. The logic is `orders-actions.ts`.
 */

import "server-only";

import { buildCancelConditionalOrderIx, createPhoenixClient, flight, type PhoenixClient } from "@ellipsis-labs/rise";
import { PublicKey, type Connection } from "@solana/web3.js";

import { signatureStates } from "../liquidity/studio/actions.ts";

import { collateralConnections } from "./collateral.server.ts";
import { traderAccountOf, type KitInstruction } from "./collateral.ts";
import { marketFactsFrom, traderFactsFrom, fillsFrom } from "./orders-facts.ts";
import { readFuturesBook } from "./read.server.ts";
import { reviewOrder as review, submitOrder as submit, type MarketFacts, type OrderDeps } from "./orders-actions.ts";
import { admitOrders, builderOf, conditionalOrdersOf, flightBuilderState, orderTicketKeyConfigured, type OrderStates, type PlanStep } from "./orders.ts";
import { PHOENIX_API_URL } from "./market-data.ts";
import { getJson } from "./read.server.ts";

/*
 * One SDK client per builder setting, made again every ten minutes like the collateral's: its exchange addresses come
 * from one API snapshot and Phoenix may add an arena. No WebSocket: a route asks and answers.
 */
const CLIENT_MS = 10 * 60_000;
const clients = new Map<string, { at: number; value: PhoenixClient }>();
function phoenix(builder: string | null): PhoenixClient {
  const key = builder ?? "";
  const known = clients.get(key);
  if (known && Date.now() - known.at <= CLIENT_MS) return known.value;
  known?.value.dispose?.();
  const value = createPhoenixClient({ apiUrl: PHOENIX_API_URL, ws: false, ...(builder ? { flight: { builderAuthority: builder as never } } : {}) });
  clients.set(key, { at: Date.now(), value });
  return value;
}

/** One market's facts: the list and the stats read at once, each fresh. */
async function readMarket(symbol: string): Promise<MarketFacts | null> {
  const [config, stats] = await Promise.all([getJson("/v1/view/exchange/markets"), getJson("/v1/markets/stats/latest")]);
  if (!config.ok) return null;
  return marketFactsFrom(config.value, stats.ok ? stats.value : null, symbol);
}

/** Phoenix's book of one market for the Review's price impact and a post-only order's cross check (PERP-5). */
async function readBook(symbol: string) {
  const read = await readFuturesBook(symbol);
  return read.ok ? { bids: read.value.bids, asks: read.value.asks } : null;
}

async function readTrader(owner: string, symbol: string) {
  const state = await getJson(`/v1/trader/state/${encodeURIComponent(owner)}?traderPdaIndex=0`);
  if (!state.ok) return state.code === "NOT_FOUND" ? { found: false as const } : null;
  return traderFactsFrom(state.value, symbol);
}

/** Each step's instruction from the SDK; the TP/SL cancel from its resolved builder, on the market's book. */
async function build(owner: string, symbol: string, steps: readonly PlanStep[], builder: string | null): Promise<readonly KitInstruction[]> {
  const client = phoenix(builder);
  const authority = owner as never;
  const out: KitInstruction[] = [];
  for (const step of steps) {
    switch (step.ix) {
      case "market":
        out.push((await client.ixs.buildPlaceMarketOrder({ authority, symbol: symbol as never, orderPacket: step.packet })) as unknown as KitInstruction);
        break;
      case "limit":
        out.push((await client.ixs.buildPlaceLimitOrder({ authority, symbol: symbol as never, orderPacket: step.packet })) as unknown as KitInstruction);
        break;
      case "postOnly":
        out.push((await client.ixs.buildPlacePostOnlyOrder({ authority, symbol: symbol as never, orderPacket: step.packet })) as unknown as KitInstruction);
        break;
      case "cancelAll":
        out.push((await client.ixs.buildCancelAll({ authority, symbol: symbol as never })) as unknown as KitInstruction);
        break;
      case "cancelOrders":
        out.push((await client.ixs.buildCancelOrdersById({ authority, symbol: symbol as never, orders: step.orders.map((order) => ({ priceInTicks: order.priceInTicks, orderSequenceNumber: order.orderSequenceNumber })) })) as unknown as KitInstruction);
        break;
      case "createConditional":
        out.push((await client.ixs.buildCreateConditionalOrdersAccount({ authority, capacity: step.capacity })) as unknown as KitInstruction);
        break;
      case "cancelConditional": {
        await client.exchange.ready();
        const context = client.exchange.instructionContext(symbol);
        if (!context) throw new Error(`Phoenix's snapshot has no market ${symbol}.`);
        const trader = traderAccountOf(owner);
        out.push(buildCancelConditionalOrderIx({ traderAccount: trader as never, traderWallet: authority, orderbook: context.market.marketPubkey as never, traderConditionalOrders: conditionalOrdersOf(trader) as never, conditionalOrderIndex: step.index, disableFirst: true, disableSecond: true }) as unknown as KitInstruction);
        break;
      }
      case "positionConditional":
        out.push((await client.ixs.buildPlacePositionConditionalOrder({ authority, symbol: symbol as never, greaterTriggerOrder: step.greater, lessTriggerOrder: step.less, sizePercent: 100 })) as unknown as KitInstruction);
        break;
    }
  }
  return out;
}

async function views(owner: string, symbol: string) {
  const client = phoenix(null);
  const authority = owner as never;
  const [margin, asset, liquidation, funding] = await Promise.all([
    client.ixs.buildHawkeyeViewMargin({ authority }),
    client.ixs.buildHawkeyeViewMarginForAsset({ authority, symbol: symbol as never }),
    client.ixs.buildHawkeyeViewLiquidationPrice({ authority, symbol: symbol as never }),
    client.ixs.buildHawkeyeViewFunding({ authority, symbol: symbol as never }),
  ]);
  return { margin, asset, liquidation, funding } as unknown as { margin: KitInstruction; asset: KitInstruction; liquidation: KitInstruction; funding: KitInstruction };
}

/** The builder's registered fee as the chain holds it: active, collecting into its own PDA-0 trader account, under Flight's ceiling. */
async function builderBps(builder: string, connection: Connection): Promise<number | null> {
  const info = await connection.getAccountInfo(new PublicKey(flightBuilderState(builder)), "confirmed");
  if (!info) return null;
  try {
    const state = flight.decodeBuilderState(Uint8Array.from(info.data));
    if (!state.isActive || state.authorityKey !== builder || state.traderKey !== traderAccountOf(builder)) return null;
    const bps = Number(state.feeBps);
    return Number.isInteger(bps) && bps >= 0 && bps <= 10 ? bps : null;
  } catch {
    return null;
  }
}

/** Phoenix's record of a signature's fills, on PDA index 0; the market's mark and rate hold its units to account. */
async function readFills(owner: string, signature: string) {
  const history = await getJson(`/v1/trader/${encodeURIComponent(owner)}/trades-history?pdaIndex=0&limit=25`);
  if (!history.ok) return null;
  const items = (history.value as { data?: unknown[] } | null)?.data ?? [];
  const symbol = items.map((item) => (item as { signature?: unknown; marketSymbol?: unknown }) ?? {}).find((item) => item.signature === signature)?.marketSymbol;
  /* Not in Phoenix's record yet: unknown, never «filled nothing» — the receipt asks again. */
  if (typeof symbol !== "string") return null;
  const market = await readMarket(symbol);
  if (!market) return null;
  return fillsFrom(history.value, signature, market.units, market.markUsd, market.takerRate);
}

function deps(): OrderDeps {
  return { env: process.env, connections: collateralConnections(), readMarket, readTrader, readBook, build, views, builderBps, readFills };
}

export function reviewOrder(body: unknown) {
  return review(body, deps());
}

export function submitOrder(body: unknown) {
  return submit(body, deps());
}

/* The builder's fee as last read from the chain, for the ticket's preview: five minutes old at most, one read at a time. */
const BUILDER_BPS_TTL_MS = 5 * 60_000;
/* The gate's answer never waits on the chain longer than this: the fee is then «not read», and the Review reads it. */
const BUILDER_BPS_WAIT_MS = 1_500;
let builderBpsSeen: Readonly<{ builder: string; bps: number | null; at: number }> | null = null;
let builderBpsReading: Readonly<{ builder: string; read: Promise<number | null> }> | null = null;

async function previewBuilderBps(builder: string): Promise<number | null> {
  const now = Date.now();
  if (builderBpsSeen && builderBpsSeen.builder === builder && now - builderBpsSeen.at < BUILDER_BPS_TTL_MS) return builderBpsSeen.bps;
  if (!builderBpsReading || builderBpsReading.builder !== builder) {
    const [connection] = collateralConnections();
    if (!connection) return null;
    const read = builderBps(builder, connection)
      .catch(() => null)
      .then((bps) => {
        /* A failed read is asked again within half a minute, not in five. */
        builderBpsSeen = { builder, bps, at: bps === null ? Date.now() - BUILDER_BPS_TTL_MS + 30_000 : Date.now() };
        return bps;
      })
      .finally(() => {
        if (builderBpsReading?.read === read) builderBpsReading = null;
      });
    builderBpsReading = { builder, read };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), BUILDER_BPS_WAIT_MS);
  });
  try {
    return await Promise.race([builderBpsReading.read, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What this wallet may do with orders now, and the builder's fee the orders would carry (the Review reads it again).
 * The fee is read only for a wallet the gate admits, and never holds the gate's answer past a second and a half.
 */
export async function readOrderStates(owner: string | null): Promise<OrderStates> {
  const env = orderTicketKeyConfigured(process.env) ? process.env : {};
  const admitted = admitOrders(owner, env);
  const builder = builderOf(env);
  return {
    open: admitted.ok,
    maxNotionalUsd: admitted.ok ? admitted.maxNotionalUsd : null,
    builder: builder !== null,
    builderBps: builder === null || !admitted.ok ? null : await previewBuilderBps(builder),
  };
}

/** The chain's word on a relay's signature — for a receipt whose answer was lost on the way back — and, once landed, its fills. */
export async function readOrderSignatures(owner: string, signatures: readonly string[]) {
  const [connection] = collateralConnections();
  if (!connection) return null;
  try {
    const states = await signatureStates(connection, signatures);
    return await Promise.all(states.map(async (state, index) => (state.state === "LANDED" ? { ...state, fills: await readFills(owner, signatures[index]!).catch(() => null) } : state)));
  } catch {
    return null;
  }
}
