import { PublicKey } from "@solana/web3.js";
import { z } from "zod";

import { requireWalletProof } from "@/lib/api/v1/proof";
import { readGridBot, type GridBot } from "@/lib/bots/grid";
import { readHangar } from "@/lib/bots/hangar/read.server";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { clientIp, FixedWindowLimiter, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «Ангар»: every bot a wallet runs, in one read — its pool positions (grids
 * and ranges), its limit orders at Jupiter Trigger V1 and on DLMM (single and
 * in ladders), and, for a wallet the request proved, its reminder rules —
 * with each bot's status, result against holding, last fill and who fills it,
 * the incomplete bundles and orphaned orders, and the Trigger V1 sunset note.
 *
 * Read-only: nothing here builds, signs or sends, and nothing is written.
 * `GET ?wallet=` reads what the chain and the venues hold; `POST` adds what
 * only the page that placed a bot keeps — its grids, the pools' entries and
 * the bundles it listed — and is a read all the same.
 */

const LIMITER = new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 });
const Base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const Raw = z.string().regex(/^\d{1,40}$/);

const EntrySchema = z
  .object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    usd: z.number().finite().nonnegative().nullable(),
    claimedUsd: z.number().finite().nonnegative(),
    at: z.number().int().positive(),
    source: z.enum(["ryntra", "typed"]),
  })
  .strict();

const BundleSchema = z
  .object({
    id: z.string().min(1).max(64),
    at: z.number().int().positive(),
    legs: z.array(z.object({ venue: z.enum(["trigger", "dlmm"]), inputMint: Base58, outputMint: Base58, makingRaw: Raw }).strict()).min(1).max(20),
  })
  .strict();

const BodySchema = z
  .object({
    wallet: Base58,
    grids: z.array(z.unknown()).max(50).default([]),
    entries: z.record(Base58, EntrySchema).default({}),
    bundles: z.array(BundleSchema).max(20).default([]),
  })
  .strict();

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

function isWalletKey(value: string): boolean {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

async function answer(request: Request, body: z.output<typeof BodySchema>, rate: RateLimitDecision) {
  if (!isWalletKey(body.wallet)) return failure(400, "VALIDATION_ERROR", "A wallet is addressed by its Solana address.", rate);
  if (Object.keys(body.entries).length > 50) return failure(400, "VALIDATION_ERROR", "Too many entries.", rate);
  /* Reminder rules are the person's own, not the chain's: read only for the wallet this request proved. */
  const proof = await requireWalletProof(request, "read").catch(() => null);
  const proven = Boolean(proof?.ok && proof.address === body.wallet);
  const grids = body.grids.map(readGridBot).filter((grid): grid is GridBot => grid !== null);
  const hangar = await readHangar(getGuardRuntime().store, { wallet: body.wallet, proven, grids, entries: body.entries, bundles: body.bundles });
  return Response.json(hangar, { headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  const rate = LIMITER.consume(`bots-hangar:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const parsed = BodySchema.safeParse({ wallet: new URL(request.url).searchParams.get("wallet") ?? "" });
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "A wallet is addressed by its Solana address.", rate);
  return answer(request, parsed.data, rate);
}

export async function POST(request: Request) {
  const rate = LIMITER.consume(`bots-hangar:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const text = await request.text().catch(() => "");
  if (text.length > 64_000) return failure(413, "TOO_LARGE", "The request is too large.", rate);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return failure(400, "VALIDATION_ERROR", "The body is not JSON.", rate);
  }
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", "The body does not match the Hangar's request.", rate);
  return answer(request, parsed.data, rate);
}
