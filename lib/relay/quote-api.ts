/**
 * Relay quote API — the read-only quote boundary of the Robinhood Chain lane.
 *
 * Relay is the second cross-asset provider, and it exists because it is the
 * only one that reaches chain 4663 at all: Circle has no CCTP domain there,
 * the chain carries no USDC, and Mayan's token endpoint answers HTTP 500 to
 * every spelling of its name. LI.FI does list the chain, but for a Solana
 * origin its own answer names `relaydepository` — this same rail with an
 * aggregator in front of it.
 *
 * Like `lib/mayan/price-api.ts` this module asks a price and nothing more. It
 * builds no transaction, signs nothing, and never sees a wallet; every network
 * call takes an injected `fetchImpl` so tests run against a recorded fixture
 * rather than the internet.
 *
 * ## One mechanism, and why it suits the custody line
 *
 * Relay is an intent rail: the person's transaction deposits into Relay's
 * depository on the source chain, and a solver pays the destination. From
 * Solana that is a **single instruction signed by the person's own wallet** —
 * no throwaway keypair, no second signer. This is precisely what disqualified
 * Mayan's Fast MCTP from Solana origins (a key this process would have to
 * create and sign with), so the rail that carries Robinhood Chain happens to
 * sit further inside the custody line than the one it sits beside, not outside
 * it. From an EVM origin an ERC-20 needs the usual `approve` first; the native
 * coin does not.
 *
 * ## Two things this module refuses to inherit from the provider
 *
 * - **Slippage.** Relay defaults to 200 bps and will honour a cap: asked for
 *   50 on a 1 SOL → USDG quote it raised the signed minimum from 101.17 to
 *   102.71 USDG (read 2026-09-09). A default that loose is a fee nobody
 *   quoted, so the lane always states its own.
 * - **Deadlines.** A Relay order carries none. `deadlineKind` says
 *   `QUOTE_VALIDITY` and the number is only this product's freshness window,
 *   so no surface can present it as a refund guarantee it is not.
 *
 * ## Two fee parameters, and only one of them is ours
 *
 * `referrer` is still deliberately never sent: it needs an API key (HTTP 401
 * `UNAUTHORIZED_QUOTE`), and it buys a revenue share of Relay's own platform fee
 * that requires KYB and $10M of trailing thirty-day volume — a door this product
 * is nowhere near.
 *
 * `appFees` is the other one and needs no key at all. It is charged in basis
 * points of the input value, quoted inside the price Relay returns, and —
 * unlike every other fee on this page — **not paid out per swap**: it accrues
 * in an off-chain USDC balance against an EVM claim address and is withdrawn
 * later. Relay's own documented warning shapes how this module treats it: on
 * an operation that does not support app fees the API returns no error and
 * collects nothing, so the fee is never assumed and `paidAppFees` is read back
 * afterwards.
 */

import { z } from "zod";

import type { CrossSwapTuple, SwapNetwork } from "../swap/catalog.ts";
import type { CrossSwapQuote } from "../swap/cross-swap-quote.ts";
import {
  serviceFeeNotApplied,
  serviceFeeQuoted,
  serviceFeeUnconfigured,
  type RyntraServiceFee,
} from "../swap/service-fee.ts";
import { RELAY_API_ORIGIN, RELAY_CHAIN_IDS } from "./chains.ts";
import { relayJsonHeaders } from "./http.ts";

export const RELAY_QUOTE_PATH = "/quote";
/**
 * How Ryntra is named in Relay's own Requests view.
 *
 * One stable value, not a per-deployment one: the Dashboard already separates
 * production from preview by **API key**, which is why there is a key per
 * environment, and a second axis of separation would only make the same
 * distinction twice and disagree with itself eventually.
 */
export const RELAY_REFERRER = "ryntra";
export const RELAY_ROUTE = "RELAY_DEPOSIT" as const;

/**
 * The cap this lane states rather than accepting the provider's 200.
 *
 * Fifty basis points: wide enough that a one-second fill on a liquid pair is
 * not refused for a tick of movement, narrow enough that the minimum a person
 * signs is close to the number they were shown.
 */
