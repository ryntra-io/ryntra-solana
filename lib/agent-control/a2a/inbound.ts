/**
 * Inbound A2A, and the one thing it may become.
 *
 * An A2A task arrives from another agent system. It becomes **one proposal**,
 * at `PROPOSE`, waiting for a person. It never becomes owner authority, a
 * mandate, an approval or a signature — and the reason is not a Ryntra house
 * rule bolted onto somebody else's protocol.
 *
 * ## A2A says this about itself
 *
 * Specification v1.0.0 §7.6.4, verbatim: *"Agents MUST NOT treat the
 * `TASK_STATE_AUTH_REQUIRED` state transition, by itself, as authorization for
 * any particular operation."* And in the same section: the protocol *"does not
 * define the scope, representation, validity, or revocation semantics of the
 * authorization decision or credential obtained in response to this state."*
 *
 * So A2A carries no authorization semantics at all, by design, and any
 * implementation that reads one out of it invented it. What Ryntra records is
 * that somebody asked.
 *
 * ## The dangerous shape, and why the two axes exist
 *
 * §7.6.1 permits an agent to *"immediately continue Task processing after
 * receiving the credential, without a requirement that clients send a follow-up
 * message."* In A2A, then, credential in → work resumes. That is a reasonable
 * protocol rule and it is a catastrophic product rule: it would let a
 * credential arriving out of band restart an economic action with no human
 * decision anywhere in the loop.
 *
 * So authentication and authorization are two axes here with no function
 * between them, exactly as payment and service delivery are two axes in
 * `payments/vocabulary.ts`. A credential moves `callerAuthentication`. Nothing
 * in this module moves `ownerAuthorization` past `REQUESTED`, and
 * `GRANTED_BY_OWNER` is drawn on the ladder specifically so that a reader can
 * see the rung this path never reaches.
 *
 * ## Terminal is not settled
 *
 * A2A `completed` is the state of somebody else's task. It is not a Ryntra
 * `MATCHED`, it promotes no Receipt, and it changes no authorization. A
 * terminal task is a record of a terminal task.
 *
 * ## What is stored
 *
 * Exactly this set: the Agent Card digest, task id, context id where
 * applicable, task state, skills, artifacts, the transition into
 * auth-required, and the terminal result. The digest is **computed here from
 * the card that arrived**, never accepted from the caller — a caller-supplied
 * digest is the caller telling us what their own document hashes to.
 */

import { z } from "zod";

import { A2A_INBOUND_TASK_ACTION_REF } from "../adapters/a2a.ts";
import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "../canonical.ts";
import { admitMcpWrite, type AdmittedMcpWrite } from "../mcp/write-gate.ts";

/**
 * The nine `TaskState` values A2A 1.0.0 publishes, in the protobuf form the
 * specification uses.
 *
 * Pinned as literals from the specification rather than reshaped into
 * something friendlier. Earlier A2A revisions used hyphenated strings
 * (`auth-required`, `input-required`); those are not what 1.0.0 publishes, and
 * a test fails on them so that a mirror cannot quietly drift back.
 */
export const A2A_TASK_STATES = [
  "TASK_STATE_UNSPECIFIED",
  "TASK_STATE_SUBMITTED",
  "TASK_STATE_WORKING",
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_REJECTED",
  "TASK_STATE_AUTH_REQUIRED",
] as const;

export type A2aTaskState = (typeof A2A_TASK_STATES)[number];

/** Terminal per the specification's own state table. */
export const A2A_TERMINAL_STATES = [
  "TASK_STATE_COMPLETED",
  "TASK_STATE_FAILED",
  "TASK_STATE_CANCELED",
  "TASK_STATE_REJECTED",
] as const;

/** Interrupted per the specification: work stopped, but the task is not over. */
export const A2A_INTERRUPTED_STATES = [
  "TASK_STATE_INPUT_REQUIRED",
  "TASK_STATE_AUTH_REQUIRED",
] as const;

/**
 * What the caller proved about itself. Never a statement about permission.
 *
 * `CREDENTIAL_VERIFIED` is reachable in principle — a transport that checked a
 * credential would set it — and this module still produces no authorization
 * from it, which is the whole point of keeping the axes apart.
 */
export const A2A_CALLER_AUTHENTICATION = [
  "UNAUTHENTICATED",
  "CREDENTIAL_PRESENTED",
  "CREDENTIAL_VERIFIED",
] as const;

