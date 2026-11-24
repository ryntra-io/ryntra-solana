import { NextResponse } from "next/server";

import { jupiterUsd } from "@/lib/earn-pools/market-price";
import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "@/lib/http-control";
import { answerFor, stateOf, type AnswerDeps } from "@/lib/privacy/gate/answer";
import { ADDRESS, MAX_ADDRESSES, answerJson } from "@/lib/privacy/gate/core";
import { gateSettings } from "@/lib/privacy/gate/settings";
import { sourceFor } from "@/lib/privacy/gate/sources";
import { sameSite } from "@/lib/privacy/relay";
import { openNetwork } from "@/lib/privacy/relay-key.server";
import { nativeSolPriceMint } from "@/lib/solana/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * `/api/v1/privacy/gate` — the rules before people's money in the private balance (`lib/privacy/gate/**`).
 *
 * - `GET` — the gate's state: whether new deposits are paused, and the starting cap in lamports at today's price.
 *   No address goes in.
 * - `POST { addresses: [owner, recipient?] }` — «may these addresses»: a mark for each — `clear`, `flagged` or
 *   `unchecked` (the list source did not answer in time) — with the same state. Never which list marked an address.
 *   Addresses travel in the body, not in the address line, so they do not land in request logs; nothing is logged or
 *   kept here.
 *
 * The decision itself — pass, refuse, or only back to the person's own wallet — is `decide()` in the browser, with the
 * person's balance, which never comes here. A list provider's key, when one is chosen, is a server variable of its
 * adapter and never reaches an answer. Shut (404) unless `NEXT_PUBLIC_RYNTRA_PRIVATE` opens a network
 * (`devnet`, or `mainnet` with its key), like the relay.
 */

/* Per address, per warm instance: a person asks before each step, a few times a minute at most. */
const limiter = new FixedWindowLimiter({ limit: 60, windowMs: 60_000, maxKeys: 10_000 });

const MAX_BODY_BYTES = 1_024;
const NO_STORE = { "cache-control": "no-store" };

async function solUsd(): Promise<number | null> {
  const mint = nativeSolPriceMint();
  return (await jupiterUsd([mint]))[mint] ?? null;
}

function deps(): AnswerDeps {
  const settings = gateSettings(process.env);
  return { settings, source: sourceFor(settings), testNetwork: openNetwork() === "devnet", solUsd };
}

/** The addresses a question carries, or null when the body is not one. */
function addressesIn(body: unknown): readonly string[] | null {
  const list = (body as { addresses?: unknown } | null)?.addresses;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ADDRESSES) return null;
  if (!list.every((a): a is string => typeof a === "string" && ADDRESS.test(a))) return null;
  return [...new Set(list)];
}

export async function GET(request: Request): Promise<Response> {
  if (!openNetwork()) return new NextResponse(null, { status: 404 });
  const rate = limiter.consume(clientIp(request.headers));
  if (!rate.allowed) return new NextResponse(null, { status: 429, headers: rateLimitHeaders(rate) });
  const state = await stateOf(deps());
  return NextResponse.json(answerJson({ ...state, marks: {} }), { headers: { ...NO_STORE, ...rateLimitHeaders(rate) } });
}

export async function POST(request: Request): Promise<Response> {
  if (!openNetwork()) return new NextResponse(null, { status: 404 });
  if (!sameSite(request.headers)) return new NextResponse(null, { status: 403 });
  const rate = limiter.consume(clientIp(request.headers));
  if (!rate.allowed) return new NextResponse(null, { status: 429, headers: rateLimitHeaders(rate) });

  // The size is checked before the body is read, and again after (a body may come without a length).
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const addresses = addressesIn(body);
  if (!addresses) return new NextResponse(null, { status: 400, headers: NO_STORE });

  const answer = await answerFor(addresses, deps());
  return NextResponse.json(answerJson(answer), { headers: { ...NO_STORE, ...rateLimitHeaders(rate) } });
}
