import type { ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";

import { type EcosystemManifest } from "@/lib/product/ecosystems";
import { STATE_LABEL, STATE_TONE, type PublicState } from "@/app/site/truth-view";

export { STATE_TONE };
export type { PublicState, EcosystemManifest };

/**
 * The Handbook's own furniture, extracted when `/docs` became a hub.
 *
 * These four moved verbatim out of the single page they were declared in, so a
 * chapter that now lives on its own route renders exactly as it did — same
 * markup, same alternating ground, same disclosure. Nothing here was rewritten
 * on the way; the point of the split was where the chapters live, not what they
 * say.
 */

export function Chapter({
  id,
  n,
  heading,
  lead,
  meta,
  children,
  source,
  bare = false,
}: {
  id: string;
  n: string;
  /* Named `heading`, not `title`, to match `Section` — and because a bare
     `title=` in this codebase means the HTML tooltip attribute, which is
     banned: it is invisible on a touchscreen, unreliable with a screen reader
     and impossible to screenshot. */
  heading: string;
  lead?: ReactNode;
  meta?: string;
  children: ReactNode;
  /** Where this section's content is maintained. Rendered as its footer. */
  source: readonly string[];
  /**
   * Drop the chapter's own head.
   *
   * Inside a documentation article the page already carries the heading, the
   * lead and the review date — rendering the chapter head as well printed the
   * title twice and put a chapter number on a page that is no longer the third
   * of ten. The plate, the ground and the source footer all stay.
   */
  bare?: boolean;
}) {
  return (
    /*
     * Chapters alternate ground, the way the landing alternates its blocks.
     * Ten sections on one flat Midnight read as a wall rather than a document,
     * and the reader loses their place; a change of ground is the cheapest
     * possible chapter break. Because every rule on this page is written in
     * tokens, flipping `data-ry-theme` re-resolves the whole chapter — text,
     * muted, borders, cards, tracks — with nothing restated per theme.
     */
    <section
      className="rx-hb-sec"
      data-hb-sec={id}
      data-ry-theme={Number(n) % 2 === 0 ? "light" : "dark"}
      aria-labelledby={`${id}-title`}
    >
      {bare ? (
        <h2 className="rx-sr" id={`${id}-title`}>
          {heading}
        </h2>
      ) : (
        <>
          <div className="rx-hb-head" id={id}>
            <span className="rx-hb-n">{n}</span>
            <h2 className="rx-h2 rx-hb-title" id={`${id}-title`}>
              {heading}
            </h2>
            {meta ? <span className="rx-hb-meta">{meta}</span> : null}
          </div>
          {lead ? <p className="rx-hb-lead">{lead}</p> : null}
        </>
      )}
      {children}
      <div className="rx-hb-source">
        {source.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </div>
    </section>
  );
}

export function Detail({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="rx-hb-detail">
      <summary>
        <CaretRight size={13} weight="bold" aria-hidden />
        {summary}
      </summary>
      <div className="rx-hb-detail-body">{children}</div>
    </details>
  );
}

export function stateLabel(state: PublicState): string {
  return state === "testnet_verified" ? "Testnet" : STATE_LABEL[state];
}

export function frozenClaim(label: string): string {
  return label.replace(/^TESTNET VERIFIED\b/, "TESTNET");
}

export function manifestState(state: EcosystemManifest["state"]): PublicState {
  /* `read_only` describes mode, not release maturity. */
  if (state === "read_only") return "live";
  return state;
}

export const STATE_ORDER: readonly PublicState[] = [
  "live",
  "testnet_verified",
  "paper",
  "preview",
  "in_build",
  "planned",
  "after_gate",
  "research",
  "re_verifying",
];

export const STATE_MEANING: Readonly<Record<PublicState, string>> = {
  live: "Usable now, inside the exact scope stated on the row. Not a promise about anything outside it.",
  testnet_verified:
    "Proven end to end on a public testnet for one exact operation. Testnet assets have no intended monetary value, and mainnet support is not claimed.",
  paper: "Runs, but simulated. Nothing reaches a venue and no value moves.",
  preview: "Exists in the product but is not publicly released.",
  planned: "Registered work that has not started. Never rendered as available, and never as under way.",
  in_build: "Designed and specified, and being built. Never rendered as available.",
  after_gate: "Deliberately behind a further gate — security, reliability or authorization work comes first.",
  research: "A direction named in the design, with no adapter and no implementation.",
  re_verifying:
    "The claim has aged past its review window, so it is shown as unverified rather than at its previous confidence. This happens automatically.",
};
