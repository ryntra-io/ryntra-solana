/**
 * Liquidity Studio's actions: a Review that previews, builds,
 * checks and simulates an add, a withdrawal or a claim and seals the bytes in a
 * ticket; and a relay that sends the wallet's signed bytes — those and no
 * others — once each, in order, and reads the chain's answer.
 *
 * The person's wallet signs; the server holds no key that moves money. The
 * only key a build signs with is a fresh position key that holds nothing. No
 * fee of Ryntra's is added to any of the three actions.
 *
 * The steps of the relay are its safety: the ticket proves the bytes are the
 * ones Review showed; the gate is asked again (it may have closed since); each
 * transaction is sent once — a timeout is answered by reading the signature,
 * never by a second send — and a failure stops the rest, which the person
 * reviews again.
 */

import { Connection, PublicKey, VersionedTransaction, type AddressLookupTableAccount, type Keypair } from "@solana/web3.js";

import { BLOCKHASH_LIFE_BLOCKS, BLOCKHASH_SUBMIT_MARGIN_MS, readBlockhashLife, signableWindowMs, web3ChainReader, type ChainReader } from "../../solana/blockhash-life.ts";
import { isPoolAddress } from "../catalog/model.ts";
import {
  LIQUIDITY_SHAPES,
  LIQUIDITY_VENUE_IDS,
  LiquidityRefusal,
  type AddLiquidityRequest,
  type BuiltLiquidity,
  type ClaimFeesRequest,
  type LiquidityPreview,
  type LiquidityShape,
  type LiquidityVenueAdapter,
  type LiquidityVenueId,
  type RemoveLiquidityRequest,
  type UnsignedLiquidityTx,
} from "./contract.ts";
import { admitLiquidityAction, depositUsd, type Env, type GatedAction } from "./gate.ts";
import { LIMIT_SIDES, type BuiltLimit, type CancelLimitRequest, type LimitBins, type LimitPreview, type LimitSide, type LimitVenue, type PlaceLimitRequest, type RollLimitRequest } from "./limit-orders.ts";
import { builtCallsOnly, checkSigned, decodeWire, issueTicket, MAX_TICKET_LOOKUPS, messageDigest, openCosigners, readTicket, sealCosigners, ticketKeyConfigured, TICKET_TTL_MS, withoutSignaturesOf, type Cosigner, type TicketAction } from "./ticket.ts";
import { ZAP_MAX_HALF, ZAP_SWAP_SLIPPAGE_BPS, type BuiltZap, type ZapFee, type ZapInRequest, type ZapPreview, type ZapRestRequest, type ZapVenue } from "./zap.ts";
import { againstReference, zapCallsOnly, type ZapCheckContext } from "./zap-check.ts";

export type ActionFailure = Readonly<{ ok: false; status: number; code: string; reason: string }>;

/**
 * Where a new DLMM position sits against the price, and how many bins on each side: the bins are counted from the
 * active bin the server reads at the Review, so a price that moved since the page was drawn still gets the range the
 * person chose — above stays above, below stays below.
 */
export type RangeChoice = Readonly<{ place: "around" | "above" | "below"; half: number }>;

/** The bins of a new DLMM position from the active bin, inclusive. */
export function binsFrom(activeBin: number, choice: RangeChoice): Readonly<{ lower: number; upper: number }> {
  if (choice.place === "above") return { lower: activeBin + 1, upper: activeBin + 1 + 2 * choice.half };
  if (choice.place === "below") return { lower: activeBin - 1 - 2 * choice.half, upper: activeBin - 1 };
  return { lower: activeBin - choice.half, upper: activeBin + choice.half };
}

export type ReviewInput =
  | Readonly<{ action: "add"; venue: LiquidityVenueId; request: AddLiquidityRequest; range?: RangeChoice | undefined }>
  | Readonly<{ action: "remove"; venue: LiquidityVenueId; request: RemoveLiquidityRequest }>
  | Readonly<{ action: "claim"; venue: LiquidityVenueId; request: ClaimFeesRequest }>;

export type LiquidityReview = Readonly<{
  preview: LiquidityPreview;
  transactions: readonly UnsignedLiquidityTx[];
  /** The position acted on — for an add, the new account. */
  position: string;
  ticket: string;
  /** ms, on the server's clock; after it the bytes are refused and the person reviews again. */
  expiresAt: number;
  /**
   * How long from arriving the person may still sign these bytes: their blockhash's life on the chain minus a margin
   * to send and land (`lib/solana/blockhash-life.ts`). Relative, so the browser counts it on its own clock.
   */
  signableMs: number;
  /** What the network charges for the transactions, lamports: five thousand a signature plus the priority fee the build set. */
  networkFeeLamports: string;
  /** An add's value at the venue's token prices; null when not priced or not an add. */
  depositUsd: number | null;
}>;

export type RelayState = "LANDED" | "FAILED" | "UNKNOWN" | "NOT_SENT";

export type LiquidityRelay = Readonly<{
  results: readonly Readonly<{ signature: string; state: RelayState; reason: string | null }>[];
  /** Every transaction landed. */
  settled: boolean;
}>;

