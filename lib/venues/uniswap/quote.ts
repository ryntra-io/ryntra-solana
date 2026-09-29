/* Uniswap v3 on Robinhood Chain — READ-ONLY quote route (STEP 4).
   Second execution route on the same chain: the user sees Arcus RFQ and Uniswap AMM quotes for
   the SAME instrument side by side and picks a route explicitly. This module only QUOTES
   (public eth_call, non-custodial, no keys); execution via Uniswap is deliberately not shipped.

   Addresses from developers.uniswap.org v3 deployments ("Robinhood Chain: 4663"), VERIFIED LIVE
   2026-07-12 by eth_call probes from this repo:
     - QuoterV2.quoteExactInputSingle (selector 0xc6a5026a) returned 1 USDG → 0.000556 WETH on
       the USDG/WETH 0.05% pool (plausible ETH price) — mechanism confirmed end-to-end;
     - factory.getPool (0x1698ee82) found real pools (TSLA/USDG 0.3%, AAPL/WETH, USDG/WETH);
     - stock-token pools existed but held ZERO liquidity at verification → quotes revert, which
       this module reports honestly as "no-liquidity", never as a fake price.
   Stock Token flow on Uniswap runs through UniswapX / the Trading API (x-api-key gated) — a
   separate, planned route. See lib/domain/registry.ts for the capability truth. */

import { SPOT_RPC_URL } from "../../arcus/spot.ts";

export const UNISWAP_V3_QUOTER_V2 = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
export const UNISWAP_V3_FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";

/** v3 fee tiers in hundredths of a bip (500 = 0.05%). LP fee only — Ryntra adds nothing. */
export const V3_FEE_TIERS = [100, 500, 3000, 10000] as const;

/** quoteExactInputSingle((address,address,uint256,uint24,uint160)) — verified live 2026-07-12. */
const SEL_QUOTE_EXACT_INPUT_SINGLE = "0xc6a5026a";

const pad = (hexOrAddr: string) => hexOrAddr.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const padNum = (n: bigint) => n.toString(16).padStart(64, "0");

export type EthCall = (to: string, data: string) => Promise<string>;

/** Default transport: plain JSON-RPC eth_call against the public Robinhood Chain RPC. */
export function makeEthCall(rpcUrl: string = SPOT_RPC_URL): EthCall {
  return async (to, data) => {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json()) as { result?: string; error?: { message?: string } };
    if (j.error) throw new Error(j.error.message ?? "eth_call error");
    return j.result ?? "0x";
  };
}

export type UniswapV3Quote = {
  /** Best output across fee tiers, base units of tokenOut. */
  amountOut: bigint;
  /** Winning LP fee tier converted to basis points (3000 → 30 bps). */
  feeTierBps: number;
  /** Unix ms the quote was observed. */
  observedAt: number;
};

export type UniswapV3QuoteResult =
  | { status: "quoted"; quote: UniswapV3Quote }
  /** Pools missing or empty on every tier — checked live, honestly reported, never a fake price. */
  | { status: "no-liquidity"; observedAt: number }
  /** Transport failure — we could NOT check, which is different from "checked and empty". */
  | { status: "error"; observedAt: number };

/** A tier probe outcome: amountOut, "revert" (no pool/liquidity), or "network" (couldn't check). */
async function probeTier(
  call: EthCall,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  feeTier: number
): Promise<bigint | "revert" | "network"> {
  const data =
    SEL_QUOTE_EXACT_INPUT_SINGLE + pad(tokenIn) + pad(tokenOut) + padNum(amountIn) + padNum(BigInt(feeTier)) + padNum(0n);
  try {
    const r = await call(UNISWAP_V3_QUOTER_V2, data);
    if (r === "0x" || r.length < 66) return "revert"; // empty return = unusable as a price
    const out = BigInt("0x" + r.slice(2, 66)); // amountOut is the first return word
    return out > 0n ? out : "revert";
  } catch (e) {
    // The quoter signals "no pool / no depth" via revert; anything else is a transport failure.
    return /revert/i.test(e instanceof Error ? e.message : String(e)) ? "revert" : "network";
  }
}

/**
 * Quote tokenIn→tokenOut across all v3 fee tiers, best output wins. Honesty contract:
 *  - every tier reverting = "no-liquidity" (we CHECKED, the AMM has nothing) — rendered as fact;
 *  - any tier unreachable with none succeeding = "error" (we could NOT check) — never conflated
 *    with an empty market.
 */
export async function quoteUniswapV3(
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
  call: EthCall = makeEthCall(),
  nowMs: () => number = Date.now
): Promise<UniswapV3QuoteResult> {
  if (amountIn <= 0n) return { status: "no-liquidity", observedAt: nowMs() };
  const probes = await Promise.all(V3_FEE_TIERS.map((fee) => probeTier(call, tokenIn, tokenOut, amountIn, fee)));
  const observedAt = nowMs();

  let best: { amountOut: bigint; feeTierBps: number } | null = null;
  let sawNetworkFailure = false;
  probes.forEach((p, i) => {
    if (p === "network") sawNetworkFailure = true;
    else if (p !== "revert" && (best == null || p > best.amountOut)) {
      best = { amountOut: p, feeTierBps: V3_FEE_TIERS[i] / 100 };
    }
  });

  if (best != null) return { status: "quoted", quote: { ...(best as { amountOut: bigint; feeTierBps: number }), observedAt } };
  if (sawNetworkFailure) return { status: "error", observedAt };
  return { status: "no-liquidity", observedAt };
}
