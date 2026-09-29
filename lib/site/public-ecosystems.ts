import { WORKSPACES } from "../../app/shell/workspaces.ts";
import { ECOSYSTEMS, type EcosystemState } from "../product/ecosystems.ts";

import type { PublicLocale } from "./locale.ts";
import { publicCopy } from "./public-copy.ts";

/**
 * Public ecosystem doors for the header dropdown.
 *
 * Built from the workspace registry, not a marketing array. A card renders
 * only when the workspace opted into a public entry, the route exists, and
 * the visitor surface is marked ready. Status words come from the ecosystem
 * manifest — never a handwritten LIVE chip.
 */

export type PublicEcosystemEntry = Readonly<{
  id: string;
  name: string;
  href: string;
  description: Readonly<{ en: string; uk: string }>;
  environment: string | null;
  maturity: EcosystemState;
}>;

export function publicEcosystemEntries(): readonly PublicEcosystemEntry[] {
  const manifests = new Map(ECOSYSTEMS.map((row) => [row.id, row]));
  const out: PublicEcosystemEntry[] = [];
  for (const workspace of WORKSPACES) {
    if (workspace.kind !== "ecosystem_pack") continue;
    if (workspace.access !== "public") continue;
    if (!workspace.publicEntry?.enabled) continue;
    if (!workspace.href) continue;
    const opened = workspace.opens?.[0];
    const manifest = opened ? manifests.get(opened) : undefined;
    if (!manifest) continue;
    if (manifest.state === "research") continue;
    out.push({
      id: workspace.id,
      name: workspace.name,
      href: workspace.href,
      description: workspace.publicEntry.description,
      environment: workspace.environment ?? null,
      maturity: manifest.state,
    });
  }
  return out;
}

export function ecosystemMaturityLabel(state: EcosystemState, locale: PublicLocale): string {
  return publicCopy(locale).maturity[state] ?? state;
}
