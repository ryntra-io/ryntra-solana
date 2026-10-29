/**
 * The one way the vault speaks to a model: the shape of the model gateway (CITY-45, `lib/models`) as the vault needs
 * it. Until that gateway is in master the vault runs on the stub beside this file (`stub.ts`), which has exactly this
 * interface; switching over is one line in `server.ts`.
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
  /** What the call cost, in millionths of a dollar. */
  costMicroUsd: number;
  tokens: { input: number; output: number };
  ms: number;
};

export interface ModelGateway {
  call(input: ModelCall): Promise<ModelReply>;
}

/** Why a call gave no answer. The vault never counts such an attempt. */
export type ModelFailureReason = "timeout" | "budget" | "unavailable" | "refused";

export class ModelFailure extends Error {
  readonly reason: ModelFailureReason;

  constructor(reason: ModelFailureReason, message: string = reason) {
    super(message);
    this.name = "ModelFailure";
    this.reason = reason;
  }
}
