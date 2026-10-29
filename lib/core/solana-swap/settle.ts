/**
 * A Solana swap, from the signed bytes to the receipt — the `settle` half of
 * the intent pipeline.
 *
 *     signed guard → submit once → chain status → observe → receipt
 *       → history and fee → rewards → receipt closed
 *
 * The venue's managed lane (`/execute`) for bytes the wallet signed unchanged,
 * the deployment's own RPC for a wallet's guarded change of them; exactly one
 * send either way, behind the send-attempt boundary and the owner lock, and
 * afterwards only independent reads by signature — never a second send.
 *
 * Every answer is the one the execute route gave when these steps were written
 * inline in it: the same status, code, words and body.
 */

import { recordOperationPoints } from "../../points/record.server.ts";
import { bindReferrer } from "../../rewards/ledger.ts";
import { recordOperationRewards } from "../../rewards/record.server.ts";
import { normalizeReferralCode } from "../../rewards/referral.ts";
import { swapFeePrice } from "../../rewards/swap-settlement.ts";
import { recordPlanExecution } from "../../plans/service.ts";
import { actionFeeFromServiceFee, recordSolanaAction } from "../../solana/action-ledger.ts";
import { statedUsdOf } from "../../solana/action-value.ts";
import type { JupiterExecuteResult } from "../../solana/quotes.ts";
import { transitionSendAttempt, withSendAttemptBoundary } from "../../solana/send-attempt.ts";
import type { SwapExecutionBundle } from "../../solana/swap-execution-review.ts";
import { observeSwap, serviceFeeReadFor } from "../../solana/swap-observe.ts";
import { completeSwapOwnerLock, failSwapOwnerLock, markSwapOwnerSubmitted } from "../../solana/swap-owner-lock.ts";
import { mintSwapOutcomeReceipt } from "../../solana/swap-outcome.ts";
import { buildSwapReceiptFacts, type SwapReceiptFacts } from "../../solana/swap-receipt.ts";
import { resolveServiceFeeConfig } from "../../swap/service-fee.server.ts";
import { createSolanaNetwork, type SolanaNetwork } from "../networks/solana.ts";
import { definePipeline, NEXT, need, runPipeline, type PipelineRun, type PipelineStep, type StepResult } from "../pipeline.ts";
import { createJupiterSwapVenue } from "../venues/jupiter.ts";
import { awaitLanding } from "../../solana/landing.ts";
import { resendSameTransaction } from "../../solana/submit-rpc.ts";
import { SOLANA_SWAP_SIGNED_GUARD, type SwapSignedGuardContext } from "./guard.ts";
import type { SwapRefusal, SwapSettleStop } from "./refusal.ts";

/**
 * How long this deployment's own broadcast is read — and its same bytes sent
 * again (SOL-S1, `landing.ts`) — until an operator sees it.
 *
 * The bytes' blockhash dies inside this (~30 s from the build, part of it
 * spent before the wallet answered), and the route itself may run for 60
 * seconds, so this leaves room for the reads and the Receipt that follow. A
 * transaction still unseen after it is genuinely unresolved, and recovery by
 * signature — which the card now runs by itself — is then the honest answer.
 */
const ADOPTED_CONFIRM_DEADLINE_MS = 30_000;

/**
 * How long a venue "Failed" waits for the independent operator.
 *
 * The venue answers after it has watched the transaction, and its "Failed"
 * reads the same whether the bytes landed and failed or never landed. The
 * independent operator is often a slot behind it. A few seconds let it say
 * which, so a landed failure settles here and frees the wallet at once rather
 * than waiting for someone to press «Check transaction».
 */
const VENUE_FAILED_SEEN_DEADLINE_MS = 6_000;

