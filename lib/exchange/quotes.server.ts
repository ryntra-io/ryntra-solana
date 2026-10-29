/**
 * The Exchange's quotes, wired to the world — server only (B9).
 *
 * Resolves the two sides the person named, builds the five sources with the
 * swap lane's own calls and Ryntra's receiving addresses, asks them at once
 * (`collectExchangeQuotes`) and reads the prices the core screen ranks with.
 */

import type { FxRate } from "@ryntra/core/adapters";

import { buildFeeFor, chooseQuote, feePolicyInForce, flowOfSwap } from "../core/solana-swap/fee-route.server.ts";
import { resolveRelayApiKey } from "../relay/api-key.server.ts";
import { resolveSwapToken } from "../relay/currencies.ts";
import { fetchJupiterBuild } from "../solana/jupiter-build.ts";
import { resolveJupiterSwapEndpoint } from "../solana/quotes.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import { resolveSwapAsset, SOLANA_NATIVE_SOL_MINT, SOLANA_USDC_MINT, SWAP_CATALOG, type SwapNetwork } from "../swap/catalog.ts";
import { readSwapUnitPrices } from "../swap/price.ts";
import { resolveServiceFeeConfig } from "../swap/service-fee.server.ts";
import type { ExchangeQuoteRequest, ExchangeQuoteSource, ExchangeSide } from "./contract.ts";
import { resolveExchangeFeeConfig } from "./fees.server.ts";
import { collectExchangeQuotes, type ExchangeQuotesAnswer } from "./quotes.ts";
import { debridgeSource, mayanSource, relaySource } from "./sources/cross.ts";
import { jupiterSource, manifestSource } from "./sources/solana.ts";

const EVM_NATIVE = "0x0000000000000000000000000000000000000000";

/**
 * A side as the Exchange names it, from what the person picked: a catalogue code,
 * a mint or a contract. Decimals come from the catalogue or the token index and
 * are never defaulted — a token nobody can describe is refused.
 */
export async function resolveExchangeSide(ref: Readonly<{ network: SwapNetwork; asset: string }>): Promise<ExchangeSide | null> {
  const resolved = resolveSwapAsset(ref);
  if (!resolved) return null;
  if (resolved.catalog) {
    const native = resolved.catalog.kind === "NATIVE";
    const asset = resolved.network === "solana" ? (resolved.catalog.solanaMint as string) : native ? EVM_NATIVE : (resolved.catalog.address as string);
    return { network: resolved.network, asset, symbol: resolved.catalog.symbol, decimals: resolved.catalog.decimals, native };
  }
  const token = await resolveSwapToken({ network: resolved.network, address: resolved.solanaMint ?? resolved.asset });
  if (!token) return null;
  return { network: resolved.network, asset: resolved.solanaMint ?? token.address, symbol: token.symbol, decimals: token.decimals, native: false, verified: token.verified };
}

/** The five executors, then Relay, deBridge, Mayan. */
export function exchangeSources(): readonly ExchangeQuoteSource[] {
  const selection = resolveJupiterSwapEndpoint({ access: "production" });
  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const serviceFees = resolveServiceFeeConfig();
  const fees = resolveExchangeFeeConfig();
  const solanaDeps = {
    policy: feePolicyInForce(),
    chooseQuote: async (request: Readonly<{ inputMint: string; outputMint: string; amountRaw: string }>) => {
      if (!selection.ok) return { ok: false as const, failure: { code: "PRODUCTION_KEY_REQUIRED", reason: selection.reason } };
      const result = await chooseQuote({ ...request, selection, handle, config: serviceFees });
      return result.ok ? result : { ok: false as const, failure: result.failure };
    },
    flowOf: (inputMint: string, outputMint: string) => flowOfSwap(inputMint, outputMint),
    buildFee: (flow: Parameters<typeof buildFeeFor>[0], inputMint: string, outputMint: string) => buildFeeFor(flow, inputMint, outputMint, handle),
    fetchBuild: (request: Parameters<typeof fetchJupiterBuild>[0]) => fetchJupiterBuild(request, selection),
  };
  const crossDeps = { fees, relayApiKey: resolveRelayApiKey() };
  return [jupiterSource(solanaDeps), manifestSource(solanaDeps), relaySource(crossDeps), debridgeSource(crossDeps), mayanSource(crossDeps)];
}

/**
 * Prices for every asset a quote may name — both sides, SOL (the network fee)
 * and Solana USDC (deBridge states Ryntra's fee in it) — keyed as the quotes key
 * them. A price nobody could read is absent: the screen then ranks by what
 * arrives and says so.
 */
export async function exchangePrices(request: ExchangeQuoteRequest): Promise<Readonly<Record<string, FxRate>>> {
  const wanted: Array<Readonly<{ id: string; ref: Readonly<{ network: SwapNetwork; asset: string }> }>> = [
    { id: request.from.asset, ref: { network: request.from.network as SwapNetwork, asset: request.from.native && request.from.network !== "solana" ? nativeCode(request.from.network as SwapNetwork) : request.from.asset } },
    { id: request.to.asset, ref: { network: request.to.network as SwapNetwork, asset: request.to.native && request.to.network !== "solana" ? nativeCode(request.to.network as SwapNetwork) : request.to.asset } },
    { id: SOLANA_NATIVE_SOL_MINT, ref: { network: "solana", asset: SOLANA_NATIVE_SOL_MINT } },
    { id: SOLANA_USDC_MINT, ref: { network: "solana", asset: SOLANA_USDC_MINT } },
  ];
  const rows = await readSwapUnitPrices(wanted.map((entry) => entry.ref));
  const prices: Record<string, FxRate> = {};
  for (const entry of wanted) {
    const row = rows.find((candidate) => candidate.network === entry.ref.network && candidate.asset === entry.ref.asset);
    if (!row || prices[entry.id]) continue;
    prices[entry.id] = { usd: decimalText(row.usd), source: "DefiLlama", at: Date.parse(row.observedAt) };
  }
  return prices;
}

/** A network's own coin by its catalogue code, the way the price source is asked for it. */
function nativeCode(network: SwapNetwork): string {
  return SWAP_CATALOG.find((entry) => entry.network === network && entry.kind === "NATIVE")?.code ?? EVM_NATIVE;
}

/** A dollar price as a decimal string, never in exponent notation: twelve places hold the smallest price met here. */
export function decimalText(value: number): string {
  const text = value.toFixed(12).replace(/0+$/, "");
  return text.endsWith(".") ? text.slice(0, -1) : text;
}

export async function exchangeQuotes(request: ExchangeQuoteRequest): Promise<ExchangeQuotesAnswer & Readonly<{ prices: Readonly<Record<string, FxRate>> }>> {
  const [answer, prices] = await Promise.all([collectExchangeQuotes(request, exchangeSources()), exchangePrices(request)]);
  return { ...answer, prices };
}
