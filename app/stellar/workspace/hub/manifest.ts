import type { WorkspaceManifest } from "@/app/shell/modules";
import type { NavEntry } from "@/app/shell/workspaces";
import { STELLAR_MODULES } from "./modules.ts";

/**
 * The Stellar Hub, projected onto the Shell v2 skeleton.
 *
 * Stellar was already the closest workspace to the target — wallet in the
 * shared slot, modules from a registry, public reads without a wallet — and the
 * standard says so. What it had was its own zone vocabulary and its own depth
 * words, and those are the two things this file removes.
 *
 * Built from the registry, so labels and gates stay exactly as the registry
 * states them. A module with no route renders disabled carrying the exact
 * condition that unblocks it; that rule was Stellar's own and it survives.
 *
 * `strategy` is omitted for the same reason as Solana's: nothing here acts on a
 * holder's behalf yet. Issuer controls and holder rights are things you *read*
 * about an asset, which is `portfolio`, not rules you set.
 */

const BASE = "/stellar/workspace";

function entry(id: string): NavEntry | null {
  const found = STELLAR_MODULES.find((item) => item.id === id);
  if (!found) return null;
  return {
    id: found.id,
    label: found.label,
    href: found.route,
    ...(found.route ? {} : { gate: found.gate, tag: "Planned" }),
  };
}

function entries(...ids: readonly string[]): readonly NavEntry[] {
  return ids.map(entry).filter((value): value is NavEntry => value !== null);
}

export const STELLAR_MANIFEST: WorkspaceManifest = {
  workspaceId: "stellar",
  defaultLanding: BASE,
  /* Send and Authorize are actions; `/receipts` is where their proof lands and
     stays a destination inside Journal. */
  deepLinks: [`${BASE}/send`, `${BASE}/authorize`, `${BASE}/developers`, `${BASE}/map`],
  modules: [
    {
      id: "radar",
      href: BASE,
      entries: entries("attention", "network", "providers"),
    },
    {
      id: "portfolio",
      href: `${BASE}/assets`,
      entries: entries("rwa-market", "issuers", "markets"),
    },
    {
      id: "journal",
      href: `${BASE}/activity`,
      entries: entries("receipts"),
    },
    {
      id: "settings",
      href: `${BASE}/settings`,
    },
  ],
};
