/**
 * An agent of the Ring as the harness asks it (CITY-51): its pinned brain through the one model gateway (CITY-45),
 * with its own key, its owner's script and the format's prompt (`prompt.ts`). The gateway never throws; what it says
 * goes to the harness as a move, a fault or a void:
 *
 *   fault — the agent's own: its key's limit is spent, its key is off, or it answered something that is not a move
 *   void  — nobody's: the network, the provider, a rate limit, our own request or account — the duel is played again
 *
 * The key comes in already opened (`seal.ts`) for this agent only; it is never logged and never leaves this call.
 */

import type { ModelErrorKind } from "../../models/errors.ts";
import type { ModelGateway } from "../../models/types.ts";
import type { AgentReply, DuelAgent, SeatView } from "./harness.ts";
import { MOVE_MS } from "./harness.ts";
import { CRACK_SCHEMA, MARKET_SCHEMA, crackMessages, marketMessages, readReply } from "./prompt.ts";

/** The agent's own failures: they lose the match. Every other failure is nobody's and voids it. */
const FAULT_OF: Partial<Record<ModelErrorKind, "spent" | "key_off" | "malformed">> = {
  budget_exhausted: "spent",
  key_disabled: "key_off",
  invalid_response: "malformed",
};

/** What one move may write: the JSON move and its short reason. */
export const MOVE_TOKENS = 300;

export type ModelAgentInput = {
  gateway: ModelGateway;
  agent: { id: string; model: string; provider: string; scenario: string; structured: boolean };
  /** The agent's own OpenRouter key, opened for this match. */
  apiKey: string;
  /** What a move costs at the pinned price, micro-dollars: counted when the gateway could not say what it billed. */
  moveMicroUsd: number;
  moveMs?: number;
};

export function modelAgent(input: ModelAgentInput): DuelAgent {
  const { gateway, agent } = input;
  return {
    async act(view: SeatView, signal: AbortSignal): Promise<AgentReply> {
      const crack = view.format === "duo-crack";
      const result = await gateway.call({
        subject: { kind: "ring-agent", id: agent.id },
        model: { id: agent.model, providers: [agent.provider] },
        messages: crack ? crackMessages(view, agent.scenario) : marketMessages(view, agent.scenario),
        budget: { maxTokens: MOVE_TOKENS, reasoningTokens: 0, timeoutMs: Math.max(1_000, (input.moveMs ?? MOVE_MS) - 2_000) },
        ...(crack ? (agent.structured ? { responseFormat: CRACK_SCHEMA } : {}) : { responseFormat: MARKET_SCHEMA }),
        apiKey: input.apiKey,
        signal,
      });
      const cost = result.costMicroUsd ?? (result.ok || result.usage ? input.moveMicroUsd : 0);
      if (!result.ok) {
        const fault = FAULT_OF[result.error.kind];
        if (result.error.kind === "timeout") return { kind: "fault", fault: "timeout", costMicroUsd: cost };
        return fault ? { kind: "fault", fault, costMicroUsd: cost } : { kind: "void", reason: result.error.kind, costMicroUsd: cost };
      }
      const move = readReply(result.json ?? result.text);
      if (!move) return { kind: "fault", fault: "malformed", costMicroUsd: cost };
      const { why, ...rest } = move;
      return { kind: "move", move: crack ? { say: rest.say, guess: rest.guess ?? null } : { side: rest.side, size: rest.size }, thought: typeof why === "string" ? why : "", costMicroUsd: cost };
    },
  };
}
