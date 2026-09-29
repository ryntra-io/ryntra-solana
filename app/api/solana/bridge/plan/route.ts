import { z } from "zod";

import { consumeAgentControlRequest, readAgentControlJson } from "@/lib/agent-control/http";
import { loadIssuerKey } from "@/lib/agent-control/issuer";
import { planBaseCctpBurn } from "@/lib/base/cctp-burn";
import { createEvmRpcHandle } from "@/lib/base/rpc";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { resolveSolanaBridgeNetworkState } from "@/lib/solana/lane-state";
import { readSolanaCanaryBudget } from "@/lib/solana/canary-ledger";
import { reportCanaryRuntime, resolveCanaryRuntime } from "@/lib/solana/canary-runtime";
import {
  evaluateSolanaCanaryIntent,
  SolanaCanaryIntentSchema,
} from "@/lib/solana/canary-policy";
import { bridgeFailure, bridgeHeaders, describeBridgeIssues } from "@/lib/solana/bridge-http";
import {
  cctpChainLabel,
  cctpLaneFacts,
  cctpProgramRef,
  cctpSourceProgram,
  cctpDestinationProgram,
  EVM_ADDRESS_PATTERN,
  SOLANA_ADDRESS_PATTERN,
} from "@/lib/solana/cctp-direction";
import { buildCctpBurnPlan } from "@/lib/solana/cctp-plan";
import { fetchCctpProviderSnapshot } from "@/lib/solana/cctp-provider";
import { SOLANA_CCTP_MAINNET_REGISTRY, solanaCctpLane } from "@/lib/solana/cctp-registry";
import { createCctpReviewProof } from "@/lib/solana/cctp-review-proof";
import { evaluateCctpSafety } from "@/lib/solana/cctp-safety";
import { SOLANA_TOKEN_PROGRAM } from "@/lib/solana/cctp-receive";
import { createSolanaRpcHandle, withRpcDiscipline } from "@/lib/solana/rpc";
import { associatedTokenAccount } from "@/lib/solana/token-account";
import { deploymentSendCapability } from "@/lib/solana/send-deployment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Build one bridge Review, in whichever direction was asked for.
 *
 * Nothing here reaches the network with an intent. It reads balances, asks
 * Circle for this exact lane's fee, builds the source-side call, asks the
 * source chain to *execute it without effect*, judges the result against the
 * owner-canary policy and signs the whole bundle with the issuer key. The two
 * routes that can move money re-derive every verdict here rather than trusting
 * the bundle they are handed.
 *
 * ## The two halves are not mirror images and the code says so
 *
 * On a Solana source the ephemeral message account arrives as a public key
 * generated in the browser; this process never sees its private half. On a Base
 * source there is no such account, but there is a token permission that may not
 * be in place yet — and the recipient is not the Solana wallet the person typed
 * but the USDC account that wallet owns, because that is what CCTP credits.
 * Deriving that here rather than in the browser is what stops a burn naming an
 * address the destination programme could never pay into.
 */

/**
 * The two request shapes, by which chain burns.
 *
 * A Solana-source lane names its EVM destination in the direction and carries
 * the ephemeral message account the browser generated; an EVM-source lane
 * names the EVM chain the same way and carries no such account. Base stays
 * the default for a request that says nothing, because every request before
 * 2026-09-05 meant Base.
 */
const SolanaSourceSchema = z
  .object({
    direction: z.enum(["SOLANA_TO_BASE", "SOLANA_TO_ETHEREUM"]).default("SOLANA_TO_BASE"),
    owner: z.string().regex(SOLANA_ADDRESS_PATTERN),
    destinationRecipient: z.string().regex(EVM_ADDRESS_PATTERN),
    messageSentAccount: z.string().regex(SOLANA_ADDRESS_PATTERN),
    amountRaw: z.string().regex(/^[1-9][0-9]*$/).max(20),
    /* Set only by the surface that actually showed the recipient to the owner
       and had it confirmed. It moves a REVIEW finding, never a BLOCK. */
    recipientConfirmed: z.boolean().default(false),
  })
  .strict();