type SettleOutcome = Readonly<{
  kind: "EXECUTED" | "AMBIGUOUS";
  /** Null on the adopted lane: this deployment broadcast, not the venue. */
  report: JupiterExecuteResult | null;
  broadcastFailure: string | null;
  /** Our own send was answered with an RPC refusal (preflight): sending the same bytes again cannot help (SOL-S1). */
  broadcastRejected?: boolean;
}>;

type Observed = Extract<Awaited<ReturnType<typeof observeSwap>>, { ok: true }>;

export type SwapSettleContext = SwapSignedGuardContext & {
  outcome: SettleOutcome | null;
  finality: "confirmed" | "finalized";
  observed: Observed | null;
  facts: SwapReceiptFacts | null;
  factsRefusal: string | null;
  receipt: Extract<ReturnType<typeof mintSwapOutcomeReceipt>, { ok: true }>["receipt"] | null;
  /** The one clock reading the Receipt, the history row and the rewards share. */
  at: string | null;
  network: SolanaNetwork | null;
  swapRow: Awaited<ReturnType<typeof recordSolanaAction>> | null;
  /** The invitation code a browser carries (the `rref` cookie), or null; it binds the taker at this trade. */
  referralCode: string | null;
  /** The final answer, set by the last step. */
  answer: Readonly<{ status: number; body: Record<string, unknown> }> | null;
};

const refusal = (status: number, code: string, message: string, extra?: object): StepResult<SwapSettleStop> => ({
  stop: { kind: "refusal", refusal: { status, code, message, ...(extra ? { extra } : {}) } },
});
const answer = (status: number, body: Record<string, unknown>): StepResult<SwapSettleStop> => ({
  stop: { kind: "answer", answer: { status, body } },
});

/**
 * The builder's own comparisons, run ahead so MATCHED is asserted, not hoped.
 *
 * MATCHED means the chain did what the reviewed order said it would: the same
 * input left, the fees were the reviewed fees, and what arrived met the stated
 * minimum. It does not mean the output equalled the quote to the raw unit —
 * an AMM price moves between the quote and the block, and demanding exact
 * equality labelled every honest swap a deviation, including the ones that
 * filled in the signer's favour. Receiving less than the minimum is the real
 * deviation and is still recorded as one.
 */
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

/** The guard after the wallet, re-typed for this pipeline's stop. */
const signedGuard = SOLANA_SWAP_SIGNED_GUARD.map(
  (step): PipelineStep<SwapSettleContext, SwapSettleStop> => ({
    stage: step.stage,
    name: step.name,
    async run(context) {
      const result = await step.run(context);
      return "stop" in result ? { stop: { kind: "refusal", refusal: result.stop } } : NEXT;
    },
  }),
);

/* ---------------------------------------------------------------- submit */

/** The lane the signed bytes go out by: `/build`'s and a wallet's guarded change both through this deployment's own RPC, `/order`'s through `/execute`. */
export function submissionLaneOf(context: Pick<SwapSettleContext, "bundle" | "adoptedLane">): "JUPITER_EXECUTE" | "ADOPTED_RPC" | "BUILD_OWN_RPC" {
  if (context.bundle.review.quote.path === "BUILD_SUBMIT") return "BUILD_OWN_RPC";
  return context.adoptedLane ? "ADOPTED_RPC" : "JUPITER_EXECUTE";
}

/**
 * Exactly one send, behind the send-attempt boundary and with the owner lock
 * crossed into submit-unknown first. Adopted bytes and `/build`'s cannot go to the venue's
 * execute lane — it accepts only the transaction it built — so they go once
 * through this deployment's own RPC.
 */
