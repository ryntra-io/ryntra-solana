import type { Metadata } from "next";

import { THEME_BOOT_SCRIPT } from "@/app/app/theme";
import { StellarHubShell } from "./hub/shell.tsx";

export const metadata: Metadata = {
  title: { template: "%s · Stellar Hub · Ryntra", default: "Stellar Hub · Ryntra" },
  description:
    "Read Stellar assets the way they actually work: exact identity, what the issuer can freeze or claw back, what a holding requires, and what is not known. Ryntra holds no keys and signs nothing.",
  /* A workspace is an operator surface, not a landing page. The public Stellar
     page at `/stellar` is the indexed one; this is the product behind it. */
  robots: { index: false, follow: false },
};

/**
 * Stellar, inside Ryntra.
 *
 * Same shell as the cabinet and the Solana Hub, so the brand, the switcher and the
 * way back are identical. Stellar contributes its navigation and its own
 * domain surfaces, nothing more.
 *
 * Open without an account, for the same reason the other hubs are: it is the
 * surface a visitor opens with no Telegram and no wallet. Nothing
 * here can move value, so there is nothing to gate.
 */
export default function StellarWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* A build-time constant from our own module — no user input reaches it.
          It applies the saved theme before first paint, exactly as the cabinet
          and the Solana Hub do: a theme control whose result arrives one frame
          late reads as a flash rather than as a choice. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <StellarHubShell>{children}</StellarHubShell>
    </>
  );
}
