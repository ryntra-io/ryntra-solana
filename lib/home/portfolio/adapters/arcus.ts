import type { ArcusPosition } from "../../../arcus/public.ts";
import { compareDecimal, decimal, multiplyDecimal, parseDecimalText } from "../decimal.ts";
import { createPositionRecord } from "../position.ts";
import { safeAdapter, type AdapterResult } from "./types.ts";

export function normalizeArcusPosition(input: Readonly<{
  ownerRef: string;
  accountRef: string;
  connectionId: string;
  sourceId: string;
  sourceVersion: string | null;
  observedAt: string;
  evidenceRefs: readonly string[];
  networkRef: string;
  instrumentKey: string;
  underlyingKey: string;
  representationKey: string;
  quoteCurrency: string;
  freshnessPolicy: Readonly<{ maxAgeSeconds: number | null }>;
  position: ArcusPosition;
}>): AdapterResult {
  return safeAdapter(input.evidenceRefs, () => {
    const size = parseDecimalText(input.position.size);
    if (compareDecimal(size, decimal("0", 0)) <= 0) throw new TypeError("Arcus size must be positive");
    const mark = input.position.markPrice === undefined ? null : parseDecimalText(input.position.markPrice);
    if (mark !== null && compareDecimal(mark, decimal("0", 0)) <= 0) throw new TypeError("Arcus mark must be positive");
    const notional = mark === null ? null : {
      amount: multiplyDecimal(size, mark, Math.min(18, size.scale + mark.scale), "HALF_EVEN"),
      currency: input.quoteCurrency,
    };
    const aggregateKey = `aggregate:${input.position.marketDisplayName}:${input.position.side}`;
    return [createPositionRecord({
      schemaVersion: "1.0.0",
      ownerRef: input.ownerRef,
      source: {
        sourceId: input.sourceId,
        connectionId: input.connectionId,
        sourcePositionKey: aggregateKey,
        sourceVersion: input.sourceVersion,
        observedAt: input.observedAt,
        evidenceRefs: input.evidenceRefs,
      },
      accountRef: input.accountRef,
      networkRef: input.networkRef,
      venueRef: "arcus",
      protocolRef: null,
      instrumentKey: input.instrumentKey,
      underlyingKey: input.underlyingKey,
      representationKey: input.representationKey,
      positionType: "PERP",
      positionSlotKey: aggregateKey,
      book: "LIVE",
      accountingRole: "PRIMARY",
      economicLot: {
        state: "SOURCE_SCOPED",
        sourceId: input.sourceId,
        lotKey: aggregateKey,
        evidenceRefs: input.evidenceRefs,
      },
      quantity: { amount: size, unitRef: input.instrumentKey },
      valuation: {
        state: "UNPRICED",
        value: null,
        sourceRef: null,
        observedAt: input.observedAt,
        validUntil: null,
        freshnessPolicy: null,
        reason: "ArcusPosition exposes mark/PnL but no complete position equity valuation.",
        conflictRefs: [],
      },
      valuationContribution: "NONE",
      cashState: "NOT_CASH",
      settlementState: "VENUE_OPEN",
      custodyClass: "VENUE_POSITION",
      exposureLegs: [{
        legId: `${aggregateKey}:notional`,
        underlyingKey: input.underlyingKey,
        role: "DERIVATIVE_NOTIONAL",
        phase: "SETTLED",
        direction: input.position.side,
        notional,
        unknownReason: notional === null ? "ArcusPosition did not include markPrice." : null,
        observedAt: input.observedAt,
        validUntil: null,
        freshnessPolicy: input.freshnessPolicy,
        evidenceRefs: input.evidenceRefs,
      }],
    })];
  });
}
