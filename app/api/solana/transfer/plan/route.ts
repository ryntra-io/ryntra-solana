import { z } from "zod";

import {
  NATIVE_SOL_TRANSFER_ACTION_REF,
  SendTransferInputSchema,
} from "@/lib/agent-control/adapters/solana-token-2022";
import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { readSolanaCanaryBudget } from "@/lib/solana/canary-ledger";
import { reportCanaryRuntime, resolveCanaryRuntime } from "@/lib/solana/canary-runtime";
import {
  evaluateSolanaCanaryIntent,
  SOLANA_MAINNET_USDC_MINT,
  type SolanaCanaryIntent,
  type SolanaCanaryVerdict,
} from "@/lib/solana/canary-policy";
import {
  buildSendCanaryIntent,
  resolveSendCanaryHumanApproval,
} from "@/lib/solana/canary-send";
import { buildSendCanaryValuation, type SendCanaryValuation } from "@/lib/solana/canary-valuation";
import { fetchTokenCatalog, nativeSolPriceMint } from "@/lib/solana/catalog";
import { SolanaOwnerPolicySchema } from "@/lib/solana/contracts";
import { readMintAccount } from "@/lib/solana/mint";
import { buildNativeSolPreflight, buildNativeSolTransaction } from "@/lib/solana/native-sol";
import { buildPassport } from "@/lib/solana/passport";
import { evaluateNativeSolPolicy, evaluateOwnerPolicy } from "@/lib/solana/policy";
import { buildTransferPreflight, type PreflightSimulation } from "@/lib/solana/preflight";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { createSendReviewProof } from "@/lib/solana/review-proof";
import { buildSendCheck } from "@/lib/solana/send-check";
import { deploymentSendCapability } from "@/lib/solana/send-deployment";
import {
  evaluateSendSafety,
  resolveSendState,
  serverSendPolicy,
  type SendSafetyVerdict,
} from "@/lib/solana/send-safety";
import { buildTransferTransaction } from "@/lib/solana/transaction";
import type { TransferPlan } from "@/lib/solana/transaction";
import { privateNoStoreHeaders, rateLimitHeaders, type RateLimitDecision } from "@/lib/http-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Both networks, because this route moves nothing.
 *
 * It used to refuse anything but devnet, and the reasoning it carried — a
 * route that could build a mainnet transfer is one typo away from doing it —
 * put the gate on the wrong route. **Nothing here reaches the network with an
 * intent**: it reads a mint, builds bytes, asks the cluster to *simulate*
 * them and judges the result against a policy. The typo it feared cannot
 * exist, because the one route that submits is `../settle`, and that route
 * admits only M1B's exact `TOKEN_ATA_CREATE` canary on mainnet.
 *
 * Pinning it to devnet had a cost that was not theoretical. The Send console
 * read devnet holdings, built devnet transfers and printed devnet balances
 * under a surface chip that reads `MAINNET`, so a person looked at faucet dust
 * and was told it was their money on the network this product runs on. One
 * screen asserting two networks is the exact defect this repository treats as
 * the most serious kind, and it survived because the gate that produced it was
 * described as safety.
 */
/**
 * The request carries the proposal and nothing else.
 *
 * It used to carry the owner policy too, posted by the browser — so the same
 * request that asked for a transfer supplied the rules that transfer would be
 * judged by. The policy is now built on this side, from a constant, and there
 * is no field to override it with.
 */
const RequestSchema = z.object({ input: SendTransferInputSchema }).strict();

function responseHeaders(rate: RateLimitDecision) {
  return { ...privateNoStoreHeaders(), ...rateLimitHeaders(rate) };
}

function failure(status: number, code: string, message: string, rate: RateLimitDecision) {
  return Response.json({ error: { code, message } }, { status, headers: responseHeaders(rate) });
}

/**
 * Every other refusal in this route names its exact cause — the mint read, the
 * passport, the build and the preflight all answer with their own `reason`.
 * The schema gate used to be the one exception: it discarded `parsed.error` and
 * replied "The transfer proposal or policy was not accepted", which names no
 * field and no rule. It is also the refusal a caller meets first and most
 * often, so it was the worst place in the file to say nothing.
 *
 * Capped at three issues because a wholly malformed body reports one per field,
 * and a wall of them tells a reader less than the first few do.
 */