const submitOnce: PipelineStep<SwapSettleContext, SwapSettleStop> = {
  stage: "submit",
  name: "submit-once",
  async run(context) {
    const { bundle, proof, signedTransactionBase64 } = context;
    const quote = bundle.review.quote;
    const lane = submissionLaneOf(context);
    const store = need(context.store, "store");
    const signature = need(context.signature, "signature");
    const network = createSolanaNetwork({ submitHandle: need(context.submitHandle, "submitHandle"), readHandle: need(context.independent, "independent") });
    const venue = createJupiterSwapVenue({ endpoint: need(context.endpoint, "endpoint"), referral: null, config: resolveServiceFeeConfig() });
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
          submissionLane: lane,
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
        if (lane !== "JUPITER_EXECUTE") {
          const submission = await network.submit({ network: "solana", wireBase64: signedTransactionBase64, signature }, "fast");
          return submission.state === "SENT"
            ? ({ kind: "EXECUTED", report: null, broadcastFailure: null } as const)
            : ({ kind: "AMBIGUOUS", report: null, broadcastFailure: submission.reason, broadcastRejected: submission.rejected === true } as const);
        }
        const report = await venue.execute(signedTransactionBase64, quote.requestId);
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
      return refusal(409, boundaryResult.code, boundaryResult.reason, { signature: boundaryResult.signature });
    }
    context.outcome = boundaryResult as SettleOutcome;
    context.network = network;
    return NEXT;
  },
};

/* ---------------------------------------------------------------- settle */

/**
 * Did the bytes reach the network, and does an independent operator see them?
 * From here on the bytes may be on the network: everything reads, nothing
 * sends again.
 */
const chainStatus: PipelineStep<SwapSettleContext, SwapSettleStop> = {
  stage: "settle",
  name: "chain-status",
  async run(context) {
    const { report, broadcastFailure, broadcastRejected } = need(context.outcome, "outcome");
    /* Bytes this deployment broadcast itself — `/build`'s, or a wallet's guarded change — wait for their own landing. */
    const ownBroadcast = submissionLaneOf(context) !== "JUPITER_EXECUTE";
    const network = need(context.network, "network");
    const store = need(context.store, "store");
    const signature = need(context.signature, "signature");
    /* Both lanes answer the same question: did the bytes reach the network? */
    const delivered = report ? report.ok : broadcastFailure === null;

    let settlement = await network.observe(signature);
    let seen = settlement.state !== "NOT_SEEN";

    /*
     * Wait for the adopted lane's own broadcast to land.
     *
     * The venue's execute call confirms before it answers. A send through the
     * deployment's own RPC returns the moment a cluster accepts the bytes,
     * which is several seconds before any node will admit to seeing the
     * signature — so reading the status immediately answered "not seen", and a
     * person whose swap was simply still confirming was handed a recovery
     * button for an ordinary success. This is the same wait, against the
     * independent operator rather than the one that took the bytes.
     *
     * SOL-S1: read every 0.5 s rather than 1.5 s, and on our own broadcast send
     * the same signed bytes again every 2 s until they are seen — also when the
     * first send did not answer, because the bytes may simply not have arrived;
     * not when the RPC refused them (preflight), which a same send repeats.
     * The same signature lands at most once; a send the cluster would refuse is
     * refused by preflight and never forwarded (`landing.ts`).
     */
    const venueFailed = report?.ok === true && report.report.status === "Failed";
    if (!seen && ((ownBroadcast && broadcastRejected !== true) || venueFailed)) {
      const submitHandle = need(context.submitHandle, "submitHandle");
      const landed = await awaitLanding(
        {
          observe: async () => {
            const read = await network.observe(signature);
            return { seen: read.state !== "NOT_SEEN", settlement: read };
          },
          resend: () => (ownBroadcast ? resendSameTransaction({ handle: submitHandle, signedWireBase64: context.signedTransactionBase64 }) : Promise.resolve()),
        },
        {
          deadlineMs: ownBroadcast ? ADOPTED_CONFIRM_DEADLINE_MS : VENUE_FAILED_SEEN_DEADLINE_MS,
          initial: { seen: false, settlement },
          ...(ownBroadcast ? {} : { resendEveryMs: Number.POSITIVE_INFINITY }),
        },
      );
      settlement = landed.last.settlement;
      seen = landed.last.seen;
    }

    if (!delivered && !seen) {
      return answer(202, {
        state: "SUBMITTED_UNKNOWN",
        signature,
        report: null,
        providerFailure:
          report && !report.ok
            ? { code: report.code, reason: report.reason }
            : { code: "BROADCAST_UNANSWERED", reason: broadcastFailure ?? "The broadcast did not answer." },
        recovery:
          "The submit did not answer and the chain has not shown the signature yet. The attempt stays reserved; recover by reading the signature — never by executing again.",
      });
    }

    if (report?.ok && report.report.status === "Failed" && !seen) {
      await transitionSendAttempt({
        store,
        network: "mainnet",
        signature,
        to: "RECOVERY_REQUIRED",
        at: new Date().toISOString(),
      });
      return refusal(409, "EXECUTE_FAILED", `Jupiter reported ${report.report.code}: ${report.report.providerError ?? "no detail"}. The chain shows no landing; the reservation stays recorded and nothing is retried automatically.`, {
        report: report.report,
        signature,
      });
    }
    context.finality = settlement.state === "NOT_SEEN" ? "confirmed" : settlement.finality;
    return NEXT;
  },
};

