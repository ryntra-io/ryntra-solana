import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey, publishedIssuerKey } from "@/lib/agent-control/issuer";
import { verifyAgentArtifact } from "@/lib/agent-control/verify";
import { getGuardRuntime } from "@/lib/guard/runtime";
import {
  canaryFlowPermitted,
  readCanaryFlow,
  resolveCanaryRuntime,
} from "@/lib/solana/canary-runtime";
import { deploymentSendCapability } from "@/lib/solana/send-deployment";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { recordSolanaAction, sendOutcome } from "@/lib/solana/action-ledger";
import { withSendAttemptBoundary, type SendAttemptFailure } from "@/lib/solana/send-attempt";
import { validateSettlementCandidate, type SettlementResult } from "@/lib/solana/settlement";
import { observeTransfer } from "@/lib/solana/observe";
import { mintSolanaOutcomeReceipt } from "@/lib/solana/outcome";
import { recoverSend } from "@/lib/solana/recover";
import {
  createIndependentReadHandle,
  createSolanaRpcHandle,
  withRpcDiscipline,
} from "@/lib/solana/rpc";
import {
  canSubmitSendAction,
  evaluateSendSafety,
  resolveSendState,
} from "@/lib/solana/send-safety";
import { SettlementRequestSchema, settleSignedTransfer } from "@/lib/solana/settlement";
import { submitClearedTransfer } from "@/lib/solana/submit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const ROUTE_DEADLINE_MS = 50_000;

/**
 * The only route that can submit a Solana transaction.
 *
 * M1B opens one action-shaped mainnet envelope: exact classic-USDC ATA
 * creation under the founder-recorded tuple and durable canary reservation.
 * The request carries the reviewed plan, preflight and verdict; the service
 * verifies the returned signature over that message, submits once, recovers
 * by signature status first, observes the chain independently and mints the
 * structured Send Receipt inside the signed Outcome Receipt. Every other
 * mainnet Send action remains closed.
 */

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
  return Response.json(
    { error: { code, message, ...extra } },
    { status, headers: responseHeaders(rate) },
  );
}

