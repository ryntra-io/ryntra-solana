import { z } from "zod";

import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import {
  baseRpcCall,
  createEvmRpcHandle,
  hexQuantityToDecimal,
  readBaseErc20Balance,
  readBaseErc20Decimals,
  type EvmChainId,
} from "@/lib/base/rpc";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { isSwapNetwork, resolveSwapAsset, type SwapNetwork } from "@/lib/swap/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

/**
 * What one wallet holds of one asset, on one EVM network. A read, and only a read.
 *
 * The swap surface needs this for the plainest reason there is: without a
 * balance there is no `Available` line and no 25/50/75/MAX, and a form that
 * cannot offer a share of the balance is a form people leave.
 *
 * ## Why this exists rather than the bridge's balance route
 *
 * `/api/solana/bridge/balances` answered this question for two chains, and it
 * answered it as *Circle's* question: it takes a CCTP direction, reads the
 * USDC contract that lane names and the native coin, and nothing else. Three
 * things follow that this surface cannot live with. A `robinhood` source has
 * no CCTP direction at all, so the card asked Ethereum instead and read a
 * stranger's chain. USDG is not USDC, so the asset the whole Robinhood Chain
 * lane exists for could never appear. And any token from the picker — which is
 * every token now — was never readable.
 *
 * So this route asks the question the swap form actually has: **this network,
 * this wallet, this asset**. It is deliberately not a widening of the bridge
 * route: that one still answers Circle's question for Circle's lanes, with the
 * allowance and the limits that only mean something there.
 *
 * The native coin comes back on every answer, whatever the asset is, because
 * gas is paid in it on all three chains. A person holding USDG and no ETH can
 * be told so before they type an amount rather than by a wallet refusal.
 */

const RequestSchema = z
  .object({
    network: z.string(),
    owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    /** A catalogue code (`USDC`, `USDG`, `ETH`) or a `0x` contract. */
    asset: z.string().min(1).max(64),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: responseHeaders(rate) });
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success || !isSwapNetwork(parsed.data.network)) {
    return failure(400, "VALIDATION_ERROR", "The balance request did not match its schema.", rate);
  }
  const network = parsed.data.network as SwapNetwork;
  const owner = parsed.data.owner.toLowerCase();

  /* Solana holdings are read by the route that already reads them, with the
     token-account and rent knowledge that only makes sense there. Answering
     for Solana here would be a second source of truth for the same figure. */
  if (network === "solana") {
    return failure(400, "NOT_AN_EVM_NETWORK", "Solana balances are read by /api/solana/holdings.", rate);
  }

  const resolved = resolveSwapAsset({ network, asset: parsed.data.asset });
  if (!resolved) return failure(400, "UNKNOWN_ASSET", "That is not an asset on this network.", rate);

  const handle = createEvmRpcHandle(network as EvmChainId);
  /* The contract for a token, and `null` for the network's own coin. A catalogue
     asset states it; anything else reached this point as a `0x` address, which
     is what it is. */
  const contract = resolved.catalog ? resolved.catalog.address : resolved.asset;

  const [native, token] = await Promise.all([
    baseRpcCall<string>(handle, "eth_getBalance", [owner, "latest"]),
    contract === null ? Promise.resolve(null) : readBaseErc20Balance(handle, { token: contract, owner }),
  ]);

  const nativeRaw = native.ok ? hexQuantityToDecimal(native.value) : null;

  /* Decimals decide what a figure means, so they are never guessed. The
     catalogue states them for the assets it names; every other token is asked
     directly, on the same handle, in the same round of reads. */
  let decimals = resolved.decimals;
  if (contract !== null && decimals === null) {
    const read = await readBaseErc20Decimals(handle, { token: contract });
    decimals = read.ok ? read.value : null;
  }

  const raw = contract === null ? nativeRaw : token && token.ok ? token.value : null;
  const reason = contract === null ? (native.ok ? null : native.reason) : token && !token.ok ? token.reason : null;

  return Response.json(
    {
      data: {
        network,
        owner,
        asset: resolved.catalog ? resolved.catalog.code : resolved.asset,
        symbol: resolved.symbol,
        /* Null is "could not be read", never "zero". A zero balance is "0",
           and telling the two apart is what stops a MAX button appearing over
           a figure nobody actually read. */
        raw: decimals === null ? null : raw,
        decimals,
        /* What gas is paid in on this chain, whatever the asset above is. */
        nativeRaw,
        nativeDecimals: 18,
        observedBy: (native.ok ? native.endpoint : handle.endpoints[0]).host,
        reason,
      },
    },
    { headers: responseHeaders(rate) },
  );
}
