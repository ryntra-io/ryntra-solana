"use client";

import type { ReactNode } from "react";

import type { SolanaProvenance } from "@/lib/solana/types";
import { useSolanaI18n } from "../i18n/provider.tsx";
import {
  SOLANA_MODULES,
} from "./modules.ts";

/**
 * The Solana Hub's shared furniture — the same three-piece kit the Stellar Hub
 * settled on, instanced for this domain's vocabulary.
 *
 * What is genuinely different here is the provenance axis. Stellar's pages
 * lean on the evidence envelope's five freshness states; the Solana passport's
 * every field instead carries *what kind of claim it is* — read from chain,
 * declared by an issuer, derived, conflicting, unknown, or present but not
 * decodable. That axis gets its own chip, because folding it into the
 * freshness chip would merge the two questions this product exists to keep
 * separate: "how do we know" and "what kind of knowing is it".
 */

/**
 * The environment chip's exact words, resolved from the module record.
 *
 * Two axes, printed as two halves and never merged: where the facts come from,
 * and what must happen before a surface may act there. The registry keeps the
 * technical mode `USER_SIGNED`; the customer chip says `review required` so a
 * page cannot look generically signable before its exact Review exists.
 */
/**
 * Title, explanation, environment.
 *
 * `lead` is not printed — it goes inside the info control, one click away and
 * still in the DOM, because a workspace whose every page opens with a
 * paragraph is documentation with controls attached. The chip is resolved from
 * the registry, never typed on the page: a page that declares its own
 * environment is a second list, and second lists disagree silently.
 */
export function PageHead({
  title,
  module: moduleId,
  aside,
}: {
  title: string;
  lead?: ReactNode;
  /** The registry id of the module this page renders. Still validated below,
      because a page naming a module that does not exist is a real mistake even
      now that nothing is rendered from it. */
  module?: string;
  aside?: ReactNode;
}) {
  const { text } = useSolanaI18n();
  const found = moduleId ? SOLANA_MODULES.find((entry) => entry.id === moduleId) : undefined;
  if (moduleId && !found) {
    /* A typo here would silently fall back to a chip that says "Workspace" on
       a page reading mainnet — the exact quiet wrongness the resolution
       exists to remove. */
    throw new Error(`PageHead names module "${moduleId}", which is not in the Solana registry.`);
  }

  const visibleTitle = text(title);

  return (
    <header className="so-head">
      <h1 className="so-title">{visibleTitle}</h1>
      {/* The `Assets | Swap` tab row that used to sit under the Markets title
          is gone with the 2026-09-07 owner task: Trade opens Swap directly,
          and a tab row with one working flow beside a token list was a group
          wrapped around a single child. A second trading flow earns its own
          destination; it is not pre-announced here. */}
      {aside}
      {/* The environment chip is gone. It printed an internal mode enum beside
          every page title — "Mainnet · review required" before a person had
          done anything, "Mainnet · read only" on pages that sign — and neither
          reading is something they can act on. The action cards carry a quiet
          "Solana mainnet" line where it actually matters. */}
    </header>
  );
}

/**
 * What kind of claim a passport field is.
 *
 * Six values, one chip, no colour wash: cyan only for a fact read from the
 * chain this session, amber for anything that needs a second look (someone's
 * own statement, two sources disagreeing, bytes nobody can decode), and the
 * muted default for the honest rest. There is no green here — green is
 * reserved for a reconciled fact, and a read is not one.
 */
export function ProvenanceChip({ provenance }: { provenance: SolanaProvenance }) {
  const { text } = useSolanaI18n();
  return (
    <span className="so-prov" data-prov={provenance}>
      {text(provenance.replace(/_/g, " "))}
    </span>
  );
}
