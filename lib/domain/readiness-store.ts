/* DecisionReceipt v1 persistence adapter — PREPARED, NOT APPLIED.
   The backing SQL remains in supabase/prepared/20260712_trade_readiness_v1.sql and no
   production path imports this seam. A future caller must first receive separate migration
   approval, then reuse one receiptKey for transport retries of the exact same immutable
   receipt. receiptKey is deliberately distinct from intent.idempotencyKey. */

import type { InstrumentKey } from "./instrument.ts";
import type {
  ComplianceDecision,
  ExecutionIntent,
  ReadinessPolicy,
  ReadinessVerdict,
  RiskSignal,
  RouteCapabilityClaim,
  TradePlan,
} from "./readiness.ts";

export const DECISION_RECEIPT_SCHEMA_VERSION = 1 as const;

export type DecisionReceiptPayloadV1 = Readonly<{
  schemaVersion: typeof DECISION_RECEIPT_SCHEMA_VERSION;
  kind: "trade-readiness";
  /** UTC epoch milliseconds when the pure evaluator produced the verdict. */
  evaluatedAt: number;
  evaluator: Readonly<{
    id: "evaluate-readiness";
    version: 1;
  }>;
  policy: Readonly<{
    id: "planned-trade" | "spot-swap";
    version: 1;
    config: Readonly<ReadinessPolicy>;
  }>;
  instrument: Readonly<InstrumentKey>;
  capability: Readonly<RouteCapabilityClaim>;
  signals: readonly Readonly<RiskSignal>[];
  plan: Readonly<Omit<TradePlan, "targets">> & {
    readonly targets: readonly string[];
  };
  compliance: Readonly<ComplianceDecision>;
  intent: Readonly<ExecutionIntent> | null;
  verdict: Readonly<Omit<ReadinessVerdict, "reasons">> & {
    readonly reasons: readonly string[];
  };
}>;

export type DecisionReceiptAppendV1 = Readonly<{
  telegramId: number;
  /** UUID minted once for this immutable receipt delivery; never reused for changed content. */
  receiptKey: string;
  receipt: DecisionReceiptPayloadV1;
}>;

export type StoredDecisionReceiptV1 = Readonly<{
  id: string;
  receiptKey: string;
  /** ISO timestamptz serialized by PostgREST; remains unchanged on an exact retry. */
  recordedAt: string;
  receipt: DecisionReceiptPayloadV1;
}>;

export type RpcResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: string }>;

/** Bind lib/supabase-rpc.ts rpcResult(scope, fn, args) before injecting it here. */
export type RpcCall = <T>(
  fn: string,
  args: Record<string, unknown>
) => Promise<RpcResult<T>>;

export async function trrAppend(
  call: RpcCall,
  input: DecisionReceiptAppendV1
): Promise<RpcResult<StoredDecisionReceiptV1>> {
  return call<StoredDecisionReceiptV1>("trr_append", {
    p_telegram_id: input.telegramId,
    p_receipt_key: input.receiptKey,
    p_receipt: input.receipt,
  });
}

export async function trrList(
  call: RpcCall,
  telegramId: number,
  limit = 50
): Promise<RpcResult<StoredDecisionReceiptV1[]>> {
  return call<StoredDecisionReceiptV1[]>("trr_list", {
    p_telegram_id: telegramId,
    p_limit: limit,
  });
}
