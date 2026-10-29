import { PublicKey } from "@solana/web3.js";

import { clientIp, FixedWindowLimiter, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { forgetWalletPositions, hasFreshPositions, readWalletPositions } from "@/lib/liquidity/catalog/chain.server";
import { isPoolAddress, LIQUIDITY_POOL_KINDS, type CatalogPool, type LiquidityPoolKind } from "@/lib/liquidity/catalog/model";
import { positionView, rankPositions, type PositionsAnswer, type PositionView } from "@/lib/liquidity/catalog/positions";
import { peekPoolRecord, readPoolRecord, type PoolRecordRead } from "@/lib/liquidity/catalog/service.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * A wallet's Meteora DLMM and DAMM v2 positions, read from the programs'
 * accounts — what each holds, the fees it has earned and not claimed, and
 * whether the price is inside it — with USD values from the venue's token
 * prices. Positions are public on the chain; the route answers for any
 * address and keeps nothing past a short cache. Read-only: nothing here
 * builds a transaction.
 */

/*
 * Its own window, tighter than the cached reads': a miss here is two scans of
 * the programs' accounts on public endpoints. Only a miss is charged — a
 * wallet's answer from the last 25 s costs nothing — so a person going from
 * pool to pool never meets it, and a loop over many wallets does.
 */
const POSITIONS_LIMITER = new FixedWindowLimiter({ limit: 20, windowMs: 60_000, maxKeys: 5_000 });
const FREE: RateLimitDecision = { allowed: true, limit: 20, remaining: 20, resetAfterSeconds: 0, retryAfterSeconds: 0 };
/** The venue's records for USD prices: a few at a time (the DAMM v2 API allows ten a second), and never past this. */
const RECORDS_AT_ONCE = 4;
const RECORDS_MS = 5_000;

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

function isWalletKey(value: string): boolean {
  if (!isPoolAddress(value)) return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

/** Records for the pools, a few at a time, until the time runs out; a pool left unread shows its amounts without USD. */
async function readRecords(wanted: readonly Readonly<{ kind: LiquidityPoolKind; pool: string }>[]): Promise<Map<string, PoolRecordRead>> {
  let pools = wanted;
  const out = new Map<string, PoolRecordRead>();
  /* Records already kept cost nothing and wait for nothing; only the reads that go out are paced. */
  const misses = pools.filter((item) => {
    const kept = peekPoolRecord(item.kind, item.pool);
    if (kept) out.set(`${item.kind}:${item.pool}`, kept);
    return !kept;
  });
  pools = misses;
  const deadline = Date.now() + RECORDS_MS;
  let next = 0;
  /* Started at most eight a second, under the DAMM v2 API's ten. */
  let lastStart = 0;
  const worker = async () => {
    while (next < pools.length && Date.now() < deadline) {
      const item = pools[next++]!;
      const wait = lastStart + 125 - Date.now();
      lastStart = Math.max(Date.now(), lastStart + 125);
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      out.set(`${item.kind}:${item.pool}`, await readPoolRecord(item.kind, item.pool, { meteora: { timeoutMs: 3_000 } }));
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(Array.from({ length: RECORDS_AT_ONCE }, worker)), new Promise((resolve) => (timer = setTimeout(resolve, RECORDS_MS)))]);
  clearTimeout(timer);
  return out;
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const owner = params.get("owner") ?? "";
  /*
   * `fresh=1` — the page acted on a position a moment ago (B10's grids act in place): the answer kept for this wallet may
   * be from before the action, in this instance or another, so the chain is read again — and charged like any scan.
   */
  const fresh = params.get("fresh") === "1";
  const rate = !fresh && hasFreshPositions(owner) ? FREE : POSITIONS_LIMITER.consume(`liquidity-positions:${clientIp(request.headers)}`);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  if (!isWalletKey(owner)) return failure(400, "VALIDATION_ERROR", "A wallet is addressed by its Solana address.", rate);
  if (fresh) forgetWalletPositions(owner);
  const read = await readWalletPositions(owner);
  for (const kind of LIQUIDITY_POOL_KINDS) {
    const venue = read[kind];
    if (!venue.ok) console.warn(`liquidity positions: ${kind} not read — ${venue.reason.slice(0, 200)}`);
  }
  if (!read.dlmm.ok && !read["damm-v2"].ok) return failure(503, "UNAVAILABLE", "Solana did not answer for either venue.", rate);
  const wanted = new Map<string, Readonly<{ kind: LiquidityPoolKind; pool: string }>>();
  for (const kind of LIQUIDITY_POOL_KINDS) {
    const venue = read[kind];
    if (venue.ok) for (const position of venue.value) wanted.set(`${kind}:${position.pool}`, { kind, pool: position.pool });
  }
  const records = await readRecords([...wanted.values()]);
  const views: PositionView[] = [];
  for (const kind of LIQUIDITY_POOL_KINDS) {
    const venue = read[kind];
    if (!venue.ok) continue;
    for (const position of venue.value) {
      const record = records.get(`${kind}:${position.pool}`);
      const pool: CatalogPool | null = record?.pool ?? null;
      views.push(positionView(position, kind, pool, record?.at ?? null));
    }
  }
  const answer: PositionsAnswer = {
    owner,
    positions: rankPositions(views),
    venues: { dlmm: { ok: read.dlmm.ok }, "damm-v2": { ok: read["damm-v2"].ok } },
    at: Date.now(),
  };
  return Response.json(answer, { headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}
