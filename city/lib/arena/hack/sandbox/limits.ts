/**
 * The ceilings of a Hack run (CITY-224, spec «How the sandbox works» → «Limits»): steps (as Code — 20), compute units
 * per step and per run, and wall time. Going over a ceiling is the seat's loss, never a crash: the harness stops
 * feeding inputs, the log ends there, and the result says why (`sandbox.ts`).
 *
 *   steps     — inputs the run plays; past it the harness stops (`stopped: "steps"`). The judge checks it again.
 *   cuPerStep — the compute budget of one transaction; the engine enforces it, a step that needs more fails.
 *   cuTotal   — all the compute of a run; the step that goes over ends the run as lost (`stop: "cu"` in the result).
 *               Compute is deterministic, so this ceiling is inside the replayed game.
 *   ms        — wall time of the run, measured by the harness between steps. Time is not deterministic, so it only
 *               stops the run; the log never carries it.
 *   costMicroUsd — the ceiling of the agent's model spend for the run (the class's ceiling, CITY-45). The runner
 *               measures it (CITY-225); the judge enforces it from the rules.
 *
 * Pure: no store, no clock, no network.
 */

export type SandboxLimits = {
  readonly steps: number;
  readonly cuPerStep: number;
  readonly cuTotal: number;
  readonly ms: number;
  readonly costMicroUsd?: number;
};

/** The highest any order may set: 20 steps (decision 72), Solana's 1.4M CU per transaction, two minutes. */
export const LIMIT_CAPS = { steps: 20, cuPerStep: 1_400_000, cuTotal: 20 * 1_400_000, ms: 120_000, costMicroUsd: 50_000_000 } as const;

export const DEFAULT_LIMITS: SandboxLimits = { steps: 20, cuPerStep: 1_400_000, cuTotal: 6_000_000, ms: 30_000 };

export type LimitIssue = { readonly code: "BAD_LIMITS"; readonly detail: string };

const KEYS = ["steps", "cuPerStep", "cuTotal", "ms", "costMicroUsd"] as const;

/** The limits of a run: the defaults with an order's own over them. */
export const limitsOf = (over: Partial<SandboxLimits> = {}): SandboxLimits => ({ ...DEFAULT_LIMITS, ...over });

/** What is wrong with a set of limits; `null` when a run may be played under them. */
export function checkLimits(limits: unknown): LimitIssue | null {
  if (limits === null || typeof limits !== "object") return { code: "BAD_LIMITS", detail: "limits are not an object" };
  const l = limits as Record<string, unknown>;
  for (const key of KEYS) {
    const value = l[key];
    if (key === "costMicroUsd" && value === undefined) continue;
    if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > LIMIT_CAPS[key]) {
      return { code: "BAD_LIMITS", detail: `${key}: a whole number 1…${LIMIT_CAPS[key]}` };
    }
  }
  if ((l.cuTotal as number) < (l.cuPerStep as number)) return { code: "BAD_LIMITS", detail: "cuTotal must hold at least one step" };
  return null;
}
