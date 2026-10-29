/**
 * Ryntra asking somebody else's agent for work — the outbound path, beside the
 * inbound one.
 *
 * `./inbound.ts` records a task another system describes to us.
 * `./interface.ts` answers a message another system sends us. This module is
 * the direction neither covers: Ryntra places an order and then has to decide
 * what the other party's answers mean.
 *
 * ## Nothing leaves this repository
 *
 * `placeOutboundOrder` builds the message and claims the ledger row. It does
 * not send: the transport is a port with no implementation here, the same
 * arrangement the x402 hub uses for its facilitator. That is what makes «no
 * outbound call is made on anybody's behalf» a property of the code rather than
 * a claim in a comment — there is no client to call.
 *
 * ## A peer is an operator's decision, never a message's
 *
 * The target interface comes from the peer's own Agent Card, and the card's
 * origin has to be one an operator registered. An agent that could order work
 * from a URL it read in a prompt is the defect the procurement registry exists
 * to prevent, one protocol over: the card is somebody else's document, and a
 * document that chose its own endpoint would be choosing where Ryntra's money
 * goes. With no registered origins — the state today — every order refuses at
 * `PEER_ORIGIN_NOT_REGISTERED`, and that is the correct answer rather than a
 * gap to work around.
 *
 * ## «Completed» is a claim about delivery
 *
 * The protocol's own words for the state are «the task has finished
 * successfully», and whose task it is matters: it is theirs. Ryntra reading
 * that state learns that the other party asserts it finished. The ledger moves
 * a field named for that claim and leaves the delivery axis alone, because
 * `../payments/vocabulary.ts` lists what may speak to delivery and a
 * counterparty's claim about its own performance is explicitly not among them.
 *
 * So an order is delivered when Ryntra reads the artifact — the resource
 * answered, the document arrived — or when the owner says on the record what
 * they received. Until then: a claim, with reconciliation pending. That is the
 * difference between «they say they are done» and «we have it», and the second
 * is the only one that closes an order.
 *
 * ## A deadline that passes is an unknown
 *
 * No answer by the deadline makes the order `UNKNOWN`, and nothing is
 * re-ordered. Re-placing an order whose fate nobody knows is how one piece of
 * work gets commissioned twice; the idempotency key would not even stop it,
 * because a re-placement under a new key is a new order by construction.
 */

import { z } from "zod";

import { AGENT_HASH_DOMAINS_V2, hashAgentPayloadV2 } from "../canonical.ts";
import {
  A2A_HTTP_JSON_METHODS,
  A2A_PROTOCOL_BINDINGS,
  A2A_SERVED_BINDING,
  A2A_WIRE_VERSION,
} from "./card.ts";
import {
  a2aStateClass,
  requestDigest,
  type A2aTaskLedger,
  type A2aTaskRecord,
} from "./task-ledger.ts";
import { A2A_TASK_STATES, type A2aTaskState } from "./inbound.ts";

export const OUTBOUND_REFUSALS = [
  "PEER_CARD_MALFORMED",
  "PEER_CARD_SERVES_NO_HTTP_JSON_INTERFACE",
  "PEER_INTERFACE_NOT_ABSOLUTE_HTTPS",
  "PEER_PROTOCOL_VERSION_UNSUPPORTED",
  "PEER_ORIGIN_NOT_REGISTERED",
  "ORDER_MALFORMED",
  "ORDER_DEADLINE_NOT_IN_FUTURE",
  "PEER_TASK_MALFORMED",
  "PEER_TASK_STATE_INDETERMINATE",
  "PEER_TASK_NOT_THE_ONE_ORDERED",
] as const;

export type OutboundRefusal = (typeof OUTBOUND_REFUSALS)[number];

export class OutboundError extends Error {
  readonly reasonCode: OutboundRefusal;

  constructor(reasonCode: OutboundRefusal, detail: string) {
    super(`${reasonCode}: ${detail}`);
    this.name = "OutboundError";
    this.reasonCode = reasonCode;
  }
}

/* ── the peer's card, as it arrives ───────────────────────────────────── */

const PeerInterfaceSchema = z
  .object({
    url: z.string().min(1).max(512),
    protocolBinding: z.string().min(1).max(32),
    protocolVersion: z.string().min(1).max(16),
    tenant: z.string().min(1).max(128).optional(),
  })
  .strict();

