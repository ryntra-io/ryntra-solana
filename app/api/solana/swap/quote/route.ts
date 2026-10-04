import { z } from "zod";

import {
  SPL_TRANSFER_ACTION_REF,
  type SplTransferInput,
} from "@/lib/agent-control/adapters/solana-token-2022";
import { consumeSolanaReadRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { SolanaOwnerPolicySchema } from "@/lib/solana/contracts";
import { readMintAccount, type MintReadSuccess } from "@/lib/solana/mint";
import { buildPassport } from "@/lib/solana/passport";
import { evaluateOwnerPolicy } from "@/lib/solana/policy";
import { buildTransferPreflight } from "@/lib/solana/preflight";
import { askOnceMoreAfterRate } from "@/lib/solana/jupiter-ask-again";
import { fetchJupiterOrder, resolveJupiterSwapEndpoint } from "@/lib/solana/quotes";
import { eventStateAt } from "@/lib/stocks/instrument";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { isRetiredMint, RETIRED_REASON } from "@/lib/stocks/retired";
import { verifiedJupiterReferral } from "@/lib/solana/referral-account.server";
import { resolveServiceFeeConfig } from "@/lib/swap/service-fee.server";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";
import { serverSendPolicy } from "@/lib/solana/send-safety";
import { buildSwapQuoteReview } from "@/lib/solana/swap-review";
import type { SolanaAssetPassport } from "@/lib/solana/types";
import { awaitCheckContext, readCheckContext, swapCheckOf } from "@/lib/stocks/check.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A read, but a read over the network; it says how long it may take, like its siblings. */
export const maxDuration = 30;

/**
 * Live quote for the swap card — read-only, wallet-free.
 *
 * The Trade page used to answer only through a full page navigation, which is
 * why its numbers arrived as a document rather than as a swap. This route
 * gives the card the same server-built truth on every keystroke-settled
 * amount: one keyed `/order` without a taker, both Asset Passports read live,
 * and the review policy's verdict over the output mint. It builds no
 * transaction, asks for no wallet and cannot sign — the executable path stays
 * `../order` and `../execute`.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/* The verdict is about the asset, not about a person: it asks what receiving
   the output subjects ANY holder to. These two stand-ins keep the preflight
   exact without inventing a wallet, exactly as the server page does. */
const ANY_HOLDER = "11111111111111111111111111111111";
const ANY_RECIPIENT = "SysvarRent111111111111111111111111111111111";

const RequestSchema = z
  .object({
    inputMint: z.string().regex(BASE58),
    outputMint: z.string().regex(BASE58),
    amountRaw: z.string().regex(/^[1-9][0-9]{0,19}$/),
    access: z.enum(["production", "degraded"]).default("production"),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.inputMint === value.outputMint) {
      context.addIssue({ code: "custom", path: ["outputMint"], message: "The two sides are the same mint." });
    }
  });

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision, extra: object = {}) {
  return Response.json({ error: { code, message, ...extra } }, { status, headers: responseHeaders(rate) });
}

