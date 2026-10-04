import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { prepareSolanaSwap, swapPrepareContext } from "@/lib/core/solana-swap/prepare";
import { resolveSolanaLaneState } from "@/lib/solana/lane-state";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readSwapCarrier, walletMismatch } from "@/lib/solana/swap-carrier.server";
import { SolanaActionOriginRequestSchema } from "@/lib/solana/action-origin";
import type { JupiterExecutableOrder } from "@/lib/solana/quotes";
import { eventStateAt } from "@/lib/stocks/instrument";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { isRetiredMint, RETIRED_REASON } from "@/lib/stocks/retired";
import { awaitCheckContext, readCheckContext, swapCheckOf } from "@/lib/stocks/check.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * The time this route is allowed, declared — because it was the one heavy route
 * in the swap path that never declared it.
 *
 * `execute` takes 60, `recover` 60, `cancel-review` 30, and every cross-swap
 * route names one. This route named nothing and ran on the platform default,
 * while doing more work than any of them in a single request: two mint passport
 * reads, the Jupiter order build, a transaction inspection and an on-chain
 * simulation.
 *
 * What that costs when a hop is slow is not a slow answer. The platform ends
 * the invocation and returns a **bodyless 502**: the function never reaches its
 * own error handler, so nothing is logged, nothing names a code, and the card
 * falls to its catch-all sentence beside a button that is still enabled. A
 * person met exactly this on production on 2026-09-10 — five presses in
 * twenty-four seconds, five 502s, and not one line in the log saying why.
 *
 * 60 matches `execute`, which is the other end of the same operation.
 */
export const maxDuration = 60;

/**
 * The swap order and review route.
 *
 * Builds everything a person reviews before signing, and nothing that moves
 * value: a fresh Jupiter taker order (production key only, zero optional
 * routing parameters), both Asset Passports read live, the review policy's
 * verdict over the mint they would receive, the pre-sign firewall inspection
 * of the provider transaction, a simulation of those exact bytes with its
 * proven owner-effect deltas, the swap policy verdict over all of it, and the
 * issuer-signed execution bundle `../execute` will demand back unchanged. The
 * provider transaction is returned for the wallet to sign; this route never
 * sees a key and never submits.
 *
 * Any pair, any amount. The bounded USDC↔SOL / $2–5 / $20 envelope this route
 * used to enforce came from the owner canary in `canary-policy.ts`, which is
 * still the right shape for the families it governs and was never the right
 * shape for a swap of a person's own funds — it refused the live card in both
 * directions for every amount. `swap-policy.ts` judges the swap instead, and
 * everything that proves what the signed bytes do to the signer is unchanged.
 */

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const RequestSchema = z
  .object({
    input: z
      .object({
        inputMint: z.string().regex(BASE58),
        outputMint: z.string().regex(BASE58),
        amountRaw: z.string().regex(/^[1-9][0-9]{0,19}$/),
        taker: z.string().regex(BASE58),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.inputMint === value.outputMint) {
          context.addIssue({
            code: "custom",
            path: ["outputMint"],
            message: "The two sides are the same mint.",
          });
        }
      }),
    /**
     * Spot names itself here — `{ surface: "SPOT", side }` — and the Swap
     * page sends nothing. It changes no quote, no route and no fee; it is
     * written into the signed bundle so the Activity row can say `Spot Buy`
     * rather than a stray `Swap` for the same transaction.
     *
     * `origin.plan` names a Trading Plan and the version the client read. It
     * is a reference for the check, never a proof of anything: the plan is
     * read for the proven wallet, which must be the taker, and judged on this
     * exact order; a blocked verdict refuses the order before any bytes leave,
     * and the block goes into the signed bundle so `execute` and Plan vs
     * Actual read what stood here.
     */
    origin: SolanaActionOriginRequestSchema.optional(),
  })
  .strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(
  status: number,
  code: string,
  message: string,
  rate: RateLimitDecision,
  extra: object = {},
) {
  /* A refusal this route decides is written down. Production carried five
     failed Reviews on 2026-09-10 and the log held five request lines and not
     one reason — so the only way to learn what happened was to reproduce it.
     The code and the status, never the taker and never the amount: what is
     needed to fix a route is not the same as what a person is trading. */
  if (status >= 500) console.error(`swap-order refused: ${code} (HTTP ${status})`);
  return Response.json(
    { error: { code, message, ...extra } },
    { status, headers: responseHeaders(rate) },
  );
}

