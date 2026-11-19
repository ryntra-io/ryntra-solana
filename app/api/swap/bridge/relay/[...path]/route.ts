import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { mutationOriginAllowed } from "@/lib/security";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { RELAY_API_ORIGIN } from "@/lib/relay/chains";
import { relayHeaders, relayJsonHeaders } from "@/lib/relay/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * The few calls the Relay SDK makes from the Bridge page while it carries an order, passed to Relay from
 * this server: the site's policy lets a page talk only to itself, and Ryntra's Relay key stays here. Nothing else
 * passes — not a quote (that is `/api/swap/bridge/quote`, read back before a browser sees it), not any other path:
 *
 * - `GET /chains` — the networks, so the SDK can switch a wallet to one, or add it to the wallet that lacks it;
 * - `GET /intents/status[/v2|/v3]?requestId=0x…` — where an order is;
 * - `POST /transactions/index`, `/transactions/single` — «this transaction is ours», so Relay sees a deposit sooner.
 *
 * No signature passes (a permit, an authorisation): the Bridge offers no quote that asks for one, and an answer that
 * would add steps for a wallet to sign is never handed to the page. A write comes only from this site's own pages.
 */
const STATUS = /^\/intents\/status(\/v[23])?$/;
const POSTS = new Set(["/transactions/index", "/transactions/single"]);
const MAX_BODY = 64 * 1_024;

async function pass(request: Request, params: Promise<{ path: string[] }>, method: "GET" | "POST") {
  const rate = consumeSolanaReadRequest(request.headers);
  const headers = { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
  const fail = (status: number, code: string) => Response.json({ error: { code } }, { status, headers });
  if (!rate.allowed) return fail(429, "RATE_LIMITED");

  const path = `/${(await params).path.join("/")}`;
  const incoming = new URL(request.url);
  const target = new URL(path, RELAY_API_ORIGIN);
  const apiKey = resolveRelayApiKey();
  let init: RequestInit;
  if (method === "GET" && path === "/chains") {
    init = { method, headers: relayHeaders({ apiKey }) };
  } else if (method === "GET") {
    const requestId = incoming.searchParams.get("requestId") ?? "";
    if (!STATUS.test(path) || !/^0x[0-9a-fA-F]{64}$/.test(requestId)) return fail(404, "NOT_PASSED");
    target.searchParams.set("requestId", requestId);
    init = { method, headers: relayHeaders({ apiKey }) };
  } else {
    if (!POSTS.has(path)) return fail(404, "NOT_PASSED");
    if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) return fail(403, "ORIGIN_REFUSED");
    const text = await request.text();
    if (text.length > MAX_BODY) return fail(413, "TOO_LARGE");
    try {
      JSON.parse(text);
    } catch {
      return fail(400, "NOT_JSON");
    }
    init = { method, headers: relayJsonHeaders({ apiKey }), body: text };
  }
  try {
    const answer = await fetch(target, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const payload = await answer.text();
    // Nothing that would add a step for the wallet reaches the page.
    if (method === "POST" && /"steps"\s*:/.test(payload)) return fail(502, "NOT_PASSED");
    return new Response(payload, { status: answer.status, headers: { ...headers, "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return fail(502, "RELAY_UNREACHABLE");
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return pass(request, params, "GET");
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  return pass(request, params, "POST");
}
