/**
 * The size-aware quote.
 *
 * For a Buy the person's USD amount is quoted through the same Jupiter order
 * path Spot executes on (quote-only, no taker, Ryntra's fee included so the
 * figure is the Review's figure), the token leg is turned into underlying
 * units through the active multiplier, and the executable per-share price is
 * compared with the reference on the same basis. For a Sell the same in the
 * other direction: the units the person gives against the USD they would
 * receive.
 *
 * Presets such as $100 / $1,000 / $10,000 are examples for orientation; the
 * final Review always quotes the person's real amount. Every quote carries the
 * venue's observation time and its review expiry, and the cache below is
 * shorter than both.
 */

import { fetchJupiterOrder, resolveJupiterSwapEndpoint, type JupiterOrderQuote, type JupiterOrderResult } from "../solana/quotes.ts";
import { verifiedJupiterReferral } from "../solana/referral-account.server.ts";
import type { JupiterReferral } from "../solana/quotes.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../solana/send-kinds.ts";
import { resolveServiceFeeConfig } from "../swap/service-fee.server.ts";
import { chooseQuote } from "../core/solana-swap/fee-route.server.ts";
import { createSolanaRpcHandle } from "../solana/rpc.ts";
import type { Lifecycle, TransferFee, UnitBasis } from "./instrument.ts";
import { findStockRow, type StockRow } from "./universe.server.ts";
import { deviationPct, perShareExecutable, scaledAmountString, STOCK_QUOTE_PRESETS_USD } from "./units.ts";

const QUOTE_TTL_MS = 20 * 1000;
const USDC_DECIMALS = 6;
export { STOCK_QUOTE_PRESETS_USD };
export const STOCK_QUOTE_MAX_USD = 1_000_000;

export type StockSide = "BUY" | "SELL";

export type StockQuote = Readonly<{
  mint: string;
  symbol: string;
  side: StockSide;
  /** The USD leg, as quoted: what is paid on a Buy, what would arrive on a Sell. */
  usd: number;
  /** The token leg, raw and in underlying units through the active multiplier. */
  tokenRaw: string;
  tokenScaled: string;
  /**
   * The least the Review will hold the venue to, after the slippage bound:
   * on a Buy the token leg (raw, and in the same units as `tokenScaled`), on
   * a Sell the USD leg. Expected is what the route prices now; minimum is
   * what a signature accepts.
   */
  minReceivedRaw: string;
  minReceivedScaled: string;
  multiplier: number | null;
  /**
   * The unit `executablePerShare`, `tokenScaled` and `minReceivedScaled` are
   * in: an underlying share, or one token as the wallet shows it (the
   * pre-IPO issuers). The figures are the same computation on the scaled
   * amount; the word beside them is not.
   */
  unitBasis: UnitBasis;
  /** Executable per unit (`unitBasis`), USD — per underlying share where the unit is a share. */
  executablePerShare: number | null;
  reference: StockRow["reference"];
  /** The deviation from the reference above, on the same basis; null when either side is missing. */
  deviationPct: number | null;
  priceImpactPct: string;
  feeBasisPoints: number;
  slippageBps: number;
  router: string;
  observedAt: string;
  reviewExpiresAt: string;
  source: Readonly<{ label: string }>;
  /**
   * The transfer fee the token's own mint withholds on every transfer, as
   * the chain states it — the issuer's condition, not Ryntra's fee and not
   * the venue's. It is stated here so a person sees it; nothing is
   * subtracted from the venue's figures on account of it, because the venue's
   * route already moves the token through the mint's own rule and the
   * settlement records what actually arrived.
   */
  transferFee: TransferFee | null;
  lifecycle: Lifecycle;
}>;

export type StockQuoteFailure = Readonly<{ ok: false; code: "UNKNOWN_ASSET" | "NO_ROUTE" | "PROVIDER" | "AMOUNT" | "UNITS" | "LIFECYCLE"; reason: string }>;

