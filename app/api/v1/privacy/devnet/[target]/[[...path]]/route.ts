import { NextResponse } from "next/server";

import { FixedWindowLimiter, clientIp, rateLimitHeaders } from "@/lib/http-control";
import { privateNetwork } from "@/lib/privacy/network";
import { MAX_ANSWER_BYTES, MAX_BODY_BYTES, passInHeaders, passOutHeaders, rpcAllowed, sameSite, upstreamUrl } from "@/lib/privacy/relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `/api/v1/privacy/devnet/{rpc|spr|policy}/**` — Ryntra's relay to Helius devnet for the private balance (Ryntra Private).
 *
 * The browser's Privacy Rings SDK sends every HTTP call here; the relay adds the Helius key server-side and forwards
 * the bytes; `policy` hands over the prover's signed devnet policy, which the site's content policy keeps the browser
 * from fetching itself. Prover requests are encrypted to the attested enclave, so the relay carries ciphertext it cannot read; no
 * body is logged or kept. It builds nothing and signs nothing: transactions arrive signed by the person's wallet.
 * Devnet only, and only while `NEXT_PUBLIC_RYNTRA_PRIVATE=devnet` — otherwise every path is 404.
 */

/* Per address, per warm instance: a person's balance read and a proof take a few dozen calls. A limit shared across
   instances needs a store the relay does not have yet — before the flag is opened beyond the stand, it gets one. */
const limiter = new FixedWindowLimiter({ limit: 300, windowMs: 60_000, maxKeys: 10_000 });

type Params = { params: Promise<{ target: string; path?: string[] }> };

async function relay(request: Request, { params }: Params): Promise<Response> {
  const key = process.env.HELIUS_DEVNET_API_KEY?.trim() ?? "";
  if (!privateNetwork() || !key) return new NextResponse(null, { status: 404 });
  const self = new URL(request.url);
  if (!sameSite(request.headers)) return new NextResponse(null, { status: 403 });
  const rate = limiter.consume(clientIp(request.headers));
  if (!rate.allowed) return new NextResponse(null, { status: 429, headers: rateLimitHeaders(rate) });

  const { target, path = [] } = await params;
  const upstream = upstreamUrl(target, path, self.search, key);
  if (!upstream) return new NextResponse(null, { status: 404 });

  let body: ArrayBuffer | undefined;
  if (request.method === "POST") {
    // The size is checked before the body is read, and again after (a body may come without a length).
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
    if (target === "rpc") {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(new TextDecoder().decode(body));
      } catch {
        parsed = null;
      }
      if (!rpcAllowed(parsed)) return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Method not served here." } }, { status: 200 });
    }
  } else if (target === "rpc") {
    return new NextResponse(null, { status: 405 });
  }
  if (target === "policy" && request.method !== "GET") return new NextResponse(null, { status: 405 });

  const answer = await fetch(upstream, { method: request.method, headers: passInHeaders(request.headers), body, cache: "no-store", signal: AbortSignal.timeout(55_000) }).catch(() => null);
  if (!answer) return new NextResponse(null, { status: 502, headers: { "cache-control": "no-store" } });
  const headers = passOutHeaders(answer.headers);
  for (const [name, value] of Object.entries(rateLimitHeaders(rate))) headers.set(name, value);
  if (Number(answer.headers.get("content-length") ?? 0) > MAX_ANSWER_BYTES) return new NextResponse(null, { status: 502, headers: { "cache-control": "no-store" } });
  const bytes = await answer.arrayBuffer();
  if (bytes.byteLength > MAX_ANSWER_BYTES) return new NextResponse(null, { status: 502, headers: { "cache-control": "no-store" } });
  return new NextResponse(bytes, { status: answer.status, headers });
}

export const GET = relay;
export const POST = relay;
