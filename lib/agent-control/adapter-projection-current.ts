/**
 * Current, evidence-bounded adapter projections.
 *
 * These records are intentionally asymmetric. They project only facts already
 * held by the relevant ecosystem core; they do not backfill Agent Control
 * identity into older Stellar receipts and do not turn Solana's adapter
 * contract into an executed lifecycle.
 */

import {
  ADAPTER_PROJECTION_DECLARATIONS,
  projectAdapterAction,
  type AdapterProjection,
  type AdapterProjectionDeclaration,
  type AdapterProjectionId,
  type AdapterSourceClaim,
} from "./adapter-projection.ts";
import { SOLANA_CAIP2 } from "./adapters/solana-token-2022.ts";
import { STELLAR_TESTNET } from "../stellar/network.ts";
import { SOLANA_M1B_RECORDED_RUN } from "../solana/recorded-m1b.ts";

function declaration(id: AdapterProjectionId): AdapterProjectionDeclaration<AdapterProjectionId> {
  const found = ADAPTER_PROJECTION_DECLARATIONS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Adapter projection declaration missing: ${id}`);
  return found;
}

function emptyClaim(chainRef: string): AdapterSourceClaim {
  return {
    actionId: null,
    actionDigest: null,
    policyVersion: null,
    receiptRef: null,
    chainRef,
  };
}

/**
 * Solana now has one owner-signed Mainnet lifecycle to project, but no agent
 * authority to invent from it. The Outcome Receipt binds the adapter action,
 * exact Review digest and chain result; it carries no Agent Passport, mandate
 * or generalized execution route. Those two truths stay on separate axes.
 */
export const SOLANA_ADAPTER_PROJECTION: AdapterProjection<AdapterProjectionId> = projectAdapterAction({
  adapter: declaration("solana"),
  identity: {
    actionId: SOLANA_M1B_RECORDED_RUN.actionRef,
    actionDigest: SOLANA_M1B_RECORDED_RUN.receipt.actionPassportHash,
    policyVersion: null,
    chainRef: SOLANA_CAIP2.mainnet,
    receipt: null,
  },
  agentControl: {
    sourceClaim: emptyClaim(SOLANA_CAIP2.mainnet),
    agentRef: null,
    authority: null,
    policyRef: null,
    authorization: {
      state: "UNAVAILABLE",
      basis: "The owner authorized M1B in their own wallet; the Receipt carries no Agent Passport, mandate or delegated Agent Control authority.",
    },
    sourceRefs: [
      "lib/agent-control/adapters/solana-token-2022.ts",
      "docs/tasks/evidence/RYN-SOL-M1B-outcome-receipt.json",
    ],
  },
  ecosystem: {
    sourceClaim: {
      actionId: SOLANA_M1B_RECORDED_RUN.actionRef,
      actionDigest: SOLANA_M1B_RECORDED_RUN.receipt.actionPassportHash,
      policyVersion: null,
      receiptRef: null,
      chainRef: SOLANA_CAIP2.mainnet,
    },
    assetRef: null,
    execution: {
      state: "CONFIRMED",
      basis: `The owner-signed 0.5 USDC ATA-create transaction finalized in slot ${SOLANA_M1B_RECORDED_RUN.slot}.`,
    },
    settlement: {
      state: "CONFIRMED",
      basis: "Two independent RPC operators agree on the 0.5 USDC credit, ATA rent and 80000-lamport network fee.",
    },
    reconciliation: {
      state: "DEVIATION_RECORDED",
      basis: "The transfer and ATA facts match; the immutable issued Receipt records its software-only fee-split and expected-program deviation.",
    },
    sourceRefs: [
      "lib/agent-control/adapters/solana-token-2022.ts",
      SOLANA_M1B_RECORDED_RUN.explorerUrl,
      `receipt:${SOLANA_M1B_RECORDED_RUN.receipt.id}`,
      `receipt-hash:${SOLANA_M1B_RECORDED_RUN.receipt.contentHash}`,
      "docs/tasks/evidence/RYN-SOL-M1B-chain-evidence.json",
    ],
  },
  axes: {
    providerCapability: {
      state: "AVAILABLE",
      basis: "The Token-2022 adapter defines read-only input and observation contracts for Solana.",
    },
    ryntraMaturity: {
      state: "PREVIEW",
      basis: "One exact owner-signed Mainnet Outcome Receipt exists and verifies; generalized Agent Control execution does not.",
    },
    routeCapability: {
      state: "UNAVAILABLE",
      basis: "No Solana Agent Control execution route is mounted.",
    },
    userEligibility: {
      state: "NOT_EVALUATED",
      basis: "No user eligibility decision has been made.",
    },
  },
  limitations: [
    "The proof is bounded to one exact M1B classic-USDC ATA-create lifecycle.",
    "It creates no Agent Passport, delegated mandate or generalized Send authority.",
    "The historical Receipt remains DEVIATION_RECORDED; later source corrections do not rewrite it.",
  ],
  nextGate:
    "RYN-SOL-M1 remains the separately authorized general Send owner canary; M1B proves only the ATA-create case.",
});

/**
 * Stellar's owner-signed testnet receipt remains valid on its own terms. Its
 * schema explicitly carries policyVersion:null and no Agent Control actionId,
 * so this projection exposes the lifecycle while leaving shared identity empty.
 */
export const STELLAR_ADAPTER_PROJECTION: AdapterProjection<AdapterProjectionId> = projectAdapterAction({
  adapter: declaration("stellar"),
  identity: {
    actionId: null,
    actionDigest: null,
    policyVersion: null,
    chainRef: STELLAR_TESTNET.id,
    receipt: null,
  },
  agentControl: {
    sourceClaim: emptyClaim(STELLAR_TESTNET.id),
    agentRef: null,
    authority: null,
    policyRef: null,
    authorization: {
      state: "UNAVAILABLE",
      basis: "The owner-signed Stellar lifecycle is not an Agent Control authorization and has no agent attribution.",
    },
    sourceRefs: ["lib/stellar/transactions/receipt.ts"],
  },
  ecosystem: {
    sourceClaim: emptyClaim(STELLAR_TESTNET.id),
    assetRef: `${STELLAR_TESTNET.id}/native:XLM`,
    execution: {
      state: "CONFIRMED",
      basis: "Owner-signed classic XLM payment confirmed on Stellar Testnet on 2026-08-13.",
    },
    settlement: {
      state: "CONFIRMED",
      basis: "Transaction 1cf23243…a45c95c closed in ledger 4,126,028.",
    },
    reconciliation: {
      state: "MATCHED",
      basis: "Observed balances moved exactly as the owner authorized.",
    },
    sourceRefs: [
      "transaction:1cf2324346b95d8b350f8316e5aec76063bc827c45819bb7d8cecd4c1a45c95c",
      "lib/stellar/transactions/receipt.ts",
    ],
  },
  axes: {
    providerCapability: {
      state: "AVAILABLE",
      basis: "Stellar Testnet RPC/Horizon and the owner-wallet lifecycle have produced independently verifiable evidence.",
    },
    ryntraMaturity: {
      state: "TESTNET",
      basis: "One owner-signed XLM payment lifecycle is proven on Stellar Testnet; mainnet remains read-only.",
    },
    routeCapability: {
      state: "UNAVAILABLE",
      basis: "Policy evaluation and route evidence are registered but not built for Stellar.",
    },
    userEligibility: {
      state: "NOT_EVALUATED",
      basis: "A wallet signature proves authorization of bytes, not eligibility to use an asset or route.",
    },
  },
  limitations: [
    "The existing Stellar receipt has no Agent Control actionId or policyVersion binding.",
    "Owner authorization is not delegated-agent authority and cannot be relabelled as a mandate.",
    "The recorded lifecycle is testnet-only and does not establish a mainnet execution route.",
  ],
  nextGate:
    "Produce a future Stellar action through the shared Agent Control envelope with a non-null policyVersion before projecting its Receipt as shared identity.",
});

export const CURRENT_ADAPTER_PROJECTIONS: readonly AdapterProjection<AdapterProjectionId>[] = Object.freeze([
  SOLANA_ADAPTER_PROJECTION,
  STELLAR_ADAPTER_PROJECTION,
]);

export function currentAdapterProjection(id: AdapterProjectionId): AdapterProjection<AdapterProjectionId> {
  const projection = CURRENT_ADAPTER_PROJECTIONS.find((candidate) => candidate.adapter.id === id);
  if (!projection) throw new Error(`Current adapter projection missing: ${id}`);
  return projection;
}
