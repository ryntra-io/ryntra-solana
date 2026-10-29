/**
 * The one A2A method Ryntra answers, and the five it refuses by name.
 *
 * `./inbound.ts` turns a task somebody describes to us into a proposal.
 * `./outbound.ts` places an order with somebody else's agent. This module is
 * the third side: an agent system speaking the protocol over HTTP+JSON, asking
 * Ryntra something directly.
 *
 * ## One method, because one method is what exists
 *
 * `message:send` is served. `message:stream`, `tasks/{id}`,
 * `tasks/{id}:cancel`, `tasks/{id}:subscribe` and the push-notification
 * configs are refused, each with its own reason, and the card's capability
 * flags already say streaming and push notifications are off. Publishing a card
 * that promised them and then refusing at the door would be the shape this
 * repository keeps rejecting: a stated capability no code honours.
 *
 * A refusal names the method rather than answering `404`, because a client
 * cannot tell a path it got wrong from a method nobody serves, and the second
 * is a product fact worth knowing.
 *
 * ## What a served message may ask for
 *
 * A read or a quote, in a structured part. Not prose: there is no language
 * model in this path, and a surface that accepted a sentence would be a surface
 * that guessed. A `data` part carrying a named intent is the whole input
 * vocabulary, and a text-only message is rejected with the shape it should have
 * sent.
 *
 * ## A request that would act ends as rejected, never as auth-required
 *
 * `TASK_STATE_AUTH_REQUIRED` is the tempting answer and it is the wrong one.
 * §7.6.1 lets an agent continue processing as soon as a credential arrives,
 * with no follow-up message required — so a task parked in that state is a task
 * that resumes on a credential, and an action resuming on a credential is
 * exactly what must not exist here. `TASK_STATE_REJECTED` is what the protocol
 * defines for «the agent has decided to not perform the task», it is terminal,
 * and it carries the reason.
 *
 * ## One message, one task
 *
 * The task id is derived from the caller's own `messageId`, so a resend
 * produces the same identity before any storage is consulted, and the ledger
 * then holds that identity once. A client whose connection dropped gets the
 * task it already had.
 *
 * Nothing here signs, sends, builds a transaction or reaches a provider. The
 * only outside read is a side-facts port the caller supplies, which is Ryntra
 * reading its own catalogue.
 */

import { z } from "zod";

import type { SideFacts } from "../../core/fee-policy.ts";
import {
  EXTERNAL_EXECUTION_CLOSED,
  ROUTER_INTENT_KINDS,
  RouterError,
  quoteLaunchFee,
  quoteTradeFee,
  readTariff,
  type RouterIntentKind,
} from "../external/router.ts";
import { A2A_HTTP_JSON_METHODS, A2A_WIRE_VERSION, RYNTRA_A2A_EXTENSION } from "./card.ts";
import {
  createA2aTaskLedger,
  requestDigest,
  type A2aTaskLedger,
  type A2aTaskRecord,
} from "./task-ledger.ts";
import type { A2aTaskState } from "./inbound.ts";

/** The method this interface answers. */
export const A2A_SERVED_METHODS = ["card", "message:send"] as const;

export type A2aServedMethod = (typeof A2A_SERVED_METHODS)[number];

/** The methods the protocol defines that this interface does not serve. */
export const A2A_REFUSED_METHODS: readonly Readonly<{ method: string; path: string; because: string }>[] =
  Object.freeze([
    Object.freeze({
      method: "message:stream",
      path: A2A_HTTP_JSON_METHODS.messageStream,
      because: "Streaming is not served, and the card's capability flag says so rather than leaving it to be discovered here.",
    }),
    Object.freeze({
      method: "tasks/get",
      path: A2A_HTTP_JSON_METHODS.taskGet,
      because: "A served task is terminal when it is answered, so there is no later state to fetch.",
    }),
    Object.freeze({
      method: "tasks/cancel",
      path: A2A_HTTP_JSON_METHODS.taskCancel,
      because: "There is no running work to cancel: a read or a quote is finished inside the request that asked for it.",
    }),
    Object.freeze({
      method: "tasks/subscribe",
      path: A2A_HTTP_JSON_METHODS.taskSubscribe,
      because: "Subscription needs streaming, which is not served.",
    }),
    Object.freeze({
      method: "tasks/pushNotificationConfigs",
      path: A2A_HTTP_JSON_METHODS.pushNotificationConfigs,
      because: "A push configuration is a caller-supplied endpoint, and where this product reaches is never a request argument.",
    }),
  ]);

