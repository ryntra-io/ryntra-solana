import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { RELAY_API_ORIGIN } from "@/lib/relay/chains";
import {
  depositAddressRequest,
  depositProgressOf,
  EVM_ADDRESS,
  isDepositNetwork,
  parseDepositAddress,
  RELAY_QUOTE_V2_PATH,
  SOLANA_ADDRESS,
} from "@/lib/relay/deposit-address";
import { relayHeaders, relayJsonHeaders } from "@/lib/relay/http";
import { RELAY_REFERRER } from "@/lib/relay/quote-api";
import { RELAY_REQUESTS_V3_PATH } from "@/lib/relay/requests-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * «Поповнити з іншої мережі чи біржі» — an address to send USDC to (SOL-W1).
 *
 * `POST {network, recipient}` asks Relay for an open deposit address on that
 * network whose fills pay USDC to `recipient` on Solana, checks the answer
 * against the question (`parseDepositAddress`) and returns the address, the
 * fee on a ten-dollar deposit and the time Relay expects. `GET
 * ?address=&since=` says what happened to money sent there since `since`
 * (Unix seconds) — so yesterday's filled deposit never reads as today's.
 *
 * Nothing here signs, holds or moves money: an address is a read of Relay's,
 * and the person's own exchange or wallet does the sending. The key, when
 * configured, is only what Relay asks for the requests read.
 */

const PostSchema = z
  .object({
    network: z.string(),
    recipient: z.string().regex(SOLANA_ADDRESS),
  })
  .strict();

function headers(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, rate: RateLimitDecision) {
  return Response.json({ error: { code } }, { status, headers: headers(rate) });
}

async function relayJson(url: string, init: RequestInit): Promise<Readonly<{ ok: boolean; status: number; body: unknown }>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, rate);
  const parsed = PostSchema.safeParse(body.value);
  if (!parsed.success || !isDepositNetwork(parsed.data.network)) return failure(400, "VALIDATION_ERROR", rate);
  const { network, recipient } = parsed.data;

  /* The key and the referrer travel together, as on every Relay quote here (`quote-api.ts`): a referrer without a key is a 401. */
  const apiKey = resolveRelayApiKey();
  const question = { ...depositAddressRequest(network, recipient), ...(apiKey === null ? {} : { referrer: RELAY_REFERRER }) };
  const answer = await relayJson(new URL(RELAY_QUOTE_V2_PATH, RELAY_API_ORIGIN).toString(), {
    method: "POST",
    headers: relayJsonHeaders({ apiKey }),
    body: JSON.stringify(question),
  });
  if (!answer.ok) return failure(502, "PROVIDER_UNAVAILABLE", rate);
  const deposit = parseDepositAddress(network, recipient, answer.body);
  /* An answer that does not match the question is not shown as an address. */
  if (!deposit.ok) return failure(502, deposit.reason, rate);
  return Response.json({ data: deposit.value }, { headers: headers(rate) });
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", rate);
  const params = new URL(request.url).searchParams;
  const address = params.get("address") ?? "";
  const since = Number(params.get("since"));
  if (!EVM_ADDRESS.test(address) || !Number.isInteger(since) || since < 0) return failure(400, "VALIDATION_ERROR", rate);
  const apiKey = resolveRelayApiKey();
  /* `/requests/v3` refuses an anonymous call; without a key the page simply waits for the wallet to change. */
  if (apiKey === null) return Response.json({ data: { progress: "UNKNOWN", amount: null, at: null } }, { headers: headers(rate) });
  const url = new URL(RELAY_REQUESTS_V3_PATH, RELAY_API_ORIGIN);
  url.searchParams.set("depositAddress", address);
  url.searchParams.set("startTimestamp", String(since));
  url.searchParams.set("sortBy", "createdAt");
  url.searchParams.set("sortDirection", "desc");
  url.searchParams.set("limit", "1");
  const answer = await relayJson(url.toString(), { method: "GET", headers: relayHeaders({ apiKey }) });
  if (!answer.ok) return Response.json({ data: { progress: "UNKNOWN", amount: null, at: null } }, { headers: headers(rate) });
  return Response.json({ data: depositProgressOf(answer.body) }, { headers: headers(rate) });
}
