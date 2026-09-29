import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { baseRpcCall, createEvmRpcHandle, hexQuantityToDecimal, type EvmChainId, type EvmRpcHandle } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { recordSolanaAction } from "@/lib/solana/action-ledger";
import { mutationOriginAllowed } from "@/lib/security";
import { cctpLaneFacts, isCctpDirection, isEvmSourceDirection } from "@/lib/solana/cctp-direction";
import { resolveSolanaBridgeNetworkState } from "@/lib/solana/lane-state";
import { bridgeHeaders, bridgeRefuseBeforeBurn, describeBridgeIssues } from "@/lib/solana/bridge-http";
import {
  cctpBurnRecovery,
  claimCctpBurn,
  markCctpBurnConfirmed,
  markCctpBurnNeverBroadcast,
  markCctpBurnReverted,
  markCctpBurnSubmitted,
  markCctpSourceArmed,
  readCctpBurnClaim,
} from "@/lib/solana/cctp-burn-claim";
import { resolveSolanaCanaryPolicy } from "@/lib/solana/canary-policy";
import { canaryFlowPermitted, readCanaryFlow, resolveCanaryRuntime } from "@/lib/solana/canary-runtime";
import {
  CCTP_CANARY_NOT_IN_SCOPE,
  cctpCanaryExposureNeeded,
  openCctpCanaryExposure,
  resumeCctpCanaryExposure,
  settleCctpCanaryExposure,
} from "@/lib/solana/cctp-canary-exposure";
import { canBurn, evaluateCctpSafety } from "@/lib/solana/cctp-safety";
import { verifyCctpReviewProof, CctpReviewProofSchema } from "@/lib/solana/cctp-review-proof";
import { createSolanaRpcHandle } from "@/lib/solana/rpc";
import { deploymentSendCapability } from "@/lib/solana/send-deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const RECEIPT_ATTEMPTS = 30;
const RECEIPT_INTERVAL_MS = 1_500;
const ROUTE_DEADLINE_MS = 50_000;

/**
 * The only route that can arm a Base burn — and the shape of it is set by how
 * an EVM wallet works rather than by preference.
 *
 * On Solana the browser signs and hands back finished bytes, so the server can
 * inspect them, cross the duplicate-burn boundary and broadcast, all in one
 * request. `eth_sendTransaction` signs *and sends*: there is no moment between
 * the person approving and the money leaving for a server to hold a claim in.
 *
 * So the boundary is crossed **before** the wallet opens, in `ARM`, and the
 * transaction is reported afterwards in `RECORD`. That ordering is deliberate
 * and it is the conservative one: a claim held for a burn that never happened
 * is an inconvenience, and a second real burn is not.
 *
 * `ABANDON` is the way back, and it is the only one. It releases the claim when
 * — and only when — the chain says the source account's pending transaction
 * count is exactly what it was when the claim was armed. A wallet that was
 * declined sent nothing and the count is unchanged; a wallet that sent
 * something moved it, and the claim stays held and is resolved by reading. The
 * client's own account of what happened decides nothing here, because a client
 * that could release its own boundary could burn twice.
 */

const PlanSchema = z.object({}).passthrough();

const BundleSchema = z
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
  .strict();

const ArmSchema = z
  .object({
    phase: z.literal("ARM"),
    bundle: BundleSchema,
    reviewProof: CctpReviewProofSchema,
    recipientConfirmed: z.boolean().default(false),
  })
  .strict();

const RecordSchema = z
  .object({
    phase: z.literal("RECORD"),
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
    transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  })
  .strict();

const AbandonSchema = z
  .object({
    phase: z.literal("ABANDON"),
    intentDigest: z.string().regex(/^0x[0-9a-f]{64}$/),
  })
  .strict();

const RequestSchema = z.discriminatedUnion("phase", [ArmSchema, RecordSchema, AbandonSchema]);

