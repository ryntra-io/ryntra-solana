/**
 * Each agent's own OpenRouter key with a dollar limit (CITY-50, decision 72), through the gateway's key manager
 * (CITY-45, `OPENROUTER_MANAGEMENT_KEY`) — on the server only. A spent limit stops that one agent, never another.
 *
 * - `make` asks OpenRouter for a key named `ryntra:ring-agent:<id>` with the class's monthly limit and seals the
 *   secret at once (`seal.ts`); the secret is never logged, returned or kept unsealed.
 * - `retire` switches a key off when its agent is switched off or gets a brain of another class.
 *
 * Without the management key or the seal's secret the Ring is quiet: no key is made and an agent is kept with
 * `key: quiet` — nothing is called, nothing is spent; the matches (CITY-51) make the key once the server has both.
 */

import { ModelGatewayError } from "../models/errors.ts";
import type { ModelKeyManager } from "../models/keys.ts";
import type { Weight } from "./contract.ts";
import type { Sealer } from "./seal.ts";
import { KEY_LIMIT_USD } from "./weight.ts";

export type MadeKey = { hash: string; sealed: string; limitUsd: number };

export type RingKeys = Readonly<{
  mode: "live" | "quiet";
  /** A new key for this agent and class, sealed; `null` when quiet. Throws `KeyFailed` when OpenRouter did not make one. */
  make(agentId: string, weight: Weight): Promise<MadeKey | null>;
  /** Switches a key off; true once OpenRouter confirms. Never throws. */
  retire(hash: string): Promise<boolean>;
}>;

/** OpenRouter did not make the key; nothing was kept. */
export class KeyFailed extends Error {
  readonly kind: ModelGatewayError["kind"] | "unknown";
  constructor(kind: ModelGatewayError["kind"] | "unknown") {
    super(`the agent's key was not made (${kind})`);
    this.name = "KeyFailed";
    this.kind = kind;
  }
}

export const quietKeys: RingKeys = {
  mode: "quiet",
  make: async () => null,
  retire: async () => false,
};

export function createRingKeys(deps: { manager: ModelKeyManager; sealer: Sealer }): RingKeys {
  return {
    mode: "live",
    async make(agentId, weight) {
      const limitUsd = KEY_LIMIT_USD[weight];
      let made;
      try {
        made = await deps.manager.create({ subject: { kind: "ring-agent", id: agentId }, limitUsd, limitReset: "monthly" });
      } catch (error) {
        throw new KeyFailed(error instanceof ModelGatewayError ? error.kind : "unknown");
      }
      return { hash: made.info.hash, sealed: deps.sealer.seal(agentId, made.secret), limitUsd };
    },
    async retire(hash) {
      try {
        return (await deps.manager.disable(hash)).disabled;
      } catch (error) {
        console.error("[ring] key not switched off", hash.slice(0, 12), error instanceof ModelGatewayError ? error.kind : "unknown");
        return false;
      }
    },
  };
}
