import { consumeSolanaReadRequest } from "@/lib/agent-control/http";
import { publicCacheHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { USDC_MINT, WRAPPED_SOL_MINT } from "@/lib/core/fee-policy";
import { chooseQuote } from "@/lib/core/solana-swap/fee-route.server";
import { resolveJupiterSwapEndpoint } from "@/lib/solana/quotes";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";
import { buyCostOf, costSumOf, usdcRawOf, type BuyCost } from "@/lib/spot/radar-cost";
import { readSpotMarket } from "@/lib/spot/markets.server";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { isRetiredMint, RETIRED_REASON } from "@/lib/stocks/retired";
import { resolveServiceFeeConfig } from "@/lib/swap/service-fee.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Market Radar's card (SOL-R1): the total fees of a buy before the person
 * opens its Review — `?mint=&usd=`, the sum paid in USDC — split into
 * Ryntra's, Jupiter's and the network's, with the route's price impact and a
 * new token account's deposit beside them (`lib/spot/radar-cost.ts`).
 *
 * A read and nothing more: the quote is fee policy v2's lane choice
 * (`chooseQuote`), the same the ticket's quote makes, with no wallet — no
 * transaction is built for anyone, nothing can be signed, and the Review
 * before a signature quotes again. Public, held at the edge for ten seconds.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** One answer per mint and sum for everyone asking within this span. */
const ANSWER_TTL_MS = 10_000;
/** SOL's price waits at most this long; without it the network's share is said in SOL. */
const SOL_WAIT_MS = 1_500;

type CostAnswer = Readonly<{ ok: true; cost: BuyCost; flow: string; lane: string }> | Readonly<{ ok: false; status: number; code: string; message: string }>;
const answers = new Map<string, { value: Promise<CostAnswer>; at: number }>();

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: { ...rateLimitHeaders(rate), "cache-control": "private, no-store" } });
}

async function solUsd(): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = readSpotMarket(WRAPPED_SOL_MINT)
    .then((answer) => (answer.ok && answer.market && typeof answer.market.price === "number" && answer.market.price > 0 ? answer.market.price : null))
    .catch(() => null);
  const late = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), SOL_WAIT_MS);
  });
  const value = await Promise.race([read, late]);
  clearTimeout(timer);
  return value;
}

async function quoteCost(mint: string, usd: number): Promise<CostAnswer> {
  try {
    return await quoteCostNow(mint, usd);
  } catch (cause) {
    /* A quote that threw is a source that did not answer — said in the route's own shape, never a bare 500. */
    return { ok: false, status: 502, code: "QUOTE_UNREACHABLE", message: cause instanceof Error ? cause.message.slice(0, 200) : "The quote did not answer." };
  }
}

async function quoteCostNow(mint: string, usd: number): Promise<CostAnswer> {
  const selection = resolveJupiterSwapEndpoint({ access: "production" });
  if (!selection.ok) return { ok: false, status: 503, code: "PROVIDER_KEY_MISSING", message: selection.reason };
  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const [choice, sol] = await Promise.all([
    chooseQuote({ inputMint: USDC_MINT, outputMint: mint, amountRaw: usdcRawOf(usd), selection, handle, config: resolveServiceFeeConfig() }),
    solUsd(),
  ]);
  if (!choice.ok) {
    const code = choice.failure.code;
    return { ok: false, status: code === "NO_ROUTE" ? 409 : code === "RATE_LIMITED" ? 429 : 502, code: `QUOTE_${code}`, message: choice.failure.reason };
  }
  const cost = buyCostOf({ usd, order: choice.order, lane: choice.lane, solUsd: sol, quotedAt: new Date().toISOString() });
  return { ok: true, cost, flow: choice.flow, lane: choice.lane };
}

export async function GET(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const params = new URL(request.url).searchParams;
  const mint = params.get("mint") ?? "";
  const usd = costSumOf(params.get("usd"));
  if (!BASE58.test(mint)) return failure(400, "VALIDATION_ERROR", "A cost is asked for one mint.", rate);
  if (usd === null) return failure(400, "VALIDATION_ERROR", "usd is a sum from 1 to 1000000.", rate);
  if (mint === USDC_MINT) return failure(400, "VALIDATION_ERROR", "USDC is what the buy is paid with.", rate);
  /* What is not offered for purchase is not quoted as one — the quote route's own two refusals. */
  if (isRetiredMint(mint)) return failure(409, "ASSET_NOT_OFFERED", RETIRED_REASON, rate);
  if (lifecycleEventFor(mint)) return failure(409, "ASSET_NOT_OFFERED", "Its issuer's own terms apply: the token's page says what is offered.", rate);

  const key = `${mint}:${usd}`;
  const now = Date.now();
  let hit = answers.get(key);
  if (!hit || now - hit.at >= ANSWER_TTL_MS) {
    if (answers.size > 500) answers.clear();
    hit = { value: quoteCost(mint, usd), at: now };
    answers.set(key, hit);
    const value = hit.value;
    value.then((answer) => {
      if (!answer.ok && answers.get(key)?.value === value) answers.delete(key);
    }, () => answers.delete(key));
  }
  const answer = await hit.value;
  if (!answer.ok) return failure(answer.status, answer.code, answer.message, rate);
  return Response.json({ cost: answer.cost, flow: answer.flow, lane: answer.lane, source: "jupiter" }, { headers: { ...publicCacheHeaders(10, 20), ...rateLimitHeaders(rate) } });
}