type BasePlan = import("@/lib/base/cctp-burn").BaseBurnPlan;

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return bridgeRefuseBeforeBurn(429, "RATE_LIMITED", "Too many requests.", rate);

  /* An owner canary may not run while its own policy is unreadable, and the
     flow is declared by the caller rather than inferred from a verdict that
     reads outside the envelope under a closed fallback. Checked before the body
     is parsed, for the same reason the Solana burn route checks it there: a
     refusal reachable only by a caller already holding a signed bundle is a
     refusal nobody can verify. */
  const flowPermitted = canaryFlowPermitted(resolveCanaryRuntime(), readCanaryFlow(request.headers));
  if (!flowPermitted.ok) {
    return bridgeRefuseBeforeBurn(503, flowPermitted.code, flowPermitted.reason, rate);
  }
  if (!mutationOriginAllowed(request.url, request.headers.get("origin"), request.headers.get("sec-fetch-site"))) {
    return bridgeRefuseBeforeBurn(403, "FORBIDDEN_ORIGIN", "The bridge burn must be requested from this site.", rate);
  }
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeRefuseBeforeBurn(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeRefuseBeforeBurn(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);

  const store = getGuardRuntime().store;
  /* The EVM chain is not known until the phase has read its own source of
     truth — the signed plan in ARM, the durable claim in RECORD and ABANDON —
     so each phase asks for its handle by chain rather than being handed Base. */
  const handleFor = (chain: EvmChainId): EvmRpcHandle => createEvmRpcHandle(chain, { requireArchive: true });

  if (parsed.data.phase === "ARM") return arm({ input: parsed.data, store, handleFor, rate, request });
  if (parsed.data.phase === "RECORD") return record({ input: parsed.data, store, handleFor, rate });
  return abandon({ input: parsed.data, store, handleFor, rate });
}

