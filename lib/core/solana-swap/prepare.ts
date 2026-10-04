/**
 * A Solana swap, from the request to the Review the wallet signs — the
 * `prepare` half of the intent pipeline.
 *
 *     intent → owner lock free → venue → passports → order (quote + build)
 *       → transaction check → effect firewall → review policy → plan
 *       → review proof → owner lock reserved
 *
 * Everything a person reviews before signing, and nothing that moves value.
 * The order route admits the request (the carrier, the operator stop, the
 * schema, the asset's offer) and runs this; every refusal below is the same
 * refusal, with the same status, code and words, the route gave when these
 * steps were written inline in it. The safety chain — the transaction check,
 * the effect firewall, the review, the owner lock — is the guard of
 * `./guard.ts`, shared with every line that builds bytes for a wallet.
 */

import type { z } from "zod";

import { requireWalletProof } from "../../api/v1/proof.ts";
import type { PlanReview } from "../../api/v1/contract.ts";
import { isTokenPlanAsset } from "../../api/v1/contract.ts";
import { judgeRuleOrder } from "../../autoinvest/model.ts";
import { conditionFactsOf as ruleConditionFacts, ledgerOf, remainingFor } from "../../autoinvest/service.ts";
import { listRuleRecords, readBudgetRecord, readRule } from "../../autoinvest/store.ts";
import { loadIssuerKey } from "../../agent-control/issuer.ts";
import { readsOf } from "../../evidence/conditions.ts";
import { readMarketEvidence } from "../../evidence/service.server.ts";
import { evaluatePlanReview, type EvidenceReadByWindow } from "../../plans/review.ts";
import { recordPlanReview } from "../../plans/service.ts";
import { projectTradingPlan, readTradingPlan, type TradingPlanRecord } from "../../plans/store.ts";
import type { SolanaActionOrigin, SolanaActionOriginRequest } from "../../solana/action-origin.ts";
import { readMintAccount, type MintReadSuccess } from "../../solana/mint.ts";
import { buildPassport } from "../../solana/passport.ts";
import { resolveJupiterSwapEndpoint, type JupiterSwapEndpoint } from "../../solana/quotes.ts";
import { verifiedJupiterReferral } from "../../solana/referral-account.server.ts";
import { SOLANA_MAINNET_USDC_MINT } from "../../solana/send-kinds.ts";
import type { SwapCarrier } from "../../solana/swap-carrier.ts";
import type { SwapExecutionSimulationSchema } from "../../solana/swap-execution-review.ts";
import type { SolanaAssetPassport } from "../../solana/types.ts";
import { readSpotMarket } from "../../spot/markets.server.ts";
import { findStockRow } from "../../stocks/universe.server.ts";
import { resolveServiceFeeConfig } from "../../swap/service-fee.server.ts";
import type { TradeIntent } from "../contracts.ts";
import { definePipeline, NEXT, need, runPipeline, type PipelineRun, type PipelineStep, type StepResult } from "../pipeline.ts";
import { createJupiterSwapVenue, JupiterOrderRefusal } from "../venues/jupiter.ts";
import {
  SOLANA_SWAP_REVIEW_GUARD,
  handleOf,
  ownerLockFreeStep,
  storeOf,
  type SwapReviewGuardContext,
} from "./guard.ts";
import type { SwapRefusal } from "./refusal.ts";

/** What the order route admitted: a valid request from an accepted carrier. */
export type SwapPrepareRequest = Readonly<{
  request: Request;
  carrier: Extract<SwapCarrier, { ok: true }>;
  input: Readonly<{ inputMint: string; outputMint: string; amountRaw: string; taker: string }>;
  origin: SolanaActionOriginRequest | undefined;
}>;

export type SwapPrepareContext = SwapPrepareRequest &
  SwapReviewGuardContext & {
    planRecord: TradingPlanRecord | null;
    endpoint: JupiterSwapEndpoint | null;
    passports: Record<string, SolanaAssetPassport>;
    reads: Record<string, MintReadSuccess>;
    decimals: Record<string, number>;
  };

const refuse = (status: number, code: string, message: string, extra?: object): StepResult<SwapRefusal> => ({
  stop: { status, code, message, ...(extra ? { extra } : {}) },
});

/* ----------------------------------------------------------------- quote */