/** Landed (or the venue says landed): observe independently. */
const observeOutcome: PipelineStep<SwapSettleContext, SwapSettleStop> = {
  stage: "settle",
  name: "observe-outcome",
  async run(context) {
    const { bundle, finality } = context;
    const quote = bundle.review.quote;
    const { report } = need(context.outcome, "outcome");
    const store = need(context.store, "store");
    const signature = need(context.signature, "signature");
    const observed = await observeSwap(need(context.independent, "independent"), {
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
        /* The bytes are spent and only the fee moved: the wallet may trade
           again. If the slot will not settle now, the recovery read settles it
           the same way on the next check. */
        await failSwapOwnerLock({ store, owner: bundle.taker, signature, at: new Date().toISOString() });
        return refusal(409, "LANDED_FAILED", observed.reason, {
          signature,
          chainError: observed.chainError,
          report: report?.ok ? report.report : null,
          durableState: held.ok ? held.record.state : "UNKNOWN",
          recovery: "The failed landing remains RECOVERY_REQUIRED until its fee-only evidence is reconciled.",
        });
      }
      return answer(202, {
        state: "RECOVERY_PENDING",
        signature,
        report: report?.ok ? report.report : null,
        observationFailure: { code: observed.code, reason: observed.reason },
        recovery: "The independent read has not resolved yet. Read again by signature; never execute again.",
      });
    }
    context.observed = observed;
    return NEXT;
  },
};

/* ---------------------------------------------------------------- receipt */

/**
 * The receipt's facts: the venue's report reconciled with the chain's own
 * read, or — on the adopted lane, where this deployment broadcast the bytes
 * itself — the chain's read alone, which is the whole of the evidence and is
 * enough to settle on. What arrived is still measured against the reviewed
 * minimum; the wallet's own priority fee will differ from the venue's quote
 * and is recorded as the deviation it is.
 */
