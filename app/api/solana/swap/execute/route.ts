import { getBase58Decoder, getTransactionDecoder } from "@solana/kit";
import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { recordPlanExecution } from "@/lib/plans/service";
import { projectedStatus, readTradingPlan } from "@/lib/plans/store";
import { actionFeeFromServiceFee, recordSolanaAction } from "@/lib/solana/action-ledger";
import { statedUsdOf } from "@/lib/solana/action-value";
import { recordOperationRewards } from "@/lib/rewards/record.server";
import { recordOperationPoints } from "@/lib/points/record.server";
import { swapFeePrice } from "@/lib/rewards/swap-settlement";
import { resolveSolanaLaneState } from "@/lib/solana/lane-state";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";
import { assessJupiterOrderFreshness, executeJupiterOrder, resolveJupiterSwapEndpoint } from "@/lib/solana/quotes";
import { assessSwapWalletAdoption, type SwapAdoptionResult } from "@/lib/solana/swap-adoption";
import { readRentParameters, simulatedAccountStates } from "@/lib/solana/rent";
import { assessSwapSimulationEffects } from "@/lib/solana/swap-effect-firewall";
import { sendTransactionOnce, SolanaSubmitRpcError } from "@/lib/solana/submit-rpc";
import { withRpcDiscipline } from "@/lib/solana/rpc";
import { readSignatureStatus } from "@/lib/solana/recover";
import { createIndependentReadHandle, createSolanaRpcHandle } from "@/lib/solana/rpc";
import { transitionSendAttempt, withSendAttemptBoundary } from "@/lib/solana/send-attempt";
import { verifySignatureOnly } from "@/lib/solana/signature";
import {
  SwapExecutionBundleSchema,
  SwapExecutionProofSchema,
  verifySwapExecutionProof,
  type SwapExecutionBundle,
} from "@/lib/solana/swap-execution-review";
import { observeSwap, serviceFeeReadFor } from "@/lib/solana/swap-observe";
import {
  claimSwapOwnerSignature,
  completeSwapOwnerLock,
  markSwapOwnerSubmitted,
} from "@/lib/solana/swap-owner-lock";
import { mintSwapOutcomeReceipt } from "@/lib/solana/swap-outcome";
import { buildSwapReceiptFacts, type SwapReceiptFacts } from "@/lib/solana/swap-receipt";
import { inspectJupiterSwapTransaction } from "@/lib/solana/swap-transaction-check";
import { readSwapCarrier, walletMismatch } from "@/lib/solana/swap-carrier.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * How long the adopted lane waits for its own broadcast to be seen.
 *
 * A blockhash outlives this comfortably and the route itself may run for 60
 * seconds, so this leaves room for the reads and the Receipt that follow. A
 * transaction still unseen after it is genuinely unresolved, and recovery by
 * signature is then the honest answer rather than a premature one.
 */
const ADOPTED_CONFIRM_DEADLINE_MS = 30_000;
const ADOPTED_CONFIRM_INTERVAL_MS = 1_500;

/**
 * The one-shot swap execute route.
 *
 * `../../transfer/settle` stays the only route that broadcasts a transaction
 * through Ryntra's own RPC. This route delegates the broadcast to Jupiter
 * `/execute` — and holds it behind the same discipline: the issuer-signed
 * execution bundle must return unchanged, the wallet's returned bytes must be
 * EXACTLY the reviewed message (a swap has no augmentation lane), the durable
 * owner lock and the submit-once boundary are both crossed before the single
 * POST, and afterwards the only legal follow-up is an independent chain read
 * by signature — never a second execute. The wallet's visible confirmation
 * over the reviewed message is the human approval.
 *
 * It no longer reserves against the owner-canary ledger. That ledger accounts
 * a bounded $20 experiment; charging every swap of a person's own funds
 * against it made the product stop working after the twentieth dollar, and
 * the submit-once guarantee never rested on it — it rests on the send-attempt
 * boundary and the owner lock, both of which are unchanged.
 */

