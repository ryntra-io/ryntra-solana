"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight } from "@phosphor-icons/react";

import { RyntraAppShell } from "@/app/shell/app-shell";
import { DepthSwitch } from "@/app/shell/depth-switch";
import { ShellLanguageToggle } from "@/app/shell/language-toggle";
import { PRODUCT_SHELL_STRINGS, SHELL_CHROME_COPY } from "@/app/shell/chrome-copy";
import { connectionCopyFor } from "@/app/shell/connection-copy";
import { resolveDepth, type WorkspaceMode } from "@/app/shell/layout-store";
import { useShell } from "@/app/shell/shell-state";
import { navigationFromManifest, settingsEntry } from "@/app/shell/modules";
import { PRODUCT_ROUTES } from "@/app/shell/product-routes";
import { useSolanaConnection } from "@/app/solana/workspace/connection";
import { ProductWalletChip } from "@/app/shell/wallet-chip";
import { RyntraConnectionControl } from "@/app/app/connection";

import { ActionCaseProvider } from "./action-case-store";
import { PassportDirectoryProvider } from "./passport-directory-store";
import { agentManifest } from "./agent-manifest";
import { useAgentI18n } from "./i18n/provider";
import { scopeForPath } from "./surfaces";
import "./agent-workspace.css";

function NavFooter() {
  const { t } = useAgentI18n();
  const { prefs } = useShell();
  if (resolveDepth(prefs.mode) !== "pro") return null;
  return (
    <div className="acw-nav-footer">
      <Link href="/agents" target="_blank" rel="noreferrer">
        <span>{t("footer.public")} ↗</span>
        <ArrowRight size={15} weight="bold" aria-hidden />
      </Link>
      <Link href="/developers/agent-control" target="_blank" rel="noreferrer">
        <span>API & MCP ↗</span>
        <ArrowRight size={15} weight="bold" aria-hidden />
      </Link>
      <span className="acw-nav-boundary">{t("footer.boundary")}</span>
    </div>
  );
}

/**
 * Agent Control, inside the one shell.
 *
 * Navigation is a Shell v2 manifest. Connection is always in the top-right
 * account slot — read surfaces stay usable disconnected; authorize still signs
 * through its own experiment, which is not a second identity pretending to be
 * the workspace wallet.
 */
export function AgentControlShell({
  children,
  identityWallet,
}: {
  children: ReactNode;
  identityWallet: string | null;
}) {
  const pathname = usePathname() ?? "/agents/workspace";
  const { locale, setLocale, t } = useAgentI18n();
  /* Available here because the layout mounts the provider around this shell. */
  const { connection } = useSolanaConnection();
  const walletAddress = connection?.address ?? null;
  const manifest = useMemo(() => agentManifest(t), [t]);
  const chrome = SHELL_CHROME_COPY[locale];
  const strings = PRODUCT_SHELL_STRINGS[locale];

  const navGroupsFor = useCallback(
    (mode: WorkspaceMode) =>
      navigationFromManifest(manifest, resolveDepth(mode) === "pro" ? "pro" : "simple"),
    [manifest],
  );

  return (
    <div className="acw-shell">
      <RyntraAppShell
        workspaceId="agent-control"
        /* Control is one of the product's six domains, so the product rail
           renders here too — otherwise a person clicking Control left the
           product and arrived somewhere with a different navigation, which is
           exactly the perception this row exists to remove. Agent Control's own
           five destinations stay, as the group beneath: they are where you are,
           the domains are where you go. Nothing about its policy, budget or
           authorization boundaries is touched. */
        product={{ routes: PRODUCT_ROUTES, locale: locale === "uk" ? "uk" : "en", network: "Solana Mainnet" }}
        /* The wallet is shown, never managed here. Control needs a Ryntra
           account, and the account control beside this one now says so. */
        wallet={<ProductWalletChip address={walletAddress} label={t("nav.wallet")} />}
        lang={locale}
        dir="ltr"
        strings={strings}
        chrome={chrome}
        navGroupsFor={navGroupsFor}
        navSettings={settingsEntry(manifest)}
        modeInContext
        navFooter={<NavFooter />}
        scope={scopeForPath(pathname, locale)}
        viewExtras={
          <ShellLanguageToggle
            locale={locale}
            onChange={setLocale}
            groupLabel={t("chrome.language")}
          />
        }
        tools={
          <DepthSwitch
            labels={{
              group: chrome.layout.depthGroup,
              simple: chrome.layout.simple,
              pro: chrome.layout.pro,
            }}
          />
        }
        account={
          <RyntraConnectionControl
            identityWallet={identityWallet}
            copy={connectionCopyFor(locale)}
          />
        }
      >
        <PassportDirectoryProvider>
          <ActionCaseProvider>{children}</ActionCaseProvider>
        </PassportDirectoryProvider>
      </RyntraAppShell>
    </div>
  );
}
