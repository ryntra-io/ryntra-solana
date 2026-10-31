import { HOME_ENGLISH_ONLY, HOME_TO_APP } from "./lib/site/home-to-app.ts";
import type { NextConfig } from "next";
import { ENABLED_LOCALE_CODES } from "./app/i18n/locales.ts";
import { CUSTOMER_REDIRECTS } from "./lib/product/customer-routing.ts";
import { treasuryNetworkFrom } from "./lib/solana/treasury/model.ts";
import { onPredictHost, predictHostRedirects } from "./lib/predictions/predict-host.ts";
import { seekerRelayCspSources } from "./lib/solana/seeker-connect.ts";
import { appHostRedirects, appHostRewrites, atBothAddresses, everywhereButProxied, ON_APP_HOST, siteHostRedirects, SITE_ORIGIN } from "./lib/product/app-address.ts";
import { OLD_PREFIXES, oldAddressRedirects, shadowedByOldAddresses } from "./city/lib/open/old-addresses.ts";
import { awaitingSources } from "./city/lib/open/site-map.ts";

/* The landing is a page again — English at `/`, Ukrainian at `/uk`. What stays of it is the language map of the
   home page:

   - `/en` → `/` and `/ua` → `/uk`, permanently: each is the same page under
     its one address, and the address decides the language (plan §4);
   - every other language the home page once answered in, and their aliases,
     → `/`, temporarily: those languages are paused, not gone;
   - here, in the config, and never as a `redirect()` in a page: a page's
     redirect answers 200 with a meta refresh on production, which a crawler
     and a link preview do not read as a redirect; and one hop each.
 */
export const LANDING_ADDRESSES = { en: "/", uk: "/uk" } as const;
export const HOME_LANGUAGE_ADDRESSES = [
  /* The languages the home page answered in (`app/[lang]`)… */
  ...ENABLED_LOCALE_CODES.map((code) => `/${code}`),
  /* …and the aliases that used to lead to one of them. */
  "/ua", "/pt", "/pt-br", "/pt-pt", "/zh-cn", "/zh-CN", "/zh-tw", "/zh-hk",
  "/ko-kr", "/ko-KR", "/ru-ru", "/es-es", "/es-419",
] as const;
/** The parked languages: every language address but English, Ukrainian and their own short forms. */
export const PARKED_LANGUAGE_ADDRESSES = HOME_LANGUAGE_ADDRESSES.filter((source) => !["/en", "/uk", "/ua"].includes(source));
/* ryntra.io's home page and its door into the app, and the Ukrainian home leading to the English one (`lib/site/home-to-app.ts`). */
export { HOME_ENGLISH_ONLY, HOME_TO_APP };
export const LANDING_REDIRECTS = [
  ...HOME_TO_APP,
  ...HOME_ENGLISH_ONLY,
  { source: "/en", destination: LANDING_ADDRESSES.en, permanent: true },
  { source: "/ua", destination: LANDING_ADDRESSES.uk, permanent: true },
  ...PARKED_LANGUAGE_ADDRESSES.map((source) => ({ source, destination: LANDING_ADDRESSES.en, permanent: false })),
  /* `/uk/app` led to Home at its Ukrainian address until CITY-13: it is an old address of the cabinet now, and
     opens the city with the rest of them (`OLD_ADDRESS_REDIRECTS` below). */
];

/* The old interface is closed (decision 75, CITY-13): every address of the cabinet, of its Solana workspace, of
   Mission Control and of the aliases that led into them opens the district or window of the city that does the same
   work, for good, in one hop — the table and its reasons are `city/lib/open/old-addresses.ts` and
   `docs/city/OLD-ADDRESSES.md`. On app.ryntra.io the cabinet's `/solana/…` addresses lead to the city on ryntra.io. */
export const OLD_ADDRESS_REDIRECTS = oldAddressRedirects({ condition: ON_APP_HOST[0]!, origin: SITE_ORIGIN });

/* The Vercel hosts that answer beside ryntra.io — the project's default
   domain, the team alias and every preview deployment. They stay reachable
   for review and rollback and are told, per response, that they are not the
   site. Next anchors a `has` value as `^…$`, so this is one regex for all of
   `*.vercel.app`. */
const DEPLOYMENT_HOSTS = ["(?<deployment>[a-z0-9-]+)\\.vercel\\.app"];

