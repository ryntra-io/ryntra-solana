import { headers } from "next/headers";

import { solanaServerLocale } from "@/app/solana/workspace/i18n/server";
import { DEFAULT_PREFS, prefsFromCookie } from "@/lib/predictions/preferences";

import { CabinetPredictionsWallet } from "./cabinet-wallet";
import { PredictPrefsProvider } from "./prefs";
import { PredictionsPathsProvider } from "./surface";
import { SettingsDock } from "./settings-sheet";

/**
 * Predictions, a section of the Solana app: its pages sit in the app's own
 * shell — its header, its menu and its wallet — and take the person's
 * settings from this browser's cookie, so the first frame is already drawn
 * their way.
 */
export default async function CabinetPredictionsLayout({ children }: { children: React.ReactNode }) {
  const [locale, request] = await Promise.all([solanaServerLocale(), headers()]);
  const prefs = prefsFromCookie(request.get("cookie")) ?? DEFAULT_PREFS;
  return (
    <CabinetPredictionsWallet>
      <PredictPrefsProvider initial={prefs}>
        <PredictionsPathsProvider base="/app/predictions" portfolio="/app/predictions/portfolio" plans="/app/predictions/portfolio#plans">
          {children}
          <SettingsDock locale={locale} />
        </PredictionsPathsProvider>
      </PredictPrefsProvider>
    </CabinetPredictionsWallet>
  );
}
