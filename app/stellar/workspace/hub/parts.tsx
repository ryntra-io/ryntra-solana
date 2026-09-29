import Link from "next/link";
import type { ReactNode } from "react";

import { ArrowMark } from "@/app/components/mark";
import { InfoControl } from "@/app/shell/info-control";
import type { Evidence } from "@/lib/stellar/evidence";
import type { AttentionItem } from "./attention.ts";
import {
  STELLAR_MODULES,
  type StellarModuleEnvironment,
  type StellarModuleMode,
} from "./modules.ts";

/**
 * The Stellar Hub's shared furniture.
 *
 * Two components, because the third one stopped earning its place. `EvidenceCard`
 * existed to make it impossible to render a number without its source: it took an
 * `Evidence<T>` rather than a value, so a page could not opt out. The panel
 * system carries that rule better — every panel's `footer` is
 * `provenanceLine(evidence)`, which states the source and the observation age for
 * the whole panel instead of repeating it inside each of five rows — so the card
 * became a component nothing imported, and a hand-rolled box family in the
 * stylesheet that nothing rendered. Both are gone rather than kept warm.
 */

/**
 * The environment chip's exact words.
 *
 * This workspace is two things at once — it reads mainnet and it signs on
 * testnet — and for a while its front door claimed only the first. Labelling the
 * whole workspace `Mainnet · read-only` was true when it shipped and false the
 * day the lifecycle landed, so the claim moved to where it can stay true: one
 * chip per page, derived from that page's own module record.
 */
export function environmentChip(
  environment: StellarModuleEnvironment,
  mode: StellarModuleMode,
): string {
  if (environment === "MAINNET_DATA") return "Mainnet · read only";
  if (environment === "BOTH") return "Mainnet data · Testnet actions";
  if (environment === "TESTNET_ACTION") {
    return mode === "TESTNET_EXECUTION" ? "Testnet · user-signed" : "Testnet · verification";
  }
  if (environment === "FUTURE_MAINNET") return "Mainnet · separate release gate";
  return "Workspace";
}

/**
 * Title, explanation, environment.
 *
 * `lead` is not printed. It is the page's explanation, and an explanation
 * written for the first visit and rendered on every visit forever is what makes
 * a workspace read as documentation with controls attached — it charges the top
 * of the screen each time to answer a question the operator stopped having.
 * Passing it here puts it inside the info control instead, where it is one
 * click or one 44px tap away and still in the DOM for in-page search and for
 * assistive technology. Nothing is deleted; it stops being permanent.
 *
 * What stays permanent is what changes: the title says where you are, and one
 * chip says which network's facts this page deals in and what it may do there.
 * Both are facts a person needs every visit, which is the test for standing
 * room.
 *
 * **The chip is resolved from the registry, not typed here.** A page that
 * declares its own environment is a second list, and every time this repository
 * has had two lists that must agree they have disagreed silently — a module
 * marked Guided that never reached the rail, a registry flag against a
 * hand-ordered array. `module` is the module id; `environment` and `mode` exist
 * only for the two surfaces that are not modules.
 */
export function PageHead({
  title,
  lead,
  module: moduleId,
  environment,
  mode,
  aside,
}: {
  title: string;
  lead?: ReactNode;
  /** The registry id of the module this page renders. Resolves the chip. */
  module?: string;
  /** For surfaces that are not registry modules. Ignored when `module` is given. */
  environment?: StellarModuleEnvironment;
  mode?: StellarModuleMode;
  aside?: ReactNode;
}) {
  const found = moduleId ? STELLAR_MODULES.find((entry) => entry.id === moduleId) : undefined;
  if (moduleId && !found) {
    /* A typo here would silently fall back to a chip that says "Workspace" on a
       page that signs transactions, which is the exact class of quiet wrongness
       this refactor exists to remove. */
    throw new Error(`PageHead names module "${moduleId}", which is not in the Stellar registry.`);
  }

  const env = found?.environment ?? environment ?? "NONE";
  const modeValue = found?.mode ?? mode ?? "NONE";

  return (
    <header className="st-head">
      <h1 className="st-title">{title}</h1>
      {lead ? (
        <InfoControl label={`About ${title}`}>{typeof lead === "string" ? <p>{lead}</p> : lead}</InfoControl>
      ) : null}
      {aside}
      <span className="st-maturity" data-env={env}>
        {environmentChip(env, modeValue)}
      </span>
    </header>
  );
}

/**
 * One thing that needs a person.
 *
 * Shared rather than re-implemented per surface, because the Overview panel and
 * the Attention & Recovery page must say the same thing about the same
 * condition. Every row carries the same five parts: what happened, why it
 * matters, what it affects, when it was observed, and the exact step that
 * clears it. A row without a recovery step is a complaint.
 */
export function AttentionRow({ item, dense = false }: { item: AttentionItem; dense?: boolean }) {
  return (
    <div className="st-attn-row" data-severity={item.severity} data-dense={dense ? "true" : "false"}>
      <span className="st-attn-sev">
        {item.severity === "action" ? "Action required" : item.severity === "caution" ? "Caution" : "Context"}
      </span>
      <b>{item.title}</b>
      <span className="st-note">{item.detail}</span>
      {dense ? null : (
        <span className="st-attn-meta">
          {item.subject ? (
            <span className="st-domain" translate="no">
              {item.subject}
            </span>
          ) : null}
          {item.observedAt ? (
            <span translate="no">observed {item.observedAt.replace("T", " ").slice(0, 19)}Z</span>
          ) : (
            <span>true right now</span>
          )}
        </span>
      )}
      <span className="st-attn-fix">
        <span>{item.recovery}</span>
        {item.href ? (
          <Link className="st-open" href={item.href}>
            Fix now
            <ArrowMark size={12} />
          </Link>
        ) : null}
      </span>
    </div>
  );
}

/** One of the five evidence states, as a chip rather than a colour wash. */
export function StateChip({ state }: { state: Evidence<unknown>["state"] }) {
  return (
    <span className="sh-state" data-state={state}>
      {state}
    </span>
  );
}