export const RELAY_SLIPPAGE_BPS = 50;

/**
 * How long a Relay quote is treated as fresh. Not a protocol deadline — see
 * the module note and `deadlineKind`.
 */
export const RELAY_QUOTE_VALIDITY_SECONDS = 60;

export type RelayQuoteRequest = Readonly<{
  fromNetwork: SwapNetwork;
  /** Contract on an EVM chain, mint on Solana, native sentinel for the chain's coin. */
  fromToken: string;
  toNetwork: SwapNetwork;
  toToken: string;
  /** Raw integer amount in the source asset's own decimals. */
  amountRaw: string;
  /** The wallet that will sign on the source chain. */
  user: string;
  /** Where the destination asset lands; defaults to `user` when the chains share a format. */
  recipient: string;
  slippageBps?: number;
  /**
   * Ryntra's app fee. The recipient must be an **EVM** address even on a Solana
   * route — Relay's claim addresses always are.
   */
  appFee?: Readonly<{ recipient: string; bps: number }> | null;
}>;

const INTEGER = /^[0-9]+$/;
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;

const CurrencySchema = z
  .object({
    chainId: z.number(),
    address: z.string(),
    symbol: z.string(),
    name: z.string().optional(),
    decimals: z.number().int().nonnegative(),
  })
  .passthrough();

const AmountSchema = z
  .object({
    currency: CurrencySchema,
    amount: z.string().regex(INTEGER),
    amountFormatted: z.string(),
    amountUsd: z.string().regex(DECIMAL).optional(),
    minimumAmount: z.string().regex(INTEGER).optional(),
  })
  .passthrough();

const FeeSchema = z
  .object({
    currency: CurrencySchema.optional(),
    amount: z.string().regex(INTEGER).optional(),
    amountFormatted: z.string().optional(),
    amountUsd: z.string().regex(DECIMAL).optional(),
  })
  .passthrough();

/**
 * One transaction the person's wallet is asked for. Relay describes a Solana
 * step by instructions and lookup tables, and an EVM step by a call — the two
 * are kept apart here so nothing downstream can read one as the other.
 */
const SolanaInstructionSchema = z
  .object({
    programId: z.string().min(32).max(64),
    keys: z.array(z.object({ pubkey: z.string().min(32).max(64), isSigner: z.boolean(), isWritable: z.boolean() }).passthrough()),
    data: z.string(),
  })
  .passthrough();

const StepItemSchema = z
  .object({
    status: z.string(),
    data: z.union([
      z
        .object({
          instructions: z.array(SolanaInstructionSchema).min(1),
          addressLookupTableAddresses: z.array(z.string()).optional(),
        })
        .passthrough(),
      z
        .object({
          from: z.string(),
          to: z.string(),
          data: z.string(),
          value: z.string(),
          chainId: z.number(),
          gas: z.string().optional(),
          maxFeePerGas: z.string().optional(),
          maxPriorityFeePerGas: z.string().optional(),
        })
        .passthrough(),
    ]),
    check: z.object({ endpoint: z.string(), method: z.string() }).passthrough().optional(),
  })
  .passthrough();

const StepSchema = z
  .object({
    id: z.string(),
    action: z.string().optional(),
    description: z.string().optional(),
    kind: z.string(),
    requestId: z.string().optional(),
    items: z.array(StepItemSchema).min(1),
  })
  .passthrough();

