/**
 * The safety chain of a Solana swap, as pipeline steps.
 *
 * Written once, here, and run by the pipeline rather than copied into each
 * line. Two halves, because the person's signature sits between them:
 *
 * - **Before the wallet** (`SOLANA_SWAP_REVIEW_GUARD`, with `ownerLockFreeStep`
 *   ahead of any venue): the wallet holds no open Review; the provider bytes
 *   pass the pre-sign transaction check; a simulation of those exact bytes
 *   proves what they do to the signer (the effect firewall); the asset and
 *   the swap policy are judged on that proof; the issuer signs the bundle the
 *   wallet must hand back unchanged; the durable owner lock holds the Review.
 * - **After the wallet** (`SOLANA_SWAP_SIGNED_GUARD`): the bundle comes back
 *   under the issuer's own signature and still fresh; the signed bytes are the
 *   reviewed message, or a wallet's guarded change of it proved again; the
 *   taker's signature verifies; the plan the Review was made under still
 *   stands; an independent operator exists to read the outcome; the owner
 *   lock binds this signature before anything is sent.
 *
 * Every refusal is the one the routes gave when this chain lived inline in
 * them — the same status, code and words — and every refusal after the
 * wallet says the network never saw the bytes.
 */

import { getBase58Decoder, getTransactionDecoder } from "@solana/kit";
import type { z } from "zod";

import {
  SPL_TRANSFER_ACTION_REF,
  type SplTransferInput,
} from "../../agent-control/adapters/solana-token-2022.ts";
import { loadIssuerKey, type IssuerKey } from "../../agent-control/issuer.ts";
import type { UnsignedTx } from "../contracts.ts";
import type { PlanReview } from "../../api/v1/contract.ts";
import { getGuardRuntime } from "../../guard/runtime.ts";
import type { GuardStore } from "../../guard/store.ts";
import { projectedStatus, readTradingPlan } from "../../plans/store.ts";
import type { SolanaActionOrigin } from "../../solana/action-origin.ts";
import { SolanaOwnerPolicySchema } from "../../solana/contracts.ts";
import type { MintReadSuccess } from "../../solana/mint.ts";
import { evaluateOwnerPolicy } from "../../solana/policy.ts";
import { buildTransferPreflight } from "../../solana/preflight.ts";
import {
  assessJupiterOrderFreshness,
  resolveJupiterSwapEndpoint,
  type JupiterExecutableOrder,
  type JupiterOrderQuote,
  type JupiterSwapEndpoint,
} from "../../solana/quotes.ts";
import { readRentParameters, simulatedAccountStates } from "../../solana/rent.ts";
import { createIndependentReadHandle, createSolanaRpcHandle, withRpcDiscipline, type SolanaRpcHandle } from "../../solana/rpc.ts";
import { serverSendPolicy } from "../../solana/send-safety.ts";
import { verifySignatureOnly } from "../../solana/signature.ts";
import { assessSwapWalletAdoption, type SwapAdoptionResult } from "../../solana/swap-adoption.ts";
import { assessSwapClientReview } from "../../solana/swap-client-safety.ts";
import { assessSwapSimulationEffects } from "../../solana/swap-effect-firewall.ts";
import {
  createSwapExecutionProof,
  inspectionForBundle,
  SwapExecutionBundleSchema,
  SwapExecutionSimulationSchema,
  verifySwapExecutionProof,
  type SwapExecutionProofSchema,
  type SwapExecutionBundle,
} from "../../solana/swap-execution-review.ts";
import {
  claimSwapOwnerSignature,
  expireUnclaimedSwapOwnerReview,
  isSwapOwnerLockSettled,
  readSwapOwnerLock,
  reserveSwapOwnerReview,
  type SwapOwnerLockRecord,
} from "../../solana/swap-owner-lock.ts";
import { buildSwapPolicyIntent, evaluateSwapPolicy } from "../../solana/swap-policy.ts";
import { buildSwapQuoteReview } from "../../solana/swap-review.ts";
import { inspectJupiterSwapTransaction } from "../../solana/swap-transaction-check.ts";
import type { SolanaAssetPassport } from "../../solana/types.ts";
import { NEXT, need, type PipelineStep, type StepResult } from "../pipeline.ts";
import type { SwapRefusal } from "./refusal.ts";

