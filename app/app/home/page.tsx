import { Suspense } from "react";

import { APP_HOME_PATH, appPageWords, buildAppHomeMetadata, localizedUrl } from "@/app/seo";
import { jsonLdScript, webPage } from "@/lib/site/structured-data";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { POPULAR_LIMIT, popularCompanies } from "@/lib/stocks/popular";
import { readStockUniverse } from "@/lib/stocks/universe.server";
import type { WorkspaceLocale } from "@/app/shell/locale";

import { HomeSurface, PopularCards, PopularFailed, PopularSkeleton, PopularSlot } from "./home-surface";

export const dynamic = "force-dynamic";
export const revalidate = 0;
/* A cold read of the catalogue can take seconds; the page is sent at once
   and the popular companies stream in behind their own fallback. */
export const maxDuration = 60;

/* Home in words of its own as the app's page, in the reader's language — at
   `/app/home` and `/uk/app/home`, each naming the other — and one of the
   cabinet's addresses open to the index (`app/seo.ts`, `app/robots.ts`). */
export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return buildAppHomeMetadata(locale);
}

/**
 * Головна — the first of the five places, for everyone. The head (a guest's
 * promise or a wallet's balance) is drawn at once; «Популярні компанії» —
 * eight companies by the day's volume, twelve beside the right column on a
 * wide desk, the same for everyone — arrive from the catalogue the server
 * keeps warm, and until they do the section shows the browser's last copy or
 * the tiles' shape.
 */
export default async function HomePage() {
  const locale = await solanaServerLocale();
  const words = appPageWords("home", locale);
  const graph = [webPage({ url: localizedUrl(APP_HOME_PATH, locale), name: words.title, description: words.description, locale })];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
      <HomeSurface locale={locale}>
        <PopularSlot locale={locale}>
          <Suspense fallback={<PopularSkeleton />}>
            <PopularCompanies locale={locale} />
          </Suspense>
        </PopularSlot>
      </HomeSurface>
    </>
  );
}

async function PopularCompanies({ locale }: { locale: WorkspaceLocale }) {
  const read = await readStockUniverse();
  if (!read.ok) return <PopularFailed locale={locale} />;
  /* «Популярне» as the server lists it for every client (contract 1.20.0) — the phone reads the same list from /api/v1/stocks/popular. */
  return <PopularCards cards={popularCompanies(read.universe.rows, { limit: POPULAR_LIMIT })} locale={locale} />;
}
