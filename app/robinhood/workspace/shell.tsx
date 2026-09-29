"use client";

import { useCallback, type ReactNode } from "react";

import { RyntraAppShell } from "@/app/shell/app-shell";
import { RyntraConnectionControl } from "@/app/app/connection";
import type { NavEntry, NavGroup } from "@/app/shell/workspaces";
import { resolveDepth, type WorkspaceMode } from "@/app/shell/layout-store";

/**
 * Robinhood Chain, as a workspace of its own.
 *
 * It used to be a rail inside the cabinet at `/app/markets`, which made it the
 * one ecosystem that was not a workspace: Stellar is
 * `/stellar/workspace`, Solana is `/solana/workspace`, and this one was a
 * folder in Home. The URL was the visible half of that; the invisible half was
 * a rail that carried Home's own destinations — `Portfolio & Markets`,
 * `Journal`, `Connections` — inside a chain's workspace, so a person working
 * on Robinhood Chain was looking at three links that belong to a different
 * context.
 *
 * What it contributes to the one shell is what every workspace contributes:
 * navigation, a depth switch and the shared connection control. It draws no
 * rail, no brand block and no second top bar.
 */

/**
 * The slots this ecosystem actually has, and no others.
 *
 * Radar is the slot; Screener, Scanner and Watchlist are its modes rather than
 * four sibling products, which is the founder's 2026-08-19 decision applied to
 * the rail. Their routes are unchanged — this is where they are *entered*.
 *
 * **Portfolio, Strategy and Journal are absent, and that is the correction.**
 * The old rail carried them as a `Ryntra Home` group pointing at `/app`,
 * `/app/journal` and `/app/connect` — Home's destinations inside a chain's
 * workspace. Repointing them at chain surfaces was not an option either,
 * because Robinhood Chain has none yet, and a slot that leads somewhere else
 * is worse than a slot that is not there. The frozen UX System allows exactly
 * this: *modules are enabled per workspace — Arcus without Radar memes —
 * but each module's position in the nav is fixed.* A slot
 * appears here on the day this chain has a surface behind it.
 */
const SIMPLE: readonly NavGroup[] = [
  {
    id: "modules",
    entries: [{ id: "radar", label: "Radar", href: "/robinhood/workspace", icon: "radar" }],
  },
];

const PRO: readonly NavGroup[] = [
  {
    id: "modules",
    entries: [
      { id: "radar", label: "Radar", href: "/robinhood/workspace", icon: "radar" },
      { id: "screener", label: "Screener", href: "/robinhood/workspace/screener", icon: "screener", sub: true },
      { id: "scanner", label: "Scanner", href: "/robinhood/workspace/scanner", icon: "scanner", sub: true },
      { id: "watchlist", label: "Watchlist", href: "/robinhood/workspace/watchlist", icon: "watchlist", sub: true },
      /* Terminal and Spot swap are Pro surfaces of the asset context, not slots
         of their own — a trade opens *from* Radar. Terminal is where futures
         trading lands when it exists; today it is the market terminal. */
      { id: "terminal", label: "Terminal", href: "/robinhood/workspace/terminal", icon: "terminal", sub: true },
      { id: "swap", label: "Spot swap", href: "/robinhood/workspace/swap", icon: "swap", sub: true },
    ],
  },
];

const SETTINGS: NavEntry = {
  id: "settings",
  label: "Settings",
  href: "/app/settings",
  icon: "settings",
};

export function RobinhoodShell({
  children,
  identityWallet,
}: {
  children: ReactNode;
  identityWallet: string | null;
}) {
  const navGroupsFor = useCallback(
    (mode: WorkspaceMode): readonly NavGroup[] => (resolveDepth(mode) === "pro" ? PRO : SIMPLE),
    [],
  );

  return (
    <RyntraAppShell
      workspaceId="robinhood-chain"
      navGroupsFor={navGroupsFor}
      navSettings={SETTINGS}
      /* The depth control is not in the top bar.
         Founder decision, 2026-08-24: the product opens at full depth and
         `Simple | Pro` lives with the rest of "how this workspace is laid
         out" — the layout menu, bottom-left, beside density and reset. A
         switch in the primary bar made the first thing a person saw a
         question about the chrome. `modeInContext` is therefore gone with it,
         so the layout menu is the one control again rather than the second. */
      account={<RyntraConnectionControl identityWallet={identityWallet} />}
    >
      {children}
    </RyntraAppShell>
  );
}
