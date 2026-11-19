/**
 * One quote for the Bridge: coin A on chain X into coin B on chain Y, in a single Relay request.
 *
 * Relay carries the transfer and any swap on either side in one order: ETH on Base into SOL on Solana, USDC on Solana
 * into ETH on Arbitrum, BTC into SOL. This module asks for that order and then reads Relay's answer back against the
 * question before a browser may execute it — the same discipline as the engine's cross-network lane, widened from nine networks to every chain Relay carries:
 *
 * - **who is paid** — the recipient Relay states is the address the person gave, on the chain they chose;
 * - **who pays** — the sender is the person's wallet (or, for a deposit address, the burn address this module sent);
 * - **what moves** — both coins on both chains, and never more than the amount typed;
 * - **where a failure pays back** — every refund in the order names one side of it and the person's own address on that
 *   side; on a deposit address there is no sender to refund, so a refund on the origin is refused outright;
 * - **what a wallet is asked to sign** — on an EVM origin each call targets one of Relay's own contracts on that chain
 *   (or approves the coin being spent to one of them); on Solana each instruction is one of the few programs Relay's
 *   plans were read using; on Hyperliquid the transfer goes to Relay's depository there.
 *
 * Ryntra's fee is the engine's, unchanged: Relay's app fee at the engine's rate to the engine's claim
 * address, when one is configured, and read back from the answer rather than assumed. Slippage is the engine's stated
 * cap, never the provider's looser default.
 */

import { z } from "zod";

import { RELAY_API_ORIGIN } from "./chains.ts";
import { depositSenderOf, orderNameOf, sameBridgeAddress, type BridgeChain } from "./bridge-chains.ts";
import { relayJsonHeaders } from "./http.ts";
import { RELAY_REFERRER, RELAY_SLIPPAGE_BPS } from "./quote-api.ts";

export type BridgeQuoteRequest = Readonly<{
  origin: BridgeChain;
  destination: BridgeChain;
  fromToken: string;
  toToken: string;
  /** Raw integer amount in the origin coin's decimals. */
  amountRaw: string;
  /** The wallet that signs on the origin; null when money leaves through a deposit address. */
  user: string | null;
  recipient: string;
  appFee?: Readonly<{ recipient: string; bps: number }> | null;
  slippageBps?: number;
}>;

const INTEGER = /^[0-9]+$/;

const Currency = z.object({ chainId: z.number(), address: z.string(), symbol: z.string(), name: z.string().optional(), decimals: z.number().int().nonnegative() }).passthrough();
const Amount = z.object({ currency: Currency, amount: z.string().regex(INTEGER), amountFormatted: z.string().optional(), amountUsd: z.string().optional(), minimumAmount: z.string().regex(INTEGER).optional() }).passthrough();
const Fee = z.object({ currency: Currency.optional(), amount: z.string().optional(), amountUsd: z.string().optional() }).passthrough();
const Item = z.object({ status: z.string(), data: z.unknown(), check: z.object({ endpoint: z.string(), method: z.string() }).passthrough().optional() }).passthrough();
const Step = z.object({ id: z.string(), kind: z.string(), items: z.array(Item).min(1), requestId: z.string().optional(), depositAddress: z.string().optional() }).passthrough();

