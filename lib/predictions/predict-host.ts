/**
 * predict.ryntra.io — the address Ryntra Predictions had while it was a product of its own.
 *
 * Predictions is a section of Ryntra on Solana: its pages answer in the Solana cabinet at `/app/predictions`, with the
 * cabinet's header, menu and wallet. The host stays an address, and every page of it opens there in one hop, path
 * kept:
 * - the hub (`/`, `/predict`, `/predictions`) opens the section's hub;
 * - a market or the portfolio (`/predict/…`, `/app/predictions/…`) opens the same page of the section;
 * - anything else opens on ryntra.io.
 *
 * Only the API and the build's files still answer on the host, for a caller that names it. The rules are temporary,
 * so the host can be taken back. `NEXT_PUBLIC_RYNTRA_PREDICT_URL` names the host when it is another than
 * `predict.ryntra.io` (a staging host); it no longer leads the section anywhere.
 */

import { publicUrl, SITE_ORIGIN } from "../product/app-address.ts";

type Env = Readonly<Record<string, string | undefined>>;
type HostCondition = { type: "host"; value: string };

const DEFAULT_HOST = "predict.ryntra.io";
/** The section in the Solana cabinet. */
const SECTION = "/app/predictions";

/**
 * The host as the deployment names it — an https origin `predict…` under ryntra.io and nothing else — or null. Never a
 * sibling host (the site, the app, another product's): this one switch decides that host's routing.
 */
export function predictionsHost(value: string | undefined): string | null {
  const named = value?.trim().replace(/\/+$/, "");
  return named && /^https:\/\/predict[a-z0-9-]*\.ryntra\.io$/.test(named) ? named : null;
}

/** The bare host name the rules are written for. */
export function predictHostName(env: Env = process.env): string {
  const host = predictionsHost(env.NEXT_PUBLIC_RYNTRA_PREDICT_URL);
  return host ? host.slice("https://".length) : DEFAULT_HOST;
}

/** A `has` condition matching the host only (Next anchors it as `^…$`). */
export function onPredictHost(env: Env = process.env): HostCondition[] {
  return [{ type: "host", value: predictHostName(env).replace(/\./g, "\\.") }];
}

/** What the host still answers itself: the API and the build's own files. */
const KEPT = ["api", "_next", "_vercel"].map((segment) => `${segment}(?:/|$)`).join("|");
/** A file of the build: a path with an extension — but no page of the app, where a dot is part of a name (`/app/stocks/BRK.B`). */
const FILE = "(?!app(?:/|$)).*[.][A-Za-z0-9]+$";

/**
 * The host's redirects, read before every row but the landing's language map, so each path on the host is settled
 * in one hop. The section opens at its public address — app.ryntra.io once that host is live, ryntra.io before. The
 * shell the product had (`/predict`) answers nowhere any more: on every other host its addresses open the section
 * by its route, which the app host's own rows then carry on (one more hop there).
 */
export function predictHostRedirects(env: Env = process.env) {
  const has = onPredictHost(env);
  const section = publicUrl(SECTION, env);
  return [
    { source: "/", has, destination: section, permanent: false },
    { source: "/predict", has, destination: section, permanent: false },
    { source: "/predictions", has, destination: section, permanent: false },
    { source: "/predict/:path*", has, destination: `${section}/:path*`, permanent: false },
    { source: SECTION, has, destination: section, permanent: false },
    { source: `${SECTION}/:path*`, has, destination: `${section}/:path*`, permanent: false },
    { source: `/:path((?!${KEPT})(?!${FILE}).+)`, has, destination: `${SITE_ORIGIN}/:path`, permanent: false },
    { source: "/predict", destination: SECTION, permanent: false },
    { source: "/predict/:path*", destination: `${SECTION}/:path*`, permanent: false },
  ];
}
