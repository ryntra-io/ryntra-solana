/**
 * The credits on a deployment (AI-04): on by default — `RYNTRA_ASSISTANT_CREDITS=0`
 * is the operator's switch back to the call allowance alone — with the
 * prices from their settings and the accounts store's lookup of a wallet's
 * account, remembered for a minute per instance.
 */

import { cachedLookup, type AccountLookup } from "./holder.ts";
import { resolveCreditsConfig, type CreditsConfig } from "./prices.ts";

export const CREDITS_SWITCH_ENV = "RYNTRA_ASSISTANT_CREDITS";

export type CreditsDeps = Readonly<{ config: CreditsConfig; lookup: AccountLookup | null }>;

export function creditsOn(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[CREDITS_SWITCH_ENV]?.trim() !== "0";
}

let shared: Readonly<{ lookup: AccountLookup; source: AccountLookup }> | null = null;

/** `lookup` is the accounts store's `account_by_wallet`; `null` (the stand) keeps every wallet its own holder. */
export function creditsDeps(lookup: AccountLookup | null, env: Readonly<Record<string, string | undefined>> = process.env): CreditsDeps | null {
  if (!creditsOn(env)) return null;
  if (lookup && shared?.source !== lookup) shared = { lookup: cachedLookup(lookup), source: lookup };
  return { config: resolveCreditsConfig(env), lookup: lookup && shared ? shared.lookup : null };
}