/** Relay's answer in the shape its SDK executes — every step kind kept, so a signature or a Hyperliquid action passes. */
export const BridgeQuoteSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    steps: z.array(Step).min(1),
    fees: z.object({ gas: Fee.optional(), relayer: Fee.optional(), relayerGas: Fee.optional(), relayerService: Fee.optional(), app: Fee.optional() }).passthrough().optional(),
    details: z
      .object({
        operation: z.string().optional(),
        sender: z.string().optional(),
        recipient: z.string().optional(),
        currencyIn: Amount,
        currencyOut: Amount,
        rate: z.union([z.string(), z.number()]).optional(),
        totalImpact: z.object({ usd: z.string().optional(), percent: z.string().optional() }).passthrough().optional(),
        timeEstimate: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type BridgeRawQuote = z.output<typeof BridgeQuoteSchema>;

const APP_FEE_RECIPIENT = /^0x[0-9a-fA-F]{40}$/;

export function buildBridgeQuoteBody(request: BridgeQuoteRequest, keyed = false): Record<string, unknown> {
  const deposit = request.user === null;
  const body: Record<string, unknown> = {
    user: request.user ?? depositSenderOf(request.origin),
    recipient: request.recipient,
    originChainId: request.origin.id,
    originCurrency: request.fromToken,
    destinationChainId: request.destination.id,
    destinationCurrency: request.toToken,
    amount: request.amountRaw,
    tradeType: "EXACT_INPUT",
    slippageTolerance: String(request.slippageBps ?? RELAY_SLIPPAGE_BPS),
  };
  if (deposit) body.useDepositAddress = true;
  if (request.appFee && APP_FEE_RECIPIENT.test(request.appFee.recipient) && request.appFee.bps > 0 && request.appFee.bps <= 10_000) {
    body.appFees = [{ recipient: request.appFee.recipient, fee: String(request.appFee.bps) }];
  }
  /* The referrer only with the key: Relay answers a keyless referrer 401 (`quote-api.ts`). */
  if (keyed) body.referrer = RELAY_REFERRER;
  return body;
}

export type BridgeQuoteFailure = Readonly<{
  ok: false;
  code: "NO_ROUTE" | "AMOUNT_TOO_SMALL" | "AMOUNT_TOO_LARGE" | "RATE_LIMITED" | "UNAUTHORIZED" | "HTTP_ERROR" | "TRANSPORT" | "UNREADABLE";
  status: number | null;
  /** Relay's own words, for the operator trail; never shown raw. */
  provider: Readonly<{ code: string | null; message: string | null }>;
}>;

export type BridgeQuoteDependencies = Readonly<{ apiKey?: string | null; fetchImpl?: typeof fetch; origin?: string; timeoutMs?: number }>;

/** Relay's error code, sorted into what a person can be told. */
export function bridgeQuoteFailureCode(status: number, code: string | null): BridgeQuoteFailure["code"] {
  if (status === 429) return "RATE_LIMITED";
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  const word = code ?? "";
  if (/AMOUNT_TOO_LOW|TOO_SMALL|MIN/i.test(word)) return "AMOUNT_TOO_SMALL";
  if (/TOO_HIGH|TOO_LARGE|INSUFFICIENT_LIQUIDITY|MAX/i.test(word)) return "AMOUNT_TOO_LARGE";
  if (status === 400 || status === 422) return "NO_ROUTE";
  return "HTTP_ERROR";
}

export async function fetchBridgeQuote(request: BridgeQuoteRequest, deps: BridgeQuoteDependencies = {}): Promise<Readonly<{ ok: true; quote: BridgeRawQuote }> | BridgeQuoteFailure> {
  const keyed = typeof deps.apiKey === "string" && deps.apiKey.trim().length > 0;
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(new URL("/quote", deps.origin ?? RELAY_API_ORIGIN).toString(), {
      method: "POST",
      headers: relayJsonHeaders({ apiKey: deps.apiKey }),
      body: JSON.stringify(buildBridgeQuoteBody(request, keyed)),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 12_000),
    });
  } catch (error) {
    return { ok: false, code: "TRANSPORT", status: null, provider: { code: null, message: error instanceof Error ? error.message : String(error) } };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const code = typeof record.errorCode === "string" ? record.errorCode : null;
    const message = typeof record.message === "string" ? record.message : null;
    return { ok: false, code: bridgeQuoteFailureCode(response.status, code), status: response.status, provider: { code, message } };
  }
  const parsed = BridgeQuoteSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, code: "UNREADABLE", status: response.status, provider: { code: null, message: null } };
  return { ok: true, quote: parsed.data };
}

/* ── reading the answer back ───────────────────────────────────────────── */

/**
 * The programs a Solana plan of Relay's may invoke, read off its live plans on 18.11: its depository, and — when the
 * coin sent is swapped before it is deposited — the associated token account program, Jupiter's router, Relay's own
 * swap-and-deposit entry (it writes Relay's depository vault) and the memo program; with the runtime's compute budget.
 * The system and token programs are not among them: called at the top of a plan they move money anywhere, and no plan
 * of Relay's calls them there. Anything else is refused before a wallet is asked, and a plan must reach Relay itself.
 */
export const BRIDGE_SOLANA_RELAY_PROGRAMS: readonly string[] = [
  "99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2", // Relay depository
  "DPArtTLbEqa6EuXHfL5UFLBZhFjiEXWRudhvXDrjwXUr", // Relay swap-and-deposit
];
export const BRIDGE_SOLANA_PROGRAMS: readonly string[] = [
  ...BRIDGE_SOLANA_RELAY_PROGRAMS,
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", // Jupiter v6
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // associated token accounts
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr", // memo
  "ComputeBudget111111111111111111111111111111",
];

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A signed Solana transaction's id — its first signature, in base58 — read from the bytes alone; null if unreadable. */
export function signatureOfWire(signedWireBase64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(signedWireBase64), (character) => character.charCodeAt(0));
    if (bytes[0] === undefined || bytes[0] < 1 || bytes[0] > 127 || bytes.length < 65) return null;
    const signature = bytes.slice(1, 65);
    if (signature.every((byte) => byte === 0)) return null;
    let value = 0n;
    for (const byte of signature) value = value * 256n + BigInt(byte);
    let out = "";
    while (value > 0n) {
      out = BASE58[Number(value % 58n)] + out;
      value /= 58n;
    }
    for (const byte of signature) {
      if (byte !== 0) break;
      out = `1${out}`;
    }
    return out;
  } catch {
    return null;
  }
}

