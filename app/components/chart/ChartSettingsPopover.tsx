"use client";

/* Chart display settings popover. Presentational — settings state lives in ProChart. */

import type { ChartSettings } from "@/lib/chart/settings";
import { CANDLE_PALETTES } from "@/lib/chart/theme";
import { useOutsideClose } from "./IndicatorsMenu";

const CHART_TYPES: { id: ChartSettings["chartType"]; label: string }[] = [
  { id: "candles", label: "Candles" },
  { id: "bars", label: "Bars" },
  { id: "hollow", label: "Hollow" },
  { id: "line", label: "Line" },
  { id: "area", label: "Area" },
];

const PALETTES: { id: ChartSettings["palette"]; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "contrast", label: "Contrast" },
  { id: "colorblind", label: "Colorblind" },
];

export function ChartSettingsPopover(props: {
  open: boolean;
  onClose(): void;
  settings: ChartSettings;
  onChange(s: ChartSettings): void;
}) {
  const ref = useOutsideClose<HTMLDivElement>(props.open, props.onClose);
  if (!props.open) return null;

  const s = props.settings;
  const set = (part: Partial<ChartSettings>) => props.onChange({ ...s, ...part });
  const setScale = (part: Partial<ChartSettings["scale"]>) =>
    props.onChange({ ...s, scale: { ...s.scale, ...part } });

  const check = (on: boolean, label: string, toggle: () => void) => (
    <button
      type="button"
      className={"pc-check" + (on ? " on" : "")}
      aria-pressed={on}
      onClick={toggle}
    >
      <i />
      {label}
    </button>
  );

  return (
    <div className="pc-pop pc-settings" ref={ref}>
      <div className="pc-pop-title">Chart</div>
      <div className="pc-set-row">
        <span className="pc-seg" role="group" aria-label="Chart type">
          {CHART_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={s.chartType === t.id ? "on" : undefined}
              onClick={() => set({ chartType: t.id })}
            >
              {t.label}
            </button>
          ))}
        </span>
      </div>
      <div className="pc-set-row">
        {PALETTES.map((p) => (
          <button
            key={p.id}
            type="button"
            className={"pc-swatch" + (s.palette === p.id ? " on" : "")}
            aria-pressed={s.palette === p.id}
            onClick={() => set({ palette: p.id })}
          >
            <i style={{ background: CANDLE_PALETTES[p.id].up }} />
            <i style={{ background: CANDLE_PALETTES[p.id].down }} />
            {p.label}
          </button>
        ))}
      </div>

      <div className="pc-pop-title pc-pop-title-gap">Display</div>
      <div className="pc-set-row">
        {check(s.grid, "Grid", () => set({ grid: !s.grid }))}
        {check(s.watermark, "Watermark", () => set({ watermark: !s.watermark }))}
      </div>
      <div className="pc-set-row">
        <span className="pc-set-label">Time labels</span>
        <span className="pc-seg" role="group" aria-label="Time labels">
          <button
            type="button"
            className={s.timezone === "utc" ? "on" : undefined}
            onClick={() => set({ timezone: "utc" })}
          >
            UTC
          </button>
          <button
            type="button"
            className={s.timezone === "local" ? "on" : undefined}
            onClick={() => set({ timezone: "local" })}
          >
            Local
          </button>
        </span>
      </div>
      <div className="pc-set-row">
        <span className="pc-set-label">Crosshair</span>
        <span className="pc-seg" role="group" aria-label="Crosshair mode">
          <button
            type="button"
            className={s.crosshair === "normal" ? "on" : undefined}
            onClick={() => set({ crosshair: "normal" })}
          >
            Free
          </button>
          <button
            type="button"
            className={s.crosshair === "magnet" ? "on" : undefined}
            onClick={() => set({ crosshair: "magnet" })}
          >
            Magnet
          </button>
        </span>
      </div>

      <div className="pc-pop-title pc-pop-title-gap">Scale</div>
      <div className="pc-set-row">
        {check(s.scale.log, "Log scale", () => setScale({ log: !s.scale.log }))}
        {check(s.scale.autoScale, "Auto scale", () => setScale({ autoScale: !s.scale.autoScale }))}
      </div>
    </div>
  );
}
