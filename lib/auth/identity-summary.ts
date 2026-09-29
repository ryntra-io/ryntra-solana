import type { User } from "@supabase/supabase-js";

/**
 * From a verified Supabase user to the few facts the account layer acts on:
 * which door the person came through, which Telegram id the identity carries,
 * a display name and a language hint.
 *
 * This module is pure on purpose. `account-session.ts` reaches the store; the
 * rules here are worth testing against the exact claim shapes providers
 * return, and the first real Telegram sign-in showed why.
 */

export type IdentityProvider = "email" | "google" | "telegram" | "unknown";

export type IdentitySummary = Readonly<{
  authUserId: string;
  email: string | null;
  emailConfirmed: boolean;
  displayName: string | null;
  telegramId: number | null;
  provider: IdentityProvider;
  providers: readonly string[];
  language: string | null;
}>;

export const TELEGRAM_PROVIDER = "custom:telegram";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * The numeric Telegram user id, or `null` when the identity does not carry it.
 *
 * Telegram's OpenID Connect puts the user id in the `id` claim of the
 * `profile` scope; `sub` is a separate pairwise subject (a 19-digit number
 * per client) that never equals the user id. Only the numeric `id` maps onto
 * the legacy bot accounts, so `sub` is deliberately never read as one.
 *
 * Supabase's custom OIDC provider keeps the standard claims and drops `id`
 * (observed in production on 2026-09-06: `identity_data` held `sub`, `name`,
 * `given_name`, `preferred_username`, `picture`, `iss`, `aud`, `iat`, `exp`
 * and nothing else). Until the claim arrives, this returns `null` for every
 * real Telegram identity, and `telegramIdMissing` below keeps that from
 * turning into a second account.
 */
export function telegramIdOf(identityData: Record<string, unknown> | undefined): number | null {
  if (!identityData) return null;
  const raw = identityData.id ?? identityData.telegram_id;
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function summarizeIdentity(user: User, methodHint?: "email" | "google" | "telegram"): IdentitySummary {
  const identities = user.identities ?? [];
  const providers = identities.map((i) => i.provider);
  const telegram = identities.find((i) => i.provider === TELEGRAM_PROVIDER);
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName =
    str(meta.full_name) ?? str(meta.name) ?? str(meta.preferred_username) ?? str(meta.user_name) ?? str(user.email?.split("@")[0] ?? null);
  const language = str(meta.locale)?.slice(0, 2).toLowerCase() ?? null;
  const provider: IdentityProvider =
    methodHint ??
    (providers.includes("google") ? "google" : providers.includes(TELEGRAM_PROVIDER) ? "telegram" : providers.includes("email") ? "email" : "unknown");
  return {
    authUserId: user.id,
    email: str(user.email ?? null),
    emailConfirmed: Boolean(user.email_confirmed_at),
    displayName,
    telegramId: telegramIdOf(telegram?.identity_data as Record<string, unknown> | undefined),
    provider,
    providers,
    language: language && ["en", "uk", "ru"].includes(language) ? language : null,
  };
}

/**
 * A Telegram identity that arrived without its numeric user id.
 *
 * Such an identity cannot be matched to the bot account the same person may
 * already hold, so creating an account for it would be a coin toss between
 * «new customer» and «duplicate of an existing one». The first production
 * sign-in landed on the wrong side of that toss. An identity like this may
 * still be *attached* to an account the person explicitly named (the bot
 * link followed by «add this method»), and an identity already bound to an
 * account still resolves to it; only the silent creation is refused.
 */
export function telegramIdMissing(identity: IdentitySummary): boolean {
  const telegram = identity.provider === "telegram" || identity.providers.includes(TELEGRAM_PROVIDER);
  return telegram && identity.telegramId === null;
}
