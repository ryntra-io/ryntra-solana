import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { getSession } from "@/lib/session";
import { THEME_BOOT_SCRIPT } from "@/app/app/theme";
import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";
import { SolanaConnectionProvider } from "@/app/solana/workspace/connection";
import { AgentControlShell } from "./agent-control-shell";
import { AgentI18nProvider } from "./i18n/provider";

export const metadata: Metadata = {
  title: { template: "%s · Agent Control · Ryntra", default: "Agent Control · Ryntra" },
  description:
    "Inspect agents, proposed actions, policy boundaries and outcome evidence. BNB Testnet is the first read and preview environment; Ryntra holds no keys and signs nothing here.",
  robots: { index: false, follow: false },
};

export default async function AgentWorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  const store = await cookies();
  const locale = normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <AgentI18nProvider initialLocale={locale}>
        {/*
         * The wallet travels with the person, the session does not become it.
         *
         * A Ryntra account and a Solana wallet are two security principals and
         * stay that way — connecting Phantom never authorizes anything in Control.
         * What was wrong was the *reading*: this surface showed `Connect wallet`
         * while a wallet was plainly connected, which looks like a defect and
         * teaches a person to distrust the chip that matters most.
         *
         * So the provider is mounted here too. It is a second instance rather
         * than shared state, because `/solana` and `/agents` are sibling trees
         * with no common ancestor to hoist to — and that is enough: both restore
         * silently from the same remembered wallet name, so both show the same
         * wallet. Nothing is granted by it. The provider holds a public address
         * and a signing capability the person already gave, and Control asks for
         * a Ryntra sign-in separately, in its own words.
         */}
        <SolanaConnectionProvider>
          <AgentControlShell identityWallet={session?.identityWallet ?? null}>{children}</AgentControlShell>
        </SolanaConnectionProvider>
      </AgentI18nProvider>
    </>
  );
}
