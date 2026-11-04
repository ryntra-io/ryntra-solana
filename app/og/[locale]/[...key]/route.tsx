import { companyCard, docsCard, isPageCardId, marketsCard, pageCard, type CardLocale, type CardSpec } from "@/app/brand/page-card";
import { cityCard } from "@/city/lib/share/card.server";
import { companyCardInputOf } from "@/lib/site/company-page";
import { findStockRow } from "@/lib/stocks/universe.server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * The share card older posts of a page name: since CITY-158 the city's card
 * (`city/lib/share/card.server.tsx`) in the page's language — the pages now
 * name `/opengraph-image` themselves (`pageCardImage` in `app/seo.ts`) — for
 *
 * - `/og/{en|uk}/page/{company|security|methodology|contact|stats}`
 * - `/og/{en|uk}/docs` and `/og/{en|uk}/docs/{slug}`
 * - `/og/{en|uk}/markets`
 * - `/og/{en|uk}/company/{token}`
 *
 * The landing's own cards stay where they are (`/opengraph-image`,
 * `/uk/opengraph-image`). The address a page names carries the card's
 * fingerprint (`?v=`), so the picture behind one address never changes and
 * the edge keeps it for a week; anything the list above does not name is not
 * found.
 */
async function cardFor(locale: CardLocale, key: readonly string[]): Promise<CardSpec | null> {
  const [kind, ...rest] = key;
  if (kind === "markets" && rest.length === 0) return marketsCard(locale);
  if (kind === "page" && rest.length === 1 && isPageCardId(rest[0])) return pageCard(rest[0], locale);
  if (kind === "docs") return docsCard(rest.join("/"), locale);
  if (kind === "company" && rest.length === 1 && /^[A-Za-z0-9._-]{1,44}$/.test(rest[0])) {
    const found = await findStockRow(rest[0]);
    return found.ok && found.row ? companyCard(companyCardInputOf(found.row), locale) : null;
  }
  return null;
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
}

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string; key: string[] }> }) {
  const { locale, key } = await params;
  if (locale !== "en" && locale !== "uk") return notFound();
  let parts: string[];
  try {
    parts = key.map((part) => decodeURIComponent(part));
  } catch {
    return notFound();
  }
  const card = await cardFor(locale, parts);
  if (!card) return notFound();
  return cityCard({ lang: locale });
}
