import { NAV_WORDS } from "@ryntra/core/nav";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { BOTS_AUTHORITY_IDS, authorityViews } from "@/lib/core/authority-matrix";

import { BotsView } from "./bots-view";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const locale = await solanaServerLocale();
  return { title: NAV_WORDS[locale].items.bots };
}

/**
 * «Автоматика → Боти» (Menu 3, NAV-1; «Термінал → Автоінвест» before): one place for everything that runs on
 * a person's rule — the recurring-buy rules (Ryntra reminds, the person signs
 * each buy) and the trade plans, each plan's result on its own card, then
 * the results across the plans and the memory they leave. The old
 * addresses of «Автоінвест», «Мої стратегії» and «Результати» lead here; a
 * plan is still written in the builder and read on its own page, as before.
 * A guest meets the two paths with an example each and one button (B16,
 * `bots-view.tsx`). What each bot does by itself — its honest state, its bound — is read here on the server from the
 * authority matrix (EXE-1), with this deployment's switches.
 */
export default async function MyBotsPage() {
  const locale = await solanaServerLocale();
  return <BotsView locale={locale} authority={authorityViews(BOTS_AUTHORITY_IDS)} />;
}
