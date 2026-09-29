import type { CSSProperties } from "react";

import { RyntraMark } from "@/app/brand/ryntra-brand";

/**
 * The route orbit — the specialist scope drawn as a small solar system.
 *
 * The three supported tokenized stocks circle the mark on the outer ring and
 * the quote asset on the inner one, counter-rotating slowly. It is exactly as
 * honest as the copy beside it: these four tickers are the whole wallet-signed
 * scope today, which is why nothing else orbits.
 *
 * Pure CSS motion, transform-only. Each satellite sits on a rotating belt,
 * inside an un-spinner that cancels the belt's rotation so the ticker stays
 * upright. Under reduced motion the belts hold still and the satellites are
 * simply positioned. Hovering the orbit pauses it, so a ticker can be read.
 */

const seat = (angle: string) => ({ "--a": angle } as CSSProperties);

function Satellite({ ticker }: { ticker: string }) {
  return (
    <span className="rx-orbit-arm">
      <span className="rx-orbit-unspin">
        <span className="rx-orbit-sat rx-mono" translate="no">
          {ticker}
        </span>
      </span>
    </span>
  );
}

export function RouteOrbit() {
  return (
    <div className="rx-orbit-wrap">
      <div className="rx-orbit" aria-hidden="true">
        <span className="rx-orbit-ring rx-orbit-ring--outer" />
        <span className="rx-orbit-ring rx-orbit-ring--inner" />

        <span className="rx-orbit-core">
          <RyntraMark size={38} />
        </span>

        <span className="rx-orbit-belt">
          <span className="rx-orbit-seat" style={seat("0deg")}>
            <Satellite ticker="TSLA" />
          </span>
          <span className="rx-orbit-seat" style={seat("120deg")}>
            <Satellite ticker="AAPL" />
          </span>
          <span className="rx-orbit-seat" style={seat("240deg")}>
            <Satellite ticker="AMD" />
          </span>
        </span>

        <span className="rx-orbit-belt rx-orbit-belt--inner">
          <span className="rx-orbit-seat" style={seat("90deg")}>
            <Satellite ticker="USDG" />
          </span>
        </span>
      </div>

      <p className="rx-orbit-caption">
        The whole wallet-signed scope today: USDG↔TSLA, USDG↔AAPL and USDG↔AMD on Arcus spot —
        which is why nothing else orbits.
      </p>
    </div>
  );
}