export type ActionDeps = Readonly<{
  env: Env;
  /** The endpoints in the order they are tried; the relay sends through the first. */
  connections: readonly Connection[];
  venuesFor: (connection: Connection) => Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>>;
  /** The venue's dollar prices of the pool's two tokens and the mints it priced, for the canary's ceiling. */
  pricesOf: (venue: LiquidityVenueId, pool: string) => Promise<Readonly<{ x: number | null; y: number | null; xMint: string | null; yMint: string | null }>>;
  /** After a relay: the wallet's kept positions no longer hold. */
  forget: (owner: string) => void;
  /** The fresh key a build signed with, handed over once: the Review seals it for the relay instead of signing first. */
  takeFreshKey?: (publicKey: string) => Keypair | null;
  now?: () => number;
  /** The whole relay's time, so the route answers before its own limit. */
  relayMs?: number;
  /** Between two reads of a signature's status. */
  pollMs?: number;
  /** The chain reads that measure the bytes' life; the answering endpoint by default. */
  chainReader?: (connection: Connection) => ChainReader;
  /** DLMM's limit orders on an endpoint (`limit-orders.ts`); without it no limit order is built. */
  limitVenueFor?: (connection: Connection) => LimitVenue;
  /** The Zap on an endpoint (`zap.ts`, CITY-198); without it no Zap is built. */
  zapVenueFor?: (connection: Connection) => ZapVenue;
  /** Ryntra's fee on a Zap's Jupiter leg from SOL into `outputMint` (fee policy v2's `/build` lane), or null for none. */
  zapFeeFor?: (outputMint: string) => Promise<ZapFee | null>;
  /** The lookup tables a relay resolves version-0 bytes with; the endpoint's own read by default. */
  lookupTables?: (connection: Connection, addresses: readonly string[]) => Promise<readonly AddressLookupTableAccount[] | null>;
}>;

const failure = (status: number, code: string, reason: string): ActionFailure => ({ ok: false, status, code, reason });

/* ------------------------------------------------------------------ input */

const DIGITS = /^\d{1,30}$/;
const isKey = (value: unknown): value is string => isPoolAddress(value);
const isUnits = (value: unknown): value is string => typeof value === "string" && DIGITS.test(value);
const isBps = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const isBin = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && Math.abs(value) <= 500_000;

/** The browser's body, read field by field into the venue's request; anything else is refused before the chain is asked. */
export function parseReviewInput(body: unknown): ReviewInput | null {
  if (!body || typeof body !== "object") return null;
  const { action, venue, request } = body as Record<string, unknown>;
  if (typeof venue !== "string" || !(LIQUIDITY_VENUE_IDS as readonly string[]).includes(venue)) return null;
  if (!request || typeof request !== "object") return null;
  const r = request as Record<string, unknown>;
  if (!isKey(r.owner) || !isBps(r.slippageBps ?? 0, 0, 5_000)) return null;
  const id = venue as LiquidityVenueId;
  if (action === "add") {
    if (!isKey(r.pool) || !isUnits(r.amountX) || !isUnits(r.amountY) || !isBps(r.slippageBps, 0, 5_000)) return null;
    if (r.position !== undefined && !isKey(r.position)) return null;
    let bins: AddLiquidityRequest["bins"];
    if (r.bins !== undefined) {
      const b = r.bins as Record<string, unknown> | null;
      if (!b || !isBin(b.lower) || !isBin(b.upper)) return null;
      bins = { lower: b.lower, upper: b.upper };
    }
    if (r.shape !== undefined && !(typeof r.shape === "string" && (LIQUIDITY_SHAPES as readonly string[]).includes(r.shape))) return null;
    let range: RangeChoice | undefined;
    const given = (body as Record<string, unknown>).range;
    if (given !== undefined) {
      const g = given as Record<string, unknown> | null;
      if (!g || (g.place !== "around" && g.place !== "above" && g.place !== "below") || !isBps(g.half, 0, 34)) return null;
      range = { place: g.place, half: g.half };
    }
    return {
      action,
      venue: id,
      range,
      request: {
        pool: r.pool,
        owner: r.owner,
        position: r.position as string | undefined,
        amountX: r.amountX,
        amountY: r.amountY,
        bins,
        shape: r.shape as AddLiquidityRequest["shape"],
        slippageBps: r.slippageBps,
      },
    };
  }
  if (action === "remove") {
    if (!isKey(r.position) || !isBps(r.shareBps, 1, 10_000) || !isBps(r.slippageBps, 0, 5_000)) return null;
    if (r.close !== undefined && typeof r.close !== "boolean") return null;
    return { action, venue: id, request: { position: r.position, owner: r.owner, shareBps: r.shareBps, close: r.close === true, slippageBps: r.slippageBps } };
  }
  if (action === "claim") {
    if (!isKey(r.position)) return null;
    return { action, venue: id, request: { position: r.position, owner: r.owner } };
  }
  return null;
}

/* ------------------------------------------------------------------ reads */

/** Endpoints in order: a refusal of the request is the answer; an endpoint that fails gives way to the next. */
async function onFirstAnswering<T>(connections: readonly Connection[], run: (connection: Connection) => Promise<T>): Promise<Readonly<{ value: T; connection: Connection }>> {
  let last: unknown = new Error("No Solana endpoint is configured.");
  for (const connection of connections) {
    try {
      return { value: await run(connection), connection };
    } catch (error) {
      if (error instanceof LiquidityRefusal || error instanceof CanaryRefusal) throw error;
      last = error;
    }
  }
  throw last;
}

