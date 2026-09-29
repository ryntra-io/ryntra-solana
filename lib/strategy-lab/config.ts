import { FLAGS } from "../../app/config/features.ts";

export const STRATEGY_LAB_EVIDENCE_ENGINE_VERSION = "ryntra-evidence-v1";

function disabledUnlessExplicitlyFalse(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return !["false", "0", "no", "off"].includes(raw.trim().toLowerCase());
}

export function strategyLabPreviewEnabled(): boolean {
  return FLAGS.strategyLab.preview && !disabledUnlessExplicitlyFalse("STRATEGY_LAB_PREVIEW_DISABLED");
}

/** Paid AI remains local-only until quota and idempotency are shared across instances. */
export function strategyLabPaidAiEnabled(): boolean {
  return strategyLabPreviewEnabled() && process.env.NODE_ENV === "development";
}

export type StrategyLabPersistenceState = "source-disabled" | "misconfigured" | "enabled";

export function resolveStrategyLabPersistenceState(
  sourceEnabled: boolean,
  environmentValue: string | undefined,
): StrategyLabPersistenceState {
  if (!sourceEnabled) return "source-disabled";
  return environmentValue === "true" ? "enabled" : "misconfigured";
}

export function strategyLabPersistenceState(): StrategyLabPersistenceState {
  return resolveStrategyLabPersistenceState(
    FLAGS.strategyLab.persistence,
    process.env.STRATEGY_LAB_PERSISTENCE_ENABLED,
  );
}
export function strategyLabPersistenceEnabled(): boolean {
  return strategyLabPreviewEnabled() && strategyLabPersistenceState() === "enabled";
}
