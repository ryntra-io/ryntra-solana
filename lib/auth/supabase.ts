import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { secureCookies, supabaseAuthCookieNames } from "@/lib/auth/cookie-policy";

/**
 * Supabase Auth as Ryntra's identity verifier — server-side only.
 *
 * The same project that already holds the product's data (`SUPABASE_URL`,
 * `SUPABASE_ANON_KEY`) verifies email + password, Google and Telegram OpenID
 * Connect identities. Nothing here runs in the browser: the anon key stays a
 * server value, the PKCE verifier and the Supabase session live in HttpOnly
 * cookies written by this client, and the product's own session cookie (`rt`)
 * is minted separately once an identity has been verified and resolved to an
 * account. Supabase's session is therefore an identity-provider session used
 * for sign-in, password reset, identity linking and the admin's second factor
 * — never the thing a product route trusts on its own.
 *
 * Passwords, OAuth secrets and second-factor material never pass through this
 * process: the browser posts a form to a Route Handler, the handler forwards it
 * to Supabase over TLS, and nothing is logged.
 */

export { secureCookies, supabaseAuthCookieNames };

export function supabaseAuthConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

/** The project ref, for redirect-URI documentation and cookie naming. */
export function supabaseProjectRef(): string | null {
  const url = process.env.SUPABASE_URL;
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    return host.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * A server client bound to this request's cookie jar.
 *
 * In a Route Handler or Server Action the jar is writable and the client's
 * cookie writes land on the response. In a Server Component writes throw;
 * they are swallowed there because a page that only reads a session has
 * nothing to write, and the next handler refreshes what needs refreshing.
 */
export async function supabaseServer() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list: CookieToSet[]) {
        try {
          for (const { name, value, options } of list) {
            /* The identity session travels in these cookies, so their
               attributes are stated here rather than inherited: HttpOnly so no
               script can read them, `lax` so the OAuth and mail round trips
               still arrive, one path so a chunked token is never half-cleared,
               and `Secure` wherever the site is served over TLS. A cookie that
               carries a session and may go out over plain HTTP is the kind of
               default that only shows up in somebody else's capture. */
            store.set(name, value, { ...options, httpOnly: true, sameSite: "lax", path: "/", secure: secureCookies() });
          }
        } catch {
          /* Server Component: read-only jar. */
        }
      },
    },
  });
}

export type SupabaseServerClient = NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;

/**
 * The verified user of the current Supabase session, if any.
 *
 * `getUser()` validates against the Auth server rather than decoding a cookie,
 * so a revoked or expired identity session answers `null` here even while its
 * cookie is still present.
 */
export async function supabaseVerifiedUser(client: SupabaseServerClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
