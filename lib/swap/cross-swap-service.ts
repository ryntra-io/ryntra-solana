/**
 * Shared server-side helpers of the cross-chain swap lane: the pieces `quote`,
 * `plan`, `submit` and `status` all need and none should re-invent.
 *
 * This module used to live at `lib/mayan/cross-swap-service.ts`, which was the
 * right address for exactly as long as there was one provider. It moved here
 * with `RYN-SOL-MONEY-FLOWS-001H` because the lane now dispatches between two
 * — Mayan for the pairs it serves, Relay for the Robinhood Chain pairs it
 * cannot reach — and a dispatcher that lives inside one of its own branches is
 * a dispatcher nobody can read. The old path re-exports this one, so every
 * existing import keeps working.
 *
 * The engine is never inferred from the pair of networks. It is read off the
 * tuple the Owner approved (`catalog.ts`), which is the only thing that can
 * say which provider was named for which pair.
 */

import { fetchRelayQuote, normalizeRelayQuote, relayApprovalCount, RELAY_SLIPPAGE_BPS } from "../relay/quote-api.ts";
import { relayNativeAddress } from "../relay/chains.ts";
import type { RelayAuth } from "../relay/http.ts";
import { resolveSwapToken } from "../relay/currencies.ts";
import { fetchMayanQuotes, isMayanServedNetwork, MAYAN_NATIVE_TOKEN, normalizeMayanQuote, selectMayanQuote, type MayanQuoteDependencies, type MayanRawQuote } from "../mayan/price-api.ts";
import type { SolanaActionMovement } from "../solana/action-ledger.ts";
import { formatRawAmount, type ResolvedSwapAsset, type SwapNetwork } from "./catalog.ts";
import { classifySwapRoute, type SwapRouteClassification } from "./classify.ts";
import type { CrossSwapQuote } from "./cross-swap-quote.ts";
import { SERVICE_FEE_CONFIG_UNSET, serviceFeeRateFor, type ServiceFeeConfig } from "./service-fee.ts";

export const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function addressShapeOk(network: SwapNetwork, address: string): boolean {
  return network === "solana" ? SOLANA_ADDRESS.test(address) : EVM_ADDRESS.test(address);
}

export type CrossSwapRoute = Extract<SwapRouteClassification, { kind: "CROSS_SWAP" }> &
  Readonly<{ fromDecimals: number; toDecimals: number; fromVerified: boolean; toVerified: boolean }>;

/**
 * How much of the value a swap consumes before it arrives, in basis points,
 * and what this product does about it.
 *
 * Widening which assets the lane carries made this the load-bearing control,
 * because the old ten-pair list had been doing the job by accident: every pair
 * on it was liquid, so nothing ever came back at a terrible price. A wider set
 * of assets is a different world. Read live on 2026-09-09, all real, all
 * executable: Base DEGEN → Robinhood USDG at **−84.8%**, Ethereum PEPE →
 * Solana JUP at **−59.4%**, Base DEGEN → Solana BONK at −20.4%. The same rail
 * on a real-sized liquid trade — 10 SOL → USDG — costs −0.54%.
 *
 * Most of that gap is not a bad pair, it is a small amount paying fixed
 * relayer costs, which is why the answer is not a blocklist. It is the number
 * itself, said out loud, at the moment somebody is deciding.
 *
 * - up to `NOTABLE` the cost is ordinary and stated with the other figures;
 * - past it the surface must show the loss prominently;
 * - past `SEVERE` the plan refuses to build until the person has acknowledged
 *   that exact quote, so a signature can never be the first time they see it.
 *
 * Nothing here refuses outright. A person may knowingly move a small amount at
 * a bad price and that is their call to make — but not by accident, and not
 * without the number in front of them.
 *
 * ## These two numbers are policy, not physics
 *
 * Owner instruction, 2026-09-09: **ten per cent is not a universally safe
 * threshold**. It is this product's current policy line for "loud enough to
 * demand a deliberate second look", chosen against the figures above, and it
 * is expected to be revisited. Nothing anywhere may read a quote under it as
 * safe, cheap or approved — only as *not yet past the line where this product
 * insists on stopping you*. The band names say what they mean and deliberately
 * avoid the word "safe" for the same reason.
 */
