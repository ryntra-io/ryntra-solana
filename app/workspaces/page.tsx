import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react/dist/ssr";

import { FrozenFooter, FrozenHeader } from "@/app/site/frozen/chrome";
import { MarkDefs } from "@/app/site/frozen/mark";
import "@/app/site/frozen/primitives.css";
import "@/app/site/frozen/module.css";
import "@/app/site/frozen/bridge.css";
import { sitePageMetadata } from "@/app/site/seo";
import {
  STATE_LABEL,
  STATE_TONE,
  type PublicState,
  type StateTone,
} from "@/app/site/truth-view";
import { WORKSPACES } from "@/app/shell/workspaces";
import {
  ECOSYSTEMS,
  isSelectable,
  type EcosystemKind,
  type EcosystemManifest,
} from "@/lib/product/ecosystems";

export const revalidate = 3600;

export const metadata: Metadata = sitePageMetadata({
  path: "/workspaces",
  title: "Workspace Map — what you can open, and every direction behind it",
  description:
    "Every Ryntra workspace a person can open today, and every chain and venue direction the product has registered, each with the exact point it stops. Being registered is not being supported.",
  keywords: [
    "ryntra workspaces",
    "workspace map",
    "product roadmap",
    "chain packs",
    "venue adapters",
    "capability state",
  ],
});

/**
 * The Workspace Map, on the frozen Quiet Intelligence system.
 *
 * This page exists because the workspace switcher stopped trying to be one. The
 * switcher used to list nine things at three different levels — a page, a
 * product zone, a network, a way of working, an unbuilt adapter and two
 * research directions. A menu is a set of choices, so anything in it that
 * cannot be chosen makes every row harder to trust.
 *
 * Rebuilt 2026-08-18 on the founder's report that it read as one text wall and
 * that the mega-menu above it could not be understood. Both had the same cause
 * and it was not the writing: **six doors and eleven registered facts were
 * rendered as the same card**, and the header carried a two-column menu the
 * frozen system does not contain. Landing Brief v1.3 fixes the public bar at
 * `RYNTRA | … | Docs | [Request beta]`, so migrating onto the frozen chrome
 * removes the mega-menu rather than restyling it, and `Request beta` here opens
 * the real gate — iron law 3 — instead of the explanatory page.
 *
 * Every fact, every registry binding and every boundary sentence is carried
 * over unchanged. Two rules keep it honest, exactly as before:
 *
 *   Directions render from `lib/product/ecosystems.ts`, never from a list
 *   written here. A direction that advances advances on this page by itself;
 *   one invented in prose does not exist and cannot be typed in.
 *
 *   A research row gets no action control. `isSelectable()` decides that in
 *   code — canon §7: no execution CTA, no implied partnership, no "coming
 *   soon".
 *
 * The one copy change is the boundary's own heading. "Registration is not
 * support" is the sentence the founder circled as unreadable; it now reads
 * "Registered, not supported", which states the same distinction in words that
 * survive one pass of the eye. The claim is unchanged.
 */

/**
 * The chip, and the frozen vocabulary it speaks.
 *
 * Rendered here rather than imported from `app/site/parts`, because that module
 * loads the legacy `app/site/module.css` — which defines `.rx-head` as a
 * two-column grid and won the cascade over the frozen flex one, floating every
 * section's note far from the heading it belongs to. The frozen sheet's own
 * header states the rule: a migrated surface must not also load the legacy one.
 * A five-line span is not worth a whole stylesheet.
 *
 * `Testnet verified` is what `STATE_LABEL` gives that state and what the Guard
 * API serves, so it is not renamed at the source — that is a contract. Brandbook
 * v1.2 says the surface word is TESTNET, so a migrated surface maps it at the
 * last moment before drawing, keyed on the state and never on the string.
 */
function Chip({ state, label, tone }: { state?: PublicState; label: string; tone: StateTone }) {
  return (
    <span className="rx-state" data-tone={tone}>
      {state === "testnet_verified" ? "Testnet" : label}
    </span>
  );
}

/** `read_only` describes a mode, not a release stage. */
function manifestState(state: EcosystemManifest["state"]): PublicState {
  return state === "read_only" ? "live" : state;
}

const KIND_HEADING: Record<EcosystemKind, string> = {
  chain_pack: "Chain packs",
  venue_adapter: "Venue adapters",
};

const KIND_NOTE: Record<EcosystemKind, string> = {
  chain_pack: "Where value settles.",
  venue_adapter: "How an action is quoted or executed.",
};

/**
 * Which workspace already renders a direction, when one does.
 *
 * Derived from the workspace registry's own `opens`, not written here. The
 * reasoning that put this map on the page — the manifest knows what is built,
 * the workspace side knows where a person opens it, and keeping the two apart
 * is what stops a listed direction from quietly acquiring a door — was right
 * about the ownership and wrong about the file. Written out by hand it was a
 * third record of one relationship, the only one a reader would find, and the
 * only one free to disagree with the other two while everything still
 * compiled. Inverting the declaration keeps the property that mattered: a
 * direction still cannot give itself a door, and now this page cannot give it
 * one either.
 */
const OPENS_IN: Record<string, string> = Object.fromEntries(
  WORKSPACES.flatMap((workspace) =>
    (workspace.opens ?? []).map((direction) => [direction, workspace.id]),
  ),
);