const receiptFacts: PipelineStep<SwapSettleContext, SwapSettleStop> = {
  stage: "receipt",
  name: "receipt-facts",
  async run(context) {
    const { bundle, adoptedLane } = context;
    const quote = bundle.review.quote;
    const observed = need(context.observed, "observed");
    const { report } = need(context.outcome, "outcome");
    const store = need(context.store, "store");
    const signature = need(context.signature, "signature");
    const executeReport = report?.ok ? report.report : null;
    const providerInput = executeReport?.totalInputAmountRaw ?? executeReport?.inputAmountResultRaw;
    const providerOutput = executeReport?.totalOutputAmountRaw ?? executeReport?.outputAmountResultRaw;

    let facts: SwapReceiptFacts | null = null;
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
      const withinReview =
        (adoptedLane !== null || quote.path === "BUILD_SUBMIT") &&
        observed.observation.actualInputRaw === quote.inputRaw &&
        BigInt(observed.observation.actualOutputRaw) >= BigInt(quote.minimumOutputRaw);
      /* `/build` sent no provider report by design: a landing that equals the Review to the unit is MATCHED on the chain's word alone. */
      const exact =
        quote.path === "BUILD_SUBMIT" &&
        adoptedLane === null &&
        withinReview &&
        observed.observation.actualOutputRaw === quote.quotedOutputRaw &&
        observed.observation.baseFeeLamports === quote.signatureFeeLamports &&
        observed.observation.priorityFeeLamports === quote.priorityFeeLamports;
      try {
        facts = buildSwapReceiptFacts({
          review: bundle.review,
          provider: null,
          observation: { ...observed.observation, programs: [...observed.observation.programs] },
          reconciliation: exact ? "MATCHED" : withinReview ? "DEVIATION_RECORDED" : "RECOVERY",
        });
      } catch (cause) {
        factsRefusal = cause instanceof Error ? cause.message : String(cause);
      }
    }
    context.facts = facts;
    context.factsRefusal = factsRefusal;

    const at = new Date().toISOString();
    context.at = at;
    if (!facts) {
      const held = await transitionSendAttempt({
        store,
        network: "mainnet",
        signature,
        to: "RECOVERY_REQUIRED",
        at,
      });
      return answer(202, {
        state: "RECOVERY_PENDING",
        signature,
        report: executeReport,
        observation: observed.observation,
        facts,
        factsRefusal,
        recovery: `The chain outcome is known but closeout is incomplete: ${factsRefusal ?? "receipt facts unavailable"}. ${held.ok ? "The attempt remains RECOVERY_REQUIRED." : held.reason}`,
      });
    }
    return NEXT;
  },
};

/** The attempt's finality, then the Receipt itself and the durable owner artifact. */
const receiptMinted: PipelineStep<SwapSettleContext, SwapSettleStop> = {
  stage: "receipt",
  name: "receipt-minted",
  async run(context) {
    const { bundle, proof, finality } = context;
    const quote = bundle.review.quote;
    const facts = need(context.facts, "facts");
    const store = need(context.store, "store");
    const signature = need(context.signature, "signature");
    const at = need(context.at, "at");
    const finalizedAttempt = await transitionSendAttempt({
      store,
      network: "mainnet",
      signature,
      to: finality === "finalized" ? "FINALIZED" : "CONFIRMED",
      at,
    });
    if (!finalizedAttempt.ok) {
      return answer(202, {
        state: "RECOVERY_PENDING",
        signature,
        recovery: `The chain outcome is known, but the durable attempt could not record finality: ${finalizedAttempt.reason}`,
      });
    }

    const minted = mintSwapOutcomeReceipt({
      id: `swap:${quote.requestId}`,
      actionPassportHash: proof.digest,
      facts,
      submissionLane: submissionLaneOf(context),
    });
    if (!minted.ok) {
      await transitionSendAttempt({ store, network: "mainnet", signature, to: "RECOVERY_REQUIRED", at });
      return answer(202, { state: "RECOVERY_PENDING", signature, recovery: minted.reason });
    }
    context.receipt = minted.receipt;
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
      return answer(202, {
        state: "RECOVERY_PENDING",
        signature,
        recovery: `The Receipt exists but the durable owner artifact did not close: ${ownerCompleted.reason}`,
      });
    }
    return NEXT;
  },
};

/* ---------------------------------------------------------------- fee */

/**
 * The wallet's own history, with what the operation cost. The owner lock
 * already holds the full Receipt keyed `mainnet:<owner>`, but that slot is a
 * boundary — one open swap per wallet — and it is reused, so it is not a
 * history. This row is, and the fee on it is the settled fee the Receipt and
 * Rewards read; the plan's own record of the execution follows it.
 */
