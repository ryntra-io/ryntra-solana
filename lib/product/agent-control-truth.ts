/*
 * The blocking Definition-of-Done checks for Agent Control, and what the
 * repository currently satisfies.
 *
 * Kept out of `agent-control-view.ts` on purpose: that module is `server-only`,
 * which the test runner cannot import, and a gate that cannot run is not a
 * gate. These are plain data so `agent-control-truth.test.mjs` can assert every
 * row against the actual source instead of trusting the flag beside it.
 */

export type AgentControlDodCheck = {
  id: string;
  label: string;
  passed: boolean;
  /** Required whenever `passed` is false: a failing check must say why. */
  blocker?: string;
};

export const AGENT_CONTROL_DOD_CHECKS: readonly AgentControlDodCheck[] = [
  { id: "frozen-serialization", label: "Serialization frozen and golden-tested", passed: true },
  { id: "deterministic-replay", label: "Deterministic replay on a fixed input", passed: true },
  { id: "fail-closed", label: "Unknown input fails closed", passed: true },
  { id: "signed-artifacts", label: "Artifacts signed, verification key published", passed: true },
  { id: "independent-verifier", label: "Verifier reports axes separately, no combined verdict", passed: true },
  { id: "exact-action-auth", label: "Authorization bound to an exact content hash", passed: true },
  { id: "no-generic-signer", label: "No generic signer; no funds move through Ryntra", passed: true },
  {
    id: "enforcement-in-kernel",
    label: "Enforcement grade is a policy-engine field, not a UI property",
    passed: true,
  },
  {
    id: "recovery-case",
    label: "One failure/recovery case with proven completion",
    passed: false,
    blocker: "No recovery state machine is implemented yet.",
  },
];