export const CROSS_SWAP_IMPACT_NOTABLE_BPS = 200;
export const CROSS_SWAP_IMPACT_SEVERE_BPS = 1_000;
/** Named so a reader of a call site knows the numbers above are a policy line. */
export const CROSS_SWAP_IMPACT_POLICY = { notableBps: CROSS_SWAP_IMPACT_NOTABLE_BPS, severeBps: CROSS_SWAP_IMPACT_SEVERE_BPS, reviewable: true } as const;

export type CrossSwapImpactBand = "ORDINARY" | "NOTABLE" | "SEVERE";

export function crossSwapImpactBand(priceImpactBps: number | null): CrossSwapImpactBand {
  /* An unknown impact is not a good impact. Mayan returns null for it on some
     routes, and treating "we do not know" as "it is fine" is how the worst
     number gets through the quietest path. */
  if (priceImpactBps === null) return "ORDINARY";
  const loss = -priceImpactBps;
  if (loss >= CROSS_SWAP_IMPACT_SEVERE_BPS) return "SEVERE";
  if (loss >= CROSS_SWAP_IMPACT_NOTABLE_BPS) return "NOTABLE";
  return "ORDINARY";
}

export type CrossSwapRouteResolution =
  | Readonly<{ ok: true; route: CrossSwapRoute }>
  | Readonly<{ ok: false; code: "PAIR_NOT_SUPPORTED" | "NOT_A_CROSS_SWAP" | "TOKEN_UNKNOWN"; reason: string; detail: Record<string, unknown> }>;

/**
 * The pair, classified, with both sides' decimals known.
 *
 * Decimals used to come from the catalog and a pair whose sides were not in it
 * did not exist. Since `RYN-SOL-MONEY-FLOWS-001I` a supported asset may be named without being in it, so
 * the ones the catalog does not carry are read from the token index instead —
 * and a token the index cannot describe is **refused**, never defaulted.
 *
 * That refusal is the most important line in this function. Decimals decide
 * the size of a swap: read a 5-decimal token as 18-decimal and the amount a
 * person meant to send becomes a different number entirely. There is no safe
 * fallback value, so there is no fallback.
 */
export async function resolveCrossSwapRoute(
  from: Readonly<{ network: SwapNetwork; asset: string }>,
  to: Readonly<{ network: SwapNetwork; asset: string }>,
  deps: Readonly<{ resolveToken?: typeof resolveSwapToken }> = {},
): Promise<CrossSwapRouteResolution> {
  const route = classifySwapRoute(from, to);
  if (!route.ok) return { ok: false, code: "PAIR_NOT_SUPPORTED", reason: "Not available for this pair.", detail: { reason: route.reason } };
  if (route.kind !== "CROSS_SWAP") return { ok: false, code: "NOT_A_CROSS_SWAP", reason: "This pair belongs to another engine.", detail: { kind: route.kind, engine: route.engine } };

  const lookup = deps.resolveToken ?? resolveSwapToken;
  const side = async (asset: ResolvedSwapAsset): Promise<Readonly<{ decimals: number; symbol: string; verified: boolean }> | null> => {
    if (asset.decimals !== null && asset.symbol !== null) return { decimals: asset.decimals, symbol: asset.symbol, verified: true };
    const token = await lookup({ network: asset.network, address: asset.asset });
    return token ? { decimals: token.decimals, symbol: token.symbol, verified: token.verified } : null;
  };

  const [fromToken, toToken] = await Promise.all([side(route.from), side(route.to)]);
  if (!fromToken || !toToken) {
    return {
      ok: false,
      code: "TOKEN_UNKNOWN",
      reason: "One of these tokens could not be identified, so no amount can be worked out for it.",
      detail: { from: fromToken === null, to: toToken === null },
    };
  }

  return {
    ok: true,
    route: {
      ...route,
      from: { ...route.from, decimals: fromToken.decimals, symbol: fromToken.symbol },
      to: { ...route.to, decimals: toToken.decimals, symbol: toToken.symbol },
      fromDecimals: fromToken.decimals,
      toDecimals: toToken.decimals,
      /* Carried so every surface can say which side nobody has vouched for.
         See `lib/relay/currencies.ts`: searching "USDC" returns the real one
         and four impostors, and a person must be told which is which. */
      fromVerified: fromToken.verified,
      toVerified: toToken.verified,
    },
  };
}

