/**
 * Which Earn provider is on, and what it says about itself when it is not.
 *
 * Kamino's adapter answers every call the
 * surface makes.
 *
 * Pure: it reads an environment it is handed and nothing else, so the page, the routes and the tests all ask
 * the same function the same way.
 */

import { EARN_PROVIDER_IDS, EARN_PROVIDER_NAMES, type EarnProviderId, type EarnUnavailable } from "./model.ts";

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The key Jupiter's Lend API needs. Two names, read in this order: a key issued for Lend alone, then the
 * product's existing Jupiter key — the Swap lane's (`lib/solana/quotes.ts`) — for a deployment whose one key
 * carries Lend access too. Neither configured is `NO_KEY`, which the surface draws as «provider unavailable»
 * and never as an empty market list.
 */
export const JUPITER_LEND_KEY_ENV = "RYNTRA_JUPITER_LEND_API_KEY";
export const JUPITER_KEY_ENV = "RYNTRA_JUPITER_API_KEY";

/** The switch that puts Kamino beside Jupiter: `on` and nothing else. Unset is off, and off is stated. */
export const KAMINO_ENV = "RYNTRA_EARN_KAMINO";

/** The switch that draws the Earn row in the menu, set where Earn is actually reachable (`on`). */
export const EARN_MENU_ENV = "NEXT_PUBLIC_RYNTRA_EARN";

export function jupiterLendKey(env: Env): string | null {
  for (const name of [JUPITER_LEND_KEY_ENV, JUPITER_KEY_ENV]) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return null;
}

export function kaminoOn(env: Env): boolean {
  return env[KAMINO_ENV]?.trim().toLowerCase() === "on";
}

/** Whether a deployment says Earn is reachable here, for the menu row; the same reading as the treasury's. */
export function earnNamed(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "on";
}

export type EarnProviderConfig = Readonly<{
  provider: EarnProviderId;
  name: string;
  /** `null` when the provider can be asked; otherwise why it cannot, before anything is asked. */
  blocked: Readonly<{ code: EarnUnavailable; reason: string }> | null;
}>;

/**
 * Every provider with its state before a single call is made.
 *
 * The list is always both of them. A provider that is off is a row of its own on the page, saying it is off
 * and why — the shape the registry's own rule asks for («не вдавати порожній ринок»), and the reason a person
 * who has heard of Kamino does not conclude the product forgot it.
 */
export function earnProviders(env: Env): readonly EarnProviderConfig[] {
  return EARN_PROVIDER_IDS.map((provider) => ({
    provider,
    name: EARN_PROVIDER_NAMES[provider],
    blocked: blockedReason(provider, env),
  }));
}

function blockedReason(provider: EarnProviderId, env: Env): EarnProviderConfig["blocked"] {
  if (provider === "jupiter") {
    return jupiterLendKey(env) === null
      ? { code: "NO_KEY", reason: `Jupiter Lend needs an API key with Lend access. Configure ${JUPITER_LEND_KEY_ENV}.` }
      : null;
  }
  return kaminoOn(env)
    ? null
    : { code: "DISABLED", reason: `Kamino Lend is built and switched off here. It comes on with ${KAMINO_ENV}=on.` };
}

/** Whether this provider may be asked at all now. */
export function earnProviderOn(provider: EarnProviderId, env: Env): boolean {
  return blockedReason(provider, env) === null;
}
