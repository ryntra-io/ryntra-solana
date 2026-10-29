import { normalizeReferralCode } from "../rewards/referral-code.ts";
import { touchLanding, utmTagOf, withoutUtm } from "./touch-param.ts";

/**
 * `?ref=CODE` on any page of the Solana product and its site leads to the friend's page, exactly as `ryntra.io/r/CODE` does: the invitation is remembered by `/r/<code>` — the one place that sets the code in a browser, with its
 * first-touch day and its count of opens — and the person lands where the link pointed: the same page of the product
 * when it is one (`?to=`, this site's `/app` only — `referral-destination.ts` checks it again), else «Винагороди».
 *
 * Only a `ref` that is a referral code as links carry it moves anything — twelve symbols of the code's alphabet with at
 * least one letter, or a whole `/r/<code>` link: `?ref=producthunt`, an empty `ref`, a twelve-digit campaign id or a
 * dashed number is somebody else's parameter, and the page is served as asked (a code of twelve digits — about one
 * in 280 000 — still works as `/r/<code>`). On `app.ryntra.io` the product's pages are `/solana/…`: they are
 * kept as the same `/app/…` page, which that host serves at `/solana/…` again.
 *
 * Only the Solana product and its site move: the landing (`/`, `/uk/…`), `/app/…` and `/solana/…`. Everything else
 * keeps its own `ref` — the other products' pages (a payment link there carries an invoice number as `ref`), the pay
 * page, the API, the admin, files and `/r/` itself. Imports nothing but the code's shape, so the address layer (`middleware.ts`) can call
 * it on the edge.
 */
const SOLANA_SURFACE = /^\/(?:$|uk(?:\/|$)|app(?:\/|$)|solana(?:\/|$))/;
const FILE = /\.[a-z0-9]{1,8}$/i;
/** Ryntra Predictions answers on its own host; its `/` is not the Solana landing. */
const OTHER_HOST = /^predict[a-z0-9-]*\./i;

/** `/solana/workspace/<page>` is the old address of `/app/<page>`; `/solana/<page>` is the app host's. */
function productPage(pathname: string): string {
  return pathname.startsWith("/solana/workspace/") ? `/app/${pathname.slice("/solana/workspace/".length)}`
    : pathname === "/solana" || pathname.startsWith("/solana/") ? `/app${pathname.slice("/solana".length)}` : pathname;
}

/**
 * `?utm_source=…` on the same pages leads through `/r/t` (Ріст 7): the growth panel remembers the source in the
 * browser, counts the visit and sends the person on to the same page without the UTM parameters. A `ref` wins over
 * UTM — a friend's link is the stronger tag. Only on the Solana product and its site, as above.
 */
function utmRedirect(url: URL): URL | null {
  if (!utmTagOf(url.searchParams)) return null;
  const rest = withoutUtm(url.searchParams).toString();
  const to = touchLanding(`${productPage(url.pathname)}${rest ? `?${rest}` : ""}`) ?? "/";
  const target = new URL("/r/t", url.origin);
  for (const [key, value] of url.searchParams) if (key.startsWith("utm_")) target.searchParams.set(key, value);
  target.searchParams.set("to", to);
  return target;
}

export function refParamRedirect(url: URL): URL | null {
  const raw = url.searchParams.get("ref");
  /* A file outside the product (a ticker with a dot, `/app/stocks/BRK.B`, is a page); never on another product's host. */
  if (!SOLANA_SURFACE.test(url.pathname) || OTHER_HOST.test(url.hostname)) return null;
  if (FILE.test(url.pathname) && !/^\/(?:app|solana)\//.test(url.pathname)) return null;
  if (raw === null) return utmRedirect(url);
  const trimmed = raw.trim();
  const code = normalizeReferralCode(trimmed);
  if (!code || (!/\/r\//i.test(trimmed) && (trimmed.toUpperCase() !== code || !/[A-Z]/.test(code)))) return utmRedirect(url);
  const rest = new URL(url.href);
  rest.searchParams.delete("ref");
  const target = new URL(`/r/${code}`, url.origin);
  const page = productPage(rest.pathname);
  if (page === "/app" || page.startsWith("/app/")) target.searchParams.set("to", `${page}${rest.search}`);
  return target;
}