/* Security headers (defense-in-depth for a wallet-signing dapp). CSP notes:
   - 'unsafe-inline' scripts are required by Next's hydration payload + our tiny lang/theme
     boot scripts; the win here is blocking EXTERNAL script/frame/object sources, not inline.
   - dev needs 'unsafe-eval' (React Refresh); production build does not.
   - connect-src lists the only client-side upstreams: Arcus WS (demo terminal), the
     Robinhood Chain RPC (balance reads + tx submit from the browser), and Stellar *Testnet*
     Horizon and RPC. Everything else goes through our own /api proxies ('self').

     The Stellar entries were missing until 2026-08-13 and the omission had already shipped:
     `/stellar/workspace/send` (then `/authorize`) reads the signer's account sequence from the browser, so
     on the deployed site its first action failed with a CSP violation and the surface could
     not build a transaction at all. Nothing caught it — the page renders, the read fails
     honestly, and no test makes a browser request. Only loading the page in a browser did.

     Mainnet Stellar is deliberately absent. Every mainnet read in this product happens in a
     server component, and leaving the mainnet origins out means the header itself enforces
     the workspace's testnet-only claim: a client-side call to mainnet Stellar is blocked by
     the browser, not merely by our intent. `lib/stellar/transactions/lifecycle.test.mjs`
     asserts both halves. */
