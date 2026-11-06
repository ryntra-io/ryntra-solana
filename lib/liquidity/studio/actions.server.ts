/**
 * The pool actions wired for the routes: the endpoints a wallet's positions
 * are read from (they answer the owner-indexed reads the build needs), the two
 * Meteora venues on each, the venue's token prices for the canary's ceiling,
 * and the positions cache a relay clears. The logic is `actions.ts`.
 */

import "server-only";

import { Keypair, type Connection } from "@solana/web3.js";

import { KIND_OF_VENUE, forgetWalletPositions, positionsConnections } from "../catalog/chain.server.ts";
import { readPoolRecord } from "../catalog/service.server.ts";
import { FEE_POLICY_V2, WRAPPED_SOL_MINT } from "../../core/fee-policy.ts";
import { buildFeeFor, feePolicyInForce, flowOfSwap } from "../../core/solana-swap/fee-route.server.ts";
import { resolveJupiterSwapEndpoint } from "../../solana/quotes.ts";
import { createSolanaRpcHandle } from "../../solana/rpc.ts";
import { reviewLimitAction as reviewLimit, reviewLiquidityAction as review, reviewZapAction as reviewZap, signatureStates, submitLiquidityAction as submit, type ActionDeps } from "./actions.ts";
import type { LiquidityVenueAdapter, LiquidityVenueId } from "./contract.ts";
import type { LimitOrderView, LimitPool, LimitVenue } from "./limit-orders.ts";
import { limitVenue, liquidityVenues, zapVenue } from "./venues.server.ts";
import type { ZapFee, ZapVenue } from "./zap.ts";

const venueCache = new WeakMap<Connection, Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>>>();
const limitCache = new WeakMap<Connection, LimitVenue>();
function limitVenueFor(connection: Connection): LimitVenue {
  const known = limitCache.get(connection) ?? limitVenue(connection, freshKeypair);
  limitCache.set(connection, known);
  return known;
}

const zapCache = new WeakMap<Connection, ZapVenue>();
/** Jupiter's keyed production endpoint for the Zap's swap leg: the SDK asks `{apiUrl}/swap/v2/build` with the key. */
function zapJupiter(): Readonly<{ apiUrl: string; apiKey: string }> | null {
  const selection = resolveJupiterSwapEndpoint({ access: "production" });
  if (!selection.ok) return null;
  const apiKey = selection.authorizationHeaders()["x-api-key"];
  return apiKey ? { apiUrl: "https://api.jup.ag", apiKey } : null;
}
function zapVenueFor(connection: Connection): ZapVenue {
  const known = zapCache.get(connection) ?? zapVenue(connection, zapJupiter(), freshKeypair);
  zapCache.set(connection, known);
  return known;
}

/**
 * Ryntra's fee on a Zap's Jupiter leg, SOL → the pier's other coin: fee policy v2's own flow and rate on its `/build`
 * lane, into the fee wallet's wrapped-SOL account (the input side, exact before the signature). A flow whose lane is not
 * `/build`, an unread side («as now»), or a fee account the chain does not show — no fee, never a guess.
 */
async function zapFeeFor(outputMint: string): Promise<ZapFee | null> {
  if (feePolicyInForce() !== "v2") return null;
  const flow = await flowOfSwap(WRAPPED_SOL_MINT, outputMint).catch(() => null);
  if (!flow || FEE_POLICY_V2[flow].lane !== "BUILD" || FEE_POLICY_V2[flow].bps <= 0) return null;
  const read = await buildFeeFor(flow, WRAPPED_SOL_MINT, outputMint, createSolanaRpcHandle({ network: "mainnet" })).catch(() => null);
  if (!read?.ok || !read.fee || read.fee.side !== "INPUT" || read.fee.mint !== WRAPPED_SOL_MINT) return null;
  return { bps: read.fee.bps, account: read.fee.account, mint: read.fee.mint };
}

/*
 * The fresh keys builds made, by public key, until the Review that made them takes them (at once, in the same request).
 * They hold nothing; one left behind by a failed build is dropped after a minute.
 */
const FRESH_MS = 60_000;
const fresh = new Map<string, Readonly<{ key: Keypair; at: number }>>();
function freshKeypair(): Keypair {
  const now = Date.now();
  for (const [publicKey, held] of fresh) if (now - held.at > FRESH_MS) fresh.delete(publicKey);
  const key = Keypair.generate();
  fresh.set(key.publicKey.toBase58(), { key, at: now });
  return key;
}
function takeFreshKey(publicKey: string): Keypair | null {
  const held = fresh.get(publicKey);
  fresh.delete(publicKey);
  return held?.key ?? null;
}

function deps(): ActionDeps {
  return {
    env: process.env,
    connections: positionsConnections(),
    venuesFor(connection) {
      const known = venueCache.get(connection) ?? liquidityVenues(connection, freshKeypair);
      venueCache.set(connection, known);
      return known;
    },
    async pricesOf(venue, pool) {
      const read = await readPoolRecord(KIND_OF_VENUE[venue], pool, { meteora: { timeoutMs: 4_000 } });
      return { x: read.pool?.x.priceUsd ?? null, y: read.pool?.y.priceUsd ?? null, xMint: read.pool?.x.mint ?? null, yMint: read.pool?.y.mint ?? null };
    },
    forget: forgetWalletPositions,
    takeFreshKey,
    limitVenueFor,
    zapVenueFor,
    zapFeeFor,
  };
}

/** A Zap's Review (CITY-198): SOL into a new position of a SOL pier in one approval, or «Take the rest» of one. */
export function reviewZapAction(body: unknown) {
  return reviewZap(body, deps());
}

export function reviewLiquidityAction(body: unknown) {
  return review(body, deps());
}

/** A limit order's Review (CITY-97): place, cancel, or roll a filled order into the other side. */
export function reviewLimitAction(body: unknown) {
  return reviewLimit(body, deps());
}

/**
 * A wallet's limit orders, or one pool's limit facts, from the first endpoint that answers. Read-only; null when no
 * endpoint answered — never an empty list in place of a failure.
 */
export async function readLimitOrders(owner: string, pool?: string): Promise<readonly LimitOrderView[] | null> {
  for (const connection of positionsConnections()) {
    try {
      return await limitVenueFor(connection).orders(owner, pool ? { pool } : undefined);
    } catch (error) {
      if (error instanceof Error && error.name === "LiquidityRefusal") throw error;
    }
  }
  return null;
}

export async function readLimitPool(address: string): Promise<LimitPool | null> {
  for (const connection of positionsConnections()) {
    try {
      return await limitVenueFor(connection).pool(address);
    } catch (error) {
      if (error instanceof Error && error.name === "LiquidityRefusal") return null;
    }
  }
  return null;
}

export function submitLiquidityAction(body: unknown) {
  return submit(body, deps());
}

/** The chain's word on signatures a relay sent — for a receipt whose answer was lost on the way back. */
export async function readSignatureStates(signatures: readonly string[]) {
  const [connection] = positionsConnections();
  if (!connection) return null;
  try {
    return await signatureStates(connection, signatures);
  } catch {
    return null;
  }
}

export type { LimitReview, LiquidityRelay, LiquidityReview, RelayState, ZapReview } from "./actions.ts";
