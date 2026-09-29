import type { ReactNode } from "react";

import type { StateTone } from "./truth-view";

/*
 * No stylesheet here on purpose.
 *
 * This module used to import the legacy `./module.css`, which put it on every
 * page that borrowed a part — including migrated ones, where its `.rx-head`
 * grid and its 11px module bar beat the frozen rules. The sheet belongs with
 * the legacy chrome, which is exactly the set of pages that still want it, and
 * the frozen layer defines the same names for the rest.
 */

/**
 * The shared page furniture: a numbered section head, a status pill and a
 * ledger row. Small on purpose — the design lives in `site.css`, and a page
 * that needs a shape this file does not have should write the markup rather
 * than grow a prop.
 */

/**
 * A section, rendered as an instrument module.
 *
 * The plate is not decoration: an open section reads as text followed by more
 * text, and a reader never registers arriving somewhere new. The bar carries
 * the index, the subject and — where the section has one — a state, so a block
 * announces what it is before a word of it is read.
 *
 * `meta` is the right-hand slot on that bar. Use it for something factual: a
 * network, a count, a review date. It is the difference between a header strip
 * and a decorative rule.
 */
export function Section({
  id,
  index,
  kicker,
  heading,
  lead,
  children,
  paper = false,
  tight = false,
  meta,
  headExtra,
}: {
  id?: string;
  index: string;
  kicker: string;
  heading?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  /** Switches the block onto the light evidence surface. */
  paper?: boolean;
  tight?: boolean;
  /** Factual right-hand text on the module bar. */
  meta?: ReactNode;
  headExtra?: ReactNode;
}) {
  return (
    <section
      id={id}
      className={[
        "rx-section",
        tight ? "rx-section--tight" : "",
        paper ? "rx-paper" : "",
      ].filter(Boolean).join(" ")}
    >
      <div className="rx-shell">
        <div className="rx-mod" data-rx-reveal="tilt">
          <span className="rx-mod-tick rx-mod-tick--tr" aria-hidden />
          <span className="rx-mod-tick rx-mod-tick--bl" aria-hidden />

          <div className="rx-mod-bar">
            <span className="rx-mod-n">{index}</span>
            <span className="rx-mod-subject">{kicker}</span>
            {meta ? <span className="rx-mod-meta">{meta}</span> : null}
          </div>

          <div className="rx-mod-body">
            {heading || lead ? (
              <div className="rx-head">
                {heading ? <h2 className="rx-h2">{heading}</h2> : null}
                {lead ? <p className="rx-lead">{lead}</p> : null}
                {headExtra}
              </div>
            ) : null}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The opening block of a sub-page.
 *
 * Deliberately quieter than the homepage hero: a visitor who reached a
 * sub-page such as `/security` has already been sold the category and now wants the specific
 * answer, so the page leads with the claim and its scope rather than a stage.
 */
export function PageHero({
  eyebrow,
  heading,
  lead,
  meta,
  actions,
}: {
  eyebrow: string;
  heading: ReactNode;
  lead?: ReactNode;
  /** Status rail: short, factual, upper-cased at the CSS layer. */
  meta?: readonly string[];
  actions?: ReactNode;
}) {
  return (
    <section className="rx-pagehero">
      <div className="rx-shell">
        <p className="rx-eyebrow" data-rx-reveal="up" data-rx-group="hero">
          {eyebrow}
        </p>
        <h1 className="rx-h1" data-rx-reveal="up" data-rx-group="hero">
          {heading}
        </h1>
        {lead ? (
          <p className="rx-lead" style={{ marginTop: 24 }} data-rx-reveal="up" data-rx-group="hero">
            {lead}
          </p>
        ) : null}
        {actions ? (
          <div className="rx-pagehero-actions" data-rx-reveal="up" data-rx-group="hero">
            {actions}
          </div>
        ) : null}
        {meta?.length ? (
          <ul className="rx-trust" data-rx-reveal="up" data-rx-group="hero">
            {meta.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The status pill.
 *
 * It carries no `title`. A tooltip is invisible on a touchscreen and unreliable
 * with a screen reader, so scope is always rendered as visible text beside the
 * pill instead — which is also the only version a reviewer can screenshot.
 */
export function StatePill({ label, tone }: { label: string; tone: StateTone }) {
  return (
    <span className="rx-state" data-tone={tone}>
      {label}
    </span>
  );
}

/**
 * A stated gap.
 *
 * An artifact that does not exist gets prose explaining why, never a control a
 * reviewer can press. This component is the only sanctioned way to render one.
 */
export function StatedGap({ children }: { children: ReactNode }) {
  return <span className="rx-gap">{children}</span>;
}

export function LedgerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rx-ledger-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