const REFUSAL_STATUS: Readonly<Record<string, number>> = { POOL_NOT_FOUND: 404, POSITION_NOT_FOUND: 404, ORDER_NOT_FOUND: 404, NOT_OWNER: 403, PREVIEW_EXPIRED: 409 };

/** What the network takes for one transaction: five thousand lamports a signature, plus units × the price the build set. */
export function networkFeeOf(wireBase64: string): bigint {
  const tx = VersionedTransaction.deserialize(Buffer.from(wireBase64, "base64"));
  const message = tx.message;
  let fee = 5_000n * BigInt(message.header.numRequiredSignatures);
  const budget = message.staticAccountKeys.findIndex((key) => key.toBase58() === "ComputeBudget111111111111111111111111111111");
  if (budget < 0) return fee;
  let limit = 200_000n;
  let price = 0n;
  for (const ix of message.compiledInstructions) {
    if (ix.programIdIndex !== budget) continue;
    const data = Buffer.from(ix.data);
    if (data[0] === 2 && data.length >= 5) limit = BigInt(data.readUInt32LE(1));
    if (data[0] === 3 && data.length >= 9) price = data.readBigUInt64LE(1);
  }
  fee += (limit * price + 999_999n) / 1_000_000n;
  return fee;
}

/* ----------------------------------------------------------------- review */

export async function reviewLiquidityAction(body: unknown, deps: ActionDeps): Promise<Readonly<{ ok: true; value: LiquidityReview }> | ActionFailure> {
  const env = deps.env;
  const input = parseReviewInput(body);
  if (!input) return failure(400, "BAD_REQUEST", "The action is not one this route builds.");
  const owner = input.request.owner;
  const admitted = admitLiquidityAction(owner, env);
  if (!admitted.ok) return failure(403, "ACTIONS_CLOSED", "Pool actions are not open for this wallet yet.");
  if (!ticketKeyConfigured(env)) return failure(503, "ACTIONS_UNAVAILABLE", "The server cannot seal a Review now.");
  const { connections, venuesFor } = deps;

  let built: BuiltLiquidity;
  let connection: Connection;
  let usd: number | null = null;
  try {
    const answer = await onFirstAnswering(connections, async (candidate) => {
      const venue = venuesFor(candidate)[input.venue];
      if (input.action === "add") {
        let request = input.request;
        if (input.range && input.venue === "meteora-dlmm" && !request.position) {
          const pool = await venue.pool(request.pool);
          if (pool.shape.kind !== "bins") throw new LiquidityRefusal("RANGE_INVALID", "The pool has no bins.");
          request = { ...request, bins: binsFrom(pool.shape.activeBin, input.range) };
        }
        const preview = await venue.previewAdd(request);
        if (admitted.maxDepositUsd !== null) {
          const prices = await deps.pricesOf(input.venue, preview.pool);
          /* A price is the deposit's only when the venue priced the very mints that go in. */
          const matched = { x: prices.xMint === preview.deposit.x.asset ? prices.x : null, y: prices.yMint === preview.deposit.y.asset ? prices.y : null };
          const value = depositUsd(preview.deposit, matched);
          if (value === null) throw new CanaryRefusal("CANARY_UNPRICED", "The deposit has no dollar price to hold it to the check's ceiling.");
          if (value > admitted.maxDepositUsd) throw new CanaryRefusal("CANARY_LIMIT", `The check takes at most ${admitted.maxDepositUsd} USD.`);
          usd = value;
        }
        return venue.buildAdd(preview);
      }
      if (input.action === "remove") return venue.buildRemove(await venue.previewRemove(input.request));
      return venue.buildClaim(await venue.previewClaim(input.request));
    });
    built = answer.value;
    connection = answer.connection;
  } catch (error) {
    if (error instanceof CanaryRefusal) return failure(403, error.code, error.message);
    if (error instanceof LiquidityRefusal) return failure(REFUSAL_STATUS[error.code] ?? 422, error.code, error.message);
    console.warn(`liquidity review: ${input.venue} ${input.action} — ${redacted(error)}`);
    return failure(503, "UNAVAILABLE", "Solana did not answer. Nothing was built.");
  }

  const sealed = await sealBuilt({ owner, venue: input.venue, action: input.action, pool: built.preview.pool, position: built.position, transactions: built.transactions, validUntil: built.validUntil }, connection, venuesFor(connection)[input.venue].program, deps);
  if (!sealed.ok) return sealed;
  const { transactions, ticket, expiresAt, signableMs, networkFeeLamports } = sealed.value;
  return { ok: true, value: { preview: built.preview, transactions, position: built.position, ticket, expiresAt, signableMs, networkFeeLamports, depositUsd: usd } };
}

/* ------------------------------------------------------------ limit orders */

export type LimitReviewInput =
  | Readonly<{ action: "limit_place"; venue: "meteora-dlmm"; request: PlaceLimitRequest }>
  | Readonly<{ action: "limit_cancel"; venue: "meteora-dlmm"; request: CancelLimitRequest }>
  | Readonly<{ action: "limit_roll"; venue: "meteora-dlmm"; request: RollLimitRequest }>;

/** A limit order's Review: the same seal as a pool action's, with the order's own preview. */
export type LimitReview = Readonly<{
  preview: LimitPreview;
  transactions: readonly UnsignedLiquidityTx[];
  /** The order acted on — for a place or a roll, the new order's account. */
  position: string;
  ticket: string;
  expiresAt: number;
  signableMs: number;
  networkFeeLamports: string;
  /** What goes into a new order at the venue's token prices; null when not priced or nothing goes in. */
  depositUsd: number | null;
}>;