export const A2A_INTERFACE_REFUSALS = [
  "A2A_METHOD_NOT_SERVED",
  "A2A_METHOD_UNKNOWN",
  "A2A_HTTP_METHOD_NOT_ALLOWED",
  "A2A_VERSION_UNSUPPORTED",
  "A2A_REQUEST_MALFORMED",
] as const;

export type A2aInterfaceRefusal = (typeof A2A_INTERFACE_REFUSALS)[number];

export type MethodResolution =
  | Readonly<{ served: true; method: A2aServedMethod }>
  | Readonly<{ served: false; reasonCode: A2aInterfaceRefusal; detail: string; status: number }>;

/**
 * Which method one request path and verb name.
 *
 * The path segments arrive after the interface's base, so `["card"]` and
 * `["message:send"]` are the two that resolve. A segment that matches a method
 * the protocol defines is refused as not served; anything else is unknown. The
 * order matters for the same reason it does in the write gate: *nobody serves
 * this* and *you spelled something wrong* are different facts.
 */
export function resolveA2aMethod(
  segments: readonly string[],
  httpMethod: string,
): MethodResolution {
  const path = `/${segments.join("/")}`;

  if (segments.length === 1 && segments[0] === "card") {
    return httpMethod === "GET"
      ? Object.freeze({ served: true as const, method: "card" as const })
      : Object.freeze({
          served: false as const,
          reasonCode: "A2A_HTTP_METHOD_NOT_ALLOWED" as const,
          detail: "the card is read with GET",
          status: 405,
        });
  }

  if (segments.length === 1 && segments[0] === "message:send") {
    return httpMethod === "POST"
      ? Object.freeze({ served: true as const, method: "message:send" as const })
      : Object.freeze({
          served: false as const,
          reasonCode: "A2A_HTTP_METHOD_NOT_ALLOWED" as const,
          detail: "a message is sent with POST",
          status: 405,
        });
  }

  const refused = A2A_REFUSED_METHODS.find((entry) => entry.path === `/v1${path}`);
  if (refused) {
    return Object.freeze({
      served: false as const,
      reasonCode: "A2A_METHOD_NOT_SERVED" as const,
      detail: refused.because,
      status: 501,
    });
  }

  /* `tasks/<anything>` is the protocol's own shape for three methods none of
     which are served, so it is a not-served rather than an unknown however the
     identifier is spelled. */
  if (segments[0] === "tasks") {
    return Object.freeze({
      served: false as const,
      reasonCode: "A2A_METHOD_NOT_SERVED" as const,
      detail: "no task method is served: a read or a quote is finished inside the request that asked for it",
      status: 501,
    });
  }

  return Object.freeze({
    served: false as const,
    reasonCode: "A2A_METHOD_UNKNOWN" as const,
    detail: "the protocol defines no method at that path",
    status: 404,
  });
}

/**
 * Whether a declared wire version is one this interface speaks.
 *
 * Absent is accepted: the header is a service parameter, not a requirement, and
 * refusing a client that omitted it would refuse most clients. A header
 * naming another generation is refused rather than ignored — reading a 0.3
 * request with 1.0 semantics is how two parties come to disagree about what was
 * said.
 */
export function acceptsWireVersion(declared: string | null): boolean {
  return declared === null || declared.trim() === A2A_WIRE_VERSION;
}

/* ── the message a caller may send ─────────────────────────────────────── */

const DataPartSchema = z.object({ data: z.record(z.string(), z.unknown()) }).strict();
const TextPartSchema = z.object({ text: z.string().max(4_096) }).strict();

const PartSchema = z.union([DataPartSchema, TextPartSchema]);

const MessageSchema = z
  .object({
    messageId: z.string().min(1).max(128),
    contextId: z.string().min(1).max(128).optional(),
    taskId: z.string().min(1).max(128).optional(),
    role: z.string().min(1).max(32).optional(),
    parts: z.array(PartSchema).min(1).max(8),
    metadata: z.record(z.string(), z.unknown()).optional(),
    extensions: z.array(z.string().min(1).max(256)).max(8).optional(),
    referenceTaskIds: z.array(z.string().min(1).max(128)).max(8).optional(),
  })
  .strict();