function describeIssues(error: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    const where = issue.path.join(".");
    const line = where ? `${where} — ${issue.message}` : issue.message;
    if (lines.includes(line)) continue;
    lines.push(line);
    if (lines.length === 3) break;
  }
  return lines.length > 0 ? lines.join(" · ") : "The swap order request was not accepted.";
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  /* The site's origin for a browser, the native bearer for the phone; a
     bearer that fails is refused by its own code and never falls through
     (`lib/solana/swap-carrier.ts`). */
  const carrier = await readSwapCarrier(request, "The swap order request must come from this site.");
  if (!carrier.ok) return failure(carrier.status, carrier.code, carrier.message, rate);
  /* No owner session. A swap moves the connected wallet's own funds and is
     authorized by that wallet's own signature over the reviewed bytes — an
     admin login here only ever meant "an operator is testing", and it made the
     product unusable for the people it is for. What still stands between a
     request and a signable Review is the site origin (or the bearer's wallet,
     bound to the taker below), the rate limit, the durable per-taker lock
     below, and the issuer signature over the bundle.

     The lane stop replaces it as the operator control. Fail-closed, and
     re-derived here rather than trusted from the request. */
  if (resolveSolanaLaneState("SWAP") !== "OPEN") {
    return failure(409, "SWAP_PAUSED", "Swapping is turned off right now.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return failure(400, "VALIDATION_ERROR", describeIssues(parsed.error), rate);
  const { input, origin } = parsed.data;
  /* A native session asks for its own wallet only. */
  if (walletMismatch(carrier, input.taker)) return failure(403, "WALLET_MISMATCH", "The session's wallet is not the taker of this order.", rate);
  /* The same refusal the quote route gives: a token the issuer no longer offers for purchase builds no order. */
  const lifecycle = lifecycleEventFor(input.outputMint);
  /* Read with the clock, as the quote route does: past its cut-off a conversion window is closed. */
  if (lifecycle && eventStateAt(lifecycle, Date.now()) !== "conversion-open") {
    return failure(409, "ASSET_NOT_OFFERED", lifecycle.note, rate);
  }
  /* The quote route's refusal of a token Ryntra no longer supports, on either side: no order is built for it. */
  if (isRetiredMint(input.inputMint) || isRetiredMint(input.outputMint)) {
    return failure(409, "ASSET_NOT_OFFERED", RETIRED_REASON, rate);
  }
  /* Everything from here to the signable Review is the swap's prepare half of
     the core pipeline (`lib/core/solana-swap/prepare.ts`): the intent's
     terms, the owner lock, the venue, the asset passports, the order, and the
     shared safety chain — the transaction check, the effect firewall, the
     review policy, the plan, the review proof and the owner lock. A step that
     stops answers here with its own status, code and words. */
  /* «Перевірка» (1.20.0): the company's row and SOL's price, read beside the order's build so they cost no time of their own. Never throws. */
  const checkContext = readCheckContext(input.inputMint, input.outputMint);
  const swap = swapPrepareContext({ request, carrier, input, origin });
  const run = await prepareSolanaSwap(swap);
  if (!run.completed) return failure(run.stop.status, run.stop.code, run.stop.message, rate, run.stop.extra);
  const order = swap.order as JupiterExecutableOrder;
  const { review, bundle, proof, preSign, simulation, passports, decimals, reads, planReview } = swap;

  /* The four lines on these exact bytes, with the reserve the simulation proved — what every client shows before the signature. */
  const context = await awaitCheckContext(checkContext);
  const check = swapCheckOf({ context, basis: "order", order, decimals, mintRead: context ? (reads[context.stockMint] ?? null) : null, nowMs: Date.now() });

  return Response.json(
    {
      order: {
        ...order,
        /* The wallet signs these exact bytes; the review binds their hash. */
        transactionBase64: order.transactionBase64,
      },
      review,
      inspection: bundle!.inspection,
      simulation,
      passports,
      decimals,
      assetReview: swap.outputAssetVerdict,
      policy: { intent: swap.intent, verdict: swap.verdict },
      bundle,
      proof,
      preSign,
      expiresAt: order.reviewExpiresAt,
      planReview,
      check,
    },
    { headers: responseHeaders(rate) },
  );
}
