/**
 * The chain read behind buying credits (AI-12): `lib/pay`'s own observation of
 * a reference — every successful transaction carrying it, reduced to what
 * reached the treasury in which mint — on the payment page's RPC handle.
 *
 * The agent stand alone (`next dev`, `RYNTRA_ASSISTANT_STAND_CHAIN=1`) reads a
 * pretend chain where an order is paid in full twenty seconds after it opens,
 * so the eyes see the order waiting, paid and its receipt with no money. A
 * production build or any Vercel deployment never has it.
 */

import { readReferencePayments } from "../../pay/observe.ts";
import { paymentReadHandle } from "../../pay/public.ts";
import { base58Encode } from "../../solana/mint.ts";
import type { ReadReference } from "./purchase.ts";

export const STAND_CHAIN_ENV = "RYNTRA_ASSISTANT_STAND_CHAIN";
const STAND_PAID_AFTER_MS = 20_000;

export function standChainOn(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  /* Three locks: the build's own NODE_ENV (inlined), the runtime's, and no Vercel deployment of any kind. */
  if (process.env.NODE_ENV === "production" || env.NODE_ENV === "production" || env.VERCEL_ENV || env.VERCEL) return false;
  return env[STAND_CHAIN_ENV]?.trim() === "1";
}

/** The stand's pretend chain: the order's price, in its mint, twenty seconds after it opened. */
export const standChain: ReadReference = async (request) => {
  const paidAt = Date.parse(request.createdAt) + STAND_PAID_AFTER_MS;
  if (Date.now() < paidAt || request.amountRaw === null) return { ok: true, payments: [] };
  const bytes = new Uint8Array(64);
  const seed = new TextEncoder().encode(request.reference);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = (seed[i % seed.length] * 31 + i * 7) & 0xff;
  return { ok: true, payments: [{ signature: base58Encode(bytes), creditedRaw: request.amountRaw, mint: request.mint, payer: null, blockTime: new Date(paidAt).toISOString() }] };
};

export function chainReference(): ReadReference {
  if (standChainOn()) return standChain;
  const handle = paymentReadHandle();
  return (request) => readReferencePayments(handle, request);
}
