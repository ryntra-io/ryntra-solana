"use client";

import type { RavenMarketsCopy } from "./raven-copy";

/**
 * Coverage section.
 *
 * The asset-class list is passed in from HOME_COPY unchanged: it states the
 * permission the venue actually grants per class (read the feed, or move money
 * on a proven route). Presentation is new here; the claims are not.
 *
 * The two clocks are shown as an explanation above the grid rather than as a
 * badge on each card. Which calendar a given class follows is a fact about the
 * market, but *this instrument is open right now* is live state we do not have
 * in the coverage data — and inventing it in the section whose whole subject is
 * honest data states would be an unusually stupid place to start guessing.
 */
export function RavenMarkets({
  copy,
  items,
  roleLabels,
}: {
  /** Resolved on the server so the three-locale dictionary stays out of the bundle. */
  copy: RavenMarketsCopy;
  /** Readonly because it arrives straight from the frozen HOME_COPY table. */
  items: readonly { name: string; role: string; detail: string }[];
  roleLabels: Readonly<Record<string, string>>;
}) {

  return (
    <section className="rv-section rv-markets" id="coverage">
      <div className="rv-section-inner">
        <header className="rv-section-head rv-reveal">
          <span className="rv-eyebrow mono">{copy.eyebrow}</span>
          <h2 className="rv-h2">{copy.title}</h2>
          <p className="rv-section-lead">{copy.lead}</p>
        </header>

        <div className="rv-clocks rv-reveal">
          <span className="rv-clock rv-clock-always mono">{copy.clock.always}</span>
          <span className="rv-clock-sep" aria-hidden />
          <span className="rv-clock rv-clock-sessions mono">{copy.clock.sessions}</span>
          <p className="rv-clock-note">{copy.hoursNote}</p>
        </div>

        <ul className="rv-coverage rv-reveal">
          {items.map((item) => (
            <li key={item.name} data-role={item.role}>
              <span className="rv-coverage-role mono">{roleLabels[item.role] ?? item.role}</span>
              <h3>{item.name}</h3>
              <p>{item.detail}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
