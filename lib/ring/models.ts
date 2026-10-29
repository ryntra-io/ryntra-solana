/**
 * Brains for the Ring (CITY-50, decision 72): OpenRouter's live catalog through the gateway of CITY-45, priced before
 * anyone picks, sorted into weight classes, and a pick pinned to exactly one provider with no fallbacks.
 *
 * - `list()` — every model the gateway can pin and price, with its class and what a standard match costs at the
 *   catalog's price.
 * - `quote(id)` — the model as an agent would get it: its endpoints read, the cheapest one that is not a deferred
 *   service tier chosen, `preflight` run on exactly that provider, and the class, cost and playable formats taken from
 *   that provider's own price and abilities. What `create` and `change` keep is the quote, never the list's figure.
 */

import type { CatalogEndpoint, ModelCatalog } from "../models/catalog.ts";
import type { ModelGatewayError } from "../models/errors.ts";
import type { ModelGateway } from "../models/types.ts";
import { formatsOf } from "./agent.ts";
import type { ModelOption, ModelQuote } from "./contract.ts";
import { matchCostMicroUsd, weightOf } from "./weight.ts";

export type QuoteResult =
  | { ok: true; quote: ModelQuote }
  /** `refused` — the model cannot be an agent's brain (the message says why); `unavailable` — OpenRouter could not be read. */
  | { ok: false; reason: "refused" | "unavailable"; message: string };

export type RingModels = {
  list(): Promise<{ models: ModelOption[]; readAt: string; stale: boolean }>;
  quote(id: string): Promise<QuoteResult>;
};

const OUTAGE = new Set<ModelGatewayError["kind"]>(["network", "timeout", "provider_unavailable", "rate_limited", "invalid_response", "aborted"]);

const unavailable = (): QuoteResult => ({ ok: false, reason: "unavailable", message: "OpenRouter's catalog could not be read. Nothing was picked." });

/** The endpoint an agent is pinned to: the cheapest standard match; a tie goes to the one that can play more formats. */
export function chooseEndpoint(endpoints: readonly CatalogEndpoint[]): CatalogEndpoint | null {
  let best: { endpoint: CatalogEndpoint; cost: number; formats: number } | null = null;
  for (const endpoint of endpoints) {
    if (endpoint.serviceTier !== null) continue;
    const cost = matchCostMicroUsd(endpoint);
    if (cost === null || weightOf(cost) === null) continue;
    const formats = formatsOf(endpoint).length;
    if (!best || cost < best.cost || (cost === best.cost && formats > best.formats)) best = { endpoint, cost, formats };
  }
  return best?.endpoint ?? null;
}

export function createRingModels(deps: { catalog: ModelCatalog; gateway: ModelGateway }): RingModels {
  return {
    async list() {
      const snapshot = await deps.catalog.list();
      const models: ModelOption[] = [];
      for (const model of snapshot.models) {
        if (!model.pinnable) continue;
        const input = model.prices.inputPerMillionUsd;
        const output = model.prices.outputPerMillionUsd;
        const cost = matchCostMicroUsd(model);
        const weight = weightOf(cost);
        if (input === null || output === null || cost === null || weight === null) continue;
        models.push({ id: model.id, name: model.name, weight, matchMicroUsd: cost, inputPerMillionUsd: input, outputPerMillionUsd: output });
      }
      models.sort((a, b) => a.matchMicroUsd - b.matchMicroUsd || a.name.localeCompare(b.name));
      return { models, readAt: snapshot.readAt, stale: snapshot.stale };
    },

    async quote(id) {
      // The cached list first: an id it does not hold never costs a request to OpenRouter.
      let entry;
      try {
        entry = await deps.catalog.get(id);
      } catch {
        return unavailable();
      }
      if (!entry) return { ok: false, reason: "refused", message: `${id.slice(0, 80)} is not in OpenRouter's catalog.` };
      if (!entry.pinnable) return { ok: false, reason: "refused", message: `${id.slice(0, 80)} is a router or an alias, not one model: pick the model itself.` };
      let served;
      try {
        served = await deps.catalog.endpoints(id);
      } catch (error) {
        const kind = (error as { kind?: ModelGatewayError["kind"] }).kind;
        if (kind === "not_found" || kind === "invalid_request") return { ok: false, reason: "refused", message: `${id.slice(0, 80)} is not in OpenRouter's catalog.` };
        return unavailable();
      }
      const endpoint = chooseEndpoint(served.endpoints);
      if (!endpoint) return { ok: false, reason: "refused", message: "No provider of this model has a known price inside the Ring's classes." };
      const pinned = await deps.gateway.preflight({ id, providers: [endpoint.tag] });
      if (!pinned.ok) {
        if (OUTAGE.has(pinned.error.kind)) return unavailable();
        return { ok: false, reason: "refused", message: pinned.error.message };
      }
      const cost = matchCostMicroUsd(pinned.model);
      const weight = weightOf(cost);
      const input = pinned.model.prices.inputPerMillionUsd;
      const output = pinned.model.prices.outputPerMillionUsd;
      if (cost === null || weight === null || input === null || output === null) return { ok: false, reason: "refused", message: "This model costs more than the heaviest class allows." };
      return {
        ok: true,
        quote: {
          id: pinned.model.id,
          name: pinned.model.name,
          provider: endpoint.tag,
          providerName: endpoint.providerName || endpoint.tag,
          weight,
          matchMicroUsd: cost,
          inputPerMillionUsd: input,
          outputPerMillionUsd: output,
          formats: formatsOf(pinned.model),
          stale: pinned.stale,
        },
      };
    },
  };
}
