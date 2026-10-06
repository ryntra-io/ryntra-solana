import { redirect } from "next/navigation";

/**
 * `/app/plans` leads to «Боти → Мої боти» since the menu v6.2 (2026-10-06,
 *), like `/app/strategies`.
 *
 * Until then it served the plans rather than redirecting: a 308 of
 * 2026-09-08 (`/app/strategies → /app/plans`) is cached in browsers that used
 * the page, and sending `/app/plans` back to `/app/strategies` would loop
 * them. `/app/bots` redirects nowhere, so a browser holding that old 308 now
 * goes `/app/strategies` → `/app/plans` → `/app/bots` and stops.
 */
export default function PlansMovedToBots(): never {
  redirect("/app/bots");
}