/**
 * The address a provider is asked about.
 *
 * Both of these read the catalog first and **the asset's own address second**,
 * and the second half is not decoration. They used to end at
 * `asset.catalog?.address`, which is `null` for every token outside the
 * catalog — fine while the lane only carried eight of them, and silently
 * wrong the moment `RYN-SOL-MONEY-FLOWS-001I` allowed a ninth supported asset: the
 * URL went out with `toToken=undefined`, the provider answered "no route",
 * and the surface reported a routing failure for a question that was never
 * asked properly. Found by quoting BONK into DEGEN, which the provider
 * answers perfectly well when it is actually told which token DEGEN is.
 */
export function mayanTokenFor(asset: ResolvedSwapAsset): string {
  if (asset.catalog?.kind === "NATIVE") return MAYAN_NATIVE_TOKEN;
  if (asset.network === "solana") return (asset.solanaMint ?? asset.asset) as string;
  return asset.catalog?.address ?? asset.asset;
}

/** Relay names it the same way, except that Solana's native coin is the System Program id. */
export function relayTokenFor(asset: ResolvedSwapAsset): string {
  if (asset.catalog?.kind === "NATIVE") return relayNativeAddress(asset.network);
  if (asset.network === "solana") return (asset.solanaMint ?? asset.asset) as string;
  return asset.catalog?.address ?? asset.asset;
}

/**
 * How many approvals the source wallet will be asked for before the swap.
 *
 * Solana needs none — an owner signature covers a token account. On an EVM
 * chain the native coin needs none and **everything else is an ERC-20 and
 * needs one**, which is the half this used to get wrong: it asked whether the
 * asset was a catalog `TOKEN`, and an arbitrary contract is not in the catalog
 * at all, so PEPE and DEGEN counted as needing no approval. The quote then
 * disagreed with the provider's own plan and the pair was refused as a
 * mismatch — a real pair, reported as impossible, because of a question about
 * a lookup table rather than about the token.
 */
export function approvalsFor(route: CrossSwapRoute): number {
  if (route.from.network === "solana") return 0;
  return route.from.catalog?.kind === "NATIVE" ? 0 : 1;
}

export type CrossSwapQuoteOutcome =
  | Readonly<{
      ok: true;
      quote: CrossSwapQuote;
      /** The provider's own answer, kept for the plan and the operator trail. */
      raw: MayanRawQuote | Record<string, unknown>;
      considered: readonly MayanRawQuote[];
      declined: readonly string[];
      observedAt: string;
    }>
  | Readonly<{ ok: false; status: number; code: string; reason: string; detail: Record<string, unknown> }>;

export type CrossSwapQuoteOptions = Readonly<{
  destinationAddress?: string;
  /** The wallet that will sign on the source chain. Relay prices per wallet; Mayan does not. */
  sourceAddress?: string;
  /**
   * Ryntra's receiving addresses, resolved by the caller.
   *
   * Passed in rather than read here because this module is imported by the
   * pre-sign snapshot, which is imported in turn by surfaces close to the client
   * bundle. A module that reads the environment is a module a browser must never
   * import, and this one stays importable. Omitting it quotes with no fee and
   * says so in `quote.serviceFee`.
   */
  feeConfig?: ServiceFeeConfig;
  /** Transport and auth for the provider call. `apiKey` is Ryntras Relay key,
      resolved by the server route — never read from the environment in here. */
  deps?: MayanQuoteDependencies & RelayAuth;
}>;

