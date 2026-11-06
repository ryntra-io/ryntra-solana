/**
 * The application's one address: `app.ryntra.io/solana/…`. `ryntra.io` stays
 * the site and the documentation. The full map, and the order the switches are
 * turned on in, is `docs/domains/ADDRESS-MAP.md`. Ryntra is Solana only
 * (decision 69): the other products' addresses are not served by this build on
 * either host — app.ryntra.io sends them to ryntra.io, where the city answers
 * (`city/lib/open/old-addresses.ts`).
 *
 * This build serves the Solana product under `/app`, and every link it draws
 * still says `/app/…`. On `app.ryntra.io` the same pages answer at
 * `/solana/…`: a rewrite serves `/solana/<page>` from `/app/<page>`, and the
 * build's own `/app/<page>` links move there by a temporary redirect.
 *
 * Read when the build is made, unset by default, so a build changes nothing on
 * ryntra.io until the project is told so:
 *
 * - `RYNTRA_APP_HOST_LIVE=1` — `app.ryntra.io` is a verified domain of this
 *   project. Then every old address on `ryntra.io` (`/app/…`, `/uk/app/…`,
 *   `/solana/workspace/…`) moves there for good (308)
 *   with its path and query, and the pages offered to the index name their
 *   new address as canonical. Before that, a 308 would send people — and
 *   every browser cache — to a host that does not answer.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** The site and the documentation. */
export const SITE_HOST = "ryntra.io";
export const SITE_ORIGIN = `https://${SITE_HOST}`;
/** The application. */
export const APP_HOST = "app.ryntra.io";
export const APP_ORIGIN = `https://${APP_HOST}`;

/** Each network's entry on the application's host. */
export const NETWORK_ENTRIES = { solana: "/solana" } as const;
/** Where the Solana product's routes live inside this build. */
export const SOLANA_ROUTES = "/app";
/** The page under `/app` that stays on ryntra.io after the move: Receipts, where this origin's receipts reach the server archive. */
export const RECEIPTS_HANDOVER = "receipts";
const UK = "/uk";

/** Next anchors a `has` host value as `^…$`. */
const hostPattern = (host: string) => host.replace(/\./g, "\\.");
type HostCondition = { type: "host"; value: string };
type Condition = HostCondition | { type: "query"; key: string; value?: string };
export const ON_APP_HOST: HostCondition[] = [{ type: "host", value: hostPattern(APP_HOST) }];
export const ON_SITE_HOST: HostCondition[] = [{ type: "host", value: hostPattern(SITE_HOST) }];

export function appHostLive(env: Env = process.env): boolean {
  return env.RYNTRA_APP_HOST_LIVE?.trim() === "1";
}

/** A path of this build's Solana routes at its address on app.ryntra.io: `/app/swap` → `/solana/swap`, `/uk/app/home` → `/uk/solana/home`. Anything else as it is. */
export function solanaAddress(path: string): string {
  const uk = path === UK || path.startsWith(`${UK}/`);
  const rest = uk ? path.slice(UK.length) : path;
  if (rest !== SOLANA_ROUTES && !rest.startsWith(`${SOLANA_ROUTES}/`) && !rest.startsWith(`${SOLANA_ROUTES}?`)) return path;
  return `${uk ? UK : ""}${NETWORK_ENTRIES.solana}${rest.slice(SOLANA_ROUTES.length)}`;
}

/** The route of this build a Solana address on app.ryntra.io is served from: `/solana/swap` → `/app/swap`. Anything else as it is. */
export function solanaRoute(path: string): string {
  const entry = NETWORK_ENTRIES.solana;
  if (path !== entry && !path.startsWith(`${entry}/`)) return path;
  return `${SOLANA_ROUTES}${path.slice(entry.length)}`;
}

/** A page of this build, absolute, at the address a person should open: app.ryntra.io for the Solana routes once that host is live, ryntra.io for everything else. */
export function publicUrl(path: string, env: Env = process.env): string {
  const moved = solanaAddress(path);
  if (moved !== path && appHostLive(env)) return `${APP_ORIGIN}${moved}`;
  return path === "/" ? SITE_ORIGIN : `${SITE_ORIGIN}${path}`;
}

export type AddressRedirect = {
  source: string;
  destination: string;
  permanent: boolean;
  has?: Condition[];
  missing?: Condition[];
};
/** A row of the build's own table, as these functions read it. */
type TableRow = Readonly<{ source: string; destination: string; permanent: boolean; has?: unknown }>;

