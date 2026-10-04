/**
 * `/app/plans` serves My strategies, and does not redirect to it.
 *
 * This is a loop the redirect table cannot fix. Until 2026-09-08 the alias ran
 * the other way and it was **permanent**: `/app/strategies → /app/plans`, a 308
 * that every browser which ever opened the strategies URL has cached and will
 * never ask about again. The page lives at `/app/strategies` — Plans is not a
 * second system — so pointing `/app/plans` back at it would give those
 * browsers `/app/strategies` → *cached 308* → `/app/plans` → 307 →
 * `/app/strategies` → … on the landing page of a whole navigation group, and
 * only for the people who had used it before.
 *
 * A 308 cannot be recalled. So the second URL is served rather than redirected:
 * one page, reachable by both names, and the rail marks My strategies from
 * either because the route registry owns both prefixes.
 */
export { default, metadata } from "../strategies/page";
export const dynamic = "force-dynamic";