export const SendMessageSchema = z
  .object({
    message: MessageSchema,
    configuration: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type SendMessageBody = z.output<typeof SendMessageSchema>;

const IntentSchema = z
  .object({
    intent: z.string().min(1).max(64),
    inputMint: z.string().min(32).max(44).optional(),
    outputMint: z.string().min(32).max(44).optional(),
    amountRaw: z.string().min(1).max(32).optional(),
    presetId: z.string().min(1).max(32).optional(),
  })
  .strict();

/* ── the task that comes back ──────────────────────────────────────────── */

export type A2aPart = Readonly<{ data: Readonly<Record<string, unknown>> }> | Readonly<{ text: string }>;

export type A2aArtifact = Readonly<{
  artifactId: string;
  name: string;
  description: string;
  parts: readonly A2aPart[];
  extensions: readonly string[];
}>;

export type A2aServedTask = Readonly<{
  id: string;
  contextId: string;
  status: Readonly<{
    state: A2aTaskState;
    timestamp: string;
    message: Readonly<{
      messageId: string;
      taskId: string;
      role: "ROLE_AGENT";
      parts: readonly A2aPart[];
    }> | null;
  }>;
  artifacts: readonly A2aArtifact[];
  history: readonly never[];
  metadata: Readonly<Record<string, unknown>>;
}>;

export type SendMessageAnswer = Readonly<{
  task: A2aServedTask;
  /** True when the caller had already asked and this is the task they have. */
  replay: boolean;
  record: A2aTaskRecord | null;
}>;

/** The task identity derived from the caller's own message id. */
export function servedTaskId(messageId: string): string {
  return `ryntra-${requestDigest(messageId).slice(2, 34)}`;
}

function agentMessage(taskId: string, text: string) {
  return Object.freeze({
    messageId: `${taskId}-status`,
    taskId,
    role: "ROLE_AGENT" as const,
    parts: Object.freeze([Object.freeze({ text })]),
  });
}

function task({
  id,
  contextId,
  state,
  at,
  statusText,
  artifacts,
  metadata,
}: {
  id: string;
  contextId: string;
  state: A2aTaskState;
  at: Date;
  statusText: string;
  artifacts: readonly A2aArtifact[];
  metadata: Readonly<Record<string, unknown>>;
}): A2aServedTask {
  return Object.freeze({
    id,
    contextId,
    status: Object.freeze({
      state,
      timestamp: at.toISOString(),
      message: agentMessage(id, statusText),
    }),
    artifacts: Object.freeze(artifacts),
    history: Object.freeze([]),
    metadata: Object.freeze(metadata),
  });
}

function artifact(name: string, description: string, data: Readonly<Record<string, unknown>>): A2aArtifact {
  return Object.freeze({
    artifactId: `${name}-1`,
    name,
    description,
    parts: Object.freeze([Object.freeze({ data })]),
    extensions: Object.freeze([RYNTRA_A2A_EXTENSION.uri]),
  });
}

export type ServedDependencies = Readonly<{
  ledger: A2aTaskLedger;
  /** Ryntra reading its own catalogue for one side of a pair. */
  readSide: (mint: string) => Promise<SideFacts | null>;
  now: Date;
}>;

const REJECTED_METADATA = Object.freeze({
  execution: EXTERNAL_EXECUTION_CLOSED,
  servedIntents: ROUTER_INTENT_KINDS,
});

/**
 * Answer one `message:send`.
 *
 * Every path ends in a task, including every refusal: a protocol client asked
 * in the protocol's own terms and is owed an answer in them. The refusals that
 * are *not* tasks are the ones that happen before this function — a method
 * nobody serves, a version nobody speaks, a body that is not a message.
 */
export async function answerSendMessage(
  body: unknown,
  deps: ServedDependencies,
): Promise<SendMessageAnswer> {
  const parsed = SendMessageSchema.safeParse(body);
  if (!parsed.success) {
    const id = servedTaskId("malformed");
    return Object.freeze({
      replay: false,
      record: null,
      task: task({
        id,
        contextId: id,
        state: "TASK_STATE_REJECTED",
        at: deps.now,
        statusText:
          "The request was not a message of this protocol. Send { message: { messageId, parts: [ { data: { intent } } ] } }.",
        artifacts: [],
        metadata: REJECTED_METADATA,
      }),
    });
  }

  const message = parsed.data.message;
  const id = servedTaskId(message.messageId);
  const contextId = message.contextId ?? id;

  const dataPart = message.parts.find((part): part is { data: Record<string, unknown> } => "data" in part);
  const intentParse = dataPart ? IntentSchema.safeParse(dataPart.data) : null;
  const intent = intentParse && intentParse.success ? intentParse.data : null;
  const intentName = intent ? intent.intent : null;
  const served = intent !== null && (ROUTER_INTENT_KINDS as readonly string[]).includes(intent.intent);

  /* The ledger is claimed for every message, served intent or not. A caller
     resending something that was rejected gets the same rejection and the same
     task id rather than a second record of the same mistake. */
  const claim = await deps.ledger.claim({
    side: "SERVED",
    taskId: id,
    contextId,
    requestKey: message.messageId,
    requestDigest: requestDigest(dataPart ? dataPart.data : message.parts),
    peerCardDigest: null,
    state: served ? "TASK_STATE_WORKING" : "TASK_STATE_REJECTED",
    deadlineMs: null,
    nowMs: deps.now.getTime(),
  });
  const replay = !claim.ok && claim.reasonCode === "REQUEST_ALREADY_ANSWERED";
  const record = claim.record;

  if (!served || intent === null) {
    return Object.freeze({
      replay,
      record,
      task: task({
        id,
        contextId,
        state: "TASK_STATE_REJECTED",
        at: deps.now,
        statusText: intentName
          ? `This interface serves reads and quotes. «${intentName}» is not one of them, and an action needs the wallet owner's signature, which no request to this surface carries.`
          : "A message carries one data part naming an intent. Prose is not read here: there is no model in this path, and a surface that accepted a sentence would be guessing.",
        artifacts: [],
        metadata: REJECTED_METADATA,
      }),
    });
  }

  const kind = intent.intent as RouterIntentKind;

  try {
    const data = await computeIntent(kind, intent, deps);
    if (!replay && claim.ok) {
      await deps.ledger.recordTaskState({
        side: "SERVED",
        taskId: id,
        state: "TASK_STATE_COMPLETED",
        nowMs: deps.now.getTime(),
      });
    }
    return Object.freeze({
      replay,
      record,
      task: task({
        id,
        contextId,
        /* Completed, and here that word means what it says: the artifact is
           Ryntra's own read, computed in this process, and Ryntra observed it.
           The rule that a peer's «completed» is only a claim is about the other
           direction — see `./task-ledger.ts`. */
        state: "TASK_STATE_COMPLETED",
        at: deps.now,
        statusText: "A read of Ryntra's own figures. Nothing was built, signed or sent.",
        artifacts: [artifact(kind.toLowerCase().replace(/_/g, "-"), "Ryntra's own figures for this request.", data)],
        metadata: Object.freeze({ execution: EXTERNAL_EXECUTION_CLOSED }),
      }),
    });
  } catch (error) {
    const reasonCode = error instanceof RouterError ? error.reasonCode : "A2A_REQUEST_MALFORMED";
    /* The row follows the answer. A ledger saying `WORKING` about a request the
       caller was told was rejected would be a second account of one event, and
       the one nobody reads is the one that stays wrong. */
    if (!replay && claim.ok) {
      await deps.ledger.recordTaskState({
        side: "SERVED",
        taskId: id,
        state: "TASK_STATE_REJECTED",
        nowMs: deps.now.getTime(),
      });
    }
    return Object.freeze({
      replay,
      record,
      task: task({
        id,
        contextId,
        state: "TASK_STATE_REJECTED",
        at: deps.now,
        statusText: `The request named a served intent and could not be answered: ${reasonCode}.`,
        artifacts: [],
        metadata: Object.freeze({ reasonCode, execution: EXTERNAL_EXECUTION_CLOSED }),
      }),
    });
  }
}

async function computeIntent(
  kind: RouterIntentKind,
  intent: z.output<typeof IntentSchema>,
  deps: ServedDependencies,
): Promise<Readonly<Record<string, unknown>>> {
  if (kind === "READ_TARIFF") return readTariff() as unknown as Record<string, unknown>;

  if (kind === "QUOTE_LAUNCH_BUY") {
    if (!intent.presetId) {
      throw new RouterError("INTENT_MALFORMED", "a launch quote names the preset it is about");
    }
    return quoteLaunchFee(intent.presetId) as unknown as Record<string, unknown>;
  }

  if (!intent.inputMint || !intent.outputMint || !intent.amountRaw) {
    throw new RouterError(
      "INTENT_MALFORMED",
      "a trade quote names both mints and the amount, in whole base units of the input",
    );
  }
  const [input, output] = await Promise.all([
    deps.readSide(intent.inputMint),
    deps.readSide(intent.outputMint),
  ]);
  return quoteTradeFee({
    inputMint: intent.inputMint,
    outputMint: intent.outputMint,
    amountRaw: intent.amountRaw,
    input,
    output,
    nowMs: deps.now.getTime(),
  }) as unknown as Record<string, unknown>;
}

/** The ledger this interface uses, built over the Guard store. */
export const createServedTaskLedger = createA2aTaskLedger;