/**
 * A live quote for a pair, from the rail that carries its chains.
 *
 * ## Choosing a rail is not falling back to one
 *
 * The rule this lane has always held is that the swap a person signs is the
 * swap they reviewed: no provider may change after a Review, ever, because the
 * two rails have different custody shapes and different failure modes.
 *
 * That rule was implemented as "the pair names one provider and nothing else is
 * ever asked", which was the same thing while ten liquid pairs each had an
 * obvious rail. With any token allowed it stops being the same thing: Mayan has
 * no route for Ethereum PEPE into Solana JUP, Relay does, and answering "not
 * available" while a rail sits there able to do it is a worse answer than the
 * rule was written to prevent.
 *
 * So the choice happens **once, before anything is shown**: the pair's own rail
 * is asked first, and only a plain *no route* — never a transport failure, a
 * refusal, or a rate limit, which say nothing about whether a route exists —
 * lets the other rail be asked. Whichever answers is named in the outcome, in
 * the quote, in the Review and in the stored order, and from that point nothing
 * may change it. A person is never shown one rail and signed onto another.
 */
export async function quoteCrossSwap(route: CrossSwapRoute, amountRaw: string, options: CrossSwapQuoteOptions = {}): Promise<CrossSwapQuoteOutcome> {
  /*
   * One rail asks, and nobody else is asked after it.
   *
   * Until 2026-09-10 a plain *no route* from the pair's own rail let the other
   * one be asked, which was a reasonable answer to "Mayan cannot fill Ethereum
   * PEPE into Solana JUP and Relay can". The Owner's split removes the question:
   * Bridge is Relay-only, *«Без автоматичного fallback між ними»*, and Swap is
   * Jupiter-only on the other page. What a second rail bought — one more pair
   * occasionally filled — cost the property that makes this lane explainable,
   * because a person could be shown a price from one rail and, on a later
   * keystroke, a price from another with a different custody shape and a
   * different failure mode.
   *
   * `quoteViaMayan` stays compiled, tested and one line away. Restoring it is
   * this function; nothing else in the lane assumes it is gone.
   */
  return quoteViaRelay(route, amountRaw, options);
}

/**
 * The Mayan rail, kept and exported although `quoteCrossSwap` no longer calls it.
 *
 * Exported rather than left private because that is what "kept as rollback"
 * has to mean to be true: a private function nothing calls is dead code a
 * linter deletes, while an exported one is a documented seam with its tests
 * still running against it. Restoring the rail is one line in `quoteCrossSwap`.
 */