const RequestSchema = z
  .object({
    bundle: SwapExecutionBundleSchema,
    proof: SwapExecutionProofSchema,
    signedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(6_000),
    /**
     * The exact bytes that were handed to the wallet.
     *
     * Needed only to say what a modifying wallet changed, and safe to accept
     * from the browser because it is checked against the issuer-signed
     * bundle's own message hash before it is used for anything.
     */
    reviewedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(6_000).optional(),
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
  return Response.json(
    { error: { code, message, ...extra } },
    { status, headers: responseHeaders(rate) },
  );
}

/**
 * The builder's own comparisons, run ahead so MATCHED is asserted, not hoped.
 *
 * MATCHED means the chain did what the reviewed order said it would: the same
 * input left, the fees were the reviewed fees, and what arrived met the
 * stated minimum. It does not mean the output equalled the quote to the raw
 * unit — an AMM price moves between the quote and the block, and demanding
 * exact equality labelled every honest swap a deviation, including the ones
 * that filled in the signer's favour. Receiving less than the minimum is the
 * real deviation and is still recorded as one.
 */
/**
 * Every refusal above the signature claim is one the network never saw.
 *
 * The browser writes its attempt down BEFORE it sends this request, because a
 * reply that never arrives has to be treated as possibly submitted. But a
 * reply that DOES arrive and says "refused before I claimed anything" is proof
 * of the opposite — and without that proof the browser kept a signature this
 * server had never heard of, offering a recovery that could only ever answer
 * 409 and locking the wallet out of its own product. Saying which side of the
 * boundary a refusal falls on is what lets the browser let go.
 */
function refuseBeforeSubmit(
  status: number,
  code: string,
  message: string,
  rate: RateLimitDecision,
  extra: object = {},
) {
  return failure(status, code, message, rate, { ...extra, submitBoundary: "NOT_CROSSED" });
}

function precheckDeviations(args: {
  bundle: SwapExecutionBundle;
  provider: { requestId: string; signature: string; inputRaw: string; outputRaw: string; status: string };
  observation: { signature: string; actualInputRaw: string; actualOutputRaw: string; baseFeeLamports: string; priorityFeeLamports: string };
}): boolean {
  const quote = args.bundle.review.quote;
  return (
    args.provider.status === "Success" &&
    args.provider.requestId === quote.requestId &&
    args.provider.signature === args.observation.signature &&
    args.provider.inputRaw === args.observation.actualInputRaw &&
    args.provider.outputRaw === args.observation.actualOutputRaw &&
    quote.inputRaw === args.observation.actualInputRaw &&
    BigInt(args.observation.actualOutputRaw) >= BigInt(quote.minimumOutputRaw) &&
    quote.signatureFeeLamports === args.observation.baseFeeLamports &&
    quote.priorityFeeLamports === args.observation.priorityFeeLamports
  );
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return refuseBeforeSubmit(429, "RATE_LIMITED", "Too many requests.", rate);
  /* The site's origin for a browser, the native bearer for the phone; a
     bearer that fails is refused by its own code and never falls through
     (`lib/solana/swap-carrier.ts`). Nothing was claimed yet either way. */
  const carrier = await readSwapCarrier(request, "The owner-canary execute request must come from this site.");
  if (!carrier.ok) return refuseBeforeSubmit(carrier.status, carrier.code, carrier.message, rate);
  /* No owner session. This route submits bytes the connected wallet has
     already signed, and it will only submit bytes that are EXACTLY the
     issuer-signed reviewed message — so the authorization is the signature
     itself, not a login; a native session may only submit its own wallet's
     bytes (bound to the bundle's taker below). The owner lock, the
     submit-once boundary and the returned-bytes comparison are all unchanged
     below.

     The lane stop replaces it as the operator control. It is checked here as
     well as on `/order` because a Review issued a minute ago must not become
     submittable after an operator has closed the lane. Recovery and
     cancellation deliberately carry no such check: a wallet that already
     signed must always be able to find out what happened. */
  if (resolveSolanaLaneState("SWAP") !== "OPEN") {
    return refuseBeforeSubmit(409, "SWAP_PAUSED", "Swapping is turned off right now.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return refuseBeforeSubmit(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return refuseBeforeSubmit(400, "VALIDATION_ERROR", "The execute request did not match its schema.", rate);
  }
  const { bundle, proof, signedTransactionBase64, reviewedTransactionBase64 } = parsed.data;
  /* A native session submits for its own wallet only. */
  if (walletMismatch(carrier, bundle.taker)) {
    return refuseBeforeSubmit(403, "WALLET_MISMATCH", "The session's wallet is not the taker of this bundle.", rate);
  }

  /* The bundle is trusted only under the deployment's own issuer signature. */
  const issuerKey = loadIssuerKey();
  if (!issuerKey) {
    return refuseBeforeSubmit(503, "ISSUER_KEY_MISSING", "This deployment has no issuer key; nothing can be executed.", rate);
  }
  const proofCheck = verifySwapExecutionProof({
    bundle: bundle as SwapExecutionBundle,
    proof,
    trustedPublicKey: issuerKey.publicKey,
  });
  if (!proofCheck.ok) {
    return refuseBeforeSubmit(409, "REVIEW_PROOF_REFUSED", proofCheck.reason, rate);
  }

  const quote = bundle.review.quote;
  if (bundle.review.state !== "FRESH" || quote.access !== "production") {
    return refuseBeforeSubmit(409, "REVIEW_NOT_FRESH", "Only a fresh production review can be executed.", rate);
  }
  if (assessJupiterOrderFreshness({ reviewExpiresAt: quote.reviewExpiresAt }) !== "FRESH") {
    return refuseBeforeSubmit(409, "ORDER_EXPIRED", "The order's review window has closed. Ask for a fresh order and a fresh signature.", rate);
  }
  if (bundle.simulation.status !== "OK") {
    return refuseBeforeSubmit(409, "SIMULATION_FAILED", "A bundle whose simulation failed cannot be executed.", rate);
  }

  const signedInspection = await inspectJupiterSwapTransaction({
    wireBase64: signedTransactionBase64,
    expectedTaker: bundle.taker,
  });
  if (!signedInspection.ok) {
    return refuseBeforeSubmit(409, `SIGNED_${signedInspection.code}`, signedInspection.reason, rate);
  }

  /*
   * Two lanes, and the wallet chooses which one by what it hands back.
   *
   * Byte-identical bytes keep the venue's managed execution, which lands
   * better than anything this process can do alone. A wallet that re-priced
   * the compute budget and attached its own guards has signed a transaction
   * the venue will refuse — its execute lane accepts only the order it built
   * — so those bytes are adopted here instead: re-inspected, re-simulated and
   * re-proved against the same reviewed legs, then broadcast through Ryntra's
   * own RPC, which is the lane `../../transfer/settle` has always used.
   *
   * Refusing the modification outright is what made the swap impossible for
   * the wallet this product is actually used with.
   */
  let adoption: SwapAdoptionResult | null = null;
  if (signedInspection.messageHashHex !== bundle.inspection.messageHashHex) {
    if (!reviewedTransactionBase64) {
      return refuseBeforeSubmit(409, "WALLET_MODIFIED_BYTES", "The signed bytes are not the reviewed message, and the reviewed bytes were not supplied for comparison.", rate);
    }
    /* The browser may not choose what it is compared against: the reviewed
       bytes must hash to the digest the issuer already signed over. */
    const reviewedInspection = await inspectJupiterSwapTransaction({
      wireBase64: reviewedTransactionBase64,
      expectedTaker: bundle.taker,
    });
    if (!reviewedInspection.ok || reviewedInspection.messageHashHex !== bundle.inspection.messageHashHex) {
      return refuseBeforeSubmit(409, "REVIEWED_BYTES_MISMATCH", "The bytes offered as the reviewed message are not the ones this Review was issued over.", rate);
    }
    adoption = assessSwapWalletAdoption({
      reviewedWireBase64: reviewedTransactionBase64,
      signedWireBase64: signedTransactionBase64,
    });
    if (!adoption.ok) {
      return refuseBeforeSubmit(409, adoption.code, adoption.reason, rate);
    }
  }
  const adoptedLane = adoption?.ok === true && adoption.lane === "WALLET_GUARDS" ? adoption : null;

  const signatureCheck = verifySignatureOnly({
    signedWireBase64: signedTransactionBase64,
    expectedSigner: bundle.taker,
  });
  if (signatureCheck.verdict !== "CLEARED") {
    return refuseBeforeSubmit(409, "SIGNATURE_REFUSED", `The taker signature did not verify: ${signatureCheck.verdict}.`, rate, {
      comparisons: signatureCheck.comparisons,
    });
  }

  /* The transaction signature is the taker's signature over these bytes. */
  let signature: string;
  try {
    const decoded = getTransactionDecoder().decode(Buffer.from(signedTransactionBase64, "base64"));
    const raw = (decoded.signatures as unknown as Record<string, Uint8Array | null>)[bundle.taker];
    if (!raw) throw new Error("no taker signature");
    signature = getBase58Decoder().decode(raw);
  } catch {
    return refuseBeforeSubmit(409, "SIGNATURE_UNREADABLE", "The taker signature could not be read from the signed bytes.", rate);
  }

  const selection = resolveJupiterSwapEndpoint({ access: "production" });
  if (!selection.ok) {
    return refuseBeforeSubmit(503, "PROVIDER_KEY_MISSING", selection.reason, rate);
  }

  const store = getGuardRuntime().store;
  if (store.durability !== "DURABLE_MULTI_WRITER") {
    return refuseBeforeSubmit(503, "STORE_NOT_DURABLE", "Value-moving execution requires the durable multi-writer store.", rate);
  }

  /* The bundle's own policy verdict must still be signable. The issuer proof
     above already binds it; this refuses a bundle whose verdict blocks. */
  if (bundle.policyVerdict.decision === "BLOCK") {
    return refuseBeforeSubmit(409, "SWAP_POLICY_BLOCKED", "The reviewed swap policy verdict blocks these bytes.", rate, {
      policy: { verdict: bundle.policyVerdict },
    });
  }

  /* The plan, if the order was made under one (`RYN-STRATEGY-PLAN-001`
     stage B). The proof binds the block and the binding; what the proof
     cannot know is what happened to the plan since the Review — an edit
     into a new version, a cancellation, an expiry. A Review made before an
     edit is not a valid confirmation after it, so the plan is read again
     here, before the network sees anything: the wallet's signature is let
     go and the person reviews afresh. A blocked block in a bundle is
     refused for the same reason the order route refused it. */
  const planBinding = bundle.origin?.plan ?? null;
  if (planBinding) {
    const block = bundle.planReview ?? null;
    if (!block || block.planId !== planBinding.planId || block.version !== planBinding.version || block.reviewId !== planBinding.reviewId || block.verdict === "blocked") {
      return refuseBeforeSubmit(409, "PLAN_REVIEW_BLOCKED", "The bundle's Strategy block is not the one this plan version was offered under.", rate, { planReview: block });
    }
    const planRecord = await readTradingPlan(store, bundle.taker, planBinding.planId);
    if (!planRecord) return refuseBeforeSubmit(404, "PLAN_NOT_FOUND", "No such plan for this wallet.", rate);
    if (planRecord.planVersion !== planBinding.version) {
      return refuseBeforeSubmit(409, "PLAN_VERSION_CONFLICT", `The plan moved to version ${planRecord.planVersion} after this Review judged version ${planBinding.version}. Ask for a fresh Review; nothing was sent.`, rate, { planReview: block });
    }
    const planStatus = projectedStatus(planRecord, Date.now());
    if (planStatus !== "active") {
      return refuseBeforeSubmit(409, "PLAN_STATE_REFUSED", `The plan is ${planStatus} now; only an active plan is traded under. Nothing was sent.`, rate, { planReview: block });
    }
  }

  const submitHandle = createSolanaRpcHandle({ network: "mainnet" });
  const independent = createIndependentReadHandle(submitHandle);
  if (!independent) {
    return refuseBeforeSubmit(503, "NO_INDEPENDENT_RPC", "No independent read operator is available; execution refuses to proceed on provider evidence alone.", rate);
  }

  /*
   * An adopted transaction is re-proved before it is broadcast.
   *
   * The issuer proof binds the bytes that were REVIEWED. These are different
   * bytes, so the proof no longer speaks for them and nothing may be taken on
   * trust from the earlier simulation. They are simulated again and reduced to
   * the signer's own asset effects again, against the same reviewed legs and
   * the same minimum — with the wallet's own priority fee in place of the
   * venue's, because that is what this transaction now asks for.
   */
  if (adoptedLane) {
    try {
      /* The same exact-rent proof the Review was built on: the accounts the
         adopted bytes open for the taker must hold precisely the network's
         rent-exempt minimum for their size. */
      const rent = await readRentParameters(submitHandle).catch(() => null);
      const stateAddresses: readonly string[] = signedInspection.staticAccounts.filter((account) => !signedInspection.programs.includes(account));
      const response = await withRpcDiscipline(submitHandle, (abortSignal) =>
        submitHandle.rpc
          .simulateTransaction(signedTransactionBase64 as never, {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: false,
            innerInstructions: true,
            commitment: "confirmed",
            accounts: { encoding: "base64", addresses: stateAddresses as readonly never[] },
          })
          .send({ abortSignal }),
      );
      if (response.value.err !== null && response.value.err !== undefined) {
        return refuseBeforeSubmit(409, "ADOPTED_SIMULATION_FAILED", "The bytes your wallet returned did not pass simulation. Nothing was sent; ask for a fresh order.", rate);
      }
      const effects = assessSwapSimulationEffects({
        order: {
          taker: bundle.taker,
          inputMint: quote.inputMint,
          outputMint: quote.outputMint,
          inAmountRaw: quote.inputRaw,
          outAmountRaw: quote.quotedOutputRaw,
          minReceivedRaw: quote.minimumOutputRaw,
          signatureFeeLamports: quote.signatureFeeLamports,
          signatureFeePayer: quote.signatureFeePayer,
          priorityFeeLamports: adoptedLane.priorityFeeLamports,
          priorityFeePayer: quote.priorityFeePayer,
          rentFeeLamports: quote.rentFeeLamports,
          rentFeePayer: quote.rentFeePayer,
          gasless: quote.gasless,
          /* The reviewed route, so a hop's own account is judged here exactly
             as the Review judged it. */
          route: quote.route,
        },
        staticAccountCount: signedInspection.staticAccountCount,
        staticAccounts: signedInspection.staticAccounts,
        topLevelPrograms: signedInspection.programs,
        nativeWrapRoundTrip: signedInspection.nativeWrapRoundTrip,
        nativeWrapCandidate: signedInspection.nativeWrapCandidate,
        tokenProgramIndices: signedInspection.tokenProgramIndices,
        simulation: response.value,
        accountStates: simulatedAccountStates(stateAddresses, response.value.accounts),
        rent,
      });
      if (!effects.ok) {
        return refuseBeforeSubmit(409, `ADOPTED_EFFECT_${effects.code}`, `${effects.reason} Nothing was sent.`, rate);
      }
    } catch (cause) {
      return refuseBeforeSubmit(503, "ADOPTED_SIMULATION_UNAVAILABLE", `The bytes your wallet returned could not be simulated: ${cause instanceof Error ? cause.message : String(cause)}`, rate);
    }
  }

  const ownerClaim = await claimSwapOwnerSignature({
    store,
    owner: bundle.taker,
    requestId: quote.requestId,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    signature,
    at: new Date().toISOString(),
  });
  if (!ownerClaim.ok) {
    /* The claim is the last step before the send-attempt boundary; a refused
       claim sent nothing, so the browser may let this signature go rather
       than keep it as a submission of unknown outcome. */
    const status = ownerClaim.code === "OWNER_SWAP_LOCK_UNAVAILABLE" ? 503 : 409;
    return refuseBeforeSubmit(status, ownerClaim.code, ownerClaim.reason, rate);
  }

  type SettleOutcome = Readonly<{
    kind: "EXECUTED" | "AMBIGUOUS";
    /** Null on the adopted lane: this deployment broadcast, not the venue. */
    report: Awaited<ReturnType<typeof executeJupiterOrder>> | null;
    broadcastFailure: string | null;
  }>;

  const boundaryResult = await withSendAttemptBoundary<SettleOutcome>({
    store,
    network: "mainnet",
    signature,
    messageDigest: `0x${bundle.inspection.messageHashHex}`,
    reviewDigest: proof.digest,
    settle: async (boundary) => {
      await boundary.beforeSubmit();
      const ownerSubmitted = await markSwapOwnerSubmitted({
        store,
        owner: bundle.taker,
        signature,
        submissionLane: adoptedLane ? "ADOPTED_RPC" : "JUPITER_EXECUTE",
        at: new Date().toISOString(),
      });
      if (!ownerSubmitted.ok) throw new Error(`The owner swap lock could not cross submit-unknown: ${ownerSubmitted.reason}`);
      /* Into the history before the bytes go out, not after they come back. A
         swap that submits and then never resolves is exactly the one a person
         needs to find, and a row written only on success would leave that one
         invisible. It is overwritten with the settled leg further down. */
      await recordSolanaAction(store, {
        network: "mainnet",
        wallet: bundle.taker,
        actionId: signature,
        lane: "SWAP",
        outcome: "IN_FLIGHT",
        out: { mint: quote.inputMint, amountRaw: quote.inputRaw, decimals: null, symbol: null },
        signature,
        providerRef: quote.requestId,
        now: new Date().toISOString(),
      });
      /* Adopted bytes cannot go to the venue's execute lane — it accepts only
         the transaction it built — so they are broadcast once through this
         deployment's own RPC, the same primitive the transfer settle route
         has always used. One send, whatever the answer. */
      if (adoptedLane) {
        try {
          await sendTransactionOnce({ handle: submitHandle, signedWireBase64: signedTransactionBase64 });
          return { kind: "EXECUTED", report: null, broadcastFailure: null } as const;
        } catch (cause) {
          const reason =
            cause instanceof SolanaSubmitRpcError || cause instanceof Error ? cause.message : String(cause);
          return { kind: "AMBIGUOUS", report: null, broadcastFailure: reason } as const;
        }
      }
      const report = await executeJupiterOrder(
        { signedTransactionBase64, requestId: quote.requestId },
        selection,
      );
      return { kind: report.ok ? "EXECUTED" : "AMBIGUOUS", report, broadcastFailure: null } as const;
    },
    onAlreadySubmitted: (record) => ({
      ok: false as const,
      code: "ALREADY_SUBMITTED",
      reason: `These bytes already crossed the submit boundary (${record.state}). Read the signature; never execute again.`,
      signature,
    }),
    onFailure: (boundaryFailure) => ({ ok: false as const, ...boundaryFailure }),
  });

  if ("ok" in boundaryResult && boundaryResult.ok === false) {
    return failure(409, boundaryResult.code, boundaryResult.reason, rate, {
      signature: boundaryResult.signature,
    });
  }
  const { report, broadcastFailure } = boundaryResult as SettleOutcome;
  /* Both lanes answer the same question: did the bytes reach the network? */
  const delivered = report ? report.ok : broadcastFailure === null;

  /* From here on the bytes may be on the network. Everything below reads;
     nothing below re-executes. */
  let statusRead = await readSignatureStatus(independent, signature);
  let seen = statusRead.state === "READ" && statusRead.status.seen;

  /*
   * Wait for the adopted lane's own broadcast to land.
   *
   * The venue's execute call confirms before it answers. `sendTransactionOnce`
   * returns the moment a cluster accepts the bytes, which is several seconds
   * before any node will admit to seeing the signature — so reading the status
   * immediately answered "not seen", the route returned RECOVERY_PENDING, and
   * a person whose swap was simply still confirming was handed a recovery
   * button for an ordinary success. This is the same wait, done here, against
   * the independent operator rather than the one that took the bytes.
   */
  if (!seen && adoptedLane && delivered) {
    const deadline = Date.now() + ADOPTED_CONFIRM_DEADLINE_MS;
    while (!seen && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, ADOPTED_CONFIRM_INTERVAL_MS));
      statusRead = await readSignatureStatus(independent, signature);
      seen = statusRead.state === "READ" && statusRead.status.seen;
    }
  }

  if (!delivered && !seen) {
    return Response.json(
      {
        state: "SUBMITTED_UNKNOWN",
        signature,
        report: null,
        providerFailure:
          report && !report.ok
            ? { code: report.code, reason: report.reason }
            : { code: "BROADCAST_UNANSWERED", reason: broadcastFailure ?? "The broadcast did not answer." },
        recovery:
          "The submit did not answer and the chain has not shown the signature yet. The attempt stays reserved; recover by reading the signature — never by executing again.",
      },
      { status: 202, headers: responseHeaders(rate) },
    );
  }

  if (report?.ok && report.report.status === "Failed" && !seen) {
    await transitionSendAttempt({
      store,
      network: "mainnet",
      signature,
      to: "RECOVERY_REQUIRED",
      at: new Date().toISOString(),
    });
    return failure(409, "EXECUTE_FAILED", `Jupiter reported ${report.report.code}: ${report.report.providerError ?? "no detail"}. The chain shows no landing; the reservation stays recorded and nothing is retried automatically.`, rate, {
      report: report.report,
      signature,
    });
  }

  /* Landed (or Jupiter says landed): observe independently. */
  const finality =
    statusRead.state === "READ" && statusRead.status.confirmationStatus === "finalized"
      ? ("finalized" as const)
      : ("confirmed" as const);
  const observed = await observeSwap(independent, {
    signature,
    taker: bundle.taker,
    inputMint: quote.inputMint,
    outputMint: quote.outputMint,
    requiredSignatures: bundle.inspection.signerAddresses.length,
    finality,
    /* Read straight off the reviewed quote, not off configuration. If the
       referral account changed between the Review and this read, the fee that
       was actually charged belongs to the account the person's transaction was
       built against, and asking about a different one would report someone
       else's balance as Ryntra's income. */
    serviceFee: serviceFeeReadFor(quote),
  });

  if (!observed.ok) {
    if (observed.code === "LANDED_FAILED") {
      const held = await transitionSendAttempt({
        store,
        network: "mainnet",
        signature,
        to: "RECOVERY_REQUIRED",
        at: new Date().toISOString(),
      });
      return failure(409, "LANDED_FAILED", observed.reason, rate, {
        signature,
        chainError: observed.chainError,
        report: report?.ok ? report.report : null,
        durableState: held.ok ? held.record.state : "UNKNOWN",
        recovery: "The failed landing remains RECOVERY_REQUIRED until its fee-only evidence is reconciled.",
      });
    }
    return Response.json(
      {
        state: "RECOVERY_PENDING",
        signature,
        report: report?.ok ? report.report : null,
        observationFailure: { code: observed.code, reason: observed.reason },
        recovery: "The independent read has not resolved yet. Read again by signature; never execute again.",
      },
      { status: 202, headers: responseHeaders(rate) },
    );
  }

  /* Null on the adopted lane: this deployment broadcast the bytes, so there is
     no venue report to reconcile against and the independent chain read is the
     whole of the evidence. */
  const executeReport = report?.ok ? report.report : null;
  const providerInput = executeReport?.totalInputAmountRaw ?? executeReport?.inputAmountResultRaw;
  const providerOutput = executeReport?.totalOutputAmountRaw ?? executeReport?.outputAmountResultRaw;

  let facts: SwapReceiptFacts | null = null;
  let receipt: unknown = null;
  let factsRefusal: string | null = null;
  if (executeReport && executeReport.signature && providerInput && providerOutput) {
    const provider = {
      requestId: quote.requestId,
      signature: executeReport.signature,
      status: executeReport.status,
      inputRaw: providerInput,
      outputRaw: providerOutput,
      source: {
        ref: executeReport.source.ref,
        label: executeReport.source.label,
        observedAt: executeReport.observedAt,
      },
    };
    const clean = precheckDeviations({
      bundle: bundle as SwapExecutionBundle,
      provider,
      observation: observed.observation,
    });
    try {
      facts = buildSwapReceiptFacts({
        review: bundle.review,
        provider,
        observation: { ...observed.observation, programs: [...observed.observation.programs] },
        reconciliation: clean ? "MATCHED" : "DEVIATION_RECORDED",
      });
    } catch (cause) {
      factsRefusal = cause instanceof Error ? cause.message : String(cause);
    }
  } else {
    /*
     * No venue report. On the adopted lane that is the ordinary case rather
     * than a recovery — this deployment broadcast the bytes itself, so the
     * independent chain read is the whole of the evidence and it is enough to
     * settle on. What arrived is still measured against the reviewed minimum;
     * the wallet's own priority fee will differ from the venue's quote and is
     * recorded as the deviation it is.
     */
    const withinReview =
      adoptedLane !== null &&
      observed.observation.actualInputRaw === quote.inputRaw &&
      BigInt(observed.observation.actualOutputRaw) >= BigInt(quote.minimumOutputRaw);
    try {
      facts = buildSwapReceiptFacts({
        review: bundle.review,
        provider: null,
        observation: { ...observed.observation, programs: [...observed.observation.programs] },
        reconciliation: withinReview ? "DEVIATION_RECORDED" : "RECOVERY",
      });
    } catch (cause) {
      factsRefusal = cause instanceof Error ? cause.message : String(cause);
    }
  }

  const at = new Date().toISOString();
  if (!facts) {
    const held = await transitionSendAttempt({
      store,
      network: "mainnet",
      signature,
      to: "RECOVERY_REQUIRED",
      at,
    });
    return Response.json(
      {
        state: "RECOVERY_PENDING",
        signature,
        report: executeReport,
        observation: observed.observation,
        facts,
        factsRefusal,
        recovery: `The chain outcome is known but closeout is incomplete: ${factsRefusal ?? "receipt facts unavailable"}. ${held.ok ? "The attempt remains RECOVERY_REQUIRED." : held.reason}`,
      },
      { status: 202, headers: responseHeaders(rate) },
    );
  }

  const finalizedAttempt = await transitionSendAttempt({
    store,
    network: "mainnet",
    signature,
    to: finality === "finalized" ? "FINALIZED" : "CONFIRMED",
    at,
  });
  if (!finalizedAttempt.ok) {
    return Response.json(
      {
        state: "RECOVERY_PENDING",
        signature,
        recovery: `The chain outcome is known, but the durable attempt could not record finality: ${finalizedAttempt.reason}`,
      },
      { status: 202, headers: responseHeaders(rate) },
    );
  }

  const minted = mintSwapOutcomeReceipt({
    id: `swap:${quote.requestId}`,
    actionPassportHash: proof.digest,
    facts,
    submissionLane: adoptedLane ? "ADOPTED_RPC" : "JUPITER_EXECUTE",
  });
  if (!minted.ok) {
    await transitionSendAttempt({ store, network: "mainnet", signature, to: "RECOVERY_REQUIRED", at });
    return Response.json(
      { state: "RECOVERY_PENDING", signature, recovery: minted.reason },
      { status: 202, headers: responseHeaders(rate) },
    );
  }
  receipt = minted.receipt;
  const ownerCompleted = await completeSwapOwnerLock({
    store,
    owner: bundle.taker,
    signature,
    state: "RECEIPTED",
    receiptHash: minted.receipt.contentHash,
    receipt: minted.receipt,
    at,
  });
  if (!ownerCompleted.ok) {
    return Response.json(
      {
        state: "RECOVERY_PENDING",
        signature,
        recovery: `The Receipt exists but the durable owner artifact did not close: ${ownerCompleted.reason}`,
      },
      { status: 202, headers: responseHeaders(rate) },
    );
  }
  /* The wallet's own history. The owner lock already holds the full Receipt
     keyed `mainnet:<owner>`, but that slot is a boundary — one open swap per
     wallet — and it is reused, so it is not a history. This row is. */
  const swapRowFee = actionFeeFromServiceFee(facts.fees.serviceFee);
  const swapRow = await recordSolanaAction(store, {
    network: "mainnet",
    wallet: bundle.taker,
    actionId: signature,
    lane: "SWAP",
    outcome: "DONE",
    /* **What the chain did, not what the quote said.** These two read
       `quote.inputRaw` and `quote.quotedOutputRaw`, so History showed the price
       a person was offered rather than the amount they were paid. On the first
       fee-bearing swap the difference was 141 raw units in the person's favour:
       the receipt recorded 1,007,814 received against 1,007,673 quoted, and
       History said the smaller number. A row that reports less than arrived is
       a small lie in the safe direction, which is still a lie — and on the day
       slippage goes the other way it stops being safe. The receipt already
       keeps both figures side by side; this is the row that is meant to be the
       outcome. */
    out: { mint: quote.inputMint, amountRaw: observed.observation.actualInputRaw, decimals: null, symbol: null },
    in: { mint: quote.outputMint, amountRaw: observed.observation.actualOutputRaw, decimals: null, symbol: null },
    signature,
    receiptHash: minted.receipt.contentHash,
    /* What it cost, read off the same settled fee the Receipt and Rewards use.
       The cross-chain lane has carried this since `RYN-MONEY-RECEIPT-PARITY-001`;
       a Solana swap row said what moved and never what it cost, so the owner's
       revenue could not be added up from the one history that exists. */
    ...(swapRowFee ? { fee: swapRowFee } : {}),
    /* Spot or Swap — read off the signed bundle, never off the request. */
    origin: bundle.origin ?? null,
    /* The provider's id for this fill, and its own dollar figure for the exact
       input it took — the row's second valuation basis where no stablecoin
       leg gives par, on the same rule Points applies below. */
    providerRef: quote.requestId,
    statedUsd: statedUsdOf(quote.inUsdValue, quote.inputRaw, observed.observation.actualInputRaw),
    now: at,
  });

  /* The plan's own record of this execution, after the History row that is
     the durable source. Non-fatal on the same terms as the reward below: a
     swap that moved money is never reported as failed because the plan's
     row was slow, and every read of the plan reconciles it from History by
     this same signature — so a failure here is written to the log and
     surfaces as `sync: pending`, never as a second trade. */
  if (planBinding && bundle.planReview) {
    const planWrite = await recordPlanExecution(store, {
      owner: bundle.taker,
      planId: planBinding.planId,
      execution: { signature, version: planBinding.version, reviewId: planBinding.reviewId, review: bundle.planReview, reviewedAt: bundle.planReview.checkedAt, outcome: "DONE" },
    });
    if (!planWrite.ok) console.error(`plan-execution not recorded on ${planBinding.planId}: ${planWrite.reason}; History holds the row, the next read reconciles it`);
  }

  /* Rewards. Deliberately after the Receipt, the owner artifact and the
     history row: every one of those is part of the swap being finished, and a
     reward is a consequence of it having finished. The call cannot throw and
     its result is not read — a swap that moved money is never reported as
     failed because an entitlement row was slow, and the same operation
     reference writes the same rows on any later read. */
  await recordOperationRewards(store, {
    fee: facts.fees.serviceFee,
    trader: bundle.taker,
    settledAt: observed.observation.observedAt,
    now: at,
    price: swapFeePrice(quote, facts.fees.serviceFee),
  });

  /* Points, on the same terms as the reward above: after the history row,
     from the row itself, non-fatal, keyed by the signature so a later read
     of this settlement writes the same rows. Jupiter's own valuation of the
     input it took is the dollar figure for a non-stablecoin input; it is
     the provider's measurement of this exact amount, never a quote of a
     different one. */
  if (swapRow.ok) {
    await recordOperationPoints(store, {
      action: swapRow.action,
      statedUsd: quote.inUsdValue ? { value: quote.inUsdValue, sourceRef: "jupiter:order:inUsdValue" } : null,
      settledAt: observed.observation.observedAt,
      now: at,
    });
  }

  const receiptedAttempt = await transitionSendAttempt({
    store,
    network: "mainnet",
    signature,
    to: "RECEIPTED",
    at,
    receiptHash: minted.receipt.contentHash,
  });
  if (!receiptedAttempt.ok) {
    return Response.json(
      {
        state: "RECOVERY_PENDING",
        signature,
        recovery: `The durable owner artifact holds the full Receipt, but the send-attempt projection did not close: ${receiptedAttempt.reason}`,
      },
      { status: 202, headers: responseHeaders(rate) },
    );
  }

  return Response.json(
    {
      state: facts ? facts.reconciliation.state : "DEVIATION_RECORDED",
      signature,
      finality,
      report: executeReport,
      observation: observed.observation,
      takerLamportDelta: observed.takerLamportDelta,
      feeLamports: observed.feeLamports,
      facts,
      factsRefusal,
      receipt,
      policy: { verdict: bundle.policyVerdict },
    },
    { headers: responseHeaders(rate) },
  );
}