export async function POST(request: Request) {
  const rate = consumeSolanaReadRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", "The quote request did not match its schema.", rate);
  }
  const input = parsed.data;

  /* A token its issuer no longer offers for purchase — redemption open, the
     window closed — is not quoted as a buy, whatever a pool still routes. The
     registry is a map lookup; a chain pause is caught below by the preflight,
     as it always was. */
  const lifecycle = lifecycleEventFor(input.outputMint);
  /* Read with the clock (`eventStateAt`): a conversion window past its cut-off is closed, whatever the registry still says. */
  const lifecycleState = lifecycle ? eventStateAt(lifecycle, Date.now()) : null;
  if (lifecycle && lifecycleState !== "conversion-open") {
    return failure(409, "ASSET_NOT_OFFERED", lifecycle.note, rate, { lifecycle: { state: lifecycleState, url: lifecycle.url } });
  }
  /* A token Ryntra no longer supports is quoted on neither side: no purchase, and no sale here — its holder sells in their own wallet. */
  if (isRetiredMint(input.inputMint) || isRetiredMint(input.outputMint)) {
    return failure(409, "ASSET_NOT_OFFERED", RETIRED_REASON, rate);
  }

  const selection = resolveJupiterSwapEndpoint({ access: input.access });
  if (!selection.ok) {
    return failure(503, "PROVIDER_KEY_MISSING", selection.reason, rate);
  }

  /* «Перевірка» (1.20.0): the company's row and SOL's price, read beside the venue's quote so they cost no time of their own. Never throws. */
  const checkContext = readCheckContext(input.inputMint, input.outputMint);

  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const sides: Record<string, SolanaAssetPassport> = {};
  const reads: Record<string, MintReadSuccess> = {};
  const decimals: Record<string, number> = {};
  for (const mint of [input.inputMint, input.outputMint]) {
    const read = await readMintAccount(handle, mint);
    if (!read.ok) {
      return failure(422, "MINT_UNREADABLE", `The mint ${mint} could not be read live: ${read.reason}`, rate);
    }
    const passport = buildPassport(read.raw);
    if (!passport.ok) {
      return failure(422, "PASSPORT_REFUSED", `The mint ${mint} passport was refused: ${passport.reason}`, rate);
    }
    sides[mint] = passport.passport;
    reads[mint] = read;
    decimals[mint] = passport.passport.identity.decimals.value;
  }

  const referral = (await verifiedJupiterReferral(resolveServiceFeeConfig())).referral;
  /* A quote moves nothing: refused for rate alone, it is asked once more after the provider's own short pause (DECISIONS 2026-09-15) — the sum the person typed is priced, not answered «Забагато запитів». */
  const result = await askOnceMoreAfterRate(() =>
    fetchJupiterOrder({ inputMint: input.inputMint, outputMint: input.outputMint, amountRaw: input.amountRaw, referral }, selection),
  );
  if (!result.ok) {
    const status = result.code === "NO_ROUTE" ? 409 : result.code === "RATE_LIMITED" ? 429 : 502;
    return failure(status, `QUOTE_${result.code}`, result.reason, rate, {
      provider: { errorCode: result.errorCode ?? null },
    });
  }
  const order = result.order;

  /* The same review policy the page has always rendered, judged over what
     receiving the output would subject any holder to. No wallet enters it:
     the card quotes before anyone connects, exactly as the page did. */
  const policy = SolanaOwnerPolicySchema.parse(serverSendPolicy("mainnet"));
  const transferInput: SplTransferInput = {
    schemaVersion: "1.0.0",
    actionRef: SPL_TRANSFER_ACTION_REF,
    network: "mainnet",
    mint: input.outputMint,
    sender: ANY_HOLDER,
    recipient: ANY_RECIPIENT,
    amountRaw: order.outAmountRaw,
  };
  const preflight = buildTransferPreflight({
    read: reads[input.outputMint],
    passport: sides[input.outputMint],
    input: transferInput,
  });
  if (!preflight.ok) {
    return failure(422, "PREFLIGHT_REFUSED", `The output review could not be built: ${preflight.reason}`, rate);
  }
  const verdict = evaluateOwnerPolicy({
    policy,
    input: transferInput,
    passport: sides[input.outputMint],
    preflight: preflight.preflight,
  });
  const review = buildSwapQuoteReview(order);
  /* The four lines on this quote, as the server counts them for every client — no reserve before the order proves one. */
  const context = await awaitCheckContext(checkContext);
  const check = swapCheckOf({ context, basis: "quote", order, decimals, mintRead: context ? (reads[context.stockMint] ?? null) : null, nowMs: Date.now() });

  return Response.json(
    {
      order,
      review,
      verdict,
      decimals,
      outputFee: {
        basisPoints: preflight.preflight.transferFee.basisPoints,
        feeRaw: preflight.preflight.transferFee.feeRaw,
        capApplied: preflight.preflight.transferFee.capApplied,
      },
      passports: sides,
      expiresAt: order.reviewExpiresAt,
      check,
    },
    { headers: responseHeaders(rate) },
  );
}
