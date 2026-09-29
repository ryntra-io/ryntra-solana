/* Client-side persistence for user-configured Risk Rules (device-local, v1).
   Kept out of lib/risk.ts so the server-shared pure module stays browser-free. */

import { RISK_RULES, clampRiskRules, type RiskRules } from "./risk";

const KEY = "ryntra-risk-rules";

export function loadRiskRules(): RiskRules {
  if (typeof window === "undefined") return RISK_RULES;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return RISK_RULES;
    const j = JSON.parse(raw) as { v?: number } | null;
    if (!j || j.v !== 1) return RISK_RULES;
    return clampRiskRules(j); // clamp doubles as the field validator — degrade, don't crash
  } catch {
    return RISK_RULES;
  }
}

export function saveRiskRules(r: RiskRules): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      v: 1,
      maxRiskPctWarn: r.maxRiskPctWarn,
      dailyLossLimitPct: r.dailyLossLimitPct,
      lossStreak: r.lossStreak,
      // baseBalance deliberately not persisted — server-owned
    }));
  } catch {
    /* quota / private mode — rules simply don't persist */
  }
}
