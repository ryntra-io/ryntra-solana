// Ryntra Risk Guard v1 — the "Trading Defense System" core (P1).
// Pure functions shared by the terminal (live warnings) and /api/paper (server enforcement).
// It never blocks outright: triggered rules require an explicit acknowledgement (soft block).
// No profit promises — this only makes avoidable mistakes visible before the click.

export type RiskRules = {
  /** Risking more than this % of the paper balance on one trade → warning. */
  maxRiskPctWarn: number;
  /** Realized loss today (UTC) beyond this % of the base balance → ack required. */
  dailyLossLimitPct: number;
  /** This many consecutive losing closed trades → cooldown ack required. */
  lossStreak: number;
  /** Server-owned — never user-configurable. */
  baseBalance: number;
};

export const RISK_RULES: RiskRules = {
  maxRiskPctWarn: 1,
  dailyLossLimitPct: 5,
  lossStreak: 3,
  baseBalance: 10_000,
};

/** Hard bounds for user-configured rules — the server floor is these bounds, not the defaults. */
export const RISK_LIMITS = {
  maxRiskPctWarn: { min: 0.25, max: 5 },
  dailyLossLimitPct: { min: 1, max: 20 },
  lossStreak: { min: 2, max: 10 },
} as const;

/** Sanitize untrusted rules (localStorage or request body) — invalid fields fall back to defaults. */
export function clampRiskRules(raw: unknown): RiskRules {
  const j = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof RiskRules, unknown>>;
  const clamp = (v: unknown, lim: { min: number; max: number }, dflt: number) => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : dflt;
    return Math.min(lim.max, Math.max(lim.min, n));
  };
  return {
    maxRiskPctWarn: clamp(j.maxRiskPctWarn, RISK_LIMITS.maxRiskPctWarn, RISK_RULES.maxRiskPctWarn),
    dailyLossLimitPct: clamp(j.dailyLossLimitPct, RISK_LIMITS.dailyLossLimitPct, RISK_RULES.dailyLossLimitPct),
    lossStreak: Math.round(clamp(j.lossStreak, RISK_LIMITS.lossStreak, RISK_RULES.lossStreak)),
    baseBalance: RISK_RULES.baseBalance,
  };
}

export type RiskAssessment = {
  /** % of balance at risk on this trade (maxLoss / balance). */
  riskPct: number | null;
  overRisk: boolean;
  /** Realized paper PnL for today, UTC. */
  dailyPnl: number;
  dailyLossHit: boolean;
  /** Number of consecutive losing closed trades (most recent first). */
  streak: number;
  streakHit: boolean;
  /** Any rule that demands an explicit acknowledgement before placing. */
  ackRequired: boolean;
};

type ClosedLike = { pnl: number | null; closed_at: string | null };

export function assessRisk(p: {
  maxLoss: number | null;
  balance: number;
  closed: ClosedLike[];
  offHours: boolean;
}, rules: RiskRules = RISK_RULES): RiskAssessment {
  const riskPct = p.maxLoss != null && p.maxLoss > 0 && p.balance > 0 ? (p.maxLoss / p.balance) * 100 : null;
  const overRisk = riskPct != null && riskPct > rules.maxRiskPctWarn;

  const today = new Date().toISOString().slice(0, 10);
  const dailyPnl = p.closed
    .filter((t) => t.closed_at?.slice(0, 10) === today)
    .reduce((s, t) => s + Number(t.pnl ?? 0), 0);
  const dailyLossHit = dailyPnl <= -(rules.baseBalance * rules.dailyLossLimitPct) / 100;

  const sorted = [...p.closed]
    .filter((t) => t.closed_at != null)
    .sort((a, b) => b.closed_at!.localeCompare(a.closed_at!)); // stable: equal timestamps keep input order
  let streak = 0;
  for (const t of sorted) {
    if (Number(t.pnl ?? 0) < 0) streak++;
    else break;
  }
  const streakHit = streak >= rules.lossStreak;

  return {
    riskPct,
    overRisk,
    dailyPnl,
    dailyLossHit,
    streak,
    streakHit,
    ackRequired: dailyLossHit || streakHit || p.offHours,
  };
}
