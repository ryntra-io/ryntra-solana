"use client";

import { ArrowRight, Check } from "@phosphor-icons/react/dist/ssr";

import type { RavenPrinciplesCopy } from "./raven-copy";

/**
 * Principles section.
 *
 * Every claim here comes in from HOME_COPY unchanged, including the proof
 * column: a real swap that finished, with its size, fee, authorisation and
 * result. That column is the reason the rules read as commitments rather than
 * marketing — so it sits beside them, not in a footnote.
 *
 * The rules are numbered. Four things a product "cannot break" is a stronger
 * statement than four bullet points, and numbering them makes the count part of
 * the claim: there is no fifth rule hiding somewhere.
 */
export function RavenPrinciples({
  copy,
  rules,
  methodologyHref,
  methodologyLabel,
  proof,
  fine,
}: {
  /** Resolved on the server so the three-locale dictionary stays out of the bundle. */
  copy: RavenPrinciplesCopy;
  rules: readonly { h: string; p: string }[];
  methodologyHref: string;
  methodologyLabel: string;
  proof: {
    kicker: string;
    title: string;
    rows: readonly { k: string; v: string }[];
    status: string;
    note: string;
  };
  fine: readonly string[];
}) {

  return (
    <section className="rv-section rv-principles" id="trust">
      <div className="rv-section-inner">
        <header className="rv-section-head rv-reveal">
          <span className="rv-eyebrow mono">{copy.eyebrow}</span>
          <h2 className="rv-h2">{copy.title}</h2>
          <p className="rv-section-lead">
            <a href={methodologyHref} className="rv-text-link">
              {methodologyLabel}
              <ArrowRight size={16} weight="bold" aria-hidden />
            </a>
          </p>
        </header>

        <div className="rv-principles-grid rv-reveal">
          <ol className="rv-rules">
            {rules.map((rule, i) => (
              <li key={rule.h}>
                <span className="rv-rule-n mono">{String(i + 1).padStart(2, "0")}</span>
                <h3>{rule.h}</h3>
                <p>{rule.p}</p>
              </li>
            ))}
          </ol>

          {/* Evidence, not assertion. */}
          <aside className="rv-proof">
            <span className="rv-proof-lead mono">{copy.proofLead}</span>
            <span className="rv-proof-kicker mono">{proof.kicker}</span>
            <h3>{proof.title}</h3>
            <dl className="rv-proof-rows">
              {proof.rows.map((row) => (
                <div key={row.k}>
                  <dt>{row.k}</dt>
                  <dd>{row.v}</dd>
                </div>
              ))}
            </dl>
            <p className="rv-proof-status">
              <Check size={14} weight="bold" aria-hidden />
              {proof.status}
            </p>
            <p className="rv-proof-note">{proof.note}</p>
          </aside>
        </div>

        <div className="rv-fine">
          {fine.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
    </section>
  );
}
