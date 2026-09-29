"use client";

import { useMemo, type ReactNode } from "react";
import { ArrowRight, MapTrifold } from "@phosphor-icons/react";
import Link from "next/link";

import { RyntraAppShell } from "@/app/shell/app-shell";
import { PRODUCT_SHELL_STRINGS, SHELL_CHROME_COPY } from "@/app/shell/chrome-copy";
import { DepthSwitch } from "@/app/shell/depth-switch";
import { ShellLanguageToggle } from "@/app/shell/language-toggle";
import { settingsEntry } from "@/app/shell/modules";
import { SolanaConnectionControl } from "../connection.tsx";
import { useSolanaI18n } from "../i18n/provider.tsx";
import { solanaManifest } from "./manifest.ts";
import { SECONDARY_LABELS } from "@/app/shell/domains";
import { PRODUCT_ROUTES } from "@/app/shell/product-routes";

import "./hub.css";

/** The navigation footer, on the shared chrome — same rules as the other hubs. */
function HubFooter({ label }: { label: string }) {
  return (
    <div className="hub-nav-footer">
      <Link className="hub-nav-map" href="/app" aria-label={label}>
        <MapTrifold size={17} weight="bold" aria-hidden />
        <span>{label}</span>
        <ArrowRight size={15} weight="bold" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Guided | Pro, as a visible control.
 *
 * Without it the Pro rail is unreachable and every module outside the guided
 * four would exist, be routable and appear nowhere. The stored `standard`
 * value is normalized to `guided` exactly as the Stellar Hub does — rendering
 * it as Guided while storing Standard is what once made this control lie.
 * Preferences are scoped per workspace, so this touches nothing elsewhere.
 */
export function SolanaHubShell({ children }: { children: ReactNode }) {
  const { locale, setLocale, text } = useSolanaI18n();
  const manifest = useMemo(() => solanaManifest(locale), [locale]);
  /* The rail is the product's six domains, identical in Simple and Pro. The
     four-group Solana rail this replaced — Markets / Portfolio / Transfers /
     Journal — described one workspace among several, which is the model the
     owner decision of 2026-09-04 retired. `solanaNavigation` is left in place
     and unused rather than deleted: it is the record of that rail, and the Hub
     Map still describes the modules it named. */
  /* The settled secondary name, read from the file that decided it rather than
     retyped here. The rail said `Solana Hub Map`: `Hub` is forbidden vocabulary
     in this product — the owner decision of 2026-09-04 lists it among the words
     the model it replaced used — and the destination already had a name in the
     domain vocabulary. `SECONDARY_LABELS` carries both locales in full, so this
     label cannot 500 a Ukrainian rail for want of a translation. */
  const productMapLabel = SECONDARY_LABELS.productMap[locale === "uk" ? "uk" : "en"];

  const product = useMemo(
    () => ({ routes: PRODUCT_ROUTES, locale, network: "Solana Mainnet" }),
    [locale],
  );

  return (
    <RyntraAppShell
      workspaceId="solana"
      product={product}
      lang={locale}
      dir="ltr"
      strings={PRODUCT_SHELL_STRINGS[locale]}
      chrome={SHELL_CHROME_COPY[locale]}
      navSettings={settingsEntry(manifest)}
      account={<SolanaConnectionControl />}
      context={
        <DepthSwitch
          /* The depth words come from the shell's own chrome copy, which is
             where Agent Control already reads them. They were coming through
             this workspace's translator, whose entries were `"Simple": "Simple"`
             and `"Pro": "Pro"` — so one product rendered `Простий · Профі` on
             Control and `Simple · Pro` everywhere else, and a Ukrainian screen
             carried two English words. One control, one vocabulary, one file
             that decides it. The group label stays this workspace's, because
             the shared one still says `робочого простору`. */
          labels={{
            group: text("Navigation depth"),
            simple: SHELL_CHROME_COPY[locale].layout.simple,
            pro: SHELL_CHROME_COPY[locale].layout.pro,
          }}
        />
      }
      navFooter={<HubFooter label={productMapLabel} />}
      viewExtras={<ShellLanguageToggle locale={locale} onChange={setLocale} groupLabel={text("Language")} />}
    >
      {children}
    </RyntraAppShell>
  );
}