type Inspection = Extract<Awaited<ReturnType<typeof inspectJupiterSwapTransaction>>, { ok: true }>;
type Simulation = z.output<typeof SwapExecutionSimulationSchema>;

/** What the guard before the wallet reads and writes. */
export type SwapReviewGuardContext = {
  readonly input: Readonly<{ inputMint: string; outputMint: string; amountRaw: string; taker: string }>;
  store: GuardStore | null;
  handle: SolanaRpcHandle | null;
  issuerKey: IssuerKey | null;
  readonly passports: Record<string, SolanaAssetPassport>;
  readonly reads: Record<string, MintReadSuccess>;
  order: JupiterExecutableOrder | null;
  /** The bytes the venue built for the wallet — what every guard step below checks and the wallet signs. */
  unsigned: UnsignedTx | null;
  inspection: Inspection | null;
  simulation: Simulation | null;
  outputAssetVerdict: ReturnType<typeof evaluateOwnerPolicy> | null;
  intent: ReturnType<typeof buildSwapPolicyIntent> | null;
  verdict: ReturnType<typeof evaluateSwapPolicy> | null;
  planReview: PlanReview | null;
  bundleOrigin: SolanaActionOrigin | undefined;
  review: ReturnType<typeof buildSwapQuoteReview> | null;
  bundle: SwapExecutionBundle | null;
  proof: ReturnType<typeof createSwapExecutionProof> | null;
  preSign: ReturnType<typeof assessSwapClientReview> | null;
};

/**
 * The runtime's store, for the two steps that come before its durability is
 * judged: the intent's terms (a plan is read before the gate by design) and
 * the gate itself. Every step after the gate takes the store the gate let
 * through — `need(context.store, …)` — so a line that drops or reorders the
 * gate fails loudly instead of locking in a store that cannot hold the lock.
 */
export function storeOf(context: { store: GuardStore | null }): GuardStore {
  context.store ??= getGuardRuntime().store;
  return context.store;
}

/** The mainnet RPC handle, made once per request by whichever step needs it first. */
export function handleOf(context: { handle: SolanaRpcHandle | null }): SolanaRpcHandle {
  context.handle ??= createSolanaRpcHandle({ network: "mainnet" });
  return context.handle;
}

const refuse = (status: number, code: string, message: string, extra?: object): StepResult<SwapRefusal> => ({
  stop: { status, code, message, ...(extra ? { extra } : {}) },
});

/**
 * A Solana blockhash is valid for at most 151 slots. Well past that, bytes
 * issued under it cannot land no matter who holds them — the fallback that
 * keeps an unclaimed Review from becoming a permanent dead end when no
 * independent operator is configured to say so directly.
 */
const BLOCKHASH_CERTAINLY_DEAD_MS = 300_000;

/* The review policy asks what receiving the output would subject ANY holder
   to, so it takes two stand-ins rather than inventing a counterparty — the
   same pair the read-only quote route uses. */
const ANY_HOLDER = "11111111111111111111111111111111";
const ANY_RECIPIENT = "SysvarRent111111111111111111111111111111111";

/** The order as a quote: the same figures, without the bytes or the taker. */
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

/* ------------------------------------------------------------ before the wallet */

/**
 * The wallet holds no open Review. Asked before any venue, so a wallet that
 * is waiting on its own signature costs no quote. A settled swap is history,
 * not a lock: only an outstanding signature holds the wallet, and only until
 * it is recovered; an unclaimed Review whose bytes can no longer land is let
 * go.
 */
