import type { Metadata } from "next";
import type { ReactNode } from "react";

import { THEME_BOOT_SCRIPT } from "@/app/app/theme";
import { getSession } from "@/lib/session";
import { RobinhoodShell } from "./shell";

export const metadata: Metadata = {
  title: { template: "%s · Robinhood Chain · Ryntra", default: "Robinhood Chain · Ryntra" },
  description:
    "Robinhood Chain, as the venue lists it and as this product can act on it. Read the market, keep a watchlist, and see which instruments Ryntra can actually route.",
  /* A workspace is an operator surface, not a landing page. */
  robots: { index: false, follow: false },
};

/**
 * The session is read here for one reason: the top bar's connection control.
 *
 * The workspace itself gates nothing — every surface under it is a read of a
 * public venue and stays reachable without an account, exactly as it was at
 * `/app/markets`. `getSession()` returning `null` renders `Connect wallet`,
 * which is a supported state rather than a wall.
 */
export default async function RobinhoodWorkspaceLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <RobinhoodShell identityWallet={session?.identityWallet ?? null}>{children}</RobinhoodShell>
    </>
  );
}