export default function WorkspacesPage() {
  const usable = ECOSYSTEMS.filter(isSelectable);

  return (
    <div className="rx">
        <MarkDefs />
        <FrozenHeader />

        <main id="main" tabIndex={-1}>
          <header className="rx-section rx-pagehero" data-ry-theme="dark">
            <div className="rx-shell">
              <p className="rx-eyebrow">Workspace map</p>
              {/* Counted from the registry, because "Three" was written when it
                  was true and stayed after three more workspaces shipped. */}
              <h1 className="rx-h1 rx-h1--wide">
                {WORKSPACES.length} workspaces you can open.
                <br />
                Every direction behind them, with its limit.
              </h1>
              <p className="rx-lead">
                A workspace is a place you work — not a chain, and not a page.
              </p>
              <ul className="rx-trust">
                <li>{WORKSPACES.length} workspaces</li>
                <li>{ECOSYSTEMS.length} registered directions</li>
                <li>{usable.length} usable</li>
                <li>No dates · no percentages</li>
              </ul>
            </div>
          </header>

          <section id="workspaces" className="rx-section" data-ry-theme="dark">
            <div className="rx-shell">
              <div className="rx-head">
                <h2 className="rx-h2">The workspaces</h2>
                <span className="rx-fine">{WORKSPACES.length} enterable</span>
              </div>
              <p className="rx-lead">
                Each one changes the canvas and the rail — never your account.
              </p>

              <div className="rx-grid">
                {WORKSPACES.map((workspace) => (
                  <Link className="rx-tile" key={workspace.id} href={workspace.href}>
                    <div className="rx-tile-top">
                      <h3 className="rx-tile-name">{workspace.name}</h3>
                      {/* Access, in the tone vocabulary the rest of the site
                          uses: cyan for real and inspectable, grey for gated.
                          Never mint — mint means proven by evidence, and "you
                          can sign in" is not a claim about what was proved. */}
                      <Chip
                        label={workspace.access === "public" ? "Open" : "Sign-in"}
                        tone={workspace.access === "public" ? "evidence" : "neutral"}
                      />
                    </div>
                    <p className="rx-tile-note">{workspace.subtitle}</p>
                    <p className="rx-tile-env">
                      {workspace.environment ?? "Venue-neutral · no single network"}
                    </p>
                    <p className="rx-tile-foot">
                      <span>
                        {workspace.access === "public"
                          ? "No account needed"
                          : "Beta cabinet session"}
                      </span>
                      <span className="rx-tile-go" aria-hidden>
                        <ArrowRight size={14} weight="bold" />
                      </span>
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          </section>

          <section id="directions" className="rx-section" data-ry-theme="light">
            <div className="rx-shell">
              <div className="rx-head">
                <h2 className="rx-h2">Chains and venues Ryntra has registered</h2>
                <span className="rx-fine">Owner: lib/product/ecosystems.ts</span>
              </div>
              <p className="rx-lead">
                A chain settles. A venue quotes or executes. A direction appears here once it
                is registered, not once it works.
              </p>
              <p className="rx-fine">
                Nothing below is a partnership, an endorsement or a claim of support by the
                named project.
              </p>

              {(["chain_pack", "venue_adapter"] as const).map((kind) => {
                const rows = ECOSYSTEMS.filter((entry) => entry.kind === kind);
                return (
                  <section className="rx-group rx-group--stacked" key={kind}>
                    <div className="rx-head">
                      <h3 className="rx-h3">{KIND_HEADING[kind]}</h3>
                      <span className="rx-fine">{KIND_NOTE[kind]}</span>
                    </div>

                    <div className="rx-dir">
                      {rows.map((entry) => {
                        const workspaceId = OPENS_IN[entry.id];
                        const workspace = WORKSPACES.find((item) => item.id === workspaceId);
                        return (
                          <div className="rx-dir-row" key={entry.id}>
                            <div className="rx-dir-head">
                              <h4 className="rx-dir-name">{entry.name}</h4>
                              {/* `read_only` collapses into `live` for the pill,
                                  because it is a mode and not a release stage —
                                  and then it must say so beside it. Arcus Perps
                                  reading `LIVE` alone would claim a venue that
                                  never submits an order, which is the single
                                  most expensive word this page could get
                                  wrong. */}
                              <Chip
                                state={manifestState(entry.state)}
                                label={STATE_LABEL[manifestState(entry.state)]}
                                tone={STATE_TONE[manifestState(entry.state)]}
                              />
                              {entry.state === "read_only" ? (
                                <span className="rx-fine">Read-only</span>
                              ) : null}
                              {/* An action only where one honestly exists. A
                                  research row gets a sentence, never a button. */}
                              {workspace && isSelectable(entry) ? (
                                <Link className="rx-dir-open" href={workspace.href}>
                                  Open in {workspace.name}
                                  <ArrowRight size={12} weight="bold" aria-hidden />
                                </Link>
                              ) : (
                                <span className="rx-fine">No workspace opens this yet</span>
                              )}
                            </div>

                            <div className="rx-dir-body">
                              <p className="rx-dir-role">{entry.role}</p>
                              {entry.gate ? <p className="rx-dir-gate">{entry.gate}</p> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>

          <section className="rx-section rx-section--tight" data-ry-theme="dark">
            <div className="rx-shell">
              <h2 className="rx-h2">Registered, not supported</h2>
              <p className="rx-lead">
                Accepting a direction creates no capability. What is actually shipped, with its
                review window and its exact scope, is one registry and it is published.
              </p>
              <p className="rx-linkrow">
                <Link className="rx-btn rx-btn--ghost rx-btn--sm" href="/docs/ecosystems">
                  Capability registry in the Handbook
                </Link>
              </p>
            </div>
          </section>
        </main>

        <FrozenFooter />
      </div>
  );
}
