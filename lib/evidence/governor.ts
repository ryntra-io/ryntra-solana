/**
 * The credit governor's contract — what an adapter needs from the thing that
 * counts credits, and nothing about how it counts them.
 *
 * An adapter reserves the expected cost of a call before it is made and
 * settles on the provider's own answer afterwards; whether the counting
 * lives in a shared database (the product) or in one process (a script, a
 * test, the open example) is the governor's business. `createMemoryGovernor`
 * is the one-process implementation: ceilings, reservations and settlements
 * in a plain object, gone when the process ends — right for a script that
 * reads a handful of figures with its own key, wrong for anything two
 * instances share.
 */

export type GovernorRefusal = Readonly<{ ok: false; code: "NO_BUDGET" | "BUDGET_EXHAUSTED" | "LEDGER_UNAVAILABLE"; message: string }>;

export type GovernorSettlement = Readonly<{
  succeeded: boolean;
  /** Credits the provider said it deducted, or null when the answer carried no such header. */
  creditsUsed: number | null;
  /** The balance the provider reported after the request, or null. */
  creditsRemaining: number | null;
  requestId: string | null;
  retried: boolean;
  /** Why the call failed, in the client's own kinds (auth, plan, rate, timeout, …); null on success or when the adapter does not say. */
  failureKind?: string | null;
}>;

export type CreditGovernor = Readonly<{
  reserve(input: { expectedCredits: number; nowMs: number }): Promise<Readonly<{ ok: true }> | GovernorRefusal>;
  settle(input: { expectedCredits: number; settlement: GovernorSettlement; nowMs: number }): Promise<void>;
}>;

export type MemoryGovernorState = Readonly<{
  ceiling: number;
  reservedCredits: number;
  usedCredits: number;
  requests: number;
  succeeded: number;
  failed: number;
  retries: number;
  remainingReported: number | null;
  lastRequestId: string | null;
  /** Failures by the client's kind, so a script can say what went wrong and how often. */
  failures: Readonly<Record<string, number>>;
}>;

/** One process, one ceiling: the governor a script or an example runs with. */
export function createMemoryGovernor(ceiling: number): CreditGovernor & Readonly<{ state(): MemoryGovernorState }> {
  const state = { ceiling, reservedCredits: 0, usedCredits: 0, requests: 0, succeeded: 0, failed: 0, retries: 0, remainingReported: null as number | null, lastRequestId: null as string | null, failures: {} as Record<string, number> };
  return {
    async reserve({ expectedCredits }) {
      if (!Number.isInteger(ceiling) || ceiling <= 0) return { ok: false, code: "NO_BUDGET", message: "No credit ceiling was given; no call is made." };
      if (!Number.isInteger(expectedCredits) || expectedCredits <= 0) return { ok: false, code: "BUDGET_EXHAUSTED", message: "A call with no known price is not made." };
      if (Math.max(state.reservedCredits, state.usedCredits) + expectedCredits > ceiling) {
        return { ok: false, code: "BUDGET_EXHAUSTED", message: `The ceiling of ${ceiling} credits would be crossed (${Math.max(state.reservedCredits, state.usedCredits)} spent).` };
      }
      state.reservedCredits += expectedCredits;
      return { ok: true };
    },
    async settle({ expectedCredits, settlement }) {
      /* A missing header books the expected cost — an unknown price is never zero. */
      state.usedCredits += settlement.creditsUsed === null ? expectedCredits : Math.max(0, Math.round(settlement.creditsUsed));
      state.requests += 1;
      if (settlement.succeeded) state.succeeded += 1;
      else {
        state.failed += 1;
        const kind = settlement.failureKind ?? "unknown";
        state.failures[kind] = (state.failures[kind] ?? 0) + 1;
      }
      if (settlement.retried) state.retries += 1;
      if (settlement.creditsRemaining !== null) state.remainingReported = settlement.creditsRemaining;
      if (settlement.requestId !== null) state.lastRequestId = settlement.requestId;
    },
    state: () => ({ ...state, failures: { ...state.failures } }),
  };
}
