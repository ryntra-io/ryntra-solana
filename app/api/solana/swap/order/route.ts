import { z } from "zod";

import {
  SPL_TRANSFER_ACTION_REF,
  type SplTransferInput,
} from "@/lib/agent-control/adapters/solana-token-2022";
import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { resolveSolanaLaneState } from "@/lib/solana/lane-state";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { SolanaOwnerPolicySchema } from "@/lib/solana/contracts";
import { readMintAccount, type MintReadSuccess } from "@/lib/solana/mint";
import { buildPassport } from "@/lib/solana/passport";
import { evaluateOwnerPolicy } from "@/lib/solana/policy";
import { buildTransferPreflight } from "@/lib/solana/preflight";
import { askOnceMoreAfterRate } from "@/lib/solana/jupiter-ask-again";
import { JUPITER_ORDER_RETRY_WAIT_MAX_MS } from "@/lib/solana/jupiter-budget";
import {
  fetchJupiterExecutableOrder,
  resolveJupiterSwapEndpoint,
  type JupiterExecutableOrder,
  type JupiterOrderQuote,
} from "@/lib/solana/quotes";
import { verifiedJupiterReferral } from "@/lib/solana/referral-account.server";
import { readRentParameters, simulatedAccountStates } from "@/lib/solana/rent";
import { resolveServiceFeeConfig } from "@/lib/swap/service-fee.server";
import { createIndependentReadHandle, createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { serverSendPolicy } from "@/lib/solana/send-safety";
import { assessSwapClientReview } from "@/lib/solana/swap-client-safety";
import { assessSwapSimulationEffects } from "@/lib/solana/swap-effect-firewall";
import { buildSwapPolicyIntent, evaluateSwapPolicy } from "@/lib/solana/swap-policy";
import {
  expireUnclaimedSwapOwnerReview,
  isSwapOwnerLockSettled,
  readSwapOwnerLock,
  reserveSwapOwnerReview,
  type SwapOwnerLockRecord,
} from "@/lib/solana/swap-owner-lock";
import {
  createSwapExecutionProof,
  inspectionForBundle,
  SwapExecutionBundleSchema,
  SwapExecutionSimulationSchema,
  type SwapExecutionBundle,
} from "@/lib/solana/swap-execution-review";
import { buildSwapQuoteReview } from "@/lib/solana/swap-review";
import { inspectJupiterSwapTransaction } from "@/lib/solana/swap-transaction-check";
import type { SolanaAssetPassport } from "@/lib/solana/types";
import { readSwapCarrier, walletMismatch } from "@/lib/solana/swap-carrier.server";
import { SolanaActionOriginRequestSchema, type SolanaActionOrigin } from "@/lib/solana/action-origin";
import { requireWalletProof } from "@/lib/api/v1/proof";
import { isTokenPlanAsset, type PlanReview } from "@/lib/api/v1/contract";
import { readsOf } from "@/lib/evidence/conditions";
import { readMarketEvidence } from "@/lib/evidence/service.server";
import { evaluatePlanReview, type EvidenceReadByWindow } from "@/lib/plans/review";
import { recordPlanReview } from "@/lib/plans/service";
import { projectTradingPlan, readTradingPlan, type TradingPlanRecord } from "@/lib/plans/store";
import { judgeRuleOrder } from "@/lib/autoinvest/model";
import { conditionFactsOf as ruleConditionFacts, ledgerOf, remainingFor } from "@/lib/autoinvest/service";
import { listRuleRecords, readBudgetRecord, readRule } from "@/lib/autoinvest/store";
import { SOLANA_MAINNET_USDC_MINT } from "@/lib/solana/send-kinds";
import { eventStateAt } from "@/lib/stocks/instrument";
import { lifecycleEventFor } from "@/lib/stocks/lifecycle-events";
import { isRetiredMint, RETIRED_REASON } from "@/lib/stocks/retired";
import { readSpotMarket } from "@/lib/spot/markets.server";
import { awaitCheckContext, readCheckContext, swapCheckOf } from "@/lib/stocks/check.server";
import { findStockRow } from "@/lib/stocks/universe.server";

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

/**
 * A Solana blockhash is valid for at most 151 slots. Well past that, bytes
 * issued under it cannot land no matter who holds them — the fallback that
 * keeps an unclaimed Review from becoming a permanent dead end when no
 * independent operator is configured to say so directly.
 */
const BLOCKHASH_CERTAINLY_DEAD_MS = 300_000;

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

/* The review policy asks what receiving the output would subject ANY holder
   to, so it takes two stand-ins rather than inventing a counterparty — the
   same pair the read-only quote route uses. */
const ANY_HOLDER = "11111111111111111111111111111111";
const ANY_RECIPIENT = "SysvarRent111111111111111111111111111111111";

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

function quoteView(order: JupiterExecutableOrder): JupiterOrderQuote {
  const {
    schema: _schema,
    execution: _execution,
    taker: _taker,
    transactionBase64: _bytes,
    lastValidBlockHeight: _lastValidBlockHeight,
    ...shared
  } = order;
  return {
    ...shared,
    schema: "ryntra.solana.jupiter-order-quote",
    execution: "NOT_EXECUTED",
    taker: null,
    transactionBase64: null,
  };
}

/**
 * Whether an unclaimed issued Review can be recycled.
 *
 * A `REVIEW_ISSUED` lock with no signature holds bytes nobody has approved.
 * Once its window has closed AND its blockhash is dead, those bytes cannot
 * land and holding the lock open only stops the owner from asking again —
 * which is what turned one swap per wallet into one swap ever. The proof is
 * an independent operator saying the blockhash is invalid; the fallback is
 * the blockhash's own 151-slot ceiling, well exceeded. `SIGNED` and
 * `SUBMITTED_UNKNOWN` are never recycled: a signature exists in the world and
 * recovery by that signature is the only correct answer.
 */
async function unclaimedReviewIsDead(record: SwapOwnerLockRecord): Promise<boolean> {
  if (record.state !== "REVIEW_ISSUED" || record.signature !== null) return false;
  const closedFor = Date.now() - Date.parse(record.reviewExpiresAt);
  if (!Number.isFinite(closedFor) || closedFor <= 0) return false;

  const bundle = SwapExecutionBundleSchema.safeParse(record.bundle);
  if (!bundle.success) return true;
  const independent = createIndependentReadHandle(createSolanaRpcHandle({ network: "mainnet" }));
  if (independent) {
    try {
      const valid = Boolean(
        (
          await withRpcDiscipline(independent, (abortSignal) =>
            independent.rpc
              .isBlockhashValid(bundle.data.inspection.blockhash as never, { commitment: "confirmed" })
              .send({ abortSignal }),
          )
        ).value,
      );
      return !valid;
    } catch {
      /* Fall through to the ceiling below rather than claiming knowledge. */
    }
  }
  return closedFor > BLOCKHASH_CERTAINLY_DEAD_MS;
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
  /* «Перевірка» (1.20.0): the company's row and SOL's price, read beside the order's build so they cost no time of their own. Never throws. */
  const checkContext = readCheckContext(input.inputMint, input.outputMint);
  const store = getGuardRuntime().store;
  /* The plan, for the proven wallet only. A plan id in a request proves
     nothing — the wallet that proved itself (the web's proof cookie or the
     native bearer) must be the taker, and the plan must be that wallet's.
     Read before the durability gate and any provider call, so a plan that is
     not there costs no quote and a stand without the durable lock still
     proves the refusals; judged after the order is built, on the order. */
  let planRecord: TradingPlanRecord | null = null;
  if (origin?.plan) {
    /* The bearer already proved the wallet above; the web proves it with the cookie here. */
    const proof = carrier.carrier === "bearer" ? carrier : await requireWalletProof(request, "mutation");
    if (!proof.ok) return failure(401, "UNAUTHORIZED", "Trading under a plan needs the proven wallet: confirm the wallet first.", rate);
    if (proof.address !== input.taker) return failure(403, "WALLET_MISMATCH", "The proven wallet is not the taker of this order.", rate);
    planRecord = await readTradingPlan(store, input.taker, origin.plan.planId);
    if (!planRecord) return failure(404, "PLAN_NOT_FOUND", "No such plan for this wallet.", rate);
  }
  /* An autoinvest reminder (1.12.0), for the proven wallet only, on the same
     terms as the plan: the rule must be the taker's and on, the reminder the
     order names must be open — not bought, not on its way, not missed — and
     the order must be the rule's own purchase. A rule never authorizes
     anything; the check only keeps one reminder from buying twice or buying
     something else, and it costs no quote. */
  if (origin?.rule) {
    const proof = carrier.carrier === "bearer" ? carrier : await requireWalletProof(request, "mutation");
    if (!proof.ok) return failure(401, "UNAUTHORIZED", "Buying by a rule needs the proven wallet: confirm the wallet first.", rate);
    if (proof.address !== input.taker) return failure(403, "WALLET_MISMATCH", "The proven wallet is not the taker of this order.", rate);
    const ruleRecord = await readRule(store, input.taker, origin.rule.ruleId);
    const ruleRows = ruleRecord ? await ledgerOf(store, input.taker) : [];
    /* 1.13.0: the month's budget, from the same History — two reminders open at once cannot spend past the person's ceiling. */
    const budget = ruleRecord ? await readBudgetRecord(store, input.taker) : null;
    const remaining = budget ? remainingFor(budget, await listRuleRecords(store, input.taker), ruleRows, Date.now()) : null;
    /* 1.18.0: a rule with a price condition is judged on the server's own row of its company, read now — a row nobody could read never passes. */
    const conditionFacts = ruleRecord?.priceCondition ? await ruleConditionFacts(ruleRecord.asset.mint) : null;
    const judged = judgeRuleOrder(ruleRecord, origin.rule, input, ruleRows, Date.now(), remaining, conditionFacts);
    if (!judged.ok) return failure(judged.status, judged.code, judged.message, rate);
  }
  if (store.durability !== "DURABLE_MULTI_WRITER") {
    return failure(503, "STORE_NOT_DURABLE", "A signable swap Review requires the durable multi-writer owner lock.", rate);
  }
  const handle = createSolanaRpcHandle({ network: "mainnet" });
  const existingOwnerLock = await readSwapOwnerLock({ store, owner: input.taker });
  if (existingOwnerLock.ok) {
    const record = existingOwnerLock.record;
    /* A settled swap is history, not a lock. Only an outstanding signature
       holds this wallet, and only until it is recovered. */
    const settled = isSwapOwnerLockSettled(record.state);
    if (!settled) {
      if (await unclaimedReviewIsDead(record)) {
        const expired = await expireUnclaimedSwapOwnerReview({
          store,
          owner: input.taker,
          requestId: record.requestId,
          at: new Date().toISOString(),
        });
        if (!expired.ok) {
          return failure(409, expired.code, expired.reason, rate, {
            ownerLock: { state: record.state, requestId: record.requestId, signature: record.signature },
          });
        }
      } else {
        return failure(409, "OWNER_SWAP_LOCKED", "This wallet already has an open swap Review or an unresolved signed attempt.", rate, {
          ownerLock: {
            state: record.state,
            requestId: record.requestId,
            signature: record.signature,
          },
        });
      }
    }
  } else if (existingOwnerLock.code === "OWNER_SWAP_LOCK_UNAVAILABLE") {
    return failure(503, existingOwnerLock.code, existingOwnerLock.reason, rate);
  }

  /* Production key only. The execution surface has no labelled keyless lane:
     a swap that will be signed must come from the keyed swap contract. */
  const selection = resolveJupiterSwapEndpoint({ access: "production" });
  if (!selection.ok) {
    return failure(503, "PROVIDER_KEY_MISSING", selection.reason, rate);
  }
  const issuerKey = loadIssuerKey();
  if (!issuerKey) {
    return failure(
      503,
      "PROOF_NOT_SIGNED",
      "This deployment cannot issue the exact execution Review proof; no transaction bytes are released.",
      rate,
    );
  }

  /* Both Asset Passports, read live before the order so a refused mint never
     reaches a quote. Nothing here is fabricated or cached. */
  const passports: Record<string, SolanaAssetPassport> = {};
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
    passports[mint] = passport.passport;
    reads[mint] = read;
    decimals[mint] = passport.passport.identity.decimals.value;
  }

  /* Under a plan the transaction is built on the plan's own slippage bound:
     the venue's estimate is replaced by the rule the person wrote, so the
     Strategy block judges the minimum the chain will enforce, not a number
     the venue chose. The current version's rule — the one the Review
     judges; a stale requested version fails its own check below. */
  const planSlippageBps = planRecord ? projectTradingPlan(planRecord, Date.now()).current.rules.execution.maxSlippageBps : undefined;
  const referral = (await verifiedJupiterReferral(resolveServiceFeeConfig())).referral;
  /* Refused for rate alone, the order is asked once more after the provider's
     own pause — up to the window's ten seconds, the person waiting on this one
     press («Готуємо «Перевірку»…») rather than reading «Забагато запитів»
     (`askOnceMoreAfterRate`, `JUPITER_ORDER_RETRY_WAIT_MAX_MS`): nothing is
     locked, stored or signed before the provider answers, so the second ask
     builds at most the one Review the first would have. */
  const orderResult = await askOnceMoreAfterRate(
    () =>
      fetchJupiterExecutableOrder(
        {
          inputMint: input.inputMint,
          outputMint: input.outputMint,
          amountRaw: input.amountRaw,
          taker: input.taker,
          referral,
          ...(planSlippageBps !== undefined ? { slippageBps: planSlippageBps } : {}),
        },
        selection,
      ),
    { maxWaitMs: JUPITER_ORDER_RETRY_WAIT_MAX_MS },
  );
  if (!orderResult.ok) {
    const status =
      orderResult.code === "NO_ROUTE" || orderResult.code === "BUILD_FAILED"
        ? 409
        : orderResult.code === "RATE_LIMITED"
          ? 429
          : 502;
    return failure(status, `ORDER_${orderResult.code}`, orderResult.reason, rate, {
      provider: { errorCode: orderResult.errorCode, router: orderResult.router ?? null },
    });
  }
  let order = orderResult.order;

  const inspection = await inspectJupiterSwapTransaction({
    wireBase64: order.transactionBase64,
    expectedTaker: input.taker,
  });
  if (!inspection.ok) {
    return failure(409, `TRANSACTION_${inspection.code}`, inspection.reason, rate);
  }

  /* Simulate the exact provider bytes before anything reaches a wallet. The
     simulation is also asked for the post-execution state of every static
     account, and the live Rent parameters are read beside it, so an account
     the transaction opens for the taker is proved to hold exactly the
     network's rent-exempt minimum for its size — the venue's `rentFeeLamports`
     is an estimate for a plain 165-byte account and is short of every
     Token-2022 account with extensions, which is every tokenized stock. */
  const rent = await readRentParameters(handle).catch(() => null);
  /* Every static account but the programs themselves: an account the
     transaction opens for the taker is always static, and a program's
     bytecode is the one large answer nothing here needs. */
  const stateAddresses: readonly string[] = inspection.staticAccounts.filter((account) => !inspection.programs.includes(account));
  let simulation: z.output<typeof SwapExecutionSimulationSchema>;
  try {
    const response = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .simulateTransaction(order.transactionBase64 as never, {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          innerInstructions: true,
          commitment: "confirmed",
          accounts: { encoding: "base64", addresses: stateAddresses as readonly never[] },
        })
        .send({ abortSignal }),
    );
    const err = response.value.err === null || response.value.err === undefined
      ? null
      : JSON.stringify(response.value.err, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry)).slice(0, 512);
    const ownerEffects =
      err === null
        ? assessSwapSimulationEffects({
            order,
            staticAccountCount: inspection.staticAccountCount,
            staticAccounts: inspection.staticAccounts,
            topLevelPrograms: inspection.programs,
            nativeWrapRoundTrip: inspection.nativeWrapRoundTrip,
            nativeWrapCandidate: inspection.nativeWrapCandidate,
            tokenProgramIndices: inspection.tokenProgramIndices,
            simulation: response.value,
            accountStates: simulatedAccountStates(stateAddresses, response.value.accounts),
            rent,
          })
        : null;
    if (ownerEffects && !ownerEffects.ok) {
      return failure(
        409,
        `SIMULATION_EFFECT_${ownerEffects.code}`,
        `${ownerEffects.reason} Ask for a fresh order; do not sign.`,
        rate,
      );
    }
    /* The Review states the rent the chain proved, not the venue's estimate:
       what stays in the accounts opened for the taker, to the lamport, and
       nothing when the only account opened is closed again in the same
       transaction. The bytes are unchanged; only the disclosed figure is. */
    if (ownerEffects?.ok && ownerEffects.proof.durableRentLamports !== undefined && ownerEffects.proof.rentProof !== "REVIEWED_CEILING") {
      const provenRent = ownerEffects.proof.durableRentLamports;
      if (provenRent !== order.rentFeeLamports) {
        order = { ...order, rentFeeLamports: provenRent, rentFeePayer: BigInt(provenRent) > 0n ? order.taker : order.rentFeePayer };
      }
    }
    simulation = SwapExecutionSimulationSchema.parse({
      status: err === null ? "OK" : "FAILED",
      unitsConsumed:
        response.value.unitsConsumed === null || response.value.unitsConsumed === undefined
          ? null
          : String(response.value.unitsConsumed),
      error: err,
      sourceHost: handle.host(),
      observedAt: new Date().toISOString(),
      ownerEffects: ownerEffects?.ok ? ownerEffects.proof : null,
    });
  } catch (cause) {
    return failure(503, "SIMULATION_UNAVAILABLE", `The exact provider bytes could not be simulated: ${cause instanceof Error ? cause.message : String(cause)}`, rate);
  }
  if (simulation.status !== "OK") {
    return failure(409, "SIMULATION_FAILED", `Simulation of the exact provider bytes failed: ${simulation.error ?? "unknown"}. Ask for a fresh order; do not sign.`, rate, { simulation });
  }

  /* The same thirteen-rule review the card already renders, judged over what
     receiving the output would subject any holder to. It is the one rule in
     the swap policy that can BLOCK on the asset rather than on the bytes. */
  const ownerPolicy = SolanaOwnerPolicySchema.parse(serverSendPolicy("mainnet"));
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
    passport: passports[input.outputMint],
    input: transferInput,
  });
  const outputAssetVerdict = preflight.ok
    ? evaluateOwnerPolicy({
        policy: ownerPolicy,
        input: transferInput,
        passport: passports[input.outputMint],
        preflight: preflight.preflight,
      })
    : null;

  let intent;
  try {
    intent = buildSwapPolicyIntent({
      order,
      /* The programs are the ones the simulation resolved — top level and
         CPI — never the ones provider prose names. */
      programs: simulation.ownerEffects?.programs ?? inspection.programs,
    });
  } catch (cause) {
    return failure(409, "INTENT_REFUSED", cause instanceof Error ? cause.message : String(cause), rate);
  }
  const verdict = evaluateSwapPolicy({
    intent,
    evidence: {
      inspection: {
        feePayer: inspection.feePayer,
        programs: inspection.programs,
        instructionCount: inspection.instructionCount,
      },
      simulationStatus: simulation.status,
      ownerEffects: simulation.ownerEffects
        ? {
            status: simulation.ownerEffects.status,
            taker: simulation.ownerEffects.taker,
            inputMint: simulation.ownerEffects.inputMint,
            outputMint: simulation.ownerEffects.outputMint,
            inputAmountRaw: simulation.ownerEffects.inputAmountRaw,
            outputAmountRaw: simulation.ownerEffects.outputAmountRaw,
            minimumOutputRaw: simulation.ownerEffects.minimumOutputRaw,
          }
        : null,
      outputAssetVerdict: outputAssetVerdict ? { verdict: outputAssetVerdict.verdict } : null,
      gasless: order.gasless,
    },
  });

  /* The Strategy block: the plan's current version judged on this exact
     order — the mint, the side, the version, the validity, the money on the
     sizing's own model at this price, the reference, the slippage, the
     quote's age, the liquidity, the units. A required check that fails or is
     unknown blocks: no bytes leave this route, the block is the answer. A
     Review that may be signed is written on the plan first, so the plan holds
     what stood before the signature. */
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
      return failure(409, "PLAN_REVIEW_BLOCKED", "The plan's version refuses this order; the Strategy block names each check.", rate, { planReview });
    }
    const recorded = await recordPlanReview(store, { owner: input.taker, review: planReview });
    if (!recorded.ok) {
      const status = recorded.code === "UNAVAILABLE" ? 503 : recorded.code === "PLAN_NOT_FOUND" ? 404 : 409;
      return failure(status, recorded.code, recorded.message, rate, { planReview });
    }
    bundleOrigin = { surface: origin.surface, side: origin.side, plan: { planId: origin.plan.planId, version: origin.plan.version, reviewId: order.requestId } };
  } else if (origin) {
    bundleOrigin = { surface: origin.surface, side: origin.side };
  }
  /* The rule's reminder travels as the order named it; History reads the purchase back by it. */
  if (bundleOrigin && origin?.rule) bundleOrigin = { ...bundleOrigin, rule: { ruleId: origin.rule.ruleId, dueAt: origin.rule.dueAt } };

  const review = buildSwapQuoteReview(quoteView(order));
  const bundle: SwapExecutionBundle = {
    review,
    taker: order.taker,
    lastValidBlockHeight: order.lastValidBlockHeight,
    inspection: inspectionForBundle(inspection),
    simulation,
    policyIntent: intent,
    policyVerdict: verdict,
    ...(bundleOrigin ? { origin: bundleOrigin } : {}),
    ...(planReview ? { planReview } : {}),
  };
  const proof = createSwapExecutionProof({ bundle, key: issuerKey });
  const preSign = assessSwapClientReview({
    verdict,
    proofStatus: proof.status,
    simulationStatus: simulation.status,
    ownerEffectsStatus: simulation.ownerEffects?.status ?? "MISSING",
    expiresAt: order.reviewExpiresAt,
  });
  if (!preSign.ready) {
    return failure(
      409,
      "SWAP_PRE_SIGN_REFUSED",
      `${preSign.code}: ${preSign.reason}`,
      rate,
      { policy: { verdict }, preSign },
    );
  }
  const ownerLock = await reserveSwapOwnerReview({
    store,
    owner: input.taker,
    requestId: order.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    reviewExpiresAt: order.reviewExpiresAt,
    bundle,
    proof,
    at: new Date().toISOString(),
  });
  if (!ownerLock.ok) {
    const status = ownerLock.code === "OWNER_SWAP_LOCK_UNAVAILABLE" ? 503 : 409;
    return failure(status, ownerLock.code, ownerLock.reason, rate, {
      ownerLock: ownerLock.record
        ? {
            state: ownerLock.record.state,
            requestId: ownerLock.record.requestId,
            signature: ownerLock.record.signature,
          }
        : null,
    });
  }

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
      inspection: bundle.inspection,
      simulation,
      passports,
      decimals,
      assetReview: outputAssetVerdict,
      policy: { intent, verdict },
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
