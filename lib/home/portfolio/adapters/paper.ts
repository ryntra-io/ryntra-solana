import type { PaperTrade } from "../../../paper/rpc.ts";
import { createPositionRecord } from "../position.ts";
import { adapterSuccess, safeAdapter, type AdapterResult } from "./types.ts";

export function normalizePaperTrade(input: Readonly<{
  ownerRef: string;
  accountRef: string;
  sourceId: string;
  sourceVersion: string | null;
  observedAt: string;
  evidenceRefs: readonly string[];
  trade: PaperTrade;
}>): AdapterResult {
  if (input.trade.status === "closed") return adapterSuccess([]);
  return safeAdapter(input.evidenceRefs, () => [createPositionRecord({
    schemaVersion: "1.0.0",
    ownerRef: input.ownerRef,
    source: {
      sourceId: input.sourceId,
      connectionId: null,
      sourcePositionKey: input.trade.id,
      sourceVersion: input.sourceVersion,
      observedAt: input.observedAt,
      evidenceRefs: input.evidenceRefs,
    },
    accountRef: input.accountRef,
    networkRef: "paper",
    venueRef: null,
    protocolRef: null,
    instrumentKey: input.trade.market,
    underlyingKey: input.trade.market,
    representationKey: `paper:${input.trade.market}`,
    positionType: "PAPER",
    positionSlotKey: input.trade.id,
    book: "PAPER",
    accountingRole: "PAPER",
    economicLot: {
      state: "SOURCE_SCOPED",
      sourceId: input.sourceId,
      lotKey: input.trade.id,
      evidenceRefs: input.evidenceRefs,
    },
    quantity: null,
    valuation: {
      state: "UNPRICED",
      value: null,
      sourceRef: null,
      observedAt: input.observedAt,
      validUntil: null,
      freshnessPolicy: null,
      reason: "PaperTrade uses JavaScript number fields without an exact source decimal serialization.",
      conflictRefs: [],
    },
    valuationContribution: "NONE",
    cashState: "NOT_CASH",
    settlementState: "PAPER_OPEN",
    custodyClass: "PAPER_ONLY",
    exposureLegs: [{
      legId: `paper:${input.trade.id}`,
      underlyingKey: input.trade.market,
      role: "DERIVATIVE_NOTIONAL",
      phase: "PAPER",
      direction: input.trade.side === "long" ? "LONG" : "SHORT",
      notional: null,
      unknownReason: "PaperTrade number fields do not preserve exact decimal source text.",
      observedAt: input.observedAt,
      validUntil: null,
      freshnessPolicy: { maxAgeSeconds: null },
      evidenceRefs: input.evidenceRefs,
    }],
  })]);
}
