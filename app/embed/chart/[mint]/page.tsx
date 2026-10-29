import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SolanaI18nProvider } from "@/app/solana/workspace/i18n/provider";

import { embedLocale, embedMint, embedTheme, embedThemeScript } from "../embed-params.ts";
import { EmbedChart } from "./embed-chart.tsx";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = { title: "Ryntra", robots: { index: false, follow: false } };

/**
 * The core's chart of one Solana market, alone on the page — what the phone opens in its WebView as the professional
 * chart (CH-21). The same chart and the same reads as the spot page (`SpotChart`), without the page's header, menu,
 * wallet or ticket: the app keeps buying and selling on its own screens, behind its own confirmation. The theme and
 * the language are the app's (`?theme=graphite|porcelain`, `?lang=en|uk`).
 */
export default async function EmbedChartPage({
  params,
  searchParams,
}: {
  params: Promise<{ mint: string }>;
  searchParams: Promise<{ theme?: string; lang?: string }>;
}) {
  const [{ mint: raw }, query] = await Promise.all([params, searchParams]);
  const mint = embedMint(raw);
  if (!mint) notFound();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: embedThemeScript(embedTheme(query.theme)) }} />
      <SolanaI18nProvider initialLocale={embedLocale(query.lang)}>
        <EmbedChart mint={mint} />
      </SolanaI18nProvider>
    </>
  );
}