async function arm(args: {
  input: z.output<typeof ArmSchema>;
  store: ReturnType<typeof getGuardRuntime>["store"];
  handleFor: (chain: EvmChainId) => EvmRpcHandle;
  rate: ReturnType<typeof consumeAgentControlRequest>;
  request: Request;
}) {
  const { input, store, handleFor, rate } = args;
  const issuerKey = loadIssuerKey();
  if (!issuerKey) {
    return bridgeRefuseBeforeBurn(
      503,
      "REVIEW_PROOF_UNAVAILABLE",
      "This deployment has no document-signing key, so it cannot verify the exact bridge Review before a burn.",
      rate,
    );
  }
  const proofCheck = verifyCctpReviewProof({
    bundle: input.bundle as never,
    proof: input.reviewProof,
    trustedPublicKey: issuerKey.publicKey,
  });
  if (!proofCheck.ok) return bridgeRefuseBeforeBurn(409, "REVIEW_PROOF_REFUSED", proofCheck.reason, rate);

  const reviewed = input.bundle as unknown as {
    plan: BasePlan;
    provider: import("@/lib/solana/cctp-provider").CctpProviderSnapshot;
    simulation: { status: "PRESENT" | "SKIPPED"; succeeded: boolean; error: string | null };
    canaryIntent: unknown;
    canaryVerdict: import("@/lib/solana/canary-policy").SolanaCanaryVerdict;
  };
  const plan = reviewed.plan;
  if (plan.network !== "mainnet" || !isCctpDirection(plan.direction) || !isEvmSourceDirection(plan.direction)) {
    return bridgeRefuseBeforeBurn(422, "PLAN_UNSUPPORTED", "This route serves the mainnet EVM-source lanes only.", rate);
  }
  const lane = cctpLaneFacts(plan.direction);
  const handle = handleFor(lane.evmChain);

  const deployment = deploymentSendCapability("mainnet");
  const solanaHandle = createSolanaRpcHandle({ network: "mainnet" });
  const safety = evaluateCctpSafety({
    /* The network's own stop beneath the lane's: Base reads the lane state as
       it always has, Ethereum stays PAUSED until its own variable says OPEN. */
    state: resolveSolanaBridgeNetworkState(lane.evmChain),
    direction: plan.direction,
    plan: { maxFeeRaw: plan.maxFeeRaw, protocolFeeRaw: plan.protocolFeeRaw, allowance: plan.allowance },
    provider: reviewed.provider,
    simulation: reviewed.simulation,
    canaryVerdict: reviewed.canaryVerdict,
    reviewProof: input.reviewProof,
    settlementStore: deployment.settlementStore,
    independentSolanaRead: deployment.independentReadback,
    independentBaseRead: handle.endpoints.length >= 2,
    recipientConfirmed: input.recipientConfirmed,
  });
  if (!canBurn(safety)) {
    return bridgeRefuseBeforeBurn(409, "BURN_NOT_PERMITTED", safety.blockedReason ?? "This burn is not permitted.", rate, {
      safety,
    });
  }
  /* The permission and the burn are two different questions and this route only
     answers the second. A plan whose allowance is short cannot reach here — the
     gate above returns REVIEW for it — and the card sends the approval itself,
     which moves nothing and needs no boundary. */
  if (!plan.allowance.sufficient) {
    return bridgeRefuseBeforeBurn(
      409,
      "APPROVAL_REQUIRED",
      "Circle does not yet have permission to move this much USDC from this wallet.",
      rate,
    );
  }
  const burnCall = plan.calls.find((call) => call.purpose === "BURN");
  if (!burnCall || !burnCall.data) {
    return bridgeRefuseBeforeBurn(422, "PLAN_UNSUPPORTED", "The reviewed plan carries no transfer to send.", rate);
  }

  /* The count the release test will compare against, read before anything is
     armed. It is the only thing that can later prove the wallet sent nothing. */
  const countRead = await baseRpcCall<string>(handle, "eth_getTransactionCount", [plan.owner, "pending"]);
  const sourceAccountNonce = countRead.ok ? hexQuantityToDecimal(countRead.value) : null;
  if (sourceAccountNonce === null) {
    return bridgeRefuseBeforeBurn(
      503,
      "SOURCE_ACCOUNT_UNREADABLE",
      `This wallet's current position on ${lane.source.label} could not be read, and without it a declined transfer could not be told apart from a sent one.`,
      rate,
    );
  }

  const at = new Date().toISOString();
  const claimed = await claimCctpBurn({
    store,
    network: "mainnet",
    direction: plan.direction,
    intentDigest: plan.intentDigest,
    reviewDigest: input.reviewProof.digest,
    sourceAccount: plan.owner,
    sourceAccountNonce,
    at,
  });
  if (!claimed.ok) {
    const record = claimed.record ?? null;
    return bridgeRefuseBeforeBurn(
      409,
      claimed.code,
      record
        ? `A transfer for this exact request is already in ${record.state}. The next action is to ${cctpBurnRecovery(record).action.replaceAll("_", " ").toLowerCase()}, never to send it again.`
        : claimed.reason,
      rate,
      record ? { claim: { state: record.state, transactionHash: record.burnSignature } } : undefined,
    );
  }

  /* The owner-canary budget, taken here and only for a transfer the reviewed
     verdict places inside the envelope. Outside it there is no reservation and
     no ceiling — nothing a policy could decide. */
  let canaryBudget: unknown = CCTP_CANARY_NOT_IN_SCOPE;
  let canaryIdempotencyKey: string | null = null;
  if (cctpCanaryExposureNeeded(reviewed.canaryVerdict)) {
    const resolution = resolveSolanaCanaryPolicy();
    if (!resolution.ok) {
      return bridgeRefuseBeforeBurn(503, "CANARY_POLICY_UNAVAILABLE", resolution.reason, rate);
    }
    const exposure = await openCctpCanaryExposure({
      store,
      policy: resolution.policy,
      canaryIntent: reviewed.canaryIntent,
      canaryVerdict: reviewed.canaryVerdict,
    });
    if (exposure.kind === "REFUSED") {
      return bridgeRefuseBeforeBurn(409, exposure.code, exposure.reason, rate);
    }
    if (exposure.kind !== "OUT_OF_SCOPE") canaryIdempotencyKey = exposure.idempotencyKey;
    canaryBudget = { reserved: exposure.kind };
  }

  /* The key travels with the claim rather than with this request. The outcome
     of this burn arrives in a later one, and a reservation whose key was lost
     between the two would be held for ever against a burn everybody can see
     confirmed. */
  const armed = await markCctpSourceArmed({
    store,
    network: "mainnet",
    intentDigest: plan.intentDigest,
    sourceAccount: plan.owner,
    sourceAccountNonce,
    destinationWallet: plan.destinationOwner,
    canaryIdempotencyKey,
  });
  if (!armed.ok) {
    return bridgeRefuseBeforeBurn(
      503,
      "BURN_BOUNDARY_UNAVAILABLE",
      `The durable transfer marker could not be written, so nothing was armed: ${armed.reason}`,
      rate,
    );
  }

  return Response.json(
    {
      data: {
        armed: true,
        intentDigest: plan.intentDigest,
        call: { to: burnCall.to, data: burnCall.data, from: plan.owner },
        sourceAccountNonce,
        safety,
        canaryBudget,
        /* Named here so the surface never has to reconstruct it: from this
           moment the boundary is crossed, and the only way back is the chain
           saying nothing left this account. */
        boundary: "CROSSED",
        solanaReadBy: solanaHandle.endpoints[0].host,
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}

async function record(args: {
  input: z.output<typeof RecordSchema>;
  store: ReturnType<typeof getGuardRuntime>["store"];
  handleFor: (chain: EvmChainId) => EvmRpcHandle;
  rate: ReturnType<typeof consumeAgentControlRequest>;
}) {
  const { input, store, handleFor, rate } = args;
  const transactionHash = input.transactionHash.toLowerCase();
  const claim = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: input.intentDigest });
  if (!claim.ok) return bridgeRefuseBeforeBurn(409, claim.code, claim.reason, rate);
  if (!isEvmSourceDirection(claim.record.direction)) {
    return bridgeRefuseBeforeBurn(409, "DIRECTION_MISMATCH", "That transfer does not start on an EVM chain.", rate);
  }
  /* The chain is the claim's, read from the direction it was armed under. */
  const lane = cctpLaneFacts(claim.record.direction);
  const handle = handleFor(lane.evmChain);
  if (claim.record.burnSignature !== null && claim.record.burnSignature !== transactionHash) {
    return bridgeRefuseBeforeBurn(
      409,
      "BURN_SIGNATURE_MISMATCH",
      "A different transaction is already recorded for this transfer. Nothing was changed.",
      rate,
    );
  }

  const marked = await markCctpBurnSubmitted({
    store,
    network: "mainnet",
    intentDigest: input.intentDigest,
    signature: transactionHash,
  });
  if (!marked.ok) return bridgeRefuseBeforeBurn(409, marked.code, marked.reason, rate);

  /* Bounded, and a reverted transaction is still a confirmed one — the error
     travels with it rather than becoming a refusal. */
  const deadlineAt = Date.now() + ROUTE_DEADLINE_MS;
  let status: "CONFIRMED" | "PENDING" = "PENDING";
  let blockNumber: string | null = null;
  let succeeded: boolean | null = null;
  for (let attempt = 0; attempt < RECEIPT_ATTEMPTS && Date.now() < deadlineAt; attempt += 1) {
    const receipt = await baseRpcCall<{ status?: string; blockNumber?: string } | null>(
      handle,
      "eth_getTransactionReceipt",
      [transactionHash],
    );
    if (receipt.ok && receipt.value) {
      status = "CONFIRMED";
      blockNumber = hexQuantityToDecimal(receipt.value.blockNumber);
      succeeded = String(receipt.value.status ?? "").toLowerCase() === "0x1";
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, RECEIPT_INTERVAL_MS));
  }

  if (status === "CONFIRMED" && succeeded === true) {
    await markCctpBurnConfirmed({ store, network: "mainnet", intentDigest: input.intentDigest });
  } else if (status === "CONFIRMED" && succeeded === false) {
    /* Landed and reverted: no USDC left the account and no CCTP message exists.
       This is the one state from which a fresh transfer is not a duplicate. */
    await markCctpBurnReverted({
      store,
      network: "mainnet",
      intentDigest: input.intentDigest,
      signature: transactionHash,
    });
  }

  /* The person's own History. Written against the Solana wallet the money is
     arriving in, because that is the wallet this workspace is scoped to and the
     one whose History has to show a transfer on its way. The row exists from the
     moment the burn is known rather than when it completes: money that has left
     one chain and not yet reached the other has to be visible as exactly that. */
  if (claim.record.destinationWallet) {
    await recordSolanaAction(store, {
      network: "mainnet",
      wallet: claim.record.destinationWallet,
      actionId: input.intentDigest,
      lane: "BRIDGE",
      outcome: status === "CONFIRMED" && succeeded === false ? "FAILED" : "IN_FLIGHT",
      destination: "SOLANA",
      /* No signature here, and that is the fix rather than an omission.
         `transactionHash` on this lane is a Base hash — `0x…` — and this field
         holds a Solana signature, which is base58 and cannot contain `0`. The
         row therefore failed its own schema, `recordSolanaAction` swallowed the
         failure as its contract requires, and **no in-flight row was ever
         written for a Base → Solana transfer**. Read from production on
         2026-09-04: the only row either reverse transfer had was the terminal
         one, which is why History could not name the direction and why money in
         motion this way was invisible while it moved.

         The Solana signature does not exist yet at this point in the transfer —
         the mint has not happened — so leaving the field empty is also the
         honest answer. It is filled by `bridge/receipt` when the mint lands. */
      now: new Date().toISOString(),
    });
  }

  const settlement = await settleCanary({
    store,
    canaryIdempotencyKey: claim.record.canaryIdempotencyKey,
    outcome:
      status === "CONFIRMED" && succeeded === true
        ? { kind: "CONFIRMED_CLEAN", signature: transactionHash }
        : status === "CONFIRMED"
          ? { kind: "CONFIRMED_REVERTED", signature: transactionHash }
          : { kind: "UNDETERMINED" },
  });

  return Response.json(
    {
      data: {
        recorded: true,
        transactionHash,
        confirmation: status,
        blockNumber,
        landedError: status === "CONFIRMED" && succeeded === false ? `The transfer reverted on ${lane.source.label}.` : null,
        intentDigest: input.intentDigest,
        canaryBudget: settlement,
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}

async function abandon(args: {
  input: z.output<typeof AbandonSchema>;
  store: ReturnType<typeof getGuardRuntime>["store"];
  handleFor: (chain: EvmChainId) => EvmRpcHandle;
  rate: ReturnType<typeof consumeAgentControlRequest>;
}) {
  const { input, store, handleFor, rate } = args;
  const claim = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: input.intentDigest });
  if (!claim.ok) return bridgeRefuseBeforeBurn(409, claim.code, claim.reason, rate);
  if (!isEvmSourceDirection(claim.record.direction)) {
    return bridgeRefuseBeforeBurn(409, "DIRECTION_MISMATCH", "That transfer does not start on an EVM chain.", rate);
  }
  const lane = cctpLaneFacts(claim.record.direction);
  const handle = handleFor(lane.evmChain);
  const account = claim.record.sourceAccount;
  if (!account) {
    return bridgeRefuseBeforeBurn(
      409,
      "RELEASE_NOT_ESTABLISHED",
      "This transfer has no source account recorded, so nothing here can prove it was never sent.",
      rate,
    );
  }

  const countRead = await baseRpcCall<string>(handle, "eth_getTransactionCount", [account, "pending"]);
  const observedNonce = countRead.ok ? hexQuantityToDecimal(countRead.value) : null;
  if (observedNonce === null) {
    return bridgeRefuseBeforeBurn(
      503,
      "SOURCE_ACCOUNT_UNREADABLE",
      `${lane.source.label} could not be asked whether this wallet has sent anything, so the transfer stays recorded as possibly under way.`,
      rate,
    );
  }

  const released = await markCctpBurnNeverBroadcast({
    store,
    network: "mainnet",
    intentDigest: input.intentDigest,
    observedNonce,
  });
  if (!released.ok) {
    const current = await readCctpBurnClaim({ store, network: "mainnet", intentDigest: input.intentDigest });
    return Response.json(
      {
        data: {
          released: false,
          reason:
            `This wallet has sent something on ${lane.source.label} since the transfer was prepared, so it stays recorded as possibly under way and is resolved by reading rather than by sending again.`,
          claim: current.ok ? { state: current.record.state, recovery: cctpBurnRecovery(current.record) } : null,
        },
      },
      { headers: bridgeHeaders(rate) },
    );
  }

  const settlement = await settleCanary({
    store,
    canaryIdempotencyKey: claim.record.canaryIdempotencyKey,
    outcome: { kind: "NEVER_SUBMITTED" },
  });
  return Response.json(
    {
      data: {
        released: true,
        state: released.record.state,
        canaryBudget: settlement,
      },
    },
    { headers: bridgeHeaders(rate) },
  );
}

/**
 * Settle the owner-canary reservation this transfer's first step took, if it
 * took one.
 *
 * The key is read from the durable claim rather than rebuilt, because rebuilding
 * it would mean re-deriving an intent from a request that does not carry one —
 * and a reservation settled against a guess is worse than one left held. A
 * transfer outside the envelope has no key and settles nothing, which is the
 * same answer said the same way.
 */
async function settleCanary(args: {
  store: ReturnType<typeof getGuardRuntime>["store"];
  canaryIdempotencyKey: string | null;
  outcome: Parameters<typeof settleCctpCanaryExposure>[0]["outcome"];
}) {
  const exposure = resumeCctpCanaryExposure(args.canaryIdempotencyKey);
  if (exposure.kind !== "CLAIMED") return CCTP_CANARY_NOT_IN_SCOPE;
  const resolution = resolveSolanaCanaryPolicy();
  if (!resolution.ok) {
    /* A reservation that cannot be settled stays held. That overstates what the
       owner has spent, which is the safe direction to be wrong in. */
    return {
      action: "HELD" as const,
      detail: "The owner-canary policy could not be read, so this reservation stays exactly where it is.",
      failure: resolution.reason,
    };
  }
  return settleCctpCanaryExposure({
    store: args.store,
    policy: resolution.policy,
    exposure,
    outcome: args.outcome,
  });
}