export const ownerLockFreeStep: PipelineStep<SwapReviewGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "owner-lock-free",
  async run(context) {
    const { input } = context;
    const store = storeOf(context);
    if (store.durability !== "DURABLE_MULTI_WRITER") {
      return refuse(503, "STORE_NOT_DURABLE", "A signable swap Review requires the durable multi-writer owner lock.");
    }
    handleOf(context);
    const existingOwnerLock = await readSwapOwnerLock({ store, owner: input.taker });
    if (existingOwnerLock.ok) {
      const record = existingOwnerLock.record;
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
            return refuse(409, expired.code, expired.reason, {
              ownerLock: { state: record.state, requestId: record.requestId, signature: record.signature },
            });
          }
        } else {
          return refuse(409, "OWNER_SWAP_LOCKED", "This wallet already has an open swap Review or an unresolved signed attempt.", {
            ownerLock: {
              state: record.state,
              requestId: record.requestId,
              signature: record.signature,
            },
          });
        }
      }
    } else if (existingOwnerLock.code === "OWNER_SWAP_LOCK_UNAVAILABLE") {
      return refuse(503, existingOwnerLock.code, existingOwnerLock.reason);
    }
    return NEXT;
  },
};

/** The provider's bytes pass the pre-sign transaction check for this taker. */
const transactionCheck: PipelineStep<SwapReviewGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "transaction-check",
  async run(context) {
    const unsigned = need(context.unsigned, "unsigned");
    const inspection = await inspectJupiterSwapTransaction({
      wireBase64: unsigned.wireBase64,
      expectedTaker: context.input.taker,
    });
    if (!inspection.ok) {
      return refuse(409, `TRANSACTION_${inspection.code}`, inspection.reason);
    }
    context.inspection = inspection;
    return NEXT;
  },
};

/**
 * The effect firewall: simulate the exact provider bytes before anything
 * reaches a wallet. The simulation is also asked for the post-execution state
 * of every static account, and the live Rent parameters are read beside it,
 * so an account the transaction opens for the taker is proved to hold exactly
 * the network's rent-exempt minimum for its size — the venue's
 * `rentFeeLamports` is an estimate for a plain 165-byte account and is short
 * of every Token-2022 account with extensions, which is every tokenized stock.
 */
