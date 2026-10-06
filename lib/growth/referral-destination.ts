/**
 * Where a referral link lands the person: `?to=` when it is a page of the
 * product on this same site — a token from a trade card, a launch from its
 * creator's link — else «Винагороди», as before. Anything else (another
 * site, `//host`, a backslash or a control character, a path outside `/app`)
 * is ignored: a referral link is never an open redirect.
 */
export function referralDestination(to: string | null, base: string): URL {
  const fallback = new URL("/app/rewards", base);
  if (!to || to.length > 512 || !to.startsWith("/") || to.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(to)) return fallback;
  let target: URL;
  try {
    target = new URL(to, base);
  } catch {
    return fallback;
  }
  if (target.origin !== fallback.origin) return fallback;
  if (target.pathname !== "/app" && !target.pathname.startsWith("/app/")) return fallback;
  return target;
}
