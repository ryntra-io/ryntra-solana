import type { ReactNode } from "react";

import type { CircuitStage, EnvironmentRow } from "./truth-view";

/**
 * The two summary bands.
 *
 * The first is the lifecycle itself, with the stages that are genuinely proven
 * lit and the rest left dim, so the band is a truthful one-line summary of what
 * works. The second says the same about chains and venues.
 *
 * They drift again, reversing the earlier static bands. Every guard that
 * made the original marquee acceptable returns with it:
 *
 *   - the loop is slow and pauses under the pointer and under keyboard focus;
 *   - the track is duplicated once so the loop has no seam, and the second
 *     pass is aria-hidden so assistive technology hears the list exactly once;
 *   - under `prefers-reduced-motion` the belt stops and the band becomes the
 *     static, horizontally scrollable strip it was before;
 *   - the states are still resolved from the registry — nothing in this file
 *     knows what "live" means.
 */

const PROVEN: readonly string[] = ["live", "testnet_verified"];

function Belt({ children }: { children: ReactNode }) {
  return (
    <div className="rx-banner-belt">
      <div className="rx-banner-track">{children}</div>
      {/* The seam-hiding second pass: identical content, announced never. */}
      <div className="rx-banner-track" aria-hidden={true}>
        {children}
      </div>
    </div>
  );
}

export function LifecycleBanner({ stages }: { stages: readonly CircuitStage[] }) {
  return (
    <div
      className="rx-banner"
      role="group"
      tabIndex={0}
      aria-label="The Ryntra lifecycle and how far each stage is proven"
    >
      <Belt>
        {stages.map((stage) => (
          <span
            className="rx-banner-item"
            key={stage.id}
            data-proven={PROVEN.includes(stage.state)}
            data-actor={stage.id === "authorize" ? "human" : "system"}
          >
            {stage.name}
            <b>{stage.stateLabel}</b>
          </span>
        ))}
      </Belt>
    </div>
  );
}

export function EnvironmentBanner({ environments }: { environments: readonly EnvironmentRow[] }) {
  return (
    <div
      className="rx-banner"
      role="group"
      tabIndex={0}
      data-flow="reverse"
      aria-label="Environments and adapters, with the state of each"
    >
      <Belt>
        {environments.map((environment) => (
          <span
            className="rx-banner-item"
            key={environment.id}
            data-proven={PROVEN.includes(environment.state)}
          >
            {environment.name}
            <b>{environment.stateLabel}</b>
          </span>
        ))}
      </Belt>
    </div>
  );
}