function describeIssues(error: z.ZodError): string {
  const lines: string[] = [];
  for (const issue of error.issues) {
    const where = issue.path.join(".");
    const line = where ? `${where} — ${issue.message}` : issue.message;
    if (lines.includes(line)) continue;
    lines.push(line);
    if (lines.length === 3) break;
  }
  return lines.length > 0 ? lines.join(" · ") : "The transfer proposal or policy was not accepted.";
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return failure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return failure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return failure(400, "VALIDATION_ERROR", describeIssues(parsed.error), rate);
  }

  const { input } = parsed.data;
  /* Built here, never received. */
  const policy = SolanaOwnerPolicySchema.parse(serverSendPolicy(input.network));
  const sendState = resolveSendState();
  /* The caller's network, read once and used for every read in this request.
     A handle pinned to one network while the input names another is how a
     preflight ends up describing a mint that is not the one being sent. */
  const handle = createSolanaRpcHandle({ network: input.network });

  async function canaryReview(
    plan: TransferPlan,
  ): Promise<
    | Readonly<{ ok: true; canaryIntent: SolanaCanaryIntent; canaryVerdict: SolanaCanaryVerdict }>
    | Readonly<{ ok: false; reason: string }>
  > {
    /* The owner-canary policy never decides a customer's transfer. When it
       cannot be read, a deterministic closed fallback stands in — declared, not
       disguised — and the verdict it produces is PAUSE / OUTSIDE_ENVELOPE with
       CONFIG_VALID short of PASS, so the signed bundle cannot claim a healthy
       configuration. Owner canaries are refused elsewhere while that lasts. */
    const runtime = resolveCanaryRuntime();
    reportCanaryRuntime(runtime);
    const resolved = { policy: runtime.policy } as const;
    try {
      let valuation: SendCanaryValuation | null = null;
      if (
        plan.network === "mainnet" &&
        plan.mint === SOLANA_MAINNET_USDC_MINT &&
        plan.decimals === 6 &&
        plan.actionKind !== "NATIVE_SOL"
      ) {
        const priceMint = nativeSolPriceMint();
        const catalog = await fetchTokenCatalog([priceMint], 2_500);
        const sol = catalog.ok ? catalog.byMint[priceMint] : null;
        if (catalog.ok && sol?.usdPrice) {
          try {
            valuation = buildSendCanaryValuation({
              plan,
              solUsdPrice: sol.usdPrice,
              sourceRef: `${sol.source.ref}:price:${priceMint}`,
              observedAt: catalog.observedAt,
            });
          } catch {
            /* Provider facts that cannot be represented exactly leave the
               canary valuation UNKNOWN. They never become zero or a guessed
               price, and the policy therefore cannot reserve the action. */
          }
        }
      }
      const canaryIntent = buildSendCanaryIntent({
        plan,
        valuation,
        humanApproval: resolveSendCanaryHumanApproval(plan),
      });
      const budget = await readSolanaCanaryBudget({
        store: getGuardRuntime().store,
        policy: resolved.policy,
      });
      return {
        ok: true,
        canaryIntent,
        canaryVerdict: evaluateSolanaCanaryIntent({
          policy: resolved.policy,
          budget,
          intent: canaryIntent,
        }),
      };
    } catch {
      return { ok: false, reason: "The durable owner-canary policy state could not be evaluated." };
    }
  }

  async function simulate(unsignedWireBase64: string): Promise<PreflightSimulation> {
    try {
      const response = await withRpcDiscipline(handle, (abortSignal) =>
        handle.rpc
          .simulateTransaction(unsignedWireBase64 as never, {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: false,
            commitment: "confirmed",
          })
          .send({ abortSignal }),
      );
      return {
        status: "PRESENT",
        succeeded: response.value.err === null || response.value.err === undefined,
        error:
          response.value.err === null || response.value.err === undefined
            ? null
            : JSON.stringify(response.value.err, (_key, entry) =>
                typeof entry === "bigint" ? entry.toString() : entry,
              ),
        unitsConsumed:
          response.value.unitsConsumed === null || response.value.unitsConsumed === undefined
            ? null
            : String(response.value.unitsConsumed),
      };
    } catch (cause) {
      return {
        status: "SKIPPED",
        reason: `The endpoint would not simulate this transaction: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }
  }

  /* The one gate between this Review and a wallet prompt, decided from what the
     server itself established: the capability verdict the builder attached, the
     simulation of the exact bytes, the priced fee, the visible rent, the
     programs in the message, the issuer proof and the deployment's stop. */
  function safetyFor(
    plan: TransferPlan,
    simulation: PreflightSimulation,
    reviewProof: Readonly<{ status: "SIGNED" | "UNSIGNED" }>,
  ): SendSafetyVerdict {
    return evaluateSendSafety({
      network: plan.network,
      state: sendState,
      support: plan.support,
      simulation,
      baseFeeLamports: plan.baseFeeLamports,
      ataRentLamports: plan.ataRentLamports,
      createsRecipientAccount: plan.createsRecipientAccount,
      programs: plan.programs,
      reviewProof,
      requireReviewProof: true,
      /* The two things the submit route used to discover for itself, after the
         wallet had already been opened. A deployment without a durable store or
         a second operator cannot finish this transfer, and a person should not
         spend a signature to find that out. */
      ...deploymentSendCapability(plan.network),
    });
  }

  if (input.actionRef === NATIVE_SOL_TRANSFER_ACTION_REF) {
    const built = await buildNativeSolTransaction({ handle, input });
    if (!built.ok) return failure(422, built.code, built.reason, rate);
    const simulation = await simulate(built.plan.unsignedWireBase64);
    const preflight = buildNativeSolPreflight({ input, plan: built.plan, simulation });
    const verdict = evaluateNativeSolPolicy({ policy, input, preflight });
    const answered = handle.answered() ?? handle.endpoints[0];
    const provider = { role: answered.role, host: answered.host };
    const canary = await canaryReview(built.plan);
    if (!canary.ok) return failure(503, "CANARY_EVIDENCE_UNAVAILABLE", canary.reason, rate);
    const reviewProof = createSendReviewProof({
      bundle: {
        plan: built.plan,
        preflight,
        verdict,
        provider,
        canaryIntent: canary.canaryIntent,
        canaryVerdict: canary.canaryVerdict,
      },
      key: loadIssuerKey(),
    });
    const safety = safetyFor(built.plan, simulation, reviewProof);
    return Response.json(
      {
        data: {
          passport: null,
          preflight,
          verdict,
          plan: built.plan,
          provider,
          canaryIntent: canary.canaryIntent,
          canaryVerdict: canary.canaryVerdict,
          support: built.plan.support,
          safety,
          reviewProof,
          /* 1.22.0: «Перевірка» counted here, so a phone draws the card's Review without its rules. */
          check: buildSendCheck({ plan: built.plan, preflight, verdict, support: built.plan.support, safety, reviewProof }),
        },
      },
      { headers: responseHeaders(rate) },
    );
  }

  const read = await readMintAccount(handle, input.mint);
  if (!read.ok) return failure(422, read.code, read.reason, rate);
  const passport = buildPassport(read.raw);
  if (!passport.ok) return failure(422, passport.code, passport.reason, rate);

  let epoch: bigint;
  try {
    const current = await withRpcDiscipline(handle, (abortSignal) => handle.rpc.getEpochInfo().send({ abortSignal }));
    epoch = BigInt(current.epoch);
  } catch (cause) {
    return failure(
      503,
      "EPOCH_UNAVAILABLE",
      `The endpoint did not return the current epoch needed to bind the Token-2022 transfer fee: ${cause instanceof Error ? cause.message : String(cause)}`,
      rate,
    );
  }

  const built = await buildTransferTransaction({ handle, read, passport: passport.passport, input, epoch });
  if (!built.ok) return failure(422, built.code, built.reason, rate);

  const simulation = await simulate(built.plan.unsignedWireBase64);

  const preflight = buildTransferPreflight({
    read,
    passport: passport.passport,
    input,
    epoch,
    simulation,
    networkFeeLamports: built.plan.baseFeeLamports,
  });
  if (!preflight.ok) return failure(422, preflight.code, preflight.reason, rate);

  const verdict = evaluateOwnerPolicy({
    policy,
    input,
    passport: passport.passport,
    preflight: preflight.preflight,
  });
  const answered = handle.answered() ?? handle.endpoints[0];
  const provider = { role: answered.role, host: answered.host };
  const canary = await canaryReview(built.plan);
  if (!canary.ok) return failure(503, "CANARY_EVIDENCE_UNAVAILABLE", canary.reason, rate);
  const reviewProof = createSendReviewProof({
    bundle: {
      plan: built.plan,
      preflight: preflight.preflight,
      verdict,
      provider,
      canaryIntent: canary.canaryIntent,
      canaryVerdict: canary.canaryVerdict,
    },
    key: loadIssuerKey(),
  });

  const safety = safetyFor(built.plan, simulation, reviewProof);
  return Response.json(
    {
      data: {
        passport: passport.passport,
        preflight: preflight.preflight,
        verdict,
        plan: built.plan,
        provider,
        canaryIntent: canary.canaryIntent,
        canaryVerdict: canary.canaryVerdict,
        support: built.plan.support,
        safety,
        reviewProof,
        /* 1.22.0: «Перевірка» counted here, so a phone draws the card's Review without its rules. */
        check: buildSendCheck({ plan: built.plan, preflight: preflight.preflight, verdict, support: built.plan.support, safety, reviewProof }),
      },
    },
    { headers: responseHeaders(rate) },
  );
}
