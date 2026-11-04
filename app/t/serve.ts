import type { NextRequest } from "next/server";

import { withinMetadataBudget } from "@/app/app/metadata-budget";
import { launchWords } from "@/app/app/launch/launch-words";
import { formatBps } from "@/app/app/launch/launch-format";
import { coinOpenGraph, COIN_OG_SIZE } from "@/city/lib/coin/og.server";
import { readCoinCard } from "@/city/lib/coin/read.server";
import type { LaunchTokenResponse } from "@/lib/api/v1/contract";
import { getGuardRuntime } from "@/lib/guard/runtime";
import { isLinkPreview } from "@/lib/growth/link-opens";
import { launchConnection, launchNetwork, launchPoolPayerAddress, type LaunchNetwork } from "@/lib/launch/config.server";
import { REFERRAL_ROUTE_FOLLOWS_TO } from "@/lib/launch/flow.server";
import { launchReferralPath, launchShortPath } from "@/lib/launch/share-link";
import { launchShareFacts, launchShareFactsOfRecord, resolveLaunchShort, type LaunchShareFacts, type LaunchShort } from "@/lib/launch/share.server";
import { readLaunchView } from "@/lib/launch/view.server";
import { normalizeReferralCode } from "@/lib/rewards/referral";

/**
 * The short address of a launched token (SOL-L1e): `/t/<8>[/<code>]`, `/uk/t/…` in Ukrainian.
 *
 * A person is sent on at once — through `/r/<code>`, which remembers the code, to the token's page — and nothing is
 * read for them on the way. A link preview (X, Telegram, any fetcher that names itself, or none) gets a small page
 * that only carries the token's card: robots.txt closes `/app/`, so the card has to answer here. Never cached: one
 * address answers a person and a preview differently.
 */

/** How long a preview's page waits for the chain: a preview fetcher waits seconds, a person never waits here. */
const PREVIEW_READ_MS = 4_000;
/** The card's address changes this often, so a share posted later shows the market then. */
const CARD_FRESH_S = 600;

type Locale = "en" | "uk";

/* The page and the card name the network's own address (ryntra.io; a devnet stand's configured origin) — as Launch
   never takes an origin from a request — and a person is sent on by a path on the host they came through. */
function redirect(path: string): Response {
  return new Response(null, { status: 302, headers: { location: path, "cache-control": "no-store, private", vary: "User-Agent" } });
}

async function tokenView(mint: string): Promise<LaunchTokenResponse | null> {
  const network = launchNetwork();
  const payer = network ? launchPoolPayerAddress(network) : null;
  if (!network || !payer) return null;
  return readLaunchView({ network, connection: launchConnection(network), store: getGuardRuntime().store, poolPayer: payer, origin: network.origin, now: () => new Date() }, mint);
}

/* The chain read in time: what it says; read too slowly, the name and ticker the launch was recorded with — a preview
   is never a bare «Ryntra», and never a figure the chain did not give. The card reads the market itself. */
async function cardFacts(launch: LaunchShort, network: LaunchNetwork): Promise<LaunchShareFacts> {
  const token = await withinMetadataBudget(tokenView(launch.token), null, PREVIEW_READ_MS);
  return token ? launchShareFacts(token, null) : launchShareFactsOfRecord(launch, `solana:${network.cluster}`);
}

/* The preview page carries the city's logo on the night ground (CITY-158: the mark is never set on a light one), never a
   lettered tile (SOL-C3). A path on the host the page answers from: the page's CSP lets an image come from itself only. */
const BRAND_LOCKUP = "/brand/city/logo-transparent.png";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** `/t/<slug>[/<code>]`: the person on to the token, the preview its card. */
export async function serveLaunchShort(req: NextRequest, slug: string, rawCode: string | null, locale: Locale): Promise<Response> {
  const network = launchNetwork();
  if (!network) return new Response("Not found", { status: 404 });
  const launch = await resolveLaunchShort(getGuardRuntime().store, network.cluster, slug).catch(() => null);
  const code = rawCode ? normalizeReferralCode(rawCode) : null;
  /* An address that names no launch, or more than one: every market launched on Ryntra, never a guess — the sharer's
     code still remembered on the way. */
  if (!launch) return redirect(code && REFERRAL_ROUTE_FOLLOWS_TO ? `/r/${code}?to=/app/launch/markets` : "/app/launch/markets");
  const mint = launch.token;
  if (!isLinkPreview(req.headers.get("user-agent"))) return redirect(launchReferralPath(mint, code, REFERRAL_ROUTE_FOLLOWS_TO));

  const word = launchWords(locale);
  const origin = network.origin;
  /* The page names the card; the card reads the market itself, so the page waits only for the token. */
  const facts = await cardFacts(launch, network);
  const here = `${origin}${locale === "uk" ? "/uk" : ""}${launchShortPath(mint, code)}`;
  const open = `${origin}${launchReferralPath(mint, code, REFERRAL_ROUTE_FOLLOWS_TO)}`;
  const version = Math.floor(Date.now() / 1000 / CARD_FRESH_S);
  const image = `${origin}${launchShortPath(mint, null)}/image?v=${version}`;
  const symbol = facts.symbol;
  const title = word("cardTitle", { name: facts.name, symbol });
  const lead = !facts.dex
    ? word("cardLeadPlain")
    : facts.dex.migrated
      ? word("cardLeadDex")
      : word("cardLeadCurve", { pct: formatBps(facts.dex.bps, locale) });
  const description = [lead, facts.marks.length ? word("cardLeadMarks") : null, word("cardNoAdvice"), word("noGuarantee")].filter(Boolean).join(" ");
  const alt = word("cardAlt", { name: facts.name, symbol });
  const meta: ReadonlyArray<readonly [string, string, string]> = [
    ["name", "description", description],
    ["name", "robots", "noindex, nofollow"],
    ["property", "og:type", "website"],
    ["property", "og:site_name", "Ryntra"],
    ["property", "og:locale", locale === "uk" ? "uk_UA" : "en_US"],
    ["property", "og:url", here],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["property", "og:image", image],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", String(COIN_OG_SIZE.width)],
    ["property", "og:image:height", String(COIN_OG_SIZE.height)],
    ["property", "og:image:alt", alt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
    ["name", "twitter:image:alt", alt],
  ];
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${meta
    .map(([key, name, content]) => `<meta ${key}="${name}" content="${escapeHtml(content)}">`)
    .join("")}<link rel="icon" href="/icon.svg" type="image/svg+xml"></head><body style="background:#06050C;color:#EEF1FF"><p><img src="${BRAND_LOCKUP}" alt="Ryntra" height="28"></p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><p><a href="${escapeHtml(open)}">${escapeHtml(word("cardOpen", { symbol }))}</a></p></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store, private", vary: "User-Agent", "x-robots-tag": "noindex, nofollow" } });
}

/**
 * `/t/<slug>/image`: the token's card — its tower's card in the city (CITY-158), the same picture as `/c/<mint>`'s, with
 * the price and the day's move the engine reads now. The card keeps itself as long as its price stays worth showing.
 */
export async function serveLaunchCard(_req: NextRequest, slug: string): Promise<Response> {
  const network = launchNetwork();
  if (!network) return new Response("Not found", { status: 404 });
  const launch = await resolveLaunchShort(getGuardRuntime().store, network.cluster, slug).catch(() => null);
  if (!launch) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
  return coinOpenGraph(await readCoinCard(launch.token));
}
