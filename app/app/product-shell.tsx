"use client";

import type { ReactNode } from "react";
import { RyntraAppShell } from "@/app/shell/app-shell";
import { PRODUCT_ROUTES } from "@/app/shell/product-routes";
import { PRODUCT_SHELL_STRINGS, SHELL_CHROME_COPY } from "@/app/shell/chrome-copy";
import { MenuPreferences } from "@/app/shell/menu-preferences";
import { SolanaConnectionControl } from "@/app/solana/workspace/connection";
import { useSolanaI18n } from "@/app/solana/workspace/i18n/provider";
import { WalletAccountIdentity } from "./account/account-control";
import { FeedbackLauncher } from "./feedback/feedback-launcher";
import { NotificationsBell } from "./notifications/bell";
import { ProductSearch } from "./search/product-search";
import "./product.css";
import "./account/account.css";

/**
 * The product's frame (canon v5.4 В30–В31, 2026-09-24): the menu you can see
 * on the rail, and the top bar the Owner named — search, the notifications
 * bell, the wallet.
 *
 * One control for the person in the header: the wallet. Since the Owner's
 * decision of 2026-09-11 the wallet is the account, and signing in (one
 * signature that opens the account) and signing out live inside the wallet's
 * panel. Since v5.4 the panel is the person's menu too — Налаштування, Мова,
 * Тема, Від'єднати — so the language and the theme left the foot of the rail,
 * where only Відгук stays above Settings.
 */
export function ProductShell({ children }: { children: ReactNode; signedIn: boolean }) {
  const { locale, setLocale } = useSolanaI18n();
  const uk = locale === "uk";
  const chrome = SHELL_CHROME_COPY[locale];
  return (
    <div className="ry-product">
      <RyntraAppShell
        workspaceId="home"
        product={{ routes: PRODUCT_ROUTES, locale, network: "Solana Mainnet", badge: { label: "BETA", title: uk ? "Бета-версія" : "Beta version" } }}
        lang={locale}
        dir="ltr"
        strings={PRODUCT_SHELL_STRINGS[locale]}
        chrome={chrome}
        navGroups={[]}
        search={<ProductSearch locale={locale} />}
        tools={<NotificationsBell locale={locale} />}
        account={
          <div className="ry-product-account">
            <SolanaConnectionControl
              identity={<WalletAccountIdentity />}
              compact
              preferences={(close) => (
                <MenuPreferences
                  locale={locale}
                  onLocale={setLocale}
                  settingsHref="/app/settings"
                  onDone={close}
                  words={{
                    settings: uk ? "Налаштування" : "Settings",
                    language: uk ? "Мова" : "Language",
                    theme: uk ? "Тема" : "Theme",
                    dark: chrome.theme.dark,
                    light: chrome.theme.light,
                  }}
                />
              )}
            />
          </div>
        }
        /* The foot of the rail: Відгук, then Settings, which the menu itself
           places last. The way to say something is never further than the
           rail's foot. */
        viewExtras={<FeedbackLauncher />}
      >
        {children}
      </RyntraAppShell>
    </div>
  );
}
