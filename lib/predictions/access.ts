/**
 * Whether a person can trade on a venue, as the provider states it — never a
 * rule of Ryntra's own. Each state is read from one of the provider's own
 * answers:
 *
 * - `off` — the provider's app configuration disables the venue for trading
 *   (`disabledVenues`), or a quote says the venue is closed to orders;
 * - `view` — the provider's profile flags the person's location
 *   (`isLocationBlocked`), or a quote's warning or a venue's own quote says
 *   the venue refuses this person's location: prices stay visible, buying
 *   does not;
 * - `account` — a venue the provider trades only through the person's own
 *   venue account: Kalshi through the person's own key, Novig and ProphetX
 *   through the provider's shared identity check; until the provider's
 *   profile lists that account as verified;
 * - `open` — the provider has answered for this person and none of the above
 *   holds;
 * - `unknown` — the provider has not answered yet (a guest, an unread
 *   profile, an unread app configuration): nothing is claimed.
 *
 * A market is never hidden for any of these: the surface shows the state and
 * says why. Pure: shared by the server and the pages.
 */

export type VenueAccess = "open" | "account" | "view" | "off" | "unknown";

/** What the provider said about this person and this app; null where it was not read. */
export type AccessFacts = Readonly<{
  /** The provider's location flag on the person's profile; null for a guest or an unread profile. */
  locationBlocked: boolean | null;
  /** The person's venue accounts as the provider lists them; null when unread. */
  venueAccounts: readonly Readonly<{ venue: string; status: string; kycStatus: string }>[] | null;
  /** Venues the provider's app configuration disables; null until the configuration is read. */
  disabledVenues: readonly string[] | null;
}>;

export type AccessWarning = Readonly<{ venue: string; reason: string }>;

/** Venues the provider trades only through the person's own account there: Kalshi with the person's key, Novig and ProphetX after the shared identity check. */
export const ACCOUNT_VENUES: ReadonlySet<string> = new Set(["kalshi", "novig", "prophetx"]);

const LOCATION = /\b(geo|geoblock\w*|geo[-_ ]?(?:gat|restrict|block)\w*|location|country|countries|region|jurisdiction|restricted territory)\b/i;
const CLOSED = /\b(disabled|not supported|unsupported|halted|suspended|paused|inactive|maintenance)\b/i;

export const GUEST_ACCESS: AccessFacts = { locationBlocked: null, venueAccounts: null, disabledVenues: null };

function verified(venue: string, facts: AccessFacts): boolean {
  return (facts.venueAccounts ?? []).some((a) => a.venue === venue && /^(verified|approved|passed|complete)/i.test(a.kycStatus) && !/^(disabled|revoked|closed|suspended)/i.test(a.status));
}

export function venueAccess(venue: string, facts: AccessFacts, warnings: readonly AccessWarning[] = []): VenueAccess {
  const said = warnings.filter((w) => w.venue === venue).map((w) => w.reason);
  if ((facts.disabledVenues ?? []).includes(venue) || said.some((r) => CLOSED.test(r) && !LOCATION.test(r))) return "off";
  if (facts.locationBlocked === true || said.some((r) => LOCATION.test(r))) return "view";
  if (facts.locationBlocked == null || facts.disabledVenues == null) return "unknown";
  if (ACCOUNT_VENUES.has(venue) && !verified(venue, facts)) return "account";
  return "open";
}

const RANK: Readonly<Record<VenueAccess, number>> = { open: 0, account: 1, unknown: 2, view: 3, off: 4 };

/** A market's state for a card: the best any of its venues offers this person. */
export function marketAccess(venues: readonly string[], facts: AccessFacts): VenueAccess {
  if (venues.length === 0) return facts.disabledVenues == null ? "unknown" : "off";
  return venues.map((v) => venueAccess(v, facts)).reduce((best, s) => (RANK[s] < RANK[best] ? s : best), "off" as VenueAccess);
}

/** How many of the venues this person can buy on now. */
export function openVenueCount(venues: readonly string[], facts: AccessFacts): number {
  return venues.filter((v) => venueAccess(v, facts) === "open").length;
}
