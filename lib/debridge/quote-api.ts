/**
 * deBridge DLN quote API — the Exchange's second cross-chain price.
 *
 * Like `lib/relay/quote-api.ts` and `lib/mayan/price-api.ts` this module asks a
 * price and nothing more: no transaction is built, nothing is signed, no wallet
 * is seen. Every network call takes an injected `fetchImpl`, so tests run on a
 * recorded answer rather than the internet.
 *
 * ## Three facts read live on 2026-10-15 that shape it
 *
 * - **Arc is chain 5042, Solana is 7565164** — deBridge's own internal id for
 *   Solana, not an EIP-155 number (`/v1.0/supported-chains-info`).
 * - **On Arc deBridge delivers USDC only as the native coin** (`0x0…`, eighteen
 *   decimals): asked for the ERC-20 face `0x3600…` it answers "token not
 *   supported". The two are one balance (`lib/swap/catalog.ts`), so the caller
 *   asks for the native face and reads the answer back in six decimals.
 * - **`prependOperatingExpenses` is never set.** With it, deBridge *raises the
 *   amount in* by its operating expense (0.1 SOL became 0.1068 SOL), and an
 *   amount a person typed must be the amount that leaves the wallet. Without it
 *   the expense comes out of what arrives, where the quote states it.
 *
 * ## Ryntra's fee here
 *
 * `affiliateFeePercent` + `affiliateFeeRecipient`, a percentage of the input
 * taken on the source chain. From a Solana origin deBridge does not pay it out
 * per order: it accrues to the recipient's public key and is withdrawn by that
 * key from the DLN program once a solver unlocks the order, typically within
 * hours (docs.debridge.com, «Withdrawing Affiliate Fees»). The quote states it
 * as an `AffiliateFee` cost in the source chain's USDC.
 *
 * Plus one charge outside the amount: the **fixed fee** (`fixFee`, 0.015 SOL from
 * Solana), paid from the wallet on top of what is sent, like the network fee.
 */

export const DEBRIDGE_DLN_ORIGIN = "https://dln.debridge.finance";
export const DEBRIDGE_CREATE_TX_PATH = "/v1.0/dln/order/create-tx";

/** deBridge's ids for the networks this product sends from and to. Read from `supported-chains-info`, never derived. */
export const DEBRIDGE_CHAIN_IDS: Readonly<Record<string, number>> = {
  solana: 7_565_164,
  ethereum: 1,
  optimism: 10,
  bnb: 56,
  polygon: 137,
  robinhood: 4_663,
  arc: 5_042,
  base: 8_453,
  arbitrum: 42_161,
};

export const DEBRIDGE_SOLANA_NATIVE = "11111111111111111111111111111111";
export const DEBRIDGE_EVM_NATIVE = "0x0000000000000000000000000000000000000000";

export type DebridgeQuoteRequest = Readonly<{
  fromNetwork: string;
  /** Mint on Solana (the System Program id for SOL), contract on EVM, native sentinel for the coin. */
  fromToken: string;
  toNetwork: string;
  toToken: string;
  /** Raw integer amount in the source asset's decimals. */
  amountRaw: string;
  /** Ryntra's affiliate fee: a percentage of the input, to a public key of the source chain. */
  affiliate?: Readonly<{ recipient: string; bps: number }> | null;
}>;

/** One line of deBridge's own cost breakdown, as it states it. */
export type DebridgeCost = Readonly<{
  type: string;
  chain: number;
  token: string;
  amountIn: string;
  amountOut: string;
  /** What this line takes, where deBridge states it. */
  feeAmount: string | null;
}>;

export type DebridgeQuote = Readonly<{
  in: Readonly<{ chainId: number; token: string; decimals: number; amountRaw: string; usd: number | null }>;
  out: Readonly<{ chainId: number; token: string; decimals: number; amountRaw: string; usd: number | null }>;
  costs: readonly DebridgeCost[];
  /** Paid from the wallet on top of the amount, in the source chain's native coin. */
  fixFeeRaw: string;
  /** Seconds, deBridge's own estimate of the fill. */
  fulfillmentDelaySeconds: number | null;
}>;

export type DebridgeQuoteResult =
  | Readonly<{ ok: true; quote: DebridgeQuote; observedAt: string }>
  | Readonly<{ ok: false; code: "NOT_SERVED" | "NO_ROUTE" | "RATE_LIMITED" | "HTTP_ERROR" | "TRANSPORT" | "UNREADABLE"; reason: string; providerCode: string | null }>;

export type DebridgeQuoteDependencies = Readonly<{
  fetchImpl?: typeof fetch;
  now?: () => Date;
  origin?: string;
  timeoutMs?: number;
}>;

const INTEGER = /^[0-9]+$/;
const SOLANA_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A fee in basis points as deBridge's percentage: 25 → "0.25". */
export function bpsAsPercent(bps: number): string {
  if (!Number.isInteger(bps) || bps < 0 || bps > 1_000) throw new RangeError("deBridge takes an affiliate fee of 0 to 10 per cent, in whole basis points.");
  const whole = Math.floor(bps / 100);
  const rest = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : String(whole);
}