const isLimitBins = (value: unknown): value is LimitBins => {
  if (!value || typeof value !== "object") return false;
  const b = value as Record<string, unknown>;
  return isBin(b.lower) && isBin(b.upper);
};

/** The browser's body for a limit order, field by field; anything else is refused before the chain is asked. */
export function parseLimitInput(body: unknown): LimitReviewInput | null {
  if (!body || typeof body !== "object") return null;
  const { action, venue, request } = body as Record<string, unknown>;
  if (venue !== "meteora-dlmm" || !request || typeof request !== "object") return null;
  const r = request as Record<string, unknown>;
  if (!isKey(r.owner)) return null;
  if (action === "limit_place") {
    if (!isKey(r.pool) || !isUnits(r.amount) || !(typeof r.side === "string" && (LIMIT_SIDES as readonly string[]).includes(r.side)) || !isLimitBins(r.bins)) return null;
    return { action, venue, request: { pool: r.pool, owner: r.owner, side: r.side as LimitSide, amount: r.amount, bins: { lower: r.bins.lower, upper: r.bins.upper } } };
  }
  if (action === "limit_cancel") {
    if (!isKey(r.order)) return null;
    return { action, venue, request: { order: r.order, owner: r.owner } };
  }
  if (action === "limit_roll") {
    if (!isKey(r.order) || !isLimitBins(r.bins)) return null;
    return { action, venue, request: { order: r.order, owner: r.owner, bins: { lower: r.bins.lower, upper: r.bins.upper } } };
  }
  return null;
}

/**
 * Review a limit order — place, cancel, or roll a filled one into the other side — exactly as a pool action: the same
 * gate (and the canary's ceiling on what goes in), a build made afresh on the chain, the same checks of every call and
 * signer, the first transaction simulated, the same sealed ticket for the relay. Nothing is signed or sent here.
 */
export async function reviewLimitAction(body: unknown, deps: ActionDeps): Promise<Readonly<{ ok: true; value: LimitReview }> | ActionFailure> {
  const env = deps.env;
  const input = parseLimitInput(body);
  if (!input) return failure(400, "BAD_REQUEST", "The action is not one this route builds.");
  const owner = input.request.owner;
  const admitted = admitLiquidityAction(owner, env);
  if (!admitted.ok) return failure(403, "ACTIONS_CLOSED", "Pool actions are not open for this wallet yet.");
  if (!ticketKeyConfigured(env)) return failure(503, "ACTIONS_UNAVAILABLE", "The server cannot seal a Review now.");
  const limitVenueFor = deps.limitVenueFor;
  if (!limitVenueFor) return failure(503, "ACTIONS_UNAVAILABLE", "Limit orders are not wired on this server.");

  let built: BuiltLimit;
  let connection: Connection;
  let usd: number | null = null;
  try {
    const answer = await onFirstAnswering(deps.connections, async (candidate) => {
      const venue = limitVenueFor(candidate);
      const preview = input.action === "limit_place" ? await venue.previewPlace(input.request) : input.action === "limit_roll" ? await venue.previewRoll(input.request) : await venue.previewCancel(input.request);
      if (preview.action !== "limit_cancel") {
        const deposit = preview.place.deposit;
        const prices = await deps.pricesOf("meteora-dlmm", preview.pool);
        const price = prices.xMint === deposit.asset ? prices.x : prices.yMint === deposit.asset ? prices.y : null;
        const zero = { units: "0", decimals: 0 };
        usd = depositUsd({ x: deposit, y: zero }, { x: price, y: null });
        if (admitted.maxDepositUsd !== null) {
          if (usd === null) throw new CanaryRefusal("CANARY_UNPRICED", "The order has no dollar price to hold it to the check's ceiling.");
          if (usd > admitted.maxDepositUsd) throw new CanaryRefusal("CANARY_LIMIT", `The check takes at most ${admitted.maxDepositUsd} USD.`);
        }
      }
      if (preview.action === "limit_place") return venue.buildPlace(preview);
      if (preview.action === "limit_roll") return venue.buildRoll(preview);
      return venue.buildCancel(preview);
    });
    built = answer.value;
    connection = answer.connection;
  } catch (error) {
    if (error instanceof CanaryRefusal) return failure(403, error.code, error.message);
    if (error instanceof LiquidityRefusal) return failure(REFUSAL_STATUS[error.code] ?? 422, error.code, error.message);
    console.warn(`liquidity review: ${input.venue} ${input.action} — ${redacted(error)}`);
    return failure(503, "UNAVAILABLE", "Solana did not answer. Nothing was built.");
  }

  const sealed = await sealBuilt({ owner, venue: input.venue, action: input.action, pool: built.preview.pool, position: built.order, transactions: built.transactions, validUntil: built.validUntil }, connection, limitVenueFor(connection).program, deps);
  if (!sealed.ok) return sealed;
  const { transactions, ticket, expiresAt, signableMs, networkFeeLamports } = sealed.value;
  return { ok: true, value: { preview: built.preview, transactions, position: built.order, ticket, expiresAt, signableMs, networkFeeLamports, depositUsd: usd } };
}

/* -------------------------------------------------------------------- zap */

