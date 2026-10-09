import type { NextConfig } from "next";
import { ENABLED_LOCALE_CODES } from "./app/i18n/locales.ts";
import { CUSTOMER_REDIRECTS } from "./lib/product/customer-routing.ts";

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
export const LANDING_REDIRECTS = [
  { source: "/en", destination: LANDING_ADDRESSES.en, permanent: true },
  { source: "/ua", destination: LANDING_ADDRESSES.uk, permanent: true },
  ...PARKED_LANGUAGE_ADDRESSES.map((source) => ({ source, destination: LANDING_ADDRESSES.en, permanent: false })),
  /* The app's door in Ukrainian, as `/app` is in English: one hop to Home at
     its Ukrainian address. */
  { source: "/uk/app", destination: "/uk/app/home", permanent: false },
];

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
const CSP = [
  "default-src 'self'",
  /* `oauth.telegram.org` is Telegram Login: its library is loaded only when
     the Telegram door is open and the sheet shows the button, it opens the
     authorization in a popup on its own origin, and inside Telegram's in-app
     browser it fetches the result from that origin instead of a popup — hence
     the same host under connect-src. No frame, no other Telegram host. */
  `script-src 'self' 'unsafe-inline' https://oauth.telegram.org${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  /* `i.ytimg.com` is the embedded player's own poster host. It is requested
     only after a visitor presses play — measured: a fresh load of the video
     page makes zero off-origin requests — but CSP is document-wide, so without it the
     embed logs a blocked-image violation on a public page. An image CDN is a
     far narrower grant than the frame it belongs to. */
  "img-src 'self' data: https://branding.arcus.xyz https://i.ytimg.com",
  "font-src 'self' data:",
  `connect-src 'self' https://api.arcus.xyz wss://api.arcus.xyz https://rpc.mainnet.chain.robinhood.com https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org https://oauth.telegram.org${isDev ? " ws:" : ""}`,
  /* The only third-party frame this site embeds: a product film.
     `youtube-nocookie` rather than `youtube`, and the page renders a local
     poster with a play control instead of the iframe — so nothing is requested
     from Google until a visitor asks for the video. Without this directive the
     embed falls back to `default-src 'self'` and is blocked outright. */
  "frame-src https://www.youtube-nocookie.com",
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
   `lib/security-headers.test.mjs` pins it. */
const PREDICTIONS_CSP = CSP.replace("img-src 'self' data:", "img-src 'self' data: https://assets.agg.market").replace("connect-src 'self'", "connect-src 'self' wss://ws.agg.market");

/* The landing (`/` and `/uk`) carries TradingView's Ticker Tape — a condition
   of the free Advanced Charts licence (2026-10-09, `app/(home)/market-tape.tsx`).
   Measured in a browser: the widget's module and its chunks come from one
   host, which also serves the hidden frame that carries its prices; the
   symbols' logos come from TradingView's logo CDN. Those two origins are
   added here and nowhere else — the rest of the site keeps `CSP`. */
const TRADINGVIEW_WIDGETS = "https://widgets.tradingview-widget.com";
const TRADINGVIEW_LOGOS = "https://s3-symbol-logo.tradingview.com";
const LANDING_CSP = CSP.replace("script-src 'self'", `script-src 'self' ${TRADINGVIEW_WIDGETS}`)
  .replace("frame-src", `frame-src ${TRADINGVIEW_WIDGETS}`)
  .replace("img-src 'self' data:", `img-src 'self' data: ${TRADINGVIEW_LOGOS}`);

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // no-referrer keeps token-bearing URLs (e.g. /beta?t=…) out of outbound Referer headers
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

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
      { source: "/:path*", headers: SECURITY_HEADERS },
      /* The lab's own policy, declared after the site-wide one so that for this
         route the later Content-Security-Policy value replaces the earlier;
         every other security header above stays as it is. */
      { source: "/preview/agg-lab", headers: [{ key: "Content-Security-Policy", value: AGG_LAB_CSP }] },
      { source: "/preview/agg-lab/:path*", headers: [{ key: "Content-Security-Policy", value: AGG_LAB_CSP }] },
      /* The customer Predictions surface: the site policy plus the live feed
         and the event covers, for this route and its markets only. */
      { source: "/app/predictions", headers: [{ key: "Content-Security-Policy", value: PREDICTIONS_CSP }] },
      { source: "/app/predictions/:path*", headers: [{ key: "Content-Security-Policy", value: PREDICTIONS_CSP }] },
      /* The landing, in both its languages: the site policy plus TradingView's widget host. */
      { source: LANDING_ADDRESSES.en, headers: [{ key: "Content-Security-Policy", value: LANDING_CSP }] },
      { source: LANDING_ADDRESSES.uk, headers: [{ key: "Content-Security-Policy", value: LANDING_CSP }] },
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
      { source: "/app/markets/:path+", destination: "/robinhood/workspace/:path+", permanent: true },
      { source: "/app/terminal", destination: "/robinhood/workspace/terminal", permanent: true },
      { source: "/app/terminal/:path*", destination: "/robinhood/workspace/terminal/:path*", permanent: true },
      { source: "/app/swap/:path+", destination: "/robinhood/workspace/swap/:path+", permanent: true },

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
      { source: "/app/beta", destination: "/app", permanent: true },
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
    return [
      ...LANDING_REDIRECTS,
      ...CUSTOMER_REDIRECTS,
      ...previous.filter((row) => !replaced.has(row.source)),
    ];
  },
};

export default nextConfig;
