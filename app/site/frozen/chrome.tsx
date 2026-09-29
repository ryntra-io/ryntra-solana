import type { ReactNode } from "react";
import type { PublicLocale } from "@/lib/site/locale";

import { PublicFooter, PublicHeader } from "./public-header";

/*
 * Shared public chrome.
 *
 * Header and footer are one implementation for every retained public surface.
 * Theme and language live with the existing writers — `app/app/theme.ts` and
 * the Hub locale cookie — rather than in a second store.
 */

export type ChromeVariant = "landing" | "site";

export function FrozenHeader({
  mainId = "main",
}: {
  variant?: ChromeVariant;
  cta?: ReactNode;
  ground?: "midnight" | "mist" | "stone";
  mainId?: string;
}) {
  return <PublicHeader mainId={mainId} />;
}

export function FrozenFooter({ locale, landing = false }: { locale?: PublicLocale; landing?: boolean } = {}) {
  return <PublicFooter locale={locale} landing={landing} />;
}
