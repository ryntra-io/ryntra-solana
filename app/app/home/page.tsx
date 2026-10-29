import { APP_HOME_PATH, appPageWords, buildAppHomeMetadata, localizedUrl } from "@/app/seo";
import { jsonLdScript, webPage } from "@/lib/site/structured-data";
import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";

import { HomeSurface } from "./home-surface";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* Home in words of its own as the app's page, in the reader's language — at
   `/app/home` and `/uk/app/home`, each naming the other — and one of the
   cabinet's addresses open to the index (`app/seo.ts`, `app/robots.ts`). */
export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return buildAppHomeMetadata(locale);
}

/**
 * Головна — the first of the five places, for everyone: one number, three
 * blocks and one action for a wallet; one sentence and «Підключити гаманець»
 * for a guest (`home-surface.tsx`). Everything it shows is read in the
 * browser for the wallet that is connected, so the page itself is the same
 * for every visitor.
 */
export default async function HomePage() {
  const locale = await solanaServerLocale();
  const words = appPageWords("home", locale);
  const graph = [webPage({ url: localizedUrl(APP_HOME_PATH, locale), name: words.title, description: words.description, locale })];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(graph) }} />
      <HomeSurface locale={locale} />
    </>
  );
}