/**
 * The part of a peer's card this module reads.
 *
 * Deliberately a subset, and `passthrough` is deliberately absent: a card may
 * carry fields this product has never heard of, and reading them would be
 * reading somebody else's extension as though we implemented it. What is
 * missing from the subset is also what is missing from the digest, which is why
 * the digest is computed over the parsed subset rather than the raw document —
 * a digest over bytes nobody read would be a commitment to bytes nobody read.
 */
export const PeerCardSchema = z
  .object({
    name: z.string().min(1).max(128),
    description: z.string().max(1_024).optional(),
    version: z.string().min(1).max(32),
    supportedInterfaces: z.array(PeerInterfaceSchema).min(1).max(8),
    skills: z
      .array(z.object({ id: z.string().min(1).max(128) }).passthrough())
      .max(64)
      .optional(),
  })
  .strict();

export type PeerCard = z.output<typeof PeerCardSchema>;

export type OutboundTarget = Readonly<{
  /** The absolute URL `message:send` is posted to. */
  sendUrl: string;
  origin: string;
  peerName: string;
  peerVersion: string;
  cardDigest: string;
  protocolVersion: string;
}>;

/**
 * Resolve where an order would go, or refuse by name.
 *
 * The order of the checks is the usual one and it is load-bearing here too. A
 * card with no HTTP+JSON interface is refused before its URL is looked at,
 * because «this peer does not speak the binding we speak» outranks «its address
 * is wrong»; an unregistered origin is refused last, because telling a caller
 * the origin is not registered implies the rest of the card was fine.
 */
export function resolveOutboundTarget(
  rawCard: unknown,
  registeredOrigins: readonly string[],
): OutboundTarget {
  const parsed = PeerCardSchema.safeParse(rawCard);
  if (!parsed.success) {
    throw new OutboundError("PEER_CARD_MALFORMED", "the card did not match the bounded shape this module reads");
  }
  const card = parsed.data;

  const served = card.supportedInterfaces.filter(
    (entry) => entry.protocolBinding === A2A_SERVED_BINDING,
  );
  if (served.length === 0) {
    throw new OutboundError(
      "PEER_CARD_SERVES_NO_HTTP_JSON_INTERFACE",
      `this product speaks ${A2A_SERVED_BINDING}; the card declares ${card.supportedInterfaces
        .map((entry) => entry.protocolBinding)
        .join(", ")}`,
    );
  }

  const chosen = served[0];
  if (!/^https:\/\/[^/\s]+(\/[^\s]*)?$/.test(chosen.url)) {
    throw new OutboundError(
      "PEER_INTERFACE_NOT_ABSOLUTE_HTTPS",
      "an interface a card publishes is an absolute https URL; anything else is an address nobody can check",
    );
  }
  if (chosen.protocolVersion !== A2A_WIRE_VERSION) {
    throw new OutboundError(
      "PEER_PROTOCOL_VERSION_UNSUPPORTED",
      `this path speaks ${A2A_WIRE_VERSION} and the interface declares ${chosen.protocolVersion}`,
    );
  }

  const url = new URL(chosen.url);
  /* The whole origin, parsed, not a string that contains it: a host that merely
     ends with a registered name is a different host, and the procurement
     registry already learned this the hard way. */
  const origin = url.origin;
  if (!registeredOrigins.includes(origin)) {
    throw new OutboundError(
      "PEER_ORIGIN_NOT_REGISTERED",
      `${origin} is not an origin an operator registered; a peer read from a message is not a peer`,
    );
  }

  const base = chosen.url.replace(/\/+$/, "");
  return Object.freeze({
    sendUrl: `${base}${A2A_HTTP_JSON_METHODS.messageSend}`,
    origin,
    peerName: card.name,
    peerVersion: card.version,
    cardDigest: hashAgentPayloadV2(AGENT_HASH_DOMAINS_V2.a2aAgentCard, card),
    protocolVersion: chosen.protocolVersion,
  });
}

/** The bindings a peer may declare that this path still cannot use. */
export const PEER_BINDINGS_NOT_USED = Object.freeze(
  A2A_PROTOCOL_BINDINGS.filter((binding) => binding !== A2A_SERVED_BINDING),
);