export const RelayRawQuoteSchema = z
  .object({
    requestId: z.string().min(1),
    steps: z.array(StepSchema).min(1),
    fees: z
      .object({ gas: FeeSchema.optional(), relayer: FeeSchema.optional(), relayerGas: FeeSchema.optional(), relayerService: FeeSchema.optional(), app: FeeSchema.optional() })
      .passthrough()
      .optional(),
    details: z
      .object({
        operation: z.string().optional(),
        sender: z.string().optional(),
        recipient: z.string().optional(),
        currencyIn: AmountSchema,
        currencyOut: AmountSchema,
        rate: z.union([z.string(), z.number()]).optional(),
        totalImpact: z.object({ usd: z.string().optional(), percent: z.string().optional() }).passthrough().optional(),
        slippageTolerance: z
          .object({ destination: z.object({ percent: z.string().optional(), value: z.string().optional() }).passthrough().optional() })
          .passthrough()
          .optional(),
        timeEstimate: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type RelayRawQuote = z.output<typeof RelayRawQuoteSchema>;
export type RelayStep = z.output<typeof StepSchema>;

export type RelayQuoteFailure = Readonly<{
  ok: false;
  code: "HTTP_ERROR" | "RATE_LIMITED" | "UNAUTHORIZED" | "NO_ROUTE" | "TRANSPORT" | "UNREADABLE";
  status: number | null;
  reason: string;
  /** Relay's own code or message, for the operator trail; never shown raw. */
  provider: Readonly<{ code: string | number | null; message: string | null }>;
}>;

export type RelayQuoteSuccess = Readonly<{
  ok: true;
  quote: RelayRawQuote;
  observedAt: string;
  requestUrl: string;
}>;

export type RelayQuoteDependencies = Readonly<{
  /**
   * Ryntra's Relay API key, resolved by the server route that calls this.
   *
   * Not read here: this module is importable by a surface a browser loads, and a
   * module a browser may import is not a module that reads the environment. It
   * is sent so that per-key request history in the Relay Dashboard can tell
   * production apart from a preview deploy, and so this call counts against
   * Ryntra's own rate limit rather than the anonymous pool.
   */
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  origin?: string;
  timeoutMs?: number;
}>;

const RELAY_APP_FEE_RECIPIENT = /^0x[0-9a-fA-F]{40}$/;

export function buildRelayQuoteBody(request: RelayQuoteRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    user: request.user,
    recipient: request.recipient,
    originChainId: RELAY_CHAIN_IDS[request.fromNetwork],
    originCurrency: request.fromToken,
    destinationChainId: RELAY_CHAIN_IDS[request.toNetwork],
    destinationCurrency: request.toToken,
    amount: request.amountRaw,
    tradeType: "EXACT_INPUT",
    slippageTolerance: String(request.slippageBps ?? RELAY_SLIPPAGE_BPS),
  };
  /* A malformed recipient is dropped rather than sent. Relay would answer the
     request one way or another, and the failure mode worth avoiding is a
     configuration typo turning a working route into an unavailable one. The
     absence then shows up honestly in `ryntraFee` as `UNCONFIGURED`. */
  if (request.appFee && RELAY_APP_FEE_RECIPIENT.test(request.appFee.recipient) && request.appFee.bps > 0 && request.appFee.bps <= 10_000) {
    body.appFees = [{ recipient: request.appFee.recipient, fee: String(request.appFee.bps) }];
  }
  return body;
}

function readProviderError(payload: unknown): Readonly<{ code: string | number | null; message: string | null }> {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const code = record.errorCode ?? record.code;
    const message = record.message ?? record.msg;
    return {
      code: typeof code === "string" || typeof code === "number" ? code : null,
      message: typeof message === "string" ? message : null,
    };
  }
  return { code: null, message: null };
}

export async function fetchRelayQuote(
  request: RelayQuoteRequest,
  deps: RelayQuoteDependencies = {},
): Promise<RelayQuoteSuccess | RelayQuoteFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => new Date());
  const origin = deps.origin ?? RELAY_API_ORIGIN;
  const requestUrl = new URL(RELAY_QUOTE_PATH, origin).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000);

  /*
   * The referrer, and why it is conditional on the key.
   *
   * Relay attributes a quote to an integrator by `referrer`, which is what makes
   * Requests and Observability in the Dashboard say who asked — the reason for
   * having a key at all. It also **requires** the key whenever a referrer is
   * present: a referrer with no valid key answers `401 UNAUTHORIZED_QUOTE`.
   *
   * That is useful and dangerous in the same breath. Useful, because it turns a
   * successful quote into proof the key is accepted — otherwise a bad key is
   * invisible, since Relay quotes anonymously just as happily. Dangerous,
   * because sending it unconditionally would break every cross-chain quote on
   * any deployment that has no key yet — Production, today.
   *
   * So it travels exactly with the key. Key present: attributed, and a failure
   * is loud. Key absent: anonymous, and nothing breaks.
   */
  const body = buildRelayQuoteBody(request);
  const key = typeof deps.apiKey === "string" ? deps.apiKey.trim() : "";
  if (key.length > 0) body.referrer = RELAY_REFERRER;

  let response: Response;
  try {
    response = await fetchImpl(requestUrl, {
      method: "POST",
      headers: relayJsonHeaders({ apiKey: deps.apiKey }),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    return {
      ok: false,
      code: "TRANSPORT",
      status: null,
      reason: "Relay's quote service did not answer.",
      provider: { code: null, message: error instanceof Error ? error.message : String(error) },
    };
  }
  clearTimeout(timer);

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const provider = readProviderError(payload);
    if (response.status === 429) {
      return { ok: false, code: "RATE_LIMITED", status: 429, reason: "Relay is rate-limiting quotes right now.", provider };
    }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "UNAUTHORIZED", status: response.status, reason: "Relay refused this quote request.", provider };
    }
    /* Relay answers 400 both to a malformed request and to a pair it cannot
       route right now. The two are told apart by its own code, never by the
       status, so a temporary lack of liquidity is not reported as a bug in
       this product and a bug here is not reported as market conditions. */
    if (response.status === 400 && typeof provider.code === "string" && /ROUTE|LIQUIDITY|AMOUNT|SOLVER/i.test(provider.code)) {
      return { ok: false, code: "NO_ROUTE", status: 400, reason: "Not available for this pair right now.", provider };
    }
    return { ok: false, code: "HTTP_ERROR", status: response.status, reason: `Relay answered HTTP ${response.status}.`, provider };
  }

  const parsed = RelayRawQuoteSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      code: "UNREADABLE",
      status: response.status,
      reason: "Relay's answer did not have the shape of a quote.",
      provider: { code: null, message: null },
    };
  }
  return { ok: true, quote: parsed.data, observedAt: now().toISOString(), requestUrl };
}

