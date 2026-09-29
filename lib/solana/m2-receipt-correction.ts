import {
  JUPITER_SWAP_ACTION_REF,
  JUPITER_SWAP_ADOPTED_RPC_ACTION_REF,
} from "../agent-control/adapters/jupiter-swap.ts";
import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "../agent-control/canonical.ts";
import { registerReceiptCorrection } from "./receipt-corrections.ts";

export const M2_RECEIPT_CORRECTION_CODES = [
  "LEGACY_SUBMISSION_LIMITATION_INACCURATE",
  "LEGACY_ACTION_PATH_REF_INACCURATE",
] as const;

const correctionCore = Object.freeze({
  schema: "ryntra.solana.receipt-correction",
  schemaVersion: "1.0.0",
  receipt: Object.freeze({
    id: "swap:01a05cd2-c4aa-751d-a82e-1d741cb8c23b",
    receivedFileSha256: "E91DCEACFA87040901056575A3A9F50ABA3E3BBE701E53B396164B2F7056953F",
    contentHash: "0xbd3b32c44b63916efe5c8374fc78eb93fcd0400b405c4c8590787feb008b5b26",
    integrityHash: "0x4fbbe93d502062057b9555d2df049b28d9f0f50e238880ce74700b3719c7720c",
    transactionSignature:
      "4NAKLXGnECdnrgJTv7CBtMjpYSDgcZuKaBfc1SKSHTLfhhrYkTTyGSsjM3LpRGQHKWR34dociwkhRrG9U8R41Cgr",
  }),
  codes: M2_RECEIPT_CORRECTION_CODES,
  original: Object.freeze({
    actionRef: JUPITER_SWAP_ACTION_REF,
    limitation: "Ryntra observed and reconciled this outcome; it did not sign, submit, fund or execute it.",
  }),
  corrected: Object.freeze({
    submissionLane: "ADOPTED_RPC",
    signer: "OWNER_WALLET",
    submitter: "RYNTRA_OWN_RPC",
    actionRef: JUPITER_SWAP_ADOPTED_RPC_ACTION_REF,
    providerEvidence: "NOT_APPLICABLE_TO_ADOPTED_RPC_LANE",
    actionEvidenceKind: "SWAP_EXECUTION_PROOF",
    executionReviewDigest: "0x4a088e37eee19f079a9ed77f5138484234f5598d5ad9408065ea904a9287aa5a",
    receiptAuthorizationAxis: "NOT_APPLICABLE",
    humanEvidence: "AUTHENTICATED_OWNER_ROUTE_AND_ONCHAIN_WALLET_SIGNATURE",
  }),
  observedFeeCorrection: Object.freeze({
    routeGrossOutputRaw: "25626130",
    platformFeeRaw: "5125",
    walletOutputBeforeNetworkFeeRaw: "25621005",
    baseFeeLamports: "5000",
    priorityFeeLamports: "14530",
    temporaryWsolRentLamports: "2039280",
    temporaryWsolRentReturned: true,
  }),
  sourceRefs: Object.freeze([
    "docs/tasks/evidence/RYN-SOL-M2-chain-evidence.json",
    "app/api/solana/swap/execute/route.ts#adopted-rpc-lane",
  ]),
});

export const M2_RECEIPT_CORRECTION = Object.freeze({
  ...correctionCore,
  correctionHash: hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.solanaReceiptCorrection, correctionCore),
});

export type M2ReceiptCorrection = typeof M2_RECEIPT_CORRECTION;

export function correctionForM2Receipt(value: unknown): typeof M2_RECEIPT_CORRECTION | null {
  if (typeof value !== "object" || value === null) return null;
  const receipt = value as {
    id?: unknown;
    contentHash?: unknown;
    integrity?: { hash?: unknown };
    outcome?: { transactionHash?: unknown };
  };
  return receipt.id === M2_RECEIPT_CORRECTION.receipt.id &&
    receipt.contentHash === M2_RECEIPT_CORRECTION.receipt.contentHash &&
    receipt.integrity?.hash === M2_RECEIPT_CORRECTION.receipt.integrityHash &&
    receipt.outcome?.transactionHash === M2_RECEIPT_CORRECTION.receipt.transactionSignature
    ? M2_RECEIPT_CORRECTION
    : null;
}

registerReceiptCorrection(correctionForM2Receipt);
