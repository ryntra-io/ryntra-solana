import type { Metadata } from "next";
import { cookies } from "next/headers";

import { THEME_BOOT_SCRIPT } from "@/app/app/theme";
import { normalizeWorkspaceLocale, WORKSPACE_LOCALE_COOKIE } from "@/app/shell/locale";
import { SolanaConnectionProvider } from "./connection.tsx";
import { SolanaHubShell } from "./hub/shell.tsx";
import { SolanaI18nProvider } from "./i18n/provider.tsx";

export const metadata: Metadata = {
  title: { template: "%s · Solana Markets · Ryntra", default: "Solana Markets · Ryntra" },
  description:
    "Read Solana mints the way they actually work: exact identity, what the issuer can mint or freeze, every Token-2022 extension with its provenance, and what is not known. Ryntra holds no keys and signs nothing.",
  /* A workspace is an operator surface, not a landing page. The indexed public
     Solana page is a later packet; this is the product it will point at. */
  robots: { index: false, follow: false },
};

/**
 * Solana, inside Ryntra.
 *
 * Same shell as the cabinet and the Stellar Hub, so the brand,
 * the switcher and the way back are identical. Solana contributes its
 * navigation and its own domain surfaces, nothing more.
 *
 * Open without an account, for the same reason the other hubs are: it is the
 * surface a reviewer opens with no Telegram and no wallet. Nothing here
 * can move value, so there is nothing to gate.
 */
export default async function SolanaWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const locale = normalizeWorkspaceLocale(store.get(WORKSPACE_LOCALE_COOKIE)?.value);
  return (
    <SolanaI18nProvider initialLocale={locale}>
      {/* A build-time constant from our own module — no user input reaches it.
          It applies the saved theme before first paint, exactly as the other
          workspaces do: a theme control whose result arrives one frame late
          reads as a flash rather than as a choice. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <SolanaConnectionProvider>
        <SolanaHubShell>{children}</SolanaHubShell>
      </SolanaConnectionProvider>
    </SolanaI18nProvider>
  );
}
