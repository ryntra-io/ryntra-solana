import { decimal } from "../decimal.ts";
import { createPositionRecord } from "../position.ts";
import { adapterFailure, safeAdapter, type AdapterResult } from "./types.ts";

export function normalizeSolanaHolding(input: Readonly<{
  ownerRef: string;
  sourceId: string;
  connectionId: string;
  networkRef: string;
  owner: string;
  mint: string;
  tokenProgram: string;
  amountRaw: string;
  decimals: number;
  tokenAccountRef: string | null;
  observedAt: string | null;
  evidenceRefs: readonly string[];
}>): AdapterResult {
  if (!input.tokenAccountRef || !input.observedAt) {
    return adapterFailure(
      "SOURCE_IDENTITY_UNAVAILABLE",
      "Solana holding needs token-account identity and an explicit snapshot time.",
      input.evidenceRefs,
    );
  }
  return safeAdapter(input.evidenceRefs, () => [createPositionRecord({
    schemaVersion: "1.0.0",
    ownerRef: input.ownerRef,
    source: {
      sourceId: input.sourceId,
      connectionId: input.connectionId,
      sourcePositionKey: input.tokenAccountRef as string,
      sourceVersion: null,
      observedAt: input.observedAt as string,
      evidenceRefs: input.evidenceRefs,
    },
    accountRef: input.owner,
    networkRef: input.networkRef,
    venueRef: null,
    protocolRef: input.tokenProgram,
    instrumentKey: input.mint,
    underlyingKey: input.mint,
    representationKey: `${input.networkRef}:${input.tokenProgram}:${input.mint}`,
    positionType: "WALLET_ASSET",
    positionSlotKey: input.tokenAccountRef as string,
    book: "LIVE",
    accountingRole: "PRIMARY",
    economicLot: {
      state: "SOURCE_SCOPED",
      sourceId: input.sourceId,
      lotKey: input.tokenAccountRef as string,
      evidenceRefs: input.evidenceRefs,
    },
    quantity: { amount: decimal(input.amountRaw, input.decimals), unitRef: input.mint },
    valuation: {
      state: "UNPRICED",
      value: null,
      sourceRef: null,
      observedAt: input.observedAt as string,
      validUntil: null,
      freshnessPolicy: null,
      reason: "The current Solana holdings source exposes no price observation.",
      conflictRefs: [],
    },
    valuationContribution: "ASSET",
    cashState: "NOT_CASH",
    settlementState: "SETTLED",
    custodyClass: "SELF_CUSTODY",
    exposureLegs: [{
      legId: `${input.tokenAccountRef}:principal`,
      underlyingKey: input.mint,
      role: "PRINCIPAL",
      phase: "SETTLED",
      direction: "LONG",
      notional: null,
      unknownReason: "The current Solana holdings source exposes no price observation.",
      observedAt: input.observedAt as string,
      validUntil: null,
      freshnessPolicy: { maxAgeSeconds: null },
      evidenceRefs: input.evidenceRefs,
    }],
  })]);
}