const SOL_MINT = "So11111111111111111111111111111111111111112";

export type ZapReviewInput =
  | Readonly<{ action: "zap_in"; venue: "meteora-dlmm"; request: ZapInRequest }>
  | Readonly<{ action: "zap_rest"; venue: "meteora-dlmm"; request: ZapRestRequest }>;

/** A Zap's Review (CITY-198): the same seal as a pool action's, with the Zap's own preview and the swap leg's reference. */
export type ZapReview = Readonly<{
  preview: ZapPreview;
  transactions: readonly UnsignedLiquidityTx[];
  /** zap_in: the new position; zap_rest: the pool. */
  position: string;
  ticket: string;
  expiresAt: number;
  signableMs: number;
  networkFeeLamports: string;
  /** What the SOL put in is worth at the venue's prices; null for «Take the rest». */
  depositUsd: number | null;
  /** What the venue's dollar prices say the swap's input is worth in its output coin, base units; null when nothing is swapped. */
  referenceOut: string | null;
}>;

/** The browser's body for a Zap, field by field; anything else is refused before the chain is asked. */
export function parseZapInput(body: unknown): ZapReviewInput | null {
  if (!body || typeof body !== "object") return null;
  const { action, venue, request } = body as Record<string, unknown>;
  if (venue !== "meteora-dlmm" || !request || typeof request !== "object") return null;
  const r = request as Record<string, unknown>;
  if (!isKey(r.owner) || !isKey(r.pool)) return null;
  if (action === "zap_in") {
    if (!isUnits(r.amountIn) || !isBps(r.half, 0, ZAP_MAX_HALF) || !isBps(r.slippageBps, 1, 1_000)) return null;
    if (r.shape !== undefined && !(typeof r.shape === "string" && (LIQUIDITY_SHAPES as readonly string[]).includes(r.shape))) return null;
    const shape = r.shape as LiquidityShape | undefined;
    return { action, venue, request: { pool: r.pool, owner: r.owner, amountIn: r.amountIn, half: r.half, slippageBps: r.slippageBps, ...(shape ? { shape } : {}) } };
  }
  if (action === "zap_rest") {
    if (!isUnits(r.otherBefore)) return null;
    return { action, venue, request: { pool: r.pool, owner: r.owner, otherBefore: r.otherBefore } };
  }
  return null;
}

/**
 * Review a Zap — SOL into a new position of a pier in one approval, or «Take the rest» of one that landed in part —
 * exactly as a pool action: the same gate (and the canary's ceiling on the SOL put in), a build made afresh on the
 * chain, Ryntra's fee only on a Jupiter leg, the swap's floor held to the venue's own prices, every instruction held to
 * the wallet-only rules (`zap-check.ts`), the first transaction simulated, the same sealed ticket — with the lookup
 * tables its version-0 bytes read. Nothing is signed or sent here.
 */
export async function reviewZapAction(body: unknown, deps: ActionDeps): Promise<Readonly<{ ok: true; value: ZapReview }> | ActionFailure> {
  const env = deps.env;
  const input = parseZapInput(body);
  if (!input) return failure(400, "BAD_REQUEST", "The action is not one this route builds.");
  const owner = input.request.owner;
  const admitted = admitLiquidityAction(owner, env);
  if (!admitted.ok) return failure(403, "ACTIONS_CLOSED", "Pool actions are not open for this wallet yet.");
  if (!ticketKeyConfigured(env)) return failure(503, "ACTIONS_UNAVAILABLE", "The server cannot seal a Review now.");
  const zapVenueFor = deps.zapVenueFor;
  if (!zapVenueFor) return failure(503, "ACTIONS_UNAVAILABLE", "The Zap is not wired on this server.");

  let built: BuiltZap;
  let connection: Connection;
  let usd: number | null = null;
  let referenceOut: string | null = null;
  try {
    const prices = await deps.pricesOf("meteora-dlmm", input.request.pool);
    /* Ryntra's fee is asked of Jupiter for the leg SOL → the pier's other coin; the pool's own swap carries none. */
    const other = prices.xMint === SOL_MINT ? prices.yMint : prices.yMint === SOL_MINT ? prices.xMint : null;
    const fee = input.action === "zap_in" && other && deps.zapFeeFor ? await deps.zapFeeFor(other) : null;
    const answer = await onFirstAnswering(deps.connections, async (candidate) => {
      const venue = zapVenueFor(candidate);
      return input.action === "zap_in" ? venue.buildIn(input.request, fee) : venue.buildRest(input.request);
    });
    built = answer.value;
    connection = answer.connection;
    const preview = built.preview;
    const priceOf = (mint: string) => (prices.xMint === mint ? prices.x : prices.yMint === mint ? prices.y : null);
    const decimalsOf = (mint: string) => (preview.tokenX.mint === mint ? preview.tokenX.decimals : preview.tokenY.decimals);
    if (input.action === "zap_in") {
      const solMint = preview.swap.inMint;
      const value = depositUsd({ x: { units: preview.amountIn, decimals: 9 }, y: { units: "0", decimals: 0 } }, { x: priceOf(solMint), y: null });
      usd = value;
      if (admitted.maxDepositUsd !== null) {
        if (value === null) throw new CanaryRefusal("CANARY_UNPRICED", "The Zap has no dollar price to hold it to the check's ceiling.");
        if (value > admitted.maxDepositUsd) throw new CanaryRefusal("CANARY_LIMIT", `The check takes at most ${admitted.maxDepositUsd} USD.`);
      }
    }
    if (preview.swap.route !== "none") {
      const leg = preview.swap;
      const checked = againstReference({
        inAmount: BigInt(leg.inAmount),
        inDecimals: decimalsOf(leg.inMint),
        inUsd: priceOf(leg.inMint),
        floor: BigInt(leg.floor),
        outDecimals: decimalsOf(leg.outMint),
        outUsd: priceOf(leg.outMint),
        feeBps: leg.fee?.bps ?? 0,
        slippageBps: ZAP_SWAP_SLIPPAGE_BPS,
      });
      if (!checked.ok) {
        console.warn(`zap review: ${input.action} swap floor against the reference — ${checked.code} short ${checked.shortBps ?? "?"} bps`);
        return failure(checked.code === "ZAP_UNPRICED" ? 422 : 409, checked.code, checked.code === "ZAP_UNPRICED" ? "The swap has no reference price to be checked against." : "The swap would bring less than the coins are worth now.");
      }
      referenceOut = checked.referenceOut.toString();
    }
  } catch (error) {
    if (error instanceof CanaryRefusal) return failure(403, error.code, error.message);
    if (error instanceof LiquidityRefusal) return failure(REFUSAL_STATUS[error.code] ?? 422, error.code, error.message);
    console.warn(`zap review: ${input.action} — ${redacted(error)}`);
    return failure(503, "UNAVAILABLE", "Solana did not answer. Nothing was built.");
  }

  const sealed = await sealBuilt(
    { owner, venue: "meteora-dlmm", action: input.action, pool: built.preview.pool, position: built.position, transactions: built.transactions, validUntil: built.validUntil },
    connection,
    zapVenueFor(connection).program,
    deps,
    { tables: built.lookupTables, check: built.check },
  );
  if (!sealed.ok) return sealed;
  const { transactions, ticket, expiresAt, signableMs, networkFeeLamports } = sealed.value;
  return { ok: true, value: { preview: built.preview, transactions, position: built.position, ticket, expiresAt, signableMs, networkFeeLamports, depositUsd: usd, referenceOut } };
}