export type A2aCallerAuthentication = (typeof A2A_CALLER_AUTHENTICATION)[number];

/**
 * What the owner decided.
 *
 * `GRANTED_BY_OWNER` exists in this union and is **unreachable from every
 * input this module accepts** — the same device `payments/draft-standards.ts`
 * uses for `PROVEN`. Leaving the rung off the ladder would read as a product
 * where nobody ever authorizes anything; drawing it and never reaching it says
 * the true thing, which is that the step exists and is not here.
 */
export const RYNTRA_OWNER_AUTHORIZATION = [
  "NOT_REQUESTED",
  "REQUESTED",
  "GRANTED_BY_OWNER",
] as const;

export type RyntraOwnerAuthorization = (typeof RYNTRA_OWNER_AUTHORIZATION)[number];

/**
 * What Ryntra knows about the Agent Card's own authenticity.
 *
 * A2A §8.4 lets a card carry a JWS block over an RFC 8785 canonicalization.
 * Ryntra observes whether that block is there and does not check it: verifying
 * it needs the issuer's key and a reason to trust that key, and neither exists
 * here. A verified card would still not be authority — §8.4 is about the card
 * being unmodified, not about the holder being allowed to do anything.
 */
export const A2A_CARD_AUTHENTICITY = ["NOT_ASSERTED", "ASSERTED_UNVERIFIED"] as const;

export type A2aCardAuthenticity = (typeof A2A_CARD_AUTHENTICITY)[number];

export const A2A_INGEST_REFUSALS = [
  "A2A_TASK_STATE_INDETERMINATE",
  "A2A_TASK_MALFORMED",
  "A2A_AGENT_CARD_MALFORMED",
  "A2A_PROTOCOL_VERSION_UNSUPPORTED",
  "A2A_TERMINAL_RESULT_WITHOUT_TERMINAL_STATE",
] as const;

export type A2aIngestRefusal = (typeof A2A_INGEST_REFUSALS)[number];

export class A2aIngestError extends Error {
  readonly reasonCode: A2aIngestRefusal;

  constructor(reasonCode: A2aIngestRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "A2aIngestError";
    this.reasonCode = reasonCode;
  }
}

/** The one protocol generation this mirror is written against. */
export const A2A_PROTOCOL_VERSION = "1.0.0" as const;

const AgentCardSchema = z
  .object({
    name: z.string().min(1).max(128),
    protocolVersion: z.string().min(1).max(32),
    version: z.string().min(1).max(32),
    skills: z.array(z.string().min(1).max(64)).max(32),
    cardAuthenticity: z.enum(A2A_CARD_AUTHENTICITY),
  })
  .strict();

const TaskSchema = z
  .object({
    id: z.string().min(1).max(128),
    contextId: z.string().min(1).max(128).nullable(),
    state: z.string().min(1).max(64),
    artifacts: z
      .array(z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(128) }).strict())
      .max(16),
    terminalResult: z.string().min(1).max(512).nullable(),
  })
  .strict();

export const A2aInboundSchema = z
  .object({
    actionRef: z.literal(A2A_INBOUND_TASK_ACTION_REF),
    task: TaskSchema,
    agentCard: AgentCardSchema,
    callerAuthentication: z.enum(A2A_CALLER_AUTHENTICATION),
  })
  .strict();

export type A2aInbound = z.output<typeof A2aInboundSchema>;

/**
 * What Ryntra keeps of an A2A task, field for field.
 *
 * `promotes` is `null` and there is no value it could take. A field that could
 * name a Receipt would be a field somebody eventually fills in.
 */
export type A2aProposal = Readonly<{
  kind: "AGENT_CONTROL_PROPOSAL";
  phase: "PROPOSE";
  source: "A2A_INBOUND";
  actionRef: string;
  agentCardDigest: string;
  agentCardAuthenticity: A2aCardAuthenticity;
  agentName: string;
  skills: readonly string[];
  taskId: string;
  contextId: string | null;
  taskState: A2aTaskState;
  taskStateClass: "OPEN" | "INTERRUPTED" | "TERMINAL";
  artifacts: readonly Readonly<{ id: string; name: string }>[];
  terminalResult: string | null;
  /** The canonical internal event, when the task asked for authorization. */
  event: "A2A_AUTH_REQUIRED" | null;
  callerAuthentication: A2aCallerAuthentication;
  ownerAuthorization: RyntraOwnerAuthorization;
  /** What this record promotes elsewhere in the product. Always nothing. */
  promotes: null;
  limitations: readonly string[];
  admission: AdmittedMcpWrite;
}>;