/** The step a wallet is asked to sign, and the approvals before it. */
export function relayDepositStep(quote: RelayRawQuote): RelayStep | null {
  return quote.steps.find((step) => step.id === "deposit" || step.id === "swap") ?? quote.steps.at(-1) ?? null;
}

export function relayApprovalCount(quote: RelayRawQuote): number {
  return quote.steps.filter((step) => step.id === "approve" || step.id === "approval").length;
}

function usd(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function bpsFromPercent(percent: string | undefined): number | null {
  if (percent === undefined) return null;
  const parsed = Number(percent);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

/**
 * Relay's answer in the one shape every surface speaks.
 *
 * The signed minimum is `details.currencyOut.minimumAmount` — the number the
 * solver cannot fill below, and therefore the only number this product treats
 * as a promise. When Relay omits it the quote is not normalized at all rather
 * than falling back to the expected amount, which would quietly turn an
 * estimate into a guarantee.
 */
/**
 * Ryntra's app fee, as Relay's own quote states it.
 *
 * `fees.app` is the whole answer, and its absence is the answer too. Relay
 * documents that including `appFees` on an unsupported transaction type — a send,
 * a transfer, a gasless execution with no prior quote — returns **no error** and
 * collects nothing, so silence has to mean `NOT_APPLIED` rather than a fee this
 * lane assumes it earned. The currency comes from Relay's own `fees.app.currency`
 * (its docs note it matches the relayer fee currency); the amount is never
 * derived from the rate.
 */
function readRelayServiceFee(quote: RelayRawQuote, requested: Readonly<{ recipient: string; bps: number }> | null): RyntraServiceFee {
  if (!requested) {
    return serviceFeeUnconfigured("RELAY_APP_FEE", "No Relay app-fee claim address is configured, so no app fee was requested.");
  }
  const app = quote.fees?.app;
  const amountRaw = app?.amount;
  if (!app || amountRaw === undefined || BigInt(amountRaw) === 0n) {
    return serviceFeeNotApplied(
      "RELAY_APP_FEE",
      "Relay's quote states no app fee for this route. It answers without an error on an operation that does not support one, so nothing is assumed here.",
    );
  }
  return serviceFeeQuoted("RELAY_APP_FEE", {
    basisPoints: requested.bps,
    asset: app.currency?.address ?? null,
    symbol: app.currency?.symbol ?? null,
    decimals: app.currency?.decimals ?? null,
    amountRaw,
    usd: usd(app.amountUsd),
  });
}

export function normalizeRelayQuote(
  quote: RelayRawQuote,
  tuple: CrossSwapTuple,
  context: Readonly<{
    fromDecimals: number;
    toDecimals: number;
    observedAt: string;
    /** What was asked for, so the answer is checked rather than believed. */
    appFee?: Readonly<{ recipient: string; bps: number }> | null;
  }>,
): CrossSwapQuote | null {
  const minimumRaw = quote.details.currencyOut.minimumAmount;
  if (minimumRaw === undefined) return null;

  const approvals = relayApprovalCount(quote);
  const etaSeconds = quote.details.timeEstimate ?? 0;
  const observedUnix = Math.floor(new Date(context.observedAt).getTime() / 1000);

  return {
    schema: "ryntra.solana.cross-swap-quote",
    schemaVersion: "1.0.0",
    provider: "RELAY",
    route: RELAY_ROUTE,
    /* The name, and only the name. A person is never shown Relay's internal
       architecture — this label is read straight onto the Review, and "solver
       fills on the destination chain" describes a mechanism nobody is being
       asked to have an opinion about. Who carries the money is worth naming;
       how they carry it is Pro depth, and the pre-sign snapshot still records
       the mechanism in `route`. */
    routeLabel: "Relay",
    tupleId: tuple.id,
    from: {
      network: tuple.from.network,
      asset: tuple.from.asset,
      symbol: quote.details.currencyIn.currency.symbol,
      decimals: context.fromDecimals,
      amountRaw: quote.details.currencyIn.amount,
    },
    to: {
      network: tuple.to.network,
      asset: tuple.to.asset,
      symbol: quote.details.currencyOut.currency.symbol,
      decimals: context.toDecimals,
      expectedRaw: quote.details.currencyOut.amount,
      minimumRaw,
    },
    slippageBps: bpsFromPercent(quote.details.slippageTolerance?.destination?.percent) ?? RELAY_SLIPPAGE_BPS,
    etaSeconds,
    deadlineKind: "QUOTE_VALIDITY",
    deadlineUnix: observedUnix + RELAY_QUOTE_VALIDITY_SECONDS,
    fees: {
      /* Relay states its costs in currency and USD, never as a rate, so a
         basis-point protocol fee would be an invention. The USD aggregates it
         does state are carried through and labelled as the provider's own.

         `relayer` is a **parent** of `relayerGas + relayerService` — equal in
         raw units and in USD on every quote read 2026-09-09 — so the three are
         carried as a parent and its two parts and must never be summed
         together. `gas` is the one figure outside the impact: the source
         wallet pays it on top of the amount. */
      protocolBps: 0,
      protocolUsd: usd(quote.fees?.relayerService?.amountUsd),
      relayerUsd: usd(quote.fees?.relayer?.amountUsd),
      relayerGasUsd: usd(quote.fees?.relayerGas?.amountUsd),
      sourceGasUsd: usd(quote.fees?.gas?.amountUsd),
      refundUsd: null,
      /* Relay's Solana deposit opens no order account of its own, so there is
         no rent to withhold the way Mayan Swift's 3,000,000 lamports must be. */
      rentLamports: null,
      /* Mayan's word for an integrator fee. Relay has its own mechanism and its
         own field, so this stays zero and `serviceFee` below carries the truth
         for both rails in one shape. */
      referrerBps: 0,
    },
    serviceFee: readRelayServiceFee(quote, context.appFee ?? null),
    approvals,
    walletPrompts: approvals + 1,
    priceImpactBps: bpsFromPercent(quote.details.totalImpact?.percent),
    priceStatus: null,
    quoteId: quote.requestId,
    observedAt: context.observedAt,
  };
}