export async function POST(request: Request) {
  const deadlineAt = Date.now() + ROUTE_DEADLINE_MS;
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);

  /* An owner canary may not run while its own policy is unreadable. The flow is
     declared by the caller and never inferred from the verdict: under a closed
     fallback every action reads outside the envelope, so a mode taken from the
     scope would let a real canary through wearing a customer's clothes and spend
     real money with no reservation, no ceiling and no ledger entry behind it.

     Checked before the body is even parsed. A refusal that arrives after schema
     validation is one a caller can only reach by already holding a well-formed
     signed bundle, which makes it unverifiable and, worse, later than it needs
     to be: nothing about an unreadable policy depends on what was posted. */
  const canaryFlow = readCanaryFlow(request.headers);
  const flowPermitted = canaryFlowPermitted(resolveCanaryRuntime(), canaryFlow);
  if (!flowPermitted.ok) {
    return failure(503, flowPermitted.code, flowPermitted.reason, rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) {
    return failure(body.status, body.code, "The request body was not accepted.", rate);
  }

  const shaped = SettlementRequestSchema.safeParse(body.value);
  if (!shaped.success) {
    const detail = shaped.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join(" · ");
    return failure(400, "VALIDATION_ERROR", detail, rate);
  }
  /* Re-derived here, never taken from the request. A caller that posted its own
     "this is fine" would be supplying the permission it is asking for. */
  const settleSafety = evaluateSendSafety({
    network: shaped.data.plan.network,
    state: resolveSendState(),
    support: shaped.data.plan.support,
    simulation: shaped.data.preflight.simulation,
    baseFeeLamports: shaped.data.plan.baseFeeLamports,
    ataRentLamports: shaped.data.plan.ataRentLamports,
    createsRecipientAccount: shaped.data.plan.createsRecipientAccount,
    programs: shaped.data.plan.programs,
    reviewProof: { status: "SIGNED" },
    requireReviewProof: false,
    ...deploymentSendCapability(shaped.data.plan.network),
  });
  if (!canSubmitSendAction({ network: shaped.data.plan.network, safety: settleSafety })) {
    return failure(
      403,
      "SEND_NOT_PERMITTED",
      settleSafety.findings.find((finding) => finding.outcome !== "PASS")?.detail ??
        "This transfer is not permitted to reach the network.",
      rate,
    );
  }

  const issuerKey = loadIssuerKey();
  if (!issuerKey) {
    return failure(
      503,
      "REVIEW_PROOF_UNAVAILABLE",
      "This deployment has no document-signing key, so it cannot verify an exact Send Review bundle before submission.",
      rate,
    );
  }
  /*
   * The owner-canary policy is not read here, and used not to be needed here
   * either — it was resolved, refused the request with 503 when it could not
   * be parsed, and then never consulted again.
   *
   * That made the founder's own experiment configuration a precondition for
   * every stranger's transfer, and it failed in the worst possible place: this
   * route runs *after* the wallet signature, so a malformed canary variable
   * turned an approved mainnet transfer into an error nobody could see from
   * the screen. It is the same shape as the defect `001A` closed, where a lane
   * gate lived only in `order` and `execute` and was invisible until somebody
   * pressed the button.
   *
   * What decides admission here is the verified signature and the durable
   * submit boundary below. The canary is evidence, and evidence does not gate.
   */


  const guardStore = getGuardRuntime().store;
  if (guardStore.durability !== "DURABLE_MULTI_WRITER") {
    return failure(
      503,
      "SETTLEMENT_STORE_UNAVAILABLE",
      "Mainnet submission requires a durable multi-writer store to record that these exact bytes crossed the submit boundary once.",
      rate,
    );
  }
  const configured = createSolanaRpcHandle({ network: shaped.data.plan.network });
  const reviewedEndpoint = configured.endpoints.find(
    (endpoint) =>
      endpoint.role === shaped.data.provider.role &&
      endpoint.host === shaped.data.provider.host,
  );
  if (!reviewedEndpoint) {
    return failure(
      409,
      "REVIEW_PROVIDER_CHANGED",
      "The Solana provider configuration changed after Review. Build and simulate a fresh message.",
      rate,
    );
  }
  const independentEndpoint = configured.endpoints.find(
    (endpoint) => endpoint.host !== reviewedEndpoint.host,
  );
  const handle = createSolanaRpcHandle({
    network: shaped.data.plan.network,
    endpoint: reviewedEndpoint.url,
    fallbackEndpoint: independentEndpoint?.url ?? null,
    timeoutMs: configured.timeoutMs,
    retries: configured.retries,
    maxResponseBytes: configured.maxResponseBytes,
  });
  const independentRead = createIndependentReadHandle(handle);
  if (!independentRead) {
    return failure(
      503,
      "INDEPENDENT_READBACK_UNAVAILABLE",
      "Submission requires a second Solana RPC provider for status and effect read-back.",
      rate,
    );
  }
  /* The boundary that makes "submitted once" true, keyed by the locally
     verified signature rather than by a canary reservation. The owner-canary
     ledger stays where it is as M1B's evidence; it is not what stops a second
     broadcast of an ordinary transfer. */
  const validatedCandidate = validateSettlementCandidate(body.value, {
    trustedPublicKey: issuerKey.publicKey,
  });
  if (!validatedCandidate.ok) {
    return failure(422, validatedCandidate.code, validatedCandidate.reason, rate, {
      signature: "signature" in validatedCandidate ? validatedCandidate.signature : null,
    });
  }
  const localSignature = validatedCandidate.check.signature.value;
  if (!localSignature) {
    return failure(
      409,
      "SIGNED_BYTES_REJECTED",
      "The exact signed transaction has no locally verified Solana signature.",
      rate,
    );
  }
  const settled = await withSendAttemptBoundary<SettlementResult>({
    store: guardStore,
    network: shaped.data.plan.network,
    signature: localSignature,
    messageDigest: shaped.data.plan.fingerprint.messageHash,
    reviewDigest: shaped.data.reviewProof.digest,
    onAlreadySubmitted: (): SendAttemptFailure => ({
      ok: false,
      code: "SUBMISSION_UNKNOWN",
      reason:
        "These exact bytes already crossed the submit boundary. Their outcome is read from the signature; they are never broadcast again.",
      signature: localSignature,
    }),
    onFailure: (value): SendAttemptFailure => ({ ok: false, ...value }),
    settle: ({ beforeSubmit }) =>
      settleSignedTransfer({
        request: body.value,
        trustedPublicKey: issuerKey.publicKey,
        deadlineAt,
        dependencies: {
          currentBlockHeight: async () => {
            /* PublicNode currently answers `getBlockHeight` with its slot,
               roughly twenty-two million above the cluster block height. That
               made every fresh blockhash look expired within seconds. The
               pre-submit expiry verdict is evidence, so read it from the
               already-required independent operator instead of trusting the
               same endpoint that supplied the transaction. */
            const height = await withRpcDiscipline(independentRead, (abortSignal) =>
              independentRead.rpc.getBlockHeight({ commitment: "confirmed" }).send({ abortSignal }),
            );
            return String(height);
          },
          submit: async ({ plan, check, signedWireBase64, deadlineAt: operationDeadlineAt }) => {
            await beforeSubmit();
            return submitClearedTransfer({
              handle,
              plan,
              check,
              signedWireBase64,
              operationDeadlineAt,
            });
          },
          recover: ({ signature, lastValidBlockHeight, actionRef }) =>
            recoverSend({
              handle: independentRead,
              signature,
              lastValidBlockHeight,
              readEffects: (value) => observeTransfer(independentRead, value, { actionRef }),
            }),
          observe: ({ signature, actionRef }) =>
            observeTransfer(independentRead, signature, { actionRef }),
          mint: mintSolanaOutcomeReceipt,
        },
      }),
  });
  /* The wallet's own history, written beside the submit boundary rather than
     inside it. `solanaSendAttempts` is keyed by the signature because that is
     what makes "these bytes went out once" decidable; it holds no address, so
     it can never answer "what did I do". This does, and it is an index rather
     than a boundary: it is awaited so a cold serverless instance cannot drop
     it, and it can only ever report a failure, never raise one into a transfer
     that has already happened. */
  const historyWallet = shaped.data.plan.sender;
  const historyMovement = {
    mint: shaped.data.plan.mint,
    amountRaw: shaped.data.plan.amountRaw,
    decimals: shaped.data.plan.decimals,
    symbol: null,
  };

  if (!settled.ok) {
    const unresolvedSignature = "signature" in settled ? settled.signature : null;
    if (unresolvedSignature !== null) {
      /* A refusal that carries a signature is not "nothing happened" — the
         bytes may be live. It goes into the history unresolved, because the
         one thing a person must never read here is a false failure. */
      await recordSolanaAction(guardStore, {
        network: shaped.data.plan.network,
        wallet: historyWallet,
        actionId: unresolvedSignature,
        lane: "SEND",
        outcome: "IN_FLIGHT",
        out: historyMovement,
        signature: unresolvedSignature,
        now: new Date().toISOString(),
      });
    }
    return failure(422, settled.code, settled.reason, rate, {
      signature: unresolvedSignature,
    });
  }

  await recordSolanaAction(guardStore, {
    network: shaped.data.plan.network,
    wallet: historyWallet,
    actionId: settled.signature,
    lane: "SEND",
    outcome: sendOutcome(settled.state),
    out: historyMovement,
    signature: settled.signature,
    now: new Date().toISOString(),
  });

  if (settled.receipt === null) {
    return Response.json(
      { data: settled },
      { status: 202, headers: responseHeaders(rate) },
    );
  }

  const published = publishedIssuerKey(issuerKey);
  const verification = verifyAgentArtifact(settled.receipt, {
    trustedPublicKeys: published.publicKey ? [published.publicKey] : undefined,
  });
  return Response.json(
    { data: { ...settled, verification } },
    { headers: responseHeaders(rate) },
  );
}