function stateClass(state: A2aTaskState): "OPEN" | "INTERRUPTED" | "TERMINAL" {
  if ((A2A_TERMINAL_STATES as readonly string[]).includes(state)) return "TERMINAL";
  if ((A2A_INTERRUPTED_STATES as readonly string[]).includes(state)) return "INTERRUPTED";
  return "OPEN";
}

const BASE_LIMITATIONS = [
  "A2A 1.0 §7.6.4: reaching TASK_STATE_AUTH_REQUIRED is not authorization for any operation.",
  "The Agent Card digest is computed here from the card that arrived, never accepted from the caller.",
] as const;

const TERMINAL_LIMITATIONS = [
  "A terminal A2A task is the state of somebody else's task. It is not a Ryntra MATCHED and promotes no Receipt.",
] as const;

/**
 * Turn one inbound A2A task into one proposal, or refuse it by name.
 *
 * The write gate runs first and owns every refusal about authority, endpoints
 * and registry scope; this function owns only what is specific to A2A. Two
 * layers rather than one because the gate has to be the same gate for every
 * write tool — a bespoke check here would be a second policy nobody diffs
 * against the first.
 */
export function ingestA2aTask(rawInput: unknown): A2aProposal {
  const admission = admitMcpWrite({ tool: "ingest_a2a_task", input: rawInput });

  const parsed = A2aInboundSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new A2aIngestError("A2A_TASK_MALFORMED", "the inbound task did not match the bounded shape");
  }
  const { task, agentCard, callerAuthentication } = parsed.data;

  if (agentCard.protocolVersion !== A2A_PROTOCOL_VERSION) {
    throw new A2aIngestError(
      "A2A_PROTOCOL_VERSION_UNSUPPORTED",
      `this mirror is written against A2A ${A2A_PROTOCOL_VERSION} and reads no other generation`,
    );
  }

  if (!(A2A_TASK_STATES as readonly string[]).includes(task.state)) {
    throw new A2aIngestError("A2A_TASK_MALFORMED", "the task state is not one A2A 1.0.0 publishes");
  }
  const state = task.state as A2aTaskState;

  /* Refused rather than mapped to something. The specification defines
     TASK_STATE_UNSPECIFIED as "an unknown or indeterminate state", and a record
     built from it would assert that Ryntra observed a task whose condition
     nobody knows. */
  if (state === "TASK_STATE_UNSPECIFIED") {
    throw new A2aIngestError(
      "A2A_TASK_STATE_INDETERMINATE",
      "an indeterminate task state is not evidence of a task",
    );
  }

  const klass = stateClass(state);
  if (task.terminalResult !== null && klass !== "TERMINAL") {
    throw new A2aIngestError(
      "A2A_TERMINAL_RESULT_WITHOUT_TERMINAL_STATE",
      "a result on a task that has not ended is a conclusion nobody reached",
    );
  }

  const event = state === "TASK_STATE_AUTH_REQUIRED" ? ("A2A_AUTH_REQUIRED" as const) : null;

  /* The only place ownerAuthorization moves, and it moves exactly one rung:
     from "nobody asked" to "somebody asked". `callerAuthentication` is not read
     here and there is no branch that could read it — that absence is the
     product rule §7.6.1 would otherwise erase. */
  const ownerAuthorization: RyntraOwnerAuthorization = event === null ? "NOT_REQUESTED" : "REQUESTED";

  return Object.freeze({
    kind: "AGENT_CONTROL_PROPOSAL" as const,
    phase: "PROPOSE" as const,
    source: "A2A_INBOUND" as const,
    actionRef: A2A_INBOUND_TASK_ACTION_REF,
    agentCardDigest: hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.a2aAgentCard, agentCard),
    agentCardAuthenticity: agentCard.cardAuthenticity,
    agentName: agentCard.name,
    skills: Object.freeze([...agentCard.skills]),
    taskId: task.id,
    contextId: task.contextId,
    taskState: state,
    taskStateClass: klass,
    artifacts: Object.freeze(task.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
    terminalResult: task.terminalResult,
    event,
    callerAuthentication,
    ownerAuthorization,
    promotes: null,
    limitations: Object.freeze(
      klass === "TERMINAL" ? [...BASE_LIMITATIONS, ...TERMINAL_LIMITATIONS] : [...BASE_LIMITATIONS],
    ),
    admission,
  });
}
