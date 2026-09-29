import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { createEvmRpcHandle } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { recordSolanaAction } from "@/lib/solana/action-ledger";
import { cctpLaneFacts, isCctpDirection, isSolanaSourceDirection } from "@/lib/solana/cctp-direction";
import { resolveSolanaBridgeNetworkState } from "@/lib/solana/lane-state";
import { mutationOriginAllowed } from "@/lib/security";
import { bridgeHeaders, bridgeRefuseBeforeBurn, describeBridgeIssues } from "@/lib/solana/bridge-http";
import {
  cctpBurnRecovery,
  markCctpBurnConfirmed,
  markCctpBurnReverted,
  withCctpBurnBoundary,
  type CctpBurnClaimRecord,
} from "@/lib/solana/cctp-burn-claim";
import { verifyCctpReviewProof, CctpReviewProofSchema } from "@/lib/solana/cctp-review-proof";
import { resolveSolanaCanaryPolicy, type SolanaCanaryPolicy } from "@/lib/solana/canary-policy";
import {
  canaryFlowPermitted,
  readCanaryFlow,
  resolveCanaryRuntime,
} from "@/lib/solana/canary-runtime";
import {
  CCTP_CANARY_NOT_IN_SCOPE,
  cctpCanaryExposureNeeded,
  markCctpCanarySubmitted,
  openCctpCanaryExposure,
  settleCctpCanaryExposure,
  type CctpCanaryOutcome,
} from "@/lib/solana/cctp-canary-exposure";
import { canBurn, cctpSafetyPlanFacts, evaluateCctpSafety } from "@/lib/solana/cctp-safety";
import { checkCctpSignedBurn } from "@/lib/solana/cctp-signature";
import { createIndependentReadHandle, createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { deploymentSendCapability } from "@/lib/solana/send-deployment";
import { sendTransactionOnce, SolanaSubmitRpcError } from "@/lib/solana/submit-rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const ROUTE_DEADLINE_MS = 50_000;
const CONFIRM_ATTEMPTS = 25;
const CONFIRM_INTERVAL_MS = 1_000;

/**
 * The only route that can burn.
 *
 * It re-derives every verdict rather than trusting the bundle it is handed: a
 * caller that posted its own safety finding would be supplying the permission
 * it is asking for. The issuer proof is what makes the plan trustworthy —
 * without it the bundle is just JSON the browser could rewrite — and the
 * durable claim is what makes "burned once" true across a cold start.
 *
 * Two signatures over one message, produced in a fixed order: the wallet
 * signs, the returned message is re-checked, and only then does the ephemeral
 * message account fill its empty slot. This route sees the finished
 * transaction and verifies both signatures over the same message.
 *
 * A wallet is allowed to add its own guards and nothing else. Phantom prepends
 * a ComputeBudget request and appends Lighthouse assertions that check the
 * transfer did what it claimed; those change the bytes and change nothing
 * about the transfer, and a check that refused them refused every honest
 * signature — which is exactly what the first version of this route did. What
 * has to be identical is what the transaction *does*. When the wallet has
 * added anything, the returned bytes are simulated again before the boundary,
 * because the simulation that passed at Review was of different bytes.
 */

const PlanSchema = z.object({}).passthrough();

/** What one completed burn returns. Named so the boundary infers nothing. */
type BurnOutcome = Readonly<{
  ok: true;
  signature: string;
  lane: "EXACT" | "WALLET_GUARDS_ONLY" | null;
  addedPrograms: readonly string[];
  confirmation: "CONFIRMED" | "PENDING";
  slot: string | null;
  landedError: string | null;
  intentDigest: string;
  observedBy: string;
}>;

const RequestSchema = z
  .object({
    bundle: z
      .object({
        plan: PlanSchema,
        provider: z.object({}).passthrough(),
        rpc: z.object({ role: z.enum(["primary", "fallback", "independent"]), host: z.string().min(1) }).strict(),
        simulation: z
          .object({
            status: z.enum(["PRESENT", "SKIPPED"]),
            succeeded: z.boolean(),
            error: z.string().nullable(),
            unitsConsumed: z.string().nullable(),
          })
          .strict(),
        canaryIntent: z.object({}).passthrough(),
        canaryVerdict: z.object({}).passthrough(),
      })
      .strict(),
    reviewProof: CctpReviewProofSchema,
    signedTransactionBase64: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(8_000),
    recipientConfirmed: z.boolean().default(false),
  })
  .strict();

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return bridgeRefuseBeforeBurn(429, "RATE_LIMITED", "Too many requests.", rate);

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
    return bridgeRefuseBeforeBurn(503, flowPermitted.code, flowPermitted.reason, rate);
  }
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return bridgeRefuseBeforeBurn(403, "FORBIDDEN_ORIGIN", "The bridge burn must be requested from this site.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeRefuseBeforeBurn(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return bridgeRefuseBeforeBurn(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);
  }

  const issuerKey = loadIssuerKey();
  if (!issuerKey) {
    return bridgeRefuseBeforeBurn(
      503,
      "REVIEW_PROOF_UNAVAILABLE",
      "This deployment has no document-signing key, so it cannot verify the exact bridge Review before a burn.",
      rate,
    );
  }

  const bundle = parsed.data.bundle as never;
  const proofCheck = verifyCctpReviewProof({
    bundle,
    proof: parsed.data.reviewProof,
    trustedPublicKey: issuerKey.publicKey,
  });
  if (!proofCheck.ok) {
    return bridgeRefuseBeforeBurn(409, "REVIEW_PROOF_REFUSED", proofCheck.reason, rate);
  }

  /* Only now is the bundle worth reading as data: the proof says these exact
     bytes were what this deployment reviewed. */
  const reviewed = parsed.data.bundle as unknown as {
    plan: import("@/lib/solana/cctp-plan").CctpBurnPlan;
    provider: import("@/lib/solana/cctp-provider").CctpProviderSnapshot;
    simulation: { status: "PRESENT" | "SKIPPED"; succeeded: boolean; error: string | null };
    canaryIntent: unknown;
    canaryVerdict: import("@/lib/solana/canary-policy").SolanaCanaryVerdict;
  };
  const plan = reviewed.plan;
  /* The direction is read from the signed plan and compared against this
     route's own, rather than assumed from the fact that this file is the Solana
     one. A Base-source bundle posted here would otherwise be measured against
     Solana's balances and Solana's simulation, which is the exact class of
     defect a direction that travels with the transfer exists to prevent. */
  if (plan.network !== "mainnet" || !isCctpDirection(plan.direction) || !isSolanaSourceDirection(plan.direction)) {
    return bridgeRefuseBeforeBurn(422, "PLAN_UNSUPPORTED", "This route serves the mainnet Solana-source lanes only.", rate);
  }
  const lane = cctpLaneFacts(plan.direction);

  const deployment = deploymentSendCapability("mainnet");
  const baseHandle = createEvmRpcHandle(lane.evmChain, { requireArchive: true });
  const safety = evaluateCctpSafety({
    /* The network's own stop, beneath the lane's. Base answers with the lane
       state exactly as before; Ethereum stays PAUSED until its own variable is
       set after the first founder-signed transfer is read back. */
    state: resolveSolanaBridgeNetworkState(lane.evmChain),
    direction: plan.direction,
    plan: cctpSafetyPlanFacts(plan),
    provider: reviewed.provider,
    simulation: reviewed.simulation,
    canaryVerdict: reviewed.canaryVerdict,
    reviewProof: parsed.data.reviewProof,
    settlementStore: deployment.settlementStore,
    independentSolanaRead: deployment.independentReadback,
    independentBaseRead: baseHandle.endpoints.length >= 2,
    recipientConfirmed: parsed.data.recipientConfirmed,
  });
  if (!canBurn(safety)) {
    return bridgeRefuseBeforeBurn(409, "BURN_NOT_PERMITTED", safety.blockedReason ?? "This burn is not permitted.", rate, {
      safety,
    });
  }

  /* The returned transaction, checked against the reviewed plan. Both
     signatures must cover the same message hash the Review named. */
  const check = checkCctpSignedBurn({ plan, signedWireBase64: parsed.data.signedTransactionBase64 });
  if (check.verdict !== "CLEARED" || !check.signature) {
    return bridgeRefuseBeforeBurn(409, `SIGNED_${check.verdict}`, check.detail, rate, {
      comparisons: check.comparisons,
    });
  }
  const signature = check.signature;

  const submitHandle = createSolanaRpcHandle({ network: "mainnet" });

  /*
   * The effect firewall for the adopted lane.
   *
   * The Review simulated the bytes this server built. When a wallet adds its
   * own guards those are different bytes, and the simulation that passed no
   * longer describes what would be broadcast. Re-simulating the exact returned
   * transaction is the only thing that does — and a Lighthouse assertion that
   * would fail is precisely the kind of thing it catches, before the burn
   * rather than after it.
   */
  if (check.lane === "WALLET_GUARDS_ONLY") {
    try {
      const adopted = await withRpcDiscipline(submitHandle, (abortSignal) =>
        submitHandle.rpc
          .simulateTransaction(parsed.data.signedTransactionBase64 as never, {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: false,
            commitment: "confirmed",
          })
          .send({ abortSignal }),
      );
      if (adopted.value.err !== null && adopted.value.err !== undefined) {
        return bridgeRefuseBeforeBurn(
          409,
          "ADOPTED_SIMULATION_FAILED",
          `The transfer your wallet returned does not succeed in simulation: ${JSON.stringify(adopted.value.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
          rate,
          { addedPrograms: check.addedPrograms },
        );
      }
    } catch (cause) {
      return bridgeRefuseBeforeBurn(
        503,
        "ADOPTED_SIMULATION_UNAVAILABLE",
        `The transfer your wallet returned could not be simulated, so what it would do is unknown: ${cause instanceof Error ? cause.message : String(cause)}`,
        rate,
      );
    }
  }

  const independent = createIndependentReadHandle(submitHandle);
  if (!independent) {
    return bridgeRefuseBeforeBurn(
      503,
      "INDEPENDENT_READ_UNAVAILABLE",
      "No second Solana operator is configured, so the burn could not be confirmed independently.",
      rate,
    );
  }

  /* Height, from the operator that will not be submitting. A blockhash that
     has already died means these bytes can never land, and finding that out
     after the boundary would hold a claim for a burn that cannot happen. */
  try {
    const height = await withRpcDiscipline(independent, (abortSignal) =>
      independent.rpc.getBlockHeight({ commitment: "confirmed" }).send({ abortSignal }),
    );
    if (BigInt(height) > BigInt(plan.lastValidBlockHeight)) {
      return bridgeRefuseBeforeBurn(
        409,
        "PLAN_EXPIRED",
        "The reviewed blockhash has expired. Return to Review and build a fresh burn.",
        rate,
      );
    }
  } catch (cause) {
    return bridgeRefuseBeforeBurn(
      503,
      "CURRENT_HEIGHT_UNAVAILABLE",
      `The current block height could not be read, so whether this burn can still land is unknown: ${cause instanceof Error ? cause.message : String(cause)}`,
      rate,
    );
  }



  const deadlineAt = Date.now() + ROUTE_DEADLINE_MS;
  const store = getGuardRuntime().store;

  /* The owner-canary budget is taken here, before anything can be broadcast,
     and only for a transfer the reviewed verdict places inside the envelope.
     A refusal at this point has burned nothing: the reservation is the last
     thing that happens before the boundary, and the boundary is the last
     thing that happens before the wire.

     The policy is resolved only when it is needed. It is read from the
     founder's own environment and resolving it can fail, so resolving it for
     every burn made his experiment configuration a precondition for a
     stranger's bridge. Outside the envelope there is no budget, no reservation
     and no ceiling — nothing a policy could decide. Inside it, an unreadable
     policy still refuses, because the ceiling it carries is what protects him
     from his own instrument. */
  let canaryPolicy: SolanaCanaryPolicy | null = null;
  let exposure: Awaited<ReturnType<typeof openCctpCanaryExposure>> = {
    kind: "OUT_OF_SCOPE",
    detail:
      "The reviewed verdict places this transfer outside the owner-canary envelope, so it does not consume the canary budget.",
  };
  if (cctpCanaryExposureNeeded(reviewed.canaryVerdict)) {
    const resolution = resolveSolanaCanaryPolicy();
    if (!resolution.ok) {
      return bridgeRefuseBeforeBurn(503, "CANARY_POLICY_UNAVAILABLE", resolution.reason, rate);
    }
    canaryPolicy = resolution.policy;
    exposure = await openCctpCanaryExposure({
      store,
      policy: canaryPolicy,
      canaryIntent: reviewed.canaryIntent,
      canaryVerdict: reviewed.canaryVerdict,
    });
    if (exposure.kind === "REFUSED") {
      return bridgeRefuseBeforeBurn(409, exposure.code, exposure.reason, rate);
    }
  }

  const settled = await withCctpBurnBoundary<BurnOutcome>({
    store,
    network: "mainnet",
    direction: plan.direction,
    intentDigest: plan.intentDigest,
    reviewDigest: parsed.data.reviewProof.digest,
    onAlreadyStarted: (record: CctpBurnClaimRecord) => ({
      ok: false as const,
      code: "BURN_ALREADY_STARTED",
      reason: `A burn for this exact transfer is already in ${record.state}. The next action is to ${cctpBurnRecovery(record).action.replaceAll("_", " ").toLowerCase()}, never to burn again.`,
      signature: record.burnSignature,
      record,
    }),
    onFailure: (failure) => ({ ok: false as const, ...failure, record: null }),
    burn: async ({ beforeBurn }) => {
      /* Before the burn claim rather than after it: if the durable canary
         marker cannot be written, this throws while the burn boundary is
         still uncrossed, so the route answers "nothing was submitted" and
         the reservation is given back below. */
      await markCctpCanarySubmitted({ store, exposure, signature });
      await beforeBurn(signature);
      let accepted: string;
      try {
        accepted = await sendTransactionOnce({
          handle: submitHandle,
          signedWireBase64: parsed.data.signedTransactionBase64,
          deadlineAt,
        });
      } catch (cause) {
        if (cause instanceof SolanaSubmitRpcError) {
          /* A proven rejection. The cluster answered and refused, so nothing
             was burned — but the claim is not released: these bytes are known
             and the record says what happened to them. */
          throw new Error(`The cluster rejected the burn: ${cause.message}`);
        }
        throw cause;
      }
      if (accepted !== signature) {
        throw new Error(
          `The RPC returned ${accepted}, but the locally verified transaction id is ${signature}. Recover the local id; never resubmit these bytes.`,
        );
      }

      /* Confirmation is read from the independent operator, bounded, and a
         landed-but-failed transaction is still confirmed — the error travels
         with it rather than becoming a throw. */
      let confirmed: { status: "CONFIRMED" | "PENDING"; slot: string | null; err: unknown } = {
        status: "PENDING",
        slot: null,
        err: null,
      };
      for (let attempt = 0; attempt < CONFIRM_ATTEMPTS && Date.now() < deadlineAt; attempt += 1) {
        try {
          const statuses = await withRpcDiscipline(independent, (abortSignal) =>
            independent.rpc
              .getSignatureStatuses([signature as never], { searchTransactionHistory: true })
              .send({ abortSignal }),
          );
          const status = statuses.value[0];
          if (status) {
            confirmed = { status: "CONFIRMED", slot: String(status.slot), err: status.err ?? null };
            break;
          }
        } catch {
          /* An unreadable status is not an unlanded transaction. Keep asking
             until the deadline; never conclude absence from silence. */
        }
        await new Promise((resolve) => setTimeout(resolve, CONFIRM_INTERVAL_MS));
      }

      if (confirmed.status === "CONFIRMED" && confirmed.err === null) {
        await markCctpBurnConfirmed({ store, network: "mainnet", intentDigest: plan.intentDigest });
      } else if (confirmed.status === "CONFIRMED" && confirmed.err !== null) {
        /* Landed and failed: nothing was burned and no CCTP message exists.
           This is the one state from which a fresh burn is not a duplicate,
           and it is recorded with the signature that proves it. */
        await markCctpBurnReverted({ store, network: "mainnet", intentDigest: plan.intentDigest, signature });
      }

      /* The wallet's own history. The claim this lane compare-and-sets on
         hashes the owner into its key one way and keeps no address, so it can
         never be listed for a person; this row can. The mint is not named
         because this lane carries native USDC and nothing else — a field that
         could only ever hold one value is not a fact worth storing. */
      await recordSolanaAction(store, {
        network: "mainnet",
        wallet: plan.owner,
        actionId: plan.intentDigest,
        lane: "BRIDGE",
        outcome: confirmed.status === "CONFIRMED" && confirmed.err !== null ? "FAILED" : "IN_FLIGHT",
        out: { mint: null, amountRaw: plan.amountRaw, decimals: 6, symbol: "USDC" },
        destination: lane.evmChain === "ethereum" ? "ETHEREUM" : "BASE",
        signature,
        now: new Date().toISOString(),
      });

      return {
        ok: true as const,
        signature,
        confirmation: confirmed.status,
        slot: confirmed.slot,
        landedError: confirmed.err === null ? null : JSON.stringify(confirmed.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
        intentDigest: plan.intentDigest,
        lane: check.lane,
        addedPrograms: check.addedPrograms,
        observedBy: independent.endpoints[0].host,
      };
    },
  });

  /* What the chains said, translated into what the budget may do. Only a
     clean confirmation books a spend; only a proven non-event gives the
     reservation back; everything else holds. */
  const canaryOutcome: CctpCanaryOutcome = settled.ok
    ? settled.confirmation === "CONFIRMED" && settled.landedError === null
      ? { kind: "CONFIRMED_CLEAN", signature: settled.signature }
      : settled.confirmation === "CONFIRMED"
        ? { kind: "CONFIRMED_REVERTED", signature: settled.signature }
        : { kind: "UNDETERMINED" }
    : settled.code === "CCTP_BURN_FAILED_BEFORE_BOUNDARY"
      ? { kind: "NEVER_SUBMITTED" }
      : { kind: "UNDETERMINED" };
  /* Nothing to settle when nothing was opened, and no policy to settle it with:
     the same answer the module gives for an out-of-scope exposure, said once. */
  const canaryBudget = canaryPolicy
    ? await settleCctpCanaryExposure({
        store,
        policy: canaryPolicy,
        exposure,
        outcome: canaryOutcome,
      })
    : CCTP_CANARY_NOT_IN_SCOPE;

  if (!settled.ok) {
    const status = settled.code === "CCTP_BURN_UNKNOWN" ? 202 : 409;
    return Response.json(
      {
        error: {
          code: settled.code,
          message: settled.reason,
          signature: settled.signature,
          burnBoundary: settled.code === "CCTP_BURN_FAILED_BEFORE_BOUNDARY" ? "NOT_CROSSED" : "CROSSED",
          canaryBudget,
        },
      },
      { status, headers: bridgeHeaders(rate) },
    );
  }

  return Response.json({ data: { ...settled, canaryBudget } }, { headers: bridgeHeaders(rate) });
}
