/**
 * The A2A adapter, entering Agent Control through the manifest like every
 * other provider: one module plus registry definitions, with zero edits to
 * `contracts.ts` or `registry.ts`.
 *
 * **A2A is not a chain and it is not a venue.** It is a protocol two agent
 * systems speak to each other over, so `chainRefs` is empty and stays empty —
 * an inbound task carries no network of its own, and a chain reference here
 * would be a fact nobody observed.
 *
 * **The canonical class is `RECORD_ONLY`, and that is the whole boundary.**
 * A2A specification v1.0.0 §7.6.4 says it plainly: *"Agents MUST NOT treat the
 * `TASK_STATE_AUTH_REQUIRED` state transition, by itself, as authorization for
 * any particular operation"*, and the protocol *"does not define the scope,
 * representation, validity, or revocation semantics"* of whatever authorization
 * follows. So an inbound task can only ever be a record of something another
 * system said. A verifier that has never heard of A2A still reads from the
 * canonical class that this action moves no value and commits nothing.
 *
 * `budget` is `FORBIDDEN` for the same reason. A task that arrives with a
 * budget attached would be a spending decision made by a caller, which is the
 * one thing a caller may never make.
 */

export const A2A_ADAPTER_REF = "adapter:a2a@1";
export const A2A_INBOUND_TASK_ACTION_REF = "action:a2a/inbound-task@1";

/**
 * Registry definitions as plain literals. The registry's own schema validates
 * them at build time; importing the registry here would create exactly the
 * central coupling the manifest exists to avoid.
 */
export const A2A_DEFINITIONS = [
  {
    kind: "ADAPTER",
    ref: A2A_ADAPTER_REF,
    displayName: "A2A 1.0",
    capability: "READ_ONLY",
    chainRefs: [],
    status: "ALLOWED",
  },
  {
    kind: "ACTION_SCHEMA",
    ref: A2A_INBOUND_TASK_ACTION_REF,
    displayName: "Record inbound task",
    adapterRef: A2A_ADAPTER_REF,
    canonicalClass: "RECORD_ONLY",
    budget: "FORBIDDEN",
    status: "ALLOWED",
  },
] as const;
