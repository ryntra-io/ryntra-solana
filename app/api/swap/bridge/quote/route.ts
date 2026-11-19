import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { bridgeAddressOk, chainById, depositSenderOf, fetchBridgeChains } from "@/lib/relay/bridge-chains";
import { bridgeFacts, checkBridgeQuote, fetchBridgeQuote, type BridgeQuoteRequest } from "@/lib/relay/bridge-quote";
import { mutationOriginAllowed } from "@/lib/security";
import { serviceFeeRateFor } from "@/lib/swap/service-fee";
import { resolveServiceFeeConfig } from "@/lib/swap/service-fee.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * One Bridge quote: any coin on any network Relay carries into any coin on any other, one Relay order —
 * the transfer and the swaps on both sides together.
 *
 * The answer is Relay's own quote, which the page's Relay SDK executes step by step in the person's wallet, and the
 * facts the page shows. It is returned only after it is read back against the question (`checkBridgeQuote`): the
 * recipient is the address given, the refunds go to the person, the coins and the amount are the ones chosen, and every
 * call a wallet is asked to sign is Relay's own. Ryntra's fee is the engine's.
 *
 * `user` is the wallet that signs on the origin; null asks for a deposit address — the way money leaves a network no
 * wallet on this page signs on (Bitcoin, Tron, TON…), for this amount and this order only.
 *
 * `preview` prices the way before a wallet is connected: Relay is asked with the burn address of each machine in
 * place of a wallet that is not there yet, and only the facts come back — never a quote anything could execute.
 */
const Coin = z.object({ chain: z.number().int().positive(), token: z.string().min(1).max(90) }).strict();
const RequestSchema = z
  .object({
    from: Coin,
    to: Coin,
    amount: z.string().regex(/^[1-9][0-9]{0,77}$/),
    user: z.string().min(1).max(90).nullable(),
    recipient: z.string().min(1).max(90).nullable(),
    preview: z.boolean().default(false),
  })
  .strict();

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  const headers = { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
  const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => Response.json({ error: { code, message, ...extra } }, { status, headers });
  if (!rate.allowed) return fail(429, "RATE_LIMITED", "Too many requests.");
  // Asked only by this site's own pages: the quote carries Ryntra's Relay key.
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) return fail(403, "ORIGIN_REFUSED", "Refused.");

  const body = await readAgentControlJson(request);
  if (!body.ok) return fail(body.status, body.code, "The request body was not accepted.");
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "The quote request did not match its schema.");
  const input = parsed.data;

  const apiKey = resolveRelayApiKey();
  const index = await fetchBridgeChains({ apiKey });
  if (!index.ok) return fail(502, "CHAINS_UNAVAILABLE", "The networks could not be read right now.");
  const origin = chainById(index.chains, input.from.chain);
  const destination = chainById(index.chains, input.to.chain);
  if (!origin || !destination) return fail(409, "UNKNOWN_CHAIN", "That network is not carried right now.");
  const preview = input.preview;
  if (!preview && (input.user === null ? !origin.depositAddress : origin.wallet === null || !bridgeAddressOk(origin.vm, input.user))) {
    return fail(400, "SENDER_INVALID", "Money cannot leave that network from here.");
  }
  if (preview && input.user !== null && !bridgeAddressOk(origin.vm, input.user)) return fail(400, "SENDER_INVALID", "Money cannot leave that network from here.");
  if (input.recipient !== null ? !bridgeAddressOk(destination.vm, input.recipient) : !preview) return fail(400, "RECIPIENT_INVALID", "That address is not an address on the receiving network.");
  if (origin.id === destination.id && input.from.token.toLowerCase() === input.to.token.toLowerCase()) return fail(400, "SAME_COIN", "Pick two different coins or networks.");

  const feeConfig = resolveServiceFeeConfig();
  const ask: BridgeQuoteRequest = {
    origin,
    destination,
    fromToken: input.from.token,
    toToken: input.to.token,
    amountRaw: input.amount,
    user: preview ? (input.user ?? depositSenderOf(origin)) : input.user,
    recipient: input.recipient ?? depositSenderOf(destination),
    appFee: feeConfig.relayAppFeeRecipient ? { recipient: feeConfig.relayAppFeeRecipient, bps: serviceFeeRateFor("RELAY_APP_FEE") } : null,
  };
  const result = await fetchBridgeQuote(ask, { apiKey });
  if (!result.ok) {
    const status = result.code === "RATE_LIMITED" ? 429 : result.code === "NO_ROUTE" || result.code === "AMOUNT_TOO_SMALL" || result.code === "AMOUNT_TOO_LARGE" ? 409 : 502;
    return fail(status, `QUOTE_${result.code}`, "Relay has no way for this right now.");
  }
  const check = checkBridgeQuote(result.quote, ask, { preview });
  if (!check.ok) return fail(409, check.code, "Relay's answer did not match the request; nothing was offered.", { field: check.field });
  const facts = bridgeFacts(result.quote, !preview && input.user === null);
  // A deposit address is shown only when it has the shape of an address on the network the money leaves.
  if (facts.mode === "deposit" && (!facts.depositAddress || !bridgeAddressOk(origin.vm, facts.depositAddress))) return fail(409, "QUOTE_MISMATCH", "Relay's answer did not match the request; nothing was offered.", { field: "depositAddress" });
  if (preview) return Response.json({ quote: null, facts: { ...facts, requestId: null, depositAddress: null }, preview: true, observedAt: new Date().toISOString() }, { headers });
  return Response.json({ quote: result.quote, facts, preview: false, observedAt: new Date().toISOString() }, { headers });
}
