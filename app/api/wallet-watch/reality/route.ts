import { NextRequest, NextResponse } from "next/server";

import { getGuardRuntime } from "@/lib/guard/runtime";
import { clientIp, FixedWindowLimiter, privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { readRealityInputs } from "@/lib/wallet-watch/paths.server";
import { isAddress, readActivity } from "@/lib/wallet-watch/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * «Реальність послідовника» (SOL-R3): what a wallet's result is made of for someone who copies it — the wallet's
 * trades as «Стеження за гаманцями» already read them, the pools' bars around each one and each token's price and
 * liquidity now. The page figures the follower's result from them (`followerReality`) for the size, delay and
 * tolerance a person picks, without asking again. Public, as the wallet itself: ten reads a minute from an address.
 * Reads only.
 */

const LIMITER = new FixedWindowLimiter({ limit: 10, windowMs: 60_000, maxKeys: 5_000 });
/* One answer per wallet kept a minute: a page opened by many people, or reopened, reads the source once. */
const ANSWER_TTL_MS = 60_000;
const answers = new Map<string, { body: Record<string, unknown>; newest: string | null; at: number }>();

function json(body: Record<string, unknown>, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...privateNoStoreHeaders(), ...extra } });
}

export async function GET(req: NextRequest) {
  const wallet = (new URL(req.url).searchParams.get("wallet") ?? "").trim();
  if (!isAddress(wallet)) return json({ error: "bad request", code: "NOT_AN_ADDRESS" }, 400);
  const limit = LIMITER.consume(clientIp(req.headers));
  if (!limit.allowed) return json({ error: "rate limited", code: "RATE_LIMITED" }, 429, rateLimitHeaders(limit));
  /* The wallet's trades as its page read them: this read asks the chain nothing. */
  const activity = await readActivity(getGuardRuntime().store, wallet).catch(() => null);
  if (!activity) return json({ error: "not read", code: "NOT_READ" }, 404);
  const nowMs = Date.now();
  const hit = answers.get(wallet);
  if (hit && nowMs - hit.at < ANSWER_TTL_MS && hit.newest === activity.newest) return json(hit.body);
  const inputs = await readRealityInputs(activity.trades, nowMs).catch(() => null);
  if (!inputs) return json({ error: "unavailable", code: "SOURCE_UNREAD" }, 503);
  /* Every trade goes: a token not read, or not priceable, is said by the page — and counted in what was left out. */
  const body = { ok: true, wallet, asOf: Math.floor(nowMs / 1000), trades: activity.trades, ...inputs };
  /* A degraded answer — no SOL price, or a token not read — is not kept: the next look reads again. */
  if (inputs.solUsd !== null && !inputs.unmeasured.some((row) => row.reason === "NOT_READ")) answers.set(wallet, { body, newest: activity.newest, at: nowMs });
  if (answers.size > 2_000) for (const [key, kept] of answers) if (nowMs - kept.at >= ANSWER_TTL_MS) answers.delete(key);
  return json(body);
}