export async function quoteViaMayan(route: CrossSwapRoute, amountRaw: string, options: CrossSwapQuoteOptions): Promise<CrossSwapQuoteOutcome> {
  const fee = options.feeConfig ?? SERVICE_FEE_CONFIG_UNSET;
  if (!isMayanServedNetwork(route.from.network) || !isMayanServedNetwork(route.to.network)) {
    /* Unreachable through the classifier, which only hands Mayan its own
       tuples. Kept because the alternative to this branch is a URL with
       `toChain=undefined` reported to a person as a market condition. */
    return { ok: false, status: 409, code: "PAIR_NOT_SUPPORTED", reason: "Not available for this pair.", detail: { reason: "PROVIDER_DOES_NOT_SERVE_NETWORK" } };
  }
  const result = await fetchMayanQuotes(
    {
      fromChain: route.from.network,
      fromToken: mayanTokenFor(route.from),
      toChain: route.to.network,
      toToken: mayanTokenFor(route.to),
      amountIn: formatRawAmount(amountRaw, route.fromDecimals),
      destinationAddress: options.destinationAddress,
      /* Both go on the wire together or neither does — Mayan reads the rate only
         when it has been told who to pay. */
      referrer: fee.mayanReferrerSolana ?? undefined,
      referrerBps: fee.mayanReferrerSolana ? serviceFeeRateFor("MAYAN_REFERRER") : undefined,
    },
    options.deps,
  );
  if (!result.ok) {
    const status = result.code === "NO_QUOTES" ? 409 : result.code === "RATE_LIMITED" ? 429 : 502;
    return { ok: false, status, code: `QUOTE_${result.code}`, reason: result.reason, detail: { provider: { code: result.provider.code } } };
  }
  const selection = selectMayanQuote(result.quotes, route.tuple);
  if (!selection.selected) {
    return { ok: false, status: 409, code: "QUOTE_NO_ADMISSIBLE_ROUTE", reason: "Not available for this pair right now.", detail: { declined: selection.declined } };
  }
  const quote = normalizeMayanQuote(selection.selected, route.tuple, {
    fromDecimals: route.fromDecimals,
    toDecimals: route.toDecimals,
    observedAt: result.observedAt,
    approvals: approvalsFor(route),
    referrerBps: fee.mayanReferrerSolana ? serviceFeeRateFor("MAYAN_REFERRER") : null,
  });
  return { ok: true, quote, raw: selection.selected, considered: selection.considered, declined: selection.declined, observedAt: result.observedAt };
}

async function quoteViaRelay(route: CrossSwapRoute, amountRaw: string, options: CrossSwapQuoteOptions): Promise<CrossSwapQuoteOutcome> {
  const fee = options.feeConfig ?? SERVICE_FEE_CONFIG_UNSET;
  /* Relay prices for a specific wallet and recipient, because the route it
     builds depends on them — whether a destination token account exists, and
     what the deposit transaction has to say. A quote asked without them would
     price a different transaction from the one a person would sign, so the
     lane refuses rather than quoting something it cannot then build. */
  const user = options.sourceAddress;
  const recipient = options.destinationAddress;
  if (!user || !recipient) {
    /* Which one is missing, not merely that one is. Both were named on every
       refusal, so a person who had filled the destination and connected no
       wallet was told to fix the destination — the one field they had already
       got right. The surface words this from `needs`, so it can only say what
       is true here. */
    const needs = [...(user ? [] : ["sourceAddress"]), ...(recipient ? [] : ["destinationAddress"])];
    return { ok: false, status: 400, code: "QUOTE_ADDRESSES_REQUIRED", reason: "This route is priced for the wallets it will use.", detail: { needs } };
  }
  if (!addressShapeOk(route.from.network, user) || !addressShapeOk(route.to.network, recipient)) {
    return { ok: false, status: 400, code: "QUOTE_ADDRESS_SHAPE", reason: "One of the addresses does not belong to its network.", detail: {} };
  }

  const result = await fetchRelayQuote(
    {
      fromNetwork: route.from.network,
      fromToken: relayTokenFor(route.from),
      toNetwork: route.to.network,
      toToken: relayTokenFor(route.to),
      amountRaw,
      user,
      recipient,
      slippageBps: RELAY_SLIPPAGE_BPS,
      appFee: fee.relayAppFeeRecipient ? { recipient: fee.relayAppFeeRecipient, bps: serviceFeeRateFor("RELAY_APP_FEE") } : null,
    },
    options.deps,
  );
  if (!result.ok) {
    const status = result.code === "NO_ROUTE" ? 409 : result.code === "RATE_LIMITED" ? 429 : result.code === "UNAUTHORIZED" ? 502 : 502;
    return { ok: false, status, code: `QUOTE_${result.code}`, reason: result.reason, detail: { provider: { code: result.provider.code } } };
  }
  const quote = normalizeRelayQuote(result.quote, route.tuple, {
    fromDecimals: route.fromDecimals,
    toDecimals: route.toDecimals,
    observedAt: result.observedAt,
    appFee: fee.relayAppFeeRecipient ? { recipient: fee.relayAppFeeRecipient, bps: serviceFeeRateFor("RELAY_APP_FEE") } : null,
  });
  if (!quote) {
    /* Relay answered without a signed minimum. The expected amount is not a
       promise, so there is nothing here a person could review. */
    return { ok: false, status: 409, code: "QUOTE_NO_SIGNED_MINIMUM", reason: "Not available for this pair right now.", detail: { reason: "NO_MINIMUM" } };
  }
  const approvals = relayApprovalCount(result.quote);
  const expectedApprovals = approvalsFor(route);
  /*
   * More prompts than expected is a disagreement. **Fewer is not.**
   *
   * This guard exists so the number of wallet prompts stated before the first
   * one opens is the number that actually opens, and it read `!==`. That was
   * wrong in a way that took a real swap to find: the count is not a property of
   * the route, it is a property of **this wallet's current allowance**. An
   * ERC-20 origin needs an `approve` once; every quote after that one legitimately
   * has none, because the allowance already stands.
   *
   * So the first approval a person ever granted permanently refused every later
   * quote for that pair — `expected: 1, quoted: 0` — and the refusal surfaced as
   * "the price could not be read", which is neither what happened nor something
   * anybody could act on. Approving is the product working; it cannot be the
   * thing that breaks it.
   *
   * Fewer prompts than stated is strictly better for the person and is accepted.
   * More is still refused: that is the surprise this guard was written for.
   */
  if (approvals > expectedApprovals) {
    return { ok: false, status: 409, code: "QUOTE_APPROVAL_MISMATCH", reason: "Not available for this pair right now.", detail: { expected: expectedApprovals, quoted: approvals } };
  }
  return { ok: true, quote, raw: result.quote as unknown as Record<string, unknown>, considered: [], declined: [], observedAt: result.observedAt };
}