const cache = new Map<string, { value: StockQuote; at: number }>();

export function resetStockQuoteCache(): void {
  cache.clear();
}

function usdToRaw(usd: number): string {
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS)).toString();
}

function rawToUsd(raw: string): number {
  return Number(BigInt(raw)) / 10 ** USDC_DECIMALS;
}

/**
 * Quote `usd` of a stock token on `side`. A Sell is quoted from the units
 * that `usd` of tokens stands for at the token's market price, so both sides
 * answer the same question: what does this size actually execute at.
 */
export async function quoteStock(
  input: Readonly<{ ticker: string; side: StockSide; usd: number }>,
  deps: Readonly<{
    now?: () => Date;
    order?: typeof fetchJupiterOrder;
    sleep?: (ms: number) => Promise<void>;
    findRow?: typeof findStockRow;
    referral?: () => Promise<JupiterReferral | null>;
    /** Fee policy v2's lane for the web, so the figure is the web Review's; absent, `/order` as before (the phone, until it reads 1.24.0). */
    feePolicy?: "v2";
  }> = {},
): Promise<{ ok: true; quote: StockQuote } | StockQuoteFailure> {
  if (!Number.isFinite(input.usd) || input.usd < 1 || input.usd > STOCK_QUOTE_MAX_USD) {
    return { ok: false, code: "AMOUNT", reason: `An amount between $1 and $${STOCK_QUOTE_MAX_USD.toLocaleString("en-US")} can be quoted.` };
  }
  const found = await (deps.findRow ?? findStockRow)(input.ticker);
  if (!found.ok) return { ok: false, code: "PROVIDER", reason: found.reason };
  if (!found.row) return { ok: false, code: "UNKNOWN_ASSET", reason: "That token is not a confirmed stock representation." };
  const row = found.row;
  const decimals = row.representation.decimals;
  if (decimals === null) return { ok: false, code: "UNITS", reason: "The token's decimals are unknown, so its units cannot be stated." };
  /* A token the issuer no longer offers — paused, redeem-only, expired — is
     not quoted for a new purchase, whatever a pool still routes; the person
     reads why. A sale of a token already held is the person's own decision
     and is quoted. */
  if (input.side === "BUY" && row.lifecycle?.tradable === false) {
    return { ok: false, code: "LIFECYCLE", reason: row.lifecycle.note ?? "The issuer does not offer this token for purchase now." };
  }
  const key = `${row.representation.mint}:${input.side}:${input.usd}:${deps.feePolicy ?? "as-now"}`;
  const now = (deps.now ?? (() => new Date()))();
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < QUOTE_TTL_MS) return { ok: true, quote: hit.value };

  const mint = row.representation.mint;
  let request: { inputMint: string; outputMint: string; amountRaw: string };
  if (input.side === "BUY") {
    request = { inputMint: SOLANA_MAINNET_USDC_MINT, outputMint: mint, amountRaw: usdToRaw(input.usd) };
  } else {
    /* Tokens worth `usd` at the venue's price, in raw units. The venue prices
       the scaled unit, so `usd / price` is a count of scaled units; the raw
       amount behind it is that count divided by the multiplier — one base
       token stands for `multiplier` scaled units. Before 2026-09-16 the count
       was written as base tokens, which sized a $100 sale of NFLXx (×10) as
       $1,000. */
    const price = row.market.priceUsd;
    if (price === null || price <= 0) return { ok: false, code: "UNITS", reason: "The token has no market price to size a sale from." };
    const scaledUnits = input.usd / price;
    const raw = BigInt(Math.floor((scaledUnits / (row.multiplier?.current ?? 1)) * 10 ** decimals));
    if (raw <= 0n) return { ok: false, code: "AMOUNT", reason: "Too small to sell." };
    request = { inputMint: mint, outputMint: SOLANA_MAINNET_USDC_MINT, amountRaw: raw.toString() };
  }

  const v2 = deps.feePolicy === "v2" && !deps.order;
  const referral = v2 ? null : deps.referral ? await deps.referral() : (await verifiedJupiterReferral(resolveServiceFeeConfig())).referral;
  const askOrder: typeof fetchJupiterOrder = v2
    ? async (asked, selection) => {
        const choice = await chooseQuote({ inputMint: asked.inputMint, outputMint: asked.outputMint, amountRaw: asked.amountRaw, selection: selection ?? resolveJupiterSwapEndpoint(), handle: createSolanaRpcHandle({ network: "mainnet" }), config: resolveServiceFeeConfig() });
        return choice.ok ? { ok: true, order: choice.order } : { ...choice.failure, code: choice.failure.code === "BUILD_FAILED" ? "HTTP_ERROR" : choice.failure.code } as JupiterOrderResult;
      }
    : (deps.order ?? fetchJupiterOrder);
  let result: JupiterOrderResult = await askOrder({ ...request, referral }, resolveJupiterSwapEndpoint());
  /* A quote moves nothing and has no taker, so a refusal for rate alone may
     be asked once more — only when the provider's own pause is short enough
     to be worth a wait (`jupiterRetryWaitMs`: at most 2.5 s), and only once.
     A longer reset is answered honestly. The swap's quote and its signable
     order are asked the same way since 2026-09-28 (`askOnceMoreAfterRate`);
     `/execute` is never asked twice. */
  if (!result.ok && result.code === "RATE_LIMITED" && typeof result.retryWaitMs === "number") {
    await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(result.retryWaitMs);
    result = await askOrder({ ...request, referral }, resolveJupiterSwapEndpoint());
  }
  if (!result.ok) {
    return { ok: false, code: result.code === "NO_ROUTE" ? "NO_ROUTE" : "PROVIDER", reason: result.reason };
  }
  const order: JupiterOrderQuote = result.order;
  const tokenRaw = input.side === "BUY" ? order.outAmountRaw : order.inAmountRaw;
  const usd = input.side === "BUY" ? rawToUsd(order.inAmountRaw) : rawToUsd(order.outAmountRaw);
  const multiplier = row.multiplier?.current ?? null;
  const tokenScaled = scaledAmountString(BigInt(tokenRaw), decimals, multiplier ?? 1, 6);
  /* The venue's own minimum after its slippage bound — on a Buy the token leg
     in the same units as the expected figure, on a Sell the USD leg. */
  const minReceivedRaw = order.minReceivedRaw;
  const minReceivedScaled = input.side === "BUY" ? scaledAmountString(BigInt(minReceivedRaw), decimals, multiplier ?? 1, 6) : rawToUsd(minReceivedRaw).toFixed(USDC_DECIMALS);
  /* Without a known multiplier the per-share basis is not established, so no comparison is offered. */
  const executablePerShare = multiplier === null ? null : perShareExecutable(usd, tokenScaled);
  const quote: StockQuote = {
    mint,
    symbol: row.representation.symbol,
    side: input.side,
    usd,
    tokenRaw,
    tokenScaled,
    minReceivedRaw,
    minReceivedScaled,
    multiplier,
    unitBasis: row.representation.instrument?.unitBasis ?? "share",
    executablePerShare,
    reference: row.reference,
    deviationPct: deviationPct(executablePerShare, row.reference.perShare),
    priceImpactPct: order.priceImpactPct,
    feeBasisPoints: order.totalFeeBasisPoints,
    slippageBps: order.slippageBps,
    router: order.router,
    observedAt: order.observedAt,
    reviewExpiresAt: order.reviewExpiresAt,
    source: { label: "Jupiter" },
    transferFee: row.transferFee ?? null,
    lifecycle: row.lifecycle ?? { state: "unknown", tradable: true, source: "none", observedAt: null, url: null, recheckBy: null, deadline: null, note: null },
  };
  cache.set(key, { value: quote, at: now.getTime() });
  return { ok: true, quote };
}