/* ── placing one order ────────────────────────────────────────────────── */

export type OutboundOrder = Readonly<{
  /** The key the order is placed under. The same key is the same order. */
  idempotencyKey: string;
  /** What is being asked for, as the structured part of one message. */
  ask: Readonly<Record<string, unknown>>;
  /** Unix milliseconds by which a terminal answer is expected. */
  deadlineMs: number;
}>;

export type OutboundMessage = Readonly<{
  messageId: string;
  contextId: string;
  role: "ROLE_USER";
  parts: readonly Readonly<{ data: Readonly<Record<string, unknown>> }>[];
}>;

export type PlacedOrder = Readonly<{
  target: OutboundTarget;
  taskId: string;
  /** The body a transport would post, built and not sent. */
  request: Readonly<{ url: string; headers: Readonly<Record<string, string>>; body: Readonly<{ message: OutboundMessage }> }>;
  record: A2aTaskRecord;
  /** True when this key had already been placed and this is that order. */
  replay: boolean;
  limitations: readonly string[];
}>;

/**
 * The transport an order would go out on.
 *
 * A port, with no implementation in this repository. Giving it one is a
 * separate step with its own review, because it is the step that turns a record
 * into a request somebody else receives.
 */
export type A2aTransport = Readonly<{
  send(request: PlacedOrder["request"]): Promise<unknown>;
}>;

const ORDER_LIMITATIONS = Object.freeze([
  "Built, not sent. There is no transport implementation here, so no request leaves this process.",
  "A terminal state from the peer is a claim about its own work. The order closes when Ryntra reads the deliverable.",
  "No answer by the deadline makes the order unknown. Nothing is re-ordered on an unknown.",
]);

/** The task identity an order is tracked under, derived from its own key. */
export function outboundTaskId(idempotencyKey: string): string {
  return `order-${requestDigest(idempotencyKey).slice(2, 34)}`;
}

/**
 * Place one order: resolve the peer, build the message, claim the row.
 *
 * The same idempotency key resolves to the same task id before the store is
 * consulted, so a resend is the same order even if the first attempt never
 * reached the ledger.
 */
export async function placeOutboundOrder({
  rawCard,
  registeredOrigins,
  order,
  ledger,
  nowMs,
}: {
  rawCard: unknown;
  registeredOrigins: readonly string[];
  order: OutboundOrder;
  ledger: A2aTaskLedger;
  nowMs: number;
}): Promise<PlacedOrder> {
  const target = resolveOutboundTarget(rawCard, registeredOrigins);

  if (order.idempotencyKey.trim().length < 8) {
    throw new OutboundError(
      "ORDER_MALFORMED",
      "an idempotency key is at least eight characters; a short one collides between orders nobody meant to join",
    );
  }
  if (!Number.isFinite(order.deadlineMs) || order.deadlineMs <= nowMs) {
    throw new OutboundError(
      "ORDER_DEADLINE_NOT_IN_FUTURE",
      "an order with no future deadline is an order that is already unknown",
    );
  }

  const taskId = outboundTaskId(order.idempotencyKey);
  const message: OutboundMessage = Object.freeze({
    messageId: `${taskId}-1`,
    contextId: taskId,
    role: "ROLE_USER" as const,
    parts: Object.freeze([Object.freeze({ data: order.ask })]),
  });

  const claim = await ledger.claim({
    side: "PLACED",
    taskId,
    contextId: taskId,
    requestKey: order.idempotencyKey,
    requestDigest: requestDigest(order.ask),
    peerCardDigest: target.cardDigest,
    state: "TASK_STATE_SUBMITTED",
    deadlineMs: order.deadlineMs,
    nowMs,
  });

  const replay = !claim.ok;
  const record = claim.record;
  if (!record) {
    /* The only way here is a task id held under a different key, which cannot
       happen while the id is derived from the key — kept so that a future
       change to the derivation fails loudly instead of silently handing one
       caller another caller's order. */
    throw new OutboundError(
      "ORDER_MALFORMED",
      claim.ok ? "the ledger accepted the order without returning it" : claim.detail,
    );
  }

  return Object.freeze({
    target,
    taskId,
    request: Object.freeze({
      url: target.sendUrl,
      headers: Object.freeze({
        "content-type": "application/a2a+json",
        "A2A-Version": A2A_WIRE_VERSION,
      }),
      body: Object.freeze({ message }),
    }),
    record,
    replay,
    limitations: ORDER_LIMITATIONS,
  });
}

