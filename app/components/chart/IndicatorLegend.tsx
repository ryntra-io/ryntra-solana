"use client";

/* Compact indicator legend overlaid top-left on the chart.
   Container ignores pointer events; individual chips are interactive. */

import { Eye, EyeSlash } from "@phosphor-icons/react";

export type LegendRow = {
  id: string;
  label: string;
  color: string;
  values: string[];
  visible: boolean;
};

export function IndicatorLegend(props: {
  rows: LegendRow[];
  onToggle(id: string): void;
  onRemove(id: string): void;
}) {
  if (props.rows.length === 0) return null;

  return (
    <div className="pc-legend">
      {props.rows.map((r) => (
        <div key={r.id} className={"pc-legend-chip" + (r.visible ? "" : " off")}>
          <span className="pc-dot" style={{ background: r.color }} />
          <span className="pc-legend-label">{r.label}</span>
          {r.values.length > 0 && <span className="pc-legend-vals">{r.values.join(" · ")}</span>}
          <span className="pc-legend-tools">
            <button
              type="button"
              title={r.visible ? "Hide" : "Show"}
              aria-label={r.visible ? "Hide indicator" : "Show indicator"}
              onClick={() => props.onToggle(r.id)}
            >
              {r.visible ? <Eye size={12} /> : <EyeSlash size={12} />}
            </button>
            <button
              type="button"
              title="Remove"
              aria-label="Remove indicator"
              onClick={() => props.onRemove(r.id)}
            >
              ×
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