const isDev = process.env.NODE_ENV === "development";
const SEEKER_RELAY = seekerRelayCspSources(process.env.NEXT_PUBLIC_SEEKER_RELAY_DOMAIN);
const CSP = [
  "default-src 'self'",
  /* `oauth.telegram.org` is Telegram Login: its library is loaded only when
     the Telegram door is open and the sheet shows the button, it opens the
     authorization in a popup on its own origin, and inside Telegram's in-app
     browser it fetches the result from that origin instead of a popup — hence
     the same host under connect-src. No frame, no other Telegram host.
     `'wasm-unsafe-eval'` lets the city compile WebAssembly and nothing else (no
     JavaScript eval): the skyline's Meshopt decoder and the guardian's model
     need it (CITY-56, CITY-57). «Дозволяю». */
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://oauth.telegram.org${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  /* `i.ytimg.com` is the embedded player's own poster host. It is requested
     only after a visitor presses play — measured: a fresh load of the video
     page makes zero off-origin requests — but CSP is document-wide, so without it the
     embed logs a blocked-image violation on a public page. An image CDN is a
     far narrower grant than the frame it belongs to. */
  "img-src 'self' data: blob: https://branding.arcus.xyz https://i.ytimg.com",
  /* `blob:` (here and in img-src) is the city's own moment of a trade (`city/lib/trade/moment.ts`): the clip and its
     still are recorded in this page and shown back from an object URL the page made itself. Without media-src the
     player falls back to `default-src 'self'`, refuses the blob, and the done card shows an empty dark box. A blob
     can only be made by a script this policy already runs; no remote media is allowed. */
  "media-src 'self' blob:",
  "font-src 'self' data:",
  /* `SEEKER_RELAY` is the Nostr relays Seeker Connect may carry its wallet session over (SKR-1): ciphertext only, end
     to end between this page and the phone's wallet. Primal's public relay (the default) and Solana Mobile's
     `relay.solanamobile.com` (the target, used once `NEXT_PUBLIC_SEEKER_RELAY_DOMAIN` names it), plus any other host
     the variable names (`lib/solana/seeker-connect.ts`), WebSocket only. */
  `connect-src 'self' https://api.arcus.xyz wss://api.arcus.xyz https://rpc.mainnet.chain.robinhood.com https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://oauth.telegram.org ${SEEKER_RELAY}${isDev ? " ws:" : ""}`,
  /* The only third-party frame this site embeds: a product film.
     `youtube-nocookie` rather than `youtube`, and the page renders a local
     poster with a play control instead of the iframe — so nothing is requested
     from Google until a visitor asks for the video. Without this directive the
     embed falls back to `default-src 'self'` and is blocked outright. */
  "frame-src https://www.youtube-nocookie.com",
  /* The city's score (decision 70) keeps its beat in a worker that Tone.js builds from a blob of its own code, so a
     background tab does not drift the music. A blob can only be made by a script this policy already runs; no
     remote worker is allowed. Without it the browser refuses the worker and logs the refusal on every home visit. */
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/* The AGG product lab is the one route
   that talks to the prediction-market aggregator from the browser: its SDK
   reads `api.agg.market`, its live orderbooks come over `ws.agg.market`, its
   event images are served from `assets.agg.market`, and its stylesheet pulls
   the Inter face and the uicons glyph font from two CDNs. None of that belongs
   in the site-wide policy — the lab is internal, gated behind the admin
   session and linked from nowhere — so the route carries its own policy, with
   the AGG origins added and nothing else widened. `lib/security-headers.test.mjs`
   pins both policies. */
const AGG_LAB_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn-uicons.flaticon.com",
  "img-src 'self' data: blob: https://assets.agg.market",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn-uicons.flaticon.com",
  `connect-src 'self' https://api.agg.market wss://ws.agg.market${isDev ? " ws:" : ""}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/* Predictions
   reads the aggregator through Ryntra's own routes — the browser never calls
   `api.agg.market` and never holds a provider token — but two things are the
   browser's by nature: the live order-book and trade feed over
   `ws.agg.market` (public data, the app id in the URL, no token) and the
   venues' event covers served from `assets.agg.market`. The customer route
   therefore carries the site policy with exactly those two origins added and
   nothing else widened; the REST origin stays out of every customer policy.
   One more origin, Cloudflare's `challenges.cloudflare.com`, for its script
   and its frame: when many people sign in at once the aggregator asks for its
   bot check (Turnstile) before a sign-in starts, and the check is Cloudflare's
   own box. The script is loaded only when that check is asked for.
   `lib/security-headers.test.mjs` pins it. */
const TURNSTILE = "https://challenges.cloudflare.com";
const PREDICTIONS_CSP = CSP.replace("img-src 'self' data:", "img-src 'self' data: https://assets.agg.market").replace("connect-src 'self'", "connect-src 'self' wss://ws.agg.market").replace("script-src 'self'", `script-src 'self' ${TURNSTILE}`).replace("frame-src", `frame-src ${TURNSTILE}`);

/* The landing (`/` and `/uk`) takes the site's policy: its market tape is
   Ryntra's own since SOL-T4 (`app/(home)/market-tape.tsx`, the core's
   sparkline on Solana's prices), so no third-party script, frame or image host
   is added for it. `lib/security-headers.test.mjs` pins it. */

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // no-referrer keeps token-bearing URLs (e.g. /beta?t=…) out of outbound Referer headers
  { key: "Referrer-Policy", value: "no-referrer" },
  /* The microphone is Ryntra's own (`self`) and no frame's: the question field's voice input (AI-06c, AI-08) — the
     browser's recognition and the recording heard on the server — is refused by the browser under `microphone=()`. */
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/* predict.ryntra.io, an address of the Solana cabinet's Predictions section (`lib/predictions/predict-host.ts`). */
const PREDICT_HOST = onPredictHost();

const nextConfig: NextConfig = {
  devIndicators: false,
  reactStrictMode: true,
  /*
   * Where the build lands, overridable for verification builds.
   *
   * A production build overwrites `.next`, and a dev server pointed at the same
   * directory answers 500 for everything afterwards until it is stopped, the
   * directory removed and dev started again. That has happened more than once,
   * and it costs more when two builds share the checkout: one of them runs
   * `npm run build` and the other's server dies without either knowing why.
   *
   * `RYNTRA_DIST_DIR=.next-verify npm run build` proves the build compiles
   * without touching the directory a running dev server is serving from.
   * Unset — which is every deploy — this is exactly the default.
   */
  distDir: process.env.RYNTRA_DIST_DIR || ".next",
  /*
   * A dev stand that reads a public chain node keeps its compiled routes:
   * by default the dev server drops all but a few, and a dropped route's
   * server modules load again with their caches empty — every view then
   * reads the chain cold and the node answers a burst with 429.
   * `RYNTRA_DEV_KEEP_ROUTES=1` (the Launch stand sets it) keeps them for an
   * hour. Only `next dev` reads this; a build and every deploy ignore it.
   */
  ...(process.env.RYNTRA_DEV_KEEP_ROUTES === "1" ? { onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 100 } } : {}),
  /*
   * Every page's metadata in its `<head>`, for every reader — Next's own switch for turning its
   * streamed metadata off.
   *
   * Next streams the title, the description, the canonical and the
   * `hreflang` pair into the `<body>` for everyone but the crawlers it names
   * as unable to run a page. Measured on 2026-09-27: every page of ryntra.io
   * served them twenty kilobytes into the `<body>` — to Googlebot, which is
   * not on that list, and to a browser — and Lighthouse, which reads a
   * description and a canonical only from the `<head>` and no longer names
   * itself in its user agent, scored `/` and `/app` 92 for «no meta
   * description». Google, too, takes a canonical and an `hreflang` from the
   * `<head>`. The price is small: a page's metadata is read from a cookie or
   * the catalogue the server keeps warm, so the first byte waits milliseconds.
   */
  htmlLimitedBots: /.*/,
  /* The icon set is imported through its barrel in most client components, which
     pulls far more of the package into a route than the handful of glyphs it
     actually renders. Rewriting every import to a deep path would work too, but
     it is a rule nobody remembers on the next component; this makes the barrel
     import compile to the same thing. */
  experimental: {
    optimizePackageImports: ["@phosphor-icons/react"],
  },
  async headers() {
    return [
      /* Every path of every host — but not the cabinet's answers on app.ryntra.io, which carry their own. */
      ...everywhereButProxied(SECURITY_HEADERS),
      /* The lab's own policy, declared after the site-wide one so that for this
         route the later Content-Security-Policy value replaces the earlier;
         every other security header above stays as it is. */
      { source: "/preview/agg-lab", headers: [{ key: "Content-Security-Policy", value: AGG_LAB_CSP }] },
      { source: "/preview/agg-lab/:path*", headers: [{ key: "Content-Security-Policy", value: AGG_LAB_CSP }] },
      /* The customer Predictions surface: the site policy plus the live feed
         and the event covers, for this route and its markets only. */
      ...atBothAddresses("/app/predictions", [{ key: "Content-Security-Policy", value: PREDICTIONS_CSP }]),
      ...atBothAddresses("/app/predictions/:path*", [{ key: "Content-Security-Policy", value: PREDICTIONS_CSP }]),
      /* The old interface's addresses only redirect now (CITY-13); a crawler that still holds one drops it. */
      ...OLD_PREFIXES.flatMap((prefix) => [prefix, `${prefix}/:path*`]).map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
      /* The site's public pages still drawn in the old interface, until the city takes each over at its own address
         (CITY-159 → CITY-157): reachable, out of the sitemap, and out of the index (`city/lib/open/site-map.ts`). */
      ...awaitingSources().map((source) => ({ source, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] })),
      /* predict.ryntra.io only leads into the section (NAV-6c): nothing on it is
         a page to index. */
      { source: "/:path*", has: PREDICT_HOST, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      /* The deployment hosts answer the same pages as ryntra.io; a crawler
         that finds one of them must not index a second copy of the site.
         The canonical tag already points home — this is the same answer in
         a header, for the files the tag cannot carry. */
      ...DEPLOYMENT_HOSTS.map((value) => ({
        source: "/:path*",
        has: [{ type: "host" as const, value }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
    ];
  },
  async redirects() {
    // Locale variants go directly to an active public locale. Hidden locales
    // return to English until their copy and browser QA are approved again.
    const previous = [
      /* One host. `www.ryntra.io` served the whole site as a second origin —
         a duplicate for search engines and a second cache key for link
         previews — with only the canonical tag saying which one is real.
         The redirect keeps the path and the query. */
      {
        source: "/:path*",
        has: [{ type: "host" as const, value: "www\\.ryntra\\.io" }],
        destination: "https://ryntra.io/:path*",
        permanent: true,
      },

      /* The public documentation consolidation.

         `/methodology`, `/status` and `/security` were three public documents
         restating one set of boundaries, plus a `Resources` menu pointing at
         all three. They became sections of the Handbook. The routes are kept
         as permanent redirects rather than deleted, because every one of them
         has been sent to a reviewer in a link that has to keep working.

         An older developer shortcut is the same story.

         `/security` is no longer among them. It went back to being a page on
         2026-08-19: there is now enough wallet, venue, agent, AI, cross-chain
         and money-path surface that a boundary statement cannot be a chapter
         inside something else. Reversing a 308 does not un-cache it — every
         browser that already followed this one keeps following it until its own
         cache expires — so `/docs#security` stays and points at the page rather
         than disappearing, and the cached redirect lands somewhere true.

         The route files stay in source until a later task removes them; a
         redirect declared here is matched before routing, so they are already
         unreachable and cannot drift back into the navigation by accident. */
      /* Repointed 2026-08-19, when `/docs` became a hub and its chapters became
         pages. These four used to land on an anchor inside a 13,000-pixel
         document. A page has no fragment to miss. */
      /* Robinhood Chain became a workspace of its own on 2026-08-20.
         It lived at `/app/markets` — a folder inside Home — while every other
         ecosystem had `/<chain>/workspace`. These six keep every link that has
         already been shared working, and they are 308s because the move is
         permanent: the old paths are not coming back, and a temporary redirect
         would leave search engines and bookmarks pointed at a folder that no
         longer exists. The `:path*` forms carry `[symbol]`, `screener/add` and
         `watchlist/observe` with them. */
      /* `/app/markets/pools` is Markets' own pools view again, so it is the one path these leave alone. */
      { source: "/app/markets/:path((?!pools(?:/|$)).+)", destination: "/robinhood/workspace/:path", permanent: true },
      { source: "/app/terminal", destination: "/robinhood/workspace/terminal", permanent: true },
      { source: "/app/terminal/:path*", destination: "/robinhood/workspace/terminal/:path*", permanent: true },
      /* SOL-C13, UX-010: a path under Swap is Swap — it no longer passes through Robinhood's workspace to the landing. */
      { source: "/app/swap/:path+", destination: "/app/swap", permanent: true },

      /* The handbook chapters these once pointed at redirect to the guides
         themselves (`CUSTOMER_REDIRECTS`), so each row goes to `/docs`
         directly — one hop, not a chain of two.

         `/methodology` left this list on 2026-09-26: it is a page again — where every figure Ryntra shows
         comes from, and when. A browser that followed the old 308 keeps
         landing on `/docs` until its own cache expires, which is somewhere
         true. */
      { source: "/capabilities", destination: "/docs", permanent: true },
      { source: "/status", destination: "/docs", permanent: true },
      { source: "/roadmap", destination: "/docs", permanent: true },
      /* Old shortcuts keep answering. */
      { source: "/guard", destination: "/docs/developers/guard", permanent: true },
      /* «Points and levels» merged into «Rewards» on 2026-10-26 (SOL-C17,
         audit card UX-751, following Ріст 19). It documented the Points V1
         programme — levels, a lifetime total, a daily cap — which the server
         counts and no screen a person can open draws, so the page described a
         balance nobody could go and find. What a person has is the rank, and
         the Rewards page explains it; the one sentence this page carried that
         Rewards did not — what points are not — moved there with it. A 308
         because it is not coming back, and the phone's deep links name the old
         slug (`apps/mobile/src/features/monitoring/deep-link.ts`). */
      { source: "/docs/money/points", destination: "/docs/money/rewards", permanent: true },
      { source: "/uk/docs/money/points", destination: "/uk/docs/money/rewards", permanent: true },
      { source: "/proof", destination: "/verify", permanent: true },

      /* Public surface consolidation, 2026-08-26. Competing doors become
         permanent redirects. */
      { source: "/home", destination: "/app", permanent: true },
      /* Removed 2026-09-04 with the public header. `app/agent-control/page.tsx`
         is a finished 332-line public page and the 2026-08-26 consolidation had
         been sending it to the workspace as a competing door — so the site had
         a page about agents that nobody could reach, and the owner's header
         entry `For agents` had nowhere public to point. A marketing header that
         drops a visitor straight into the application is not a marketing
         header. `/agents` keeps its redirect: it is a bare prefix nobody was
         handed. */
      { source: "/agents", destination: "/agents/workspace", permanent: true },
      { source: "/beta", destination: "/app", permanent: true },
      /* One hop to Home (B18): `/app` → `/app/home` was the second. */
      { source: "/app/beta", destination: "/app/home", permanent: true },
      /* `/app/agents` by its content (B18): the treasury where an agent's money and limits live, «Боти» where this
         deployment does not serve it — never the recurring-buy rules. Not permanent: the answer follows the build. */
      {
        source: "/app/agents",
        destination: treasuryNetworkFrom(process.env.NEXT_PUBLIC_RYNTRA_TREASURY_NETWORK) ? "/app/treasury" : "/app/bots",
        permanent: false,
      },
      { source: "/demo", destination: "/app", permanent: true },
      /* Addresses already given out keep answering as they did. */
      { source: "/arc/demo", destination: "/arc/workspace", permanent: true },
      {
        source: "/arc/proof",
        destination: "/arc/workspace/verifier?ref=rcp_62a901894bac4b9cbdd335445e101635",
        permanent: true,
      },
      { source: "/arc/deck", destination: "/arc", permanent: true },
      { source: "/workspaces", destination: "/docs/current-capabilities", permanent: true },
      { source: "/solana", destination: "/solana/workspace", permanent: true },
      { source: "/stellar", destination: "/stellar/workspace", permanent: true },
      { source: "/robinhood", destination: "/robinhood/workspace", permanent: true },
      { source: "/agents/verify", destination: "/verify", permanent: true },

      /* The new homepage was built and reviewed at `/v2` before it took `/`.
         The route is gone now, and anyone holding that link — a bookmark from
         the build, a preview URL — lands on the landing rather than on a 404.
         Temporary, not permanent: `/v2` was never a published address and
         does not deserve to be cached in anyone's browser forever. */
      { source: "/v2", destination: LANDING_ADDRESSES.en, permanent: false },

      /* The Asset Passport URL four documents claimed and no router ever served.
         It is the exact
         URL somebody pastes as proof.

         The documents are corrected, and this redirect makes the stale copies
         harmless rather than merely wrong. It protects future readers, not old
         links: no external link to this path ever resolved. */
      { source: "/stellar/asset/:asset", destination: "/stellar/workspace/assets/:asset", permanent: true },

      /* `Authorize` became `Send`.

         It named a stage of the lifecycle rather than the job somebody came to
         do — nobody opens a workspace to authorize — and it left the module
         registry describing one capability twice, as a built `Authorize` and a
         gated future `Send` with two different states for the same code.

         Unlike the Passport redirect above, this path *was* live: it shipped on
         2026-08-13, is named in the deployed release record, and is the URL in
         every note about the signed testnet lifecycle. */
      { source: "/stellar/workspace/authorize", destination: "/stellar/workspace/send", permanent: true },

      /* The language addresses of the home page (`/en`, `/ua`, `/pt`…) and
         `/company` left this list on 2026-09-26 for `LANDING_REDIRECTS`
         above, each in one hop. */
    ];
    const replaced = new Set([...LANDING_REDIRECTS, ...CUSTOMER_REDIRECTS].map((row) => row.source));
    const table = [...LANDING_REDIRECTS, ...CUSTOMER_REDIRECTS, ...previous.filter((row) => !replaced.has(row.source))];
    return [
      ...LANDING_REDIRECTS,
      /* predict.ryntra.io only leads into the Solana cabinet's Predictions section; every other path there opens on
         ryntra.io. Right after the landing's language map, ahead of every other row. Only the host's own rows: the old
         product shell `/predict` on the other hosts is an old address now, and the city's table leads it to the Oracle. */
      ...predictHostRedirects().filter((row) => row.has),
      /* The old interface and the short addresses, ahead of every row that still names one of their pages (CITY-13,
         CITY-159). The rows below that answer under one of its prefixes, or at an address it answers as it is
         (`/status`, `/home`), are never reached, so they are left out: what is left leads to the city in one hop. */
      ...OLD_ADDRESS_REDIRECTS,
      ...[
        /* The application's own host, and — once it is live — the old
           addresses on ryntra.io moving there with their path and query
           (`lib/product/app-address.ts`). Each row names its host, so before
           the switch ryntra.io answers exactly as below. */
        ...appHostRedirects(table),
        ...siteHostRedirects(table),
        ...table.slice(LANDING_REDIRECTS.length),
      ].filter((row) => !shadowedByOldAddresses(row.source)),
    ];
  },
  /* On app.ryntra.io the Solana pages answer at `/solana/…`, served from
     their `/app/…` routes; the other network's cabinet, its APIs and its
     files reach its own deployment once it answers behind the proxy. Every
     rule names that host. */
  async rewrites() {
    return { beforeFiles: [...appHostRewrites()], afterFiles: [], fallback: [] };
  },
};

export default nextConfig;
