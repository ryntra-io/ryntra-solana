import { getTransactionDecoder } from "@solana/kit";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { deploymentSendCapability } from "@/lib/solana/send-deployment";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { readSolanaCanaryBudget } from "@/lib/solana/canary-ledger";
import { reportCanaryRuntime, resolveCanaryRuntime } from "@/lib/solana/canary-runtime";
import {
  evaluateSolanaCanaryIntent,
  verifySolanaCanaryVerdictBinding,
} from "@/lib/solana/canary-policy";
import {
  buildSendCanaryIntent,
  resolveSendCanaryHumanApproval,
} from "@/lib/solana/canary-send";
import { buildSendCanaryValuation } from "@/lib/solana/canary-valuation";
import { fetchTokenCatalog, nativeSolPriceMint } from "@/lib/solana/catalog";
import { createSendReviewProof, verifySendReviewProof } from "@/lib/solana/review-proof";
import { expectedEffectsFor } from "@/lib/solana/outcome";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import {
  canSubmitSendAction,
  evaluateSendSafety,
  resolveSendState,
} from "@/lib/solana/send-safety";
import { assessSendReadiness } from "@/lib/solana/send-readiness";
import { buildSendCheck } from "@/lib/solana/send-check";
import { SettlementRequestSchema } from "@/lib/solana/settlement";
import { verifySignatureOnly } from "@/lib/solana/signature";
import { readBaseFeeLamports } from "@/lib/solana/transaction";
import { adoptWalletTransactionPlan } from "@/lib/solana/wallet-adoption";
import { compareWalletTransaction } from "@/lib/solana/wallet-modification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Adopt one Wallet Standard modification without submitting it.
 *
 * Phantom is a transaction-modifying signer: for this exact M1B transfer it
 * adds a bounded ComputeBudget pair and two post-transfer Lighthouse
 * assertions. This route verifies the original signed Review proof, verifies
 * the actual Ed25519 signature, accepts only that narrow semantic delta,
 * reprices and resimulates the exact returned message, and signs a new Review
 * bundle. Only that new exact bundle may enter the existing settle route.
 */

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json(
    { error: { code, message } },
    { status, headers: responseHeaders(rate) },
  );
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);

  const shaped = SettlementRequestSchema.safeParse(body.value);
  if (!shaped.success) {
    const detail = shaped.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(" · ");
    return failure(400, "VALIDATION_ERROR", detail, rate);
  }
  const value = shaped.data;
  /* Re-derived from the reviewed plan rather than trusted from the request. */
  const adoptSafety = evaluateSendSafety({
    network: value.plan.network,
    state: resolveSendState(),
    support: value.plan.support,
    simulation: value.preflight.simulation,
    baseFeeLamports: value.plan.baseFeeLamports,
    ataRentLamports: value.plan.ataRentLamports,
    createsRecipientAccount: value.plan.createsRecipientAccount,
    programs: value.plan.programs,
    reviewProof: { status: "SIGNED" },
    requireReviewProof: false,
    ...deploymentSendCapability(value.plan.network),
  });
  if (!canSubmitSendAction({ network: value.plan.network, safety: adoptSafety })) {
    return failure(
      403,
      "SEND_NOT_PERMITTED",
      adoptSafety.findings.find((finding) => finding.outcome !== "PASS")?.detail ??
        "This transfer is not permitted to reach a wallet.",
      rate,
    );
  }

  const issuerKey = loadIssuerKey();
  if (!issuerKey) {
    return failure(
      503,
      "REVIEW_PROOF_UNAVAILABLE",
      "This deployment has no document-signing key for an exact wallet-adjusted Review.",
      rate,
    );
  }
  const originalProof = verifySendReviewProof({
    bundle: {
      plan: value.plan,
      preflight: value.preflight,
      verdict: value.verdict,
      provider: value.provider,
      canaryIntent: value.canaryIntent,
      canaryVerdict: value.canaryVerdict,
    },
    proof: value.reviewProof,
    trustedPublicKey: issuerKey.publicKey,
  });
  if (!originalProof.ok) {
    return failure(409, "REVIEW_PROOF_INVALID", originalProof.reason, rate);
  }
  const canaryBinding = verifySolanaCanaryVerdictBinding({
    intent: value.canaryIntent,
    verdict: value.canaryVerdict,
  });
  if (!canaryBinding.ok) {
    return failure(409, "REVIEW_PROOF_INVALID", canaryBinding.reason, rate);
  }
  const originalEffects = expectedEffectsFor({ plan: value.plan, preflight: value.preflight });
  const originalNetworkFee = (
    BigInt(value.plan.baseFeeLamports) + BigInt(value.plan.priorityFeeLamports)
  ).toString();
  if (
    !originalEffects.ok ||
    value.preflight.sender !== value.plan.sender ||
    value.preflight.recipient !== value.plan.recipient ||
    value.preflight.networkFeeLamports !== originalNetworkFee
  ) {
    return failure(
      409,
      "ORIGINAL_REVIEW_DISAGREES",
      originalEffects.ok
        ? "The signed Review's sender, recipient or total network fee disagrees with its plan."
        : originalEffects.reason,
      rate,
    );
  }
  /* The reviewed transaction's own readiness, judged by what it is rather than
     by the owner canary. Passing `canaryVerdict` here was the last place the
     M1B envelope still closed an ordinary Send: the wallet signed, the bytes
     checked clean, and adoption then refused with "Owner-canary policy
     returned BLOCK" — a policy about a different transaction. */
  const originalReadiness = assessSendReadiness({
    plan: value.plan,
    preflight: value.preflight,
    verdict: value.verdict,
    support: value.plan.support,
    reviewProof: value.reviewProof,
    requireReviewProof: true,
  });
  if (!originalReadiness.ready) {
    return failure(409, "ORIGINAL_REVIEW_NOT_READY", originalReadiness.reason, rate);
  }

  const comparison = compareWalletTransaction({
    expectedWireBase64: value.plan.unsignedWireBase64,
    actualWireBase64: value.signedWireBase64,
    expectsTokenGuard: value.plan.actionKind !== "NATIVE_SOL",
  });
  if (comparison.verdict !== "WALLET_GUARDS_ONLY") {
    return failure(409, "WALLET_MODIFICATION_REJECTED", comparison.detail, rate);
  }
  const signature = verifySignatureOnly({
    signedWireBase64: value.signedWireBase64,
    expectedSigner: value.plan.sender,
  });
  if (signature.verdict !== "CLEARED") {
    return failure(409, "WALLET_SIGNATURE_REJECTED", signature.detail, rate);
  }

  const configured = createSolanaRpcHandle({ network: value.plan.network });
  const reviewedEndpoint = configured.endpoints.find(
    (endpoint) =>
      endpoint.role === value.provider.role && endpoint.host === value.provider.host,
  );
  if (!reviewedEndpoint) {
    return failure(
      409,
      "REVIEW_PROVIDER_CHANGED",
      "The Solana provider configuration changed after Review. Build a fresh message.",
      rate,
    );
  }
  const handle = createSolanaRpcHandle({
    network: value.plan.network,
    endpoint: reviewedEndpoint.url,
    fallbackEndpoint: null,
    timeoutMs: configured.timeoutMs,
    retries: configured.retries,
    maxResponseBytes: configured.maxResponseBytes,
  });

  let messageBytes: Uint8Array;
  try {
    const decoded = getTransactionDecoder().decode(
      Buffer.from(value.signedWireBase64, "base64"),
    );
    messageBytes = decoded.messageBytes as unknown as Uint8Array;
  } catch (cause) {
    return failure(
      400,
      "WALLET_TRANSACTION_UNREADABLE",
      cause instanceof Error ? cause.message : String(cause),
      rate,
    );
  }

  const fee = await readBaseFeeLamports(handle, messageBytes);
  if (!fee.ok) {
    return failure(
      409,
      "WALLET_TRANSACTION_EXPIRED",
      "The wallet-adjusted blockhash expired before it could be repriced. Preview and sign again without waiting.",
      rate,
    );
  }
  const adopted = await adoptWalletTransactionPlan({
    plan: value.plan,
    signedWireBase64: value.signedWireBase64,
    totalFeeLamports: fee.lamports,
  });
  if (!adopted.ok) return failure(409, adopted.code, adopted.reason, rate);

  let simulation: {
    status: "PRESENT";
    succeeded: boolean;
    error: string | null;
    unitsConsumed: string | null;
  };
  try {
    const simulated = await withRpcDiscipline(handle, (abortSignal) =>
      handle.rpc
        .simulateTransaction(value.signedWireBase64 as never, {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: false,
          commitment: "confirmed",
        })
        .send({ abortSignal }),
    );
    simulation = {
      status: "PRESENT",
      succeeded: simulated.value.err === null || simulated.value.err === undefined,
      error:
        simulated.value.err === null || simulated.value.err === undefined
          ? null
          : JSON.stringify(simulated.value.err, (_key, entry) =>
              typeof entry === "bigint" ? entry.toString() : entry,
            ),
      unitsConsumed:
        simulated.value.unitsConsumed === null || simulated.value.unitsConsumed === undefined
          ? null
          : String(simulated.value.unitsConsumed),
    };
  } catch (cause) {
    return failure(
      503,
      "WALLET_SIMULATION_UNAVAILABLE",
      `The exact wallet-adjusted transaction could not be simulated: ${cause instanceof Error ? cause.message : String(cause)}`,
      rate,
    );
  }
  if (!simulation.succeeded) {
    return failure(
      409,
      "WALLET_SIMULATION_FAILED",
      `The exact wallet-adjusted transaction does not simulate successfully: ${simulation.error ?? "unknown simulation error"}`,
      rate,
    );
  }

  const preflight = {
    ...value.preflight,
    networkFeeLamports: fee.lamports,
    computeBudget: simulation.unitsConsumed,
    /* Derived, never written. This sentence used to assert two Lighthouse
       assertions unconditionally, and a wallet that adds only a compute budget
       produces none — so a signed Review said something about its own message
       that was not in it. The M2 receipt shipped two sentences of exactly that
       kind, and the fix there was the same: state the count you counted. */
    unfilledReason: `The exact total network fee includes the reviewed base fee and the bounded wallet-added priority fee${
      adopted.comparison.lighthouseAssertions.length > 0
        ? `; ${adopted.comparison.lighthouseAssertions.length} wallet guard assertion(s) were simulated in the same message`
        : "; the wallet added no guard assertions"
    }.`,
    simulation,
  };

  /* Adoption is a customer path, so the operator's experiment configuration does
     not decide it. Unreadable, it becomes the deterministic closed fallback and
     the re-derived verdict reads outside the envelope; the binding check above
     still verifies the exact signed verdict this bundle was reviewed with. */
  const canaryRuntime = resolveCanaryRuntime();
  reportCanaryRuntime(canaryRuntime);
  const resolvedPolicy = { policy: canaryRuntime.policy } as const;
  /* Adoption used to be scoped to classic USDC with six decimals — M1B's exact
     asset. What actually has to hold is that the wallet's adjustment did not
     change what the transfer means, which the byte comparison above already
     decides, and that the adjusted plan is still one the server would permit.
     Re-derived here over the adopted bytes, not the reviewed ones, so an
     augmentation cannot downgrade support and still be adopted. */
  const adoptedSafety = evaluateSendSafety({
    network: adopted.plan.network,
    state: resolveSendState(),
    support: adopted.plan.support,
    simulation: preflight.simulation,
    baseFeeLamports: adopted.plan.baseFeeLamports,
    ataRentLamports: adopted.plan.ataRentLamports,
    createsRecipientAccount: adopted.plan.createsRecipientAccount,
    programs: adopted.plan.programs,
    reviewProof: { status: "SIGNED" },
    requireReviewProof: false,
    ...deploymentSendCapability(adopted.plan.network),
  });
  if (!canSubmitSendAction({ network: adopted.plan.network, safety: adoptedSafety })) {
    return failure(
      409,
      "WALLET_ADOPTION_OUT_OF_SCOPE",
      adoptedSafety.findings.find((finding) => finding.outcome !== "PASS")?.detail ??
        "The wallet-adjusted transaction is not one this deployment will submit.",
      rate,
    );
  }
  let valuation = null;
  try {
    const priceMint = nativeSolPriceMint();
    const catalog = await fetchTokenCatalog([priceMint], 2_500);
    const sol = catalog.ok ? catalog.byMint[priceMint] : null;
    if (catalog.ok && sol?.usdPrice) {
      valuation = buildSendCanaryValuation({
        plan: adopted.plan,
        solUsdPrice: sol.usdPrice,
        sourceRef: `${sol.source.ref}:price:${priceMint}`,
        observedAt: catalog.observedAt,
      });
    }
  } catch {
    valuation = null;
  }
  const canaryIntent = buildSendCanaryIntent({
    plan: adopted.plan,
    valuation,
    humanApproval: resolveSendCanaryHumanApproval(adopted.plan),
  });
  const budget = await readSolanaCanaryBudget({
    store: getGuardRuntime().store,
    policy: resolvedPolicy.policy,
  });
  const canaryVerdict = evaluateSolanaCanaryIntent({
    policy: resolvedPolicy.policy,
    budget,
    intent: canaryIntent,
  });
  const reviewProof = createSendReviewProof({
    bundle: {
      plan: adopted.plan,
      preflight,
      verdict: value.verdict,
      provider: value.provider,
      canaryIntent,
      canaryVerdict,
    },
    key: issuerKey,
  });

  return Response.json(
    {
      data: {
        passport: null,
        preflight,
        verdict: value.verdict,
        plan: adopted.plan,
        provider: value.provider,
        canaryIntent,
        canaryVerdict,
        support: adopted.plan.support,
        safety: adoptedSafety,
        reviewProof,
        /* 1.22.0: «Перевірка» of the bytes the wallet adjusted, counted as the plan route counts it. */
        check: buildSendCheck({ plan: adopted.plan, preflight, verdict: value.verdict, support: adopted.plan.support, safety: adoptedSafety, reviewProof }),
      },
    },
    { headers: responseHeaders(rate) },
  );
}
