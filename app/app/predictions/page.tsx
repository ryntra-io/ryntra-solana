import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { getPredictionProvider } from "@/lib/predictions/agg/adapter";

import { PredictionsHub } from "./hub";
import styles from "./predictions.module.css";
import { SettingsButton } from "./settings-sheet";
import { SimulationLine } from "./simulation-line";
import { wordsFor } from "./words";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;
export const metadata = { title: "Predictions" };

/**
 * Predictions — the hub: markets on outcomes across the venues that price
 * them, in simulation. The head and the first page (the provider's real
 * categories and the trending events with their live leading prices) are
 * rendered on the server from the provider boundary; every other list, the
 * watchlist and the paper account are the browser's reads of
 * `/api/predictions/*`.
 *
 * Since 2026-09-17 the page is a real product surface, not the locked
 * placeholder of 2026-09-11 — the paper product exists, the provider's
 * capability set is preserved, and the identity stays Ryntra's.
 */
export default async function PredictionsPage() {
  const locale = await solanaServerLocale();
  const word = wordsFor(locale);
  const provider = getPredictionProvider();
  const [categories, trending] = await Promise.all([provider.categories(), provider.discover({ sort: "volume24h", limit: 24 })]);
  return (
    <section className={styles.page} aria-labelledby="pred-title">
      <header className={styles.head}>
        <div className={styles.headTitle}>
          <h1 id="pred-title">{word("title")}</h1>
          <p className={styles.tagline}>{word("tagline")}</p>
          <SimulationLine locale={locale} />
        </div>
        <div className={styles.actions}>
          <SettingsButton locale={locale} />
        </div>
      </header>
      <PredictionsHub
        locale={locale}
        categories={categories.ok ? categories.value : []}
        initial={trending.ok ? trending.value.events : []}
        initialReadAt={trending.ok ? trending.value.readAt : new Date().toISOString()}
        feedFailed={trending.ok ? null : trending.code}
      />
    </section>
  );
}