/**
 * The intent's own terms: the plan or the reminder it is made under, for the
 * proven wallet only. A plan id in a request proves nothing — the wallet that
 * proved itself (the web's proof cookie or the native bearer) must be the
 * taker, and the plan must be that wallet's. Read before the durability gate
 * and any provider call, so a plan that is not there costs no quote and a
 * stand without the durable lock still proves the refusals; judged after the
 * order is built, on the order.
 */
const intentTerms: PipelineStep<SwapPrepareContext, SwapRefusal> = {
  stage: "quote",
  name: "intent-terms",
  async run(context) {
    const { request, carrier, input, origin } = context;
    const store = storeOf(context);
    if (origin?.plan) {
      /* The bearer already proved the wallet above; the web proves it with the cookie here. */
      const proof = carrier.carrier === "bearer" ? carrier : await requireWalletProof(request, "mutation");
      if (!proof.ok) return refuse(401, "UNAUTHORIZED", "Trading under a plan needs the proven wallet: confirm the wallet first.");
      if (proof.address !== input.taker) return refuse(403, "WALLET_MISMATCH", "The proven wallet is not the taker of this order.");
      context.planRecord = await readTradingPlan(store, input.taker, origin.plan.planId);
      if (!context.planRecord) return refuse(404, "PLAN_NOT_FOUND", "No such plan for this wallet.");
    }
    /* An autoinvest reminder (1.12.0), for the proven wallet only, on the same
       terms as the plan: the rule must be the taker's and on, the reminder the
       order names must be open — not bought, not on its way, not missed — and
       the order must be the rule's own purchase. A rule never authorizes
       anything; the check only keeps one reminder from buying twice or buying
       something else, and it costs no quote. */
    if (origin?.rule) {
      const proof = carrier.carrier === "bearer" ? carrier : await requireWalletProof(request, "mutation");
      if (!proof.ok) return refuse(401, "UNAUTHORIZED", "Buying by a rule needs the proven wallet: confirm the wallet first.");
      if (proof.address !== input.taker) return refuse(403, "WALLET_MISMATCH", "The proven wallet is not the taker of this order.");
      const ruleRecord = await readRule(store, input.taker, origin.rule.ruleId);
      const ruleRows = ruleRecord ? await ledgerOf(store, input.taker) : [];
      /* 1.13.0: the month's budget, from the same History — two reminders open at once cannot spend past the person's ceiling. */
      const budget = ruleRecord ? await readBudgetRecord(store, input.taker) : null;
      const remaining = budget ? remainingFor(budget, await listRuleRecords(store, input.taker), ruleRows, Date.now()) : null;
      /* 1.18.0: a rule with a price condition is judged on the server's own row of its company, read now — a row nobody could read never passes. */
      const conditionFacts = ruleRecord?.priceCondition ? await ruleConditionFacts(ruleRecord.asset.mint) : null;
      const judged = judgeRuleOrder(ruleRecord, origin.rule, input, ruleRows, Date.now(), remaining, conditionFacts);
      if (!judged.ok) return refuse(judged.status, judged.code, judged.message);
    }
    return NEXT;
  },
};

/**
 * The venue, keyed for production only. The execution surface has no
 * labelled keyless lane: a swap that will be signed must come from the keyed
 * swap contract.
 */
const venueEndpoint: PipelineStep<SwapPrepareContext, SwapRefusal> = {
  stage: "quote",
  name: "venue-endpoint",
  run(context) {
    const selection = resolveJupiterSwapEndpoint({ access: "production" });
    if (!selection.ok) return refuse(503, "PROVIDER_KEY_MISSING", selection.reason);
    context.endpoint = selection;
    const issuerKey = loadIssuerKey();
    if (!issuerKey) {
      return refuse(503, "PROOF_NOT_SIGNED", "This deployment cannot issue the exact execution Review proof; no transaction bytes are released.");
    }
    context.issuerKey = issuerKey;
    return NEXT;
  },
};

/**
 * Both Asset Passports, read live before the order so a refused mint never
 * reaches a quote. Nothing here is fabricated or cached.
 */
const assetPassports: PipelineStep<SwapPrepareContext, SwapRefusal> = {
  stage: "quote",
  name: "asset-passports",
  async run(context) {
    const { input } = context;
    const handle = handleOf(context);
    for (const mint of [input.inputMint, input.outputMint]) {
      const read = await readMintAccount(handle, mint);
      if (!read.ok) {
        return refuse(422, "MINT_UNREADABLE", `The mint ${mint} could not be read live: ${read.reason}`);
      }
      const passport = buildPassport(read.raw);
      if (!passport.ok) {
        return refuse(422, "PASSPORT_REFUSED", `The mint ${mint} passport was refused: ${passport.reason}`);
      }
      context.passports[mint] = passport.passport;
      context.reads[mint] = read;
      context.decimals[mint] = passport.passport.identity.decimals.value;
    }
    return NEXT;
  },
};