const historyAndFee: PipelineStep<SwapSettleContext, SwapSettleStop> = {
  stage: "fee",
  name: "history-and-fee",
  async run(context) {
    const { bundle } = context;
    const quote = bundle.review.quote;
    const facts = need(context.facts, "facts");
    const observed = need(context.observed, "observed");
    const store = need(context.store, "store");
    const signature = need(context.signature, "signature");
    const at = need(context.at, "at");
    const receipt = need(context.receipt, "receipt");
    const swapRowFee = actionFeeFromServiceFee(facts.fees.serviceFee);
    context.swapRow = await recordSolanaAction(store, {
      network: "mainnet",
      wallet: bundle.taker,
      actionId: signature,
      lane: "SWAP",
      outcome: "DONE",
      /* What the chain did, not what the quote said: the row is the outcome,
         and the receipt keeps the quoted figure beside it. */
      out: { mint: quote.inputMint, amountRaw: observed.observation.actualInputRaw, decimals: null, symbol: null },
      in: { mint: quote.outputMint, amountRaw: observed.observation.actualOutputRaw, decimals: null, symbol: null },
      signature,
      receiptHash: receipt.contentHash,
      ...(swapRowFee ? { fee: swapRowFee } : {}),
      /* Spot or Swap — read off the signed bundle, never off the request. */
      origin: bundle.origin ?? null,
      /* The provider's id for this fill, and its own dollar figure for the exact
         input it took — the row's second valuation basis where no stablecoin
         leg gives par. */
      providerRef: quote.requestId,
      statedUsd: statedUsdOf(quote.inUsdValue, quote.inputRaw, observed.observation.actualInputRaw),
      now: at,
    });

    /* The plan's own record of this execution, after the History row that is
       the durable source. Non-fatal: a swap that moved money is never reported
       as failed because the plan's row was slow, and every read of the plan
       reconciles it from History by this same signature — so a failure here is
       written to the log and surfaces as `sync: pending`, never as a second
       trade. */
    const planBinding = bundle.origin?.plan ?? null;
    if (planBinding && bundle.planReview) {
      const planWrite = await recordPlanExecution(store, {
        owner: bundle.taker,
        planId: planBinding.planId,
        execution: { signature, version: planBinding.version, reviewId: planBinding.reviewId, review: bundle.planReview, reviewedAt: bundle.planReview.checkedAt, outcome: "DONE" },
      });
      if (!planWrite.ok) console.error(`plan-execution not recorded on ${planBinding.planId}: ${planWrite.reason}; History holds the row, the next read reconciles it`);
    }
    return NEXT;
  },
};

/* ---------------------------------------------------------------- rewards */

/**
 * Rewards and points: a consequence of the swap having finished, so after the
 * Receipt, the owner artifact and the history row. Neither call can throw and
 * neither result is read — a swap that moved money is never reported as
 * failed because an entitlement row was slow, and the same operation
 * reference writes the same rows on any later read.
 */