/** The tables an endpoint holds for these addresses, or null when any is missing. */
async function readLookupTables(connection: Connection, addresses: readonly string[]): Promise<readonly AddressLookupTableAccount[] | null> {
  const tables = await Promise.all(addresses.map((address) => within(connection.getAddressLookupTable(new PublicKey(address)), CALL_MS).then((answer) => answer.value)));
  return tables.every((table) => table !== null) ? (tables as AddressLookupTableAccount[]) : null;
}

type Sealed = Readonly<{ transactions: readonly UnsignedLiquidityTx[]; ticket: string; expiresAt: number; signableMs: number; networkFeeLamports: string }>;

/**
 * A build's bytes made ready for the wallet and sealed: the fresh keys' signatures taken off and kept for the relay,
 * every signer one the relay holds, every call the venue's or the wallet's own plumbing, the first transaction run
 * against the chain, and a ticket that dies with the bytes' blockhash. Shared by the pool actions and the limit orders.
 */
async function sealBuilt(
  built: Readonly<{ owner: string; venue: LiquidityVenueId; action: TicketAction; pool: string; position: string; transactions: readonly UnsignedLiquidityTx[]; validUntil: string }>,
  connection: Connection,
  venueProgram: string,
  deps: ActionDeps,
  zap: Readonly<{ tables: readonly AddressLookupTableAccount[]; check: ZapCheckContext }> | null = null,
): Promise<Readonly<{ ok: true; value: Sealed }> | ActionFailure> {
  const env = deps.env;
  const now = deps.now ?? Date.now;
  const owner = built.owner;
  const input = { venue: built.venue, action: built.action };
  if (built.transactions.length === 0 || built.transactions.length > 16) return failure(500, "BUILD_REFUSED", "The build gave no transaction, or too many.");
  const digests: string[] = [];
  let fee = 0n;
  /*
   * The wallet signs first: a fresh key's signature is taken off the bytes the wallet sees and kept, sealed, for the
   * relay to add after the wallet's. A wallet such as Phantom refuses bytes another key has already signed.
   */
  const cosigners: Cosigner[] = [];
  const transactions: { wireBase64: string; presigned: readonly string[] }[] = [];
  for (const [index, tx] of built.transactions.entries()) {
    if (tx.presigned.length === 0) {
      transactions.push(tx);
      continue;
    }
    for (const publicKey of tx.presigned) {
      const key = deps.takeFreshKey?.(publicKey) ?? null;
      if (!key) return failure(500, "BUILD_REFUSED", "A fresh key of the build is not held for the relay.");
      cosigners.push({ index, key });
    }
    transactions.push({ wireBase64: withoutSignaturesOf(tx.wireBase64, tx.presigned), presigned: [] });
  }
  if (zap && zap.tables.length > MAX_TICKET_LOOKUPS) return failure(500, "BUILD_REFUSED", "The build reads more lookup tables than a ticket seals.");
  /* Each transaction's signers are the wallet and the fresh keys held for it — nobody the relay could not sign for. */
  for (const [index, tx] of transactions.entries()) {
    const message = VersionedTransaction.deserialize(Buffer.from(tx.wireBase64, "base64")).message;
    const signers = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map((key) => key.toBase58());
    const held = new Set([owner, ...cosigners.filter((c) => c.index === index).map((c) => c.key.publicKey.toBase58())]);
    if (signers.length !== held.size || !signers.every((signer) => held.has(signer))) return failure(500, "BUILD_REFUSED", "A built transaction names a signer the relay does not hold.");
  }
  let zapCalls = 0;
  let swaps = 0;
  for (const tx of built.transactions) {
    if (zap) {
      /* A Zap is several programs: every instruction is held to the wallet-only rules of `zap-check.ts`. */
      const decoded = decodeWire(tx.wireBase64, zap.tables);
      if (!decoded) return failure(500, "BUILD_REFUSED", "A built transaction could not be read.");
      const calls = zapCallsOnly(decoded.instructions, decoded.feePayer?.toBase58() ?? null, zap.check);
      if (!calls.ok) return failure(500, "BUILD_REFUSED", calls.reason);
      zapCalls += calls.zapCalls;
      swaps += calls.swaps;
    } else {
      const calls = builtCallsOnly(tx.wireBase64, owner, venueProgram);
      if (!calls.ok) return failure(500, "BUILD_REFUSED", calls.reason);
    }
    const digest = messageDigest(tx.wireBase64, zap?.tables ?? []);
    if (!digest) return failure(500, "BUILD_REFUSED", "A built transaction could not be read.");
    digests.push(digest);
    fee += networkFeeOf(tx.wireBase64);
  }
  if (zap) {
    if (zapCalls === 0) return failure(500, "BUILD_REFUSED", "The built Zap does not call the Zap program.");
    /* Exactly the swaps the Review showed: one, or none when nothing is swapped. */
    if (swaps !== (zap.check.swap ? 1 : 0)) return failure(500, "BUILD_REFUSED", "The built Zap swaps other than the Review showed.");
  }

  /*
   * The first transaction run against the chain as it stands, before anyone is asked to sign. A later one may need the
   * earlier on chain (a wide position's last chunk closes it), so alone it would be refused for no fault of its own; the
   * relay stops at the first that does not land.
   */
  for (const [index, tx] of built.transactions.slice(0, 1).entries()) {
    try {
      const simulated = await connection.simulateTransaction(VersionedTransaction.deserialize(Buffer.from(tx.wireBase64, "base64")), { sigVerify: false, commitment: "confirmed" });
      if (simulated.value.err) {
        console.warn(`liquidity review: ${input.venue} ${input.action} simulation ${index} refused — ${JSON.stringify(simulated.value.err).slice(0, 160)}; ${(simulated.value.logs ?? []).slice(-3).join(" | ").slice(0, 400)}`);
        return failure(422, "SIMULATION_FAILED", "The network would refuse this transaction now.");
      }
    } catch (error) {
      console.warn(`liquidity review: ${input.venue} ${input.action} simulation ${index} — ${redacted(error)}`);
      return failure(503, "UNAVAILABLE", "Solana did not simulate the transaction. Nothing was built.");
    }
  }

  /*
   * The bytes live as long as their blockhash: 150 blocks, about thirty seconds on 200 ms slots — read from the chain
   * (`lib/solana/blockhash-life.ts`), not set by a clock. The ticket dies with them; the person may sign until a margin
   * before, and a Review signed later is built again on the page instead of being refused by the network.
   */
  const life = await readBlockhashLife((deps.chainReader ?? ((c: Connection) => web3ChainReader(c, CALL_MS)))(connection), built.validUntil);
  if (life.state === "EXPIRED") return failure(503, "UNAVAILABLE", "Solana answered with a blockhash that has already expired. Nothing was built.");
  const ttlMs = Math.min(life.state === "LIVE" ? life.msLeft : BLOCKHASH_LIFE_BLOCKS * life.msPerSlot, TICKET_TTL_MS);
  const signableMs = Math.min(signableWindowMs(life), Math.max(0, ttlMs - BLOCKHASH_SUBMIT_MARGIN_MS));
  const cosign = sealCosigners(cosigners, env);
  const issuedAt = now();
  const lookups = zap && zap.tables.length ? { lookups: zap.tables.map((table) => table.key.toBase58()) } : {};
  const ticket = issueTicket({ owner, venue: built.venue, action: built.action, pool: built.pool, position: built.position, messages: digests, cosign, ...lookups }, env, issuedAt, ttlMs);
  if (!ticket) return failure(503, "ACTIONS_UNAVAILABLE", "The server cannot seal a Review now.");
  const expiresAt = issuedAt + signableMs;
  return { ok: true, value: { transactions, ticket, expiresAt, signableMs, networkFeeLamports: fee.toString() } };
}

