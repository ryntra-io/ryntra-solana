/**
 * Mint the signed Swap Outcome Receipt (RYN-SOL-M2).
 *
 * The structured Swap Receipt facts are already reconciled by
 * `buildSwapReceiptFacts`; this module seals them into the standard
 * issuer-signed Outcome Receipt artifact so the public verifier checks a swap
 * exactly the way it checks a send: schema, integrity, issuer signature and
 * binding — four separate facts, never one "Verified".
 */

import {
  JUPITER_SWAP_ADAPTER_REF,
} from "../agent-control/adapters/jupiter-swap.ts";
import { SOLANA_CAIP2 } from "../agent-control/adapters/solana-token-2022.ts";
import { createOutcomeReceipt, type OutcomeReceiptArtifact } from "../agent-control/artifacts.ts";
import { attestArtifact, loadIssuerKey } from "../agent-control/issuer.ts";
import { AGENT_CONTROL_REGISTRY, registryPin } from "../agent-control/registry.ts";
import {
  SwapReceiptFactsSchema,
  swapReceiptFactsToEffects,
  type SwapReceiptFacts,
} from "./swap-receipt.ts";
import { swapSubmissionActionRef, type SwapSubmissionLane } from "./swap-submission.ts";

export type SwapReceiptMintResult =
  | Readonly<{ ok: true; receipt: OutcomeReceiptArtifact }>
  | Readonly<{ ok: false; code: "MINT_FAILED"; reason: string }>;

export function mintSwapOutcomeReceipt(args: {
  id: string;
  /** The execution-review digest — the receipt binds to the exact reviewed bundle. */
  actionPassportHash: string;
  facts: SwapReceiptFacts;
  submissionLane: SwapSubmissionLane;
  environment?: Record<string, string | undefined>;
  now?: Date;
}): SwapReceiptMintResult {
  try {
    const facts = SwapReceiptFactsSchema.parse(args.facts);
    const now = args.now ?? new Date();
    const observedAt = facts.independentObservation.observedAt;
    const sourceRef = facts.independentObservation.source.ref;

    const status =
      facts.reconciliation.state === "MATCHED"
        ? ("MATCHED" as const)
        : facts.reconciliation.state === "FAILED"
          ? ("FAILED" as const)
          : ("DEVIATION_RECORDED" as const);

    const headlineEffects = [
      {
        description: `Swap ${facts.quote.inputRaw} raw of ${facts.quote.inputMint} for ${facts.independentObservation.actualOutputRaw} raw of ${facts.quote.outputMint} (quoted ${facts.quote.outputRaw}, minimum ${facts.quote.minimumOutputRaw}).`,
        sourceRef,
        observedAt,
      },
      {
        description: `Network fees ${facts.independentObservation.baseFeeLamports} base + ${facts.independentObservation.priorityFeeLamports} priority lamports; router ${facts.routing.router}.`,
        sourceRef,
        observedAt,
      },
    ];
    const structuredEffects = swapReceiptFactsToEffects({
      facts,
      sourceRef,
      observedAt,
    });

    const outcome = {
      status,
      chainRef: SOLANA_CAIP2.mainnet,
      transactionHash: facts.independentObservation.signature,
      observedEffects: [...headlineEffects, ...structuredEffects],
      reconciledAt: now.toISOString(),
    };
    const registry = registryPin(AGENT_CONTROL_REGISTRY, [
      JUPITER_SWAP_ADAPTER_REF,
      swapSubmissionActionRef(args.submissionLane),
    ]);

    const base = { id: args.id, actionPassportHash: args.actionPassportHash, outcome, registry, now };
    const unsigned = createOutcomeReceipt(base);
    const key = loadIssuerKey(args.environment);
    const receipt = key
      ? createOutcomeReceipt({
          ...base,
          issuer: attestArtifact({ kind: "OUTCOME_RECEIPT", contentHash: unsigned.contentHash, key, now }),
        })
      : unsigned;
    return { ok: true, receipt };
  } catch (failure) {
    return {
      ok: false,
      code: "MINT_FAILED",
      reason: failure instanceof Error ? failure.message : String(failure),
    };
  }
}