/* ----------------------------------------------------------------- build */

/**
 * The quote and the bytes, from the venue in one answer.
 *
 * Under a plan the transaction is built on the plan's own slippage bound: the
 * venue's estimate is replaced by the rule the person wrote, so the Strategy
 * block judges the minimum the chain will enforce, not a number the venue
 * chose. The current version's rule — the one the Review judges; a stale
 * requested version fails its own check later.
 *
 * Refused for rate alone, the order is asked once more after the provider's
 * own pause — the person waiting on this one press («Готуємо «Перевірку»…»)
 * rather than reading «Забагато запитів»: nothing is locked, stored or signed
 * before the provider answers, so the second ask builds at most the one Review
 * the first would have.
 */
const venueOrder: PipelineStep<SwapPrepareContext, SwapRefusal> = {
  stage: "build",
  name: "venue-order",
  async run(context) {
    const { input, planRecord } = context;
    const planSlippageBps = planRecord ? projectTradingPlan(planRecord, Date.now()).current.rules.execution.maxSlippageBps : undefined;
    const config = resolveServiceFeeConfig();
    const referral = (await verifiedJupiterReferral(config)).referral;
    /* Fee policy v2 picks the lane and the fee per flow; the phone stays on `/order` until its client reads 1.24.0. */
    const venue = createJupiterSwapVenue({
      endpoint: need(context.endpoint, "endpoint"),
      referral,
      config,
      lanes: { carrier: context.carrier.carrier, handle: handleOf(context) },
    });
    const account = { kind: "WALLET", network: "solana", address: input.taker } as const;
    const intent: TradeIntent = {
      network: "solana",
      inputAsset: input.inputMint,
      outputAsset: input.outputMint,
      amountRaw: input.amountRaw,
      account,
      ...(planSlippageBps !== undefined ? { slippageBps: planSlippageBps } : {}),
    };
    try {
      const quote = await venue.quote(intent);
      context.unsigned = await venue.build(quote, account);
      context.order = quote.native;
    } catch (cause) {
      if (!(cause instanceof JupiterOrderRefusal)) throw cause;
      const orderResult = cause.failure;
      const status =
        orderResult.code === "NO_ROUTE" || orderResult.code === "BUILD_FAILED"
          ? 409
          : orderResult.code === "RATE_LIMITED"
            ? 429
            : 502;
      return refuse(status, `ORDER_${orderResult.code}`, orderResult.reason, {
        provider: { errorCode: orderResult.errorCode, router: orderResult.router ?? null },
      });
    }
    return NEXT;
  },
};

/* ----------------------------------------------------------------- guard: the plan */

/**
 * The Strategy block: the plan's current version judged on this exact order —
 * the mint, the side, the version, the validity, the money on the sizing's
 * own model at this price, the reference, the slippage, the quote's age, the
 * liquidity, the units. A required check that fails or is unknown blocks: no
 * bytes leave, the block is the answer. A Review that may be signed is
 * written on the plan first, so the plan holds what stood before the
 * signature.
 */
