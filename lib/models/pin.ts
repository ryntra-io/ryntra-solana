/**
 * What a pinned model is (CITY-45, decision 72): one OpenRouter model id from
 * the catalog and the providers it may run on — never an alias that moves
 * («latest», `~vendor/…`), never a router that picks for us (`openrouter/auto`),
 * never a routing shortcut that changes the provider (`:nitro`, `:floor`), and
 * never a list of fallback models. Two agents in a Ring match, or a guard and
 * its replay, must have been answered by the same weights.
 *
 * Pure: no store, no clock, no network.
 */

import { ModelGatewayError } from "./errors.ts";

export type PinnedModel = Readonly<{
  /** An OpenRouter model id exactly as the catalog lists it, e.g. `anthropic/claude-haiku-5.5`. */
  id: string;
  /** Provider slugs for `provider.only` — 1 to 4; a Ring match pins exactly one. */
  providers: readonly string[];
}>;

export const MAX_PROVIDERS = 4;

const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,95}(?::[a-z0-9-]{1,32})?$/i;
const PROVIDER_SLUG = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,31})?$/i;

/** Whether a value has the shape of an OpenRouter model id (`vendor/model`, an optional `:variant`). */
export function modelIdShaped(id: unknown): id is string {
  return typeof id === "string" && MODEL_ID.test(id);
}

/** Variants that pick or change the provider, or add a plugin, rather than name a model. */
const ROUTING_VARIANTS = new Set(["nitro", "floor", "online", "exacto"]);

/**
 * An id that does not name one fixed model: a «latest» pointer, a `~` family
 * pointer, any of OpenRouter's own routers or cloaked models, or a routing
 * shortcut variant. Such an id may answer with different weights tomorrow.
 */
export function isAliasId(id: string): boolean {
  if (id.startsWith("~")) return true;
  if (/latest/i.test(id)) return true;
  if (/^openrouter\//i.test(id)) return true;
  const variant = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1).toLowerCase() : null;
  return variant !== null && ROUTING_VARIANTS.has(variant);
}

/** The pinned model checked for shape; a problem is an `invalid_request` naming it. */
export function checkPin(model: unknown): ModelGatewayError | null {
  const pin = (model && typeof model === "object" ? model : {}) as { id?: unknown; providers?: unknown };
  if (typeof pin.id !== "string" || pin.id.trim() === "") return new ModelGatewayError("invalid_request", "The model has no id.");
  if (isAliasId(pin.id)) return new ModelGatewayError("invalid_request", `«${pin.id}» is an alias or a router, not a pinned model: name the exact model id from the catalog.`);
  if (!MODEL_ID.test(pin.id)) return new ModelGatewayError("invalid_request", `«${pin.id.slice(0, 80)}» is not an OpenRouter model id.`);
  if (!Array.isArray(pin.providers) || pin.providers.length === 0) return new ModelGatewayError("invalid_request", "A pinned model names at least one provider for `provider.only`.");
  if (pin.providers.length > MAX_PROVIDERS) return new ModelGatewayError("invalid_request", `A pinned model names at most ${MAX_PROVIDERS} providers.`);
  for (const provider of pin.providers) {
    if (typeof provider !== "string" || !PROVIDER_SLUG.test(provider)) return new ModelGatewayError("invalid_request", `«${String(provider).slice(0, 40)}» is not a provider slug.`);
  }
  if (new Set(pin.providers.map((provider: string) => provider.toLowerCase())).size !== pin.providers.length) return new ModelGatewayError("invalid_request", "A provider is named twice.");
  return null;
}

const baseOf = (slug: string): string => (slug.split("/")[0] ?? "").toLowerCase();

/**
 * Whether a pinned slug reaches one of a model's endpoints (its `tag` in
 * `GET /api/v1/models/{id}/endpoints`), as `provider.only` routes: the full
 * tag reaches that endpoint alone (`amazon-bedrock/us-east-1`,
 * `deepinfra/turbo`); a base slug (`amazon-bedrock`) reaches every endpoint of
 * that provider, its variants and regions too — except a service tier
 * (`google-ai-studio/flex`), which only its full tag reaches.
 */
export function slugReaches(slug: string, endpoint: Readonly<{ tag: string; serviceTier: string | null }>): boolean {
  const pinned = slug.toLowerCase();
  const tag = endpoint.tag.toLowerCase();
  if (pinned === tag) return true;
  return !pinned.includes("/") && tag.startsWith(`${pinned}/`) && endpoint.serviceTier === null;
}

/**
 * Whether the provider OpenRouter says answered is one of the pinned ones.
 * The response names the provider (`Google`), the request its slug
 * (`google-vertex`, or `google-vertex/us-east5` for a region), and only
 * OpenRouter's own list (`GET /api/v1/providers`, name → slug) joins them —
 * a display name folded by hand is not a slug (`Google` is `google-vertex`,
 * `Moonshot AI` is `moonshotai`). `null` when the name cannot be looked up: not
 * a mismatch, unknown. The region or variant that answered is never named, so
 * the provider's base slug is what is compared.
 */
export function providerMatches(answered: string, providers: readonly string[], slugByName: ReadonlyMap<string, string> | null): boolean | null {
  const bases = new Set(providers.map(baseOf));
  const slug = slugByName?.get(answered);
  if (slug !== undefined) return bases.has(baseOf(slug));
  /* A response that names the slug itself, exactly, needs no list; anything else is not guessed. */
  return bases.has(answered) ? true : null;
}
