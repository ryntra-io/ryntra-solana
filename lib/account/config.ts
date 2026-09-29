/**
 * Which account doors are open, read from the environment at call time.
 *
 * The verifier (Supabase Auth) is configured outside this repository: the
 * email provider, the Google OAuth client and the Telegram OpenID Connect
 * provider are each set up by the owner in the Supabase dashboard, Google
 * Cloud and BotFather. The product cannot detect that configuration, so it
 * does not guess: every method has an explicit switch the owner turns on
 * after verifying the provider end to end. A method that is off is not shown
 * as a button that would fail.
 *
 *   RYNTRA_ACCOUNT_LOGIN=on        the account system (email + password) and
 *                                  the recorded sessions behind it
 *   RYNTRA_AUTH_GOOGLE=on          Google through Supabase's managed OAuth
 *   RYNTRA_AUTH_TELEGRAM_OIDC=on   Telegram through the custom OIDC provider
 *                                  `custom:telegram`
 *
 * The Telegram bot deep link (the transitional path) needs no switch and
 * keeps working regardless.
 */
export const ACCOUNT_METHODS = ["email", "google", "telegram"] as const;
export type AccountMethod = (typeof ACCOUNT_METHODS)[number];

function on(name: string): boolean {
  return (process.env[name] ?? "").trim().toLowerCase() === "on";
}

export function accountLoginEnabled(): boolean {
  return on("RYNTRA_ACCOUNT_LOGIN") && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

export type AccountMethods = Readonly<Record<AccountMethod, boolean>>;

/** The doors that are open right now. Email is the base door of the account system. */
export function accountMethods(): AccountMethods {
  const base = accountLoginEnabled();
  return {
    email: base,
    google: base && on("RYNTRA_AUTH_GOOGLE"),
    telegram: base && on("RYNTRA_AUTH_TELEGRAM_OIDC"),
  };
}

/**
 * The customer doors — email, Google, Telegram as ways *in* for a person in
 * the cabinet — are shut unless `RYNTRA_CUSTOMER_DOORS=on`.
 *
 * `RYN-ACCESS-WALLET-ONLY-001`, the Owner's decision of 2026-09-11: an
 * account is the wallet that signed, Telegram is a notification channel
 * connected from Settings, and email and Google are not offered to a
 * customer at all. The operator's own email + second-factor login on
 * `/admin/login` reads `accountMethods()` and is untouched by this switch,
 * which is why the two are separate functions.
 */
export function customerDoorsEnabled(): boolean {
  return on("RYNTRA_CUSTOMER_DOORS");
}

/** The account doors as a customer may use them: the operator's set, gated by the customer switch. */
export function customerMethods(): AccountMethods {
  const doors = customerDoorsEnabled();
  const base = accountMethods();
  return { email: base.email && doors, google: base.google && doors, telegram: base.telegram && doors };
}

/** The Supabase provider identifier for a redirect-based method. */
export function supabaseProviderFor(method: Exclude<AccountMethod, "email">): string {
  return method === "google" ? "google" : "custom:telegram";
}

/**
 * The public client id of the Ryntra Telegram bot (its numeric bot id), which
 * Telegram Login needs in the browser. Not a secret: every Telegram
 * authorization URL carries it. The env var exists so a stand or a successor
 * bot can point elsewhere without a source change.
 */
export function telegramClientId(): string {
  const raw = (process.env.RYNTRA_TELEGRAM_CLIENT_ID ?? "").trim();
  return /^\d{4,20}$/.test(raw) ? raw : "8110775576";
}
