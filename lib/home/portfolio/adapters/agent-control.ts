import { AgentBudgetLedgerSchema, type AgentBudgetLedger } from "../../../agent-control/owner-control.ts";
import { createPositionRecord } from "../position.ts";
import { adapterFailure, adapterSuccess, exactDecimalAtScale, safeAdapter, type AdapterResult } from "./types.ts";

export function normalizeAgentBudgetEntry(input: Readonly<{
  ledger: AgentBudgetLedger;
  entryId: string;
  sourceId: string;
  connectionId: string | null;
  assetScale: number;
  evidenceRefs: readonly string[];
}>): AdapterResult {
  let ledger: AgentBudgetLedger;
  try {
    ledger = AgentBudgetLedgerSchema.parse(input.ledger);
  } catch {
    return adapterFailure("INVALID_RECORD", "Agent budget ledger is invalid.", input.evidenceRefs);
  }
  const entry = ledger.entries.find((item) => item.entryId === input.entryId);
  if (!entry) return adapterFailure("UNSUPPORTED_SOURCE_STATE", "Agent budget entry does not exist.", input.evidenceRefs);
  if (entry.state === "RELEASED") return adapterSuccess([]);
  return safeAdapter(input.evidenceRefs, () => {
    const amount = exactDecimalAtScale(entry.amount, input.assetScale);
    const referenceOnly = entry.state === "SETTLED";
    return [createPositionRecord({
      schemaVersion: "1.0.0",
      ownerRef: ledger.ownerRef,
      source: {
        sourceId: input.sourceId,
        connectionId: input.connectionId,
        sourcePositionKey: entry.entryId,
        sourceVersion: String(ledger.version),
        observedAt: entry.updatedAt,
        evidenceRefs: input.evidenceRefs,
      },
      accountRef: ledger.ownerRef,
      networkRef: ledger.assetRef.split("/")[0] || "agent-control",
      venueRef: null,
      protocolRef: "agent-control",
      instrumentKey: ledger.assetRef,
      underlyingKey: ledger.assetRef,
      representationKey: ledger.assetRef,
      positionType: "AGENT_COMMITMENT",
      positionSlotKey: entry.actionId,
      book: "LIVE",
      accountingRole: referenceOnly ? "REFERENCE" : "RESERVATION",
      economicLot: {
        state: "SOURCE_SCOPED",
        sourceId: input.sourceId,
        lotKey: `${ledger.ledgerId}:${entry.entryId}`,
        evidenceRefs: input.evidenceRefs,
      },
      quantity: null,
      valuation: {
        state: "UNPRICED",
        value: null,
        sourceRef: null,
        observedAt: entry.updatedAt,
        validUntil: null,
        freshnessPolicy: null,
        reason: "A budget reservation is not an owned asset valuation.",
        conflictRefs: [],
      },
      valuationContribution: "NONE",
      cashState: referenceOnly ? "NOT_CASH" : "COMMITTED",
      settlementState: entry.state,
      custodyClass: "OWNER_BUDGET",
      exposureLegs: [{
        legId: entry.entryId,
        underlyingKey: ledger.assetRef,
        role: "CASH_FLOW",
        phase: referenceOnly ? "REFERENCE" : "COMMITTED",
        direction: "NEUTRAL",
        notional: { amount, currency: ledger.assetRef },
        unknownReason: null,
        observedAt: entry.updatedAt,
        validUntil: entry.updatedAt,
        freshnessPolicy: { maxAgeSeconds: 0 },
        evidenceRefs: input.evidenceRefs,
      }],
    })];
  });
}
