import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders } from "@/lib/http-control";
import { resolveRelayApiKey } from "@/lib/relay/api-key.server";
import { chainById, fetchBridgeChains } from "@/lib/relay/bridge-chains";
import { RELAY_EVM_NATIVE_ADDRESS } from "@/lib/relay/chains";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * How much of a coin an EVM wallet holds on a network: the Bridge's «available» and its MAX. Read from the
 * network's public RPC as Relay's index lists it — by this server, since a page may not reach it — and only on an EVM
 * network; Solana balances come from the terminal's own wallet read. A read that fails is «unknown», never zero.
 *
 * `GET ?chain=<id>&token=<address>&owner=<0x…>` → `{ raw }`
 */
const HEX40 = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  const headers = { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
  const fail = (status: number, code: string) => Response.json({ error: { code } }, { status, headers });
  if (!rate.allowed) return fail(429, "RATE_LIMITED");
  const params = new URL(request.url).searchParams;
  const chainId = Number(params.get("chain"));
  const token = params.get("token") ?? "";
  const owner = params.get("owner") ?? "";
  if (!Number.isSafeInteger(chainId) || !HEX40.test(owner) || !(HEX40.test(token) || token === RELAY_EVM_NATIVE_ADDRESS)) return fail(400, "VALIDATION_ERROR");

  const index = await fetchBridgeChains({ apiKey: resolveRelayApiKey() });
  const chain = index.ok ? chainById(index.chains, chainId) : null;
  if (!chain || chain.vm !== "evm" || !chain.rpc) return fail(404, "UNKNOWN_CHAIN");

  const native = token.toLowerCase() === RELAY_EVM_NATIVE_ADDRESS;
  const call = native
    ? { method: "eth_getBalance", params: [owner, "latest"] }
    : { method: "eth_call", params: [{ to: token, data: `0x70a08231${owner.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"] };
  try {
    const answer = await fetch(chain.rpc, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...call }),
      signal: AbortSignal.timeout(6_000),
      cache: "no-store",
    });
    const payload = (await answer.json()) as { result?: unknown };
    if (typeof payload.result !== "string" || !/^0x[0-9a-fA-F]*$/.test(payload.result)) return fail(502, "UNREADABLE");
    const raw = payload.result === "0x" ? "0" : BigInt(payload.result.length > 66 ? payload.result.slice(0, 66) : payload.result).toString();
    return Response.json({ raw }, { headers });
  } catch {
    return fail(502, "UNREACHABLE");
  }
}
