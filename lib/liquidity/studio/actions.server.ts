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
import { reviewLiquidityAction as review, signatureStates, submitLiquidityAction as submit, type ActionDeps } from "./actions.ts";
import type { LiquidityVenueAdapter, LiquidityVenueId } from "./contract.ts";
import { liquidityVenues } from "./venues.server.ts";

const venueCache = new WeakMap<Connection, Readonly<Record<LiquidityVenueId, LiquidityVenueAdapter>>>();

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
  };
}

export function reviewLiquidityAction(body: unknown) {
  return review(body, deps());
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

export type { LiquidityRelay, LiquidityReview, RelayState } from "./actions.ts";
