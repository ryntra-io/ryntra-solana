import { estimateCostMicroUsd } from "../models/catalog.ts";
import type { ModelErrorKind } from "../models/errors.ts";
import type { ModelCall as GatewayCall, ModelGateway as Gateway, PinnedModel } from "../models/types.ts";
import { GUARD_MODEL } from "./levels";
import { ModelFailure, type ModelCall, type ModelFailureReason, type ModelGateway, type ModelReply } from "./model";

/**
 * The guards on the model gateway of CITY-45 (`lib/models`): every attempt is one call with the model pinned, the
 * guard's rules as the system message and the visitor's one fenced message, a budget of tokens and time, thinking off
 * and no tools — the gateway's request carries no `tools` at all. Before the call the vault learns the most it can
 * cost, from the pinned providers' own prices, and sets that aside against the day's ceiling (`engine.ts`).
 *
 * The gateway never throws; its failures come back here as the vault's `ModelFailure`, with what the call cost when
 * the gateway knows and whether the failure lasts (no key, a key out of money, a model the catalog dropped): then the
 * guards rest a while rather than fail every visitor in turn.
 */

/** The guards' model and the one provider it runs on; a deployment may pin another with `RYNTRA_VAULT_GUARD_MODEL`. */
export const GUARD_PIN: PinnedModel = { id: GUARD_MODEL, providers: ["anthropic"] };

const PIN = /^([a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._:-]{0,127})@([a-z0-9][a-z0-9._/-]{0,95}(?:,[a-z0-9][a-z0-9._/-]{0,95}){0,3})$/i;

/** `vendor/model@provider[,provider…]`, as the deployment pins it; anything else keeps the default. */
export function readGuardPin(value: string | undefined): PinnedModel {
  const match = PIN.exec(value?.trim() ?? "");
  return match ? { id: match[1]!, providers: match[2]!.split(",") } : GUARD_PIN;
}

/** Room for the chat's own wrapping of each message, in tokens. */
const PER_MESSAGE_TOKENS = 16;
const PER_CALL_TOKENS = 64;
const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/**
 * The most a call can read, in tokens: a byte-level tokenizer never makes more tokens than the text has bytes, so the
 * bytes of the rules and the message, with the chat's wrapping, bound it from above whatever a visitor typed.
 */
export function inputBound(call: Pick<ModelCall, "system" | "messages">): number {
  const texts = [call.system, ...call.messages.map((m) => m.content)];
  return texts.reduce((sum, text) => sum + bytes(text) + PER_MESSAGE_TOKENS, PER_CALL_TOKENS);
}

/** Failures that need a person: a key, credits, the pin. The rest pass by themselves. */
const LASTING: ReadonlySet<ModelErrorKind> = new Set([
  "no_key",
  "invalid_request",
  "unauthorized",
  "key_disabled",
  "budget_exhausted",
  "account_budget_exhausted",
  "out_of_credits",
  "forbidden",
  "not_found",
]);

function reasonOf(kind: ModelErrorKind): ModelFailureReason {
  switch (kind) {
    case "timeout":
    case "aborted":
      return "timeout";
    case "budget_exhausted":
    case "account_budget_exhausted":
    case "out_of_credits":
      return "budget";
    case "moderated":
      return "refused";
    default:
      return "unavailable";
  }
}

const failure = (kind: ModelErrorKind, message: string, costMicroUsd: number | null = null, lasting: ReadonlySet<ModelErrorKind> = LASTING) =>
  new ModelFailure(reasonOf(kind), `${kind}: ${message}`.slice(0, 300), { lasting: lasting.has(kind), costMicroUsd });

/**
 * A call carries a visitor's words, and words can make a request the provider refuses (`invalid_request`): that is
 * this one attempt's failure, never a reason for every guard on the instance to rest. The preflight carries none.
 */
const CALL_LASTING: ReadonlySet<ModelErrorKind> = new Set([...LASTING].filter((kind) => kind !== "invalid_request"));

export type GuardModelDeps = {
  gateway: Gateway;
  pin?: PinnedModel;
  /** The vault's own OpenRouter key; without it the gateway's shared `OPENROUTER_API_KEY`. */
  apiKey?: string | null;
};

export function guardModel(deps: GuardModelDeps): ModelGateway {
  const pin = deps.pin ?? GUARD_PIN;

  return {
    async worstCase(call) {
      const checked = await deps.gateway.preflight(pin, { reasoningTokens: 0 });
      if (!checked.ok) throw failure(checked.error.kind, checked.error.message);
      const most = estimateCostMicroUsd(checked.model, { input: inputBound(call), output: call.maxTokens });
      if (most === null) throw new ModelFailure("refused", "the pinned model has no price", { lasting: true });
      return most;
    },

    async call(call): Promise<ModelReply> {
      const request: GatewayCall = {
        subject: { kind: "vault-guard", id: call.keyRef },
        model: pin,
        // A new conversation every time: the rules, then the one fenced message.
        messages: [{ role: "system", content: call.system }, ...call.messages],
        budget: { maxTokens: call.maxTokens, reasoningTokens: 0, timeoutMs: call.timeoutMs },
        ...(deps.apiKey ? { apiKey: deps.apiKey } : {}),
      };
      const result = await deps.gateway.call(request);
      if (!result.ok) throw failure(result.error.kind, result.error.message, result.costMicroUsd, CALL_LASTING);
      if (!result.text?.trim()) throw new ModelFailure("unavailable", "the guard said nothing", { costMicroUsd: result.costMicroUsd });
      return {
        text: result.text,
        model: result.answered.model ?? pin.id,
        costMicroUsd: result.costMicroUsd,
        tokens: { input: result.usage.input, output: result.usage.output },
        ms: result.latencyMs,
      };
    },
  };
}
