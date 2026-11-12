/**
 * The one way the vault speaks to a model: the shape of the model gateway (CITY-45, `lib/models`) as the vault needs
 * it. A deployment speaks through `guard-model.ts`, which hands each call to that gateway; a developer's machine and the
 * stand play the scripted guards of `stub.ts`, which have exactly this interface (`server.ts` picks).
 *
 * What the gateway promises the vault: the model is pinned (no fallback models, no "latest" aliases), each guard pays
 * from its own key with a dollar limit, every call has a budget of tokens and time, and the answer says which model
 * answered and what the call cost. What the vault promises the gateway: no tools, ever.
 */

/** One turn of a conversation. A guard's conversation is always the rules and one visitor's message. */
export type ModelMessage = { role: "user"; content: string };

export type ModelCall = {
  /** The model's exact id in the catalog. */
  model: string;
  /** Whose key pays and whose dollar limit applies: one key per guard. */
  keyRef: string;
  /** The rules the model follows. */
  system: string;
  messages: readonly ModelMessage[];
  /** No tools: the shape allows only an empty list, so no caller can hand a guard one. */
  tools?: readonly [];
  maxTokens: number;
  timeoutMs: number;
  /** For the gateway's log, so a reply can be traced to its attempt. */
  traceId: string;
};

export type ModelReply = {
  text: string;
  /** The model that answered, as the provider named it. */
  model: string;
  /** What the call cost, in millionths of a dollar; null when the gateway was not told (then the worst case stands). */
  costMicroUsd: number | null;
  tokens: { input: number; output: number };
  ms: number;
};

export interface ModelGateway {
  call(input: ModelCall): Promise<ModelReply>;
  /**
   * The most this call can cost, in millionths of a dollar, before it is made: the vault sets it aside against the
   * day's ceiling first. Throws `ModelFailure` when the price cannot be known now — then nothing is called. A gateway
   * without it costs nothing (the scripted stub).
   */
  worstCase?(input: ModelCall): Promise<number>;
}

/** Why a call gave no answer. The vault never counts such an attempt. */
export type ModelFailureReason = "timeout" | "budget" | "unavailable" | "refused";

export type ModelFailureOptions = {
  /**
   * The failure will not pass by itself within seconds — no key, a key switched off or out of money, a model the
   * catalog no longer has: the guards rest a while instead of failing every visitor in turn.
   */
  lasting?: boolean;
  /** What the failed call cost, when the gateway knows; null when it does not (a timeout may still be billed). */
  costMicroUsd?: number | null;
};

export class ModelFailure extends Error {
  readonly reason: ModelFailureReason;
  readonly lasting: boolean;
  readonly costMicroUsd: number | null;

  constructor(reason: ModelFailureReason, message: string = reason, options: ModelFailureOptions = {}) {
    super(message);
    this.name = "ModelFailure";
    this.reason = reason;
    this.lasting = options.lasting ?? false;
    this.costMicroUsd = options.costMicroUsd ?? null;
  }
}