const rewardsAndPoints: PipelineStep<SwapSettleContext, SwapSettleStop> = {
  stage: "rewards",
  name: "rewards-and-points",
  async run(context) {
    const { bundle } = context;
    const quote = bundle.review.quote;
    const facts = need(context.facts, "facts");
    const observed = need(context.observed, "observed");
    const store = need(context.store, "store");
    const at = need(context.at, "at");
    /* A friend who trades without signing in binds here, before the share is
       written, so this very trade counts to the inviter. The binding never
       fails the trade and its answer is not read: a refusal (too late, the
       same inviter, a cycle) or a thrown read budget leaves the swap as it is. */
    const referralCode = context.referralCode ? normalizeReferralCode(context.referralCode) : null;
    if (referralCode) {
      try {
        await bindReferrer(store, { wallet: bundle.taker, code: referralCode, now: at, at: observed.observation.observedAt });
      } catch (error) {
        console.error(`referral binding at settle skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    await recordOperationRewards(store, {
      fee: facts.fees.serviceFee,
      trader: bundle.taker,
      settledAt: observed.observation.observedAt,
      now: at,
      price: swapFeePrice(quote, facts.fees.serviceFee),
    });
    /* Jupiter's own valuation of the input it took is the dollar figure for a
       non-stablecoin input; it is the provider's measurement of this exact
       amount, never a quote of a different one. */
    if (context.swapRow?.ok) {
      await recordOperationPoints(store, {
        action: context.swapRow.action,
        statedUsd: quote.inUsdValue ? { value: quote.inUsdValue, sourceRef: "jupiter:order:inUsdValue" } : null,
        settledAt: observed.observation.observedAt,
        now: at,
      });
    }
    return NEXT;
  },
};

/** The send-attempt projection closes on the Receipt; then the answer. */
const receiptClosed: PipelineStep<SwapSettleContext, SwapSettleStop> = {
  stage: "receipt",
  name: "receipt-closed",
  async run(context) {
    const { bundle, finality, facts, factsRefusal } = context;
    const observed = need(context.observed, "observed");
    const { report } = need(context.outcome, "outcome");
    const signature = need(context.signature, "signature");
    const receipt = need(context.receipt, "receipt");
    const receiptedAttempt = await transitionSendAttempt({
      store: need(context.store, "store"),
      network: "mainnet",
      signature,
      to: "RECEIPTED",
      at: need(context.at, "at"),
      receiptHash: receipt.contentHash,
    });
    if (!receiptedAttempt.ok) {
      return answer(202, {
        state: "RECOVERY_PENDING",
        signature,
        recovery: `The durable owner artifact holds the full Receipt, but the send-attempt projection did not close: ${receiptedAttempt.reason}`,
      });
    }
    context.answer = {
      status: 200,
      body: {
        state: facts ? facts.reconciliation.state : "DEVIATION_RECORDED",
        signature,
        finality,
        report: report?.ok ? report.report : null,
        observation: observed.observation,
        takerLamportDelta: observed.takerLamportDelta,
        feeLamports: observed.feeLamports,
        facts,
        factsRefusal,
        receipt: context.receipt,
        policy: { verdict: bundle.policyVerdict },
      },
    };
    return NEXT;
  },
};

/**
 * The swap's settle half. The guard steps are the shared safety chain after
 * the wallet; the order of every step is the order the route ran them in.
 */
export const SOLANA_SWAP_SETTLE = definePipeline<SwapSettleContext, SwapSettleStop>({
  line: "solana-swap",
  part: "settle",
  steps: [
    ...signedGuard,
    submitOnce,
    chainStatus,
    observeOutcome,
    receiptFacts,
    receiptMinted,
    historyAndFee,
    rewardsAndPoints,
    receiptClosed,
  ],
});

export type SwapSettleRequest = Pick<SwapSettleContext, "bundle" | "proof" | "signedTransactionBase64" | "reviewedTransactionBase64"> &
  Partial<Pick<SwapSettleContext, "referralCode">>;

/** A fresh context for one admitted execute request. */
export function swapSettleContext(request: SwapSettleRequest): SwapSettleContext {
  return {
    ...request,
    referralCode: request.referralCode ?? null,
    signedInspection: null,
    adoption: null,
    adoptedLane: null,
    signature: null,
    endpoint: null,
    store: null,
    submitHandle: null,
    independent: null,
    outcome: null,
    finality: "confirmed",
    observed: null,
    facts: null,
    factsRefusal: null,
    receipt: null,
    at: null,
    network: null,
    swapRow: null,
    answer: null,
  };
}

/** Runs the settle half; a completed run carries its answer in the context. */
export function settleSolanaSwap(context: SwapSettleContext): Promise<PipelineRun<SwapSettleStop>> {
  return runPipeline(SOLANA_SWAP_SETTLE, context);
}

export type { SwapRefusal };
