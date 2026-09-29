import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { strategyLabPaidAiEnabled, strategyLabPreviewEnabled } from "@/lib/strategy-lab/config";
import { normalizeLocale } from "@/app/i18n/locales";
import { WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";
import { getSession } from "@/lib/session";
import { StrategyLabWorkspace } from "./strategy-lab-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Strategy Lab | Ryntra",
  description: "Paper-first strategy formalization, deterministic Pine compilation and evidence review.",
  robots: { index: false, follow: false },
};

export default async function StrategyLabPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  if (!strategyLabPreviewEnabled()) notFound();
  const [session, params, store] = await Promise.all([getSession(), searchParams, cookies()]);
  /* One language for the workspace: an explicit ?lang deep link wins, then the
     shared locale cookie the shell toggle writes, and the Telegram bot
     language only when neither exists. */
  const initialLocale = normalizeLocale(
    params.lang ?? store.get(WORKSPACE_LOCALE_COOKIE)?.value ?? session?.state.user.language,
  );
  return <StrategyLabWorkspace initialLocale={initialLocale} paidAiAvailable={strategyLabPaidAiEnabled()} />;
}