/** A destination of a row this build answers on ryntra.io, as the same row answers on app.ryntra.io. */
function onAppHost(destination: string): string {
  if (/^https?:\/\//.test(destination)) return destination;
  const moved = solanaAddress(destination);
  return moved !== destination ? moved : `${SITE_ORIGIN}${destination}`;
}

/**
 * What app.ryntra.io answers before any page — only on that host, so
 * ryntra.io and every deployment address answer exactly as they did.
 *
 * `rows` is the build's own table (`next.config.ts`): each row whose source
 * is a Solana route answers here at its Solana address, with the same
 * permanence, so an alias works the same on both hosts in one hop.
 */
export function appHostRedirects(rows: readonly TableRow[]): AddressRedirect[] {
  const to = (source: string, destination: string, permanent = false): AddressRedirect => ({ source, destination, permanent, has: ON_APP_HOST });
  const solana = NETWORK_ENTRIES.solana;
  const seen = new Set<string>();
  const translated: AddressRedirect[] = [];
  for (const row of rows) {
    if (row.has) continue;
    const source = solanaAddress(row.source);
    if (source === row.source || seen.has(source)) continue;
    seen.add(source);
    translated.push(to(source, onAppHost(row.destination), row.permanent));
  }
  /* The site's own pages live on ryntra.io: the documentation, the legal
     texts, the company pages. Everything that is not a network, a friend's
     link (`/r/<code>`, whose cookie the app must read on this host), a sign-in
     return (`/auth/…`, which needs the cookies its start set on this host), the
     operators' pages (`/admin`, which read the same session), an API or a file
     moves there for good — this host is the application only. The other
     products' old addresses are the site's too: there the city answers. */
  const NOT_SITE = ["solana", "uk/solana", "r", "auth", "admin", "api", "_next", "_vercel"]
    .map((segment) => `${segment}(?:/|$)`)
    .join("|");
  return [
    /* The host's root opens the first network, where its own root leads. */
    to("/", translated.find((row) => row.source === solana)?.destination ?? solana),
    ...translated,
    /* The build's own links say `/app/…`; here they read `/solana/…`. */
    to(SOLANA_ROUTES, solana),
    to(`${SOLANA_ROUTES}/:path*`, `${solana}/:path*`),
    to(`${UK}${SOLANA_ROUTES}`, `${UK}${solana}`),
    to(`${UK}${SOLANA_ROUTES}/:path*`, `${UK}${solana}/:path*`),
    { source: `/:path((?!${NOT_SITE})(?!.*[.][A-Za-z0-9]+$).+)`, destination: `${SITE_ORIGIN}/:path`, permanent: true, has: ON_APP_HOST },
  ];
}

/**
 * The old addresses on ryntra.io, moved for good to app.ryntra.io with the
 * same path and query (Next carries the query along) — only once that host is
 * live. A row of the build's own table that already names a Solana workspace
 * page's new place keeps it, at the new host, in one hop.
 */
export function siteHostRedirects(rows: readonly TableRow[], env: Env = process.env): AddressRedirect[] {
  if (!appHostLive(env)) return [];
  const to = (source: string, destination: string, permanent = true): AddressRedirect => ({ source, destination, permanent, has: ON_SITE_HOST });
  const solana = `${APP_ORIGIN}${NETWORK_ENTRIES.solana}`;
  const workspace = "/solana/workspace";
  const named = rows
    .filter((row) => !row.has && /^\/solana(?:\/workspace(?:\/[^:]*)?)?$/.test(row.source))
    .filter((row) => !row.destination.startsWith(`${SOLANA_ROUTES}/${RECEIPTS_HANDOVER}`))
    .map((row) => {
      const destination = onAppHost(row.destination);
      return to(row.source, destination.startsWith("/") ? `${APP_ORIGIN}${destination}` : destination, row.permanent);
    });
  return [
    to(SOLANA_ROUTES, solana),
    /* Every page but Receipts: a person's receipts live in this origin's browser storage, and that page is where they
       are saved to the server archive, to be loaded on the new host — so it keeps answering here. */
    to(`${SOLANA_ROUTES}/:path((?!${RECEIPTS_HANDOVER}(?:/|$)).+)`, `${solana}/:path`),
    to(`${UK}${SOLANA_ROUTES}`, `${APP_ORIGIN}${UK}${NETWORK_ENTRIES.solana}`),
    to(`${UK}${SOLANA_ROUTES}/:path*`, `${APP_ORIGIN}${UK}${NETWORK_ENTRIES.solana}/:path*`),
    ...named,
    to("/solana", solana),
    to(`${workspace}/:path((?!api(?:/|$)|${RECEIPTS_HANDOVER}(?:/|$)).+)`, `${solana}/:path`),
    /* Friends' links: the cookie they set is read where the app is. */
    to("/r/:code", `${APP_ORIGIN}/r/:code`),
    /* A session is a cookie of one host, and every page that reads it moves: the operators' pages too. */
    to("/admin", `${APP_ORIGIN}/admin`),
    to("/admin/:path*", `${APP_ORIGIN}/admin/:path*`),
    /* Links that open a session — a mail's (sign-up, a new password, a new address), built on this host by the auth
       provider's templates, and a chat's one-time sign-in link — carry a token that needs no cookie from where it was
       asked for: they open on the app host, where the session they make is read. The provider's code
       (`/auth/callback`) returns where its round trip began and never moves. */
    /* Only the token forms: a PKCE `code` needs the verifier cookie of the host it began on, and a logout belongs to
       the host whose cookie it clears. */
    { ...to("/auth/confirm", `${APP_ORIGIN}/auth/confirm`), missing: [{ type: "query", key: "code" }] },
    { ...to("/api/session", `${APP_ORIGIN}/api/session`), has: [...ON_SITE_HOST, { type: "query", key: "t" }] },
  ];
}

/** A page's own headers at its address on app.ryntra.io too: `/app/predictions` is `/solana/predictions` there. */
export function atBothAddresses<T>(source: string, headers: T) {
  const moved = solanaAddress(source);
  return moved === source ? [{ source, headers }] : [{ source, headers }, { source: moved, has: ON_APP_HOST, headers }];
}

/**
 * What app.ryntra.io serves from where, after the redirects: the Solana
 * addresses from this build's `/app` routes. Before files, so no route of this
 * build answers them first.
 */
export function appHostRewrites() {
  const solana = NETWORK_ENTRIES.solana;
  const at = (source: string, destination: string) => ({ source, destination, has: ON_APP_HOST });
  return [at(solana, SOLANA_ROUTES), at(`${solana}/:path*`, `${SOLANA_ROUTES}/:path*`)];
}