const planReviewStep: PipelineStep<SwapPrepareContext, SwapRefusal> = {
  stage: "guard",
  name: "plan-review",
  async run(context) {
    const { input, origin, planRecord } = context;
    const store = need(context.store, "store");
    const order = need(context.order, "order");
    let planReview: PlanReview | null = null;
    let bundleOrigin: SolanaActionOrigin | undefined;
    if (origin?.plan && planRecord) {
      const nowMs = Date.now();
      const projected = projectTradingPlan(planRecord, nowMs);
      /* A stock plan is judged with its row (the reference, the session, the
         multiplier); a token plan (1.7.0) with the catalogue's own liquidity —
         the one figure the Review needs that the order does not carry. */
      const tokenPlan = isTokenPlanAsset(projected.asset);
      const stockRow = tokenPlan ? null : await findStockRow(input.outputMint).catch(() => null);
      const catalogue = tokenPlan ? await readSpotMarket(projected.asset.mint).catch(() => null) : null;
      /* The person's own rules on observations (1.5.0): one governed read per
         window the version's conditions name, made now — a required condition
         is judged on what the source says at the Review, never on a figure the
         card showed earlier. A version without conditions reads nothing. */
      const evidence: EvidenceReadByWindow[] = await Promise.all(
        readsOf(projected.current.rules.evidenceConditions).map(async ({ provider, window }) => ({ provider, window, read: await readMarketEvidence({ mint: projected.asset.mint, window, provider, nowMs }) })),
      );
      planReview = evaluatePlanReview({
        plan: projected,
        evidence,
        requestedVersion: origin.plan.version,
        order: {
          inputMint: order.inputMint,
          outputMint: order.outputMint,
          inAmountRaw: order.inAmountRaw,
          outAmountRaw: order.outAmountRaw,
          slippageBps: order.slippageBps,
          priceImpactPct: order.priceImpactPct,
          totalFeeBasisPoints: order.totalFeeBasisPoints,
          observedAt: order.observedAt,
          reviewExpiresAt: order.reviewExpiresAt,
          requestId: order.requestId,
        },
        row: stockRow?.ok ? stockRow.row : null,
        market: catalogue?.ok && catalogue.market ? { liquidityUsd: catalogue.market.liquidityUsd } : null,
        usdcMint: SOLANA_MAINNET_USDC_MINT,
        nowMs,
      });
      if (planReview.verdict === "blocked") {
        /* The refusal is written down before the refusal is answered: a plan
           whose maximum price was never met must be able to say so later, and
           only a recorded Review can say it without inventing the reason.
           Non-fatal on purpose — a store that did not answer must never turn a
           refusal into an offer to sign, so the result is not read and the 409
           goes out either way. */
        await recordPlanReview(store, { owner: input.taker, review: planReview }).catch(() => null);
        return refuse(409, "PLAN_REVIEW_BLOCKED", "The plan's version refuses this order; the Strategy block names each check.", { planReview });
      }
      const recorded = await recordPlanReview(store, { owner: input.taker, review: planReview });
      if (!recorded.ok) {
        const status = recorded.code === "UNAVAILABLE" ? 503 : recorded.code === "PLAN_NOT_FOUND" ? 404 : 409;
        return refuse(status, recorded.code, recorded.message, { planReview });
      }
      bundleOrigin = { surface: origin.surface, side: origin.side, plan: { planId: origin.plan.planId, version: origin.plan.version, reviewId: order.requestId } };
    } else if (origin) {
      bundleOrigin = { surface: origin.surface, side: origin.side };
    }
    /* The rule's reminder travels as the order named it; History reads the purchase back by it. */
    if (bundleOrigin && origin?.rule) bundleOrigin = { ...bundleOrigin, rule: { ruleId: origin.rule.ruleId, dueAt: origin.rule.dueAt } };
    context.planReview = planReview;
    context.bundleOrigin = bundleOrigin;
    return NEXT;
  },
};

const [transactionCheck, effectFirewall, reviewPolicy, reviewProof, ownerLockReserve] = SOLANA_SWAP_REVIEW_GUARD;

/**
 * The swap's prepare half. The guard steps are the shared safety chain; the
 * order of every step is the order the route ran them in.
 */
export const SOLANA_SWAP_PREPARE = definePipeline<SwapPrepareContext, SwapRefusal>({
  line: "solana-swap",
  part: "prepare",
  steps: [
    intentTerms,
    ownerLockFreeStep,
    venueEndpoint,
    assetPassports,
    venueOrder,
    transactionCheck,
    effectFirewall,
    reviewPolicy,
    planReviewStep,
    reviewProof,
    ownerLockReserve,
  ],
});

/** A fresh context for one admitted request. */
export function swapPrepareContext(request: SwapPrepareRequest): SwapPrepareContext {
  return {
    ...request,
    planRecord: null,
    store: null,
    handle: null,
    endpoint: null,
    issuerKey: null,
    passports: {},
    reads: {},
    decimals: {},
    order: null,
    unsigned: null,
    inspection: null,
    simulation: null as z.output<typeof SwapExecutionSimulationSchema> | null,
    outputAssetVerdict: null,
    intent: null,
    verdict: null,
    planReview: null,
    bundleOrigin: undefined,
    review: null,
    bundle: null,
    proof: null,
    preSign: null,
  };
}

/** Runs the prepare half; the context holds everything the Review answer needs. */
export function prepareSolanaSwap(context: SwapPrepareContext): Promise<PipelineRun<SwapRefusal>> {
  return runPipeline(SOLANA_SWAP_PREPARE, context);
}
