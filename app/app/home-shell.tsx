"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";

import { RyntraAppShell } from "@/app/shell/app-shell";
import { DepthSwitch } from "@/app/shell/depth-switch";
import { ShellLanguageToggle } from "@/app/shell/language-toggle";
import { SHELL_CHROME_COPY, SHELL_STRINGS } from "@/app/shell/chrome-copy";
import { connectionCopyFor } from "@/app/shell/connection-copy";
import { resolveDepth, type WorkspaceMode } from "@/app/shell/layout-store";
import { navigationFromManifest, settingsEntry } from "@/app/shell/modules";
import { CommandPalette } from "@/app/shell/command-palette";
import { CABINET_SETTINGS } from "@/app/shell/workspaces";

import { RyntraConnectionControl } from "./connection";
import { CabinetBotLink, CabinetNavFooter } from "./nav";
import { homeManifest } from "./home-manifest";
import { useHomeI18n } from "./i18n/provider";
import type { CbCopy } from "./copy";

/**
 * Ryntra Home, inside the one shell.
 *
 * Home supplies data and modules. The brand, the rail grammar, Simple/Pro,
 * Settings and the connection slot are the shell's, identically in every hub.
 */
export function HomeShell({
  children,
  identityWallet,
  identity,
  navFooter,
  hasSession,
}: {
  children: ReactNode;
  identityWallet: string | null;
  identity?: ReactNode;
  navFooter: ReactNode;
  hasSession: boolean;
}) {
  const { locale, setLocale, t } = useHomeI18n();
  const manifest = useMemo(() => homeManifest(t), [t]);
  const chrome = SHELL_CHROME_COPY[locale];
  const strings = SHELL_STRINGS[locale];

  const navGroupsFor = useCallback(
    (mode: WorkspaceMode) =>
      navigationFromManifest(manifest, resolveDepth(mode) === "pro" ? "pro" : "simple"),
    [manifest],
  );

  return (
    <RyntraAppShell
      workspaceId="home"
      lang={locale}
      dir="ltr"
      strings={strings}
      chrome={chrome}
      navGroupsFor={navGroupsFor}
      navSettings={settingsEntry(manifest) ?? CABINET_SETTINGS}
      modeInContext
      navFooter={navFooter}
      viewExtras={
        <ShellLanguageToggle
          locale={locale}
          onChange={setLocale}
          groupLabel={t("chrome.language")}
        />
      }
      tools={
        <>
          <CommandPalette hasSession={hasSession} />
          <DepthSwitch
            labels={{
              group: chrome.layout.depthGroup,
              simple: chrome.layout.simple,
              pro: chrome.layout.pro,
            }}
          />
        </>
      }
      account={
        <RyntraConnectionControl
          identityWallet={identityWallet}
          identity={identity}
          copy={connectionCopyFor(locale)}
        />
      }
    >
      {children}
    </RyntraAppShell>
  );
}

export function HomeVisitorFooter() {
  const { t } = useHomeI18n();
  return (
    <div className="cb-visitor-foot">
      <p>{t("visitor.foot")}</p>
      <Link className="btn btn-primary btn-sm" href="/beta">
        {t("visitor.signin")}
      </Link>
    </div>
  );
}

export function HomeAccountFooter({
  c,
  name,
  statusName,
  lang,
}: {
  c: CbCopy;
  name: string;
  statusName: string;
  lang: string;
}) {
  return (
    <>
      <CabinetBotLink label={c.nav.bot} />
      <CabinetNavFooter c={c} name={name} statusName={statusName} lang={lang} />
    </>
  );
}
