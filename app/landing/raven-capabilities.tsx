"use client";

import { useId, useState } from "react";
import { CaretDown, Check, X } from "@phosphor-icons/react";

import type { RavenCapsCopy } from "./raven-copy";

/**
 * "What you can do now" — the four reachable capabilities, with their evidence.
 *
 * A marketing feature list states what a product does. The interesting half is
 * what it will never do, and that is the half a visitor cannot verify from a
 * card. So every row carries three things a normal feature row omits: the one
 * commitment, the one refusal, and a drawer of evidence fields behind them.
 *
 * Two facts about this block are load-bearing:
 *
 *  - The maturity badge is resolved from the capability registry by the caller,
 *    never authored in the copy dictionary. A row cannot advertise a maturity
 *    the product has not reached, and when the registry moves this follows.
 *  - An unconfirmed capability fails closed: the row keeps its evidence but the
 *    badge reads "re-verifying" and the affirmative tone is dropped, because a
 *    green tick beside stale verification is the exact lie this page exists to
 *    avoid.
 *
 * The rows are independent rather than a strict accordion. Closing someone
 * else's row to open your own is a small hostility, and the evidence is short
 * enough that several open at once still reads.
 */

export function RavenCapabilities({
  copy,
  rows,
}: {
  /** Resolved on the server so the three-locale dictionary stays out of the bundle. */
  copy: RavenCapsCopy;
  rows: readonly {
    /** Registry id — also the key into the evidence dictionary. */
    capabilityId: string;
    n: string;
    h: string;
    p: string;
    /** Resolved registry label, e.g. "Live" / "Paper" / "In build". */
    maturityLabel: string;
    /** Resolved registry key, drives the badge treatment. */
    maturityKey: string;
    /** False when the capability is awaiting re-verification. */
    confirmed: boolean;
  }[];
}) {
  const baseId = useId();
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <section className="rv-section rv-caps" id="now">
      <div className="rv-section-inner">
        <header className="rv-section-head rv-reveal">
          <span className="rv-eyebrow mono">{copy.eyebrow}</span>
          <h2 className="rv-h2">{copy.title}</h2>
          <p className="rv-section-lead">{copy.lead}</p>
        </header>

        <ul className="rv-caps-list rv-reveal">
          {rows.map((row) => {
            const detail = copy.rows[row.capabilityId];
            if (!detail) return null;
            const isOpen = open[row.capabilityId] === true;
            const panelId = `${baseId}-${row.capabilityId}`;

            return (
              <li
                className="rv-caps-row"
                key={row.capabilityId}
                data-open={isOpen ? "true" : undefined}
                data-confirmed={row.confirmed ? undefined : "false"}
              >
                <button
                  type="button"
                  className="rv-caps-head"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() =>
                    setOpen((previous) => ({
                      ...previous,
                      [row.capabilityId]: !previous[row.capabilityId],
                    }))
                  }
                >
                  <span className="rv-caps-main">
                    <span className="rv-caps-n mono" aria-hidden>
                      {row.n}
                    </span>
                    <span className="rv-caps-text">
                      <span className="rv-caps-title">
                        <b>{row.h}</b>
                        <span className="rv-maturity mono" data-maturity={row.maturityKey}>
                          {row.maturityLabel}
                        </span>
                      </span>
                      <span className="rv-caps-p">{row.p}</span>
                    </span>
                  </span>

                  {/* The commitment and the refusal. The refusal is the one a
                      visitor cannot get anywhere else, so it is not a footnote. */}
                  <span className="rv-caps-pledges">
                    <span className="rv-caps-does">
                      <Check size={13} weight="bold" aria-hidden />
                      {detail.does}
                    </span>
                    <span className="rv-caps-never">
                      <X size={13} weight="bold" aria-hidden />
                      {detail.never}
                    </span>
                    <span className="rv-caps-more mono" aria-hidden>
                      {isOpen ? copy.drawerClose : copy.drawerOpen}
                      <CaretDown size={10} weight="bold" className="rv-caps-caret" />
                    </span>
                  </span>
                </button>

                <div className="rv-caps-drawer" id={panelId} hidden={!isOpen}>
                  <dl className="rv-caps-evidence">
                    <div>
                      <dt className="mono">{copy.keys.maturity}</dt>
                      <dd data-tone={row.confirmed ? row.maturityKey : "unverified"}>
                        {row.maturityLabel}
                      </dd>
                    </div>
                    <div>
                      <dt className="mono">{copy.keys.state}</dt>
                      <dd>{detail.evidence.state}</dd>
                    </div>
                    <div>
                      <dt className="mono">{copy.keys.source}</dt>
                      <dd>{detail.evidence.source}</dd>
                    </div>
                    <div>
                      <dt className="mono">{copy.keys.can}</dt>
                      <dd>{detail.evidence.can}</dd>
                    </div>
                    <div>
                      <dt className="mono">{copy.keys.cannot}</dt>
                      <dd data-tone="refuse">{detail.evidence.cannot}</dd>
                    </div>
                    <div>
                      <dt className="mono">{copy.keys.approve}</dt>
                      <dd data-tone="approve">{detail.evidence.approve}</dd>
                    </div>
                  </dl>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="rv-caps-note mono">{copy.note}</p>
      </div>
    </section>
  );
}
