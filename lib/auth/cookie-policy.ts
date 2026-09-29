/**
 * Attributes and names for the identity-provider cookies.
 *
 * These carry the Supabase session, so their attributes are stated rather than
 * inherited, and their names are recognised rather than guessed. Kept free of
 * imports so both rules can be tested directly.
 */

/**
 * `Secure` everywhere the site is not a local development server.
 *
 * `NODE_ENV` is the only signal available inside a cookie writer that has no
 * request in hand, and it is the right one: the production build serves over
 * TLS, and `npm run dev` on localhost is the single case where a `Secure`
 * cookie would simply never be stored. A session cookie that may travel over
 * plain HTTP is the kind of default that only shows up in somebody else's
 * packet capture.
 */
export function secureCookies(env: string | undefined = process.env.NODE_ENV): boolean {
  return env !== "development" && env !== "test";
}

/**
 * The Supabase auth cookies present in a jar, chunks included.
 *
 * A session larger than one cookie is written as `sb-<ref>-auth-token.0`,
 * `.1`, and so on. Deleting the base name alone leaves the chunks behind, and
 * a half-cleared token is worse than none: the next read reassembles garbage
 * and the person is neither signed in nor signed out. Names are taken from the
 * jar rather than constructed, so a project-ref change cannot orphan one.
 */
export function supabaseAuthCookieNames(names: readonly string[]): string[] {
  return names.filter((name) => /^sb-.+-auth-token(\.\d+)?$/.test(name) || /^sb-.+-auth-token-code-verifier$/.test(name));
}