/** An error for the server's log: no address of an endpoint, which may carry its key. */
export function redacted(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/https?:\/\/[^\s"')]+/g, "<endpoint>").slice(0, 200);
}

class CanaryRefusal extends Error {
  readonly code: "CANARY_UNPRICED" | "CANARY_LIMIT";
  constructor(code: "CANARY_UNPRICED" | "CANARY_LIMIT", message: string) {
    super(message);
    this.code = code;
  }
}

/* ------------------------------------------------------------------ relay */

/** The whole relay, kept under the route's own limit with room for one late answer. */
const RELAY_MS = 40_000;
/** No single call to an endpoint waits longer than this: a hung socket does not hold the answer past the route's limit. */
const CALL_MS = 8_000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The endpoint did not answer in time.")), Math.max(1, ms));
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Where each signature stands on the chain now: landed, failed, or not seen yet. Read-only; for the relay and the status route. */
export async function signatureStates(connection: Connection, signatures: readonly string[], ms = CALL_MS): Promise<readonly Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; reason: string | null }>[]> {
  const answer = await within(connection.getSignatureStatuses([...signatures], { searchTransactionHistory: true }), ms);
  return answer.value.map((status) => {
    if (status?.err) return { state: "FAILED" as const, reason: JSON.stringify(status.err).slice(0, 200) };
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { state: "LANDED" as const, reason: null };
    return { state: "UNKNOWN" as const, reason: null };
  });
}

