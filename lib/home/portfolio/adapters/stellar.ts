import type { AssetIdentity } from "../../../stellar/asset.ts";
import { isResolved, type Evidence } from "../../../stellar/evidence.ts";
import type { HoldingRequirement } from "../../../stellar/reads.ts";
import { compareDecimal, parseDecimalText, rescale } from "../decimal.ts";
import { createPositionRecord } from "../position.ts";
import { adapterFailure, adapterSuccess, safeAdapter, type AdapterResult } from "./types.ts";

function assetKey(asset: AssetIdentity): string {
  return [asset.model, asset.code, asset.issuer ?? "native", asset.contractId ?? "none"].join(":");
}

export function normalizeStellarHolding(input: Readonly<{
  ownerRef: string;
  sourceId: string;
  connectionId: string;
  networkRef: string;
  asset: AssetIdentity;
  evidence: Evidence<HoldingRequirement>;
}>): AdapterResult {
  const evidence = input.evidence;
  const refs = evidence.sources.map((source) => source.ref);
  if (!isResolved(evidence)) {
    return adapterFailure("UNSUPPORTED_SOURCE_STATE", evidence.reason, refs);
  }
  const balance = evidence.data.balance;
  if (balance === null) return adapterSuccess([]);
  if (input.asset.decimals === null) {
    return adapterFailure("SOURCE_CONTRACT_INSUFFICIENT", "Stellar asset decimals are unknown.", refs);
  }
  return safeAdapter(refs, () => {
    const parsed = parseDecimalText(balance);
    const quantity = rescale(parsed, input.asset.decimals as number, "TOWARD_ZERO");
    if (compareDecimal(parsed, quantity) !== 0) throw new TypeError("Stellar balance exceeds asset precision");
    const identity = assetKey(input.asset);
    const slot = `${evidence.data.account}:${identity}`;
    return [createPositionRecord({
      schemaVersion: "1.0.0",
      ownerRef: input.ownerRef,
      source: {
        sourceId: input.sourceId,
        connectionId: input.connectionId,
        sourcePositionKey: slot,
        sourceVersion: null,
        observedAt: evidence.observedAt,
        evidenceRefs: refs,
      },
      accountRef: evidence.data.account,
      networkRef: input.networkRef,
      venueRef: null,
      protocolRef: input.asset.model,
      instrumentKey: identity,
      underlyingKey: identity,
      representationKey: identity,
      positionType: "WALLET_ASSET",
      positionSlotKey: slot,
      book: "LIVE",
      accountingRole: "PRIMARY",
      economicLot: { state: "SOURCE_SCOPED", sourceId: input.sourceId, lotKey: slot, evidenceRefs: refs },
      quantity: { amount: quantity, unitRef: identity },
      valuation: {
        state: "UNPRICED",
        value: null,
        sourceRef: null,
        observedAt: evidence.observedAt,
        validUntil: null,
        freshnessPolicy: null,
        reason: "Stellar holding evidence contains no price observation.",
        conflictRefs: [],
      },
      valuationContribution: "ASSET",
      cashState: "NOT_CASH",
      settlementState: evidence.data.authorized === false ? "UNAUTHORIZED" : "SETTLED",
      custodyClass: "SELF_CUSTODY",
      exposureLegs: [{
        legId: `${slot}:principal`,
        underlyingKey: identity,
        role: "PRINCIPAL",
        phase: "SETTLED",
        direction: "LONG",
        notional: null,
        unknownReason: "Stellar holding evidence contains no price observation.",
        observedAt: evidence.observedAt,
        validUntil: null,
        freshnessPolicy: { maxAgeSeconds: evidence.maxAgeSeconds },
        evidenceRefs: refs,
      }],
    })];
  });
}