/* ── reading what the peer says ───────────────────────────────────────── */

const PeerTaskSchema = z
  .object({
    id: z.string().min(1).max(128),
    contextId: z.string().min(1).max(128).optional(),
    status: z
      .object({
        state: z.string().min(1).max(64),
        timestamp: z.string().min(1).max(64).optional(),
      })
      .passthrough(),
    artifacts: z
      .array(z.object({ artifactId: z.string().min(1).max(128) }).passthrough())
      .max(16)
      .optional(),
  })
  .passthrough();

export type PeerTaskReading = Readonly<{
  taskId: string;
  state: A2aTaskState;
  stateClass: "OPEN" | "INTERRUPTED" | "TERMINAL";
  /** How many artifacts the peer says it produced. Not evidence of any of them. */
  artifactCount: number;
  /** What this answer establishes about delivery. Never `DELIVERED`. */
  claims: "NOTHING" | "COMPLETED" | "WILL_NOT_DELIVER";
  /** Why the claim is not evidence, in the words a reader needs. */
  because: string;
  limitations: readonly string[];
}>;

/**
 * Read one task answer from a peer.
 *
 * The id is checked against the order's own task id, because a peer answering
 * about a different task is either confused or testing us, and applying its
 * state to our row would be applying somebody else's outcome to our money.
 */
export function readPeerTask(raw: unknown, expectedTaskId: string): PeerTaskReading {
  const parsed = PeerTaskSchema.safeParse(raw);
  if (!parsed.success) {
    throw new OutboundError("PEER_TASK_MALFORMED", "the answer was not a task of this protocol");
  }
  const peer = parsed.data;
  if (!(A2A_TASK_STATES as readonly string[]).includes(peer.status.state)) {
    throw new OutboundError("PEER_TASK_MALFORMED", "the state is not one the protocol publishes");
  }
  const state = peer.status.state as A2aTaskState;
  if (state === "TASK_STATE_UNSPECIFIED") {
    throw new OutboundError(
      "PEER_TASK_STATE_INDETERMINATE",
      "an indeterminate state is not an answer; the order stays as it was until the deadline decides",
    );
  }
  if (peer.id !== expectedTaskId) {
    throw new OutboundError(
      "PEER_TASK_NOT_THE_ONE_ORDERED",
      `the answer is about ${peer.id} and the order is ${expectedTaskId}`,
    );
  }

  const claims =
    state === "TASK_STATE_COMPLETED"
      ? ("COMPLETED" as const)
      : state === "TASK_STATE_FAILED" || state === "TASK_STATE_CANCELED" || state === "TASK_STATE_REJECTED"
        ? ("WILL_NOT_DELIVER" as const)
        : ("NOTHING" as const);

  return Object.freeze({
    taskId: peer.id,
    state,
    stateClass: a2aStateClass(state),
    artifactCount: peer.artifacts?.length ?? 0,
    claims,
    because:
      claims === "COMPLETED"
        ? "The peer asserts its own task finished. That is a statement by the party with the interest, so it moves a claim field and not the delivery axis."
        : claims === "WILL_NOT_DELIVER"
          ? "The peer says it will not finish. A negative claim about its own work is taken, because believing it only ever withholds credit."
          : "The task has not ended. Nothing about delivery follows from a state in progress.",
    limitations: Object.freeze([
      "An artifact count is what the peer listed. No artifact has been read here.",
      "Delivery is recorded when Ryntra observes the deliverable, or when the owner states on the record what they received.",
    ]),
  });
}

/**
 * Apply a peer's answer to the order's row.
 *
 * Two steps rather than one, and separate on purpose: the state the peer
 * reports and the delivery Ryntra observed are different facts with different
 * sources, and a function that took both at once would invite a caller to pass
 * the first as though it were the second.
 */
export async function applyPeerAnswer({
  ledger,
  reading,
  nowMs,
}: {
  ledger: A2aTaskLedger;
  reading: PeerTaskReading;
  nowMs: number;
}) {
  return ledger.recordTaskState({
    side: "PLACED",
    taskId: reading.taskId,
    state: reading.state,
    nowMs,
  });
}
