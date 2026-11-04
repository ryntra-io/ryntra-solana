/**
 * The swap engine's quote for a stop's exact amount, on the server (CITY-149) — the same answer the city's quote reads
 * (`/api/solana/swap/quote`): fee policy v2's lane choice (`chooseQuote`) on mainnet, its `outAmountRaw`. A token
 * Ryntra no longer supports is quoted on neither side, as the route refuses it. Reads only: no transaction is built.
 */

import { chooseQuote } from "../core/solana-swap/fee-route.server.ts";
import { resolveJupiterSwapEndpoint } from "../solana/quotes.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { isRetiredMint } from "../stocks/retired.ts";
import { resolveServiceFeeConfig } from "../swap/service-fee.server.ts";
import type { QuoteNow } from "./api.ts";

export const engineQuote: QuoteNow = async ({ inputMint, outputMint, amountRaw }) => {
  if (isRetiredMint(inputMint) || isRetiredMint(outputMint)) return null;
  const selection = resolveJupiterSwapEndpoint({ access: "production" });
  if (!selection.ok) return null;
  const choice = await chooseQuote({ inputMint, outputMint, amountRaw, selection, handle: createSolanaRpcHandle({ network: "mainnet" }), config: resolveServiceFeeConfig() });
  return choice.ok ? choice.order.outAmountRaw : null;
};
