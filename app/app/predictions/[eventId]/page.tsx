import Link from "next/link";
import { notFound } from "next/navigation";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { getPredictionProvider } from "@/lib/predictions/agg/adapter";
import { readPredictionsEnv } from "@/lib/predictions/env";
import { readRulesHistory } from "@/lib/predictions/rules-history";

import styles from "../predictions.module.css";
import { wordsFor } from "../words";
import { MarketDetail } from "./market-detail";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The market a link names (a related market's own), when it is an id. */
const marketParam = (value: string | string[] | undefined): string | null => (typeof value === "string" && ID.test(value) ? value : null);

export async function generateMetadata({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!ID.test(eventId)) return { title: "Predictions" };
  const event = await getPredictionProvider().event(eventId);
  return { title: event.ok ? `${event.value.title} · Predictions` : "Predictions" };
}

/**
 * One event: the question, the outcomes and their live probabilities, the
 * change, the volume, the time to resolution, the person's paper position and
 * the three acts — Ask Ryntra, Build plan, Paper Yes / Paper No — on the first
 * screen; Research and Market depth one tap deeper, with nothing the provider
 * gives thrown away. The event is read on the server from the provider
 * boundary; everything live is the browser's.
 */
export default async function PredictionEventPage({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ market?: string | string[] }> }) {
  const { eventId } = await params;
  if (!ID.test(eventId)) notFound();
  const locale = await solanaServerLocale();
  const word = wordsFor(locale);
  const event = await getPredictionProvider().event(eventId);
  if (!event.ok && event.code === "NOT_FOUND") notFound();
  const env = readPredictionsEnv();
  if (!event.ok || !env.appId) {
    return (
      <section className={styles.page}>
        <p className={styles.crumbs}>
          <Link href="/app/predictions">{word("title")}</Link>
        </p>
        <div className={`${styles.card} ${styles.unavailable}`} role="status">
          <b>{word("unavailableTitle")}</b>
          <p className={styles.muted}>{!event.ok && event.code === "RATE_LIMITED" ? word("rateLimited") : word("unavailable")}</p>
          <Link className="rw-btn" href={`/app/predictions/${encodeURIComponent(eventId)}`}>
            {word("retry")}
          </Link>
        </div>
      </section>
    );
  }
  /* The rules as Ryntra read them over time; a store that is slow or down draws the page without them. */
  const rulesHistory = await readRulesHistory(event.value.id, event.value.markets);
  return <MarketDetail locale={locale} initial={event.value} live={{ appId: env.appId, wsUrl: env.wsUrl }} rulesHistory={rulesHistory} readAt={Date.now()} initialMarketId={marketParam((await searchParams).market)} />;
}