const EvmSourceSchema = z
  .object({
    direction: z.enum(["BASE_TO_SOLANA", "ETHEREUM_TO_SOLANA"]),
    owner: z.string().regex(EVM_ADDRESS_PATTERN),
    destinationRecipient: z.string().regex(SOLANA_ADDRESS_PATTERN),
    amountRaw: z.string().regex(/^[1-9][0-9]*$/).max(20),
    recipientConfirmed: z.boolean().default(false),
  })
  .strict();

const RequestSchema = z.union([EvmSourceSchema, SolanaSourceSchema]);

type SolanaSourceRequest = z.output<typeof SolanaSourceSchema>;
type EvmSourceRequest = z.output<typeof EvmSourceSchema>;

/** Only a Solana-source request carries the browser-made message account. */
function isSolanaSourceRequest(input: SolanaSourceRequest | EvmSourceRequest): input is SolanaSourceRequest {
  return input.direction === "SOLANA_TO_BASE" || input.direction === "SOLANA_TO_ETHEREUM";
}

export async function POST(request: Request) {
  const rate = consumeAgentControlRequest(request.headers);
  if (!rate.allowed) return bridgeFailure(429, "RATE_LIMITED", "Too many requests.", rate);
  const body = await readAgentControlJson(request);
  if (!body.ok) return bridgeFailure(body.status, body.code, "The request body was not accepted.", rate);
  const parsed = RequestSchema.safeParse(body.value);
  if (!parsed.success) return bridgeFailure(400, "VALIDATION_ERROR", describeBridgeIssues(parsed.error), rate);
  const input = parsed.data;
  const direction = input.direction;
  const lane = cctpLaneFacts(direction);
  const registryLane = solanaCctpLane(direction);

  /* A network that is not open is refused before anything is read, with the
     one code the card turns into "not open yet". Base answers through the
     bridge lane exactly as before; Ethereum needs its own switch, set only
     after its first founder-signed transfer has been read back. */
  const networkState = resolveSolanaBridgeNetworkState(lane.evmChain);
  if (networkState !== "OPEN" && lane.evmChain !== "base") {
    return bridgeFailure(409, "ROUTE_NOT_OPEN", `Bridging with ${cctpChainLabel(lane.evmChain)} is not open yet.`, rate, {
      network: lane.evmChain,
    });
  }

  /* A customer bridging is never refused for the state of the founder's own
     experiment configuration. Unreadable, it becomes the deterministic closed
     fallback and every action reads outside the envelope; the burn route
     refuses an owner canary separately while that is true. */
  const canaryRuntime = resolveCanaryRuntime();
  reportCanaryRuntime(canaryRuntime);
  const policy = canaryRuntime.policy;

  const provider = await fetchCctpProviderSnapshot({ direction });
  const deployment = deploymentSendCapability("mainnet");

  /* Both handles, both directions. The independent-read findings are about the
     deployment rather than about which way this particular transfer goes, and
     a lane that only counted operators on its own source would report a second
     Base operator as missing every time somebody bridged towards Base. */
  const solanaHandle = createSolanaRpcHandle({ network: "mainnet" });
  /* The EVM end of *this* lane. Named `baseHandle` since the lane had one EVM
     chain; it now reads whichever chain the direction names. */
  const baseHandle = createEvmRpcHandle(lane.evmChain, { requireArchive: true });

  let plan: Record<string, unknown> & {
    intentDigest: string;
    amountRaw: string;
    builtAt: string;
    maxFeeRaw: string;
    protocolFeeRaw: string;
  };
  let simulation: Readonly<{
    status: "PRESENT" | "SKIPPED";
    succeeded: boolean;
    error: string | null;
    unitsConsumed: string | null;
  }>;
  let rpc: Readonly<{ role: "primary" | "fallback" | "independent"; host: string }>;
  let canaryDestination: string;
  let allowance: Readonly<{ sufficient: boolean; currentRaw: string; requiredRaw: string }> | null = null;

  /* Narrowed on the request's own discriminant, so the compiler knows which
     shape it holds: only a Solana-source request carries a message account. */
  if (!isSolanaSourceRequest(input)) {
    /* CCTP credits a token account on Solana, never a wallet. The person types
       a wallet; this derives the account that wallet owns, and the burn on the
       far side names that account. Getting this wrong produces a message that
       can never be received, and only after the money is already gone. */
    let recipientTokenAccount: string;
    try {
      recipientTokenAccount = await associatedTokenAccount({
        owner: input.destinationRecipient,
        mint: SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.address,
        tokenProgram: SOLANA_TOKEN_PROGRAM,
      });
    } catch (cause) {
      return bridgeFailure(
        422,
        "RECIPIENT_INVALID",
        `The receiving USDC account for that Solana wallet could not be derived: ${cause instanceof Error ? cause.message : String(cause)}`,
        rate,
      );
    }

    let recipientAccountExists = false;
    let recipientReadable = true;
    try {
      const read = await withRpcDiscipline(solanaHandle, (abortSignal) =>
        solanaHandle.rpc
          .getAccountInfo(recipientTokenAccount as never, { commitment: "confirmed", encoding: "base64" })
          .send({ abortSignal }),
      );
      recipientAccountExists = read.value !== null && read.value !== undefined;
    } catch {
      /* Unreadable is not absent. The transfer can still be planned — the
         account is created alongside the receive when it turns out to be
         missing — and the Review says the readiness was not established. */
      recipientReadable = false;
    }

    const built = await planBaseCctpBurn(baseHandle, {
      provider,
      owner: input.owner,
      destinationOwner: input.destinationRecipient,
      destinationTokenAccount: recipientTokenAccount,
      destinationAccountExists: recipientAccountExists,
      amountRaw: input.amountRaw,
    });
    if (!built.ok) return bridgeFailure(422, built.code, built.reason, rate);
    plan = { ...built.plan, recipientReadable } as never;
    allowance = built.plan.allowance;

    /* Base's own execution of the exact call. `eth_estimateGas` runs it, so a
       price is proof it does not revert and its absence is proof of nothing —
       which is precisely the distinction the Solana side draws with a
       simulation. When the permission is not yet in place the burn genuinely
       would revert, and the safety gate answers REVIEW rather than BLOCK so the
       next action is the approval instead of a dead end. */
    const burnCall = built.plan.calls.find((call) => call.purpose === "BURN");
    simulation = built.plan.allowance.sufficient
      ? {
          status: burnCall?.gasEstimate === null ? "SKIPPED" : "PRESENT",
          succeeded: burnCall?.gasEstimate !== null,
          error: burnCall?.unpricedReason ?? null,
          unitsConsumed: burnCall?.gasEstimate ?? null,
        }
      : {
          status: "PRESENT",
          succeeded: true,
          error: null,
          unitsConsumed: built.plan.calls.find((call) => call.purpose === "APPROVE")?.gasEstimate ?? null,
        };
    const answered = baseHandle.endpoints[0];
    rpc = { role: answered.role, host: answered.host };
    canaryDestination = input.destinationRecipient;
  } else {
    const built = await buildCctpBurnPlan({
      handle: solanaHandle,
      provider,
      direction: input.direction,
      owner: input.owner,
      destinationRecipient: input.destinationRecipient,
      messageSentAccount: input.messageSentAccount,
      amountRaw: input.amountRaw,
    });
    if (!built.ok) return bridgeFailure(422, built.code, built.reason, rate);
    plan = built.plan as never;

    try {
      const response = await withRpcDiscipline(solanaHandle, (abortSignal) =>
        solanaHandle.rpc
          .simulateTransaction(built.plan.unsignedWireBase64 as never, {
            encoding: "base64",
            sigVerify: false,
            replaceRecentBlockhash: false,
            commitment: "confirmed",
          })
          .send({ abortSignal }),
      );
      const failed = response.value.err !== null && response.value.err !== undefined;
      simulation = {
        status: "PRESENT",
        succeeded: !failed,
        error: failed
          ? JSON.stringify(response.value.err, (_key, entry) => (typeof entry === "bigint" ? entry.toString() : entry))
          : null,
        unitsConsumed:
          response.value.unitsConsumed === null || response.value.unitsConsumed === undefined
            ? null
            : String(response.value.unitsConsumed),
      };
    } catch (cause) {
      simulation = {
        status: "SKIPPED",
        succeeded: false,
        error: `The endpoint would not simulate this burn: ${cause instanceof Error ? cause.message : String(cause)}`,
        unitsConsumed: null,
      };
    }
    const answered = solanaHandle.answered() ?? solanaHandle.endpoints[0];
    rpc = { role: answered.role, host: answered.host };
    canaryDestination = `${lane.destination.chainRef}:${input.destinationRecipient}`;
  }

  const canaryIntent = SolanaCanaryIntentSchema.parse({
    schema: "ryntra.solana.canary-intent",
    schemaVersion: "1.0.0",
    /* Bound to the burn intent digest, so the budget reservation and the
       duplicate-burn claim name the same transfer rather than two things that
       happen to be about the same money. */
    intentId: `cctp:${plan.intentDigest.slice(2)}`,
    revision: 1,
    family: "CCTP",
    network: "mainnet",
    destination: canaryDestination,
    /* The two USDCs this exact lane touches, and only those. */
    mints: [registryLane.source.asset.assetRef, registryLane.destination.asset.assetRef].sort(),
    programs: [
      cctpProgramRef(lane.source.chain, cctpSourceProgram(direction)),
      cctpProgramRef(lane.destination.chain, cctpDestinationProgram(direction)),
    ].sort(),
    /* USDC is a dollar stablecoin with six decimals, so base units are already
       USD micros and the exposure is exact. No price feed is consulted and
       none is claimed — the valuation method says so by name.

       The fee reserve is zero because Circle's fee comes out of the amount
       rather than in addition to it: the money at risk is the whole transfer,
       and adding the fee on top would reserve budget twice. */
    principalUsdMicros: plan.amountRaw,
    feeReserveUsdMicros: "0",
    usdMicros: plan.amountRaw,
    valuation: {
      method: "USDC_NOMINAL",
      sourceRef: `${SOLANA_CCTP_MAINNET_REGISTRY.chains.solana.asset.assetRef}:usdc-nominal`,
      observedAt: plan.builtAt,
      /* One minute, which is roughly how long the reviewed blockhash lives.
         A valuation that outlasted the transaction it values would be a
         freshness claim about bytes that can no longer land. */
      validUntil: new Date(Date.parse(plan.builtAt) + 60_000).toISOString(),
    },
    /*
     * What this field records, exactly.
     *
     * A person typed this destination and asked for this exact amount to be
     * reviewed. That is a human approval of a destination and a figure, and it
     * is the same thing the Send lane records — there from a founder-set
     * environment approval naming the recipient and amount, here from the
     * moment the owner asks. It is **not** a claim that anything was signed:
     * the wallet is the irreversible step and it has not been opened.
     *
     * It also cannot be used to widen anything. The owner-canary policy still
     * requires this destination to be on the founder's own allowlist, so a
     * caller that set this flag by hand would still meet a BLOCK.
     */
    humanApproval: input.recipientConfirmed ? "RECORDED" : "NOT_RECORDED",
  });

  let canaryVerdict;
  try {
    const budget = await readSolanaCanaryBudget({ store: getGuardRuntime().store, policy });
    canaryVerdict = evaluateSolanaCanaryIntent({ policy, budget, intent: canaryIntent });
  } catch {
    /* Not the configuration — that now falls back rather than refusing. This is
       an unexpected failure while building the evidence, and it says so instead
       of blaming a policy the caller cannot see or fix. */
    return bridgeFailure(
      503,
      "CANARY_EVIDENCE_UNAVAILABLE",
      "The owner-canary evidence for this review could not be built.",
      rate,
    );
  }

  const bundle = { plan, provider, rpc, simulation, canaryIntent, canaryVerdict };
  const reviewProof = createCctpReviewProof({ bundle, key: loadIssuerKey() });

  const safety = evaluateCctpSafety({
    state: networkState,
    direction,
    plan: { maxFeeRaw: plan.maxFeeRaw, protocolFeeRaw: plan.protocolFeeRaw, allowance },
    provider,
    simulation,
    canaryVerdict,
    reviewProof,
    settlementStore: deployment.settlementStore,
    independentSolanaRead: deployment.independentReadback,
    independentBaseRead: baseHandle.endpoints.length >= 2,
    recipientConfirmed: input.recipientConfirmed,
  });

  return Response.json(
    { data: { direction, lane, plan, provider, rpc, simulation, canaryIntent, canaryVerdict, reviewProof, safety } },
    { headers: bridgeHeaders(rate) },
  );
}
