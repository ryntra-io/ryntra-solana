import { decimal, multiplyDecimal, type DecimalValue } from "../decimal.ts";
import { createPositionRecord } from "../position.ts";
import { adapterFailure, safeAdapter, type AdapterResult } from "./types.ts";

export type RobinhoodEvmHoldingSnapshot = Readonly<{
  ownerRef: string;
  accountRef: string;
  networkRef: string;
  sourceId: string;
  connectionId: string;
  sourcePositionKey: string | null;
  positionSlotKey: string | null;
  observedAt: string | null;
  evidenceRefs: readonly string[];
  instrumentKey: string;
  underlyingKey: string;
  representationKey: string;
  positionType: "WALLET_ASSET" | "SPOT" | "RWA";
  amountRaw: string;
  decimals: number;
  price: null | Readonly<{
    value: DecimalValue;
    currency: string;
    sourceRef: string;
    observedAt: string;
    validUntil: string | null;
    freshnessPolicy: Readonly<{ maxAgeSeconds: number | null }>;
  }>;
}>;

export function normalizeRobinhoodEvmHolding(input: RobinhoodEvmHoldingSnapshot): AdapterResult {
  if (!input.sourcePositionKey || !input.positionSlotKey || !input.observedAt) {
    return adapterFailure(
      "SOURCE_CONTRACT_INSUFFICIENT",
      "Robinhood/EVM holding requires account/representation identity and explicit observation time.",
      input.evidenceRefs,
    );
  }
  return safeAdapter(input.evidenceRefs, () => {
    const quantity = decimal(input.amountRaw, input.decimals);
    const value = input.price === null ? null : {
      amount: multiplyDecimal(
        quantity,
        input.price.value,
        Math.min(18, quantity.scale + input.price.value.scale),
        "HALF_EVEN",
      ),
      currency: input.price.currency,
    };
    return [createPositionRecord({
      schemaVersion: "1.0.0",
      ownerRef: input.ownerRef,
      source: {
        sourceId: input.sourceId,
        connectionId: input.connectionId,
        sourcePositionKey: input.sourcePositionKey,
        sourceVersion: null,
        observedAt: input.observedAt,
        evidenceRefs: input.evidenceRefs,
      },
      accountRef: input.accountRef,
      networkRef: input.networkRef,
      venueRef: null,
      protocolRef: null,
      instrumentKey: input.instrumentKey,
      underlyingKey: input.underlyingKey,
      representationKey: input.representationKey,
      positionType: input.positionType,
      positionSlotKey: input.positionSlotKey,
      book: "LIVE",
      accountingRole: "PRIMARY",
      economicLot: {
        state: "SOURCE_SCOPED",
        sourceId: input.sourceId,
        lotKey: input.sourcePositionKey,
        evidenceRefs: input.evidenceRefs,
      },
      quantity: { amount: quantity, unitRef: input.representationKey },
      valuation: value === null ? {
        state: "UNPRICED",
        value: null,
        sourceRef: null,
        observedAt: input.observedAt,
        validUntil: null,
        freshnessPolicy: null,
        reason: "The holding snapshot has no explicit price observation.",
        conflictRefs: [],
      } : {
        state: "PRICED",
        value,
        sourceRef: input.price?.sourceRef ?? null,
        observedAt: input.price?.observedAt ?? null,
        validUntil: input.price?.validUntil ?? null,
        freshnessPolicy: input.price?.freshnessPolicy ?? null,
        reason: null,
        conflictRefs: [],
      },
      valuationContribution: "ASSET",
      cashState: "NOT_CASH",
      settlementState: "SETTLED",
      custodyClass: "SELF_CUSTODY",
      exposureLegs: [{
        legId: `${input.positionSlotKey}:principal`,
        underlyingKey: input.underlyingKey,
        role: "PRINCIPAL",
        phase: "SETTLED",
        direction: "LONG",
        notional: value,
        unknownReason: value === null ? "No exact price observation is available." : null,
        observedAt: input.price?.observedAt ?? input.observedAt,
        validUntil: input.price?.validUntil ?? null,
        freshnessPolicy: input.price?.freshnessPolicy ?? { maxAgeSeconds: null },
        evidenceRefs: input.evidenceRefs,
      }],
    })];
  });
}