const effectFirewall: PipelineStep<SwapReviewGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "effect-firewall",
  async run(context) {
    const handle = handleOf(context);
    const inspection = need(context.inspection, "inspection");
    let order = need(context.order, "order");
    const unsigned = need(context.unsigned, "unsigned");
    const rent = await readRentParameters(handle).catch(() => null);
    /* Every static account but the programs themselves: an account the
       transaction opens for the taker is always static, and a program's
       bytecode is the one large answer nothing here needs. */
    const stateAddresses: readonly string[] = inspection.staticAccounts.filter((account) => !inspection.programs.includes(account));
    let simulation: Simulation;
    try {
      const response = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc
          .simulateTransaction(unsigned.wireBase64 as never, {
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
        return refuse(409, `SIMULATION_EFFECT_${ownerEffects.code}`, `${ownerEffects.reason} Ask for a fresh order; do not sign.`);
      }
      /* The Review states the rent the chain proved, not the venue's estimate:
         what stays in the accounts opened for the taker, to the lamport, and
         nothing when the only account opened is closed again in the same
         transaction. The bytes are unchanged; only the disclosed figure is. */
      if (ownerEffects?.ok && ownerEffects.proof.durableRentLamports !== undefined && ownerEffects.proof.rentProof !== "REVIEWED_CEILING") {
        const provenRent = ownerEffects.proof.durableRentLamports;
        if (provenRent !== order.rentFeeLamports) {
          order = { ...order, rentFeeLamports: provenRent, rentFeePayer: BigInt(provenRent) > 0n ? order.taker : order.rentFeePayer };
          context.order = order;
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
      return refuse(503, "SIMULATION_UNAVAILABLE", `The exact provider bytes could not be simulated: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    context.simulation = simulation;
    if (simulation.status !== "OK") {
      return refuse(409, "SIMULATION_FAILED", `Simulation of the exact provider bytes failed: ${simulation.error ?? "unknown"}. Ask for a fresh order; do not sign.`, { simulation });
    }
    return NEXT;
  },
};

/**
 * The review policy: the same thirteen-rule review the card already renders,
 * judged over what receiving the output would subject any holder to — the one
 * rule in the swap policy that can BLOCK on the asset rather than on the
 * bytes — and the swap policy over the intent and the proof.
 */
const reviewPolicy: PipelineStep<SwapReviewGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "review-policy",
  run(context) {
    const { input, passports, reads } = context;
    const order = need(context.order, "order");
    const inspection = need(context.inspection, "inspection");
    const simulation = need(context.simulation, "simulation");
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
    context.outputAssetVerdict = outputAssetVerdict;

    let intent;
    try {
      intent = buildSwapPolicyIntent({
        order,
        /* The programs are the ones the simulation resolved — top level and
           CPI — never the ones provider prose names. */
        programs: simulation.ownerEffects?.programs ?? inspection.programs,
      });
    } catch (cause) {
      return refuse(409, "INTENT_REFUSED", cause instanceof Error ? cause.message : String(cause));
    }
    context.intent = intent;
    context.verdict = evaluateSwapPolicy({
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
    return NEXT;
  },
};

/**
 * The issuer-signed bundle the execute step demands back unchanged, and the
 * pre-sign assessment: signable bytes leave only when every non-human rule
 * passes and the person's visible approval is the one step left.
 */
const reviewProof: PipelineStep<SwapReviewGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "review-proof",
  run(context) {
    const order = need(context.order, "order");
    const inspection = need(context.inspection, "inspection");
    const simulation = need(context.simulation, "simulation");
    const verdict = need(context.verdict, "verdict");
    const { bundleOrigin, planReview } = context;
    const review = buildSwapQuoteReview(quoteView(order));
    const bundle: SwapExecutionBundle = {
      review,
      taker: order.taker,
      lastValidBlockHeight: order.lastValidBlockHeight,
      inspection: inspectionForBundle(inspection),
      simulation,
      policyIntent: need(context.intent, "intent"),
      policyVerdict: verdict,
      ...(bundleOrigin ? { origin: bundleOrigin } : {}),
      ...(planReview ? { planReview } : {}),
    };
    const proof = createSwapExecutionProof({ bundle, key: need(context.issuerKey, "issuerKey") });
    const preSign = assessSwapClientReview({
      verdict,
      proofStatus: proof.status,
      simulationStatus: simulation.status,
      ownerEffectsStatus: simulation.ownerEffects?.status ?? "MISSING",
      expiresAt: order.reviewExpiresAt,
    });
    context.review = review;
    context.bundle = bundle;
    context.proof = proof;
    context.preSign = preSign;
    if (!preSign.ready) {
      return refuse(409, "SWAP_PRE_SIGN_REFUSED", `${preSign.code}: ${preSign.reason}`, { policy: { verdict }, preSign });
    }
    return NEXT;
  },
};

/** The durable owner lock holds this one Review for this wallet. */
const ownerLockReserve: PipelineStep<SwapReviewGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "owner-lock-reserve",
  async run(context) {
    const order = need(context.order, "order");
    const bundle = need(context.bundle, "bundle");
    const proof = need(context.proof, "proof");
    const ownerLock = await reserveSwapOwnerReview({
      store: need(context.store, "store"),
      owner: context.input.taker,
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
      return refuse(status, ownerLock.code, ownerLock.reason, {
        ownerLock: ownerLock.record
          ? {
              state: ownerLock.record.state,
              requestId: ownerLock.record.requestId,
              signature: ownerLock.record.signature,
            }
          : null,
      });
    }
    return NEXT;
  },
};

/** The chain before the wallet, in order, after the bytes are built. */
export const SOLANA_SWAP_REVIEW_GUARD = [transactionCheck, effectFirewall, reviewPolicy, reviewProof, ownerLockReserve] as const;

/* ------------------------------------------------------------ after the wallet */

/** What the guard after the wallet reads and writes. */
export type SwapSignedGuardContext = {
  readonly bundle: SwapExecutionBundle;
  readonly proof: z.output<typeof SwapExecutionProofSchema>;
  readonly signedTransactionBase64: string;
  readonly reviewedTransactionBase64: string | undefined;
  signedInspection: Inspection | null;
  adoption: SwapAdoptionResult | null;
  adoptedLane: Extract<SwapAdoptionResult, { ok: true; lane: "WALLET_GUARDS" }> | null;
  signature: string | null;
  /** The keyed venue lane the bytes go out through when they are the venue's own. */
  endpoint: JupiterSwapEndpoint | null;
  store: GuardStore | null;
  submitHandle: SolanaRpcHandle | null;
  independent: SolanaRpcHandle | null;
};

const refuseBeforeSubmit = (status: number, code: string, message: string, extra?: object): StepResult<SwapRefusal> => ({
  stop: { status, code, message, ...(extra ? { extra } : {}), beforeSubmit: true },
});

/** The bundle is trusted only under the deployment's own issuer signature, and only while fresh. */
const reviewProofVerified: PipelineStep<SwapSignedGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "review-proof-verified",
  run(context) {
    const { bundle, proof } = context;
    const issuerKey = loadIssuerKey();
    if (!issuerKey) {
      return refuseBeforeSubmit(503, "ISSUER_KEY_MISSING", "This deployment has no issuer key; nothing can be executed.");
    }
    const proofCheck = verifySwapExecutionProof({
      bundle: bundle as SwapExecutionBundle,
      proof,
      trustedPublicKey: issuerKey.publicKey,
    });
    if (!proofCheck.ok) {
      return refuseBeforeSubmit(409, "REVIEW_PROOF_REFUSED", proofCheck.reason);
    }
    const quote = bundle.review.quote;
    if (bundle.review.state !== "FRESH" || quote.access !== "production") {
      return refuseBeforeSubmit(409, "REVIEW_NOT_FRESH", "Only a fresh production review can be executed.");
    }
    if (assessJupiterOrderFreshness({ reviewExpiresAt: quote.reviewExpiresAt }) !== "FRESH") {
      return refuseBeforeSubmit(409, "ORDER_EXPIRED", "The order's review window has closed. Ask for a fresh order and a fresh signature.");
    }
    if (bundle.simulation.status !== "OK") {
      return refuseBeforeSubmit(409, "SIMULATION_FAILED", "A bundle whose simulation failed cannot be executed.");
    }
    return NEXT;
  },
};

/**
 * The signed bytes are the reviewed message — or a wallet's guarded change of
 * it, adopted on the deployment's own lane — and the taker's signature over
 * them verifies.
 *
 * Two lanes, and the wallet chooses which one by what it hands back.
 * Byte-identical bytes keep the venue's managed execution, which lands better
 * than anything this process can do alone. A wallet that re-priced the compute
 * budget and attached its own guards has signed a transaction the venue will
 * refuse — its execute lane accepts only the order it built — so those bytes
 * are adopted instead: re-inspected, re-simulated and re-proved against the
 * same reviewed legs, then broadcast through Ryntra's own RPC. Refusing the
 * modification outright is what made the swap impossible for the wallet this
 * product is actually used with.
 */
const signedBytesChecked: PipelineStep<SwapSignedGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "signed-bytes-checked",
  async run(context) {
    const { bundle, signedTransactionBase64, reviewedTransactionBase64 } = context;
    const signedInspection = await inspectJupiterSwapTransaction({
      wireBase64: signedTransactionBase64,
      expectedTaker: bundle.taker,
    });
    if (!signedInspection.ok) {
      return refuseBeforeSubmit(409, `SIGNED_${signedInspection.code}`, signedInspection.reason);
    }
    context.signedInspection = signedInspection;

    let adoption: SwapAdoptionResult | null = null;
    if (signedInspection.messageHashHex !== bundle.inspection.messageHashHex) {
      if (!reviewedTransactionBase64) {
        return refuseBeforeSubmit(409, "WALLET_MODIFIED_BYTES", "The signed bytes are not the reviewed message, and the reviewed bytes were not supplied for comparison.");
      }
      /* The browser may not choose what it is compared against: the reviewed
         bytes must hash to the digest the issuer already signed over. */
      const reviewedInspection = await inspectJupiterSwapTransaction({
        wireBase64: reviewedTransactionBase64,
        expectedTaker: bundle.taker,
      });
      if (!reviewedInspection.ok || reviewedInspection.messageHashHex !== bundle.inspection.messageHashHex) {
        return refuseBeforeSubmit(409, "REVIEWED_BYTES_MISMATCH", "The bytes offered as the reviewed message are not the ones this Review was issued over.");
      }
      adoption = assessSwapWalletAdoption({
        reviewedWireBase64: reviewedTransactionBase64,
        signedWireBase64: signedTransactionBase64,
      });
      if (!adoption.ok) {
        return refuseBeforeSubmit(409, adoption.code, adoption.reason);
      }
    }
    context.adoption = adoption;
    context.adoptedLane = adoption?.ok === true && adoption.lane === "WALLET_GUARDS" ? adoption : null;

    const signatureCheck = verifySignatureOnly({
      signedWireBase64: signedTransactionBase64,
      expectedSigner: bundle.taker,
    });
    if (signatureCheck.verdict !== "CLEARED") {
      return refuseBeforeSubmit(409, "SIGNATURE_REFUSED", `The taker signature did not verify: ${signatureCheck.verdict}.`, {
        comparisons: signatureCheck.comparisons,
      });
    }

    /* The transaction signature is the taker's signature over these bytes. */
    try {
      const decoded = getTransactionDecoder().decode(Buffer.from(signedTransactionBase64, "base64"));
      const raw = (decoded.signatures as unknown as Record<string, Uint8Array | null>)[bundle.taker];
      if (!raw) throw new Error("no taker signature");
      context.signature = getBase58Decoder().decode(raw);
    } catch {
      return refuseBeforeSubmit(409, "SIGNATURE_UNREADABLE", "The taker signature could not be read from the signed bytes.");
    }
    return NEXT;
  },
};

/** The keyed venue lane and the durable store, both present before anything is claimed. */
const submitLaneReady: PipelineStep<SwapSignedGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "submit-lane-ready",
  run(context) {
    const selection = resolveJupiterSwapEndpoint({ access: "production" });
    if (!selection.ok) {
      return refuseBeforeSubmit(503, "PROVIDER_KEY_MISSING", selection.reason);
    }
    context.endpoint = selection;
    const store = getGuardRuntime().store;
    if (store.durability !== "DURABLE_MULTI_WRITER") {
      return refuseBeforeSubmit(503, "STORE_NOT_DURABLE", "Value-moving execution requires the durable multi-writer store.");
    }
    context.store = store;
    /* The bundle's own policy verdict must still be signable. The issuer proof
       above already binds it; this refuses a bundle whose verdict blocks. */
    if (context.bundle.policyVerdict.decision === "BLOCK") {
      return refuseBeforeSubmit(409, "SWAP_POLICY_BLOCKED", "The reviewed swap policy verdict blocks these bytes.", {
        policy: { verdict: context.bundle.policyVerdict },
      });
    }
    return NEXT;
  },
};

/**
 * The plan, if the order was made under one. The proof binds the block and
 * the binding; what the proof cannot know is what happened to the plan since
 * the Review — an edit into a new version, a cancellation, an expiry. A
 * Review made before an edit is not a valid confirmation after it, so the
 * plan is read again here, before the network sees anything: the wallet's
 * signature is let go and the person reviews afresh. A blocked block in a
 * bundle is refused for the same reason the order was refused.
 */
const planStillStands: PipelineStep<SwapSignedGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "plan-still-stands",
  async run(context) {
    const { bundle } = context;
    const store = need(context.store, "store");
    const planBinding = bundle.origin?.plan ?? null;
    if (planBinding) {
      const block = bundle.planReview ?? null;
      if (!block || block.planId !== planBinding.planId || block.version !== planBinding.version || block.reviewId !== planBinding.reviewId || block.verdict === "blocked") {
        return refuseBeforeSubmit(409, "PLAN_REVIEW_BLOCKED", "The bundle's Strategy block is not the one this plan version was offered under.", { planReview: block });
      }
      const planRecord = await readTradingPlan(store, bundle.taker, planBinding.planId);
      if (!planRecord) return refuseBeforeSubmit(404, "PLAN_NOT_FOUND", "No such plan for this wallet.");
      if (planRecord.planVersion !== planBinding.version) {
        return refuseBeforeSubmit(409, "PLAN_VERSION_CONFLICT", `The plan moved to version ${planRecord.planVersion} after this Review judged version ${planBinding.version}. Ask for a fresh Review; nothing was sent.`, { planReview: block });
      }
      const planStatus = projectedStatus(planRecord, Date.now());
      if (planStatus !== "active") {
        return refuseBeforeSubmit(409, "PLAN_STATE_REFUSED", `The plan is ${planStatus} now; only an active plan is traded under. Nothing was sent.`, { planReview: block });
      }
    }
    return NEXT;
  },
};

/** An operator other than the sender exists to read the outcome; execution never rests on provider evidence alone. */
const independentReader: PipelineStep<SwapSignedGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "independent-reader",
  run(context) {
    const submitHandle = createSolanaRpcHandle({ network: "mainnet" });
    const independent = createIndependentReadHandle(submitHandle);
    if (!independent) {
      return refuseBeforeSubmit(503, "NO_INDEPENDENT_RPC", "No independent read operator is available; execution refuses to proceed on provider evidence alone.");
    }
    context.submitHandle = submitHandle;
    context.independent = independent;
    return NEXT;
  },
};

/**
 * An adopted transaction is re-proved before it is broadcast.
 *
 * The issuer proof binds the bytes that were REVIEWED. These are different
 * bytes, so the proof no longer speaks for them and nothing may be taken on
 * trust from the earlier simulation. They are simulated again and reduced to
 * the signer's own asset effects again, against the same reviewed legs and the
 * same minimum — with the wallet's own priority fee in place of the venue's,
 * because that is what this transaction now asks for.
 */
const adoptedBytesReproved: PipelineStep<SwapSignedGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "adopted-bytes-reproved",
  async run(context) {
    const { adoptedLane, bundle, signedTransactionBase64 } = context;
    if (!adoptedLane) return NEXT;
    const quote = bundle.review.quote;
    const submitHandle = need(context.submitHandle, "submitHandle");
    const signedInspection = need(context.signedInspection, "signedInspection");
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
        return refuseBeforeSubmit(409, "ADOPTED_SIMULATION_FAILED", "The bytes your wallet returned did not pass simulation. Nothing was sent; ask for a fresh order.");
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
        return refuseBeforeSubmit(409, `ADOPTED_EFFECT_${effects.code}`, `${effects.reason} Nothing was sent.`);
      }
    } catch (cause) {
      return refuseBeforeSubmit(503, "ADOPTED_SIMULATION_UNAVAILABLE", `The bytes your wallet returned could not be simulated: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    return NEXT;
  },
};

/**
 * The owner lock binds this signature. The claim is the last step before the
 * send-attempt boundary; a refused claim sent nothing, so the browser may let
 * this signature go rather than keep it as a submission of unknown outcome.
 */
const ownerLockClaim: PipelineStep<SwapSignedGuardContext, SwapRefusal> = {
  stage: "guard",
  name: "owner-lock-claim",
  async run(context) {
    const { bundle, proof } = context;
    const ownerClaim = await claimSwapOwnerSignature({
      store: need(context.store, "store"),
      owner: bundle.taker,
      requestId: bundle.review.quote.requestId,
      messageDigest: `0x${bundle.inspection.messageHashHex}`,
      reviewDigest: proof.digest,
      signature: need(context.signature, "signature"),
      at: new Date().toISOString(),
    });
    if (!ownerClaim.ok) {
      const status = ownerClaim.code === "OWNER_SWAP_LOCK_UNAVAILABLE" ? 503 : 409;
      return refuseBeforeSubmit(status, ownerClaim.code, ownerClaim.reason);
    }
    return NEXT;
  },
};

/** The chain after the wallet, in order, before anything is sent. */
export const SOLANA_SWAP_SIGNED_GUARD = [
  reviewProofVerified,
  signedBytesChecked,
  submitLaneReady,
  planStillStands,
  independentReader,
  adoptedBytesReproved,
  ownerLockClaim,
] as const satisfies readonly PipelineStep<SwapSignedGuardContext, SwapRefusal>[];