/** A Solana step's instructions are all programs of Relay's plans, and at least one of them is Relay's own. */
export function solanaPlanOk(programIds: readonly string[]): boolean {
  return programIds.length > 0 && programIds.every((id) => BRIDGE_SOLANA_PROGRAMS.includes(id)) && programIds.some((id) => BRIDGE_SOLANA_RELAY_PROGRAMS.includes(id));
}

/** `approve(address,uint256)`. */
const APPROVE = "0x095ea7b3";

export type BridgeQuoteCheck = Readonly<{ ok: true }> | Readonly<{ ok: false; code: "QUOTE_MISMATCH"; field: string }>;

const obj = (value: unknown): Record<string, unknown> | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function refundsOf(quote: BridgeRawQuote): unknown[] {
  const inputs = obj(obj(obj(quote)?.protocol)?.v2)?.orderData;
  const list = obj(inputs)?.inputs;
  return (Array.isArray(list) ? list : []).flatMap((entry) => {
    const refunds = obj(entry)?.refunds;
    return Array.isArray(refunds) ? refunds : [];
  });
}

/** A call's value (decimal or hex) as a whole number, or null when it is not one. */
function valueOf(raw: unknown): bigint | null {
  if (raw === undefined || raw === null || raw === "") return 0n;
  if (typeof raw !== "string" || !/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(raw)) return null;
  return BigInt(raw);
}

/** What one EVM call may move: its value, and what it approves — null when the call is not one this page signs. */
function evmCallOf(data: Record<string, unknown>, request: BridgeQuoteRequest, native: boolean): Readonly<{ value: bigint; allowance: bigint }> | null {
  const to = typeof data.to === "string" ? data.to.toLowerCase() : null;
  const input = typeof data.data === "string" ? data.data.toLowerCase() : "";
  const value = valueOf(data.value);
  if (!to || value === null || data.chainId !== request.origin.id) return null;
  // Value leaves with a call only for the network's own coin.
  if (!native && value > 0n) return null;
  const entry = new Set([...request.origin.contracts, ...(request.origin.depository ? [request.origin.depository.toLowerCase()] : [])]);
  if (entry.has(to)) return { value, allowance: 0n };
  // An approval: of the coin being spent, to the depository or an approval proxy.
  if (!native && to === request.fromToken.toLowerCase() && input.startsWith(APPROVE) && input.length === 138 && value === 0n) {
    const spender = `0x${input.slice(34, 74)}`;
    return request.origin.spenders.includes(spender) ? { value: 0n, allowance: BigInt(`0x${input.slice(74, 138)}`) } : null;
  }
  return null;
}

function stepsOk(quote: BridgeRawQuote, request: BridgeQuoteRequest): boolean {
  const deposit = request.user === null;
  if (deposit) {
    // A deposit address: Relay's address for exactly this order, and nothing for a wallet to sign.
    return quote.steps.every((step) => step.kind === "transaction") && typeof quote.steps.at(-1)?.depositAddress === "string";
  }
  const native = request.fromToken.toLowerCase() === request.origin.native.address.toLowerCase();
  // Over all the calls together, never more value and never more allowance than the amount typed: Relay's routers
  // carry calls of their own, so the limit is the sum, not each call.
  let value = 0n;
  let allowance = 0n;
  for (const step of quote.steps) {
    // Only transactions: a signature step (a permit, an authorisation) could grant a spender this page never sees, and
    // the steps a signature's answer would add are not read back here — so a quote asking for one is not offered.
    if (step.kind !== "transaction") return false;
    for (const item of step.items) {
      const data = obj(item.data);
      if (!data) return false;
      if (request.origin.vm === "svm") {
        const instructions = Array.isArray(data.instructions) ? data.instructions : null;
        if (!instructions || !solanaPlanOk(instructions.map((entry) => String(obj(entry)?.programId ?? "")))) return false;
        continue;
      }
      const call = request.origin.vm === "evm" ? evmCallOf(data, request, native) : null;
      if (!call) return false;
      value += call.value;
      allowance += call.allowance;
    }
  }
  const amount = BigInt(request.amountRaw);
  return value <= amount && allowance <= amount;
}

/**
 * Relay's answer read back against the question. Anything that does not match is refused — nothing is executed from a
 * quote that pays someone else, spends something else or asks a wallet to sign something else.
 */