async function landed(connection: Connection, signature: string, deadline: number, pollMs: number): Promise<Readonly<{ state: "LANDED" | "FAILED" | "UNKNOWN"; reason: string | null }>> {
  while (Date.now() < deadline) {
    const status = await within(connection.getSignatureStatuses([signature]), Math.min(CALL_MS, deadline - Date.now())).then((answer) => answer.value[0]).catch(() => undefined);
    if (status?.err) return { state: "FAILED", reason: JSON.stringify(status.err).slice(0, 200) };
    if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return { state: "LANDED", reason: null };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { state: "UNKNOWN", reason: null };
}

export async function submitLiquidityAction(body: unknown, deps: ActionDeps): Promise<Readonly<{ ok: true; value: LiquidityRelay }> | ActionFailure> {
  const env = deps.env;
  const now = deps.now ?? Date.now;
  if (!body || typeof body !== "object") return failure(400, "BAD_REQUEST", "A relay takes a ticket and the signed transactions.");
  const { ticket: sealed, signed } = body as Record<string, unknown>;
  if (!Array.isArray(signed)) return failure(400, "BAD_REQUEST", "A relay takes a ticket and the signed transactions.");
  const read = readTicket(sealed, env, now());
  if (!read.ok) return read.code === "TICKET_EXPIRED" ? failure(410, "TICKET_EXPIRED", "The Review is older than its transactions; review again.") : failure(400, "TICKET_INVALID", "The Review's ticket is not one this server sealed.");
  const { ticket } = read;
  if (!admitLiquidityAction(ticket.owner, env).ok) return failure(403, "ACTIONS_CLOSED", "Pool actions are not open for this wallet now.");
  const cosigners = openCosigners(ticket.cosign, env);
  if (!cosigners) return failure(400, "TICKET_INVALID", "The Review's ticket is not one this server sealed.");
  const connection = deps.connections[0];
  if (!connection) return failure(503, "UNAVAILABLE", "No Solana endpoint is configured.");
  /* Version-0 bytes (a Zap) are resolved with the very tables the Review sealed: read again, as a table only grows. */
  let tables: readonly AddressLookupTableAccount[] = [];
  if (ticket.lookups?.length) {
    const read = await (deps.lookupTables ?? readLookupTables)(connection, ticket.lookups).catch(() => null);
    if (!read || read.length !== ticket.lookups.length) return failure(503, "UNAVAILABLE", "Solana did not answer for the Review's lookup tables. Nothing was sent.");
    tables = read;
  }
  const checked = checkSigned(ticket, signed, cosigners, tables);
  if (!checked.ok) return failure(422, checked.code, checked.code === "NOT_SIGNED" ? "A signature is missing or does not match." : "The signed bytes are not the ones Review showed.");

  const deadline = Date.now() + (deps.relayMs ?? RELAY_MS);
  const results: { signature: string; state: RelayState; reason: string | null }[] = checked.signatures.map((signature) => ({ signature, state: "NOT_SENT", reason: null }));
  for (const [index, wire] of checked.wires.entries()) {
    const result = results[index]!;
    if (Date.now() >= deadline) break;
    try {
      await within(connection.sendRawTransaction(Buffer.from(wire, "base64"), { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }), Math.min(CALL_MS, deadline - Date.now()));
    } catch (error) {
      const message = redacted(error);
      /*
       * A preflight refusal means the network never took the bytes — unless it refused them as already processed, which
       * is the same bytes sent before and is read from the chain like any other send. Anything else (a timeout, a
       * dropped connection) may have landed, so the chain is asked.
       */
      if (/simulation failed|preflight|blockhash not found/i.test(message) && !/already been processed|AlreadyProcessed/i.test(message)) {
        result.state = "FAILED";
        result.reason = message;
        if (index === 0) {
          console.warn(`liquidity relay: ${ticket.venue} ${ticket.action} refused before sending — ${message}`);
          return failure(422, /blockhash not found/i.test(message) ? "TICKET_EXPIRED" : "SIMULATION_FAILED", "The network refused the transaction before it was sent. Nothing moved.");
        }
        break;
      }
    }
    const answer = await landed(connection, result.signature, deadline, deps.pollMs ?? 1_500);
    result.state = answer.state;
    result.reason = answer.reason;
    if (answer.state !== "LANDED") break;
  }
  deps.forget(ticket.owner);
  console.info(`liquidity relay: ${ticket.venue} ${ticket.action} ${results.map((r) => `${r.signature.slice(0, 8)}=${r.state}`).join(" ")}`);
  return { ok: true, value: { results, settled: results.every((r) => r.state === "LANDED") } };
}

export type { GatedAction, TicketAction };