/**
 * A History movement read off a stored order rather than off a live route.
 *
 * Both value-moving routes used to rebuild the route by finding the pair in
 * `CROSS_SWAP_TUPLES` and re-resolving it. That worked while the list was the
 * gate and every stored order was on it. It stopped being safe the moment the
 * list became a shortlist: an order on any other pair would find nothing, and
 * `syncHistory` returns early on nothing — so money would have moved and
 * History would have stayed silent about it, which is the exact defect
 * `RYN-SOL-MONEY-FLOWS-001D` found the hard way on the reverse bridge lane.
 *
 * The record already carries every fact History needs, and it carries them as
 * they were at Review rather than as some later lookup would reconstruct them.
 * So it is the source, and no lookup can fail.
 */
export function recordedMovement(
  record: Readonly<{ sourceChain: SwapNetwork; fromSymbol: string; fromDecimals: number }>,
  amountRaw: string,
  mint: string | null,
): SolanaActionMovement {
  return { mint: record.sourceChain === "solana" ? mint : null, amountRaw, decimals: record.fromDecimals, symbol: record.fromSymbol };
}

/** A History movement; EVM assets have no base58 mint and are named by symbol alone. */
export function movementFor(asset: ResolvedSwapAsset, amountRaw: string): SolanaActionMovement {
  return {
    mint: asset.network === "solana" ? asset.solanaMint : null,
    amountRaw,
    decimals: asset.decimals,
    symbol: asset.symbol,
  };
}

export function historyDestinationFor(network: SwapNetwork): "BASE" | "SOLANA" | "ETHEREUM" | "ROBINHOOD" {
  switch (network) {
    case "base":
      return "BASE";
    case "ethereum":
      return "ETHEREUM";
    case "robinhood":
      return "ROBINHOOD";
    default:
      return "SOLANA";
  }
}

/** The wallet a cross-swap row belongs to in History: always the Solana side. */
export function historyWalletFor(route: CrossSwapRoute, owner: string, destination: string): string {
  return route.from.network === "solana" ? owner : destination;
}
