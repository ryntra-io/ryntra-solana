import { cookies } from "next/headers";

import { normalizePublicLocale, PUBLIC_LOCALE_COOKIE, type PublicLocale } from "./locale.ts";

/**
 * Which language a public page renders in, on the server.
 *
 * The header's language toggle writes `ryntra_hub_locale` and then, on every
 * page except the homepage, calls `router.refresh()` — it has always expected
 * the server to read that cookie back. Nothing did, so pressing UA on a public
 * page changed a cookie and re-rendered the same English. This is that read.
 *
 * The homepage keeps its own arrangement: `/` and `/uk` are separate routes
 * with their own canonical URLs and hreflang, and the toggle navigates between
 * them rather than refreshing. Both models are fine; what is not fine is a
 * control that appears to do something and does not.
 */
export async function publicServerLocale(): Promise<PublicLocale> {
  const store = await cookies();
  return normalizePublicLocale(store.get(PUBLIC_LOCALE_COOKIE)?.value);
}