export function buildDebridgeQuoteUrl(request: DebridgeQuoteRequest, origin: string = DEBRIDGE_DLN_ORIGIN): string | null {
  const src = DEBRIDGE_CHAIN_IDS[request.fromNetwork];
  const dst = DEBRIDGE_CHAIN_IDS[request.toNetwork];
  if (src === undefined || dst === undefined || src === dst) return null;
  if (!INTEGER.test(request.amountRaw) || request.amountRaw === "0") return null;
  const url = new URL(DEBRIDGE_CREATE_TX_PATH, origin);
  url.searchParams.set("srcChainId", String(src));
  url.searchParams.set("srcChainTokenIn", request.fromToken);
  url.searchParams.set("srcChainTokenInAmount", request.amountRaw);
  url.searchParams.set("dstChainId", String(dst));
  url.searchParams.set("dstChainTokenOut", request.toToken);
  url.searchParams.set("dstChainTokenOutAmount", "auto");
  url.searchParams.set("prependOperatingExpenses", "false");
  const affiliate = request.affiliate;
  if (affiliate && affiliate.bps > 0) {
    /* The recipient is a key of the source chain: a public key on Solana, an address on EVM. */
    const shapeOk = request.fromNetwork === "solana" ? SOLANA_KEY.test(affiliate.recipient) : EVM_ADDRESS.test(affiliate.recipient);
    if (shapeOk) {
      url.searchParams.set("affiliateFeePercent", bpsAsPercent(affiliate.bps));
      url.searchParams.set("affiliateFeeRecipient", affiliate.recipient);
    }
  }
  return url.toString();
}

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const amount = (value: unknown): string | null => (typeof value === "string" && INTEGER.test(value) ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function readSide(value: unknown, which: "in" | "out"): DebridgeQuote["in"] | null {
  if (typeof value !== "object" || value === null) return null;
  const side = value as Record<string, unknown>;
  const chainId = num(side.chainId);
  const token = text(side.address);
  const decimals = num(side.decimals);
  /* For the output, the recommended amount is what deBridge expects to deliver; `amount` is the same unless it says otherwise. */
  const raw = which === "out" ? amount(side.recommendedAmount) ?? amount(side.amount) : amount(side.amount);
  if (chainId === null || token === null || decimals === null || !Number.isInteger(decimals) || raw === null) return null;
  const usd = which === "out" ? num(side.recommendedApproximateUsdValue) ?? num(side.approximateUsdValue) : num(side.approximateUsdValue);
  return { chainId, token, decimals, amountRaw: raw, usd };
}

/** deBridge's answer, read and bounded; null when it is not a quote. */
export function readDebridgeQuote(body: unknown): DebridgeQuote | null {
  if (typeof body !== "object" || body === null) return null;
  const root = body as Record<string, unknown>;
  const estimation = root.estimation as Record<string, unknown> | undefined;
  if (!estimation) return null;
  const input = readSide(estimation.srcChainTokenIn, "in");
  const output = readSide(estimation.dstChainTokenOut, "out");
  if (!input || !output) return null;
  /* An answer that moved the amount in is not an answer to the question asked. */
  if (estimation.srcChainTokenIn && (estimation.srcChainTokenIn as Record<string, unknown>).mutatedWithOperatingExpense === true) return null;
  const rawCosts = Array.isArray(estimation.costsDetails) ? estimation.costsDetails.slice(0, 32) : [];
  const costs: DebridgeCost[] = [];
  for (const entry of rawCosts) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const type = text(row.type);
    const chain = Number(text(row.chain) ?? row.chain);
    const token = text(row.tokenIn);
    const amountIn = amount(row.amountIn);
    const amountOut = amount(row.amountOut);
    if (!type || !Number.isFinite(chain) || !token || amountIn === null || amountOut === null) continue;
    const payload = row.payload as Record<string, unknown> | undefined;
    costs.push({ type, chain, token, amountIn, amountOut, feeAmount: amount(payload?.feeAmount) });
  }
  const fixFeeRaw = amount(root.fixFee) ?? "0";
  const order = root.order as Record<string, unknown> | undefined;
  return { in: input, out: output, costs, fixFeeRaw, fulfillmentDelaySeconds: num(order?.approximateFulfillmentDelay) };
}

/** Ask deBridge for one price. Never throws. */
export async function fetchDebridgeQuote(request: DebridgeQuoteRequest, deps: DebridgeQuoteDependencies = {}): Promise<DebridgeQuoteResult> {
  const url = buildDebridgeQuoteUrl(request, deps.origin);
  if (!url) return { ok: false, code: "NOT_SERVED", reason: "deBridge does not carry this pair of networks.", providerCode: null };
  const fetchImpl = deps.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(deps.timeoutMs ?? 8_000) });
  } catch {
    return { ok: false, code: "TRANSPORT", reason: "deBridge did not answer in time.", providerCode: null };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, code: "UNREADABLE", reason: "deBridge answered with something that is not a quote.", providerCode: null };
  }
  const errorId = typeof body === "object" && body !== null ? text((body as Record<string, unknown>).errorId) : null;
  if (response.status === 429) return { ok: false, code: "RATE_LIMITED", reason: "deBridge asked to slow down.", providerCode: errorId };
  if (!response.ok || errorId) {
    /* An unsupported token or a pair with no taker is a market answer, not a fault. */
    const noRoute = response.status < 500 && errorId !== null && /INVALID_QUERY_PARAMETERS|ERROR_LOW_GIVE_AMOUNT|NO_ROUTE|NOT_ENOUGH|UNSUPPORTED/.test(errorId);
    return { ok: false, code: noRoute ? "NO_ROUTE" : "HTTP_ERROR", reason: noRoute ? "deBridge has no route for this pair at this amount." : `deBridge refused the quote with HTTP ${response.status}.`, providerCode: errorId };
  }
  const quote = readDebridgeQuote(body);
  if (!quote) return { ok: false, code: "UNREADABLE", reason: "deBridge answered with something that is not a quote.", providerCode: null };
  return { ok: true, quote, observedAt: (deps.now ?? (() => new Date()))().toISOString() };
}