export function checkBridgeQuote(quote: BridgeRawQuote, request: BridgeQuoteRequest, options: Readonly<{ preview?: boolean }> = {}): BridgeQuoteCheck {
  const refuse = (field: string): BridgeQuoteCheck => ({ ok: false, code: "QUOTE_MISMATCH", field });
  const { origin, destination } = request;
  const details = quote.details;
  if (!sameBridgeAddress(destination.vm, details.recipient, request.recipient)) return refuse("recipient");
  const sender = request.user ?? depositSenderOf(origin);
  if (details.sender !== undefined && !sameBridgeAddress(origin.vm, details.sender, sender)) return refuse("sender");
  if (details.currencyIn.currency.chainId !== origin.id || !sameBridgeAddress(origin.vm, details.currencyIn.currency.address, request.fromToken)) return refuse("currencyIn");
  if (details.currencyOut.currency.chainId !== destination.id || !sameBridgeAddress(destination.vm, details.currencyOut.currency.address, request.toToken)) return refuse("currencyOut");
  if (BigInt(details.currencyIn.amount) > BigInt(request.amountRaw)) return refuse("amount");
  if (details.currencyOut.minimumAmount === undefined) return refuse("minimum");

  const originName = orderNameOf(origin);
  const destinationName = orderNameOf(destination);
  const deposit = request.user === null;
  const refundOk = (refund: unknown) => {
    const entry = obj(refund);
    if (!entry) return false;
    if (destinationName !== null && entry.chainId === destinationName && sameBridgeAddress(destination.vm, entry.recipient, request.recipient)) return true;
    // On a deposit address there is no sender: a refund on the origin would go to the burn address.
    return !deposit && originName !== null && entry.chainId === originName && sameBridgeAddress(origin.vm, entry.recipient, sender);
  };
  const refunds = refundsOf(quote);
  // A deposit address names its refund, or it is not offered: Relay's default would refund the burn-address sender.
  if (deposit && refunds.length === 0) return refuse("refund");
  if (!refunds.every(refundOk)) return refuse("refund");
  // A preview is never executed (its quote is not handed out): what a wallet would sign is read on the real quote only.
  if (!options.preview && !stepsOk(quote, request)) return refuse("steps");
  return { ok: true };
}

/* ── what the page shows ───────────────────────────────────────────────── */

export type BridgeFacts = Readonly<{
  requestId: string | null;
  mode: "wallet" | "deposit";
  send: Readonly<{ amountRaw: string; symbol: string; decimals: number; usd: number | null }>;
  get: Readonly<{ expectedRaw: string; minimumRaw: string; symbol: string; decimals: number; usd: number | null }>;
  etaSeconds: number | null;
  /** What the way costs, in dollars, as Relay states it: its own fee, the network's gas, Ryntra's app fee. */
  fees: Readonly<{ relayUsd: number | null; gasUsd: number | null; ryntraUsd: number | null }>;
  /** How much of the value the way loses, in percent (negative is a loss), as Relay states it. */
  impactPercent: number | null;
  /** Relay's address for this order alone, when money leaves through one. */
  depositAddress: string | null;
  /** Signatures the wallet will be asked for. */
  prompts: number;
}>;

const dollars = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function bridgeFacts(quote: BridgeRawQuote, deposit: boolean): BridgeFacts {
  const details = quote.details;
  const app = quote.fees?.app;
  const appRaw = app?.amount;
  const impact = details.totalImpact?.percent;
  return {
    requestId: quote.requestId ?? quote.steps.find((step) => step.requestId)?.requestId ?? null,
    mode: deposit ? "deposit" : "wallet",
    send: { amountRaw: details.currencyIn.amount, symbol: details.currencyIn.currency.symbol, decimals: details.currencyIn.currency.decimals, usd: dollars(details.currencyIn.amountUsd) },
    get: {
      expectedRaw: details.currencyOut.amount,
      minimumRaw: details.currencyOut.minimumAmount ?? details.currencyOut.amount,
      symbol: details.currencyOut.currency.symbol,
      decimals: details.currencyOut.currency.decimals,
      usd: dollars(details.currencyOut.amountUsd),
    },
    etaSeconds: typeof details.timeEstimate === "number" ? details.timeEstimate : null,
    fees: {
      relayUsd: dollars(quote.fees?.relayer?.amountUsd),
      gasUsd: dollars(quote.fees?.gas?.amountUsd),
      ryntraUsd: appRaw !== undefined && /^[0-9]+$/.test(appRaw) && BigInt(appRaw) > 0n ? dollars(app?.amountUsd) : null,
    },
    impactPercent: impact === undefined ? null : Number.isFinite(Number(impact)) ? Number(impact) : null,
    depositAddress: deposit ? (quote.steps.at(-1)?.depositAddress ?? null) : null,
    prompts: deposit ? 0 : quote.steps.reduce((sum, step) => sum + step.items.length, 0),
  };
}
